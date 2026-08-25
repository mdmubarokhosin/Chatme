"use client";

/**
 * QR share dialog — shows a scannable QR of the user's ChatBD ID (#1234).
 * The "Scan" tab uses the BarcodeDetector API where available (Chrome/Edge)
 * to find a friend by pointing the camera at their QR code.
 */
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import QRCode from "qrcode";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";
import { db } from "@/lib/firebase";

import { setActiveChatUser, setView, useChatApp, useAppLang } from "../_lib/store";

export function QrDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useChatApp((s) => s.me);
  const users = useChatApp((s) => s.users);
  const lang = useAppLang();
  const tr = (key: string) => t(lang, key);

  const [tab, setTab] = useState<"show" | "scan">("show");
  const [dataUrl, setDataUrl] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanSupported, setScanSupported] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open || !me?.uniqueId) return;
    QRCode.toDataURL(`chatbd:${me.uniqueId}`, {
      width: 260,
      margin: 2,
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then(setDataUrl)
      .catch(() => {});
  }, [open, me?.uniqueId]);

  /* Camera scanning via BarcodeDetector (progressive enhancement) */
  useEffect(() => {
    if (!open || tab !== "scan") {
      stopScan();
      return;
    }
    startScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab]);

  async function startScan() {
    const Detector = (window as unknown as {
      BarcodeDetector?: new (opts?: { formats?: string[] }) => { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };
    }).BarcodeDetector;
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      setScanSupported(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      const detector = new Detector({ formats: ["qr_code"] });
      setScanning(true);
      const tick = async () => {
        if (!streamRef.current || !videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          const hit = codes.find((c) => c.rawValue?.startsWith("chatbd:"));
          if (hit) {
            const id = hit.rawValue.slice(7).trim();
            handleFoundId(id);
            return;
          }
        } catch {
          /* keep scanning */
        }
        rafRef.current = requestAnimationFrame(() => setTimeout(tick, 250));
      };
      tick();
    } catch {
      setScanSupported(false);
    }
  }

  function stopScan() {
    setScanning(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }

  function handleFoundId(id: string) {
    stopScan();
    if (!me) return;
    // Find the user with this uniqueId in the loaded users map
    const found = Object.entries(users).find(([, u]) => String(u.uniqueId ?? "") === id);
    if (!found) {
      toast.error(tr("qr.notFound"));
      return;
    }
    onClose();
    setActiveChatUser(found[0]);
    setView("inbox");
    toast.success(`${found[1].name || "User"} (#${id})`);
  }

  useEffect(() => {
    return () => stopScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!open || !me) return null;

  return (
    <div className="fixed inset-0 z-100 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6" onClick={onClose}>
      <div className="w-full max-w-sm overflow-hidden rounded-t-xl border bg-background sm:rounded-xl" onClick={(e) => e.stopPropagation()}>
        {/* Tabs */}
        <div className="flex gap-1 border-b px-2">
          {(["show", "scan"] as const).map((id) => (
            <button
              key={id}
              type="button"
              className={cn(
                "border-b-2 px-3 py-2 text-sm transition-colors",
                tab === id ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setTab(id)}
            >
              {id === "show" ? tr("qr.title") : tr("qr.scan")}
            </button>
          ))}
          <Button variant="ghost" size="icon-sm" aria-label={tr("common.close")} className="ml-auto my-1" onClick={onClose}>
            ✕
          </Button>
        </div>

        {tab === "show" ? (
          <div className="flex flex-col items-center gap-4 p-6">
            {dataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={dataUrl} alt={`ChatBD QR #${me.uniqueId}`} className="size-64 rounded-xl border bg-white p-2" />
            ) : (
              <div className="grid size-64 place-items-center rounded-xl border text-sm text-muted-foreground">...</div>
            )}
            <div className="text-center">
              <div className="text-2xl font-bold tracking-[0.2em] text-primary">#{me.uniqueId || "????"}</div>
              <p className="text-muted-foreground mt-1 text-xs leading-relaxed">{tr("qr.desc")}</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 p-6">
            {scanSupported ? (
              <>
                <div className="relative w-full overflow-hidden rounded-xl border bg-black">
                  <video ref={videoRef} className="aspect-square w-full object-cover" muted playsInline />
                  <div className="pointer-events-none absolute inset-8 rounded-xl border-2 border-white/70" />
                </div>
                <p className="text-muted-foreground text-xs">{scanning ? tr("qr.scanHint") : "..."}</p>
              </>
            ) : (
              <div className="py-10 text-center text-sm text-muted-foreground">{tr("qr.scanUnsupported")}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
