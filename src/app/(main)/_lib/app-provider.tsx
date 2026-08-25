"use client";

/**
 * AppProvider — ports Chatme's `initializeApp()` + every real-time listener:
 * auth state (ban check + account recovery), presence, users, chats,
 * announcements (+badge), statuses (+24h expiry cleanup), call history and
 * remote settings (maintenance / registration / premium / message limit /
 * GitHub storage).
 *
 * Messages are stored as plaintext. Legacy messages written by the old E2EE
 * build are recovered best-effort from the `messagesAdmin/{chatId}` mirror.
 */
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { auth, db, generateUniqueId, serverTimestamp } from "@/lib/firebase";
import { installPrivateMediaInterceptor } from "@/lib/media-resolver";
import { showOsNotification } from "@/lib/notify";
import { registerPushToken, unregisterPushToken } from "@/lib/push";
import { t } from "@/lib/i18n";
import type {
  Announcement,
  AppSettings,
  ChatMeta,
  ChatMessage,
  GroupChat,
  StatusRecord,
  UserProfile,
} from "@/lib/types";

/** Minimal listener handle (avoids firebase namespace typing issues). */
type DbListener = { off: (event?: string, cb?: unknown) => void };
type RefWithOff = { off: (event?: string, cb?: unknown) => void };
type MsgListenerHandle = { ref: DbListener; cb: unknown };
type TypingListenerHandle = { ref: RefWithOff; cb: unknown };

type CallRecordLike = {
  key?: string;
  callerId?: string;
  callerName?: string;
  receiverId?: string;
  type?: "audio" | "video";
  status?: string;
  startTime?: number;
};

import {
  setAuthUid,
  setBlocked,
  setChats,
  setFolders,
  setGroups,
  setMessages,
  setMessagesLoading,
  setMe,
  setScheduled,
  setSessions,
  setUsers,
  useChatApp,
} from "./store";
import {
  loadGitHubSettings,
  setMessageMaxLimit,
  setPremiumSettings,
  setBannedWords,
  setRateLimit,
  registerSession,
  touchSession,
} from "./chat-actions";
import { paginationBridge } from "./store";
import { watchIncomingGroupCalls } from "./group-webrtc";
import type { ChatFolder, ScheduledMessage, SessionInfo } from "@/lib/types";
import { setActiveChatUser, setView } from "./store";

/** Browser notification for an incoming message. Routes through the service
 *  worker registration so it also works on Android Chrome, where the
 *  `new Notification()` constructor throws on SW-controlled pages. */
function sendBrowserNotification(title: string, body: string, data?: Record<string, unknown>) {
  if (typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "granted") return;
  showOsNotification({
    title,
    body: body.substring(0, 100),
    data: { ...(data || {}), url: data?.url || "/" },
  }).catch(() => {});
}

