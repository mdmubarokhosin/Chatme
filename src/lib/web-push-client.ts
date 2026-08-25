"use client";

/**
 * ChatBD — Direct Web Push sender (browser → browser, no server required).
 *
 * Cloud Functions (functions/) can deliver pushes server-side, but they need
 * the Firebase Blaze (pay-as-you-go) plan. This module removes that blocker:
 * the SENDER's browser talks the standard Web Push protocol itself —
 *
 *   - payload encrypted end-to-end for the receiver's subscription keys
 *     (RFC 8291, "aes128gcm" content coding — a faithful port of the
 *     battle-tested http_ece reference implementation), and
 *   - authenticated with the project's VAPID key pair (RFC 8292, ES256 JWT).
 *
 * The receiver's service worker (public/sw.js) turns those pushes into the
 * same rich notifications the FCM path produces. Everything degrades
 * silently: if a step fails, calls/messages keep working exactly as before.
 *
 * Subscriptions are stored at `users/{uid}/pushSubs/{key}` = {
 *   endpoint, p256dh, auth, ua, updatedAt
 * } — separate from `fcmTokens` (used by the Cloud Functions path), so both
 * delivery channels can coexist; identical notification tags make them
 * de-duplicate naturally.
 */

import { APP_CONFIG } from "@/config/app-config";
import { db } from "@/lib/firebase";

/* ==================== byte / base64url helpers ==================== */

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** ArrayBuffer copy of a view — keeps Web Crypto typings happy everywhere. */
function buf(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = norm.length % 4 === 0 ? "" : "=".repeat(4 - (norm.length % 4));
  const bin = atob(norm + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function be32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
}

/* ==================== HMAC / HKDF (RFC 5869) ==================== */

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", buf(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, buf(data)));
}

/** HKDF-Expand (RFC 5869 §2.3) — mirrors http_ece's implementation exactly. */
async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const blocks: Uint8Array[] = [];
  let t: Uint8Array = new Uint8Array(0);
  let total = 0;
  let counter = 1;
  while (total < length) {
    t = await hmac(prk, concat(t, info, new Uint8Array([counter])));
    blocks.push(t);
    total += t.length;
    counter++;
  }
  return concat(...blocks).slice(0, length);
}

/* ==================== RFC 8291 payload encryption (aes128gcm) ==================== */

export type PushSubscriptionInfo = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

const MAX_PAYLOAD_BYTES = 3000; // single-record aes128gcm limit is 4079 — stay well under

/**
 * Encrypt `json` for the receiver's subscription keys.
 * Body layout: salt(16) ‖ rs(4,=4096) ‖ keyidLen(1,=65) ‖ ephPublicKey(65) ‖ ciphertext(+16B GCM tag)
 * Plaintext: payload ‖ 0x02 (last-record padding delimiter).
 */
async function encryptPayload(sub: PushSubscriptionInfo, json: string): Promise<Uint8Array> {
  const uaPublic = b64urlDecode(sub.p256dh);
  const authSecret = b64urlDecode(sub.auth);
  if (uaPublic.length !== 65) throw new Error("p256dh must be 65 bytes");
  if (authSecret.length < 16) throw new Error("auth must be ≥16 bytes");
  if (utf8(json).length > MAX_PAYLOAD_BYTES) throw new Error("payload too large");

  // Ephemeral "application server" ECDH key pair for this message
  const eph = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const senderPublic = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey));

  const uaKey = await crypto.subtle.importKey("raw", buf(uaPublic), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, eph.privateKey, 256));

  // secret = HKDF(authSecret, ecdh, "WebPush: info\0" ‖ uaPublic ‖ senderPublic, 32)
  const ikm = await hmac(authSecret, ecdhSecret); // HKDF-Extract
  const secret = await hkdfExpand(ikm, concat(utf8("WebPush: info\0"), uaPublic, senderPublic), 32);

  // CEK/nonce = HKDF-Expand(HMAC(salt, secret), "Content-Encoding: …\0", …)
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, secret);
  const cek = await hkdfExpand(prk, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfExpand(prk, utf8("Content-Encoding: nonce\0"), 12);

  // Single record, counter 0 → nonce used as-is; plaintext ends with 0x02 delimiter
  const plaintext = concat(utf8(json), new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey("raw", buf(cek), { name: "AES-GCM" }, false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: buf(nonce), tagLength: 128 }, aesKey, buf(plaintext))
  );

  return concat(salt, be32(4096), new Uint8Array([65]), senderPublic, ciphertext);
}

/* ==================== VAPID (RFC 8292) — ES256 JWT ==================== */

let vapidCache: { pub: Uint8Array; priv: CryptoKey } | null = null;

async function getVapidKeys(): Promise<{ pub: Uint8Array; priv: CryptoKey }> {
  if (vapidCache) return vapidCache;
  const pub = b64urlDecode(APP_CONFIG.push.vapidPublicKey);
  const d = b64urlDecode(APP_CONFIG.push.vapidPrivateKey);
  if (pub.length !== 65 || d.length !== 32) throw new Error("invalid VAPID keys");
  // P-256 point → JWK (x ‖ y from the uncompressed 0x04-prefixed public key)
  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: b64url(pub.slice(1, 33)),
    y: b64url(pub.slice(33, 65)),
    d: b64url(d),
  };
  const priv = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  vapidCache = { pub, priv };
  return vapidCache;
}

