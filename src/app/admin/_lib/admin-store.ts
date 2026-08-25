"use client";

/**
 * Admin data store — ports the Chatme admin dashboard listeners:
 * users, chats, messages, calls, statuses, announcements, settings,
 * activity logs + stats. Admin-only (role check in the layout guard).
 */
import { create } from "zustand";

import { auth, db, serverTimestamp } from "@/lib/firebase";
import type { Lang } from "@/lib/i18n";
import type {
  ActivityLog,
  Announcement,
  AppSettings,
  CallRecord,
  ChatMessage,
  ChatMeta,
  StatusRecord,
  UserProfile,
} from "@/lib/types";

type AdminState = {
  authUid: string | null | undefined;
  admin: UserProfile | null;
  users: Record<string, UserProfile>;
  chats: Record<string, ChatMeta>;
  messageCount: number;
  /** Daily message counts for the last 7 days (dashboard volume chart). */
  messageVolume: { label: string; count: number }[];
  statuses: StatusRecord[];
  calls: CallRecord[];
  announcements: Announcement[];
  settings: AppSettings;
  logs: ActivityLog[];
  listenersAttached: boolean;
};

export const useAdmin = create<AdminState>(() => ({
  authUid: undefined,
  admin: null,
  users: {},
  chats: {},
  messageCount: 0,
  messageVolume: [],
  statuses: [],
  calls: [],
  announcements: [],
  settings: {},
  logs: [],
  listenersAttached: false,
}));

export function setAdminAuth(authUid: string | null | undefined) {
  useAdmin.setState({ authUid });
}
export function setAdmin(admin: UserProfile | null) {
  useAdmin.setState({ admin });
}

/** Current admin-panel display language. Platform-wide at
 *  settings/adminLanguage — defaults to English. */
export function useAdminLang(): Lang {
  const settings = useAdmin((s) => s.settings);
  return settings.adminLanguage === "bn" ? "bn" : "en";
}

/** Attach all realtime listeners once an admin session is confirmed. */
export function attachAdminListeners() {
  if (useAdmin.getState().listenersAttached) return;
  useAdmin.setState({ listenersAttached: true });

  db.ref("users").on("value", (snap: { forEach: (cb: (child: { key: string | null; val: () => unknown }) => void) => void }) => {
    const users: Record<string, UserProfile> = {};
    snap.forEach((child) => {
      users[child.key as string] = { uid: child.key as string, ...(child.val() as object) } as UserProfile;
    });
    useAdmin.setState({ users });
  });

  db.ref("chats").on("value", (snap: { forEach: (cb: (child: { key: string | null; val: () => unknown }) => void) => void }) => {
    const chats: Record<string, ChatMeta> = {};
    snap.forEach((child) => {
      chats[child.key as string] = { ...(child.val() as ChatMeta), chatId: child.key as string };
    });
    useAdmin.setState({ chats });
  });

  /* total message count + daily volume chart (dashboard stats) */
  db.ref("messages").on("value", (snap: { forEach: (cb: (chat: { forEach: (cb: (msg: { val: () => { timestamp?: number } }) => void) => void; numChildren: () => number }) => void) => void }) => {
    let mc = 0;
    const dayBuckets: Record<string, number> = {};
    const now = new Date();
    const days: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      days.push(d.getTime() + "");
      dayBuckets[d.getTime() + ""] = 0;
    }
    snap.forEach((chat) => {
      mc += chat.numChildren();
      chat.forEach((msg) => {
        const ts = (msg.val() || {}).timestamp || 0;
        const dayStart = new Date(new Date(ts).setHours(0, 0, 0, 0)).getTime() + "";
        if (dayStart in dayBuckets) dayBuckets[dayStart]++;
      });
    });
    const messageVolume = days.map((d) => ({
      label: new Date(Number(d)).toLocaleDateString("en-US", { weekday: "short" }),
      count: dayBuckets[d] || 0,
    }));
    useAdmin.setState({ messageCount: mc, messageVolume });
  });

  db.ref("statuses").on("value", (snap: { forEach: (cb: (child: { key: string | null; val: () => unknown }) => void) => void }) => {
    const list: StatusRecord[] = [];
    snap.forEach((child) => {
      list.push({ key: child.key as string, ...(child.val() as object) } as StatusRecord);
    });
    useAdmin.setState({ statuses: list });
  });

  db.ref("calls").on("value", (snap: { forEach: (cb: (child: { key: string | null; val: () => unknown }) => void) => void }) => {
    const list: CallRecord[] = [];
    snap.forEach((child) => {
      list.push({ key: child.key as string, ...(child.val() as object) } as CallRecord);
    });
    list.sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
    useAdmin.setState({ calls: list });
  });

  db.ref("announcements").on("value", (snap: { forEach: (cb: (child: { key: string | null; val: () => unknown }) => void) => void }) => {
    const list: Announcement[] = [];
    snap.forEach((child) => {
      list.push({ key: child.key as string, ...(child.val() as object) } as Announcement);
    });
    list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    useAdmin.setState({ announcements: list });
  });

  db.ref("settings").on("value", (snap: { val: () => AppSettings | null }) => {
    useAdmin.setState({ settings: snap.val() || {} });
  });

  db.ref("activityLogs")
    .orderByChild("timestamp")
    .limitToLast(100)
    .on("value", (snap: { forEach: (cb: (child: { key: string | null; val: () => unknown }) => void) => void }) => {
      const list: ActivityLog[] = [];
      snap.forEach((child) => {
        list.push({ key: child.key as string, ...(child.val() as object) } as ActivityLog);
      });
      list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      useAdmin.setState({ logs: list });
    });
}

