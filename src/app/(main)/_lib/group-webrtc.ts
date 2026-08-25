"use client";

/**
 * Group calls — multi-peer WebRTC MESH with Firebase signaling.
 *
 * Every participant connects directly to every other participant through its
 * own RTCPeerConnection (full mesh). Glare is resolved deterministically: for
 * each pair the lexicographically SMALLER uid creates the offer.
 *
 * Firebase paths:
 *   groupCalls/{gid}
 *     ├─ initiatorId / initiatorName / groupName / type / startedAt
 *     └─ participants/{uid} = { name, joinedAt }
 *   groupCallSignals/{gid}/{pairKey}
 *     ├─ offer  = { type, sdp, from }
 *     ├─ answer = { type, sdp, from }
 *     └─ candidates/{fromUid}/{pushKey} = ICE candidate
 *
 * Extras: mic/cam toggles, local call recording (all audio mixed through an
 * AudioContext → MediaRecorder → automatic .webm download).
 */
import { create } from "zustand";

import { db, serverTimestamp } from "@/lib/firebase";
import { pushToUserSafe } from "@/lib/web-push-client";

export type GroupCallInfo = {
  gid: string;
  groupName: string;
  type: "audio" | "video";
  status: "ringing" | "connecting" | "connected";
  /** Number of peers we are actually connected to (UI badge). */
  peerCount: number;
};

export type GroupParticipant = {
  uid: string;
  name: string;
  stream: MediaStream | null;
};

type GroupCallStore = {
  call: GroupCallInfo | null;
  participants: Record<string, GroupParticipant>;
  micEnabled: boolean;
  camEnabled: boolean;
  localStream: MediaStream | null;
  startedAt: number | null;
  recording: boolean;
};

export const useGroupCallStore = create<GroupCallStore>(() => ({
  call: null,
  participants: {},
  micEnabled: true,
  camEnabled: true,
  localStream: null,
  startedAt: null,
  recording: false,
}));

/* ==================== ENGINE STATE ==================== */

type PeerEntry = {
  pc: RTCPeerConnection;
  candidatesOff: () => void;
  offerOff: (() => void) | null;
  answerOff: (() => void) | null;
};

let myGid: string | null = null;
let myUid: string | null = null;
let myName = "";
let myType: "audio" | "video" = "audio";
let localStream: MediaStream | null = null;
const peers = new Map<string, PeerEntry>();
let participantsRef: { off: (event?: string, cb?: unknown) => void } | null = null;
let callMetaRef: { off: (event?: string, cb?: unknown) => void } | null = null;
let connectedFired = false;
let connectingTone: ReturnType<typeof setInterval> | null = null;

function setCallStatus(status: GroupCallInfo["status"]) {
  const c = useGroupCallStore.getState().call;
  if (c) useGroupCallStore.setState({ call: { ...c, status } });
}

function setPeerCount() {
  const c = useGroupCallStore.getState().call;
  if (c) useGroupCallStore.setState({ call: { ...c, peerCount: peers.size } });
}

/* ==================== CONNECTING BEEP (shared WebAudio) ==================== */

function startConnectingBeep() {
  stopConnectingBeep();
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();
    connectingTone = setInterval(() => {
      const now = ctx.currentTime;
      [620, 520].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        const start = now + i * 0.2;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.06, start + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.16);
      });
    }, 2500);
  } catch {
    /* audio unavailable */
  }
}
function stopConnectingBeep() {
  if (connectingTone) {
    clearInterval(connectingTone);
    connectingTone = null;
  }
}

/* ==================== PEER CONNECTION FACTORY ==================== */

const ICE_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" },
    { urls: "stun:stun.global.twilio.com:3478" },
  ],
  iceCandidatePoolSize: 8,
};

function pairKey(a: string, b: string) {
  return [a, b].sort().join("__");
}

