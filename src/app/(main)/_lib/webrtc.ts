"use client";

/**
 * WebRTC P2P audio/video calls with Firebase signaling.
 * Production-grade implementation with:
 *   - Browser ringtone (oscillator-based, no asset needed) + custom calling tone
 *   - Camera switch (front ⇄ back) for video calls
 *   - Mic mute / cam mute toggles
 *   - Auto fallback: if camera permission denied, audio-only
 *   - ICE restart on failure, pending candidates queue
 *   - 45s ringing timeout → missed status
 *
 * Firebase paths (unchanged from original):
 *   calls/{callId}              = call metadata
 *   callSignals/{callId}/offer   = {type, sdp}
 *   callSignals/{callId}/answer  = {type, sdp}
 *   callSignals/{callId}/callerCandidates   = push-key → ICE candidate
 *   callSignals/{callId}/receiverCandidates  = push-key → ICE candidate
 */
import { create } from "zustand";

import { db, serverTimestamp } from "@/lib/firebase";
import { pushToUserSafe } from "@/lib/web-push-client";
import { useGroupCallStore } from "./group-webrtc";

export type ActiveCall = {
  callKey: string;
  peerUid: string;
  peerName: string;
  type: "audio" | "video";
  direction: "outgoing" | "incoming";
  status: "ringing" | "connecting" | "connected" | "ended";
};

type CallStore = {
  activeCall: ActiveCall | null;
  micEnabled: boolean;
  camEnabled: boolean;
  /** For video calls: which camera is active. */
  facingMode: "user" | "environment";
  /** True while the screen (not the camera) is being shared. */
  screenSharing: boolean;
  /** True while the call is being recorded (mixed audio). */
  recording: boolean;
  remoteStream: MediaStream | null;
  localStream: MediaStream | null;
  callStartAt: number | null;
};

export const useCallStore = create<CallStore>(() => ({
  activeCall: null,
  micEnabled: true,
  camEnabled: true,
  facingMode: "user",
  screenSharing: false,
  recording: false,
  remoteStream: null,
  localStream: null,
  callStartAt: null,
}));

const setStatus = (status: ActiveCall["status"]) => {
  const c = useCallStore.getState().activeCall;
  if (c) useCallStore.setState({ activeCall: { ...c, status } });
};

/* ==================== RINGTONE / CALLING TUNE (Web Audio API) ==================== */

let audioCtx: AudioContext | null = null;
let ringtoneTimer: ReturnType<typeof setInterval> | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new Ctor();
  }
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  return audioCtx;
}

/** Plays the classic two-tone ringing pattern (North-American ringback cadence:
 *  2 seconds on, 4 seconds off). Used for outgoing calls while ringing. */
export function startRingbackTone() {
  stopRingbackTone();
  const ctx = getAudioContext();
  const playBurst = () => {
    const now = ctx.currentTime;
    // Two consecutive tones (440/480 Hz ringback, US style)
    [440, 480].forEach((freq) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.08, now + 0.05);
      gain.gain.setValueAtTime(0.08, now + 1.8);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.0);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 2.05);
    });
  };
  playBurst();
  ringtoneTimer = setInterval(playBurst, 6000); // 2s on + 4s silence = 6s cycle
}

/** Plays the incoming-call ringtone (loud, repeating). Used for incoming calls. */
export function startIncomingRingtone() {
  stopRingbackTone();
  const ctx = getAudioContext();
  const playBurst = () => {
    const now = ctx.currentTime;
    // Bell-like dual tone, 1.5s on, 3s off — sounds like a phone
    [440, 480].forEach((freq) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.15, now + 0.05);
      gain.gain.setValueAtTime(0.15, now + 1.4);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 1.55);
    });
  };
  playBurst();
  ringtoneTimer = setInterval(playBurst, 4500); // 1.5s on + 3s silence
}

