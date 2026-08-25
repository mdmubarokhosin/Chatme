"use client";

/**
 * Active WebRTC call overlay — audio/video with:
 *   mic/cam toggles + camera switch + timer + ringtone hooks.
 */
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Monitor, Mic, MicOff, Phone, RefreshCw, Video, VideoOff, Circle } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn, getInitials } from "@/lib/utils";
import { formatVoiceTime } from "@/lib/format";

import {
  acceptIncomingCall,
  declineIncomingCall,
  endCall,
  listenForIncomingCalls,
  startCallRecording,
  stopCallRecording,
  startIncomingRingtone,
  startRingbackTone,
  stopRingbackTone,
  switchCamera,
  toggleCam,
  toggleMic,
  toggleScreenShare,
  useCallStore,
} from "../_lib/webrtc";
import { useChatApp, useAppLang } from "../_lib/store";
import { t } from "@/lib/i18n";
import { callTag, closeNotificationsByTag, showOsNotification } from "@/lib/notify";

export function CallOverlay() {
  const call = useCallStore((s) => s.activeCall);
  const micEnabled = useCallStore((s) => s.micEnabled);
  const camEnabled = useCallStore((s) => s.camEnabled);
  const screenSharing = useCallStore((s) => s.screenSharing);
  const facingMode = useCallStore((s) => s.facingMode);
  const remoteStream = useCallStore((s) => s.remoteStream);
  const localStream = useCallStore((s) => s.localStream);
  const callStartAt = useCallStore((s) => s.callStartAt);
  const recording = useCallStore((s) => s.recording);

  const [elapsed, setElapsed] = useState(0);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const lang = useAppLang();
  const tr = (key: string) => t(lang, key);

  useEffect(() => {
    if (!callStartAt) return;
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - callStartAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [callStartAt]);

  /*
   * THE audio path for every call (audio AND video).
   * A dedicated <audio> element is always mounted and gets the remote stream.
   * The remote <video> element is muted on purpose so sound comes from exactly
   * one sink — muted video autoplay is always allowed by browsers, while
   * unmuted autoplay is frequently blocked, which used to freeze both audio
   * and video.
   */
  useEffect(() => {
    const el = remoteAudioRef.current;
    if (!el || !remoteStream) return;
    if (el.srcObject !== remoteStream) el.srcObject = remoteStream;
    el.volume = 1;
    setAudioBlocked(false);

    const tryPlay = () => {
      // Ignore if the call already ended / stream replaced
      if (el.srcObject !== remoteStream) return;
      el.play()
        .then(() => setAudioBlocked(false))
        .catch(() => {
          // Autoplay policy blocked us — retry on the next user interaction.
          setAudioBlocked(true);
        });
    };
    tryPlay();

    const onCanPlay = () => tryPlay();
    el.addEventListener("canplay", onCanPlay);
    el.addEventListener("loadedmetadata", onCanPlay);

    // Unlock on ANY user gesture while the call is up (tap unmute, end call, etc.)
    const unlock = () => {
      if (el.paused) tryPlay();
    };
    window.addEventListener("click", unlock);
    window.addEventListener("touchstart", unlock, { passive: true });
    window.addEventListener("keydown", unlock);

    return () => {
      el.removeEventListener("canplay", onCanPlay);
      el.removeEventListener("loadedmetadata", onCanPlay);
      window.removeEventListener("click", unlock);
      window.removeEventListener("touchstart", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [remoteStream, call?.callKey]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
      // Muted autoplay always works; audio is played by the <audio> element.
      remoteVideoRef.current.play().catch(() => {});
    }
  }, [remoteStream]);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // Mirror local preview horizontally when using front camera (selfie convention)
  const localVideoMirror = facingMode === "user" ? "scale-x-[-1]" : "";

  if (!call) return null;

  return (
    <div className="fixed inset-0 z-200 flex flex-col items-center justify-between bg-zinc-950/95 p-6 text-white">
      {/* Always-mounted remote audio sink — THE fix for silent calls.
          Not display:none (some mobile browsers suspend hidden audio). */}
      <audio ref={remoteAudioRef} autoPlay playsInline className="pointer-events-none absolute size-0 opacity-0" />

      {/* Autoplay was blocked — surface a one-tap recovery banner */}
      {audioBlocked && call.status === "connected" && (
        <button
          type="button"
          onClick={() => remoteAudioRef.current?.play().then(() => setAudioBlocked(false)).catch(() => {})}
          className="absolute top-4 left-1/2 z-10 -translate-x-1/2 rounded-full bg-amber-500/90 px-4 py-1.5 text-xs font-medium text-black shadow-lg"
        >
          {tr("call.tapToEnableAudio")}
        </button>
      )}
      <div className="mt-8 flex flex-col items-center gap-3">
        <Avatar size="lg" className="size-20 border-2 border-white/20">
          <AvatarFallback className="bg-white/10 text-xl text-white">{getInitials(call.peerName)}</AvatarFallback>
        </Avatar>
        <div className="text-xl font-semibold">{call.peerName}</div>
        <div className="text-white/70 text-sm">
          {call.status === "ringing"
            ? call.direction === "outgoing"
              ? "Ringing..."
              : "Incoming call"
            : call.status === "connecting"
              ? "Connecting..."
              : formatVoiceTime(elapsed)}
        </div>
        <div className="text-white/50 flex items-center gap-1 text-xs">
          {call.type === "video" ? <Video className="size-3" /> : <Phone className="size-3" />}
          {call.type === "video" ? "Video call" : "Audio call"} · P2P encrypted
          {recording && (
            <span className="ml-1 inline-flex items-center gap-1 text-red-400">
              <Circle className="size-2.5 animate-pulse fill-current" /> REC
            </span>
          )}
        </div>
      </div>

      {call.type === "video" && (
        <div className="relative min-h-0 flex-1 w-full max-w-2xl py-4">
          <video ref={remoteVideoRef} autoPlay playsInline muted className="h-full w-full rounded-xl bg-black object-cover" />
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className={cn(
              "absolute right-3 bottom-3 h-32 w-24 rounded-lg border border-white/20 bg-black object-cover",
              localVideoMirror,
            )}
          />
        </div>
      )}

      {call.type === "audio" && call.status === "connected" && (
        <div className="flex flex-1 items-center justify-center gap-1">
          {[0.4, 0.8, 1.2, 0.8, 0.4, 0.8, 1.2, 0.8, 0.4].map((h, i) => (
            <span
              key={i}
              className="w-1.5 animate-pulse rounded-full bg-white/60"
              style={{ height: `${h * 24}px`, animationDelay: `${i * 0.12}s` }}
            />
          ))}
        </div>
      )}

      <div className="mb-10 flex flex-wrap items-center justify-center gap-4">
        <Button
          size="lg"
          variant="secondary"
          className="size-14 rounded-full"
          aria-label={micEnabled ? "Mute" : "Unmute"}
          onClick={toggleMic}
        >
          {micEnabled ? <Mic className="size-6" /> : <MicOff className="size-6 text-red-500" />}
        </Button>
        <Button
          size="lg"
          variant="secondary"
          className={cn("size-14 rounded-full", recording ? "bg-red-600 text-white hover:bg-red-700" : "")}
          aria-label={recording ? "Stop recording" : "Record call"}
          title={recording ? "Stop recording & save" : "Record call audio"}
          onClick={() => {
            if (recording) {
              stopCallRecording();
              toast.success("Recording saved to your downloads");
            } else {
              startCallRecording();
              toast.info("Call recording started");
            }
          }}
        >
          <Circle className={cn("size-5", recording && "fill-current animate-pulse")} />
        </Button>
        {call.type === "video" && (
          <>
            <Button
              size="lg"
              variant="secondary"
              className="size-14 rounded-full"
              aria-label={camEnabled ? "Turn camera off" : "Turn camera on"}
              onClick={toggleCam}
            >
              {camEnabled ? <Video className="size-6" /> : <VideoOff className="size-6 text-red-500" />}
            </Button>
            <Button
              size="lg"
              variant="secondary"
              className="size-14 rounded-full"
              aria-label="Switch camera"
              onClick={switchCamera}
            >
              <RefreshCw className="size-6" />
            </Button>
            <Button
              size="lg"
              variant="secondary"
              className={cn("size-14 rounded-full", screenSharing && "bg-green-600 text-white hover:bg-green-700")}
              aria-label={screenSharing ? "Stop sharing screen" : "Share screen"}
              onClick={() => toggleScreenShare()}
            >
              <Monitor className="size-6" />
            </Button>
          </>
        )}
        <Button size="lg" className="size-14 rounded-full bg-red-600 hover:bg-red-700" aria-label="End call" onClick={() => endCall()}>
          <Phone className={cn("size-6 rotate-[135deg]")} />
        </Button>
      </div>
    </div>
  );
}

/** Incoming call ringer dialog. */
export function IncomingCallDialog() {
  const [incoming, setIncoming] = useState<{ key: string; callerName: string; type: "audio" | "video" } | null>(null);
  const activeCall = useCallStore((s) => s.activeCall);
  const me = useChatApp((s) => s.me);
  const lang = useAppLang();
  const tr = (key: string) => t(lang, key);
  const lastIncomingKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!me) return;
    // Fires with the ringing call, or null once it stops ringing (caller
    // cancelled / timed out) — which clears this dialog + ringtone.
    const off = listenForIncomingCalls(me.uid, (call) => setIncoming(call));
    return () => off();
  }, [me?.uid]);

  // Start/stop incoming ringtone based on `incoming`
  useEffect(() => {
    if (incoming && !activeCall) {
      startIncomingRingtone();
    } else {
      stopRingbackTone();
    }
    return () => stopRingbackTone();
  }, [incoming, activeCall]);

  // Track the key so we can close its OS notification when the call stops.
  useEffect(() => {
    if (incoming?.key) {
      lastIncomingKeyRef.current = incoming.key;
    } else if (lastIncomingKeyRef.current) {
      closeNotificationsByTag(callTag(lastIncomingKeyRef.current));
      lastIncomingKeyRef.current = null;
    }
  }, [incoming]);

  // OS notification while the tab is hidden — otherwise the ringing dialog
  // is invisible and the call gets missed. Re-armed on visibility change so
  // backgrounding mid-ring also notifies.
  useEffect(() => {
    if (!incoming || activeCall) return;
    const callNotif = me?.settings?.notifications?.callNotif !== false;
    if (!callNotif || useChatApp.getState().pinLocked) return;

    const notify = () => {
      if (document.visibilityState === "visible") return;
      showOsNotification({
        title: `${tr("call.incoming")} — ${incoming.callerName}`,
        body: incoming.type === "video" ? tr("gcall.videoCall") : tr("gcall.audioCall"),
        tag: callTag(incoming.key),
        requireInteraction: true,
        vibrate: [300, 150, 300, 150, 300],
        actions: [
          { action: "accept", title: tr("call.accept") },
          { action: "decline", title: tr("call.decline") },
        ],
        data: { callKey: incoming.key, url: `/?call=${incoming.key}` },
      });
    };
    notify();
    document.addEventListener("visibilitychange", notify);
    return () => document.removeEventListener("visibilitychange", notify);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming?.key, activeCall, me?.settings?.notifications?.callNotif]);

  // Stop ringtone when dialog unmounts
  useEffect(() => () => stopRingbackTone(), []);

  useEffect(() => {
    if (activeCall && incoming) {
      if (activeCall.callKey === incoming.key) setIncoming(null);
    }
  }, [activeCall, incoming]);

  if (!incoming || activeCall || !me) return null;

  return (
    <div className="fixed inset-0 z-300 flex items-center justify-center bg-black/70 p-6">
      <div className="w-full max-w-xs rounded-2xl border bg-background p-6 text-center">
        <Avatar size="lg" className="mx-auto mb-3 size-16">
          <AvatarFallback className="text-lg">{getInitials(incoming.callerName)}</AvatarFallback>
        </Avatar>
        <div className="font-semibold">{incoming.callerName}</div>
        <div className="text-muted-foreground mt-1 mb-5 text-sm">
          Incoming {incoming.type === "video" ? "video" : "audio"} call...
        </div>
        <div className="flex justify-center gap-4">
          <Button
            variant="destructive"
            className="size-12 rounded-full"
            aria-label="Decline"
            onClick={async () => {
              await declineIncomingCall(incoming.key);
              setIncoming(null);
            }}
          >
            <Phone className="size-5 rotate-[135deg]" />
          </Button>
          <Button
            className="size-12 rounded-full bg-green-600 hover:bg-green-700"
            aria-label="Accept"
            onClick={async () => {
              await acceptIncomingCall(me.uid, incoming.key, incoming.callerName, incoming.type);
              setIncoming(null);
            }}
          >
            <Phone className="size-5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