function createPeer(otherUid: string): RTCPeerConnection {
  const pc = new RTCPeerConnection(ICE_CONFIG);
  const pk = pairKey(myUid as string, otherUid);

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      db.ref(`groupCallSignals/${myGid}/${pk}/candidates/${myUid}`)
        .push()
        .set(event.candidate.toJSON())
        .catch(() => {});
    }
  };

  pc.ontrack = (event) => {
    const track = event.track;
    if (!track) return;
    // Merge into a FRESH MediaStream so the tile re-attaches srcObject and
    // re-invokes play() — same-reference updates never re-render, and Safari
    // can stall when tracks change on an attached stream.
    const prevStream = useGroupCallStore.getState().participants[otherUid]?.stream;
    const prev = prevStream ? prevStream.getTracks().filter((x) => x.readyState !== "ended") : [];
    const merged = [...prev.filter((x) => x.kind !== track.kind), track];
    const stream = new MediaStream(merged);
    useGroupCallStore.setState((s) => {
      const prevP = s.participants[otherUid];
      return {
        participants: {
          ...s.participants,
          [otherUid]: { uid: otherUid, name: prevP?.name || otherUid, stream },
        },
      };
    });
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") {
      stopConnectingBeep();
      if (!connectedFired) {
        connectedFired = true;
        setCallStatus("connected");
        useGroupCallStore.setState({ startedAt: Date.now() });
      }
    }
    if (pc.connectionState === "failed") {
      /* best-effort ICE restart when we are the offerer */
      if (myUid! < otherUid && pc.signalingState === "stable") {
        pc.createOffer({ iceRestart: true })
          .then(async (o) => {
            await pc.setLocalDescription(o);
            await db.ref(`groupCallSignals/${myGid}/${pk}/offer`).set({ type: o.type, sdp: o.sdp, from: myUid });
          })
          .catch(() => {});
      }
    }
  };

  /* ICE candidates from the other side */
  const candRef = db.ref(`groupCallSignals/${myGid}/${pk}/candidates/${otherUid}`);
  const candCb = candRef.on("child_added", (snap: { key: string | null; val: () => RTCIceCandidateInit | null }) => {
    const c = snap.val();
    if (c && pc.remoteDescription) pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
    else if (c) {
      /* buffer until remote description exists */
      const check = setInterval(() => {
        if (pc.remoteDescription) {
          pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
          clearInterval(check);
        }
        if (pc.connectionState === "closed" || pc.connectionState === "failed") clearInterval(check);
      }, 700);
      setTimeout(() => clearInterval(check), 30000);
    }
  });

  const entry: PeerEntry = { pc, candidatesOff: () => candRef.off("child_added", candCb), offerOff: null, answerOff: null };
  peers.set(otherUid, entry);
  setPeerCount();
  return pc;
}

/** Wire the offer/answer exchange for one peer (called for every other participant). */
async function connectToPeer(otherUid: string, otherName: string) {
  if (peers.has(otherUid) || !localStream) return;
  useGroupCallStore.setState((s) => ({
    participants: { ...s.participants, [otherUid]: { uid: otherUid, name: otherName, stream: s.participants[otherUid]?.stream || null } },
  }));

  const pk = pairKey(myUid as string, otherUid);
  const pc = createPeer(otherUid);
  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream as MediaStream));
  const entry = peers.get(otherUid) as PeerEntry;

  /* I am the deterministic offerer when my uid is smaller */
  if ((myUid as string) < otherUid) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await db.ref(`groupCallSignals/${myGid}/${pk}/offer`).set({ type: offer.type, sdp: offer.sdp, from: myUid });

    const answerRef = db.ref(`groupCallSignals/${myGid}/${pk}/answer`);
    const answerCb = answerRef.on("value", async (snap: { val: () => { type: string; sdp: string; from?: string } | null }) => {
      const answer = snap.val();
      if (answer && answer.from === otherUid && pc.signalingState !== "stable") {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(answer as RTCSessionDescriptionInit));
          setCallStatus(peers.size > 0 ? "connecting" : "ringing");
        } catch {
          /* ignore */
        }
      }
    });
    entry.answerOff = () => answerRef.off("value", answerCb);
  } else {
    /* I wait for their offer, then answer */
    const offerRef = db.ref(`groupCallSignals/${myGid}/${pk}/offer`);
    const offerCb = offerRef.on("value", async (snap: { val: () => { type: string; sdp: string; from?: string } | null }) => {
      const offer = snap.val();
      if (offer && offer.from === otherUid && pc.signalingState === "stable" && !pc.remoteDescription) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(offer as RTCSessionDescriptionInit));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await db.ref(`groupCallSignals/${myGid}/${pk}/answer`).set({ type: answer.type, sdp: answer.sdp, from: myUid });
          setCallStatus("connecting");
        } catch {
          /* ignore */
        }
      }
    });
    entry.offerOff = () => offerRef.off("value", offerCb);
  }
}