/** Plays a short "connecting" beep when call transitions to connecting state. */
export function playConnectingBeep() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    [1000, 1200, 1400].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = now + i * 0.15;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.1, start + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.15);
    });
  } catch { /* ignore */ }
}

export function stopRingbackTone() {
  if (ringtoneTimer) {
    clearInterval(ringtoneTimer);
    ringtoneTimer = null;
  }
  if (audioCtx && audioCtx.state === "running") {
    audioCtx.suspend().catch(() => {});
  }
}

/* ==================== WEBRTC ENGINE ==================== */

let pc: RTCPeerConnection | null = null;
let localStream: MediaStream | null = null;
let remoteStream: MediaStream | null = null;
let pendingCandidates: RTCIceCandidateInit[] = [];
let candidatesListener: { off: () => void } | null = null;
let answerListener: { off: () => void } | null = null;
let statusListener: { off: () => void } | null = null;
let offerRestartListener: { off: () => void } | null = null;
let myCallKey: string | null = null;
let myRole: "caller" | "callee" | null = null;
let callConnectedFired = false;
let ringingTimeout: ReturnType<typeof setTimeout> | null = null;
/** Call keys this device already answered with "busy" (avoids repeated writes). */
const busyMarked = new Set<string>();

function newPeerConnection(role: "caller" | "callee"): RTCPeerConnection {
  const config: RTCConfiguration = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
      { urls: "stun:stun3.l.google.com:19302" },
      { urls: "stun:stun4.l.google.com:19302" },
      { urls: "stun:global.stun.twilio.com:3478" },
    ],
    iceCandidatePoolSize: 10,
  };
  const conn = new RTCPeerConnection(config);

  // ICE candidate handler — write to callerCandidates or receiverCandidates
  conn.onicecandidate = (event) => {
    if (event.candidate && myCallKey) {
      const path =
        role === "caller"
          ? `callSignals/${myCallKey}/callerCandidates`
          : `callSignals/${myCallKey}/receiverCandidates`;
      db.ref(path)
        .push()
        .set(event.candidate.toJSON())
        .catch(() => {});
    }
  };

  conn.ontrack = (event) => {
    const track = event.track;
    if (!track) return;
    // Merge tracks into a FRESH MediaStream object every time.
    // Why: a new object reference re-triggers the UI effect that re-attaches
    // srcObject and calls play() — Safari/iOS stall if tracks are swapped
    // on an already-attached stream, and same-reference updates never re-render.
    const prev = remoteStream ? remoteStream.getTracks().filter((x) => x.readyState !== "ended") : [];
    const merged = [...prev.filter((x) => x.kind !== track.kind), track];
    remoteStream = new MediaStream(merged);
    useCallStore.setState({ remoteStream });
  };

  conn.onconnectionstatechange = () => {
    if (!pc) return;
    if (pc.connectionState === "connected" && !callConnectedFired) {
      callConnectedFired = true;
      stopRingbackTone();
      setStatus("connected");
      useCallStore.setState({ callStartAt: Date.now() });
      if (myCallKey) db.ref(`calls/${myCallKey}/status`).set("connected").catch(() => {});
    } else if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
      // Give some grace period before ending on disconnected
      if (pc.connectionState === "failed") {
        endCall().catch(() => {});
      }
    }
  };

  conn.oniceconnectionstatechange = () => {
    if (!pc) return;
    if (pc.iceConnectionState === "failed") {
      // try ICE restart from caller side
      if (role === "caller" && pc.signalingState === "stable") {
        pc.createOffer({ iceRestart: true })
          .then((o) => pc!.setLocalDescription(o))
          .then(() => {
            if (myCallKey) {
              db.ref(`callSignals/${myCallKey}/offer`).set({
                type: pc!.localDescription!.type,
                sdp: pc!.localDescription!.sdp,
              });
            }
          })
          .catch(() => {});
      } else {
        endCall().catch(() => {});
      }
    } else if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
      processPendingCandidates();
    }
  };

  return conn;
}

