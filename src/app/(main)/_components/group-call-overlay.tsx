"use client";

/**
 * GroupCallOverlay — full-screen mesh group-call UI:
 *   • participant video grid (local + every remote peer)
 *   • mic / camera toggles, call recording, duration timer
 *   • IncomingGroupCallDialog — accept/decline ring for group calls
 */
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Circle, Mic, MicOff, PhoneOff, Users, Video, VideoOff } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn, getInitials } from "@/lib/utils";
import { formatCallDuration } from "@/lib/format";
import { t } from "@/lib/i18n";
import { useChatApp, useAppLang } from "../_lib/store";
import {
  declineGroupCall,
  joinGroupCall,
  leaveGroupCall,
  startGroupCallRecording,
  stopGroupCallRecording,
  useGroupCallStore,
} from "../_lib/group-webrtc";
import { startIncomingRingtone, stopRingbackTone } from "../_lib/webrtc";
import { closeNotificationsByTag, groupCallTag, showOsNotification } from "@/lib/notify";

/* ==================== DURATION TIMER ==================== */

function Duration({ startedAt }: { startedAt: number | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  if (!startedAt) return null;
  return <span className="tabular-nums">{formatCallDuration(startedAt, now)}</span>;
}

/* ==================== PARTICIPANT TILE ==================== */

/**
 * Remote media sink — ALWAYS renders a dedicated <audio> element for the
 * participant's stream (video calls included). The <video> element is muted
 * on purpose: muted video autoplay is always allowed by browsers, while
 * unmuted autoplay is frequently blocked, which left calls silent.
 * Explicit play() + canplay retry + global gesture unlock recover from
 * autoplay-policy blocks (especially iOS Safari).
 */
function RemoteMedia({ stream }: { stream: MediaStream | null }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hasVideo = !!stream?.getVideoTracks().some((t) => t.readyState === "live" && t.enabled);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !stream) return;
    if (audio.srcObject !== stream) audio.srcObject = stream;
    audio.volume = 1;

    const tryPlay = () => {
      if (audio.srcObject !== stream || !audio.paused) return;
      audio.play().catch(() => {});
    };
    tryPlay();
    const onCanPlay = () => tryPlay();
    audio.addEventListener("canplay", onCanPlay);
    audio.addEventListener("loadedmetadata", onCanPlay);
    const unlock = () => tryPlay();
    window.addEventListener("click", unlock);
    window.addEventListener("touchstart", unlock, { passive: true });
    return () => {
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("loadedmetadata", onCanPlay);
      window.removeEventListener("click", unlock);
      window.removeEventListener("touchstart", unlock);
    };
  }, [stream]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    if (video.srcObject !== stream) video.srcObject = stream;
    video.play().catch(() => {});
  }, [stream, hasVideo]);

  return (
    <>
      {/* Visually hidden (NOT display:none — some mobile browsers suspend
          hidden audio elements) — the single audio sink for this peer */}
      <audio ref={audioRef} autoPlay playsInline className="pointer-events-none absolute size-0 opacity-0" />
      {hasVideo && <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />}
    </>
  );
}

function ParticipantTile({
  name,
  stream,
  isLocal,
  videoEnabled,
}: {
  name: string;
  stream: MediaStream | null;
  isLocal: boolean;
  videoEnabled: boolean;
}) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const hasVideo = !!stream?.getVideoTracks().some((t) => t.readyState === "live" && t.enabled);

  useEffect(() => {
    const video = localVideoRef.current;
    if (!video || !stream) return;
    if (video.srcObject !== stream) video.srcObject = stream;
    video.play().catch(() => {});
  }, [stream]);

  return (
    <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-xl bg-black/60">
      {isLocal ? (
        <>
          {/* Local preview: always muted to avoid hearing ourselves */}
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className={cn("h-full w-full object-cover", videoEnabled ? "" : "opacity-0")}
          />
          {!videoEnabled && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <Avatar className="size-14">
                <AvatarFallback className="bg-primary/20 text-primary text-lg">{getInitials(name)}</AvatarFallback>
              </Avatar>
              <span className="max-w-full truncate px-2 text-xs text-white/80">{name}</span>
            </div>
          )}
        </>
      ) : (
        <>
          {/* Remote peer: audio via dedicated sink, muted video */}
          <RemoteMedia stream={stream} />
          {!hasVideo && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <Avatar className="size-14">
                <AvatarFallback className="bg-primary/20 text-primary text-lg">{getInitials(name)}</AvatarFallback>
              </Avatar>
              <span className="max-w-full truncate px-2 text-xs text-white/80">{name}</span>
            </div>
          )}
        </>
      )}
      <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white">
        {isLocal && <span className="rounded bg-white/20 px-1 font-medium">You</span>}
        <span className="max-w-24 truncate">{name}</span>
      </div>
      {!videoEnabled && isLocal && hasVideo && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-xs text-white/70">camera off</div>
      )}
    </div>
  );
}