function closePeer(otherUid: string) {
  const entry = peers.get(otherUid);
  if (entry) {
    try {
      entry.pc.close();
    } catch {
      /* ignore */
    }
    entry.candidatesOff();
    entry.offerOff?.();
    entry.answerOff?.();
    peers.delete(otherUid);
  }
  useGroupCallStore.setState((s) => {
    const next = { ...s.participants };
    delete next[otherUid];
    return { participants: next };
  });
  setPeerCount();
}

/* ==================== MEDIA ==================== */

/* Echo cancellation is essential on mobile speakers — without it peers hear
 * themselves echoed, which reads as "the other person's voice doesn't come". */
const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

async function getMedia(video: boolean): Promise<MediaStream> {
  if (video) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: AUDIO_CONSTRAINTS,
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      });
    } catch {
      useGroupCallStore.setState({ camEnabled: false });
      return navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: false });
    }
  }
  return navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: false });
}

/* ==================== JOIN / START / LEAVE ==================== */

/** Common join flow used by both the initiator and the accepters. */
async function joinCall(gid: string, groupName: string, uid: string, name: string, type: "audio" | "video") {
  myGid = gid;
  myUid = uid;
  myName = name;
  myType = type;
  connectedFired = false;

  useGroupCallStore.setState({
    call: { gid, groupName, type, status: "ringing", peerCount: 0 },
    participants: {},
    micEnabled: true,
    camEnabled: type === "video",
    localStream: null,
    startedAt: null,
    recording: false,
  });

  try {
    localStream = await getMedia(type === "video");
  } catch {
    toastMicDenied();
    await cleanupEngine();
    return;
  }
  useGroupCallStore.setState({ localStream });

  /* Announce myself as a participant */
  await db.ref(`groupCalls/${gid}/participants/${uid}`).set({ name, joinedAt: serverTimestamp });
  db.ref(`groupCalls/${gid}/participants/${uid}`).onDisconnect().remove();

  startConnectingBeep();

  /* Watch the participant list — connect to everyone new */
  const partsRef = db.ref(`groupCalls/${gid}/participants`);
  const partsCb = partsRef.on("value", (snap: { val: () => Record<string, { name?: string }> | null }) => {
    const parts = snap.val() || {};
    const uids = Object.keys(parts);
    for (const otherUid of uids) {
      if (otherUid === uid || peers.has(otherUid)) continue;
      connectToPeer(otherUid, parts[otherUid]?.name || "Member").catch(() => {});
    }
    for (const otherUid of Array.from(peers.keys())) {
      if (!parts[otherUid]) closePeer(otherUid);
    }
    /* Last one out turns off the lights */
    if (uids.length === 0) {
      leaveGroupCall(true).catch(() => {});
    }
  });
  participantsRef = { off: () => partsRef.off() };

  /* Watch the call node itself — if the whole call is deleted while we're in it, exit */
  const metaRef = db.ref(`groupCalls/${gid}`);
  const metaCb = metaRef.on("value", (snap: { exists: () => boolean }) => {
    if (!snap.exists() && useGroupCallStore.getState().call?.gid === gid) {
      leaveGroupCall(true).catch(() => {});
    }
  });
  callMetaRef = { off: () => metaRef.off() };
}

function toastMicDenied() {
  import("sonner").then(({ toast }) => toast.error("Could not access your microphone"));
}