/* Explicit audio constraints — echo cancellation is critical on mobile
 * speakers; without it the remote side hears themselves (sounds like "no audio
 * from the other person" while the mic picks up the loudspeaker output). */
const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

async function getMedia(video: boolean, facingMode: "user" | "environment" = "user"): Promise<MediaStream> {
  // If video, try the requested facing mode first; fall back to any video
  if (video) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: AUDIO_CONSTRAINTS,
        video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
    } catch {
      // Fallback: any video device (no facing constraint)
      try {
        return await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: true });
      } catch {
        // Final fallback: audio only
        useCallStore.setState((s) => ({
          activeCall: s.activeCall ? { ...s.activeCall, type: "audio" } : s.activeCall,
          camEnabled: false,
        }));
        return await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: false });
      }
    }
  }
  return navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: false });
}

function processPendingCandidates() {
  if (pendingCandidates.length === 0 || !pc || !pc.remoteDescription) return;
  const toProcess = [...pendingCandidates];
  pendingCandidates = [];
  for (const c of toProcess) {
    pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
  }
}

function listenForRemoteCandidates(callId: string, role: "caller" | "callee") {
  const path =
    role === "caller" ? `callSignals/${callId}/receiverCandidates` : `callSignals/${callId}/callerCandidates`;
  const ref = db.ref(path);
  const cb = ref.on("child_added", (snap: { val: () => RTCIceCandidateInit | null }) => {
    const data = snap.val();
    if (!data) return;
    if (pc && pc.remoteDescription) {
      pc.addIceCandidate(new RTCIceCandidate(data)).catch(() => {});
    } else {
      pendingCandidates.push(data);
    }
  });
  candidatesListener = { off: () => ref.off("child_added", cb) };
}

/* ==================== OUTGOING CALL (CALLER) ==================== */

export async function startCall(
  myUid: string,
  myName: string,
  peerUid: string,
  peerName: string,
  type: "audio" | "video",
) {
  if (useCallStore.getState().activeCall) return;

  const callKey = db.ref("calls").push().key as string;
  myCallKey = callKey;
  myRole = "caller";
  callConnectedFired = false;
  pendingCandidates = [];

  useCallStore.setState({
    activeCall: { callKey, peerUid, peerName, type, direction: "outgoing", status: "ringing" },
    micEnabled: true,
    camEnabled: type === "video",
    facingMode: "user",
    remoteStream: null,
    localStream: null,
    callStartAt: null,
  });

  // Start ringback tone immediately (user-action-initiated AudioContext)
  startRingbackTone();

  try {
    localStream = await getMedia(type === "video", "user");
    remoteStream = new MediaStream();
    useCallStore.setState({ localStream });

    // Step 1: write call metadata first
    await db.ref(`calls/${callKey}`).set({
      callerId: myUid,
      callerName: myName,
      receiverId: peerUid,
      receiverName: peerName,
      type,
      status: "ringing",
      startTime: serverTimestamp,
    });

    pc = newPeerConnection("caller");
    localStream.getTracks().forEach((track) => pc!.addTrack(track, localStream as MediaStream));

    // Step 2: create offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await db.ref(`callSignals/${callKey}/offer`).set({
      type: offer.type,
      sdp: offer.sdp,
    });

    // Step 2.5: direct web push — the callee's browser now rings even with the
    // tab CLOSED (no Cloud Functions / Blaze plan required).
    pushToUserSafe(peerUid, {
      type: "incoming-call",
      callKey,
      callerName: myName,
      callType: type,
    });

    // Step 3: listen for answer
    const answerRef = db.ref(`callSignals/${callKey}/answer`);
    const answerCb = answerRef.on(
      "value",
      async (snap: { val: () => { type: string; sdp: string } | null }) => {
        const answer = snap.val();
        if (answer && pc && pc.signalingState !== "stable") {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(answer as RTCSessionDescriptionInit));
            setStatus("connecting");
            playConnectingBeep();
            processPendingCandidates();
          } catch {
            /* ignore */
          }
        }
      },
    );
    answerListener = { off: () => answerRef.off("value", answerCb) };

    // Step 4: listen for remote ICE candidates
    listenForRemoteCandidates(callKey, "caller");

    // Step 5: 45s ringing timeout — mark as missed
    ringingTimeout = setTimeout(() => {
      const c = useCallStore.getState().activeCall;
      if (c && c.callKey === callKey && c.status === "ringing") {
        db.ref(`calls/${callKey}`).update({ status: "missed", endTime: serverTimestamp }).catch(() => {});
        db.ref(`callSignals/${callKey}`).remove().catch(() => {});
        // Let the callee's closed browser swap the ringing notification for a
        // missed-call notice.
        pushToUserSafe(peerUid, { type: "call-ended", callKey, status: "missed", callerName: myName });
        stopRingbackTone();
        cleanup();
        useCallStore.setState({ activeCall: null });
      }
    }, 45000);

    // Step 6: status watcher (callee declined / busy / ended)
    const statusRef = db.ref(`calls/${callKey}/status`);
    const statusCb = statusRef.on("value", (snap: { val: () => string | null }) => {
      const val = snap.val();
      const c = useCallStore.getState().activeCall;
      if (c && c.callKey === callKey && (val === "declined" || val === "ended" || val === "missed" || val === "busy")) {
        if (val === "busy") toastBusy();
        stopRingbackTone();
        cleanup();
        useCallStore.setState({ activeCall: null });
      }
    });
    statusListener = { off: () => statusRef.off("value", statusCb) };
  } catch {
    await db.ref(`calls/${callKey}`).update({ status: "ended", endTime: serverTimestamp }).catch(() => {});
    stopRingbackTone();
    cleanup();
    useCallStore.setState({ activeCall: null });
  }
}

