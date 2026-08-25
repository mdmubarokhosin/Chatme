/* ChatBD service worker v17 — offline shell + FCM + DIRECT web push.
 *
 * 1. Caching (unchanged behaviour): cache-first for hashed static assets,
 *    network-first with cache fallback for pages (offline shell).
 * 2. FCM: data-only pushes sent by functions/ are turned into rich
 *    notifications (incoming call with Accept/Decline actions, group-call
 *    invite with Join, new-message alerts) and closed automatically when the
 *    call ends.
 * 3. DIRECT web push (no server needed): pushes sent straight from another
 *    user's browser (src/lib/web-push-client.ts) are handled by the same
 *    notification logic — enabling incoming-call notifications even when
 *    Cloud Functions are NOT deployed (no Blaze plan required).
 * 4. notificationclick: routes Accept / Decline / Join / plain taps into the
 *    app — via postMessage when a window is already open, or by opening a
 *    deep-link URL (?call=KEY&action=accept …) when the app was closed.
 */
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");

const CACHE = "chatbd-v17";
const PRECACHE = ["/", "/manifest.json", "/icon-192.png", "/icon-512.png"];

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDCblCe2kdTlgrn8VfCW9G0-FWZPf80_CE",
  authDomain: "chatme-7db5f.firebaseapp.com",
  databaseURL: "https://chatme-7db5f-default-rtdb.firebaseio.com",
  projectId: "chatme-7db5f",
  storageBucket: "chatme-7db5f.firebasestorage.app",
  messagingSenderId: "642758940438",
  appId: "1:642758940438:web:c6221048ad49f0e4e62237",
  measurementId: "G-TRW9D68GGJ",
};

firebase.initializeApp(FIREBASE_CONFIG);

let messaging = null;
try {
  if (firebase.messaging && firebase.messaging.isSupported && firebase.messaging.isSupported()) {
    messaging = firebase.messaging();
  }
} catch (e) {
  messaging = null;
}

/* ==================== DIRECT WEB PUSH (no server / no Blaze plan) ====================
 * src/lib/web-push-client.ts sends RFC 8030 pushes straight from the caller's
 * browser to this device's push endpoint. This listener is registered BEFORE
 * the FCM SDK's own listener so our payloads render exactly like FCM-delivered
 * pushes. A notification is shown only when NO app window is open — an open
 * window (even a hidden tab) already rings / updates via its realtime
 * listeners and in-app notification logic.
 */
self.addEventListener("push", (event) => {
  let d = null;
  try {
    const j = event.data ? event.data.json() : null;
    if (j && typeof j === "object") d = j.data && typeof j.data === "object" ? j.data : j;
  } catch (e) {
    d = null;
  }
  if (!d || !d.type) return; // not a ChatBD data message — let the FCM SDK handle it
  event.stopImmediatePropagation();
  event.waitUntil(
    (async () => {
      let windows = [];
      try {
        windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      } catch (e) {
        /* ignore */
      }
      const appOpen = windows.some((c) => c.url && c.url.indexOf(self.location.origin) === 0);
      // With the app open, its realtime listeners + own notifications already
      // cover incoming-call / group-call / new-message. Only call-ended is still
      // processed (it just closes any lingering notification, and the
      // missed-call notice is left to the open page).
      if (appOpen && d.type !== "call-ended" && d.type !== "group-call-ended") return;
      await handleDataMessage(d, { quiet: !!appOpen });
    })()
  );
});

/* ==================== INSTALL / ACTIVATE / FETCH (PWA shell) ==================== */

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // let GitHub API / Firebase pass through

  // Static assets → cache-first
  if (
    url.pathname.startsWith("/_next/static") ||
    /\.(png|svg|jpg|jpeg|webp|ico|woff2?)$/.test(url.pathname) ||
    url.pathname === "/manifest.json"
  ) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((resp) => {
            const copy = resp.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
            return resp;
          })
      )
    );
    return;
  }

  // Pages → network-first with cache fallback (offline shell)
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return resp;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match("/")))
    );
  }
});

/* ==================== FCM BACKGROUND MESSAGES ==================== */

function closeByTag(tag) {
  return self.registration
    .getNotifications({ tag })
    .then((list) => list.forEach((n) => n.close()))
    .catch(() => {});
}

async function handleDataMessage(d, opts) {
  const type = d && d.type;
  const quiet = !!(opts && opts.quiet); // app window open — page shows its own notices

  if (type === "incoming-call" && d.callKey) {
    const isVideo = d.callType === "video";
    await self.registration.showNotification(
      (isVideo ? "Incoming video call" : "Incoming call") + " — " + (d.callerName || "Unknown"),
      {
        body: "Tap to answer",
        tag: "chatbd-call-" + d.callKey,
        requireInteraction: true,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        vibrate: [300, 150, 300, 150, 300],
        actions: [
          { action: "accept", title: "Accept" },
          { action: "decline", title: "Decline" },
        ],
        data: { callKey: d.callKey, url: "/?call=" + d.callKey },
      }
    );
  } else if (type === "call-ended" && d.callKey) {
    await closeByTag("chatbd-call-" + d.callKey);
    if ((d.status === "missed" || d.status === "busy") && !quiet) {
      await self.registration.showNotification("Missed call — " + (d.callerName || "Unknown"), {
        body: d.status === "busy" ? "You were on another call" : "You did not answer",
        tag: "chatbd-missed-" + d.callKey,
        icon: "/icon-192.png",
        data: { url: "/" },
      });
    }
  } else if (type === "incoming-group-call" && d.gid) {
    await self.registration.showNotification("Group call — " + (d.groupName || "Group"), {
      body: (d.initiatorName || "Someone") + " is calling the group",
      tag: "chatbd-gcall-" + d.gid,
      requireInteraction: true,
      icon: "/icon-192.png",
      vibrate: [300, 150, 300],
      actions: [{ action: "join", title: "Join" }],
      data: { gid: d.gid, url: "/?gcall=" + d.gid + "&action=join" },
    });
  } else if (type === "group-call-ended" && d.gid) {
    await closeByTag("chatbd-gcall-" + d.gid);
  } else if (type === "new-message") {
    await self.registration.showNotification(d.senderName || "New message", {
      body: d.preview || "You have a new message",
      tag: "chatbd-msg-" + (d.chatId || "unknown"),
      icon: "/icon-192.png",
      data: { url: d.chatUrl || "/" },
    });
  }
}

if (messaging) {
  messaging.onBackgroundMessage((payload) => {
    const d = (payload && payload.data) || {};
    return handleDataMessage(d);
  });
}

/* ==================== NOTIFICATION CLICKS ==================== */

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const action = event.action;

  let url = data.url || "/";
  if (action === "accept" && data.callKey) url = "/?call=" + data.callKey + "&action=accept";
  else if (action === "decline" && data.callKey) url = "/?call=" + data.callKey + "&action=decline";
  else if (action === "join" && data.gid) url = "/?gcall=" + data.gid + "&action=join";

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clientList) {
        try {
          if (client.url && client.url.startsWith(self.location.origin)) {
            await client.focus();
            if (client.postMessage) {
              client.postMessage({ type: "chatbd-navigate", url });
            }
            return;
          }
        } catch (e) {
          /* try the next client */
        }
      }
      await self.clients.openWindow(url);
    })()
  );
});
