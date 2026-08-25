"use client";

/**
 * New chat dialog — WhatsApp-style directory privacy:
 *   • "New chat" tab: shows ONLY people you already have a chat with. Name
 *     search filters within those; unique-ID search (with or without #)
 *     looks up ANY user globally.
 *   • "New group" tab: pick a name + tick members (any user, ID-searchable)
 *     and create a group chat.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Check, Megaphone, MessageSquarePlus, Search, Send, UserPlus, Users, X } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn, getInitials } from "@/lib/utils";
import { t } from "@/lib/i18n";

import { createGroup, sendBroadcast } from "../_lib/chat-actions";
import { setActiveChatUser, setView, useChatApp, useAppLang } from "../_lib/store";

export function NewChatDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useChatApp((s) => s.me);
  const users = useChatApp((s) => s.users);
  const chats = useChatApp((s) => s.chats);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"chat" | "group" | "broadcast">("chat");
  const [groupName, setGroupName] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [broadcastText, setBroadcastText] = useState("");
  const [broadcastPicked, setBroadcastPicked] = useState<Set<string>>(new Set());
  const [broadcasting, setBroadcasting] = useState(false);
  const lang = useAppLang();
  const tr = (key: string) => t(lang, key);

  /* UIDs I already share a chat with */
  const chattedUids = useMemo(() => {
    if (!me) return new Set<string>();
    const set = new Set<string>();
    for (const chat of Object.values(chats)) {
      const other = chat.participant1 === me.uid ? chat.participant2 : chat.participant1;
      if (other && other !== me.uid) set.add(other);
    }
    return set;
  }, [chats, me]);

  const isIdQuery = /^\d{1,6}$/.test(q.trim().replace(/[#\s]/g, ""));

  /* Group tab shows ALL users (searchable); chat tab shows only chat partners
     unless an ID query is entered; broadcast tab shows all users (searchable). */
  const list = useMemo(() => {
    if (!me) return [];
    let entries = Object.entries(users).filter(([uid, u]) => uid !== me.uid && !u.isBanned);

    if (tab === "group" || tab === "broadcast") {
      if (q.trim() && !isIdQuery) {
        const query = q.trim().toLowerCase();
        entries = entries.filter(([, u]) => (u.name || "").toLowerCase().includes(query));
      } else if (isIdQuery) {
        const cleaned = q.trim().replace(/[#\s]/g, "");
        entries = entries.filter(([, u]) => String(u.uniqueId ?? "") === cleaned);
      }
    } else if (isIdQuery) {
      // ID search → GLOBAL lookup: find anyone, even users never chatted with
      const cleaned = q.trim().replace(/[#\s]/g, "");
      entries = entries.filter(([, u]) => String(u.uniqueId ?? "") === cleaned);
    } else if (q.trim()) {
      // Name search → only existing chat partners
      const query = q.trim().toLowerCase();
      entries = entries
        .filter(([uid]) => chattedUids.has(uid))
        .filter(([, u]) => (u.name || "").toLowerCase().includes(query));
    } else {
      // Default → only existing chat partners
      entries = entries.filter(([uid]) => chattedUids.has(uid));
    }
    return entries.sort((a, b) => (a[1].name || "").localeCompare(b[1].name || ""));
  }, [users, q, me, chattedUids, isIdQuery, tab]);

  if (!open || !me) return null;

  async function handleCreateGroup() {
    if (!me || groupName.trim().length < 2) return;
    setCreating(true);
    try {
      const gid = await createGroup(me.uid, groupName, Array.from(picked));
      setCreating(false);
      onClose();
      setGroupName("");
      setPicked(new Set());
      setTab("chat");
      setActiveChatUser(`g_${gid}`);
      setView("inbox");
    } catch {
      setCreating(false);
    }
  }

  async function handleBroadcast() {
    if (!me) return;
    if (broadcastPicked.size === 0) {
      toast.error(tr("broadcast.pickOne"));
      return;
    }
    if (broadcastText.trim().length === 0) {
      toast.error(tr("broadcast.writeMessage"));
      return;
    }
    setBroadcasting(true);
    await sendBroadcast(me.uid, Array.from(broadcastPicked), broadcastText.trim(), users);
    setBroadcasting(false);
    setBroadcastText("");
    setBroadcastPicked(new Set());
    setTab("chat");
    onClose();
  }

  return (
    <div className="fixed inset-0 z-100 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6" onClick={onClose}>
      <div className="max-h-[75vh] w-full max-w-md overflow-hidden rounded-t-xl border bg-background sm:rounded-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2 font-medium">
            <MessageSquarePlus className="size-4" /> {tab === "chat" ? tr("newchat.title") : tr("newchat.newGroup")}
          </div>
          <Button variant="ghost" size="icon-sm" aria-label={tr("common.close")} onClick={onClose}>
            <X />
          </Button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b px-2">
          {(["chat", "group", "broadcast"] as const).map((id) => (
            <button
              key={id}
              type="button"
              className={cn(
                "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors",
                tab === id ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
              onClick={() => {
                setTab(id);
                setQ("");
              }}
            >
              {id === "chat" ? <MessageSquarePlus className="size-3.5" /> : id === "group" ? <Users className="size-3.5" /> : <Megaphone className="size-3.5" />}
              {id === "chat" ? tr("newchat.title") : id === "group" ? tr("newchat.newGroup") : tr("broadcast.title")}
            </button>
          ))}
        </div>

        {tab === "group" && (
          <div className="border-b p-3">
            <Label htmlFor="group-name" className="text-muted-foreground text-xs">{tr("newchat.groupName")}</Label>
            <Input
              id="group-name"
              className="mt-1"
              placeholder={tr("newchat.groupNamePlaceholder")}
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              maxLength={50}
            />
          </div>
        )}
        {tab === "broadcast" && (
          <div className="border-b p-3">
            <Label htmlFor="broadcast-text" className="text-muted-foreground text-xs">{tr("broadcast.message")}</Label>
            <textarea
              id="broadcast-text"
              className="mt-1 min-h-16 w-full resize-none rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
              placeholder={tr("broadcast.placeholder")}
              value={broadcastText}
              maxLength={500}
              onChange={(e) => setBroadcastText(e.target.value)}
            />
          </div>
        )}
        <div className="p-3">
          <div className="relative">
            <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input className="pl-9" placeholder={tab === "chat" ? tr("newchat.searchPlaceholder") : tr("newchat.searchAllPlaceholder")} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          </div>
          <div className="text-muted-foreground mt-2 px-1 text-xs leading-relaxed">
            {tab === "broadcast"
              ? `${tr("broadcast.hint")}${broadcastPicked.size > 0 ? ` — ${broadcastPicked.size} ${tr("newchat.selected")}` : ""}`
              : tab === "group"
                ? `${tr("newchat.hintGroup")}${picked.size > 0 ? ` — ${picked.size} ${tr("newchat.selected")}` : ""}`
                : isIdQuery
                  ? tr("newchat.hintId")
                  : tr("newchat.hintDefault")}
          </div>
        </div>
        <div className="max-h-[55vh] overflow-y-auto p-2">
          {list.length === 0 && (
            <div className="text-muted-foreground flex flex-col items-center gap-2 px-4 py-8 text-center text-sm">
              {isIdQuery ? (
                <>
                  <UserPlus className="size-8 opacity-40" />
                  {tr("newchat.noUserId")}
                </>
              ) : q.trim() ? (
                <>{tr("newchat.noMatch")}</>
              ) : (
                <>
                  <UserPlus className="size-8 opacity-40" />
                  {tr("newchat.empty")}
                </>
              )}
            </div>
          )}
          {list.map(([uid, u]) => (
            <button
              key={uid}
              type="button"
              className={cn("flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted")}
              onClick={() => {
                if (tab === "group") {
                  // Toggle membership selection
                  setPicked((prev) => {
                    const next = new Set(prev);
                    if (next.has(uid)) next.delete(uid);
                    else next.add(uid);
                    return next;
                  });
                  return;
                }
                if (tab === "broadcast") {
                  setBroadcastPicked((prev) => {
                    const next = new Set(prev);
                    if (next.has(uid)) next.delete(uid);
                    else next.add(uid);
                    return next;
                  });
                  return;
                }
                setActiveChatUser(uid);
                setView("inbox");
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
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{u.name || "Unknown"}</span>
                  {u.isOnline && <span className="size-1.5 shrink-0 rounded-full bg-green-600" />}
                </div>
                <div className="text-muted-foreground text-xs">#{u.uniqueId || "????"}</div>
              </div>
              {tab === "group" || tab === "broadcast" ? (
                <span
                  className={cn(
                    "grid size-5 shrink-0 place-items-center rounded-full border",
                    (tab === "group" ? picked : broadcastPicked).has(uid) ? "border-primary bg-primary text-primary-foreground" : "border-border",
                  )}
                >
                  {(tab === "group" ? picked : broadcastPicked).has(uid) && <Check className="size-3" />}
                </span>
              ) : !chattedUids.has(uid) ? (
                <span className="text-primary text-xs font-medium">{tr("newchat.newBadge")}</span>
              ) : null}
            </button>
          ))}
        </div>

        {tab === "group" && (
          <div className="border-t p-3">
            <Button className="w-full" disabled={groupName.trim().length < 2 || creating} onClick={handleCreateGroup}>
              {creating ? tr("common.saving") : tr("newchat.createGroup")}
            </Button>
          </div>
        )}
        {tab === "broadcast" && (
          <div className="border-t p-3">
            <Button className="w-full" disabled={broadcasting || broadcastPicked.size === 0 || !broadcastText.trim()} onClick={handleBroadcast}>
              {broadcasting ? <Send className="size-4 animate-pulse" /> : <Megaphone className="size-4" />}
              {broadcasting ? tr("broadcast.sending") : `${tr("broadcast.send")} (${broadcastPicked.size})`}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