export function detachAdminListeners() {
  db.ref("users").off();
  db.ref("chats").off();
  db.ref("messages").off();
  db.ref("statuses").off();
  db.ref("calls").off();
  db.ref("announcements").off();
  db.ref("settings").off();
  db.ref("activityLogs").off();
  useAdmin.setState({ listenersAttached: false, users: {}, chats: {}, messageCount: 0, messageVolume: [], statuses: [], calls: [], announcements: [], logs: [] });
}

/** Load the decrypted-safe message list for a specific chat (admin viewer).
 *  Reads from `messagesAdmin/{chatId}` (plaintext mirror) so admin can read
 *  conversation content. Falls back to encrypted path if no admin mirror exists.
 *  Returns `{ list, isPlaintext }` so the UI knows whether to render cipher or text. */
export async function loadChatMessagesEx(
  chatId: string,
): Promise<{ list: ChatMessage[]; isPlaintext: boolean }> {
  // Try admin-visible plaintext mirror first
  try {
    const adminSnap = await db.ref(`messagesAdmin/${chatId}`).orderByChild("timestamp").once("value");
    if (adminSnap.exists()) {
      const list: ChatMessage[] = [];
      adminSnap.forEach((child) => {
        list.push({ key: child.key as string, ...(child.val() as object) } as ChatMessage);
      });
      return { list, isPlaintext: true };
    }
  } catch { /* fall through */ }

  // Fallback: encrypted ciphertext (admin sees raw bytes)
  const snap = await db.ref(`messages/${chatId}`).orderByChild("timestamp").once("value");
  const list: ChatMessage[] = [];
  snap.forEach((child) => {
    list.push({ key: child.key as string, ...(child.val() as object) } as ChatMessage);
  });
  return { list, isPlaintext: false };
}

/** Backwards-compatible wrapper. */
export async function loadChatMessages(chatId: string): Promise<ChatMessage[]> {
  const result = await loadChatMessagesEx(chatId);
  return result.list;
}

/** Same as clearChatMessages — also clears admin-visible mirror. */
export async function clearChatMessagesMirror(chatId: string) {
  await db.ref(`messagesAdmin/${chatId}`).remove().catch(() => {});
}

export async function deleteMessageMirror(chatId: string, msgKey: string) {
  await db.ref(`messagesAdmin/${chatId}/${msgKey}`).remove().catch(() => {});
}

