"use client";

/**
 * Chat actions — 1:1 port of the Chatme messaging logic:
 * send / edit / delete / forward messages, file & voice upload (GitHub API
 * with base64 fallback), typing indicator, unread receipts, message limit
 * cleanup, block/unblock.
 *
 * Each message is written to BOTH:
 *   messages/{chatId}/{msgId}      — user-visible plaintext copy
 *   messagesAdmin/{chatId}/{msgId} — plaintext admin-visible copy (Firebase rules
 *                                  restrict this path to admins only; admin panel
 *                                  reads it to inspect conversations)
 */
import { toast } from "sonner";

import { db, generateChatId, serverTimestamp } from "@/lib/firebase";
import { compressImage } from "@/lib/format";
import type { ChatMessage, UserProfile } from "@/lib/types";
import { pushToUserSafe } from "@/lib/web-push-client";

let githubSettings = { token: "", repo: "", branch: "main" };
let messageMaxLimit = 200;
let premiumSettings = { enabled: false, maxFileSize: 10 };
let bannedWordsList: string[] = [];
let rateLimitPerMinute = 0; // 0 = unlimited

export function setBannedWords(list: string) {
  bannedWordsList = list
    .split(",")
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
}
export function setRateLimit(n: number) {
  rateLimitPerMinute = n > 0 ? n : 0;
}
export function getBannedWords() {
  return bannedWordsList;
}

export function setGithubSettings(s: { token: string; repo: string; branch: string }) {
  githubSettings = s;
}
export function setMessageMaxLimit(n: number) {
  messageMaxLimit = n || 200;
}
export function setPremiumSettings(s: { enabled: boolean; maxFileSize?: number }) {
  premiumSettings = { ...premiumSettings, ...s };
}
export function getMessageMaxLimit() {
  return messageMaxLimit;
}

/* ==================== GITHUB UPLOAD SYSTEM (same as Chatme) ==================== */

export async function loadGitHubSettings() {
  try {
    const snap = await db.ref("settings/githubStorage").once("value");
    const data = snap.val() || {};
    githubSettings = { token: data.token || "", repo: data.repo || "", branch: data.branch || "main" };
  } catch {
    /* ignore */
  }
}

