"use client";

/** Conversations monitoring — view chats with admin-visible plaintext content,
 *  search inside messages, delete messages / chats, view media attachments,
 *  and send direct admin-to-user messages. */
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Download, File as FileIcon, Image as ImageIcon, Megaphone, MessageSquare, Mic, Search, Send, Trash2, X } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getInitials, cn } from "@/lib/utils";
import { formatFileSize, formatMessageTime, formatTime } from "@/lib/format";
import type { ChatMessage } from "@/lib/types";

import {
  adminBroadcastAll,
  adminMessageUser,
  clearChatMessages,
  deleteConversation,
  deleteMessage,
  loadChatMessagesEx,
  useAdmin,
} from "../_lib/admin-store";

export default function AdminChatsPage() {
  const users = useAdmin((s) => s.users);
  const chats = useAdmin((s) => s.chats);
  const [search, setSearch] = useState("");
  const [msgSearch, setMsgSearch] = useState("");
  const [selectedChat, setSelectedChat] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isPlaintext, setIsPlaintext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [adminMsg, setAdminMsg] = useState("");
  const [broadcastMsg, setBroadcastMsg] = useState("");
  const [composeUser, setComposeUser] = useState("");
  const [sendingAdminMsg, setSendingAdminMsg] = useState(false);
  const [sendingBroadcast, setSendingBroadcast] = useState(false);

  const rows = useMemo(() => {
    return Object.values(chats)
      .map((chat) => {
        const u1 = users[chat.participant1 || ""];
        const u2 = users[chat.participant2 || ""];
        return {
          chatId: chat.chatId,
          user1Id: chat.participant1 || "",
          user2Id: chat.participant2 || "",
          user1: u1?.name || chat.participant1?.slice(0, 6) || "?",
          user2: u2?.name || chat.participant2?.slice(0, 6) || "?",
          uid1: u1?.uniqueId || "?",
          uid2: u2?.uniqueId || "?",
          lastMessage: chat.lastMessage || "",
          lastTimestamp: chat.lastTimestamp || 0,
        };
      })
      .sort((a, b) => b.lastTimestamp - a.lastTimestamp);
  }, [chats, users]);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.trim().toLowerCase();
    return rows.filter(
      (r) =>
        r.user1.toLowerCase().includes(q) ||
        r.user2.toLowerCase().includes(q) ||
        String(r.uid1).includes(q.replace("#", "")) ||
        String(r.uid2).includes(q.replace("#", "")) ||
        r.lastMessage.toLowerCase().includes(q)
    );
  }, [rows, search]);

  // Messages filtered by content search (only meaningful on plaintext copy)
  const filteredMessages = useMemo(() => {
    if (!msgSearch.trim() || !isPlaintext) return messages;
    const q = msgSearch.trim().toLowerCase();
    return messages.filter((m) => (m.text || "").toLowerCase().includes(q));
  }, [messages, msgSearch, isPlaintext]);

  async function openChat(chatId: string) {
    setSelectedChat(chatId);
    setLoading(true);
    setMsgSearch("");
    try {
      const result = await loadChatMessagesEx(chatId);
      setMessages(result.list);
      setIsPlaintext(result.isPlaintext);
    } catch {
      toast.error("Could not load messages");
    }
    setLoading(false);
  }

  function exportConversation(chatId: string) {
    const data = JSON.stringify(messages, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chat_${chatId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Conversations</h1>
          <p className="text-muted-foreground text-sm">
            Inspect any conversation on the platform. Admin-visible plaintext is shown when available.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setComposeOpen(true)}>
            <Send className="size-4" /> Direct message
          </Button>
          <Button variant="outline" size="sm" onClick={() => setBroadcastOpen(true)}>
            <Megaphone className="size-4" /> Broadcast
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="text-xl leading-none">All conversations ({filtered.length})</CardTitle>
          <CardDescription>
            Messages are stored in plain text — admin can inspect every conversation directly.
          </CardDescription>
          <CardAction className="w-full md:w-64">
            <div className="relative w-full">
              <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                className="pl-9"
                placeholder="Search by name, #ID or message..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col px-0">
          {filtered.length === 0 && (
            <div className="text-muted-foreground px-4 py-10 text-center text-sm">No conversations found.</div>
          )}
          {filtered.map((row) => (
            <div key={row.chatId} className="flex items-center gap-3 border-t px-4 py-3 hover:bg-muted/40">
              <Avatar className="size-9 shrink-0">
                <AvatarFallback className="text-xs">
                  {getInitials(row.user1)}
                  {getInitials(row.user2)}
                </AvatarFallback>
              </Avatar>
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => openChat(row.chatId)}>
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{row.user1}</span>
                  <span className="text-muted-foreground text-[10px]">#{row.uid1}</span>
                  <MessageSquare className="text-muted-foreground size-3" />
                  <span className="truncate text-sm font-medium">{row.user2}</span>
                  <span className="text-muted-foreground text-[10px]">#{row.uid2}</span>
                </div>
                <div className="text-muted-foreground truncate text-xs">
                  {row.lastMessage ? `${row.lastMessage} · ${formatTime(row.lastTimestamp)}` : "No messages yet"}
                </div>
              </button>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  if (!confirm("Clear all messages in this conversation?")) return;
                  await clearChatMessages(row.chatId);
                  toast.success("Messages cleared");
                }}
              >
                Clear
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Delete conversation"
                className="text-destructive"
                onClick={async () => {
                  if (!confirm("Delete this conversation completely? This cannot be undone.")) return;
                  await deleteConversation(row.chatId);
                  toast.success("Conversation deleted");
                }}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Message viewer dialog */}
      {selectedChat && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/50 p-4" onClick={() => setSelectedChat(null)}>
          <div
            className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border bg-background"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">Conversation messages</div>
                <div className="text-muted-foreground text-xs">
                  {isPlaintext ? (
                    <span className="text-green-600 dark:text-green-400">● Plaintext (admin-visible mirror)</span>
                  ) : (
                    <span className="text-amber-600 dark:text-amber-400">● Ciphertext only (no admin mirror yet)</span>
                  )}
                </div>
              </div>
              <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={() => setSelectedChat(null)}>
                <X />
              </Button>
            </div>

            {isPlaintext && (
              <div className="border-b px-4 py-2">
                <div className="relative">
                  <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                  <Input
                    className="h-8 pl-9 text-sm"
                    placeholder="Search message content..."
                    value={msgSearch}
                    onChange={(e) => setMsgSearch(e.target.value)}
                  />
                </div>
              </div>
            )}

            <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-2">
              <span className="text-muted-foreground text-xs">{filteredMessages.length} messages</span>
              <Button variant="outline" size="sm" onClick={() => exportConversation(selectedChat)}>
                <Download className="size-3.5" /> Export JSON
              </Button>
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <div className="flex flex-col gap-2 p-4">
                {loading && <div className="text-muted-foreground py-8 text-center text-sm">Loading messages...</div>}
                {!loading && filteredMessages.length === 0 && (
                  <div className="text-muted-foreground py-8 text-center text-sm">No messages match.</div>
                )}
                {filteredMessages.map((msg) => {
                  const isSender1 = msg.senderId === selectedChat.split("_")[0];
                  return (
                    <div
                      key={msg.key}
                      className={cn(
                        "group flex flex-col gap-1 rounded-lg border p-3",
                        isSender1 ? "bg-blue-50/40 dark:bg-blue-950/20" : "bg-emerald-50/40 dark:bg-emerald-950/20",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-[10px]">{isSender1 ? "P1" : "P2"}</Badge>
                        {msg.senderName && <span className="text-xs font-medium">{msg.senderName}</span>}
                        {msg.encrypted && <Badge variant="outline" className="text-[10px]">🔒</Badge>}
                        {msg.type === "file" && <Badge variant="outline" className="text-[10px]">file</Badge>}
                        {msg.edited && <Badge variant="outline" className="text-[10px]">edited</Badge>}
                        {msg.forwarded && <Badge variant="outline" className="text-[10px]">forwarded</Badge>}
                        <span className="text-muted-foreground ml-auto text-xs">{formatMessageTime(msg.timestamp)}</span>
                      </div>
                      <div className="text-sm break-words">
                        {msg.type === "file" ? (
                          <div className="flex flex-col gap-2">
                            <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
                              {msg.isImage ? <ImageIcon className="size-3.5" /> : msg.isVoice ? <Mic className="size-3.5" /> : <FileIcon className="size-3.5" />}
                              <span>{msg.fileName || "File"}</span>
                              {msg.fileSize ? <span>· {formatFileSize(msg.fileSize)}</span> : null}
                            </div>
                            {msg.isImage && msg.fileUrl && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={msg.fileUrl} alt={msg.fileName || "Attachment"} className="max-h-48 rounded-md border" />
                            )}
                            {msg.fileUrl && (
                              <a href={msg.fileUrl} target="_blank" rel="noreferrer" className="text-primary text-xs hover:underline">
                                Open in new tab ↗
                              </a>
                            )}
                          </div>
                        ) : (
                          <span className={cn(!isPlaintext && "font-mono text-muted-foreground text-xs break-all")}>
                            {isPlaintext ? msg.text : `${(msg.text || "").slice(0, 80)}${(msg.text || "").length > 80 ? "..." : ""}`}
                          </span>
                        )}
                      </div>
                      {msg.replyTo && (
                        <div className="text-muted-foreground border-l-2 pl-2 text-xs">
                          <div className="font-medium">{msg.replyTo.senderName}</div>
                          <div className="truncate">{msg.replyTo.text}</div>
                        </div>
                      )}
                      <div className="flex justify-end">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Delete message"
                          className="text-destructive opacity-0 transition-opacity group-hover:opacity-100"
                          onClick={async () => {
                            if (!confirm("Delete this message?")) return;
                            await deleteMessage(selectedChat, msg.key);
                            setMessages((prev) => prev.filter((m) => m.key !== msg.key));
                            toast.success("Message deleted");
                          }}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        </div>
      )}

      {/* Direct admin message dialog — pick a user + send message */}
      {composeOpen && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/50 p-4" onClick={() => setComposeOpen(false)}>
          <div className="w-full max-w-md rounded-xl border bg-background p-6" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Send direct message</h3>
              <Button variant="ghost" size="icon-sm" onClick={() => setComposeOpen(false)}>
                <X />
              </Button>
            </div>
            <p className="text-muted-foreground mb-3 text-sm">
              This opens a chat between you (admin) and the user. They will see it as a regular conversation with badge "Admin".
            </p>
            <div className="mb-3">
              <label className="text-muted-foreground text-xs font-medium">Select user</label>
              <select
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none"
                value={composeUser}
                onChange={(e) => setComposeUser(e.target.value)}
              >
                <option value="">— Select —</option>
                {Object.values(users)
                  .filter((u) => u.uid !== useAdmin.getState().admin?.uid && !u.isBanned)
                  .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
                  .map((u) => (
                    <option key={u.uid} value={u.uid}>
                      {u.name || "Unknown"} #{u.uniqueId || "?"} — {u.email || ""}
                    </option>
                  ))}
              </select>
            </div>
            <div className="mb-3">
              <label className="text-muted-foreground text-xs font-medium">Message</label>
              <textarea
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none"
                rows={4}
                value={adminMsg}
                onChange={(e) => setAdminMsg(e.target.value)}
                placeholder="Type your message to the user..."
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setComposeOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={!composeUser || !adminMsg.trim() || sendingAdminMsg}
                onClick={async () => {
                  if (!composeUser || !adminMsg.trim()) return;
                  setSendingAdminMsg(true);
                  try {
                    await adminMessageUser(composeUser, adminMsg.trim());
                    toast.success("Message sent to user");
                    setComposeOpen(false);
                    setAdminMsg("");
                    setComposeUser("");
                  } catch (e) {
                    toast.error((e as Error).message);
                  }
                  setSendingAdminMsg(false);
                }}
              >
                {sendingAdminMsg ? "Sending..." : "Send message"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Broadcast dialog — send same message to ALL users */}
      {broadcastOpen && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/50 p-4" onClick={() => setBroadcastOpen(false)}>
          <div className="w-full max-w-md rounded-xl border bg-background p-6" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Broadcast to all users</h3>
              <Button variant="ghost" size="icon-sm" onClick={() => setBroadcastOpen(false)}>
                <X />
              </Button>
            </div>
            <p className="text-muted-foreground mb-3 text-sm">
              Sends the same message to every active user (one message per user). Use sparingly.
            </p>
            <div className="mb-3">
              <label className="text-muted-foreground text-xs font-medium">Message</label>
              <textarea
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none"
                rows={4}
                value={broadcastMsg}
                onChange={(e) => setBroadcastMsg(e.target.value)}
                placeholder="Broadcast message..."
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setBroadcastOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={!broadcastMsg.trim() || sendingBroadcast}
                onClick={async () => {
                  if (!broadcastMsg.trim()) return;
                  if (!confirm(`Send this message to ALL ${Object.keys(users).length} users? This will write a separate message to each user's chat with you.`)) return;
                  setSendingBroadcast(true);
                  try {
                    const count = await adminBroadcastAll(broadcastMsg.trim());
                    toast.success(`Broadcast sent to ${count} users`);
                    setBroadcastOpen(false);
                    setBroadcastMsg("");
                  } catch (e) {
                    toast.error((e as Error).message);
                  }
                  setSendingBroadcast(false);
                }}
              >
                {sendingBroadcast ? "Sending..." : "Broadcast"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