/* ==================== ADMIN ACTIONS (ports dashboard.html) ==================== */

export function adminLog(action: string, details: string) {
  const admin = useAdmin.getState().admin;
  if (!admin) return;
  db.ref("activityLogs")
    .push()
    .set({
      action,
      userId: admin.uid,
      userName: admin.name || "Admin",
      details,
      timestamp: serverTimestamp,
    })
    .catch(() => {});
}

export async function toggleBan(user: UserProfile) {
  const newBanned = !user.isBanned;
  await db.ref(`users/${user.uid}`).update({ isBanned: newBanned });
  adminLog(newBanned ? "ban" : "unban", `${user.name || ""} ${newBanned ? "banned" : "unbanned"}`);
}

export async function toggleRole(user: UserProfile) {
  const role = user.role === "admin" ? "user" : "admin";
  await db.ref(`users/${user.uid}`).update({ role });
  adminLog("role", `${user.name || ""} role changed to ${role}`);
}

export async function togglePremium(user: UserProfile) {
  const val = !user.isPremium;
  await db.ref(`users/${user.uid}/isPremium`).set(val);
  adminLog("premium", `${user.name || ""} premium ${val ? "granted" : "revoked"}`);
}

export async function forceLogout(user: UserProfile) {
  await db.ref(`users/${user.uid}`).update({ isOnline: false, lastSeen: serverTimestamp });
  adminLog("force_logout", `${user.name || ""} force logged out`);
}

export async function deleteUser(user: UserProfile) {
  if (user.uniqueId) await db.ref(`uniqueIds/${user.uniqueId}`).remove().catch(() => {});
  await db.ref(`userSettings/${user.uid}`).remove().catch(() => {});
  await db.ref(`users/${user.uid}`).remove();
  adminLog("user_delete", `${user.name || ""} deleted`);
}

export async function updateUserName(user: UserProfile, name: string) {
  await db.ref(`users/${user.uid}`).update({ name });
  adminLog("settings", `${user.name || ""} renamed to ${name}`);
}

export async function updateUserBio(user: UserProfile, bio: string) {
  await db.ref(`users/${user.uid}`).update({ bio });
  adminLog("settings", `${user.name || ""} bio updated`);
}

export async function deleteMessage(chatId: string, msgKey: string) {
  await db.ref(`messages/${chatId}/${msgKey}`).remove();
  await db.ref(`messagesAdmin/${chatId}/${msgKey}`).remove().catch(() => {});
  adminLog("message_delete", "A message was deleted");
}

export async function clearChatMessages(chatId: string) {
  await db.ref(`messages/${chatId}`).remove();
  await db.ref(`messagesAdmin/${chatId}`).remove().catch(() => {});
  await db.ref(`chats/${chatId}`).update({ lastMessage: "", lastTimestamp: 0 });
  adminLog("chat_delete", "All messages in a chat were deleted");
}

export async function deleteConversation(chatId: string) {
  await db.ref(`messages/${chatId}`).remove();
  await db.ref(`messagesAdmin/${chatId}`).remove().catch(() => {});
  await db.ref(`chats/${chatId}`).remove();
  adminLog("chat_delete", "A conversation was fully deleted");
}

export async function deleteCall(callKey: string) {
  await db.ref(`calls/${callKey}`).remove();
  adminLog("call_delete", "A call log was deleted");
}

export async function deleteStatus(statusKey: string) {
  await db.ref(`statuses/${statusKey}`).remove();
  adminLog("status_delete", "A status was deleted");
}

export async function deleteExpiredStatuses() {
  const now = Date.now();
  const snap = await db.ref("statuses").once("value");
  const updates: Record<string, null> = {};
  let count = 0;
  snap.forEach((child: { key: string | null; val: () => { expiresAt?: number } }) => {
    if (((child.val() || {}).expiresAt || 0) < now) {
      updates[child.key as string] = null;
      count++;
    }
  });
  if (count > 0) {
    await db.ref("statuses").update(updates);
    adminLog("status_delete", `${count} expired statuses deleted`);
  }
  return count;
}