export async function uploadToGitHub(file: File, folder: string): Promise<string | null> {
  if (!githubSettings.token || !githubSettings.repo) {
    await loadGitHubSettings();
    if (!githubSettings.token || !githubSettings.repo) {
      toast.error("File upload failed: GitHub API storage is not configured by the admin.");
      return null;
    }
  }
  const repoParts = githubSettings.repo.split("/");
  if (repoParts.length < 2) {
    toast.error("Invalid GitHub repo format (owner/repo required)");
    return null;
  }
  const owner = repoParts[0];
  const repo = repoParts[1];
  const ts = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `uploads/${folder}/${ts}_${safeName}`;
  const reader = new FileReader();
  const b64 = await new Promise<string>((res, rej) => {
    reader.onload = () => {
      const r = (reader.result as string).split(",");
      res(r.length > 1 ? r[1] : r[0]);
    };
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
  const resp = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    method: "PUT",
    headers: { Authorization: `token ${githubSettings.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: `Upload ${file.name}`, content: b64, branch: githubSettings.branch || "main" }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    toast.error(`File upload failed: ${err.message || resp.status}`);
    return null;
  }
  const data = await resp.json();
  // Private repos: the PUT response's download_url is null — build the raw
  // URL ourselves. The media resolver re-fetches it with the token client-side.
  return (
    data.content?.download_url ||
    `https://raw.githubusercontent.com/${owner}/${repo}/${githubSettings.branch || "main"}/${path}`
  );
}

export async function deleteFromGitHub(fileUrl: string) {
  if (!githubSettings.token || !githubSettings.repo || !fileUrl) return;
  try {
    const repoParts = githubSettings.repo.split("/");
    const owner = repoParts[0];
    const repo = repoParts[1];
    const urlObj = new URL(fileUrl);
    const pathParts = urlObj.pathname.split("/blob/");
    if (pathParts.length < 2) return;
    const branch = pathParts[1].split("/")[0];
    const filePath = pathParts[1].substring(branch.length + 1);
    const shaResp = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`,
      { headers: { Authorization: `token ${githubSettings.token}` } },
    );
    if (!shaResp.ok) return;
    const shaData = await shaResp.json();
    await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`, {
      method: "DELETE",
      headers: { Authorization: `token ${githubSettings.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Delete file", sha: shaData.sha, branch: githubSettings.branch || "main" }),
    });
  } catch {
    /* ignore */
  }
}

/* ==================== MESSAGE LIMIT CLEANUP ==================== */

export async function cleanupOldMessages(chatId: string) {
  try {
    const messagesRef = db.ref(`messages/${chatId}`);
    const snapshot = await messagesRef.orderByChild("timestamp").once("value");
    const messages: { key: string; fileUrl?: string }[] = [];
    snapshot.forEach((child) => {
      messages.push({ key: child.key as string, ...(child.val() as object) } as { key: string; fileUrl?: string });
    });
    const limit = messageMaxLimit || 200;
    if (messages.length > limit) {
      const toDelete = messages.slice(0, messages.length - limit);
      const updates: Record<string, null> = {};
      const adminUpdates: Record<string, null> = {};
      for (const msg of toDelete) {
        updates[msg.key] = null;
        adminUpdates[msg.key] = null;
        if (msg.fileUrl) deleteFromGitHub(msg.fileUrl).catch(() => {});
      }
      await messagesRef.update(updates);
      await db.ref(`messagesAdmin/${chatId}`).update(adminUpdates).catch(() => {});
    }
  } catch {
    /* ignore */
  }
}

/* ==================== SEND / EDIT / DELETE / FORWARD ==================== */

/** Client-side anti-spam: sliding window of my recent message timestamps. */
const mySendTimes: number[] = [];
function rateLimited(): boolean {
  if (!rateLimitPerMinute) return false;
  const now = Date.now();
  while (mySendTimes.length && now - mySendTimes[0] > 60000) mySendTimes.shift();
  if (mySendTimes.length >= rateLimitPerMinute) return true;
  mySendTimes.push(now);
  return false;
}

/** Auto-moderation: reject messages containing admin-banned words. */
function containsBannedWord(text: string): string | null {
  const lower = text.toLowerCase();
  for (const w of bannedWordsList) {
    if (w && lower.includes(w)) return w;
  }
  return null;
}

export async function sendMessage(opts: {
  myUid: string;
  otherUid: string;
  text: string;
  replyTo?: { senderId: string; senderName: string; text: string } | null;
  editingMessageKey?: string | null;
  users: Record<string, UserProfile>;
  /** Send text as a LARGE sticker (no bubble background). */
  sticker?: boolean;
}) {
  const { myUid, otherUid, text, replyTo, editingMessageKey, sticker } = opts;
  const chatId = otherUid.startsWith("g_") ? otherUid : generateChatId(myUid, otherUid);

  try {
    if (editingMessageKey) {
      await db.ref(`messages/${chatId}/${editingMessageKey}`).update({ text, edited: true });
      // Mirror edit to admin-visible plaintext copy
      await db.ref(`messagesAdmin/${chatId}/${editingMessageKey}`).update({
        text,
        edited: true,
      }).catch(() => {});
      toast.success("Message edited");
      return true;
    }

    // Anti-spam rate limit (admin-configured)
    if (rateLimited()) {
      toast.error("You're sending messages too quickly. Please wait a moment.");
      return false;
    }
    // Auto-moderation: banned words
    const banned = containsBannedWord(text);
    if (banned) {
      toast.error(`Message blocked: contains a word not allowed on this platform.`);
      return false;
    }

    const msgData: Record<string, unknown> = {
      senderId: myUid,
      text,
      timestamp: serverTimestamp,
      type: "text",
    };
    if (sticker) msgData.sticker = true;
    // Disappearing messages: attach expiry when the chat has a timer set
    // (works for 1:1 chats and group chats alike)
    try {
      const metaSnap = await db.ref(`chats/${chatId}/disappearing`).once("value");
      const timer = metaSnap.val();
      if (timer === "24h") msgData.expiresAt = Date.now() + 86400000;
      else if (timer === "7d") msgData.expiresAt = Date.now() + 7 * 86400000;
    } catch {
      /* timer unreadable — send normally */
    }
    if (replyTo) msgData.replyTo = replyTo;

    const msgRef = db.ref(`messages/${chatId}`).push();
    await msgRef.set(msgData);

    // Write admin-visible plaintext mirror (same key so admin viewer can join on it)
    const adminMsg: Record<string, unknown> = {
      senderId: myUid,
      text,
      timestamp: serverTimestamp,
      type: "text",
      senderName: opts.users[myUid]?.name || "You",
      receiverId: otherUid,
      receiverName: opts.users[otherUid]?.name || (otherUid.startsWith("g_") ? "Group" : "Unknown"),
    };
    if (msgData.expiresAt) adminMsg.expiresAt = msgData.expiresAt;
    if (replyTo) adminMsg.replyTo = replyTo;
    await db.ref(`messagesAdmin/${chatId}/${msgRef.key}`).set(adminMsg).catch(() => {});

    // Unread markers + last message for every group member (or the single peer)
    if (otherUid.startsWith("g_")) {
      const gid = otherUid.slice(2);
      const groupSnap = await db.ref(`groups/${gid}/members`).once("value");
      const members = (groupSnap.val() || {}) as Record<string, boolean>;
      const updates: Record<string, unknown> = {
        lastMessage: text,
        lastTimestamp: serverTimestamp,
        lastSender: myUid,
      };
      await db.ref(`chats/${chatId}`).update(updates);
      const unreadUpdates: Record<string, unknown> = {};
      for (const uid of Object.keys(members)) {
        if (uid !== myUid) unreadUpdates[uid] = serverTimestamp;
      }
      if (Object.keys(unreadUpdates).length > 0) {
        await db.ref(`chats/${chatId}/unread`).update(unreadUpdates);
      }
      // Direct web push — members with the tab CLOSED get a notification
      // (no Cloud Functions / Blaze plan required).
      const senderName = opts.users[myUid]?.name || "Someone";
      Object.keys(members).forEach((uid) => {
        if (uid !== myUid) {
          pushToUserSafe(uid, {
            type: "new-message",
            chatId,
            senderUid: myUid,
            senderName,
            preview: sticker ? "Sticker" : text.slice(0, 120),
            chatUrl: `/?chat=${otherUid}`,
          });
        }
      });
    } else {
      await db.ref(`chats/${chatId}`).update({
        lastMessage: text,
        lastTimestamp: serverTimestamp,
        lastSender: myUid,
      });
      await db.ref(`chats/${chatId}/unread/${otherUid}`).set(serverTimestamp);
      // Direct web push — the peer's browser shows a notification when its
      // tab is CLOSED (an open tab is handled by realtime listeners).
      pushToUserSafe(otherUid, {
        type: "new-message",
        chatId,
        senderUid: myUid,
        senderName: opts.users[myUid]?.name || "Someone",
        preview: sticker ? "Sticker" : text.slice(0, 120),
        chatUrl: `/?chat=${myUid}`,
      });
    }
    await cleanupOldMessages(chatId);
    return true;
  } catch {
    toast.error("Failed to send message");
    return false;
  }
}

export async function sendFileMessage(file: File, myUid: string, otherUid: string) {
  const chatId = otherUid.startsWith("g_") ? otherUid : generateChatId(myUid, otherUid);
  try {
    const isImg = file.type.startsWith("image/");
    const isVoice = file.type.startsWith("audio/");
    let fileUrl = await uploadToGitHub(file, "chat_files");
    let fallbackB64: string | null = null;
    if (!fileUrl) {
      if (file.size <= 512 * 1024) {
        const reader = new FileReader();
        fallbackB64 = await new Promise<string>((res, rej) => {
          reader.onload = () => res(reader.result as string);
          reader.onerror = () => rej(new Error("Could not read file"));
          reader.readAsDataURL(file);
        });
      } else {
        toast.error("File upload failed. Ask the admin to configure GitHub API storage.");
        return false;
      }
    }
    const msgData: Record<string, unknown> = {
      senderId: myUid,
      text: isImg ? "📷 Photo" : isVoice ? "🎤 Voice message" : `📎 ${file.name}`,
      timestamp: serverTimestamp,
      type: "file",
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      isImage: isImg,
      isVoice: isVoice,
    };
    if (fileUrl) msgData.fileUrl = fileUrl;
    if (fallbackB64) msgData.fileData = fallbackB64;
    const msgRef = db.ref(`messages/${chatId}`).push();
    await msgRef.set(msgData);

    // Mirror media metadata (NOT base64) to admin-visible path for inspection
    const adminMsg: Record<string, unknown> = {
      senderId: myUid,
      text: isImg ? "📷 Photo" : isVoice ? "🎤 Voice message" : `📎 ${file.name}`,
      timestamp: serverTimestamp,
      type: "file",
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      isImage: isImg,
      isVoice: isVoice,
      senderName: "You",
    };
    if (fileUrl) adminMsg.fileUrl = fileUrl;
    await db.ref(`messagesAdmin/${chatId}/${msgRef.key}`).set(adminMsg).catch(() => {});

    const lastMsgText = isImg ? "📷 Photo" : isVoice ? "🎤 Voice" : `📎 ${file.name}`;
    await db.ref(`chats/${chatId}`).update({
      lastMessage: lastMsgText,
      lastTimestamp: serverTimestamp,
      lastSender: myUid,
    });
    await cleanupOldMessages(chatId);
    toast.success("File sent");
    return true;
  } catch {
    toast.error("Failed to send file");
    return false;
  }
}

export async function deleteMessage(chatId: string, msg: ChatMessage) {
  try {
    await db.ref(`messages/${chatId}/${msg.key}`).remove();
    await db.ref(`messagesAdmin/${chatId}/${msg.key}`).remove().catch(() => {});
    if (msg.fileUrl) deleteFromGitHub(msg.fileUrl).catch(() => {});
    toast.success("Message deleted");
    return true;
  } catch {
    toast.error("Failed to delete");
    return false;
  }
}

export async function forwardMessage(msg: ChatMessage, myUid: string, toUid: string, users: Record<string, UserProfile> = {}) {
  const chatId = toUid.startsWith("g_") ? toUid : generateChatId(myUid, toUid);
  const displayText = msg.type === "text" ? msg._decryptedText || msg.text : "🔄 Forwarded message";
  const msgData: Record<string, unknown> = {
    senderId: myUid,
    text: displayText,
    timestamp: serverTimestamp,
    type: msg.type,
    forwarded: true,
  };
  const msgRef = db.ref(`messages/${chatId}`).push();
  await msgRef.set(msgData);
  // Mirror to admin-visible path
  await db.ref(`messagesAdmin/${chatId}/${msgRef.key}`).set({
    senderId: myUid,
    text: displayText,
    timestamp: serverTimestamp,
    type: msg.type,
    forwarded: true,
    senderName: users[myUid]?.name || "You",
    receiverId: toUid,
    receiverName: users[toUid]?.name || "Unknown",
  }).catch(() => {});
  await db.ref(`chats/${chatId}`).update({
    lastMessage: displayText.substring(0, 50),
    lastTimestamp: serverTimestamp,
    lastSender: myUid,
  });
  toast.success("Forwarded");
}

export async function checkBlockedBy(otherUid: string, myUid: string): Promise<boolean> {
  try {
    const snap = await db.ref(`users/${otherUid}/blocked/${myUid}`).once("value");
    return !!snap.val();
  } catch {
    return false;
  }
}

/* ==================== TYPING INDICATOR ==================== */

let typingTimeout: ReturnType<typeof setTimeout> | null = null;

export function notifyTyping(myUid: string, otherUid: string) {
  const chatId = generateChatId(myUid, otherUid);
  db.ref(`chats/${chatId}/typing/${myUid}`).set(true);
  if (typingTimeout) clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    db.ref(`chats/${chatId}/typing/${myUid}`).remove();
  }, 2000);
}

export function stopTyping(myUid: string, otherUid: string) {
  if (!otherUid) return;
  const chatId = generateChatId(myUid, otherUid);
  db.ref(`chats/${chatId}/typing/${myUid}`).remove();
}

/* ==================== BLOCK / UNBLOCK ==================== */

export async function blockUser(myUid: string, otherUid: string, name: string) {
  await db.ref(`users/${myUid}/blocked/${otherUid}`).set(true);
  toast.success(`${name} blocked`);
}

export async function unblockUser(myUid: string, otherUid: string, name: string) {
  await db.ref(`users/${myUid}/blocked/${otherUid}`).remove();
  toast.success(`${name} unblocked`);
}

/* ==================== MESSAGE REACTIONS (WhatsApp-style emoji reactions) ==================== */

export async function toggleReaction(chatId: string, msg: ChatMessage, myUid: string, emoji: string) {
  try {
    const ref = db.ref(`messages/${chatId}/${msg.key}/reactions/${myUid}`);
    const snap = await ref.once("value");
    const current = snap.val();
    if (current === emoji) {
      await ref.remove();
    } else {
      await ref.set(emoji);
      // Mirror to admin path
      await db.ref(`messagesAdmin/${chatId}/${msg.key}/reactions/${myUid}`).set(emoji).catch(() => {});
    }
  } catch {
    /* silent */
  }
}

/* ==================== STAR / FAVOURITE MESSAGE ==================== */

export async function toggleStarMessage(chatId: string, msg: ChatMessage, myUid: string) {
  try {
    const ref = db.ref(`messages/${chatId}/${msg.key}/starred/${myUid}`);
    const snap = await ref.once("value");
    if (snap.val()) {
      await ref.remove();
      await db.ref(`messagesAdmin/${chatId}/${msg.key}/starred/${myUid}`).remove().catch(() => {});
    } else {
      await ref.set(true);
      await db.ref(`messagesAdmin/${chatId}/${msg.key}/starred/${myUid}`).set(true).catch(() => {});
    }
  } catch {
    /* silent */
  }
}

/* ==================== READ RECEIPTS (blue double-tick) ==================== */

export async function markMessageRead(chatId: string, msgKey: string, readerUid: string) {
  try {
    await db.ref(`messages/${chatId}/${msgKey}/readBy/${readerUid}`).set(Date.now());
  } catch {
    /* silent */
  }
}

/* ==================== PIN / UNPIN CHAT ==================== */

export async function togglePinChat(chatId: string, myUid: string) {
  try {
    const ref = db.ref(`chats/${chatId}/pinned/${myUid}`);
    const snap = await ref.once("value");
    if (snap.val()) {
      await ref.remove();
      toast.success("Chat unpinned");
    } else {
      await ref.set(true);
      toast.success("Chat pinned");
    }
  } catch {
    /* silent */
  }
}

/* ==================== MUTE / UNMUTE CHAT ==================== */

export async function toggleMuteChat(chatId: string, myUid: string) {
  try {
    const ref = db.ref(`chats/${chatId}/muted/${myUid}`);
    const snap = await ref.once("value");
    if (snap.val()) {
      await ref.remove();
      toast.success("Chat unmuted");
    } else {
      await ref.set(true);
      toast.success("Chat muted");
    }
  } catch {
    /* silent */
  }
}

/* ==================== PROFILE PICTURE ==================== */

export async function uploadProfilePicture(file: File, myUid: string, oldPhotoUrl?: string) {
  if (file.size > 5 * 1024 * 1024) {
    toast.error("Photo must be at most 5MB");
    return false;
  }
  toast.info("Compressing & uploading photo...");
  try {
    let uploadFile = file;
    if (file.type.startsWith("image/")) {
      const compressed = await compressImage(file, 512, 512, 0.7);
      if (compressed) {
        uploadFile = new File([compressed], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" });
      }
    }
    const url = await uploadToGitHub(uploadFile, "profile_pictures");
    if (url) {
      if (oldPhotoUrl) deleteFromGitHub(oldPhotoUrl).catch(() => {});
      await db.ref(`users/${myUid}/photoUrl`).set(url);
      toast.success("Profile photo updated");
      return true;
    }
    return false;
  } catch (err) {
    toast.error(`Photo upload failed: ${(err as Error).message || "unknown error"}`);
    return false;
  }
}

export async function removeProfilePicture(myUid: string, oldPhotoUrl?: string) {
  try {
    if (oldPhotoUrl) await deleteFromGitHub(oldPhotoUrl);
    await db.ref(`users/${myUid}/photoUrl`).remove();
    toast.success("Profile photo removed");
    return true;
  } catch {
    toast.error("Could not remove photo");
    return false;
  }
}

/* ==================== COVER PHOTO (banner) ==================== */

export async function uploadCoverPhoto(file: File, myUid: string, oldCoverUrl?: string) {
  if (file.size > 8 * 1024 * 1024) {
    toast.error("Cover photo must be at most 8MB");
    return false;
  }
  toast.info("Compressing & uploading cover...");
  try {
    let uploadFile = file;
    if (file.type.startsWith("image/")) {
      // Larger dimensions for cover (1500x500 banner), still JPEG-compressed
      const compressed = await compressImage(file, 1500, 500, 0.75);
      if (compressed) {
        uploadFile = new File([compressed], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" });
      }
    }
    const url = await uploadToGitHub(uploadFile, "cover_photos");
    if (url) {
      if (oldCoverUrl) deleteFromGitHub(oldCoverUrl).catch(() => {});
      await db.ref(`users/${myUid}/coverUrl`).set(url);
      toast.success("Cover photo updated");
      return true;
    }
    return false;
  } catch (err) {
    toast.error(`Cover upload failed: ${(err as Error).message || "unknown error"}`);
    return false;
  }
}

export async function removeCoverPhoto(myUid: string, oldCoverUrl?: string) {
  try {
    if (oldCoverUrl) await deleteFromGitHub(oldCoverUrl);
    await db.ref(`users/${myUid}/coverUrl`).remove();
    toast.success("Cover photo removed");
    return true;
  } catch {
    toast.error("Could not remove cover");
    return false;
  }
}

/* ==================== GROUP CHATS ==================== */

/** Create a group with the given name + member uids. Returns the new gid. */
export async function createGroup(myUid: string, name: string, memberUids: string[], description = ""): Promise<string> {
  const gidRef = db.ref("groups").push();
  const gid = gidRef.key as string;
  const members: Record<string, boolean> = { [myUid]: true };
  for (const uid of memberUids) members[uid] = true;
  await gidRef.set({
    name: name.trim(),
    description: description.trim(),
    createdBy: myUid,
    createdAt: serverTimestamp,
    members,
    admins: { [myUid]: true },
  });
  // Chat meta for the group
  await db.ref(`chats/g_${gid}`).set({
    isGroup: true,
    gid,
    lastMessage: "",
    lastTimestamp: serverTimestamp,
    lastSender: "",
  });
  // System welcome message
  const msgRef = db.ref(`messages/g_${gid}`).push();
  await msgRef.set({
    senderId: myUid,
    text: `Group "${name.trim()}" created`,
    timestamp: serverTimestamp,
    type: "system",
  });
  await db.ref(`messagesAdmin/g_${gid}/${msgRef.key}`).set({
    senderId: myUid,
    text: `Group "${name.trim()}" created`,
    timestamp: serverTimestamp,
    type: "system",
    senderName: "System",
  }).catch(() => {});
  toast.success("Group created");
  return gid;
}

export async function addGroupMembers(gid: string, uids: string[]) {
  const updates: Record<string, boolean> = {};
  for (const uid of uids) updates[uid] = true;
  await db.ref(`groups/${gid}/members`).update(updates);
  const msgRef = db.ref(`messages/g_${gid}`).push();
  await msgRef.set({ senderId: "system", text: `${uids.length} member(s) added`, timestamp: serverTimestamp, type: "system" });
  await db.ref(`messagesAdmin/g_${gid}/${msgRef.key}`).set({ senderId: "system", text: `${uids.length} member(s) added`, timestamp: serverTimestamp, type: "system", senderName: "System" }).catch(() => {});
  toast.success("Member(s) added");
}

export async function removeGroupMember(gid: string, uid: string, byName: string) {
  await db.ref(`groups/${gid}/members/${uid}`).remove();
  const msgRef = db.ref(`messages/g_${gid}`).push();
  await msgRef.set({ senderId: "system", text: `${byName} removed`, timestamp: serverTimestamp, type: "system" });
  await db.ref(`messagesAdmin/g_${gid}/${msgRef.key}`).set({ senderId: "system", text: `${byName} removed`, timestamp: serverTimestamp, type: "system", senderName: "System" }).catch(() => {});
  toast.success("Member removed");
}

export async function leaveGroup(gid: string, myUid: string) {
  await db.ref(`groups/${gid}/members/${myUid}`).remove();
  await db.ref(`groups/${gid}/admins/${myUid}`).remove().catch(() => {});
  const msgRef = db.ref(`messages/g_${gid}`).push();
  await msgRef.set({ senderId: "system", text: "A member left the group", timestamp: serverTimestamp, type: "system" });
  await db.ref(`messagesAdmin/g_${gid}/${msgRef.key}`).set({ senderId: "system", text: "A member left the group", timestamp: serverTimestamp, type: "system", senderName: "System" }).catch(() => {});
  toast.success("You left the group");
}

export async function updateGroupInfo(gid: string, data: { name?: string; description?: string; photoUrl?: string }) {
  await db.ref(`groups/${gid}`).update(data);
  toast.success("Group updated");
}

/** Upload a group avatar (reuses profile-picture pipeline). */
export async function uploadGroupPhoto(file: File, gid: string, oldPhotoUrl?: string) {
  if (file.size > 5 * 1024 * 1024) {
    toast.error("Photo must be at most 5MB");
    return false;
  }
  try {
    let uploadFile = file;
    if (file.type.startsWith("image/")) {
      const compressed = await compressImage(file, 512, 512, 0.7);
      if (compressed) {
        uploadFile = new File([compressed], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" });
      }
    }
    const url = await uploadToGitHub(uploadFile, "profile_pictures");
    if (url) {
      if (oldPhotoUrl) deleteFromGitHub(oldPhotoUrl).catch(() => {});
      await db.ref(`groups/${gid}/photoUrl`).set(url);
      toast.success("Group photo updated");
      return true;
    }
    return false;
  } catch {
    toast.error("Photo upload failed");
    return false;
  }
}

/* ==================== DISAPPEARING MESSAGES ==================== */

export async function setDisappearing(chatId: string, mode: "off" | "24h" | "7d") {
  await db.ref(`chats/${chatId}/disappearing`).set(mode === "off" ? null : mode);
  toast.success(mode === "off" ? "Disappearing messages off" : `Messages disappear after ${mode}`);
}

/* ==================== MESSAGE TRANSLATION (MyMemory free API) ==================== */

export async function translateMessage(text: string, target: "en" | "bn"): Promise<string | null> {
  try {
    const source = target === "en" ? "bn" : "en";
    const resp = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${source}|${target}`,
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const translated = data?.responseData?.translatedText;
    return typeof translated === "string" ? translated : null;
  } catch {
    return null;
  }
}

export async function postStatus(myUid: string, name: string, text: string, color: string) {
  const now = Date.now();
  await db.ref("statuses").push().set({
    userId: myUid,
    userName: name || "User",
    text,
    color: color || "#008069",
    timestamp: now,
    expiresAt: now + 86400000,
    viewers: {},
    viewerCount: 0,
  });
  toast.success("Status posted");
}

export async function markStatusViewed(statusKey: string, myUid: string, viewerCount = 0) {
  await db.ref(`statuses/${statusKey}/viewers/${myUid}`).set(true).catch(() => {});
  await db.ref(`statuses/${statusKey}/viewerCount`).set((viewerCount || 0) + 1).catch(() => {});
}

/* ==================== PREMIUM FILE GATE (free for all, same as Chatme) ==================== */

export function checkFileSizeAllowed(file: File): boolean {
  const maxMB = premiumSettings.maxFileSize || 10;
  if (file.size > maxMB * 1024 * 1024) {
    toast.error(`File size exceeds the ${maxMB}MB limit.`);
    return false;
  }
  return true;
}

/* ==================== ACCOUNT ==================== */

export async function deleteAccount(myUid: string, uniqueId?: string) {
  await db.ref(`users/${myUid}`).remove();
  await db.ref(`userSettings/${myUid}`).remove();
  if (uniqueId) await db.ref(`uniqueIds/${uniqueId}`).remove().catch(() => {});
  toast.success("Account deleted");
}

/* ==================== SCHEDULED MESSAGES ==================== */

/** Queue a message for future delivery — stored at users/{uid}/scheduled/{key}. */
export async function scheduleMessage(opts: {
  myUid: string;
  otherUid: string;
  otherName?: string;
  text: string;
  sendAt: number;
}): Promise<boolean> {
  const { myUid, otherUid, otherName, text, sendAt } = opts;
  try {
    await db.ref(`users/${myUid}/scheduled`).push().set({
      otherUid,
      otherName: otherName || "",
      text,
      sendAt,
      createdAt: Date.now(),
    });
    toast.success(`Message scheduled for ${new Date(sendAt).toLocaleString()}`);
    return true;
  } catch {
    toast.error("Could not schedule the message");
    return false;
  }
}

/** Remove a pending scheduled message. */
export async function cancelScheduledMessage(myUid: string, key: string) {
  await db.ref(`users/${myUid}/scheduled/${key}`).remove().catch(() => {});
  toast.success("Scheduled message cancelled");
}

/* ==================== BROADCAST LISTS ==================== */

/** Send one text to many recipients (each gets a normal 1:1 message). */
export async function sendBroadcast(
  myUid: string,
  recipientUids: string[],
  text: string,
  users: Record<string, UserProfile>,
): Promise<number> {
  let sent = 0;
  for (const uid of recipientUids) {
    const ok = await sendMessage({ myUid, otherUid: uid, text, users });
    if (ok) sent++;
  }
  if (sent > 0) toast.success(`Broadcast sent to ${sent} recipient${sent > 1 ? "s" : ""}`);
  else toast.error("Broadcast failed");
  return sent;
}

/* ==================== CHAT FOLDERS ==================== */

export async function createFolder(myUid: string, name: string, emoji = "📁") {
  const ref = db.ref(`users/${myUid}/folders`).push();
  await ref.set({ name: name.trim(), emoji, chatIds: {}, createdAt: Date.now() });
  toast.success("Folder created");
  return ref.key as string;
}

export async function renameFolder(myUid: string, fid: string, name: string) {
  await db.ref(`users/${myUid}/folders/${fid}/name`).set(name.trim());
  toast.success("Folder renamed");
}

export async function deleteFolder(myUid: string, fid: string) {
  await db.ref(`users/${myUid}/folders/${fid}`).remove();
  toast.success("Folder deleted");
}

/** Toggle a chat's membership in a folder. */
export async function toggleFolderChat(myUid: string, fid: string, chatId: string) {
  const ref = db.ref(`users/${myUid}/folders/${fid}/chatIds/${chatId}`);
  const snap = await ref.once("value");
  if (snap.val()) {
    await ref.remove();
    toast.success("Removed from folder");
  } else {
    await ref.set(true);
    toast.success("Added to folder");
  }
}

/* ==================== ARCHIVE CHAT ==================== */

export async function toggleArchiveChat(chatId: string, myUid: string) {
  try {
    const ref = db.ref(`chats/${chatId}/archived/${myUid}`);
    const snap = await ref.once("value");
    if (snap.val()) {
      await ref.remove();
      toast.success("Chat unarchived");
    } else {
      await ref.set(true);
      toast.success("Chat archived");
    }
  } catch {
    /* silent */
  }
}

/* ==================== LOGIN SESSIONS (session management) ==================== */

/** Parse a userAgent string into a friendly device + browser label. */
export function describeUserAgent(ua: string): { device: string; browser: string } {
  let browser = "Unknown browser";
  if (ua.includes("Edg/")) browser = "Edge";
  else if (ua.includes("OPR/") || ua.includes("Opera")) browser = "Opera";
  else if (ua.includes("Chrome/")) browser = "Chrome";
  else if (ua.includes("Firefox/")) browser = "Firefox";
  else if (ua.includes("Safari/") && !ua.includes("Chrome")) browser = "Safari";
  let device = "Desktop";
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) {
    device = /iPad|Tablet/i.test(ua) ? "Tablet" : "Phone";
  } else if (/Macintosh/.test(ua)) device = "Mac";
  else if (/Windows/.test(ua)) device = "Windows PC";
  else if (/Linux/.test(ua)) device = "Linux";
  return { device, browser };
}

/** Register this login as a session under users/{uid}/sessions/{sid}. */
export async function registerSession(myUid: string): Promise<string | null> {
  try {
    const sid = localStorage.getItem("chatbd-session-id") || db.ref("sessions").push().key as string;
    localStorage.setItem("chatbd-session-id", sid);
    const { device, browser } = describeUserAgent(navigator.userAgent);
    await db.ref(`users/${myUid}/sessions/${sid}`).set({
      device,
      browser,
      createdAt: Date.now(),
      lastActive: serverTimestamp,
    });
    db.ref(`users/${myUid}/sessions/${sid}/lastActive`).onDisconnect().set(Date.now());
    return sid;
  } catch {
    return null;
  }
}

/** Touch lastActive periodically while online. */
export async function touchSession(myUid: string, sid: string) {
  try {
    await db.ref(`users/${myUid}/sessions/${sid}/lastActive`).set(Date.now());
  } catch {
    /* ignore */
  }
}

/** Revoke another session (or all others). */
export async function revokeSession(myUid: string, sid: string) {
  await db.ref(`users/${myUid}/sessions/${sid}`).remove().catch(() => {});
  toast.success("Session signed out");
}