/** Start a brand-new group call (initiator). */
export async function startGroupCall(gid: string, groupName: string, uid: string, name: string, type: "audio" | "video") {
  if (useGroupCallStore.getState().call) return;
  await db.ref(`groupCalls/${gid}`).set({
    initiatorId: uid,
    initiatorName: name,
    groupName,
    type,
    startedAt: serverTimestamp,
    participants: { [uid]: { name, joinedAt: serverTimestamp } },
  });
  db.ref(`groupCalls/${gid}`).onDisconnect().remove();
  // Direct web push — members' browsers get the group-call notification even
  // with the tab CLOSED (no Cloud Functions / Blaze plan required).
  db.ref(`groups/${gid}/members`)
    .once("value")
    .then((snap) => {
      Object.keys(snap.val() || {}).forEach((member) => {
        if (member !== uid) {
          pushToUserSafe(member, {
            type: "incoming-group-call",
            gid,
            groupName,
            initiatorName: name,
            callType: type,
          });
        }
      });
    })
    .catch(() => {});
  await joinCall(gid, groupName, uid, name, type);
  /* clear any declined marker so members get re-invited on new calls */
  localStorage.removeItem(`chatbd-gcall-declined-${gid}-${uid}`);
}

/** Join an ongoing group call (from the incoming-call dialog). */
export async function joinGroupCall(gid: string, groupName: string, uid: string, name: string) {
  const snap = await db.ref(`groupCalls/${gid}`).once("value");
  const info = snap.val() as { type?: "audio" | "video" } | null;
  if (!info) return;
  await joinCall(gid, groupName, uid, name, info.type || "audio");
}

/** Leave the call. `silent` skips DB writes when the node is already gone. */
export async function leaveGroupCall(silent = false) {
  stopConnectingBeep();
  stopGroupCallRecording(false);
  const gid = myGid; // capture before cleanupEngine() nulls it
  const uid = myUid;
  if (gid && uid && !silent) {
    let memberUids: string[] = [];
    try {
      const membersSnap = await db.ref(`groups/${gid}/members`).once("value");
      memberUids = Object.keys(membersSnap.val() || {});
    } catch {
      /* best-effort */
    }
    await db.ref(`groupCalls/${gid}/participants/${uid}`).remove().catch(() => {});
    const rest = await db.ref(`groupCalls/${gid}/participants`).once("value").catch(() => null);
    if (!rest || !rest.exists() || Object.keys(rest.val() || {}).length === 0) {
      await db.ref(`groupCalls/${gid}`).remove().catch(() => {});
      await db.ref(`groupCallSignals/${gid}`).remove().catch(() => {});
      // Last one out — close everyone's lingering group-call notifications.
      memberUids.forEach((m) => {
        if (m !== uid) pushToUserSafe(m, { type: "group-call-ended", gid });
      });
    }
  }
  await cleanupEngine();
}

async function cleanupEngine() {
  for (const uid of Array.from(peers.keys())) closePeer(uid);
  participantsRef?.off();
  participantsRef = null;
  callMetaRef?.off();
  callMetaRef = null;
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  myGid = null;
  myUid = null;
  myName = "";
  connectedFired = false;
  useGroupCallStore.setState({ call: null, participants: {}, localStream: null, startedAt: null, recording: false });
}

/* ==================== TOGGLES ==================== */

export function toggleGroupMic() {
  if (!localStream) return;
  const enabled = !useGroupCallStore.getState().micEnabled;
  localStream.getAudioTracks().forEach((t) => (t.enabled = enabled));
  useGroupCallStore.setState({ micEnabled: enabled });
}

export function toggleGroupCam() {
  if (!localStream) return;
  const enabled = !useGroupCallStore.getState().camEnabled;
  localStream.getVideoTracks().forEach((t) => (t.enabled = enabled));
  useGroupCallStore.setState({ camEnabled: enabled });
}

/* ==================== GROUP CALL RECORDING (mixed audio) ==================== */

