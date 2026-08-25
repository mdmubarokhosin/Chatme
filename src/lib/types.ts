"use client";

/** Firebase Realtime Database entity shapes (identical to Chatme schema). */

export type UserProfile = {
  uid: string;
  uniqueId?: string | number;
  name?: string;
  email?: string;
  role?: "user" | "admin";
  isBanned?: boolean;
  isPremium?: boolean;
  isOnline?: boolean;
  lastSeen?: number;
  createdAt?: number;
  bio?: string;
  photoUrl?: string;
  /** Profile cover banner photo (banner shown behind avatar on profile/settings). */
  coverUrl?: string;
  /** LEGACY — public key published by the old E2EE build. Kept optional so
   *  existing database records keep type-checking. */
  e2eePublicKey?: string;
  blocked?: Record<string, boolean>;
  settings?: {
    notifications?: Record<string, boolean | string>;
    privacy?: Record<string, boolean | string>;
    /** Appearance prefs — `chatBubbles: false` renders this user's messages
     *  without bubble backgrounds for everyone in the conversation. */
    appearance?: Record<string, boolean | string>;
  };
  lastSeenAnnouncement?: number;
};

export type GroupChat = {
  gid: string;
  name?: string;
  description?: string;
  photoUrl?: string;
  createdBy?: string;
  createdAt?: number;
  /** uid → true */
  members?: Record<string, boolean>;
  /** uid → true (creator + promoted; can edit group, add/remove members) */
  admins?: Record<string, boolean>;
};

export type ChatMeta = {
  chatId: string;
  participant1?: string;
  participant2?: string;
  /** Group chat id ("g_...") — set for group conversations. */
  isGroup?: boolean;
  gid?: string;
  /** Disappearing messages timer: "off" | "24h" | "7d". */
  disappearing?: string;
  lastMessage?: string;
  lastTimestamp?: number;
  lastSender?: string;
  unread?: Record<string, number>;
  typing?: Record<string, boolean>;
  /** Per-user pin flag — pinned chats sort to top. */
  pinned?: Record<string, boolean>;
  /** Per-user mute flag — muted chats skip browser notifications & in-app alert. */
  muted?: Record<string, boolean>;
  /** Per-user archive flag — archived chats are hidden from the main inbox. */
  archived?: Record<string, boolean>;
};

export type ChatMessage = {
  key: string;
  senderId: string;
  text: string;
  timestamp?: number;
  type: "text" | "file" | "system";
  /** Disappearing-message expiry (ms epoch). Removed by cleanup once passed. */
  expiresAt?: number;
  /** LEGACY — true only for messages written by the old E2EE build. The app
   *  recovers their plaintext best-effort from the messagesAdmin mirror. */
  encrypted?: boolean;
  iv?: string;
  ephemeralPubKey?: string;
  senderText?: string;
  senderIv?: string;
  edited?: boolean;
  forwarded?: boolean;
  fileName?: string;
  fileSize?: number;
  fileType?: string;
  fileUrl?: string;
  fileData?: string;
  isImage?: boolean;
  isVoice?: boolean;
  replyTo?: { senderId: string; senderName: string; text: string };
  /** Emoji reactions keyed by uid → emoji string. Renders small chip cluster under bubble. */
  reactions?: Record<string, string>;
  /** Star (favourite) markers keyed by uid → true. Renders star on bubble. */
  starred?: Record<string, boolean>;
  /** Sticker message — text holds the emoji, rendered LARGE without a bubble. */
  sticker?: boolean;
  /** Read receipts — receiver's uid → read timestamp. Used to show blue double-tick. */
  readBy?: Record<string, number>;
  /** Admin-visible mirror only — populated when reading from messagesAdmin path. */
  senderName?: string;
  receiverId?: string;
  receiverName?: string;
  _decryptedText?: string;
};

export type CallRecord = {
  key: string;
  callerId: string;
  callerName?: string;
  receiverId: string;
  receiverName?: string;
  type: "audio" | "video";
  status: "ringing" | "connected" | "ended" | "declined" | "missed" | "busy";
  startTime?: number;
  endTime?: number;
  duration?: number;
};

export type StatusRecord = {
  key: string;
  userId: string;
  userName: string;
  text: string;
  color?: string;
  timestamp: number;
  expiresAt: number;
  viewers?: Record<string, boolean>;
  viewerCount?: number;
};

export type Announcement = {
  key: string;
  title: string;
  message: string;
  priority?: "normal" | "high";
  senderId?: string;
  timestamp?: number;
};

export type AppSettings = {
  maintenanceMode?: boolean;
  registrationOpen?: boolean;
  maxMessages?: number;
  welcomeMessage?: string;
  /** Comma-separated list of banned words — messages containing them are blocked. */
  bannedWords?: string;
  /** Anti-spam: max messages a user may send per minute (0 = unlimited). */
  rateLimitPerMinute?: number;
  /** Custom version label (admin-controllable) shown on top of Settings + footer. */
  versionText?: string;
  /** Custom footer text (admin-controllable) shown at the bottom of Settings. */
  footerText?: string;
  /** Admin panel display language ("en" | "bn") — platform-wide, default en. */
  adminLanguage?: string;
  githubStorage?: { token: string; repo: string; branch: string };
  premium?: {
    enabled?: boolean;
    maxFileSize?: number;
    allowedTypes?: string;
    price?: string;
    description?: string;
  };
};

export type ActivityLog = {
  key: string;
  action: string;
  userId?: string;
  userName?: string;
  details?: string;
  timestamp?: number;
};

/** A message scheduled for future delivery — stored at users/{uid}/scheduled/{key}. */
export type ScheduledMessage = {
  key: string;
  otherUid: string;
  otherName?: string;
  text: string;
  /** ms epoch — the processor sends the message once this time passes. */
  sendAt: number;
  createdAt?: number;
};

/** A user-defined chat folder (organise the inbox). Stored at users/{uid}/folders/{fid}. */
export type ChatFolder = {
  fid: string;
  name: string;
  emoji?: string;
  /** chatId → true */
  chatIds?: Record<string, boolean>;
  createdAt?: number;
};

/** An active login session of the current user. Stored at users/{uid}/sessions/{sid}. */
export type SessionInfo = {
  sid: string;
  device: string;
  browser: string;
  lastActive?: number;
  createdAt?: number;
};

export const STATUS_COLORS = [
  "#008069",
  "#0b141a",
  "#1f2c34",
  "#5b3a8e",
  "#8e3a5b",
  "#8e5b3a",
  "#3a6e8e",
  "#3a8e5b",
  "#c2185b",
  "#e65100",
  "#283593",
  "#455a64",
];

export const WALLPAPERS = [
  { id: "default", label: "Default" },
  { id: "doodle", label: "Doodle" },
  { id: "gradient", label: "Gradient" },
  { id: "midnight", label: "Midnight" },
  { id: "forest", label: "Forest" },
  { id: "ocean", label: "Ocean" },
] as const;
