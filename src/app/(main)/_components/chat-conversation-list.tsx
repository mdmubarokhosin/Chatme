"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { BellOff, ChevronDown, FolderPlus, MessageSquarePlus, Moon, Search, Sun, Trash2, Users, X, Archive, ArchiveRestore } from "lucide-react";

import { Avatar, AvatarBadge, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn, getInitials } from "@/lib/utils";
import { formatTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { db } from "@/lib/firebase";

import { setActiveChatUser, setView, useChatApp, useUiStore, useAppLang } from "../_lib/store";
import { createFolder, deleteFolder, toggleArchiveChat, toggleFolderChat } from "../_lib/chat-actions";

type ConversationItem = {
  uid: string;
  chatId: string;
  name: string;
  uniqueId: string | number;
  preview: string;
  timestamp: number;
  isOnline: boolean;
  isUnread: boolean;
  isPinned: boolean;
  isMuted: boolean;
  isArchived?: boolean;
  photoUrl?: string;
  isGroup?: boolean;
  memberCount?: number;
};

type Group = "pinned" | "today" | "yesterday" | "earlier";

const GROUP_LABELS: Record<Group, { en: string; bn: string }> = {
  pinned: { en: "Pinned", bn: "পিন করা" },
  today: { en: "Today", bn: "আজ" },
  yesterday: { en: "Yesterday", bn: "গতকাল" },
  earlier: { en: "Earlier", bn: "আগে" },
};

interface ChatConversationListProps {
  onSelectConversation?: (uid: string) => void;
  className?: string;
}

export function ChatConversationList({ onSelectConversation, className }: ChatConversationListProps) {
  const [filterText, setFilterText] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [idResult, setIdResult] = useState<{ uid: string; name: string; uniqueId: string } | null>(null);
  const [searching, setSearching] = useState(false);
  const [dark, setDark] = useState(false);
  const [globalResults, setGlobalResults] = useState<{ chatId: string; peerId: string; name: string; snippet: string; timestamp?: number }[]>([]);
  const [globalSearching, setGlobalSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const me = useChatApp((s) => s.me);
  const users = useChatApp((s) => s.users);
  const groups = useChatApp((s) => s.groups);
  const chats = useChatApp((s) => s.chats);
  const folders = useChatApp((s) => s.folders);
  const activeChatUserId = useChatApp((s) => s.activeChatUserId);
  const setNewChatOpen = useUiStore((s) => s.setNewChatOpen);
  const lang = useAppLang();
  const tr = (key: string) => t(lang, key);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  /* Ctrl+K (dispatched by Chat) opens + focuses the search bar */
  useEffect(() => {
    const open = () => {
      if (useChatApp.getState().view === "inbox") setSearchOpen(true);
    };
    window.addEventListener("chatbd-open-search", open);
    return () => window.removeEventListener("chatbd-open-search", open);
  }, []);

  /* Focus search input when opened */
  useEffect(() => {
    if (searchOpen) {
      const t = setTimeout(() => searchInputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
    // Clear filter when closing search
    if (!searchOpen && filterText) setFilterText("");
  }, [searchOpen]);

  function toggleDarkMode() {
    const root = document.documentElement;
    const next = !root.classList.contains("dark");
    root.classList.toggle("dark", next);
    root.style.colorScheme = next ? "dark" : "light";
    root.setAttribute("data-theme-mode", next ? "dark" : "light");
    document.cookie = `theme_mode=${next ? "dark" : "light"}; path=/; max-age=31536000`;
    localStorage.setItem("chatbd-dark-mode", String(next));
    setDark(next);
  }

  /* Combined search: filters existing conversations by name/#ID, AND if the
     query looks like a ChatBD ID (with or without #), also looks up that user
     globally so you can start a brand-new conversation.
     Strategy: INSTANT client-side lookup over the already-loaded users map
     (reliable — no query/index/permission issues), Firebase fallback only if
     the users map hasn't loaded yet. */
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const cleaned = filterText.replace(/[#\s]/g, "");
    const isNumericId = /^\d{1,6}$/.test(cleaned);
    if (!filterText.trim() || !isNumericId) {
      setIdResult(null);
      setSearching(false);
      return;
    }

    // 1) INSTANT client-side lookup — users map is fully loaded by listenToUsers()
    const local = Object.entries(users).find(
      ([uid, u]) => uid !== me?.uid && String(u.uniqueId ?? "") === cleaned,
    );
    if (local) {
      setIdResult({ uid: local[0], name: local[1].name || "Unknown", uniqueId: String(local[1].uniqueId) });
      setSearching(false);
      return;
    }

    // 2) Firebase fallback (users map still loading) — string then number form
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        let usersSnap = await db.ref("users").orderByChild("uniqueId").equalTo(cleaned).once("value");
        if (!usersSnap.exists()) {
          usersSnap = await db.ref("users").orderByChild("uniqueId").equalTo(Number(cleaned)).once("value");
        }
        let found: { uid: string; name: string; uniqueId: string } | null = null;
        usersSnap.forEach((child) => {
          if (found || child.key === me?.uid) return;
          const u = child.val() as { name?: string; uniqueId?: string | number };
          if (String(u.uniqueId ?? "") === cleaned) {
            found = { uid: child.key as string, name: u.name || "Unknown", uniqueId: String(u.uniqueId) };
          }
        });
        setIdResult(found);
      } catch {
        setIdResult(null);
      }
      setSearching(false);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [filterText, me?.uid, users]);

  const conversations = useMemo<ConversationItem[]>(() => {
    if (!me) return [];
    const list: ConversationItem[] = [];
    for (const chat of Object.values(chats)) {
      const archived = !!chat.archived?.[me.uid];
      if (chat.isGroup && chat.gid) {
        const g = groups[chat.gid];
        if (!g) continue;
        list.push({
          uid: `g_${chat.gid}`,
          chatId: chat.chatId,
          name: g.name || "Group",
          uniqueId: "",
          preview: chat.lastMessage || tr("list.startMessaging"),
          timestamp: chat.lastTimestamp || 0,
          isOnline: false,
          isUnread: !!(chat.unread && chat.unread[me.uid]),
          isPinned: !!(chat.pinned && chat.pinned[me.uid]),
          isMuted: !!(chat.muted && chat.muted[me.uid]),
          isArchived: archived,
          photoUrl: g.photoUrl,
          isGroup: true,
          memberCount: Object.keys(g.members || {}).length,
        });
        continue;
      }
      const otherUid = chat.participant1 === me.uid ? chat.participant2 : chat.participant1;
      const user = users[otherUid as string];
      if (!user) continue;
      list.push({
        uid: otherUid as string,
        chatId: chat.chatId,
        name: user.name || "Unknown",
        uniqueId: user.uniqueId ?? "????",
        preview: chat.lastMessage || tr("list.startMessaging"),
        timestamp: chat.lastTimestamp || 0,
        isOnline: !!user.isOnline,
        isUnread: !!(chat.unread && chat.unread[me.uid]),
        isPinned: !!(chat.pinned && chat.pinned[me.uid]),
        isMuted: !!(chat.muted && chat.muted[me.uid]),
        isArchived: archived,
        photoUrl: user.photoUrl,
      });
    }
    return list.sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      return b.timestamp - a.timestamp;
    });
  }, [me, users, groups, chats]);

  /* Folder filter + archive filter */
  const filtered = useMemo(() => {
    let base = conversations;
    if (showArchived) base = base.filter((c) => c.isArchived);
    else base = base.filter((c) => !c.isArchived);
    if (activeFolder) {
      const folder = folders[activeFolder];
      if (!folder) return [];
      base = base.filter((c) => !!folder.chatIds?.[c.chatId]);
    }
    if (!filterText.trim()) return base;
    const q = filterText.trim().toLowerCase().replace(/[#\s]/g, "");
    return base.filter(
      (c) => c.name.toLowerCase().includes(q) || String(c.uniqueId).includes(q),
    );
  }, [conversations, filterText, activeFolder, folders, showArchived]);

  const archivedCount = conversations.filter((c) => c.isArchived).length;

  async function handleCreateFolder() {
    if (!me) return;
    const name = window.prompt(tr("folders.namePrompt"));
    if (!name || name.trim().length < 1) return;
    await createFolder(me.uid, name.trim());
  }

  const groupedConversations = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterday = today - 86400000;
    const out: Array<{ group: Group; conversations: ConversationItem[] }> = [];
    const add = (group: Group, item: ConversationItem) => {
      const existing = out.find((g) => g.group === group);
      if (existing) existing.conversations.push(item);
      else out.push({ group, conversations: [item] });
    };
    for (const conv of filtered) {
      if (conv.isPinned) add("pinned", conv);
      else if (!conv.timestamp) add("earlier", conv);
      else if (conv.timestamp >= today) add("today", conv);
      else if (conv.timestamp >= yesterday) add("yesterday", conv);
      else add("earlier", conv);
    }
    return out;
  }, [filtered]);

  const unreadTotal = conversations.filter((c) => c.isUnread).length;
  const cleanedQuery = filterText.replace(/[#\s]/g, "");
  const isIdSearch = /^\d{1,6}$/.test(cleanedQuery);

  /* GLOBAL MESSAGE SEARCH — non-ID queries also scan recent messages across
     all my chats (up to 20 most recent chats, 50 msgs each). Results render
     under the search bar; clicking jumps into that chat. */
  useEffect(() => {
    if (!filterText.trim() || isIdSearch || !me) {
      setGlobalResults([]);
      setGlobalSearching(false);
      return;
    }
    setGlobalSearching(true);
    const timer = setTimeout(async () => {
      try {
        const q = filterText.trim().toLowerCase();
        const myChats = Object.values(chats)
          .filter((c) => c.participant1 === me.uid || c.participant2 === me.uid || (c.isGroup && c.gid))
          .sort((a, b) => (b.lastTimestamp || 0) - (a.lastTimestamp || 0))
          .slice(0, 20);
        const results: { chatId: string; peerId: string; name: string; snippet: string; timestamp?: number }[] = [];
        await Promise.all(
          myChats.map(async (chat) => {
            try {
              const snap = await db.ref(`messages/${chat.chatId}`).orderByChild("timestamp").limitToLast(50).once("value");
              const peerId = chat.isGroup && chat.gid ? `g_${chat.gid}` : (chat.participant1 === me.uid ? chat.participant2 : chat.participant1);
              const name = chat.isGroup && chat.gid
                ? groups[chat.gid]?.name || "Group"
                : users[peerId as string]?.name || "Unknown";
              snap.forEach((child) => {
                const m = child.val() as { text?: string; timestamp?: number; encrypted?: boolean };
                if (m?.encrypted || !m?.text) return;
                if (m.text.toLowerCase().includes(q)) {
                  results.push({
                    chatId: chat.chatId,
                    peerId: peerId as string,
                    name,
                    snippet: m.text.length > 60 ? m.text.slice(0, 60) + "…" : m.text,
                    timestamp: m.timestamp,
                  });
                }
              });
            } catch {
              /* skip chat on error */
            }
          }),
        );
        results.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        setGlobalResults(results.slice(0, 12));
      } catch {
        setGlobalResults([]);
      }
      setGlobalSearching(false);
    }, 450);
    return () => clearTimeout(timer);
  }, [filterText, isIdSearch, me, chats, users, groups]);

  async function selectConversation(uid: string) {
    setActiveChatUser(uid);
    onSelectConversation?.(uid);
    if (me) {
      const chatId = [me.uid, uid].sort().join("_");
      db.ref(`chats/${chatId}/unread/${me.uid}`).remove().catch(() => {});
    }
  }

  /* WhatsApp-style delete: removes the conversation (and its messages) from
     the home list. The shared chat meta + messages + admin mirror are removed. */
  async function deleteConversation(conv: ConversationItem) {
    if (!me) return;
    const confirmed = window.confirm(
      `${tr("list.deleteChat")} — ${conv.name}?\n\n${tr("list.confirmDelete")}`,
    );
    if (!confirmed) return;
    try {
      // Groups use their own chatId ("g_{gid}"); 1:1 chats sort both uids
      const chatId = conv.isGroup ? conv.chatId : [me.uid, conv.uid].sort().join("_");
      await db.ref(`messages/${chatId}`).remove();
      await db.ref(`messagesAdmin/${chatId}`).remove().catch(() => {});
      await db.ref(`chats/${chatId}`).remove();
      if (conv.isGroup) {
        // Leaving the group entirely (membership + meta)
        await db.ref(`groups/${conv.uid.slice(2)}/members/${me.uid}`).remove().catch(() => {});
        await db.ref(`groups/${conv.uid.slice(2)}/admins/${me.uid}`).remove().catch(() => {});
      }
      if (activeChatUserId === conv.uid) setActiveChatUser(null);
      toast.success(tr("list.chatDeleted"));
    } catch {
      toast.error(tr("list.deleteFailed"));
    }
  }

  return (
    <div className={cn("flex h-full flex-col", className)}>
      {/* ==================== Compact toolbar (replaces deleted header bar) ==================== */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-2 sm:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h1 className="font-semibold text-lg leading-none">ChatBD</h1>
          {unreadTotal > 0 && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">
              {unreadTotal > 9 ? "9+" : unreadTotal}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={tr("list.newConversation")}
            onClick={() => setNewChatOpen(true)}
          >
            <MessageSquarePlus className="size-4" />
          </Button>
          <Button
            variant={searchOpen ? "secondary" : "ghost"}
            size="icon-sm"
            aria-label={tr("common.search")}
            aria-pressed={searchOpen}
            onClick={() => setSearchOpen((v) => !v)}
          >
            <Search className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={dark ? tr("list.lightMode") : tr("list.darkMode")}
            onClick={toggleDarkMode}
          >
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
        </div>
      </div>

      {/* ==================== Collapsible unified search (filters list + global ID lookup) ==================== */}
      <div
        className={cn(
          "overflow-hidden transition-[max-height,opacity,margin] duration-300 ease-in-out",
          searchOpen ? "max-h-72 opacity-100 mb-1" : "max-h-0 opacity-0",
        )}
      >
        <div className="px-3 pb-2 sm:px-4">
          <InputGroup className="h-10 w-full">
            <InputGroupAddon>
              <Search className="size-4" />
            </InputGroupAddon>
            <InputGroupInput
              ref={searchInputRef}
              className="h-10"
              placeholder={tr("list.searchPlaceholder")}
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
            />
            <InputGroupAddon>
              <button
                type="button"
                aria-label={tr("list.closeSearch")}
                onClick={() => setSearchOpen(false)}
                className="grid place-items-center rounded transition-colors hover:bg-muted/60"
              >
                <X className="size-4" />
              </button>
            </InputGroupAddon>
          </InputGroup>

          {/* Global ID lookup result — rendered inline (in flow) so it can never
              be clipped by the collapsible container's overflow-hidden */}
          {isIdSearch && (
            <div className="mt-1 w-full rounded-lg border bg-popover p-2 text-popover-foreground shadow-md">
              {searching ? (
                <div className="text-muted-foreground px-2 py-3 text-center text-xs">{tr("list.searching")}</div>
              ) : idResult ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-muted"
                  onClick={() => {
                    useChatApp.setState({ newChatUserId: idResult.uid, activeChatUserId: idResult.uid });
                    setView("inbox");
                    setFilterText("");
                    setSearchOpen(false);
                    onSelectConversation?.(idResult.uid);
                  }}
                >
                  <Avatar className="size-9 shrink-0">
                    {users[idResult.uid]?.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={users[idResult.uid].photoUrl} alt={idResult.name} className="size-full rounded-full object-cover" />
                    ) : (
                      <AvatarFallback className="text-xs font-medium">{idResult.name.charAt(0).toUpperCase()}</AvatarFallback>
                    )}
                  </Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{idResult.name}</span>
                    <span className="text-muted-foreground block text-xs">#{idResult.uniqueId}</span>
                  </span>
                  <span className="text-primary text-xs font-medium">{tr("common.message")}</span>
                </button>
              ) : (
                <div className="text-muted-foreground px-2 py-3 text-center text-xs">
                  {users && Object.keys(users).length > 0 ? tr("list.noUserWithId") : tr("list.noUser")}
                </div>
              )}
            </div>
          )}
          {/* Global message search results */}
          {!isIdSearch && filterText.trim().length > 0 && (
            <div className="mt-1 w-full rounded-lg border bg-popover p-2 text-popover-foreground shadow-md">
              {globalSearching ? (
                <div className="text-muted-foreground px-2 py-2 text-center text-xs">{tr("list.searching")}</div>
              ) : globalResults.length === 0 ? (
                <div className="text-muted-foreground px-2 py-2 text-center text-xs">{tr("list.noMatch")}</div>
              ) : (
                <>
                  <div className="text-muted-foreground px-2 pb-1 text-[10px] font-semibold tracking-wide uppercase">{lang === "bn" ? "মেসেজ" : "Messages"} ({globalResults.length})</div>
                  {globalResults.map((r, i) => (
                    <button
                      key={`${r.chatId}-${i}`}
                      type="button"
                      className="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-muted"
                      onClick={() => {
                        setActiveChatUser(r.peerId);
                        setView("inbox");
                        onSelectConversation?.(r.peerId);
                      }}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-medium">{r.name}</span>
                        {r.timestamp ? <span className="text-muted-foreground shrink-0 text-[10px]">{formatTime(r.timestamp)}</span> : null}
                      </span>
                      <span className="text-muted-foreground truncate text-xs">{r.snippet}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <Separator />

      {/* ==================== Folder chips + archive toggle ==================== */}
      {(Object.keys(folders).length > 0 || archivedCount > 0) && !showArchived && (
        <div className="flex items-center gap-1.5 overflow-x-auto px-3 pt-2 pb-1 sm:px-4">
          <button
            type="button"
            className={cn(
              "flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
              !activeFolder ? "border-primary bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted",
            )}
            onClick={() => setActiveFolder(null)}
          >
            {tr("folders.all")}
          </button>
          {Object.entries(folders).map(([fid, folder]) => (
            <button
              key={fid}
              type="button"
              className={cn(
                "flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
                activeFolder === fid ? "border-primary bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted",
              )}
              onClick={() => setActiveFolder(activeFolder === fid ? null : fid)}
              onContextMenu={(e) => {
                e.preventDefault();
                if (me && window.confirm(`${tr("folders.delete")} — ${folder.name}?`)) deleteFolder(me.uid, fid);
              }}
              title={activeFolder === fid ? tr("folders.clear") : folder.name}
            >
              <span>{folder.emoji || "📁"}</span>
              <span className="max-w-20 truncate">{folder.name}</span>
              <span className="text-[10px] opacity-60">{Object.keys(folder.chatIds || {}).length}</span>
            </button>
          ))}
          {me && (
            <button
              type="button"
              className="text-muted-foreground hover:bg-muted hover:text-foreground grid size-6 shrink-0 place-items-center rounded-full border border-dashed"
              onClick={handleCreateFolder}
              aria-label={tr("folders.create")}
              title={tr("folders.create")}
            >
              <FolderPlus className="size-3" />
            </button>
          )}
          {archivedCount > 0 && (
            <button
              type="button"
              className={cn(
                "flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
                showArchived ? "border-primary bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted",
              )}
              onClick={() => setShowArchived(true)}
            >
              <Archive className="size-3" /> {tr("folders.archived")} ({archivedCount})
            </button>
          )}
        </div>
      )}
      {showArchived && (
        <div className="flex items-center gap-2 px-3 pt-2 pb-1 sm:px-4">
          <button
            type="button"
            className="flex items-center gap-1 rounded-full border border-primary bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
            onClick={() => setShowArchived(false)}
          >
            <ArchiveRestore className="size-3" /> {tr("folders.archived")} — {tr("folders.backToInbox")}
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        <ScrollArea
          type="hover"
          className="**:data-[slot=scroll-area-viewport]:scroll-fade h-full min-h-0 flex-1 overflow-hidden [&_[data-orientation=vertical][data-slot=scroll-area-scrollbar]]:w-1.5"
        >
          <div className="flex flex-col gap-3 pt-2">
            {groupedConversations.length === 0 && (
              <div className="text-muted-foreground px-4 py-8 text-center text-sm">
                {filterText
                  ? tr("list.noMatch")
                  : tr("list.empty")}
              </div>
            )}
            {groupedConversations.map(({ group, conversations: groupConversations }) => (
              <Collapsible key={group} defaultOpen>
                <CollapsibleTrigger className="flex w-full items-center justify-between gap-1 px-3 py-2 font-medium text-muted-foreground text-xs hover:text-foreground [&[data-state=open]>svg]:rotate-180">
                  {lang === "bn" ? GROUP_LABELS[group].bn : GROUP_LABELS[group].en}{" "}
                  <span className="text-[10px]">({groupConversations.length})</span>
                  <ChevronDown className="ml-auto size-3 transition-transform" />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="flex flex-col gap-1 px-2">
                    {groupConversations.map((conversation) => {
                      const isSelected = activeChatUserId === conversation.uid;
                      return (
                        <div key={conversation.uid} className="group/conv relative">
                          <button
                            type="button"
                            className={cn(
                              "w-full overflow-hidden rounded-lg px-2.5 py-2.5 pr-9 text-left ring-inset transition-colors",
                              isSelected ? "bg-muted ring-1 ring-border" : "hover:bg-muted/75",
                            )}
                            onClick={(event) => {
                              event.currentTarget.blur();
                              selectConversation(conversation.uid);
                            }}
                          >
                            <div className="flex min-w-0 items-start gap-2.5">
                              <Avatar className="shrink-0 **:data-[slot=avatar-badge]:size-2.5">
                                {conversation.photoUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={conversation.photoUrl} alt={conversation.name} className="size-full rounded-full object-cover" />
                                ) : conversation.isGroup ? (
                                  <AvatarFallback className="bg-primary/15 text-primary">
                                    <Users className="size-4" />
                                  </AvatarFallback>
                                ) : (
                                  <AvatarFallback
                                    className={cn(
                                      "text-foreground text-xs transition-colors duration-400",
                                      isSelected && "bg-background/50",
                                    )}
                                  >
                                    {getInitials(conversation.name)}
                                  </AvatarFallback>
                                )}
                                {conversation.isOnline && <AvatarBadge className="bg-green-600 dark:bg-green-800" />}
                              </Avatar>

                              <div className="w-0 flex-1 overflow-hidden">
                                <div className="flex w-full items-center justify-between gap-2">
                                  <div className="flex min-w-0 items-center gap-1.5">
                                    <span className="truncate font-medium text-sm leading-5">{conversation.name}</span>
                                    {conversation.isGroup && conversation.memberCount ? (
                                      <span className="text-muted-foreground shrink-0 text-[10px] tabular-nums">({conversation.memberCount})</span>
                                    ) : null}
                                  </div>
                                  <span className="text-nowrap text-muted-foreground text-xs leading-5">
                                    {formatTime(conversation.timestamp)}
                                  </span>
                                </div>
                                <div className="flex min-w-0 items-end gap-2">
                                  <div className="w-0 flex-1 overflow-hidden">
                                    <div className="truncate font-medium text-foreground/90 text-xs leading-4">
                                      {conversation.isGroup ? conversation.name : `#${conversation.uniqueId}`}
                                    </div>
                                    <div className="truncate text-muted-foreground text-xs leading-4">
                                      {conversation.preview}
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-1">
                                    {conversation.isPinned && (
                                      <div className="grid size-5 place-items-center">
                                        <svg viewBox="0 0 24 24" fill="currentColor" className="size-3 opacity-70">
                                          <path d="M14 4V2H10V4H7V9L11 13V17H13V13L17 9V4H14Z" />
                                        </svg>
                                      </div>
                                    )}
                                    {conversation.isMuted && (
                                      <div className="grid size-5 place-items-center">
                                        <BellOff className="size-3 opacity-70" />
                                      </div>
                                    )}
                                    {conversation.isUnread && (
                                      <div className="size-2.5 rounded-full bg-primary/90 ring-2 ring-background" />
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </button>

                          {/* WhatsApp-style delete — always visible on touch, hover-revealed on desktop */}
                          <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-0.5 max-sm:opacity-60 sm:opacity-0 transition-opacity sm:focus-visible:opacity-100 sm:group-hover/conv:opacity-100">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  aria-label={`${tr("folders.more")} — ${conversation.name}`}
                                  title={tr("folders.more")}
                                  className="grid size-7 place-items-center rounded-md text-muted-foreground transition-all hover:bg-muted"
                                >
                                  <ChevronDown className="size-3.5" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-48">
                                {Object.keys(folders).length > 0 && me && (
                                  <DropdownMenuSub>
                                    <DropdownMenuSubTrigger className="text-xs">
                                      <FolderPlus className="size-3.5" /> {tr("folders.addTo")}
                                    </DropdownMenuSubTrigger>
                                    <DropdownMenuSubContent>
                                      {Object.entries(folders).map(([fid, folder]) => (
                                        <DropdownMenuItem
                                          key={fid}
                                          className="text-xs"
                                          onSelect={() => me && toggleFolderChat(me.uid, fid, conversation.chatId)}
                                        >
                                          <span>{folder.emoji || "📁"}</span> {folder.name}
                                          {folder.chatIds?.[conversation.chatId] && <span className="ml-auto text-primary">✓</span>}
                                        </DropdownMenuItem>
                                      ))}
                                    </DropdownMenuSubContent>
                                  </DropdownMenuSub>
                                )}
                                <DropdownMenuItem
                                  className="text-xs"
                                  onSelect={() => me && toggleArchiveChat(conversation.chatId, me.uid)}
                                >
                                  {conversation.isArchived ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}
                                  {conversation.isArchived ? tr("folders.unarchive") : tr("folders.archive")}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  variant="destructive"
                                  className="text-xs"
                                  onSelect={() => deleteConversation(conversation)}
                                >
                                  <Trash2 className="size-3.5" /> {tr("list.deleteChat")}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                            <button
                              type="button"
                              aria-label={`${tr("list.deleteChat")} — ${conversation.name}`}
                              title={tr("list.deleteChat")}
                              className="grid size-7 place-items-center rounded-md text-muted-foreground transition-all hover:bg-destructive/10 hover:text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteConversation(conversation);
                              }}
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
