"use client";

/**
 * OS notifications through the service-worker registration.
 *
 * Why not `new Notification()`? On Android Chrome (and some other browsers)
 * the constructor THROWS on pages controlled by a service worker — the only
 * reliable cross-platform path is `registration.showNotification()`.
 * This module wraps that with a graceful fallback for browsers without a SW.
 *
 * Notifications created here carry `data.__chatbd = true` so the service
 * worker's `notificationclick` handler can recognize and route them.
 */

let cachedRegistration: ServiceWorkerRegistration | null = null;

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (cachedRegistration) return cachedRegistration;
  try {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      cachedRegistration = (await navigator.serviceWorker.ready) || null;
    }
  } catch {
    cachedRegistration = null;
  }
  return cachedRegistration;
}

export async function notificationPermissionGranted(): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch {
      /* ignore */
    }
  }
  /* Cast: TS keeps the pre-await narrowing on Notification.permission even
   * though requestPermission() may have changed it. */
  return (Notification.permission as string) === "granted";
}

export type OsNotificationOptions = {
  title: string;
  body?: string;
  tag?: string;
  icon?: string;
  requireInteraction?: boolean;
  /** Chrome only — re-alerts (sound + vibration) when replaced by the same tag. */
  renotify?: boolean;
  silent?: boolean;
  vibrate?: number[];
  data?: Record<string, unknown>;
  actions?: Array<{ action: string; title: string; icon?: string }>;
};

export async function showOsNotification(opts: OsNotificationOptions): Promise<void> {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const options: NotificationOptions & { vibrate?: number[]; renotify?: boolean; actions?: Array<{ action: string; title: string }> } = {
    body: opts.body,
    tag: opts.tag,
    icon: opts.icon || "/icon-192.png",
    badge: "/icon-192.png",
    data: { ...(opts.data || {}), __chatbd: true },
    requireInteraction: opts.requireInteraction,
    silent: opts.silent,
  };
  if (opts.renotify !== undefined) options.renotify = opts.renotify;
  if (opts.vibrate) options.vibrate = opts.vibrate;
  if (opts.actions && opts.actions.length > 0) options.actions = opts.actions;

  try {
    const reg = await getRegistration();
    if (reg) {
      await reg.showNotification(opts.title, options);
      return;
    }
  } catch {
    /* fall through to the constructor */
  }
  try {
    const n = new Notification(opts.title, options as NotificationOptions);
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* notifications unavailable — ignore */
  }
}

/** Close every open notification with the given tag. */
export async function closeNotificationsByTag(tag: string): Promise<void> {
  try {
    const reg = await getRegistration();
    if (!reg) return;
    const list = await reg.getNotifications({ tag });
    list.forEach((n) => n.close());
  } catch {
    /* ignore */
  }
}

/** Stable notification tags — the service worker closes/replaces by these. */
export const callTag = (callKey: string) => `chatbd-call-${callKey}`;
export const groupCallTag = (gid: string) => `chatbd-gcall-${gid}`;