let groupRecorder: MediaRecorder | null = null;
let groupRecorderChunks: Blob[] = [];
let groupRecordingStream: MediaStream | null = null;

/** Record the group call — mixes the local mic + every remote peer's audio. */
export async function startGroupCallRecording() {
  if (groupRecorder) return;
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();
    const dest = ctx.createMediaStreamDestination();
    const mixIn = (stream: MediaStream | null) => {
      if (!stream) return;
      try {
        ctx.createMediaStreamSource(stream).connect(dest);
      } catch {
        /* ignore */
      }
    };
    mixIn(localStream);
    /* mix every known participant stream (remote) */
    for (const p of Object.values(useGroupCallStore.getState().participants)) {
      if (p.stream) mixIn(p.stream);
    }
    groupRecordingStream = dest.stream;
    groupRecorderChunks = [];
    groupRecorder = new MediaRecorder(groupRecordingStream);
    groupRecorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) groupRecorderChunks.push(ev.data);
    };
    groupRecorder.onstop = () => {
      const blob = new Blob(groupRecorderChunks, { type: "audio/webm" });
      downloadBlob(blob, `chatbd-group-call-${Date.now()}.webm`);
      groupRecorder = null;
      groupRecordingStream = null;
    };
    groupRecorder.start(1000);
    useGroupCallStore.setState({ recording: true });
  } catch {
    groupRecorder = null;
  }
}

export function stopGroupCallRecording(download = true) {
  if (groupRecorder) {
    if (!download) groupRecorder.onstop = null;
    try {
      groupRecorder.stop();
    } catch {
      /* ignore */
    }
    groupRecorder = null;
  }
  useGroupCallStore.setState({ recording: false });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* ==================== INCOMING GROUP-CALL WATCHER ==================== */

/**
 * Watches `groupCalls` for calls started in MY groups. Fires when a call is
 * active, I'm not in it, I'm not already in a call and I haven't declined it.
 * Returns a detach function.
 */
export function watchIncomingGroupCalls(
  myUid: string,
  myGids: () => string[],
  onIncoming: (info: { gid: string; groupName: string; initiatorName: string; type: "audio" | "video" } | null) => void,
) {
  const ref = db.ref("groupCalls");
  const cb = ref.on("value", (snap: { forEach: (cb: (child: { key: string | null; val: () => unknown }) => void) => void }) => {
    let found: { gid: string; groupName: string; initiatorName: string; type: "audio" | "video" } | null = null;
    snap.forEach((child) => {
      const gid = child.key as string;
      const v = child.val() as {
        initiatorId?: string;
        initiatorName?: string;
        groupName?: string;
        type?: "audio" | "video";
        startedAt?: number;
        participants?: Record<string, unknown>;
      };
      if (!myGids().includes(gid)) return;
      if (v.participants && v.participants[myUid]) return;
      if (useGroupCallStore.getState().call) return;
      /* skip calls that are older than 2 minutes and have nobody in them */
      const declinedAt = Number(localStorage.getItem(`chatbd-gcall-declined-${gid}`) || 0);
      if (declinedAt && (v.startedAt || 0) <= declinedAt) return;
      if (!found) {
        found = {
          gid,
          groupName: v.groupName || "Group",
          initiatorName: v.initiatorName || "Someone",
          type: v.type || "audio",
        };
      }
    });
    onIncoming(found);
  });
  return () => ref.off("value", cb);
}

/** Decline an incoming group call (remember until a NEW call starts). */
export async function declineGroupCall(gid: string) {
  const snap = await db.ref(`groupCalls/${gid}/startedAt`).once("value").catch(() => null);
  localStorage.setItem(`chatbd-gcall-declined-${gid}`, String(snap?.val() || Date.now()));
}

/* ==================== HELPERS ==================== */

export { downloadBlob };
export function groupCallTypeOf(gid: string): Promise<"audio" | "video"> {
  return db
    .ref(`groupCalls/${gid}/type`)
    .once("value")
    .then((s: { val: () => "audio" | "video" | null }) => s.val() || "audio")
    .catch(() => "audio" as const);
}