function toastBusy() {
  import("sonner").then(({ toast }) => toast.error("User is on another call"));
}

/* ==================== INCOMING CALL LISTENER ==================== */

/**
 * Fires with the current ringing call for me, or `null` when none is ringing
 * (e.g. the caller gave up → the dialog + ringtone must clear).
 *
 * If I'm already in a call (1:1 or group), a new incoming call is auto-marked
 * "busy" so the caller sees an immediate end instead of waiting out the
 * 45-second ringing timeout.
 */
export function listenForIncomingCalls(
  myUid: string,
  onIncoming: (call: { key: string; callerName: string; type: "audio" | "video" } | null) => void,
) {
  const ref = db.ref("calls").orderByChild("receiverId").equalTo(myUid);
  const cb = ref.on(
    "value",
    (snapshot: { forEach: (cb: (child: { key: string | null; val: () => unknown }) => void) => void }) => {
      let found: { key: string; callerName: string; type: "audio" | "video" } | null = null;
      snapshot.forEach((child) => {
        const call = child.val() as { status: string; callerName?: string; type?: "audio" | "video" };
        if (call.status === "ringing" && !found) {
          found = {
            key: child.key as string,
            callerName: call.callerName || "Unknown",
            type: call.type || "audio",
          };
        }
      });

      if (!found) {
        onIncoming(null);
        return;
      }

      /* Re-read into a fresh local — assignments inside the forEach callback
         above are invisible to TS's control-flow narrowing. */
      const ringing: { key: string; callerName: string; type: "audio" | "video" } = found;

      if (useCallStore.getState().activeCall || useGroupCallStore.getState().call) {
        // Busy — decline the new call on the receiver's behalf (once)
        if (!busyMarked.has(ringing.key)) {
          busyMarked.add(ringing.key);
          db.ref(`calls/${ringing.key}`)
            .update({ status: "busy", endTime: serverTimestamp })
            .catch(() => {});
        }
        onIncoming(null);
        return;
      }

      onIncoming(ringing);
    },
  );
  return () => ref.off("value", cb);
}

