"use client";

/**
 * ChatThread — multi-player's thread design wired to Firebase:
 * real-time messages, reply / edit / delete / forward, image, file &
 * voice messages, typing indicator, WebRTC call buttons and unread receipts.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  ArrowLeft,
  Check,
  CheckCheck,
  Copy,
  CornerUpLeft,
  File as FileIcon,
  Flag,
  Forward,
  Image as ImageIcon,
  Languages,
  Loader2,
  Lock,
  Mic,
  MicOff,
  MonitorUp,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Phone,
  PhoneCall,
  Pin,
  Play,
  Search,
  Send,
  Smile,
  Star,
  Square,
  Timer,
  Trash2,
  Users,
  Video,
  X,
  BellOff,
  CalendarClock,
  Circle,
  Gauge,
  Link2,
  MessageCircle,
  Volume2,
} from "lucide-react";

import { Avatar, AvatarBadge, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupTextarea } from "@/components/ui/input-group";
import { Marker, MarkerContent } from "@/components/ui/marker";
import { Message, MessageAvatar, MessageContent, MessageFooter } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn, getInitials } from "@/lib/utils";
import { formatFileSize, formatMessageTime, formatTime, formatVoiceTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { resolveMediaUrl, useMediaSrc } from "@/lib/media-resolver";
import { db } from "@/lib/firebase";
import type { ChatMessage, UserProfile } from "@/lib/types";

import {
  checkBlockedBy,
  checkFileSizeAllowed,
  deleteMessage,
  forwardMessage,
  markMessageRead,
  notifyTyping,
  sendMessage,
  sendFileMessage,
  setDisappearing,
  stopTyping,
  toggleMuteChat,
  togglePinChat,
  toggleReaction,
  toggleStarMessage,
  translateMessage,
  scheduleMessage,
} from "../_lib/chat-actions";
import { setActiveChatUser, useChatApp, useAppLang, paginationBridge } from "../_lib/store";
import { startCall } from "../_lib/webrtc";

const EMOJIS = ["😀", "😂", "🥹", "😊", "😍", "🤔", "😎", "😭", "😡", "👍", "👎", "🙏", "👏", "💪", "🔥", "❤️", "💚", "💙", "🎉", "🤝"];
const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
const STICKERS = ["🎉", "🔥", "❤️", "😂", "👍", "🙏", "😎", "🥳", "😭", "😡", "🤯", "🥰", "😴", "🤝", "💯", "⚡", "🌟", "🎁", "🐱", "🐶"];

/* Browser dictation — Web Speech API (Chrome/Edge/Safari). */
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};
function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

/* URL extraction for link previews. */
function extractFirstUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?/);
  return m ? m[0] : null;
}

interface ChatThreadProps {
  contact: UserProfile;
  onOpenContact?: () => void;
  onBack?: () => void;
  showBackButton?: boolean;
  className?: string;
}