/* ==================== GROUP CALL OVERLAY ==================== */

export function GroupCallOverlay() {
  const me = useChatApp((s) => s.me);
  const call = useGroupCallStore((s) => s.call);
  const participants = useGroupCallStore((s) => s.participants);
  const micEnabled = useGroupCallStore((s) => s.micEnabled);
  const camEnabled = useGroupCallStore((s) => s.camEnabled);
  const localStream = useGroupCallStore((s) => s.localStream);
  const startedAt = useGroupCallStore((s) => s.startedAt);
  const recording = useGroupCallStore((s) => s.recording);
  const lang = useAppLang();
  const tr = (key: string) => t(lang, key);

  /* Local stream also needs an audio sink for remote viewers — handled per tile.
     Leave the call when the component unmounts unexpectedly (safety net). */
  useEffect(() => {
    return () => {
      /* do NOT auto-leave on unmount — overlay stays mounted for the whole call */
    };
  }, []);

  if (!call || !me) return null;

  const others = Object.values(participants);

  return (
    <div className="fixed inset-0 z-300 flex flex-col bg-zinc-950 text-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-medium">
            <Users className="size-4 shrink-0" />
            <span className="truncate">{call.groupName}</span>
          </div>
          <div className="text-xs text-white/60">
            {call.status === "ringing" ? tr("gcall.waiting") : call.status === "connecting" ? tr("gcall.connecting") : <Duration startedAt={startedAt} />}
            {" · "}
            {others.length + 1} {tr("gcall.participants")}
            {recording && <span className="ml-2 inline-flex items-center gap-1 text-red-400"><Circle className="size-2.5 fill-current" />{tr("gcall.recording")}</span>}
          </div>
        </div>
      </div>

      {/* Participant grid */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className={cn("grid gap-3", others.length <= 1 ? "grid-cols-1 max-w-2xl mx-auto" : others.length <= 3 ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3")}>
          <ParticipantTile name={me.name || "You"} stream={localStream} isLocal videoEnabled={camEnabled} />
          {others.map((p) => (
            <ParticipantTile key={p.uid} name={p.name} stream={p.stream} isLocal={false} videoEnabled />
          ))}
        </div>
        {others.length === 0 && (
          <div className="mt-6 text-center text-sm text-white/50">{tr("gcall.nobodyYet")}</div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-4 border-t border-white/10 px-4 py-5">
        <Button
          variant="secondary"
          size="icon"
          aria-label={micEnabled ? "Mute mic" : "Unmute mic"}
          className={cn("rounded-full", !micEnabled && "bg-red-500/90 text-white hover:bg-red-500")}
          onClick={async () => {
            const { toggleGroupMic } = await import("../_lib/group-webrtc");
            toggleGroupMic();
          }}
        >
          {micEnabled ? <Mic /> : <MicOff />}
        </Button>
        {call.type === "video" && (
          <Button
            variant="secondary"
            size="icon"
            aria-label={camEnabled ? "Turn camera off" : "Turn camera on"}
            className={cn("rounded-full", !camEnabled && "bg-red-500/90 text-white hover:bg-red-500")}
            onClick={async () => {
              const { toggleGroupCam } = await import("../_lib/group-webrtc");
              toggleGroupCam();
            }}
          >
            {camEnabled ? <Video /> : <VideoOff />}
          </Button>
        )}
        <Button
          variant="secondary"
          size="icon"
          aria-label={recording ? "Stop recording" : "Record call"}
          className={cn("rounded-full", recording && "bg-red-500/90 text-white hover:bg-red-500")}
          onClick={() => {
            if (recording) {
              stopGroupCallRecording();
              toast.success(tr("gcall.recSaved"));
            } else {
              startGroupCallRecording();
              toast.info(tr("gcall.recStarted"));
            }
          }}
        >
          <Circle className={cn(recording && "fill-current")} />
        </Button>
        <Button
          variant="destructive"
          size="icon"
          aria-label="Leave call"
          className="rounded-full"
          onClick={() => leaveGroupCall()}
        >
          <PhoneOff />
        </Button>
      </div>
    </div>
  );
}

/* ==================== INCOMING GROUP CALL DIALOG ==================== */

export function IncomingGroupCallDialog() {
  const me = useChatApp((s) => s.me);
  const incoming = useChatApp((s) => s.incomingGroupCall);
  const activeCall = useGroupCallStore((s) => s.call);
  const lang = useAppLang();
  const tr = (key: string) => t(lang, key);
  const lastGidRef = useRef<string | null>(null);

  /* Ringtone — group calls previously rang silently. */
  useEffect(() => {
    if (incoming && !activeCall) {
      startIncomingRingtone();
    } else {
      stopRingbackTone();
    }
    return () => stopRingbackTone();
  }, [incoming, activeCall]);

  /* Close the OS notification once the invite disappears (call ended /
     joined / declined). */
  useEffect(() => {
    if (incoming?.gid) {
      lastGidRef.current = incoming.gid;
    } else if (lastGidRef.current) {
      closeNotificationsByTag(groupCallTag(lastGidRef.current));
      lastGidRef.current = null;
    }
  }, [incoming]);

  /* OS notification while the tab is hidden so the invite is not missed. */
  useEffect(() => {
    if (!incoming || activeCall) return;
    const callNotif = me?.settings?.notifications?.callNotif !== false;
    if (!callNotif || useChatApp.getState().pinLocked) return;

    const notify = () => {
      if (document.visibilityState === "visible") return;
      showOsNotification({
        title: `${tr("gcall.notifTitle")} — ${incoming.groupName}`,
        body: `${incoming.initiatorName} · ${incoming.type === "video" ? tr("gcall.videoCall") : tr("gcall.audioCall")}`,
        tag: groupCallTag(incoming.gid),
        requireInteraction: true,
        vibrate: [300, 150, 300],
        actions: [{ action: "join", title: tr("gcall.join") }],
        data: { gid: incoming.gid, url: `/?gcall=${incoming.gid}&action=join` },
      });
    };
    notify();
    document.addEventListener("visibilitychange", notify);
    return () => document.removeEventListener("visibilitychange", notify);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming?.gid, activeCall, me?.settings?.notifications?.callNotif]);

  if (!incoming || !me || activeCall) return null;

  return (
    <div className="fixed inset-0 z-350 flex items-center justify-center bg-black/70 p-6">
      <div className="w-full max-w-xs rounded-2xl border bg-background p-6 text-center text-foreground shadow-xl">
        <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-primary/10">
          <Users className="size-8 text-primary" />
        </div>
        <div className="font-medium">{incoming.groupName}</div>
        <div className="text-muted-foreground mt-1 text-sm">
          {incoming.initiatorName} · {incoming.type === "video" ? tr("gcall.videoCall") : tr("gcall.audioCall")}
        </div>
        <div className="text-muted-foreground mt-3 text-xs">{tr("gcall.invitingYou")}</div>
        <div className="mt-5 flex gap-3">
          <Button
            variant="destructive"
            className="flex-1"
            onClick={async () => {
              await declineGroupCall(incoming.gid);
              useChatApp.setState({ incomingGroupCall: null });
            }}
          >
            <PhoneOff className="size-4" /> {tr("gcall.decline")}
          </Button>
          <Button
            className="flex-1"
            onClick={() => {
              joinGroupCall(incoming.gid, incoming.groupName, me.uid, me.name || "You");
              useChatApp.setState({ incomingGroupCall: null });
            }}
          >
            {incoming.type === "video" ? <Video className="size-4" /> : <Mic className="size-4" />}
            {tr("gcall.join")}
          </Button>
        </div>
      </div>
    </div>
  );
}