/** Accept a ringing call by key (used by push-notification deep links). */
export async function acceptIncomingCallByKey(myUid: string, callKey: string): Promise<boolean> {
  const callSnap = await db.ref(`calls/${callKey}`).once("value");
  const call = callSnap.val() as { callerId: string; status: string; callerName?: string; type?: "audio" | "video" } | null;
  if (!call || call.status !== "ringing") return false;
  await acceptIncomingCall(myUid, callKey, call.callerName || "Unknown", call.type || "audio");
  return true;
}

export async function acceptIncomingCall(
  myUid: string,
  callKey: string,
  callerName: string,
  type: "audio" | "video",
) {
  const callSnap = await db.ref(`calls/${callKey}`).once("value");
  const call = callSnap.val() as { callerId: string; status: string };
  if (!call || call.status !== "ringing") return;

  // Stop incoming ringtone
  stopRingbackTone();

  myCallKey = callKey;
  myRole = "callee";
  callConnectedFired = false;
  pendingCandidates = [];

  useCallStore.setState({
    activeCall: { callKey, peerUid: call.callerId, peerName: callerName, type, direction: "incoming", status: "connecting" },
    micEnabled: true,
    camEnabled: type === "video",
    facingMode: "user",
    remoteStream: null,
    localStream: null,
    callStartAt: null,
  });

  playConnectingBeep();

  try {
    localStream = await getMedia(type === "video", "user");
    remoteStream = new MediaStream();
    useCallStore.setState({ localStream });

    pc = newPeerConnection("callee");
    localStream.getTracks().forEach((track) => pc!.addTrack(track, localStream as MediaStream));

    // Read the offer — retry for up to ~10s. The caller writes call metadata
    // BEFORE the offer; if we accept within that window a single read would
    // return null and the call would silently stay connecting with no audio.
    let offer: { type: string; sdp: string } | null = null;
    for (let i = 0; i < 25 && !offer; i++) {
      // Bail out if the caller cancelled while we were waiting
      const cur = useCallStore.getState().activeCall;
      if (!cur || cur.callKey !== callKey) return;
      const offerSnap = await db.ref(`callSignals/${callKey}/offer`).once("value");
      offer = offerSnap.val() as { type: string; sdp: string } | null;
      if (!offer) await new Promise((r) => setTimeout(r, 400));
    }
    if (offer) {
      await pc.setRemoteDescription(new RTCSessionDescription(offer as RTCSessionDescriptionInit));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await db.ref(`callSignals/${callKey}/answer`).set({
        type: answer.type,
        sdp: answer.sdp,
      });
    }

    // Watch for RE-NEGOTIATED offers (ICE restart) — without this the call
    // drops whenever the caller's network changes mid-call.
    const restartRef = db.ref(`callSignals/${callKey}/offer`);
    const restartCb = restartRef.on("value", async (snap: { val: () => { type: string; sdp: string } | null }) => {
      const offer2 = snap.val();
      if (!offer2 || !pc || !pc.remoteDescription || pc.signalingState !== "stable") return;
      if (offer2.sdp === pc.remoteDescription.sdp) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer2 as RTCSessionDescriptionInit));
        const answer2 = await pc.createAnswer();
        await pc.setLocalDescription(answer2);
        await db.ref(`callSignals/${callKey}/answer`).set({
          type: answer2.type,
          sdp: answer2.sdp,
        });
      } catch {
        /* renegotiation failed — the ICE-restart watcher on the caller side will retry */
      }
    });
    offerRestartListener = { off: () => restartRef.off("value", restartCb) };

    listenForRemoteCandidates(callKey, "callee");

    // Watch for caller ending the call
    const statusRef = db.ref(`calls/${callKey}/status`);
    const statusCb = statusRef.on("value", (snap: { val: () => string | null }) => {
      const val = snap.val();
      const c = useCallStore.getState().activeCall;
      if (c && c.callKey === callKey && (val === "ended" || val === "declined" || val === "missed" || val === "busy")) {
        stopRingbackTone();
        cleanup();
        useCallStore.setState({ activeCall: null });
      }
    });
    statusListener = { off: () => statusRef.off("value", statusCb) };
  } catch {
    await db.ref(`calls/${callKey}`).update({ status: "ended", endTime: serverTimestamp }).catch(() => {});
    stopRingbackTone();
    cleanup();
    useCallStore.setState({ activeCall: null });
  }
}