export async function saveAnnouncement(data: { key?: string; title: string; message: string; priority: string }) {
  if (data.key) {
    await db.ref(`announcements/${data.key}`).update({ title: data.title, message: data.message, priority: data.priority });
    adminLog("announcement", `Announcement updated: ${data.title}`);
  } else {
    const admin = useAdmin.getState().admin;
    await db.ref("announcements").push().set({
      title: data.title,
      message: data.message,
      priority: data.priority,
      senderId: admin?.uid || "",
      timestamp: serverTimestamp,
    });
    adminLog("announcement", `New announcement published: ${data.title}`);
  }
}

export async function deleteAnnouncement(key: string) {
  await db.ref(`announcements/${key}`).remove();
  adminLog("announcement", "An announcement was deleted");
}

export async function setSetting(key: string, value: unknown) {
  await db.ref(`settings/${key}`).set(value);
  adminLog("settings", `${key} setting updated`);
}

export async function saveGitHubStorage(data: { token: string; repo: string; branch: string }) {
  await db.ref("settings/githubStorage").set(data);
  adminLog("settings", "GitHub storage settings updated");
}

export async function savePremiumSettings(data: Record<string, unknown>) {
  await db.ref("settings/premium").update(data);
  adminLog("settings", "Premium settings updated");
}

/* ==================== DANGER ZONE (wipe data, ports Chatme dashboard) ==================== */

export async function wipeData(type: "messages" | "calls" | "statuses" | "announcements" | "activityLogs" | "all") {
  const paths = ["messages", "messagesAdmin", "calls", "statuses", "announcements", "activityLogs"];
  try {
    if (type === "all") {
      for (const p of paths) {
        await db.ref(p).remove();
      }
      adminLog("wipe", "Entire database wiped");
    } else if (type === "messages") {
      // Wipe both the user-visible and admin-visible copies
      await db.ref("messages").remove();
      await db.ref("messagesAdmin").remove();
      adminLog("wipe", "messages data wiped");
    } else {
      await db.ref(type).remove();
      adminLog("wipe", `${type} data wiped`);
    }
    return true;
  } catch {
    return false;
  }
}

/* ==================== EXPORT (JSON downloads, same as Chatme) ==================== */

