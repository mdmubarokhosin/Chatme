"use client";

/**
 * Users management — Admin-Panel users page design with the full Chatme
 * admin feature set: search/filter, ban/unban, role toggle, premium
 * grant/revoke, edit name/bio, force logout, delete, per-user detail.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";

import * as React from "react";
import {
  Ban,
  CheckCircle2,
  Crown,
  Download,
  LogOut,
  MoreHorizontal,
  Pencil,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { cn, getInitials } from "@/lib/utils";
import { formatDate, formatTime } from "@/lib/format";
import type { UserProfile } from "@/lib/types";

import { db } from "@/lib/firebase";
import { deleteUser, exportData, forceLogout, toggleBan, togglePremium, toggleRole, updateUserBio, updateUserName, useAdmin } from "../_lib/admin-store";

type UserRow = {
  uid: string;
  name: string;
  email: string;
  uniqueId: string | number;
  role: string;
  status: "online" | "offline" | "banned";
  isPremium: boolean;
  createdAt: number;
  photoUrl?: string;
};

export default function AdminUsersPage() {
  const users = useAdmin((s) => s.users);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState<UserProfile | null>(null);
  const [page, setPage] = useState(0);
  const pageSize = 10;

  const rows = useMemo<UserRow[]>(() => {
    return Object.values(users)
      .map((u) => ({
        uid: u.uid,
        name: u.name || "Unknown",
        email: u.email || "-",
        uniqueId: u.uniqueId ?? "????",
        role: u.role || "user",
        status: u.isBanned ? ("banned" as const) : u.isOnline ? ("online" as const) : ("offline" as const),
        isPremium: !!u.isPremium,
        createdAt: u.createdAt || 0,
        photoUrl: u.photoUrl,
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [users]);

  const filtered = useMemo(() => {
    let list = rows;
    if (roleFilter !== "all") list = list.filter((r) => r.role === roleFilter);
    if (statusFilter !== "all") list = list.filter((r) => r.status === statusFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((r) => r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q) || String(r.uniqueId).includes(q.replace("#", "")));
    }
    return list;
  }, [rows, search, roleFilter, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice(page * pageSize, (page + 1) * pageSize);

  function openDetail(uid: string) {
    setSelected(users[uid] || null);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="text-muted-foreground text-sm">Manage ChatBD accounts, roles, bans and premium access.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => exportData("users")}>
          <Download /> Export
        </Button>
      </div>

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="text-xl leading-none">All users ({filtered.length})</CardTitle>
          <CardDescription>Search, filter and manage every registered account.</CardDescription>
          <CardAction className="flex w-full flex-wrap justify-start gap-2 md:w-auto">
            <div className="relative w-full md:w-64">
              <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                className="pl-9"
                placeholder="Search name, email or #ID..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
              />
            </div>
            <Select value={roleFilter} onValueChange={(v) => { setRoleFilter(v); setPage(0); }}>
              <SelectTrigger size="sm" className="w-32">
                <span className="text-muted-foreground">Role:</span>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="start">
                <SelectGroup>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
              <SelectTrigger size="sm" className="w-36">
                <span className="text-muted-foreground">Status:</span>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="start">
                <SelectGroup>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="online">Online</SelectItem>
                  <SelectItem value="offline">Offline</SelectItem>
                  <SelectItem value="banned">Banned</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 px-0">
          <div className="hidden px-4 md:grid md:grid-cols-[2fr_1.4fr_0.7fr_0.9fr_1fr_0.5fr] md:gap-3">
            <div className="text-muted-foreground text-xs font-medium uppercase">User</div>
            <div className="text-muted-foreground text-xs font-medium uppercase">Email</div>
            <div className="text-muted-foreground text-xs font-medium uppercase">Role</div>
            <div className="text-muted-foreground text-xs font-medium uppercase">Status</div>
            <div className="text-muted-foreground text-xs font-medium uppercase">Joined</div>
            <div className="text-right text-muted-foreground text-xs font-medium uppercase">Actions</div>
          </div>

          <div className="flex flex-col">
            {pageRows.length === 0 && (
              <div className="text-muted-foreground px-4 py-10 text-center text-sm">No users match your filters.</div>
            )}
            {pageRows.map((row) => (
              <div
                key={row.uid}
                className="grid grid-cols-[1fr_auto] items-center gap-3 border-t px-4 py-3 hover:bg-muted/40 md:grid-cols-[2fr_1.4fr_0.7fr_0.9fr_1fr_0.5fr]"
              >
                <button type="button" className="flex min-w-0 items-center gap-3 text-left" onClick={() => openDetail(row.uid)}>
                  <Avatar className="size-9 shrink-0">
                    {row.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={row.photoUrl} alt={row.name} className="size-full rounded-full object-cover" />
                    ) : (
                      <AvatarFallback className="text-muted-foreground text-xs">{getInitials(row.name)}</AvatarFallback>
                    )}
                  </Avatar>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{row.name}</span>
                      {row.isPremium && <Crown className="size-3 shrink-0 text-amber-500" />}
                    </span>
                    <span className="text-muted-foreground font-mono text-xs">#{row.uniqueId}</span>
                  </span>
                </button>
                <div className="text-muted-foreground hidden truncate text-sm md:block">{row.email}</div>
                <div className="hidden md:block">
                  <Badge variant={row.role === "admin" ? "default" : "secondary"}>{row.role}</Badge>
                </div>
                <div className="hidden md:block">
                  <Badge
                    variant="outline"
                    className={cn(
                      row.status === "online" && "border-green-600/40 text-green-600",
                      row.status === "banned" && "border-destructive/40 text-destructive",
                    )}
                  >
                    {row.status}
                  </Badge>
                </div>
                <div className="text-muted-foreground hidden truncate text-sm md:block">{row.createdAt ? formatDate(row.createdAt) : "-"}</div>
                <div className="flex justify-end">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label="Row actions">
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuGroup>
                        <DropdownMenuItem onSelect={() => openDetail(row.uid)}>
                          <UserRound /> View details
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => toggleBan(users[row.uid])}>
                          <Ban /> {row.status === "banned" ? "Unban" : "Ban"}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => togglePremium(users[row.uid])}>
                          <Crown /> {row.isPremium ? "Revoke premium" : "Grant premium"}
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => deleteUser(users[row.uid])}>
                        <Trash2 /> Delete user
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between px-4">
            <div className="text-muted-foreground text-sm tabular-nums">
              Page {page + 1} of {pageCount}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={page >= pageCount - 1} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <UserDetailDialog user={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

/* ==================== USER DETAIL DIALOG ==================== */

