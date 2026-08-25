"use client";

/**
 * ChatBD — Firebase client (compat SDK, identical API surface to the original
 * Shohayok Messenger / Chatme app so every feature ports 1:1).
 */
import firebase from "firebase/compat/app";
import "firebase/compat/auth";
import "firebase/compat/database";
import "firebase/compat/messaging";

export const firebaseConfig = {
  apiKey: "AIzaSyDCblCe2kdTlgrn8VfCW9G0-FWZPf80_CE",
  authDomain: "chatme-7db5f.firebaseapp.com",
  databaseURL: "https://chatme-7db5f-default-rtdb.firebaseio.com",
  projectId: "chatme-7db5f",
  storageBucket: "chatme-7db5f.firebasestorage.app",
  messagingSenderId: "642758940438",
  appId: "1:642758940438:web:c6221048ad49f0e4e62237",
  measurementId: "G-TRW9D68GGJ",
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

export const app = firebase.app();
export const auth = firebase.auth();
export const db = firebase.database();

/** Lazy FCM messaging instance (null when web push is unsupported, e.g. iOS Safari outside an installed PWA). */
export function getMessaging(): firebase.messaging.Messaging | null {
  try {
    if (typeof firebase.messaging.isSupported === "function" && !firebase.messaging.isSupported()) return null;
    return firebase.messaging();
  } catch {
    return null;
  }
}

export type FirebaseUser = firebase.User;
export const serverTimestamp = firebase.database.ServerValue.TIMESTAMP;

/** Deterministic chat id between two users (sorted uids). */
export function generateChatId(uid1: string, uid2: string): string {
  return uid1 < uid2 ? `${uid1}_${uid2}` : `${uid2}_${uid1}`;
}

/** Generate an unused 4-digit unique id (same algorithm as the original app). */
export async function generateUniqueId(): Promise<string> {
  const uniqueIdsRef = db.ref("uniqueIds");
  let id = "";
  let exists = true;
  let attempts = 0;
  while (exists && attempts < 100) {
    id = String(Math.floor(1000 + Math.random() * 9000));
    const snapshot = await uniqueIdsRef.child(id).once("value");
    exists = snapshot.exists();
    attempts++;
  }
  if (!id) throw new Error("Could not generate a unique ID");
  return id;
}

/** Deterministic avatar color class (mirrors original getAvatarColor buckets). */
export const AVATAR_COLORS = [
  "bg-red-500/80",
  "bg-orange-500/80",
  "bg-amber-500/80",
  "bg-green-600/80",
  "bg-teal-500/80",
  "bg-blue-500/80",
  "bg-violet-500/80",
  "bg-pink-500/80",
] as const;

export function getAvatarColor(uid: string): string {
  let hash = 0;
  for (let i = 0; i < (uid || "").length; i++) {
    hash = uid.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/** Fire-and-forget activity log entry (admin panel reads `activityLogs`). */
export function logActivity(action: string, details: string, user?: { uid: string; name?: string }) {
  if (!user?.uid) return;
  db.ref("activityLogs")
    .push()
    .set({
      action,
      userId: user.uid,
      userName: user.name || "Admin",
      details,
      timestamp: serverTimestamp,
    })
    .catch(() => {});
}