function downloadJSON(data: unknown, prefix: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `chatbd_${prefix}_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportData(kind: "users" | "messages" | "calls" | "statuses" | "all") {
  try {
    if (kind === "users" || kind === "all") {
      const snap = await db.ref("users").once("value");
      const data: Record<string, unknown> = {};
      snap.forEach((child: { key: string | null; val: () => unknown }) => {
        data[child.key as string] = child.val();
      });
      downloadJSON(data, "users");
      adminLog("export", "User data exported");
    }
    if (kind === "messages" || kind === "all") {
      const snap = await db.ref("messages").once("value");
      const data: Record<string, unknown> = {};
      snap.forEach((chat: { key: string | null; forEach: (cb: (m: { key: string | null; val: () => unknown }) => void) => void }) => {
        const chatData: Record<string, unknown> = {};
        chat.forEach((m) => {
          chatData[m.key as string] = m.val();
        });
        data[chat.key as string] = chatData;
      });
      downloadJSON(data, "messages");
      adminLog("export", "Message data exported");
    }
    if (kind === "calls" || kind === "all") {
      const snap = await db.ref("calls").once("value");
      const data: Record<string, unknown> = {};
      snap.forEach((child: { key: string | null; val: () => unknown }) => {
        data[child.key as string] = child.val();
      });
      downloadJSON(data, "calls");
      adminLog("export", "Call data exported");
    }
    if (kind === "statuses" || kind === "all") {
      const snap = await db.ref("statuses").once("value");
      const data: Record<string, unknown> = {};
      snap.forEach((child: { key: string | null; val: () => unknown }) => {
        data[child.key as string] = child.val();
      });
      downloadJSON(data, "statuses");
      adminLog("export", "Status data exported");
    }
    /* full backup also includes announcements + settings (same as Chatme full backup) */
    if (kind === "all") {
      const [annSnap, setSnap] = await Promise.all([db.ref("announcements").once("value"), db.ref("settings").once("value")]);
      const ann: Record<string, unknown> = {};
      annSnap.forEach((child: { key: string | null; val: () => unknown }) => {
        ann[child.key as string] = child.val();
      });
      downloadJSON(ann, "announcements");
      downloadJSON(setSnap.val() || {}, "settings");
      adminLog("export", "Full backup exported");
    }
  } catch {
    /* ignore */
  }
}

/** Sign out helper. */
export async function adminLogout() {
  const admin = useAdmin.getState().admin;
  if (admin) {
    await db.ref(`users/${admin.uid}`).update({ isOnline: false, lastSeen: serverTimestamp }).catch(() => {});
    adminLog("logout", "Admin logged out");
  }
  detachAdminListeners();
  await auth.signOut();
}

/* ==================== GITHUB STORAGE MANAGER (private repo file browser) ==================== */

/** Load GitHub storage settings live from DB (so admin panel always uses
 *  the current credentials, never a stale cached copy). */
export async function getGithubSettings(): Promise<{ token: string; repo: string; branch: string }> {
  const snap = await db.ref("settings/githubStorage").once("value");
  const data = snap.val() || {};
  return { token: data.token || "", repo: data.repo || "", branch: data.branch || "main" };
}

function repoParts(repo: string): { owner: string; name: string } | null {
  const parts = repo.split("/");
  if (parts.length < 2 || !parts[0] || !parts[1]) return null;
  return { owner: parts[0], name: parts[1] };
}

export type GitHubFile = {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink" | "submodule";
  size: number;
  sha: string;
  download_url: string | null;
  url: string;
};

/** Test the GitHub connection by reading repo metadata. Returns repo info or null on failure. */
export async function testGithubConnection(): Promise<{ ok: boolean; message: string; info?: unknown }> {
  try {
    const { token, repo, branch } = await getGithubSettings();
    if (!token || !repo) return { ok: false, message: "GitHub token or repo not configured." };
    const parts = repoParts(repo);
    if (!parts) return { ok: false, message: "Invalid repo format (owner/repo)." };
    const resp = await fetch(`https://api.github.com/repos/${parts.owner}/${parts.name}`, {
      headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json" },
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      return { ok: false, message: `GitHub API error: ${err.message || resp.status}` };
    }
    const info = await resp.json();
    return {
      ok: true,
      message: `Connected to ${info.full_name} (${info.private ? "private" : "public"}). Default branch: ${info.default_branch}. Size: ${Math.round((info.size || 0) / 1024)} KB.`,
      info,
    };
  } catch (e) {
    return { ok: false, message: `Connection failed: ${(e as Error).message}` };
  }
}

/** List files in a directory of the configured repo.
 *  Pass empty path to list the repo root. */
export async function listGithubFiles(dirPath: string): Promise<GitHubFile[]> {
  const { token, repo, branch } = await getGithubSettings();
  if (!token || !repo) throw new Error("GitHub not configured");
  const parts = repoParts(repo);
  if (!parts) throw new Error("Invalid repo format");
  const url = `https://api.github.com/repos/${parts.owner}/${parts.name}/contents/${dirPath}?ref=${branch}`;
  const resp = await fetch(url, {
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json" },
  });
  if (resp.status === 404) return [];
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.message || `Failed to list files (${resp.status})`);
  }
  const data = await resp.json();
  if (!Array.isArray(data)) return [];
  return data as GitHubFile[];
}