export async function declineIncomingCall(callKey: string) {
  stopRingbackTone();
  await db.ref(`calls/${callKey}`).update({ status: "declined", endTime: serverTimestamp }).catch(() => {});
  db.ref(`callSignals/${callKey}`).remove().catch(() => {});
}

/* ==================== END CALL (writes status + duration) ==================== */

export async function endCall() {
  stopRingbackTone();
  const c = useCallStore.getState().activeCall;
  if (myCallKey) {
    const startAt = useCallStore.getState().callStartAt;
    const updates: Record<string, unknown> = { status: "ended", endTime: serverTimestamp };
    if (startAt) {
      updates.duration = Math.max(0, Math.round((Date.now() - startAt) / 1000));
    }
    await db.ref(`calls/${myCallKey}`).update(updates).catch(() => {});
    db.ref(`callSignals/${myCallKey}`).remove().catch(() => {});
    // Close the peer's lingering incoming-call notification (their tab may be
    // closed — the service worker handles it).
    if (c?.peerUid) {
      pushToUserSafe(c.peerUid, { type: "call-ended", callKey: myCallKey, status: "ended" });
    }
  }
  stopCallRecording();
  cleanup();
  useCallStore.setState({ activeCall: null });
}

function cleanup() {
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  remoteStream = null;
  if (pc) {
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
    pc.oniceconnectionstatechange = null;
    pc.close();
    pc = null;
  }
  candidatesListener?.off();
  candidatesListener = null;
  answerListener?.off();
  answerListener = null;
  statusListener?.off();
  statusListener = null;
  offerRestartListener?.off();
  offerRestartListener = null;
  if (ringingTimeout) {
    clearTimeout(ringingTimeout);
    ringingTimeout = null;
  }
  pendingCandidates = [];
  callConnectedFired = false;
  myCallKey = null;
  myRole = null;
  useCallStore.setState({ remoteStream: null, localStream: null, callStartAt: null });
}

/* ==================== TOGGLES ==================== */

export function toggleMic() {
  if (localStream) {
    const enabled = !useCallStore.getState().micEnabled;
    localStream.getAudioTracks().forEach((t) => (t.enabled = enabled));
    useCallStore.setState({ micEnabled: enabled });
  }
}

export function toggleCam() {
  if (localStream) {
    const enabled = !useCallStore.getState().camEnabled;
    localStream.getVideoTracks().forEach((t) => (t.enabled = enabled));
    useCallStore.setState({ camEnabled: enabled });
  }
}

/**
 * Switch the active camera (front ⇄ back). Replaces the video track on both
 * the local stream and the peer connection sender without renegotiating.
 */
export async function switchCamera() {
  if (!localStream || !pc) return;
  const currentFacing = useCallStore.getState().facingMode;
  const nextFacing: "user" | "environment" = currentFacing === "user" ? "environment" : "user";

  // Get new video track with the opposite facing mode
  try {
    const newStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: nextFacing }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    const newVideoTrack = newStream.getVideoTracks()[0];
    if (!newVideoTrack) return;

    // Replace the track on the peer connection sender
    const sender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
    if (sender) {
      await sender.replaceTrack(newVideoTrack);
    }

    // Swap on the local stream
    const oldVideoTrack = localStream.getVideoTracks()[0];
    if (oldVideoTrack) {
      localStream.removeTrack(oldVideoTrack);
      oldVideoTrack.stop();
    }
    localStream.addTrack(newVideoTrack);

    useCallStore.setState({
      facingMode: nextFacing,
      localStream: new MediaStream(localStream.getTracks()),
    });
  } catch {
    // Some devices (e.g. desktop without 2 cameras) will fail — silently ignore.
  }
}

