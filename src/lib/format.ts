"use client";

/** Shared formatting helpers (ported from Chatme, adapted for the new UI). */

export function formatTime(timestamp?: number): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (now.toDateString() === date.toDateString()) {
    return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  return date.toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

export function formatMessageTime(timestamp?: number): string {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatDate(timestamp?: number): string {
  if (!timestamp) return "-";
  return new Date(timestamp).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function formatFileSize(bytes?: number): string {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export function formatCallDuration(startMs?: number, endMs?: number): string {
  if (!startMs || !endMs) return "--";
  const secs = Math.max(0, Math.round((endMs - startMs) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m < 10 ? "0" : ""}${m}:${s < 10 ? "0" : ""}${s}`;
}

export function formatVoiceTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m < 10 ? "0" : ""}${m}:${sec < 10 ? "0" : ""}${sec}`;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return true;
  }
}

/** Compress an image file with canvas (profile pictures etc.). */
export function compressImage(file: File, maxWidth: number, maxHeight: number, quality = 0.7): Promise<Blob | null> {
  return new Promise((resolve) => {
    const canvas = document.createElement("canvas");
    const img = new Image();
    img.onload = () => {
      let w = img.width;
      let h = img.height;
      if (w > maxWidth) {
        h = h * (maxWidth / w);
        w = maxWidth;
      }
      if (h > maxHeight) {
        w = w * (maxHeight / h);
        h = maxHeight;
      }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx?.drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality);
    };
    img.onerror = () => resolve(null);
    img.src = URL.createObjectURL(file);
  });
}