export function ChatThread({ contact, onOpenContact, onBack, showBackButton, className }: ChatThreadProps) {
  const me = useChatApp((s) => s.me);
  const users = useChatApp((s) => s.users);
  const messages = useChatApp((s) => s.messages);
  const typingOther = useChatApp((s) => s.typingOther);
  const lang = useAppLang();
  const tr = (key: string) => t(lang, key);

  const isGroupChat = contact.uid.startsWith("g_");
  const chatId = isGroupChat
    ? contact.uid
    : [me?.uid || "", contact.uid || ""].sort().join("_");

  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [voiceSeconds, setVoiceSeconds] = useState(0);
  const [imageViewer, setImageViewer] = useState<string | null>(null);
  const [forwarding, setForwarding] = useState<ChatMessage | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [chatMeta, setChatMeta] = useState<{ pinned?: boolean; muted?: boolean; disappearing?: string }>({});
  const [mediaOpen, setMediaOpen] = useState(false);
  const [mediaItems, setMediaItems] = useState<ChatMessage[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [dictating, setDictating] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState("");
  const [starredOpen, setStarredOpen] = useState(false);
  const draftKey = `chatbd-draft-${contact.uid}`;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const voiceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const notesKey = contact.uid ? `chatbd-notes-${contact.uid}` : "";
  const [wallpaper, setWallpaper] = useState("default");

  /* apply chat wallpaper preference */
  useEffect(() => {
    setWallpaper(localStorage.getItem("chatbd-wallpaper") || "default");
    const onStorage = () => setWallpaper(localStorage.getItem("chatbd-wallpaper") || "default");
    window.addEventListener("chatbd-wallpaper-change", onStorage);
    return () => window.removeEventListener("chatbd-wallpaper-change", onStorage);
  }, []);

  /* local notes (Internal note tab) */
  useEffect(() => {
    if (notesKey) {
      setNotes(JSON.parse(localStorage.getItem(notesKey) || "{}"));
    }
  }, [notesKey]);

  /* Chat bubble preference — each side controls how THEIR OWN messages render
     for everyone: my bubbles come from my settings, the contact's bubbles come
     from their settings. */
  const myBubbles = me?.settings?.appearance?.chatBubbles !== false;
  const contactBubbles = contact.settings?.appearance?.chatBubbles !== false;

  /* Live chat meta (pin/mute/disappearing state for the current user) */
  useEffect(() => {
    if (!me?.uid || !contact.uid) return;
    const cid = contact.uid.startsWith("g_") ? contact.uid : [me.uid, contact.uid].sort().join("_");
    const ref = db.ref(`chats/${cid}`);
    const cb = (snap: { val: () => { pinned?: Record<string, boolean>; muted?: Record<string, boolean>; disappearing?: string } | null }) => {
      const v = snap.val() || {};
      setChatMeta({
        pinned: !!v.pinned?.[me.uid],
        muted: !!v.muted?.[me.uid],
        disappearing: v.disappearing || "off",
      });
    };
    ref.on("value", cb);
    return () => ref.off("value", cb);
  }, [me?.uid, contact.uid]);

  /* Draft auto-save: restores an unfinished message when reopening a chat */
  useEffect(() => {
    const saved = localStorage.getItem(draftKey) || "";
    if (saved) setText(saved);
    return () => {
      /* keep whatever is in the input when leaving */
      if (text.trim()) localStorage.setItem(draftKey, text);
      else localStorage.removeItem(draftKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);
  useEffect(() => {
    if (text.trim()) localStorage.setItem(draftKey, text);
    else localStorage.removeItem(draftKey);
  }, [text, draftKey]);

  /* Media gallery: fetch all image/file messages of this chat */
  async function openMediaGallery() {
    setMediaOpen(true);
    setMediaLoading(true);
    try {
      const snap = await db.ref(`messages/${chatId}`).orderByChild("timestamp").limitToLast(200).once("value");
      const items: ChatMessage[] = [];
      snap.forEach((child) => {
        const m = { key: child.key as string, ...(child.val() as object) } as ChatMessage;
        if (m.fileUrl || m.fileData) items.push(m);
      });
      items.reverse();
      setMediaItems(items);
    } catch {
      setMediaItems([]);
    }
    setMediaLoading(false);
  }

  /* Mark incoming messages from peer as read (blue-tick read receipts). */
  useEffect(() => {
    if (!me?.uid || !contact.uid) return;
    const chatId = [me.uid, contact.uid].sort().join("_");
    for (const msg of messages) {
      if (msg.senderId === contact.uid && !msg.readBy?.[me.uid]) {
        markMessageRead(chatId, msg.key, me.uid).catch(() => {});
      }
    }
  }, [messages, me?.uid, contact.uid]);

  const sortedMessages = useMemo(() => [...messages].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)), [messages]);

  const filteredMessages = useMemo(() => {
    if (!searchQuery.trim()) return sortedMessages;
    const q = searchQuery.trim().toLowerCase();
    return sortedMessages.filter((m) => (m._decryptedText || m.text || "").toLowerCase().includes(q));
  }, [sortedMessages, searchQuery]);

  const contactOnline = contact.isOnline;
  const contactStatus = isGroupChat
    ? `${Object.keys(useChatApp.getState().groups[contact.uid.slice(2)]?.members || {}).length} ${tr("thread.members")}`
    : typingOther
      ? tr("thread.typing")
      : contactOnline
        ? tr("thread.online")
        : contact.lastSeen
          ? `${tr("thread.lastSeen")} ${formatTime(contact.lastSeen)}`
          : tr("thread.offline");

  async function handleSend(e?: React.FormEvent) {
    e?.preventDefault();
    const value = text.trim();
    if (!value || !me || !contact.uid) return;

    if (me.isBanned) {
      toast.error(tr("thread.banned"));
      return;
    }

    const blockedByPeer = isGroupChat ? false : await checkBlockedBy(contact.uid, me.uid);
    if (blockedByPeer) {
      toast.error(tr("thread.blockedByPeer"));
      return;
    }

    setSending(true);
    stopTyping(me.uid, contact.uid);
    const ok = await sendMessage({
      myUid: me.uid,
      otherUid: contact.uid,
      text: value,
      replyTo: replyTo
        ? {
            senderId: replyTo.senderId,
            senderName: replyTo.senderId === me.uid ? "You" : users[replyTo.senderId]?.name || contact.name || "User",
            text: replyTo.type === "file" ? (replyTo.isImage ? "📷 Photo" : "📎 File") : (replyTo._decryptedText || replyTo.text || "").substring(0, 80),
          }
        : null,
      editingMessageKey: editing?.key || null,
      users,
    });
    if (ok) {
      setText("");
      setReplyTo(null);
      setEditing(null);
    }
    setSending(false);
  }

  function handleTyping() {
    if (me && contact.uid) notifyTyping(me.uid, contact.uid);
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !me || !contact.uid) return;
    if (!checkFileSizeAllowed(file)) {
      e.target.value = "";
      return;
    }
    await sendFileMessage(file, me.uid, contact.uid);
    e.target.value = "";
  }

  async function startVoiceRecording() {
    if (!me || !contact.uid) {
      toast.info("Open a chat first");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) voiceChunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(voiceChunksRef.current, { type: "audio/webm" });
        const file = new File([blob], `voice_${Date.now()}.webm`, { type: "audio/webm" });
        if (voiceChunksRef.current.length > 0) sendFileMessage(file, me!.uid, contact!.uid);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
      setVoiceSeconds(0);
      voiceTimerRef.current = setInterval(() => setVoiceSeconds((s) => s + 1), 1000);
    } catch {
      toast.error("Could not access the microphone");
    }
  }

  function stopVoiceRecording() {
    if (mediaRecorderRef.current && recording) mediaRecorderRef.current.stop();
    setRecording(false);
    if (voiceTimerRef.current) clearInterval(voiceTimerRef.current);
  }

  function cancelVoiceRecording() {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
      (mediaRecorderRef.current as unknown as { stream: MediaStream }).stream?.getTracks().forEach((t) => t.stop());
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
    if (voiceTimerRef.current) clearInterval(voiceTimerRef.current);
  }

  function saveNote(value: string) {
    if (!notesKey) return;
    const next = { ...notes, [contact.uid]: value };
    setNotes(next);
    localStorage.setItem(notesKey, JSON.stringify(next));
  }

  /* ==================== VOICE-TO-TEXT DICTATION ==================== */
  const dictationRef = useRef<SpeechRecognitionLike | null>(null);
  function toggleDictation() {
    if (dictating) {
      dictationRef.current?.stop();
      return;
    }
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      toast.error(tr("thread.dictationUnsupported"));
      return;
    }
    const rec = new Ctor();
    rec.lang = lang === "bn" ? "bn-BD" : "en-US";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e) => {
      let chunk = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) chunk += r[0].transcript;
      }
      if (chunk) setText((prev) => (prev ? `${prev} ${chunk.trim()}` : chunk.trim()));
    };
    rec.onend = () => setDictating(false);
    rec.onerror = () => setDictating(false);
    dictationRef.current = rec;
    rec.start();
    setDictating(true);
    toast.info(tr("thread.dictationStarted"));
  }
  useEffect(() => () => dictationRef.current?.stop(), []);

  /* ==================== SEND / SCHEDULE A STICKER ==================== */
  async function sendSticker(emoji: string) {
    setStickerOpen(false);
    if (!me || !contact.uid) return;
    await sendMessage({ myUid: me.uid, otherUid: contact.uid, text: emoji, users, sticker: true });
  }

  /* ==================== SCHEDULE THIS DRAFT ==================== */
  async function handleSchedule() {
    const value = text.trim();
    if (!value || !me) return;
    if (!scheduleAt) {
      toast.error(tr("thread.schedulePickTime"));
      return;
    }
    const when = new Date(scheduleAt).getTime();
    if (!when || when <= Date.now() + 5000) {
      toast.error(tr("thread.scheduleFuture"));
      return;
    }
    const ok = await scheduleMessage({
      myUid: me.uid,
      otherUid: contact.uid,
      otherName: contact.name || "User",
      text: value,
      sendAt: when,
    });
    if (ok) {
      setText("");
      setScheduleOpen(false);
    }
  }

  /* ==================== EXPORT CHAT TO .TXT ==================== */
  async function exportChat() {
    try {
      const snap = await db.ref(`messages/${chatId}`).orderByChild("timestamp").once("value");
      const lines: string[] = [];
      snap.forEach((child) => {
        const m = child.val() as ChatMessage;
        if (!m || m.type === "system") return;
        const who = m.senderId === me?.uid ? "Me" : isGroupChat ? users[m.senderId]?.name || m.senderId : contact.name || "Them";
        const when = m.timestamp ? new Date(m.timestamp).toLocaleString() : "";
        const body = m.type === "file" ? `[${m.fileName || "file"}]` : m.text || "";
        lines.push(`[${when}] ${who}: ${body}`);
      });
      const blob = new Blob([`ChatBD export — ${contact.name || "Chat"}\n\n${lines.join("\n")}`], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `chatbd-${(contact.name || "chat").replace(/\s+/g, "_")}-${Date.now()}.txt`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast.success(tr("thread.exported"));
    } catch {
      toast.error(tr("thread.exportFailed"));
    }
  }

  return (
    <div className={cn("flex h-full flex-col py-3", className)}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4 px-2">
          <div className="flex items-center gap-3">
            {showBackButton && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="md:hidden"
                aria-label="Back to conversations"
                onClick={() => {
                  setActiveChatUser(null);
                  onBack?.();
                }}
              >
                <ArrowLeft />
              </Button>
            )}
            <Avatar className="size-8">
              {contact.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={contact.photoUrl} alt={contact.name || "User"} className="size-full rounded-full object-cover" />
              ) : (
                <AvatarFallback className="bg-background text-foreground">{getInitials(contact.name || "U")}</AvatarFallback>
              )}
              <AvatarBadge className={cn(!contactOnline && "bg-zinc-400 dark:bg-zinc-700")} />
            </Avatar>
            <div>
              <div className="flex items-center gap-1.5 font-medium text-sm">
                {contact.name || "Unknown"}
                {isGroupChat && contact.uniqueId === undefined && (
                  <span className="text-muted-foreground font-normal text-xs">{contactStatus}</span>
                )}
                {!isGroupChat && contact.uniqueId && <span className="text-muted-foreground font-normal text-xs">#{contact.uniqueId}</span>}
              </div>
              <div className="text-muted-foreground flex items-center gap-1 text-xs leading-3">
                {chatMeta.disappearing && chatMeta.disappearing !== "off" && (
                  <span className="inline-flex items-center gap-0.5" title={tr("thread.disappearing")}>
                    <Timer className="size-2.5" /> {chatMeta.disappearing}
                  </span>
                )}
                {isGroupChat ? "" : contactStatus}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {isGroupChat && me && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={tr("gcall.start")}
                    onClick={() => {
                      import("../_lib/group-webrtc").then(({ startGroupCall }) => {
                        startGroupCall(
                          contact.uid.slice(2),
                          contact.name || "Group",
                          me.uid,
                          me.name || "You",
                          "audio",
                        );
                      });
                    }}
                  >
                    <Users />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{tr("gcall.start")}</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={tr("thread.audioCall")}
                  onClick={() => {
                    if (me && contact.uid) startCall(me.uid, me.name || "You", contact.uid, contact.name || "User", "audio");
                  }}
                >
                  <PhoneCall />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Audio call</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={tr("thread.videoCall")}
                  onClick={() => {
                    if (me && contact.uid) startCall(me.uid, me.name || "You", contact.uid, contact.name || "User", "video");
                  }}
                >
                  <Video />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Video call</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={tr("thread.searchMessages")}
                  onClick={() => setSearchOpen((v) => !v)}
                >
                  <Search />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{tr("thread.searchMessages")}</TooltipContent>
            </Tooltip>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="More actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuGroup>
                  <DropdownMenuItem onSelect={onOpenContact}>
                    <CornerUpLeft className="rotate-180" />
                    {isGroupChat ? tr("newchat.groupInfo") : tr("thread.viewProfile")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={openMediaGallery}>
                    <ImageIcon />
                    {tr("thread.media")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setStarredOpen(true)}>
                    <Star />
                    {tr("thread.starredMessages")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={exportChat}>
                    <FileIcon />
                    {tr("thread.exportChat")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <div className="px-2 py-1">
                    <div className="text-muted-foreground mb-1 text-xs">{tr("thread.disappearing")}</div>
                    <div className="flex items-center gap-1">
                      {(["off", "24h", "7d"] as const).map((v) => (
                        <button
                          key={v}
                          type="button"
                          className={cn(
                            "flex-1 rounded-md border px-1.5 py-1 text-[10px] font-medium transition-colors",
                            (chatMeta.disappearing || "off") === v
                              ? "border-primary bg-primary/10 text-primary"
                              : "text-muted-foreground hover:bg-muted",
                          )}
                          onClick={() => setDisappearing(chatId, v)}
                        >
                          {v === "off" ? tr("thread.disappearingOff") : v}
                        </button>
                      ))}
                    </div>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={async () => {
                      if (!me?.uid || !contact.uid) return;
                      const chatId = [me.uid, contact.uid].sort().join("_");
                      await togglePinChat(chatId, me.uid);
                    }}
                  >
                    <Pin />
                    {chatMeta.pinned ? tr("thread.unpinChat") : tr("thread.pinChat")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={async () => {
                      if (!me?.uid || !contact.uid) return;
                      const chatId = [me.uid, contact.uid].sort().join("_");
                      await toggleMuteChat(chatId, me.uid);
                    }}
                  >
                    <BellOff />
                    {chatMeta.muted ? tr("thread.unmuteChat") : tr("thread.muteChat")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={async () => {
                      await navigator.clipboard.writeText(contact.email || `#${contact.uniqueId}`).catch(() => {});
                      toast.success("Copied!");
                    }}
                  >
                    <Copy />
                    {tr("thread.copyId")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setForwarding(messages[messages.length - 1] || null)} disabled={!messages.length}>
                    <Flag />
                    {tr("thread.lastMessage")}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {searchOpen && (
          <div className="flex items-center gap-2 px-2 pb-2">
            <InputGroup className="h-8 flex-1">
              <InputGroupInput
                className="h-8 text-sm"
                placeholder={tr("thread.searchInChat")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <InputGroupAddon>
                <Search className="size-4" />
              </InputGroupAddon>
            </InputGroup>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close search"
              onClick={() => {
                setSearchOpen(false);
                setSearchQuery("");
              }}
            >
              <X className="size-4" />
            </Button>
          </div>
        )}

        <Separator />
      </div>

      <MessageScrollerProvider autoScroll>
        <MessageScroller className={cn("min-h-0 flex-1", wallpaper !== "default" && `wp-${wallpaper} rounded-md`)}>
          <MessageScrollerViewport>
            <MessageScrollerContent className="gap-6 px-2 py-8">
              <Marker variant="separator">
                <MarkerContent>
                  {searchQuery
                    ? `${tr("thread.searchResults")} (${filteredMessages.length} ${tr("thread.of")} ${sortedMessages.length})`
                    : tr("thread.chatStarted")}
                </MarkerContent>
              </Marker>

              {/* Load earlier messages (pagination) */}
              {hasMore && !searchQuery && sortedMessages.length >= 50 && (
                <div className="flex justify-center pb-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground h-7 text-xs"
                    onClick={() => {
                      const fn = paginationBridge.loadMore;
                      if (fn) {
                        fn();
                        /* Hide once a page smaller than 50 comes back */
                        setTimeout(() => {
                          if (useChatApp.getState().messages.length < sortedMessages.length + 50) setHasMore(false);
                        }, 1500);
                      } else {
                        setHasMore(false);
                      }
                    }}
                  >
                    <Loader2 className="size-3" /> {tr("thread.loadEarlier")}
                  </Button>
                </div>
              )}

              {filteredMessages.map((message) => {
                if (message.type === "system") {
                  return (
                    <MessageScrollerItem key={message.key} messageId={message.key}>
                      <div className="flex justify-center py-1">
                        <span className="bg-muted/70 text-muted-foreground rounded-full px-3 py-1 text-center text-[11px]">
                          {message.text}
                        </span>
                      </div>
                    </MessageScrollerItem>
                  );
                }
                const isOutbound = message.senderId === me?.uid;
                const senderUser = isGroupChat ? users[message.senderId] : undefined;
                const senderName = isOutbound ? me?.name || "You" : isGroupChat ? senderUser?.name || "Unknown" : contact.name || "User";
                const displayText = message._decryptedText || message.text || "";
                // Sender's own preference decides whether their messages render as bubbles
                const showBubble = isOutbound ? myBubbles : isGroupChat ? true : contactBubbles;

                return (
                  <MessageScrollerItem
                    key={message.key}
                    messageId={message.key}
                    scrollAnchor={isOutbound}
                  >
                    <Message align={isOutbound ? "end" : "start"}>
                      <MessageAvatar>
                        <Avatar className="size-8">
                          {isOutbound ? (
                            me?.photoUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={me.photoUrl} alt={me.name || "Me"} className="size-full rounded-full object-cover" />
                            ) : (
                              <AvatarFallback className="bg-primary text-primary-foreground text-xs">{getInitials(me?.name || "U")}</AvatarFallback>
                            )
                          ) : isGroupChat ? (
                            senderUser?.photoUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={senderUser.photoUrl} alt={senderUser.name || "User"} className="size-full rounded-full object-cover" />
                            ) : (
                              <AvatarFallback className="bg-muted text-foreground text-xs">{getInitials(senderUser?.name || "U")}</AvatarFallback>
                            )
                          ) : contact.photoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={contact.photoUrl} alt={contact.name || "User"} className="size-full rounded-full object-cover" />
                          ) : (
                            <AvatarFallback className="bg-muted text-foreground text-xs">{getInitials(senderName)}</AvatarFallback>
                          )}
                        </Avatar>
                      </MessageAvatar>

                      <MessageContent>
                        {isGroupChat && !isOutbound && (
                          <div className="text-primary px-1 text-xs font-medium">{senderName}</div>
                        )}
                        <BubbleGroup>
                          <MessageBubble
                            message={message}
                            isOutbound={!!isOutbound}
                            displayText={displayText}
                            showBubble={showBubble}
                            contactName={contact.name || "User"}
                            myUid={me?.uid || ""}
                            chatId={[me?.uid || "", contact.uid || ""].sort().join("_")}
                            onReply={() => {
                              setReplyTo(message);
                              setEditing(null);
                            }}
                            onEdit={() => {
                              setEditing(message);
                              setReplyTo(null);
                              setText(displayText);
                            }}
                            onDelete={async () => {
                              const chatId = [me!.uid, contact.uid!].sort().join("_");
                              await deleteMessage(chatId, message);
                            }}
                            onForward={() => setForwarding(message)}
                            onImageView={setImageViewer}
                          />
                        </BubbleGroup>
                        <MessageFooter className="flex items-center gap-1">
                          {message.edited && <span className="text-muted-foreground text-[10px]">edited</span>}
                          {message.forwarded && <span className="text-muted-foreground text-[10px]">forwarded</span>}
                          {formatMessageTime(message.timestamp)}
                          {isOutbound && (
                            <ReadReceiptIcon
                              readBy={message.readBy}
                              receiverUid={contact.uid || ""}
                              readReceiptsEnabled={
                                me?.settings?.privacy?.readReceipts !== false
                              }
                            />
                          )}
                        </MessageFooter>
                      </MessageContent>
                    </Message>
                  </MessageScrollerItem>
                );
              })}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>

      {/* Reply / Edit bar */}
      {(replyTo || editing) && (
        <div className="mx-2 mb-2 flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2">
          {editing ? <Pencil className="size-3.5 shrink-0 text-primary" /> : <CornerUpLeft className="size-3.5 shrink-0 text-primary" />}
          <div className="min-w-0 flex-1">
            <div className="text-primary text-xs font-semibold">
              {editing ? "Editing message" : `Replying to ${replyTo?.senderId === me?.uid ? "yourself" : contact.name}`}
            </div>
            <div className="text-muted-foreground truncate text-xs">
              {(editing || replyTo)?.type === "file"
                ? (editing || replyTo)?.isImage
                  ? "📷 Photo"
                  : "📎 File"
                : ((editing || replyTo)?._decryptedText || (editing || replyTo)?.text || "").slice(0, 80)}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Cancel"
            onClick={() => {
              setReplyTo(null);
              setEditing(null);
              if (editing) setText("");
            }}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      )}

      {/* Voice recording bar */}
      {recording ? (
        <div className="mx-2 flex items-center gap-3 rounded-md border border-red-500/40 bg-red-500/5 px-4 py-3">
          <span className="size-2.5 animate-pulse rounded-full bg-red-500" />
          <span className="text-muted-foreground text-xs">{formatVoiceTime(voiceSeconds)}</span>
          <span className="text-muted-foreground text-xs">{tr("thread.recording")}</span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={cancelVoiceRecording}>
            {tr("thread.cancel")}
          </Button>
          <Button size="sm" onClick={stopVoiceRecording}>
            <Send className="size-3.5" /> Send
          </Button>
        </div>
      ) : (
        <div className="px-2">
          {/* Schedule bar */}
          {scheduleOpen && (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2">
              <CalendarClock className="size-3.5 shrink-0 text-primary" />
              <span className="text-primary text-xs font-medium">{tr("thread.scheduleTitle")}</span>
              <input
                type="datetime-local"
                className="text-xs bg-background rounded-md border px-2 py-1"
                value={scheduleAt}
                onChange={(e) => setScheduleAt(e.target.value)}
              />
              <Button size="sm" className="ml-auto h-7 text-xs" onClick={handleSchedule}>
                {tr("thread.scheduleSend")}
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setScheduleOpen(false)}>
                <X className="size-3" />
              </Button>
            </div>
          )}
          {/* Dictation bar */}
          {dictating && (
            <div className="mb-2 flex items-center gap-2 rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2">
              <span className="size-2 animate-pulse rounded-full bg-red-500" />
              <span className="text-muted-foreground text-xs">{tr("thread.dictating")}</span>
              <Button variant="ghost" size="sm" className="ml-auto h-7 text-xs" onClick={toggleDictation}>
                {tr("thread.stopDictation")}
              </Button>
            </div>
          )}
          {/* Sticker picker */}
          {stickerOpen && (
            <div className="mb-2 rounded-md border bg-muted/40 p-2">
              <div className="text-muted-foreground mb-1 px-1 text-xs">{tr("thread.stickers")}</div>
              <div className="grid grid-cols-10 gap-1">
                {STICKERS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="rounded-md p-1 text-2xl transition-transform hover:scale-125 hover:bg-muted"
                    onClick={() => sendSticker(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          <Tabs defaultValue="reply" className="gap-0 rounded-md border">
            <TabsList
              variant="line"
              className="w-full justify-start gap-2 border-b px-3 **:data-[slot=tabs-trigger]:border-x-0 **:data-[slot=tabs-trigger]:px-6 group-data-horizontal/tabs:h-10"
            >
              <TabsTrigger value="reply" className="flex-none px-1">
                {tr("thread.reply")}
              </TabsTrigger>
              <TabsTrigger value="note" className="flex-none px-1">
                {tr("thread.internalNote")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="reply" className="m-0">
              <form className="w-full" onSubmit={handleSend}>
                <InputGroup className="border-0 bg-transparent shadow-none has-[[data-slot=input-group-control]:focus-visible]:border-0 has-[[data-slot][aria-invalid=true]]:border-0 has-[[data-slot=input-group-control]:focus-visible]:ring-0 has-[[data-slot][aria-invalid=true]]:ring-0 dark:bg-transparent dark:has-[[data-slot][aria-invalid=true]]:ring-0">
                  <InputGroupTextarea
                    placeholder={tr("thread.typeMessage")}
                    value={text}
                    className="min-h-14 px-3 py-2.5 text-sm ring-0 focus-visible:ring-0 aria-invalid:ring-0 dark:aria-invalid:ring-0"
                    onChange={(e) => {
                      setText(e.target.value);
                      handleTyping();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                  />
                  <InputGroupAddon align="block-end">
                    <Popover>
                      <PopoverTrigger asChild>
                        <InputGroupButton aria-label="Emoji" type="button" size="icon-sm">
                          <Smile />
                        </InputGroupButton>
                      </PopoverTrigger>
                      <PopoverContent className="w-64 p-2" align="start">
                        <div className="grid grid-cols-8 gap-1">
                          {EMOJIS.map((emoji) => (
                            <button
                              key={emoji}
                              type="button"
                              className="rounded-md p-1 text-lg hover:bg-muted"
                              onClick={() => setText((t) => t + emoji)}
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                    <InputGroupButton
                      aria-label="Attach file"
                      type="button"
                      size="icon-sm"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Paperclip />
                    </InputGroupButton>
                    <InputGroupButton
                      aria-label={tr("thread.stickers")}
                      type="button"
                      size="icon-sm"
                      className={cn(stickerOpen && "text-primary")}
                      onClick={() => setStickerOpen((v) => !v)}
                    >
                      <MessageCircle />
                    </InputGroupButton>
                    <InputGroupButton
                      aria-label={dictating ? tr("thread.stopDictation") : tr("thread.dictate")}
                      type="button"
                      size="icon-sm"
                      className={cn(dictating && "animate-pulse text-red-500")}
                      onClick={toggleDictation}
                    >
                      {dictating ? <MicOff /> : <Mic />}
                    </InputGroupButton>
                    <InputGroupButton
                      aria-label={tr("thread.scheduleTitle")}
                      type="button"
                      size="icon-sm"
                      className={cn(scheduleOpen && "text-primary")}
                      onClick={() => setScheduleOpen((v) => !v)}
                      disabled={!text.trim()}
                      title={tr("thread.scheduleTitle")}
                    >
                      <CalendarClock />
                    </InputGroupButton>
                    <InputGroupButton aria-label="Record voice" type="button" size="icon-sm" onClick={startVoiceRecording}>
                      <Volume2 />
                    </InputGroupButton>
                    <InputGroupButton type="submit" variant="default" size="icon-sm" className="ml-auto" disabled={sending || !text.trim()}>
                      {sending ? <Square className="size-3 animate-pulse" /> : <Send />}
                      <span className="sr-only">Send</span>
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
              </form>
              <input ref={fileInputRef} type="file" accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,audio/*" hidden onChange={handleFileSelected} />
            </TabsContent>

            <TabsContent value="note" className="m-0">
              <InputGroup className="border-0 bg-transparent shadow-none has-[[data-slot=input-group-control]:focus-visible]:border-0 has-[[data-slot][aria-invalid=true]]:border-0 has-[[data-slot=input-group-control]:focus-visible]:ring-0 has-[[data-slot][aria-invalid=true]]:ring-0 dark:bg-transparent dark:has-[[data-slot][aria-invalid=true]]:ring-0">
                <InputGroupTextarea
                  placeholder={tr("thread.notePlaceholder")}
                  value={contact.uid ? notes[contact.uid] || "" : ""}
                  className="min-h-14 px-3 py-2.5 text-sm ring-0 focus-visible:ring-0 aria-invalid:ring-0 dark:aria-invalid:ring-0"
                  onChange={(e) => saveNote(e.target.value)}
                />
                <InputGroupAddon align="block-end">
                  <span className="text-muted-foreground flex items-center gap-1 px-2 text-xs">
                    <Lock className="size-3" /> {tr("thread.localOnly")}
                  </span>
                </InputGroupAddon>
              </InputGroup>
            </TabsContent>
          </Tabs>
        </div>
      )}

      {/* Media & files gallery */}
      {mediaOpen && (
        <div className="fixed inset-0 z-100 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6" onClick={() => setMediaOpen(false)}>
          <div className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-t-xl border bg-background sm:rounded-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="font-medium text-sm">{tr("thread.media")}</div>
              <Button variant="ghost" size="icon-sm" aria-label={tr("common.close")} onClick={() => setMediaOpen(false)}>
                <X />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {mediaLoading ? (
                <div className="text-muted-foreground flex items-center justify-center gap-2 py-10 text-sm">
                  <Loader2 className="size-4 animate-spin" /> {tr("common.loading")}
                </div>
              ) : mediaItems.length === 0 ? (
                <div className="text-muted-foreground py-10 text-center text-sm">{tr("thread.media")}: 0</div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {mediaItems.map((m) => {
                    const src = m.fileUrl || m.fileData;
                    if (!src) return null;
                    if (m.isImage) {
                      return (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={m.key}
                          src={src}
                          alt={m.fileName || "Photo"}
                          loading="lazy"
                          className="aspect-square w-full cursor-pointer rounded-lg object-cover"
                          onClick={() => {
                            setMediaOpen(false);
                            setImageViewer(src);
                          }}
                        />
                      );
                    }
                    return (
                      <button
                        key={m.key}
                        type="button"
                        className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-lg border p-2 text-center hover:bg-muted/60"
                        onClick={async () => {
                          const url = await resolveMediaUrl(src);
                          window.open(url, "_blank");
                        }}
                      >
                        {m.isVoice ? <Mic className="size-5" /> : <FileIcon className="size-5" />}
                        <span className="w-full truncate text-[10px]">{m.fileName || "File"}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Image viewer */}
      {imageViewer && (
        <div
          className="fixed inset-0 z-100 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setImageViewer(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageViewer} alt="Attachment" className="max-h-full max-w-full rounded-lg object-contain" />
          <Button variant="secondary" size="icon" className="absolute top-4 right-4" aria-label="Close">
            <X />
          </Button>
        </div>
      )}

      {/* Forward dialog */}
      <ForwardDialog message={forwarding} onClose={() => setForwarding(null)} />

      {/* Starred messages dialog */}
      {starredOpen && (
        <div className="fixed inset-0 z-100 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6" onClick={() => setStarredOpen(false)}>
          <div className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-t-xl border bg-background sm:rounded-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="flex items-center gap-2 font-medium text-sm">
                <Star className="size-4 fill-current text-amber-500" /> {tr("thread.starredMessages")}
              </div>
              <Button variant="ghost" size="icon-sm" aria-label={tr("common.close")} onClick={() => setStarredOpen(false)}>
                <X />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {(() => {
                const starredMsgs = messages.filter((m) => m.starred?.[me?.uid || ""]);
                if (starredMsgs.length === 0) {
                  return (
                    <div className="text-muted-foreground flex flex-col items-center gap-2 py-10 text-center text-sm">
                      <Star className="size-8 opacity-30" />
                      {tr("thread.noStarred")}
                    </div>
                  );
                }
                return (
                  <div className="flex flex-col gap-2">
                    {starredMsgs.map((m) => (
                      <div key={m.key} className="rounded-lg border bg-muted/30 px-3 py-2">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-medium">
                            {m.senderId === me?.uid ? tr("common.you") : isGroupChat ? users[m.senderId]?.name || "?" : contact.name || "?"}
                          </span>
                          <span className="text-muted-foreground">{formatMessageTime(m.timestamp)}</span>
                        </div>
                        <div className="text-muted-foreground mt-1 text-sm break-words">
                          {m.type === "file" ? (m.isImage ? "📷 Photo" : `📎 ${m.fileName || "File"}`) : m.text}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ==================== MESSAGE BUBBLE ==================== */

function BubbleGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-1">{children}</div>;
}

function MessageBubble({
  message,
  isOutbound,
  displayText,
  showBubble,
  contactName,
  myUid,
  chatId,
  onReply,
  onEdit,
  onDelete,
  onForward,
  onImageView,
}: {
  message: ChatMessage;
  isOutbound: boolean;
  displayText: string;
  showBubble: boolean;
  contactName: string;
  myUid: string;
  chatId: string;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onForward: () => void;
  onImageView: (src: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const [translation, setTranslation] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* First URL in the text → compact clickable link preview chip */
  const previewUrl = message.type === "text" && !message.sticker ? extractFirstUrl(displayText) : null;
  const isSticker = !!message.sticker && message.type === "text";

  /* Inline translation via MyMemory free API (bn↔en, follows app language) */
  async function handleTranslate() {
    if (translating || translation) return;
    setTranslating(true);
    const target = document.documentElement.getAttribute("data-lang") === "bn" ? "en" : "bn";
    const result = await translateMessage(displayText, target as "en" | "bn");
    setTranslation(result || "");
    if (!result) toast.error("Translation unavailable");
    setTranslating(false);
  }

  /* Long-press (mobile) / right-click (desktop) opens the context menu — Chatme behaviour */
  function startLongPress() {
    longPressTimer.current = setTimeout(() => setMenuOpen(true), 500);
  }
  function cancelLongPress() {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }

  // Aggregate reactions: emoji → count
  const reactionList = Object.entries(message.reactions || {}) as [string, string][];
  const reactionAggregated: Record<string, { count: number; mine: boolean }> = {};
  for (const [uid, emoji] of reactionList) {
    if (!reactionAggregated[emoji]) reactionAggregated[emoji] = { count: 0, mine: false };
    reactionAggregated[emoji].count++;
    if (uid === myUid) reactionAggregated[emoji].mine = true;
  }
  const isStarred = !!message.starred?.[myUid];

  return (
    <div
      className={cn("group/msg relative max-w-md select-none", isOutbound ? "self-end" : "self-start")}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuOpen(true);
      }}
      onTouchStart={startLongPress}
      onTouchEnd={cancelLongPress}
      onTouchMove={cancelLongPress}
    >
      <div
        className={cn(
          "relative text-sm",
          isSticker
            ? "px-0 py-0"
            : showBubble
              ? cn(
                  "rounded-2xl px-3.5 py-2 shadow-sm",
                  isOutbound ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
                )
              : cn(
                  "px-1 py-0.5",
                  isOutbound ? "text-primary dark:text-primary-foreground/90" : "text-foreground",
                ),
        )}
      >
        {message.replyTo && (
          <div className={cn("mb-1.5 rounded-md border-l-2 px-2 py-1 text-xs", isOutbound ? "bg-primary-foreground/10" : "bg-background/60")}>
            <div className="font-semibold opacity-80">{message.replyTo.senderName}</div>
            <div className="truncate opacity-70">{message.replyTo.text}</div>
          </div>
        )}

        {isSticker ? (
          <div className="px-0.5 py-0.5 text-5xl leading-none drop-shadow-sm select-none">{displayText}</div>
        ) : message.type === "file" && (message.fileData || message.fileUrl) ? (
          <FileMessageContent message={message} onImageView={onImageView} />
        ) : (
          <div className="break-words whitespace-pre-wrap">
            {displayText}
            {previewUrl && (
              <a
                href={previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "mt-1.5 flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs no-underline",
                  isOutbound ? "border-primary-foreground/25 bg-primary-foreground/10" : "border-border bg-background/70 hover:bg-muted",
                )}
                onClick={(e) => e.stopPropagation()}
              >
                <Link2 className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{previewUrl.replace(/^https?:\/\//, "")}</span>
              </a>
            )}
            {translation && (
              <div className={cn("mt-1 border-t pt-1 text-xs italic", isOutbound ? "border-primary-foreground/20 opacity-80" : "border-border opacity-70")}>
                {translation}
              </div>
            )}
          </div>
        )}

        {isStarred && (
          <span className="absolute right-1 bottom-0.5 text-amber-400">
            <Star className="size-3 fill-current" />
          </span>
        )}
      </div>

      {/* Reaction chips */}
      {Object.keys(reactionAggregated).length > 0 && (
        <div className={cn("mt-0.5 flex flex-wrap gap-1", isOutbound ? "justify-end" : "justify-start")}>
          {Object.entries(reactionAggregated).map(([emoji, info]) => (
            <button
              key={emoji}
              type="button"
              className={cn(
                "flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-xs transition-colors",
                info.mine ? "border-primary bg-primary/10 text-primary" : "border-border bg-background",
              )}
              onClick={() => toggleReaction(chatId, message, myUid, emoji)}
            >
              <span>{emoji}</span>
              {info.count > 1 && <span className="text-[10px] font-medium">{info.count}</span>}
            </button>
          ))}
        </div>
      )}

      {/* Hover / tap actions */}
      <div
        className={cn(
          "absolute -top-3 flex items-center gap-0.5 rounded-full border bg-background p-0.5 shadow-sm opacity-0 transition-opacity group-hover/msg:opacity-100",
          isOutbound ? "right-0" : "left-0",
        )}
      >
        <Popover open={reactionPickerOpen} onOpenChange={setReactionPickerOpen}>
          <PopoverTrigger asChild>
            <button type="button" aria-label="React" className="rounded-full p-1 hover:bg-muted">
              <Smile className="size-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-1.5" align={isOutbound ? "end" : "start"}>
            <div className="flex gap-0.5">
              {REACTION_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="rounded-md p-1 text-base hover:bg-muted"
                  onClick={() => {
                    toggleReaction(chatId, message, myUid, emoji);
                    setReactionPickerOpen(false);
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <button type="button" aria-label="Reply" className="rounded-full p-1 hover:bg-muted" onClick={onReply}>
          <CornerUpLeft className="size-3" />
        </button>
        <button
          type="button"
          aria-label={isStarred ? "Unstar" : "Star"}
          className={cn("rounded-full p-1 hover:bg-muted", isStarred && "text-amber-500")}
          onClick={() => toggleStarMessage(chatId, message, myUid)}
        >
          <Star className={cn("size-3", isStarred && "fill-current")} />
        </button>
        <button type="button" aria-label="Forward" className="rounded-full p-1 hover:bg-muted" onClick={onForward}>
          <Forward className="size-3" />
        </button>
        {message.type === "text" && (
          <button
            type="button"
            aria-label="Translate"
            title="Translate"
            className="rounded-full p-1 hover:bg-muted"
            onClick={handleTranslate}
          >
            {translating ? <Loader2 className="size-3 animate-spin" /> : <Languages className="size-3" />}
          </button>
        )}
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="More" className="rounded-full p-1 hover:bg-muted">
              <MoreHorizontal className="size-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align={isOutbound ? "end" : "start"} className="w-40">
            <DropdownMenuItem onSelect={onReply}>
              <CornerUpLeft /> Reply
            </DropdownMenuItem>
            {isOutbound && message.type === "text" && (
              <DropdownMenuItem onSelect={onEdit}>
                <Pencil /> Edit
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onSelect={() => {
                toggleStarMessage(chatId, message, myUid);
              }}
            >
              <Star className={cn(isStarred && "fill-current text-amber-500")} />
              {isStarred ? "Unstar" : "Star"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onForward}>
              <Forward /> Forward
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={async () => {
                await navigator.clipboard.writeText(displayText).catch(() => {});
                toast.success("Copied!");
              }}
            >
              <Copy /> Copy
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {isOutbound && (
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                <Trash2 /> Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <span className="sr-only">{contactName}</span>
    </div>
  );
}

/* ==================== READ RECEIPT ICON (grey single tick → grey double → blue double) ==================== */

function ReadReceiptIcon({
  readBy,
  receiverUid,
  readReceiptsEnabled,
}: {
  readBy?: Record<string, number>;
  receiverUid: string;
  readReceiptsEnabled: boolean;
}) {
  // If read receipts are disabled, just show a single check (sent only).
  if (!readReceiptsEnabled) return <Check className="size-3 text-muted-foreground" />;
  const isRead = !!readBy?.[receiverUid];
  return <CheckCheck className={cn("size-3", isRead ? "text-blue-500" : "text-muted-foreground")} />;
}

function FileMessageContent({ message, onImageView }: { message: ChatMessage; onImageView: (src: string) => void }) {
  const fileSrc = message.fileUrl || message.fileData;
  /* Private-repo support: audio falls back to the token-fetched blob URL
     when the direct raw URL 404s. */
  const media = useMediaSrc(fileSrc);
  const [voiceRate, setVoiceRate] = useState(1);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [rateOpen, setRateOpen] = useState(false);

  function cycleVoiceRate() {
    /* 1x → 1.5x → 2x → 0.5x → 1x … */
    const next = voiceRate === 1 ? 1.5 : voiceRate === 1.5 ? 2 : voiceRate === 2 ? 0.5 : 1;
    setVoiceRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }

  if (message.isVoice && fileSrc) {
    return (
      <div className="flex min-w-44 items-center gap-2 py-0.5">
        <audio
          ref={audioRef}
          controls
          preload="metadata"
          src={media.src}
          onError={media.onError}
          onLoadedMetadata={() => {
            if (audioRef.current) audioRef.current.playbackRate = voiceRate;
          }}
          className="h-8 max-w-44"
        />
        <button
          type="button"
          className={cn(
            "flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-medium transition-colors",
            voiceRate !== 1 ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted",
          )}
          onClick={() => {
            cycleVoiceRate();
            setRateOpen(true);
            setTimeout(() => setRateOpen(false), 1200);
          }}
          title="Playback speed"
        >
          <Gauge className="size-3" />
          {voiceRate}x
        </button>
      </div>
    );
  }

  if (message.isImage && fileSrc) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={fileSrc}
        alt={message.fileName || "Photo"}
        loading="lazy"
        className="max-h-64 max-w-60 cursor-pointer rounded-lg object-cover"
        onClick={() => onImageView(fileSrc)}
      />
    );
  }

  return (
    <button
      type="button"
      className="flex min-w-44 items-center gap-2.5 py-1 text-left"
      onClick={async () => {
        if (!message.fileUrl) return;
        // Private repos: resolve through the token-authenticated API first,
        // then open the (blob) URL — direct raw URLs would 404.
        const url = await resolveMediaUrl(message.fileUrl);
        window.open(url, "_blank");
      }}
    >
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", "bg-primary-foreground/10")}>
        {message.fileType?.startsWith("image/") ? <ImageIcon className="size-4" /> : <FileIcon className="size-4" />}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium">{message.fileName || "File"}</span>
        <span className="block text-[10px] opacity-70">
          {formatFileSize(message.fileSize)} · {message.fileType?.split("/")[1] || "file"}
        </span>
      </span>
    </button>
  );
}

/* ==================== FORWARD DIALOG ==================== */

function ForwardDialog({ message, onClose }: { message: ChatMessage | null; onClose: () => void }) {
  const me = useChatApp((s) => s.me);
  const users = useChatApp((s) => s.users);
  const groups = useChatApp((s) => s.groups);

  if (!message || !me) return null;

  return (
    <div className="fixed inset-0 z-100 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6" onClick={onClose}>
      <div
        className="max-h-[70vh] w-full max-w-sm overflow-hidden rounded-t-xl border bg-background sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="font-medium text-sm">Forward message</div>
          <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
            <X />
          </Button>
        </div>
        <div className="max-h-[55vh] overflow-y-auto p-2">
          {/* Groups first */}
          {Object.entries(groups).map(([gid, g]) => (
            <button
              key={`g-${gid}`}
              type="button"
              className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted"
              onClick={async () => {
                await forwardMessage(message, me.uid, `g_${gid}`, users);
                onClose();
              }}
            >
              <Avatar className="size-9">
                {g.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={g.photoUrl} alt={g.name || "Group"} className="size-full rounded-full object-cover" />
                ) : (
                  <AvatarFallback className="bg-primary/15 text-primary">
                    <Users className="size-4" />
                  </AvatarFallback>
                )}
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{g.name || "Group"}</div>
                <div className="text-muted-foreground text-xs">{Object.keys(g.members || {}).length} members</div>
              </div>
              <Send className="text-muted-foreground size-3.5" />
            </button>
          ))}
          {Object.entries(users)
            .filter(([uid, u]) => uid !== me.uid && !u.isBanned)
            .map(([uid, u]) => (
              <button
                key={uid}
                type="button"
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted"
                onClick={async () => {
                  await forwardMessage(message, me.uid, uid);
                  onClose();
                }}
              >
                <Avatar className="size-9">
                  {u.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={u.photoUrl} alt={u.name || "User"} className="size-full rounded-full object-cover" />
                  ) : (
                    <AvatarFallback className="text-muted-foreground text-xs">{getInitials(u.name || "U")}</AvatarFallback>
                  )}
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{u.name || "Unknown"}</div>
                  <div className="text-muted-foreground text-xs">#{u.uniqueId || "????"}</div>
                </div>
                <Send className="text-muted-foreground size-3.5" />
              </button>
            ))}
          {Object.keys(users).filter((uid) => uid !== me.uid).length === 0 && (
            <div className="text-muted-foreground px-4 py-8 text-center text-sm">No other users yet</div>
          )}
        </div>
      </div>
    </div>
  );
}