/* ==================== CALL RECORDING (local + remote audio mixed) ==================== */

let callRecorder: MediaRecorder | null = null;
let callRecorderChunks: Blob[] = [];

/** Start recording the active 1:1 call — mixes mic + remote audio into one track. */
export async function startCallRecording() {
  if (callRecorder) return;
  if (!localStream) return;
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
    mixIn(remoteStream);
    callRecorderChunks = [];
    callRecorder = new MediaRecorder(dest.stream);
    callRecorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) callRecorderChunks.push(ev.data);
    };
    callRecorder.onstop = () => {
      const blob = new Blob(callRecorderChunks, { type: "audio/webm" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `chatbd-call-${Date.now()}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      callRecorder = null;
    };
    callRecorder.start(1000);
    useCallStore.setState({ recording: true } as Partial<ReturnType<typeof useCallStore.getState>>);
  } catch {
    callRecorder = null;
  }
}

/** Stop recording. Downloads the finished file unless `download` is false. */
export function stopCallRecording(download = true) {
  if (!callRecorder) return;
  if (!download) callRecorder.onstop = null;
  try {
    callRecorder.stop();
  } catch {
    /* ignore */
  }
  callRecorder = null;
  useCallStore.setState({ recording: false } as Partial<ReturnType<typeof useCallStore.getState>>);
}

export function isCallRecording() {
  return !!callRecorder;
}

/* ==================== SCREEN SHARING ==================== */

let originalCameraTrack: MediaStreamTrack | null = null;
let screenStream: MediaStream | null = null;

/** Share the screen during a video call (replaces the outgoing video track).
 *  Call again to stop and return to the camera. */
export async function toggleScreenShare() {
  if (!localStream || !pc) return;
  const sharing = !!screenStream;

  if (sharing) {
    // Stop sharing → restore the camera track
    try {
      if (screenStream) {
        screenStream.getTracks().forEach((t) => t.stop());
        screenStream = null;
      }
      if (originalCameraTrack && originalCameraTrack.readyState !== "ended") {
        const sender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
        if (sender) await sender.replaceTrack(originalCameraTrack);
        const currentVideo = localStream.getVideoTracks()[0];
        if (currentVideo) {
          localStream.removeTrack(currentVideo);
          if (currentVideo.readyState === "live") currentVideo.stop();
        }
        localStream.addTrack(originalCameraTrack);
        originalCameraTrack = null;
        useCallStore.setState({ screenSharing: false, localStream: new MediaStream(localStream.getTracks()) });
      }
    } catch {
      /* ignore */
    }
    return;
  }

  try {
    const display = await (navigator.mediaDevices as MediaDevices & {
      getDisplayMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
    }).getDisplayMedia({ video: true, audio: false });
    const screenTrack = display.getVideoTracks()[0];
    if (!screenTrack) return;
    screenStream = display;

    // Remember the camera track so we can restore it later
    originalCameraTrack = localStream.getVideoTracks()[0] || null;

    // Replace the outgoing video track
    const sender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
    if (sender) await sender.replaceTrack(screenTrack);

    // Swap on the local stream so the preview shows the screen
    if (originalCameraTrack) localStream.removeTrack(originalCameraTrack);
    localStream.addTrack(screenTrack);
    useCallStore.setState({ screenSharing: true, localStream: new MediaStream(localStream.getTracks()) });

    // When the user stops sharing via the browser UI, restore the camera
    screenTrack.addEventListener("ended", () => {
      toggleScreenShare().catch(() => {});
    });
  } catch {
    /* user cancelled the picker — ignore */
  }
}