async function vapidAuthorization(audience: string): Promise<string> {
  const { priv } = await getVapidKeys();
  const header = b64url(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = b64url(
    utf8(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
        sub: "mailto:support@chatbd.app",
      })
    )
  );
  const input = `${header}.${payload}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, priv, buf(utf8(input))));
  return `vapid t=${input}.${b64url(sig)}, k=${APP_CONFIG.push.vapidPublicKey}`;
}

/* ==================== sending ==================== */

export type PushData = Record<string, string | number | undefined>;

/** Stable, RTDB-safe key for an endpoint URL (djb2-xor-33 → base36). */
export function subKeyFor(endpoint: string): string {
  let h = 5381;
  for (let i = 0; i < endpoint.length; i++) h = ((h * 33) ^ endpoint.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

async function sendToSubscription(sub: PushSubscriptionInfo, data: PushData): Promise<"ok" | "dead" | "fail"> {
  try {
    const body = await encryptPayload(sub, JSON.stringify(data));
    const res = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        TTL: "60",
        Urgency: "high",
        "Content-Type": "application/octet-stream",
        "Content-Encoding": "aes128gcm",
        Authorization: await vapidAuthorization(new URL(sub.endpoint).origin),
      },
      body: new Blob([buf(body)]),
    });
    if (res.status === 404 || res.status === 410) return "dead";
    return res.ok ? "ok" : "fail";
  } catch {
    return "fail";
  }
}

/**
 * Send a direct web push to every registered device of `uid`.
 * Never throws — call freely from call/message flows.
 */
export async function pushToUser(uid: string, data: PushData): Promise<void> {
  if (!uid || !APP_CONFIG.push.vapidPrivateKey || typeof window === "undefined") return;
  try {
    const snap = await db.ref(`users/${uid}/pushSubs`).once("value");
    const subs = (snap.val() || {}) as Record<string, PushSubscriptionInfo>;
    await Promise.all(
      Object.entries(subs).map(async ([key, sub]) => {
        if (!sub?.endpoint || !sub.p256dh || !sub.auth) return;
        if (subKeyFor(sub.endpoint) !== key) return; // corrupted entry — skip
        const result = await sendToSubscription(sub, data);
        if (result === "dead") {
          await db.ref(`users/${uid}/pushSubs/${key}`).remove().catch(() => {});
        }
      })
    );
  } catch {
    /* push is best-effort — never break the calling flow */
  }
}

/** Fire-and-forget variant for hot paths (call start, message send). */
export function pushToUserSafe(uid: string, data: PushData): void {
  try {
    void pushToUser(uid, data).catch(() => {});
  } catch {
    /* ignore */
  }
}

/* ==================== subscription registration ==================== */

const SUB_UID_KEY = "chatbd-pushsub-uid";
const SUB_KEY_KEY = "chatbd-pushsub-key";

/**
 * Persist this browser's raw push subscription (endpoint + encryption keys)
 * under the signed-in user, so peers' browsers can push to it directly.
 * Called from the FCM token registration flow — the underlying subscription
 * is the same one FCM uses.
 */
export async function savePushSubscription(uid: string): Promise<void> {
  try {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    const registration = await navigator.serviceWorker.ready;
    const sub = await registration.pushManager.getSubscription();
    if (!sub) return;
    const p256dh = sub.getKey("p256dh");
    const auth = sub.getKey("auth");
    if (!p256dh || !auth) return;
    const key = subKeyFor(sub.endpoint);
    await db
      .ref(`users/${uid}/pushSubs/${key}`)
      .set({
        endpoint: sub.endpoint,
        p256dh: b64url(new Uint8Array(p256dh)),
        auth: b64url(new Uint8Array(auth)),
        ua: (navigator.userAgent || "").slice(0, 120),
        updatedAt: Date.now(),
      })
      .catch(() => {});
    localStorage.setItem(SUB_UID_KEY, uid);
    localStorage.setItem(SUB_KEY_KEY, key);
  } catch {
    /* ignore */
  }
}

/** Remove this browser's direct-push entry (called on logout). */
export async function removePushSubscription(): Promise<void> {
  try {
    const uid = localStorage.getItem(SUB_UID_KEY);
    const key = localStorage.getItem(SUB_KEY_KEY);
    if (uid && key) {
      await db.ref(`users/${uid}/pushSubs/${key}`).remove().catch(() => {});
    }
    localStorage.removeItem(SUB_UID_KEY);
    localStorage.removeItem(SUB_KEY_KEY);
  } catch {
    /* ignore */
  }
}

/* ==================== test-only exports (verified against http_ece) ==================== */

export async function __encryptForTest(sub: PushSubscriptionInfo, json: string): Promise<Uint8Array> {
  return encryptPayload(sub, json);
}

export async function __vapidForTest(origin: string): Promise<string> {
  return vapidAuthorization(origin);
}
