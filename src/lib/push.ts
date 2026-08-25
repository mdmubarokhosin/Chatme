"use client";

/**
 * FCM web push registration.
 *
 * - Requests an FCM token with the project's VAPID public key and stores it
 *   under `users/{uid}/fcmTokens/{token}` so Cloud Functions (functions/)
 *   can push incoming calls & messages even when the tab is closed.
 * - Attaches a foreground `onMessage` router that clears call notifications
 *   when calls end (the incoming-call dialog itself is driven by the
 *   Realtime-Database listener, which is faster and always authoritative).
 *
 * Everything degrades gracefully: on browsers without web push (e.g. iOS
 * Safari outside an installed PWA) registration is silently skipped.
 */
import { APP_CONFIG } from "@/config/app-config";
import { db, getMessaging } from "@/lib/firebase";
import { callTag, closeNotificationsByTag, groupCallTag } from "@/lib/notify";
import { removePushSubscription, savePushSubscription } from "@/lib/web-push-client";

const TOKEN_KEY = "chatbd-fcm-token";
const UID_KEY = "chatbd-fcm-uid";

let refreshAttached = false;
let routingAttached = false;

/** Register (or rotate) this browser's push token for the signed-in user. */
export async function registerPushToken(uid: string): Promise<void> {
  try {
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("Notification" in window)) return;
    const messaging = getMessaging();
    if (!messaging) return;

    const registration = await navigator.serviceWorker.ready;
    const token = await messaging.getToken({
      vapidKey: APP_CONFIG.push.vapidPublicKey,
      serviceWorkerRegistration: registration,
    });
    if (!token) return;

    const savedUid = localStorage.getItem(UID_KEY);
    const savedToken = localStorage.getItem(TOKEN_KEY);

    // Token rotated, or a different account signed in on this browser —
    // remove the stale entry so pushes stop leaking across accounts.
    if (savedToken && savedToken !== token && savedUid) {
      await db.ref(`users/${savedUid}/fcmTokens/${savedToken}`).remove().catch(() => {});
    }
    if (savedUid && savedUid !== uid) {
      await db.ref(`users/${savedUid}/fcmTokens/${token}`).remove().catch(() => {});
    }

    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(UID_KEY, uid);
    await db.ref(`users/${uid}/fcmTokens/${token}`).set(true).catch(() => {});

    // Also publish the raw push subscription (endpoint + encryption keys) so
    // peers' browsers can deliver pushes DIRECTLY — no Cloud Functions / Blaze
    // plan needed (see src/lib/web-push-client.ts).
    await savePushSubscription(uid).catch(() => {});

    attachTokenRefresh(uid);
    attachForegroundRouting();
  } catch {
    /* Web push unavailable on this browser — the app still works, just without closed-tab pushes. */
  }
}

/** Remove this browser's token (called on logout). */
export async function unregisterPushToken(): Promise<void> {
  try {
    const savedUid = localStorage.getItem(UID_KEY);
    const savedToken = localStorage.getItem(TOKEN_KEY);
    if (savedUid && savedToken) {
      await db.ref(`users/${savedUid}/fcmTokens/${savedToken}`).remove().catch(() => {});
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(UID_KEY);
    // Remove this browser's direct-push subscription as well.
    await removePushSubscription();
  } catch {
    /* ignore */
  }
}

function attachTokenRefresh(uid: string) {
  if (refreshAttached) return;
  refreshAttached = true;
  const messaging = getMessaging();
  if (!messaging) return;
  /* Compat typings dropped onTokenRefresh — it still exists at runtime. */
  const withRefresh = messaging as unknown as { onTokenRefresh?: (cb: () => void) => void };
  if (typeof withRefresh.onTokenRefresh === "function") {
    withRefresh.onTokenRefresh(() => {
      registerPushToken(uid).catch(() => {});
    });
  }
}

/**
 * Foreground pushes. When the page is open (visible OR backgrounded) FCM
 * delivers here instead of the service worker, so the page must do the
 * cleanup the SW would otherwise handle.
 */
export function attachForegroundRouting() {
  if (routingAttached) return;
  routingAttached = true;
  const messaging = getMessaging();
  if (!messaging) return;
  messaging.onMessage((payload) => {
    try {
      const d = (payload?.data || {}) as Record<string, string>;
      if (d.type === "call-ended" && d.callKey) {
        closeNotificationsByTag(callTag(d.callKey));
      } else if (d.type === "group-call-ended" && d.gid) {
        closeNotificationsByTag(groupCallTag(d.gid));
      }
      /* incoming-call / incoming-group-call / new-message are handled by the
       * app's own realtime listeners (IncomingCallDialog, the group-call
       * watcher and listenToChats) — no duplication here. */
    } catch {
      /* ignore */
    }
  });
}