/** Short two-tone message sound (WebAudio, no asset needed). */
let notifAudioCtx: AudioContext | null = null;
function playNotificationSound() {
  try {
    if (!notifAudioCtx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      notifAudioCtx = new Ctor();
    }
    const ctx = notifAudioCtx;
    const now = ctx.currentTime;
    [880, 1174.7].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = now + i * 0.12;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.05, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.3);
    });
  } catch {
    /* ignore */
  }
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const activeChatUserId = useChatApp((s) => s.activeChatUserId);
  const authUid = useChatApp((s) => s.authUid);
  const msgListenerRef = useRef<MsgListenerHandle | null>(null);
  const typingListenerRef = useRef<TypingListenerHandle | null>(null);
  const initializedFor = useRef<string | null>(null);

  /* Private-repo media support: re-fetch uploads-repo images through the
     GitHub API (token-authenticated) when the direct raw URL 404s. */
  useEffect(() => {
    installPrivateMediaInterceptor();
  }, []);

  /* ==================== AUTH STATE + APP INIT (with retries, same as Chatme) ==================== */
  useEffect(() => {
    let isRegistering = false;
    (window as unknown as { __chatbd_registering?: boolean }).__chatbd_registering = false;
    Object.defineProperty(window, "__chatbd_set_registering", {
      value: (v: boolean) => {
        isRegistering = v;
      },
      writable: true,
      configurable: true,
    });

    const unsub = auth.onAuthStateChanged(async (user) => {
      if (user) {
        if (isRegistering) return;

            // Ban check with 3 retries
        let isBanned = false;
        for (let retry = 0; retry < 3; retry++) {
          try {
            const snapshot = await db.ref(`users/${user.uid}/isBanned`).once("value");
            isBanned = snapshot.val() === true;
            break;
          } catch {
            if (retry < 2) await new Promise((r) => setTimeout(r, 1000));
          }
        }
        if (isBanned) {
          await auth.signOut();
          setAuthUid(null);
          toast.error("Your account has been banned. Contact the administrator.");
          return;
        }

        setAuthUid(user.uid);

        // Load user profile with 5 retries
        let userSnap: { val: () => UserProfile | null } | null = null;
        for (let attempt = 1; attempt <= 5; attempt++) {
          try {
            const snap = await db.ref(`users/${user.uid}`).once("value");
            userSnap = snap;
            break;
          } catch {
            if (attempt < 5) await new Promise((r) => setTimeout(r, 1200 * attempt));
          }
        }
        let meData = userSnap ? userSnap.val() : null;

        // Account recovery (3 attempts) — identical to Chatme
        if (!meData) {
          let recovered = false;
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              const uniqueId = await generateUniqueId();
              const recoveryData: Record<string, unknown> = {
                uid: user.uid,
                uniqueId,
                name: user.displayName || (user.email ? user.email.split("@")[0] : "") || "User",
                email: user.email || "",
                role: "user",
                isBanned: false,
                isOnline: false,
                lastSeen: serverTimestamp,
                createdAt: serverTimestamp,
                bio: "",
              };
              await db.ref(`uniqueIds/${uniqueId}`).set(true);
              await db.ref(`users/${user.uid}`).set(recoveryData);
              meData = recoveryData as unknown as UserProfile;
              toast.success("Account recovered!");
              recovered = true;
              break;
            } catch {
              if (attempt < 3) await new Promise((r) => setTimeout(r, 1500));
            }
          }
          if (!recovered) {
            await auth.signOut();
            setAuthUid(null);
            toast.error("Could not load user data. Check your connection and try again.");
            return;
          }
        }

        setMe(meData);

        if (initializedFor.current !== user.uid) {
          initializedFor.current = user.uid;
          setupPresence(user.uid);
          listenToUsers(user.uid);
          listenToGroups(user.uid);
          listenToChats(user.uid);
          listenToAnnouncements(user.uid);
          listenToStatuses();
          listenToCalls(user.uid);
          listenToSettings();
          listenToFolders(user.uid);
          listenToScheduled(user.uid);
          listenToSessions(user.uid);
          setupGroupCallWatcher(user.uid);
          setupAutoLock(user.uid);
          attachServiceWorkerRouter();
          registerSession(user.uid).then((sid) => {
            if (sid) {
              const iv = setInterval(() => touchSession(user.uid, sid), 60000);
              (window as unknown as { __chatbd_session_timer?: ReturnType<typeof setInterval> }).__chatbd_session_timer = iv;
            }
          });
          loadGitHubSettings().then(() => {
            /* settings ready */
          });
          requestNotificationPermission();
          /* FCM web push — registers this browser's token under
             users/{uid}/fcmTokens so Cloud Functions can push calls & messages. */
          registerPushToken(user.uid).catch(() => {});
          /* Push-notification deep links: /?call=KEY&action=accept|decline,
             /?gcall=gid&action=join, /?chat=uid */
          handleLaunchDeepLinks();
          checkFingerprintLock(user.uid);
        }
      } else {
        if (isRegistering) return;
        initializedFor.current = null;
        detachAll();
        unregisterPushToken().catch(() => {});
        setAuthUid(null);
        setMe(null);
        setUsers({});
        setGroups({});
        setChats({});
        setMessages([]);
        setBlocked({});
      }
    });

    function detachAll() {
      db.ref("users").off();
      db.ref("groups").off();
      db.ref("chats").off();
      db.ref(".info/connected").off();
      db.ref("statuses").off();
      db.ref("calls").off();
      db.ref("callSignals").off();
      db.ref("announcements").off();
      db.ref("settings").off();
      db.ref("groupCalls").off();
      db.ref("groupCallSignals").off();
      const sessionTimer = (window as unknown as { __chatbd_session_timer?: ReturnType<typeof setInterval> }).__chatbd_session_timer;
      if (sessionTimer) clearInterval(sessionTimer);
      if (msgListenerRef.current) {
        msgListenerRef.current.ref.off("value", msgListenerRef.current.cb);
        msgListenerRef.current = null;
      }
      if (typingListenerRef.current) {
        typingListenerRef.current.ref.off("value", typingListenerRef.current.cb);
        typingListenerRef.current = null;
      }
    }

    return () => {
      unsub();
      detachAll();
    };
  }, []);

  /* ==================== BROWSER NOTIFICATION PERMISSION ==================== */
  function requestNotificationPermission() {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }

  /* ==================== PUSH DEEP LINKS (/?call= /?gcall= /?chat=) ==================== */

  /** Parse launch/deep-link params and act on them (accept/decline/join/open chat). */
  function handleLaunchDeepLinks(params?: URLSearchParams) {
    try {
      const p = params || new URLSearchParams(window.location.search);
      const callKey = p.get("call");
      const gcallGid = p.get("gcall");
      const action = p.get("action");
      const chatParam = p.get("chat");
      if (!callKey && !gcallGid && !chatParam) return;
      if (!params) {
        // Clean the URL so a refresh doesn't repeat the action
        window.history.replaceState({}, document.title, window.location.pathname);
      }

      const uid = useChatApp.getState().authUid;
      const meState = useChatApp.getState().me;
      if (!uid || !meState) return;

      if (chatParam) {
        setView("inbox");
        setActiveChatUser(chatParam);
      }

      if (callKey) {
        import("./webrtc").then(async (w) => {
          if (action === "decline") {
            await w.declineIncomingCall(callKey);
          } else if (action === "accept") {
            await w.acceptIncomingCallByKey(uid, callKey);
          }
          /* No action = plain tap: the realtime listener shows the ringing dialog. */
        });
      }

      if (gcallGid && action === "join") {
        import("./group-webrtc").then(async (g) => {
          const snap = await db.ref(`groups/${gcallGid}/name`).once("value").catch(() => null);
          const groupName = (snap?.val() as string) || "Group";
          g.joinGroupCall(gcallGid, groupName, uid, meState.name || "You");
        });
      }
    } catch {
      /* ignore */
    }
  }

  /** Route service-worker notification clicks (chatbd-navigate messages). */
  let swRouterAttached = false;
  function attachServiceWorkerRouter() {
    if (swRouterAttached || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    swRouterAttached = true;
    navigator.serviceWorker.addEventListener("message", (event: MessageEvent) => {
      const data = (event.data || {}) as { type?: string; url?: string };
      if (data.type === "chatbd-navigate" && data.url) {
        try {
          const u = new URL(data.url, window.location.origin);
          handleLaunchDeepLinks(u.searchParams);
        } catch {
          /* ignore */
        }
      }
    });
  }

  /* ==================== FINGERPRINT / PIN LOCK (same as Chatme) ==================== */
  function checkFingerprintLock(uid: string) {
    db.ref(`users/${uid}/settings/privacy/fingerprintLock`)
      .once("value")
      .then((snap: { val: () => boolean | null }) => {
        if (snap.val()) {
          useChatApp.setState({ pinLocked: true });
        }
      })
      .catch(() => {});
  }

  /* ==================== PRESENCE ==================== */
  function setupPresence(uid: string) {
    const userRef = db.ref(`users/${uid}`);
    const connectedRef = db.ref(".info/connected");
    connectedRef.on("value", (snapshot) => {
      if (snapshot.val() === true) {
        userRef.update({ isOnline: true, lastSeen: serverTimestamp });
        userRef.onDisconnect().update({ isOnline: false, lastSeen: serverTimestamp });
      }
    });
  }

  /* ==================== USERS ==================== */
  function listenToUsers(myUid: string) {
    db.ref("users").on("value", (snapshot: { forEach: (cb: (child: { key: string | null; val: () => unknown }) => void) => void }) => {
      const users: Record<string, UserProfile> = {};
      snapshot.forEach((child) => {
        if (child.key !== myUid) {
          users[child.key as string] = { uid: child.key as string, ...(child.val() as object) } as UserProfile;
        }
      });
      setUsers(users);
      const me = useChatApp.getState().me;
      if (me && me.blocked) setBlocked(me.blocked);
    });
  }

  /* ==================== GROUPS ==================== */
  function listenToGroups(myUid: string) {
    db.ref("groups").on("value", (snapshot: { forEach: (cb: (child: { key: string | null; val: () => unknown }) => void) => void }) => {
      const groups: Record<string, GroupChat> = {};
      snapshot.forEach((child) => {
        const g = { gid: child.key as string, ...(child.val() as object) } as GroupChat;
        if (g.members && g.members[myUid]) groups[g.gid] = g;
      });
      setGroups(groups);
    });
  }

  /* ==================== CHATS (+ incoming message browser notifications) ==================== */
  const lastSeenChatTimestamps = useRef<Record<string, number>>({});

  function listenToChats(myUid: string) {
    db.ref("chats")
      .orderByChild("lastTimestamp")
      .on("value", (snapshot: { forEach: (cb: (child: { key: string | null; val: () => unknown }) => void) => void }) => {
        const chats: Record<string, ChatMeta> = {};
        snapshot.forEach((child) => {
          const chat = child.val() as ChatMeta;
          const chatId = child.key as string;
          let include = false;
          if (chat.participant1 === myUid || chat.participant2 === myUid) {
            include = true;
          } else if (chat.isGroup && chat.gid) {
            // Group chat meta — include only if I'm still a member
            const groups = useChatApp.getState().groups;
            include = !!groups[chat.gid]?.members?.[myUid];
          }
          if (!include) return;
          chats[chatId] = { ...chat, chatId };

          /* Incoming message → browser notification (Chatme feature) */
          const prevTs = lastSeenChatTimestamps.current[chatId];
          const newTs = chat.lastTimestamp || 0;
          if (
            prevTs !== undefined &&
            newTs > prevTs &&
            chat.lastSender &&
            chat.lastSender !== myUid
          ) {
            const state = useChatApp.getState();
            const isActiveChat = state.activeChatUserId === (chat.isGroup ? chatId : (chat.participant1 === myUid ? chat.participant2 : chat.participant1));
            const notifEnabled = state.me?.settings?.notifications?.messageNotif !== false;
            const isMuted = !!(chat.muted && chat.muted[myUid]);
            if (!isActiveChat && notifEnabled && !state.pinLocked && !isMuted) {
              const previewAllowed = state.me?.settings?.notifications?.showPreview !== false;
              const tone = String(state.me?.settings?.notifications?.notifTone || "default");
              let title = "ChatBD";
              if (chat.isGroup) {
                title = state.groups[chat.gid as string]?.name || "Group";
              } else {
                const otherUid = chat.participant1 === myUid ? chat.participant2 : chat.participant1;
                title = `New message from ${state.users[otherUid as string]?.name || "ChatBD"}`;
              }
              const groupOk = !chat.isGroup || state.me?.settings?.notifications?.groupNotif !== false;
              if (groupOk) {
                sendBrowserNotification(
                  title,
                  previewAllowed
                    ? chat.lastMessage || "You have a new message"
                    : "You have a new message",
                );
                if (tone !== "silent") playNotificationSound();
              }
            }
          }
          if (newTs) lastSeenChatTimestamps.current[chatId] = newTs;
        });
        setChats(chats);
      });
  }

  /* ==================== ANNOUNCEMENTS (+badge) ==================== */
  function listenToAnnouncements(myUid: string) {
    let lastSeenAnnouncementTime = 0;
    db.ref(`users/${myUid}/lastSeenAnnouncement`)
      .once("value")
      .then((snap: { val: () => number | null }) => {
        lastSeenAnnouncementTime = snap.val() || 0;
      });

    db.ref("announcements")
      .orderByChild("timestamp")
      .limitToLast(50)
      .on("value", (snapshot: { forEach: (cb: (child: { key: string | null; val: () => unknown }) => void) => void }) => {
        const list: Announcement[] = [];
        let badge = 0;
        snapshot.forEach((child) => {
          const a = { key: child.key as string, ...(child.val() as object) } as Announcement;
          list.push(a);
          if ((a.timestamp || 0) > lastSeenAnnouncementTime) badge++;
        });
        list.reverse();
        useChatApp.setState({ announcements: list, announcementBadge: badge });
      });
  }

  /* ==================== STATUSES (24h expiry cleanup) ==================== */
  function listenToStatuses() {
    db.ref("statuses").on("value", (snap: { forEach: (cb: (child: { key: string | null; val: () => unknown }) => void) => void }) => {
      const now = Date.now();
      const list: StatusRecord[] = [];
      const expired: string[] = [];
      snap.forEach((child) => {
        const s = { key: child.key as string, ...(child.val() as object) } as StatusRecord;
        if (now > (s.expiresAt || 0)) {
          expired.push(child.key as string);
          return;
        }
        list.push(s);
      });
      expired.forEach((key) => db.ref(`statuses/${key}`).remove().catch(() => {}));
      list.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      useChatApp.setState({ statuses: list });
    });
  }

  /* ==================== CALLS (+ missed-call notifications) ==================== */
  function listenToCalls(myUid: string) {
    const listenStart = Date.now();
    const notifiedMissed = new Set<string>();
    db.ref("calls").on("value", (snap: { forEach: (cb: (child: { key: string | null; val: () => unknown }) => void) => void }) => {
      const list: CallRecordLike[] = [];
      snap.forEach((child) => {
        const c = { key: child.key as string, ...(child.val() as object) } as CallRecordLike;
        if (c.callerId === myUid || c.receiverId === myUid) list.push(c);

        /* Missed / busy-call notification — only for calls that started after
           this listener attached (fresh events), never for history on boot. */
        if (
          c.receiverId === myUid &&
          (c.status === "missed" || c.status === "busy") &&
          c.key &&
          (c.startTime || 0) >= listenStart - 15000 &&
          !notifiedMissed.has(c.key)
        ) {
          notifiedMissed.add(c.key);
          const state = useChatApp.getState();
          if (state.me?.settings?.notifications?.callNotif !== false && !state.pinLocked) {
            const lang = state.me?.settings?.appearance?.language === "bn" ? "bn" : "en";
            const name = c.callerName || state.users[c.callerId || ""]?.name || "Unknown";
            const callType = c.type === "video" ? t(lang, "gcall.videoCall") : t(lang, "gcall.audioCall");
            sendBrowserNotification(
              `${t(lang, "call.missed")} — ${name}`,
              c.status === "busy" ? t(lang, "call.onAnotherCall") : `${callType} · ${t(lang, "call.notAnswered")}`,
            );
            playNotificationSound();
          }
        }
      });
      list.sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
      useChatApp.setState({ calls: list as never });
    });
  }

  /* ==================== REMOTE SETTINGS ==================== */
  function listenToSettings() {
    db.ref("settings").on("value", (snap) => {
      const settings = (snap.val() || {}) as AppSettings;
      useChatApp.setState({
        settings,
        maintenance: settings.maintenanceMode === true,
        registrationOpen: settings.registrationOpen !== false,
      });
      if (settings.maxMessages) setMessageMaxLimit(settings.maxMessages);
      if (settings.premium) setPremiumSettings(settings.premium as { enabled: boolean; maxFileSize?: number });
      if (typeof settings.bannedWords === "string") setBannedWords(settings.bannedWords);
      if (settings.rateLimitPerMinute) setRateLimit(Number(settings.rateLimitPerMinute) || 0);
    });
  }

  /* ==================== CHAT FOLDERS ==================== */
  function listenToFolders(uid: string) {
    db.ref(`users/${uid}/folders`).on("value", (snap: { forEach: (cb: (child: { key: string | null; val: () => unknown }) => void) => void }) => {
      const folders: Record<string, ChatFolder> = {};
      snap.forEach((child) => {
        if (child.key) folders[child.key] = { fid: child.key, ...(child.val() as object) } as ChatFolder;
      });
      setFolders(folders);
    });
  }

  /* ==================== SCHEDULED MESSAGES + DELIVERY PROCESSOR ==================== */
  function listenToScheduled(uid: string) {
    db.ref(`users/${uid}/scheduled`).on("value", (snap) => {
      const list: ScheduledMessage[] = [];
      snap.forEach((child: { key: string | null; val: () => unknown }) => {
        list.push({ key: child.key as string, ...(child.val() as object) } as ScheduledMessage);
      });
      list.sort((a, b) => (a.sendAt || 0) - (b.sendAt || 0));
      setScheduled(list);
    });
  }

  /* Every 30s: deliver due scheduled messages. The item is CLAIMED (removed
     from the DB) before sending so two open tabs can never double-send, and
     hidden tabs also run (timers are throttled but still fire). */
  useEffect(() => {
    if (!authUid) return;
    const interval = setInterval(async () => {
      try {
        const state = useChatApp.getState();
        const due = state.scheduled.filter((s) => s.sendAt <= Date.now());
        if (due.length === 0) return;
        const { sendMessage } = await import("./chat-actions");
        for (const item of due) {
          /* Claim-first transaction: the tab that sees a non-null current
             value wins and deletes the node; the loser sees null and skips. */
          const res = await db
            .ref(`users/${authUid}/scheduled/${item.key}`)
            .transaction((cur: unknown) => null)
            .catch(() => null);
          if (!res || !res.committed) continue;
          const existed = !!(res.snapshot && res.snapshot.val() != null);
          if (!existed) continue; // another tab already claimed it
          await sendMessage({
            myUid: authUid,
            otherUid: item.otherUid,
            text: item.text,
            users: state.users,
          });
        }
      } catch {
        /* ignore */
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [authUid]);

  /* ==================== LOGIN SESSIONS ==================== */
  function listenToSessions(uid: string) {
    db.ref(`users/${uid}/sessions`).on("value", (snap) => {
      const list: SessionInfo[] = [];
      snap.forEach((child: { key: string | null; val: () => unknown }) => {
        list.push({ sid: child.key as string, ...(child.val() as object) } as SessionInfo);
      });
      list.sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0));
      setSessions(list);
    });
  }

  /* ==================== GROUP CALL WATCHER ==================== */
  const groupCallWatchOff = useRef<(() => void) | null>(null);
  function setupGroupCallWatcher(uid: string) {
    groupCallWatchOff.current?.();
    groupCallWatchOff.current = watchIncomingGroupCalls(
      uid,
      () => Object.keys(useChatApp.getState().groups),
      (info) => {
        useChatApp.setState({ incomingGroupCall: info });
        /* Ringtone + OS notification (hidden tabs) are handled by
           IncomingGroupCallDialog — kept in one place to avoid duplicates. */
      },
    );
  }
  useEffect(() => () => groupCallWatchOff.current?.(), []);

  /* ==================== 2FA AUTO-LOCK (inactivity) ==================== */
  function setupAutoLock(uid: string) {
    let minutes = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const readSetting = () => {
      db.ref(`users/${uid}/settings/privacy/autoLockMinutes`)
        .once("value")
        .then((snap: { val: () => number | null }) => {
          minutes = Number(snap.val()) || 0;
        })
        .catch(() => {});
    };
    readSetting();
    /* re-read the setting when it changes */
    const settingsRef = db.ref(`users/${uid}/settings/privacy/autoLockMinutes`);
    const settingsCb = (snap: { val: () => number | null }) => {
      minutes = Number(snap.val()) || 0;
      schedule();
    };
    settingsRef.on("value", settingsCb);

    const lock = () => {
      const state = useChatApp.getState();
      if (state.pinLocked || !state.me) return;
      /* only lock if a PIN exists (the lock screen needs a code to unlock) */
      if (!localStorage.getItem("chatbd-pin")) return;
      useChatApp.setState({ pinLocked: true });
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      if (minutes > 0) timer = setTimeout(lock, minutes * 60000);
    };

    const onActivity = () => schedule();
    window.addEventListener("mousemove", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity, { passive: true });
    window.addEventListener("touchstart", onActivity, { passive: true });
    window.addEventListener("visibilitychange", onActivity);
    schedule();

    (window as unknown as { __chatbd_autolock_cleanup?: () => void }).__chatbd_autolock_cleanup = () => {
      settingsRef.off("value", settingsCb);
      if (timer) clearTimeout(timer);
      window.removeEventListener("mousemove", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("touchstart", onActivity);
      window.removeEventListener("visibilitychange", onActivity);
    };
  }

  /* ==================== ACTIVE CHAT MESSAGES + TYPING + UNREAD ==================== */
  const msgLimitRef = useRef(50);

  useEffect(() => {
    if (!authUid || !activeChatUserId) {
      if (msgListenerRef.current) {
        msgListenerRef.current.ref.off("value", msgListenerRef.current.cb);
        msgListenerRef.current = null;
      }
      if (typingListenerRef.current) {
        typingListenerRef.current.ref.off("value", typingListenerRef.current.cb);
        typingListenerRef.current = null;
      }
      paginationBridge.loadMore = null;
      return;
    }

    // Group chats keep their id directly ("g_{gid}"); 1:1 chats sort both uids
    const chatId = activeChatUserId.startsWith("g_")
      ? activeChatUserId
      : [authUid, activeChatUserId].sort().join("_");
    setMessagesLoading(true);
    msgLimitRef.current = 50;

    // Ensure chat meta exists (same as Chatme) — 1:1 only; groups create it on creation
    if (!activeChatUserId.startsWith("g_")) {
      const chatRef = db.ref(`chats/${chatId}`);
      chatRef.once("value").then((snap) => {
        if (!snap.exists()) {
          const [p1, p2] = [authUid, activeChatUserId].sort();
          chatRef.set({
            participant1: p1,
            participant2: p2,
            lastMessage: "",
            lastTimestamp: serverTimestamp,
            lastSender: "",
          });
        }
      });
    }

    // Clear my unread marker when opening the chat
    db.ref(`chats/${chatId}/unread/${authUid}`).remove().catch(() => {});

    /* Disappearing messages: silently remove expired messages for both
       the visible path and the admin mirror (best-effort). */
    function cleanupExpired() {
      db.ref(`messages/${chatId}`)
        .once("value")
        .then((snap: { forEach: (cb: (child: { key: string | null; val: () => { expiresAt?: number } }) => void) => void }) => {
          const now = Date.now();
          snap.forEach((child) => {
            const v = child.val();
            if (v?.expiresAt && v.expiresAt <= now) {
              db.ref(`messages/${chatId}/${child.key}`).remove().catch(() => {});
              db.ref(`messagesAdmin/${chatId}/${child.key}`).remove().catch(() => {});
            }
          });
        })
        .catch(() => {});
    }
    cleanupExpired();
    const expiryTimer = setInterval(cleanupExpired, 30000);

    const processMessages = async (raw: ChatMessage[]) => {
      const hasLegacy = raw.some((m) => m.encrypted);
      let adminMirror: Record<string, { text?: string }> = {};
      if (hasLegacy) {
        try {
          const snap = await db.ref(`messagesAdmin/${chatId}`).once("value");
          const val = (snap.val() || {}) as Record<string, { text?: string }>;
          adminMirror = val;
        } catch {
          /* mirror unreadable — show placeholder for legacy messages */
        }
      }
      const out: ChatMessage[] = raw.map((item) => {
        if (item.encrypted) {
          // Legacy E2EE message — the admin mirror holds the plaintext copy
          const mirrorText = adminMirror[item.key]?.text;
          item._decryptedText = typeof mirrorText === "string" && mirrorText.length > 0 ? mirrorText : "🔒 Encrypted message";
        }
        return item;
      });
      setMessages(out);
      setMessagesLoading(false);
    };

    const attachListener = (limit: number) => {
      const msgRef = db.ref(`messages/${chatId}`).orderByChild("timestamp").limitToLast(limit);
      const cb = msgRef.on("value", async (snapshot: { forEach: (cb: (child: { key: string | null; val: () => unknown }) => void) => void }) => {
        const raw: ChatMessage[] = [];
        snapshot.forEach((child) => {
          raw.push({ key: child.key as string, ...(child.val() as object) } as ChatMessage);
        });
        await processMessages(raw);
      });
      if (msgListenerRef.current) {
        msgListenerRef.current.ref.off("value", msgListenerRef.current.cb);
      }
      msgListenerRef.current = { ref: msgRef as unknown as DbListener, cb };
    };
    attachListener(msgLimitRef.current);

    // "Load earlier messages" — ChatThread's button calls this via paginationBridge
    paginationBridge.loadMore = () => {
      msgLimitRef.current += 50;
      attachListener(msgLimitRef.current);
    };
    const loadMoreRefCleanup = () => {
      paginationBridge.loadMore = null;
    };

    // Typing indicator for the other user
    const typingRef = db.ref(`chats/${chatId}/typing/${activeChatUserId}`);
    const typingCb = (snap: { val: () => unknown }) => {
      useChatApp.setState({ typingOther: !!snap.val() });
    };
    typingRef.on("value", typingCb);
    typingListenerRef.current = { ref: typingRef as unknown as RefWithOff, cb: typingCb };

    return () => {
      clearInterval(expiryTimer);
      loadMoreRefCleanup();
      if (msgListenerRef.current) {
        msgListenerRef.current.ref.off("value", msgListenerRef.current.cb);
        msgListenerRef.current = null;
      }
      if (typingListenerRef.current) {
        typingListenerRef.current.ref.off("value", typingListenerRef.current.cb);
        typingListenerRef.current = null;
      }
    };
  }, [authUid, activeChatUserId]);

  /* ==================== PROFILE SELF-LISTENER (live me updates) ==================== */
  useEffect(() => {
    if (!authUid) return;
    const ref = db.ref(`users/${authUid}`);
    const cb = (snap: { val: () => UserProfile | null }) => {
      const val = snap.val();
      if (val) {
        setMe({ ...val, uid: authUid });
        if (val.blocked) setBlocked(val.blocked);
      }
    };
    ref.on("value", cb);
    return () => ref.off("value", cb);
  }, [authUid]);

  return <>{children}</>;
}