/** Get a single file's content + metadata (for the edit dialog). */
export async function getGithubFile(filePath: string): Promise<{ content: string; sha: string; size: number; encoding: string }> {
  const { token, repo, branch } = await getGithubSettings();
  const parts = repoParts(repo);
  if (!parts) throw new Error("Invalid repo format");
  const resp = await fetch(
    `https://api.github.com/repos/${parts.owner}/${parts.name}/contents/${filePath}?ref=${branch}`,
    { headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json" } },
  );
  if (!resp.ok) throw new Error(`Failed to fetch file (${resp.status})`);
  const data = await resp.json();
  // GitHub returns base64-encoded content; decode for text files
  let content = "";
  if (data.encoding === "base64" && data.content) {
    content = atob(data.content.replace(/\n/g, ""));
  }
  return { content, sha: data.sha, size: data.size, encoding: data.encoding };
}

/** Delete a single file from the repo (requires its blob SHA). */
export async function deleteGithubFile(filePath: string): Promise<void> {
  const { token, repo, branch } = await getGithubSettings();
  const parts = repoParts(repo);
  if (!parts) throw new Error("Invalid repo format");
  // First fetch file metadata to get sha
  const metaResp = await fetch(
    `https://api.github.com/repos/${parts.owner}/${parts.name}/contents/${filePath}?ref=${branch}`,
    { headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json" } },
  );
  if (!metaResp.ok) throw new Error(`Could not find file (${metaResp.status})`);
  const meta = await metaResp.json();
  const delResp = await fetch(
    `https://api.github.com/repos/${parts.owner}/${parts.name}/contents/${filePath}`,
    {
      method: "DELETE",
      headers: { Authorization: `token ${token}`, "Content-Type": "application/json", Accept: "application/vnd.github+json" },
      body: JSON.stringify({ message: `Delete ${filePath}`, sha: meta.sha, branch }),
    },
  );
  if (!delResp.ok) {
    const err = await delResp.json().catch(() => ({}));
    throw new Error(err.message || `Delete failed (${delResp.status})`);
  }
  adminLog("storage_delete", `Deleted file ${filePath} from GitHub storage`);
}

/** Rename a file by moving it (delete old, create new with same content).
 *  Returns the OLD and NEW raw download URLs so the caller can migrate
 *  any Firebase records that still point at the old link. */
export async function renameGithubFile(oldPath: string, newName: string): Promise<{ oldUrl: string; newUrl: string }> {
  const { token, repo, branch } = await getGithubSettings();
  const parts = repoParts(repo);
  if (!parts) throw new Error("Invalid repo format");
  // Get old file content
  const metaResp = await fetch(
    `https://api.github.com/repos/${parts.owner}/${parts.name}/contents/${oldPath}?ref=${branch}`,
    { headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json" } },
  );
  if (!metaResp.ok) throw new Error(`Could not find file (${metaResp.status})`);
  const meta = await metaResp.json();
  const content = meta.content; // base64 content
  // Build new path (preserve directory prefix)
  const dir = oldPath.includes("/") ? oldPath.substring(0, oldPath.lastIndexOf("/")) : "";
  const newPath = dir ? `${dir}/${newName}` : newName;
  // Create new file with same content
  const createResp = await fetch(
    `https://api.github.com/repos/${parts.owner}/${parts.name}/contents/${newPath}`,
    {
      method: "PUT",
      headers: { Authorization: `token ${token}`, "Content-Type": "application/json", Accept: "application/vnd.github+json" },
      body: JSON.stringify({ message: `Rename ${oldPath} → ${newPath}`, content, branch }),
    },
  );
  if (!createResp.ok) {
    const err = await createResp.json().catch(() => ({}));
    throw new Error(err.message || `Rename: create failed (${createResp.status})`);
  }
  // Delete old file (now that new one exists)
  await fetch(`https://api.github.com/repos/${parts.owner}/${parts.name}/contents/${oldPath}`, {
    method: "DELETE",
    headers: { Authorization: `token ${token}`, "Content-Type": "application/json", Accept: "application/vnd.github+json" },
    body: JSON.stringify({ message: `Remove old path ${oldPath}`, sha: meta.sha, branch }),
  });
  adminLog("storage_rename", `Renamed ${oldPath} → ${newPath} in GitHub storage`);
  const oldUrl = `https://raw.githubusercontent.com/${parts.owner}/${parts.name}/${branch}/${oldPath}`;
  const newUrl = `https://raw.githubusercontent.com/${parts.owner}/${parts.name}/${branch}/${newPath}`;
  return { oldUrl, newUrl };
}

/** Upload a new file (admin "add item") into a directory of the repo. */
export async function uploadGithubFile(dirPath: string, file: File): Promise<string> {
  const { token, repo, branch } = await getGithubSettings();
  const parts = repoParts(repo);
  if (!parts) throw new Error("Invalid repo format");
  const b64 = await new Promise<string>((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = (reader.result as string).split(",");
      res(r.length > 1 ? r[1] : r[0]);
    };
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = dirPath ? `${dirPath}/${Date.now()}_${safeName}` : `${Date.now()}_${safeName}`;
  const resp = await fetch(`https://api.github.com/repos/${parts.owner}/${parts.name}/contents/${path}`, {
    method: "PUT",
    headers: { Authorization: `token ${token}`, "Content-Type": "application/json", Accept: "application/vnd.github+json" },
    body: JSON.stringify({ message: `Upload ${path}`, content: b64, branch }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.message || `Upload failed (${resp.status})`);
  }
  adminLog("storage_upload", `Uploaded file ${path} to GitHub storage`);
  return path;
}

/** Replace any Firebase record that references `oldUrl` with `newUrl`.
 *  Scans: users (photoUrl / coverUrl), messages + messagesAdmin (fileUrl).
 *  Returns the number of references updated. */
export async function migrateFileLinks(oldUrl: string, newUrl: string): Promise<number> {
  const updates: Promise<unknown>[] = [];
  let count = 0;

  // 1) Profile photos + cover banners
  try {
    const usersSnap = await db.ref("users").once("value");
    usersSnap.forEach((child) => {
      const u = child.val() as { photoUrl?: string; coverUrl?: string } | null;
      if (!u) return;
      if (u.photoUrl === oldUrl) {
        updates.push(db.ref(`users/${child.key}/photoUrl`).set(newUrl));
        count++;
      }
      if (u.coverUrl === oldUrl) {
        updates.push(db.ref(`users/${child.key}/coverUrl`).set(newUrl));
        count++;
      }
    });
  } catch { /* continue with messages */ }

  // 2) Chat attachments (user-visible + admin mirror)
  for (const root of ["messages", "messagesAdmin"]) {
    try {
      const snap = await db.ref(root).once("value");
      snap.forEach((chat) => {
        chat.forEach((msg) => {
          const v = msg.val() as { fileUrl?: string } | null;
          if (v?.fileUrl === oldUrl) {
            updates.push(db.ref(`${root}/${chat.key}/${msg.key}/fileUrl`).set(newUrl));
            count++;
          }
        });
      });
    } catch { /* skip root on failure */ }
  }

  await Promise.allSettled(updates);
  if (count > 0) adminLog("storage_link_migrate", `Migrated ${count} link(s) after file rename`);
  return count;
}

/** Fetch a repo file as a blob URL (token-authenticated) — required for
 *  thumbnails / previews / downloads when the repo is PRIVATE (raw URLs 404).
 *  Cached per path so repeat previews are instant. */
const adminBlobCache = new Map<string, string>();

export async function fetchGithubFileBlobUrl(filePath: string): Promise<string> {
  const cached = adminBlobCache.get(filePath);
  if (cached) return cached;
  const { token, repo, branch } = await getGithubSettings();
  const parts = repoParts(repo);
  if (!parts || !token) throw new Error("GitHub not configured");
  const resp = await fetch(
    `https://api.github.com/repos/${parts.owner}/${parts.name}/contents/${filePath}?ref=${branch}`,
    {
      headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.raw" },
    },
  );
  if (!resp.ok) throw new Error(`Could not fetch file (${resp.status})`);
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  adminBlobCache.set(filePath, url);
  return url;
}

/** Replace a text file's content (used by the Edit dialog). */
export async function updateGithubFile(filePath: string, newContent: string, sha: string): Promise<void> {
  const { token, repo, branch } = await getGithubSettings();
  const parts = repoParts(repo);
  if (!parts) throw new Error("Invalid repo format");
  // Encode to base64 (UTF-8 safe)
  const b64 = btoa(unescape(encodeURIComponent(newContent)));
  const resp = await fetch(`https://api.github.com/repos/${parts.owner}/${parts.name}/contents/${filePath}`, {
    method: "PUT",
    headers: { Authorization: `token ${token}`, "Content-Type": "application/json", Accept: "application/vnd.github+json" },
    body: JSON.stringify({ message: `Update ${filePath}`, content: b64, sha, branch }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.message || `Update failed (${resp.status})`);
  }
  adminLog("storage_update", `Updated file ${filePath} in GitHub storage`);
}

/** Recursively delete a directory's contents (GitHub has no native folder delete). */
export async function deleteGithubDirectory(dirPath: string): Promise<number> {
  const files = await listGithubFiles(dirPath);
  let count = 0;
  for (const f of files) {
    if (f.type === "file") {
      await deleteGithubFile(f.path);
      count++;
    } else if (f.type === "dir") {
      count += await deleteGithubDirectory(f.path);
    }
  }
  return count;
}

/* ==================== ADMIN-TO-USER DIRECT MESSAGING ==================== */

/** Send an admin broadcast message directly to a user's chat with the admin account.
 *  Writes to BOTH the user-visible messages path (admin is treated as a participant)
 *  and the admin-visible mirror for symmetry. */
export async function adminMessageUser(userUid: string, text: string) {
  const admin = useAdmin.getState().admin;
  if (!admin) throw new Error("Not signed in as admin");
  if (!text.trim()) throw new Error("Message cannot be empty");

  const chatId = [admin.uid, userUid].sort().join("_");
  const msgRef = db.ref(`messages/${chatId}`).push();
  const msgData: Record<string, unknown> = {
    senderId: admin.uid,
    text,
    timestamp: serverTimestamp,
    type: "text",
    isAdmin: true,
  };
  await msgRef.set(msgData);

  // Admin-visible plaintext mirror
  await db.ref(`messagesAdmin/${chatId}/${msgRef.key}`).set({
    senderId: admin.uid,
    senderName: `${admin.name || "Admin"} (Admin)`,
    text,
    timestamp: serverTimestamp,
    type: "text",
    isAdmin: true,
    receiverId: userUid,
  }).catch(() => {});

  // Ensure chat meta exists
  const [p1, p2] = [admin.uid, userUid].sort();
  await db.ref(`chats/${chatId}`).update({
    participant1: p1,
    participant2: p2,
    lastMessage: `Admin: ${text.substring(0, 100)}`,
    lastTimestamp: serverTimestamp,
    lastSender: admin.uid,
  });
  // Mark unread for the user
  await db.ref(`chats/${chatId}/unread/${userUid}`).set(serverTimestamp);
  adminLog("admin_message", `Sent direct message to user ${userUid}`);
  return msgRef.key as string;
}

/** Broadcast a system-style announcement to ALL user conversations (one message
 *  per user). Heavy operation — should be used sparingly. Returns count of messages sent. */
export async function adminBroadcastAll(text: string) {
  const admin = useAdmin.getState().admin;
  if (!admin) throw new Error("Not signed in as admin");
  if (!text.trim()) throw new Error("Message cannot be empty");

  const users = useAdmin.getState().users;
  let count = 0;
  for (const user of Object.values(users)) {
    if (user.uid === admin.uid) continue;
    try {
      await adminMessageUser(user.uid, text);
      count++;
    } catch {
      /* continue on per-user failure */
    }
  }
  adminLog("admin_broadcast", `Sent broadcast to ${count} users: ${text.substring(0, 80)}`);
  return count;
}