function UserDetailDialog({ user, onClose }: { user: UserProfile | null; onClose: () => void }) {
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [tab, setTab] = useState<"profile" | "chats" | "settings" | "activity">("profile");
  const chats = useAdmin((s) => s.chats);
  const users = useAdmin((s) => s.users);
  const logs = useAdmin((s) => s.logs);
  const [userSettings, setUserSettings] = useState<Record<string, unknown> | null>(null);

  React.useEffect(() => {
    if (user) {
      setName(user.name || "");
      setBio(user.bio || "");
      setTab("profile");
      setUserSettings(null);
      /* load the user's settings (users/{uid}/settings, same data the chat app writes) */
      db.ref(`users/${user.uid}/settings`)
        .once("value")
        .then((snap: { val: () => Record<string, unknown> | null }) => setUserSettings(snap.val()))
        .catch(() => setUserSettings(null));
    }
  }, [user?.uid]);

  if (!user) return null;

  const userChats = Object.values(chats).filter((c) => c.participant1 === user.uid || c.participant2 === user.uid);
  const userLogs = logs.filter((l) => l.userId === user.uid).slice(0, 20);
  const notif = (userSettings?.notifications || {}) as Record<string, unknown>;
  const privacy = (userSettings?.privacy || {}) as Record<string, unknown>;

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-lg overflow-hidden rounded-xl border bg-background" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="font-medium">User details</div>
          <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
            ×
          </Button>
        </div>

        {/* summary header */}
        <div className="flex items-center gap-4 border-b px-4 py-4">
          <Avatar size="lg" className="size-14">
            {user.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.photoUrl} alt={user.name || "User"} className="size-full rounded-full object-cover" />
            ) : (
              <AvatarFallback className="text-lg">{getInitials(user.name || "U")}</AvatarFallback>
            )}
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="truncate font-semibold">{user.name || "Unknown"}</div>
              {user.isPremium && <Crown className="size-4 shrink-0 text-amber-500" />}
            </div>
            <div className="text-muted-foreground font-mono text-sm">#{user.uniqueId || "????"}</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Badge variant={user.role === "admin" ? "default" : "secondary"}>{user.role}</Badge>
              <Badge
                variant="outline"
                className={cn(
                  user.isOnline && "border-green-600/40 text-green-600",
                  user.isBanned && "border-destructive/40 text-destructive",
                )}
              >
                {user.isBanned ? "banned" : user.isOnline ? "online" : "offline"}
              </Badge>
            </div>
          </div>
        </div>

        {/* tabs */}
        <div className="flex gap-1 border-b px-2">
          {([
            ["profile", "Profile"],
            ["chats", `Chats (${userChats.length})`],
            ["settings", "Settings"],
            ["activity", "Activity"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={cn(
                "border-b-2 px-3 py-2 text-sm transition-colors",
                tab === id ? "border-primary text-primary font-medium" : "text-muted-foreground hover:text-foreground border-transparent",
              )}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <ScrollArea className="max-h-[55vh]">
          <div className="flex flex-col gap-4 p-4">
            {/* ==================== PROFILE TAB ==================== */}
            {tab === "profile" && (
              <>
                <div className="text-muted-foreground grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="block text-xs">Email</span>
                    <span className="text-foreground truncate">{user.email || "-"}</span>
                  </div>
                  <div>
                    <span className="block text-xs">Member since</span>
                    <span className="text-foreground">{formatDate(user.createdAt)}</span>
                  </div>
                  <div>
                    <span className="block text-xs">Last seen</span>
                    <span className="text-foreground">{formatTime(user.lastSeen)}</span>
                  </div>
                  <div>
                    <span className="block text-xs">Premium</span>
                    <span className="text-foreground">{user.isPremium ? "Active" : "Free"}</span>
                  </div>
                  <div>
                    <span className="block text-xs">User ID</span>
                    <span className="text-foreground truncate font-mono text-xs">{user.uid}</span>
                  </div>
                </div>

                <Separator />

                <div className="flex flex-col gap-2">
                  <Label htmlFor="u-name">Display name</Label>
                  <div className="flex gap-2">
                    <Input id="u-name" value={name} onChange={(e) => setName(e.target.value)} />
                    <Button size="sm" variant="outline" onClick={() => updateUserName(user, name.trim()).then(() => toast.success("Name updated"))}>
                      <Pencil className="size-4" /> Save
                    </Button>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="u-bio">Bio</Label>
                  <div className="flex gap-2">
                    <Input id="u-bio" value={bio} onChange={(e) => setBio(e.target.value)} />
                    <Button size="sm" variant="outline" onClick={() => updateUserBio(user, bio.trim()).then(() => toast.success("Bio updated"))}>
                      <Pencil className="size-4" /> Save
                    </Button>
                  </div>
                </div>

                <Separator />

                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant={user.isBanned ? "outline" : "destructive"}
                    onClick={async () => {
                      await toggleBan(user);
                      toast.success(user.isBanned ? "User unbanned" : "User banned");
                    }}
                  >
                    <Ban className="size-4" /> {user.isBanned ? "Unban" : "Ban"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={async () => {
                      await toggleRole(user);
                      toast.success("Role updated");
                    }}
                  >
                    <ShieldCheck className="size-4" /> {user.role === "admin" ? "Make user" : "Make admin"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={async () => {
                      await togglePremium(user);
                      toast.success(user.isPremium ? "Premium revoked" : "Premium granted");
                    }}
                  >
                    <Crown className="size-4" /> {user.isPremium ? "Revoke premium" : "Grant premium"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={async () => {
                      await forceLogout(user);
                      toast.success("User force logged out");
                    }}
                  >
                    <LogOut className="size-4" /> Force logout
                  </Button>
                </div>

                <Button
                  variant="destructive"
                  onClick={async () => {
                    if (!confirm(`Delete ${user.name || "this user"} permanently? This cannot be undone.`)) return;
                    await deleteUser(user);
                    toast.success("User deleted");
                    onClose();
                  }}
                >
                  <Trash2 className="size-4" /> Delete account
                </Button>

                <div className="text-muted-foreground flex items-center gap-1 text-xs">
                  <CheckCircle2 className="size-3" /> Actions are applied instantly and logged to the activity feed.
                </div>
              </>
            )}

            {/* ==================== CHATS TAB ==================== */}
            {tab === "chats" && (
              <div className="flex flex-col gap-2">
                {userChats.length === 0 && <div className="text-muted-foreground py-6 text-center text-sm">No conversations yet</div>}
                {userChats
                  .sort((a, b) => (b.lastTimestamp || 0) - (a.lastTimestamp || 0))
                  .map((chat) => {
                    const otherUid = chat.participant1 === user.uid ? chat.participant2 : chat.participant1;
                    const other = users[otherUid as string];
                    return (
                      <div key={chat.chatId} className="flex items-center gap-3 rounded-lg border px-3 py-2">
                        <Avatar className="size-8">
                          {other?.photoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={other.photoUrl} alt={other?.name || "User"} className="size-full rounded-full object-cover" />
                          ) : (
                            <AvatarFallback className="text-xs">{getInitials(other?.name || "U")}</AvatarFallback>
                          )}
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{other?.name || "Unknown"}</div>
                          <div className="text-muted-foreground truncate text-xs">
                            {chat.lastMessage ? `${chat.lastMessage} · ${formatTime(chat.lastTimestamp)}` : "No messages yet"}
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}

            {/* ==================== SETTINGS TAB ==================== */}
            {tab === "settings" && (
              <div className="flex flex-col gap-1">
                {userSettings === null && <div className="text-muted-foreground py-6 text-center text-sm">No settings found</div>}
                {userSettings !== null && (
                  <>
                    <SettingViewRow label="Last seen privacy" value={String(privacy.lastSeen || "all")} />
                    <SettingViewRow label="Profile photo privacy" value={String(privacy.profilePhoto || "all")} />
                    <SettingViewRow label="Read receipts" value={privacy.readReceipts === false ? "off" : "on"} />
                    <SettingViewRow label="Status privacy" value={String(privacy.status || "all")} />
                    <SettingViewRow label="App lock (PIN)" value={privacy.fingerprintLock ? "on" : "off"} />
                    <Separator className="my-2" />
                    <SettingViewRow label="Message notifications" value={notif.messageNotif === false ? "off" : "on"} />
                    <SettingViewRow label="Show preview" value={notif.showPreview === false ? "off" : "on"} />
                    <SettingViewRow label="Notification tone" value={String(notif.notifTone || "default")} />
                    <SettingViewRow label="Vibrate" value={notif.vibrate === false ? "off" : "on"} />
                    <SettingViewRow label="Group notifications" value={notif.groupNotif === false ? "off" : "on"} />
                    <SettingViewRow label="Call notifications" value={notif.callNotif === false ? "off" : "on"} />
                  </>
                )}
              </div>
            )}

            {/* ==================== ACTIVITY TAB ==================== */}
            {tab === "activity" && (
              <div className="flex flex-col gap-2">
                {userLogs.length === 0 && <div className="text-muted-foreground py-6 text-center text-sm">No activity for this user</div>}
                {userLogs.map((log) => (
                  <div key={log.key} className="flex items-center gap-3 rounded-lg border px-3 py-2">
                    <Badge variant="secondary" className="shrink-0 text-[10px] capitalize">
                      {log.action.replace(/_/g, " ")}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate text-xs">{log.details}</span>
                    <span className="text-muted-foreground shrink-0 text-xs">{formatTime(log.timestamp)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

function SettingViewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium capitalize">{value}</span>
    </div>
  );
}
