"use client";

/**
 * ChatBD core store — ports every Firebase listener from the original
 * Chatme app (initializeApp / listenToUsers / listenToChats / presence /
 * announcements / statuses / calls / settings) into React state.
 */
import { create } from "zustand";

import type {
  Announcement,
  AppSettings,
  CallRecord,
  ChatFolder,
  ChatMessage,
  ChatMeta,
  GroupChat,
  ScheduledMessage,
  SessionInfo,
  StatusRecord,
  UserProfile,
} from "@/lib/types";
import type { Lang } from "@/lib/i18n";

export type ChatView = "inbox" | "statuses" | "calls" | "announcements" | "settings";

type ChatAppState = {
  /** null = logged out, undefined = loading */
  authUid: string | null | undefined;
  me: UserProfile | null;
  users: Record<string, UserProfile>;
  /** gid → GroupChat (only groups I'm a member of are kept) */
  groups: Record<string, GroupChat>;
  chats: Record<string, ChatMeta>;
  messages: ChatMessage[];
  activeChatUserId: string | null;
  activeMessagesLoading: boolean;
  statuses: StatusRecord[];
  calls: CallRecord[];
  announcements: Announcement[];
  settings: AppSettings;
  view: ChatView;
  newChatUserId: string | null;
  announcementBadge: number;
  typingOther: boolean;
  blocked: Record<string, boolean>;
  maintenance: boolean;
  registrationOpen: boolean;
  pinLocked: boolean;
  pinSetupMode: boolean;
  premiumModalOpen: boolean;
  /** Chat folders (inbox organisation). */
  folders: Record<string, ChatFolder>;
  /** My pending scheduled messages. */
  scheduled: ScheduledMessage[];
  /** My active login sessions (session management). */
  sessions: SessionInfo[];
  /** Incoming GROUP call (mesh WebRTC) — set when someone starts a group call in one of my groups. */
  incomingGroupCall: { gid: string; groupName: string; initiatorName: string; type: "audio" | "video" } | null;
};

export const useChatApp = create<ChatAppState>(() => ({
  authUid: undefined,
  me: null,
  users: {},
  groups: {},
  chats: {},
  messages: [],
  activeChatUserId: null,
  activeMessagesLoading: false,
  statuses: [],
  calls: [],
  announcements: [],
  settings: {},
  view: "inbox",
  newChatUserId: null,
  announcementBadge: 0,
  typingOther: false,
  blocked: {},
  maintenance: false,
  registrationOpen: true,
  pinLocked: false,
  pinSetupMode: false,
  premiumModalOpen: false,
  folders: {},
  scheduled: [],
  sessions: [],
  incomingGroupCall: null,
}));

/* ==================== UI store (dialogs etc.) ==================== */

type UiState = {
  newChatOpen: boolean;
  setNewChatOpen: (open: boolean) => void;
  /** Mobile: is the chat thread visible (slides in over inbox)? Set by search dropdown & conversation tap. */
  threadOpen: boolean;
  setThreadOpen: (open: boolean) => void;
};

export const useUiStore = create<UiState>((set) => ({
  newChatOpen: false,
  setNewChatOpen: (open) => set({ newChatOpen: open }),
  threadOpen: false,
  setThreadOpen: (open) => set({ threadOpen: open }),
}));

export const setAuthUid = (authUid: string | null | undefined) => useChatApp.setState({ authUid });
export const setMe = (me: UserProfile | null) => useChatApp.setState({ me });
export const setUsers = (users: Record<string, UserProfile>) => useChatApp.setState({ users });
export const setGroups = (groups: Record<string, GroupChat>) => useChatApp.setState({ groups });
export const setChats = (chats: Record<string, ChatMeta>) => useChatApp.setState({ chats });
export const setMessages = (messages: ChatMessage[]) => useChatApp.setState({ messages });
export const setMessagesLoading = (activeMessagesLoading: boolean) => useChatApp.setState({ activeMessagesLoading });
export const setActiveChatUser = (uid: string | null) =>
  useChatApp.setState({
    activeChatUserId: uid,
    messages: uid ? useChatApp.getState().messages : [],
    typingOther: false,
  });
export const setView = (view: ChatView) => useChatApp.setState({ view });
export const setNewChatUser = (newChatUserId: string | null) => useChatApp.setState({ newChatUserId });
export const setTypingOther = (typingOther: boolean) => useChatApp.setState({ typingOther });
export const setBlocked = (blocked: Record<string, boolean>) => useChatApp.setState({ blocked });
export const setFolders = (folders: Record<string, ChatFolder>) => useChatApp.setState({ folders });
export const setScheduled = (scheduled: ScheduledMessage[]) => useChatApp.setState({ scheduled });
export const setSessions = (sessions: SessionInfo[]) => useChatApp.setState({ sessions });
export const setIncomingGroupCall = (
  incomingGroupCall: ChatAppState["incomingGroupCall"],
) => useChatApp.setState({ incomingGroupCall });

/* ==================== Language selector (chat app) ==================== */
/** Current chat-app display language. Stored per-user at
 *  users/{uid}/settings/appearance/language — defaults to English. */
export function useAppLang(): Lang {
  const me = useChatApp((s) => s.me);
  const lang = me?.settings?.appearance?.language;
  return lang === "bn" ? "bn" : "en";
}

/* ==================== Message pagination bridge ==================== */
/** app-provider sets this; ChatThread's "Load earlier messages" button calls it. */
export const paginationBridge = {
  loadMore: null as (() => void) | null,
};
