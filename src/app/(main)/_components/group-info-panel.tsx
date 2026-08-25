"use client";

/**
 * GroupInfoPanel — group details sheet: photo/name/description editing (admins),
 * member list with add/remove, leave-group button, disappearing-messages timer.
 */
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Check, LogOut, Plus, Users, X } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn, getInitials } from "@/lib/utils";
import { t } from "@/lib/i18n";
import { db } from "@/lib/firebase";
import type { GroupChat } from "@/lib/types";

import {
  addGroupMembers,
  leaveGroup,
  removeGroupMember,
  setDisappearing,
  updateGroupInfo,
  uploadGroupPhoto,
} from "../_lib/chat-actions";
import { setActiveChatUser, useChatApp, useAppLang } from "../_lib/store";

export function GroupInfoPanel({ group, chatId, onClose }: { group: GroupChat; chatId: string; onClose: () => void }) {
  const me = useChatApp((s) => s.me);
  const users = useChatApp((s) => s.users);
  const chats = useChatApp((s) => s.chats);
  const lang = useAppLang();
  const tr = (key: string) => t(lang, key);

  const [name, setName] = useState(group.name || "");
  const [description, setDescription] = useState(group.description || "");
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [pickedAdd, setPickedAdd] = useState<Set<string>>(new Set());
  const photoInputRef = useRef<HTMLInputElement>(null);

  const isAdmin = !!(me && group.admins?.[me.uid]);
  const disappearing = chats[chatId]?.disappearing || "off";
  const memberUids = Object.keys(group.members || {});

  /* non-admins can still switch disappearing messages (WhatsApp parity) */
  const canToggleDisappearing = true;

  useEffect(() => {
    setName(group.name || "");
    setDescription(group.description || "");
  }, [group.gid, group.name, group.description]);

  const candidates = Object.entries(users)
    .filter(([uid, u]) => uid !== me?.uid && !u.isBanned && !group.members?.[uid])
    .filter(([uid, u]) =>
      addQuery.trim()
        ? (u.name || "").toLowerCase().includes(addQuery.trim().toLowerCase()) ||
          String(u.uniqueId || "").includes(addQuery.trim().replace(/[#\s]/g, ""))
        : true,
    )
    .slice(0, 30);

  async function save() {
    setSaving(true);
    try {
      await updateGroupInfo(group.gid, { name: name.trim(), description: description.trim() });
    } catch {
      toast.error(tr("settings.saveFailed"));
    }
    setSaving(false);
  }

  async function confirmLeave() {
    if (!me) return;
    if (!window.confirm(`${tr("newchat.leaveGroup")} — ${group.name || "Group"}?`)) return;
    await leaveGroup(group.gid, me.uid);
    setActiveChatUser(null);
    onClose();
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="font-medium text-lg">{tr("newchat.groupInfo")}</h2>
        <Button variant="ghost" size="icon-sm" aria-label={tr("common.close")} onClick={onClose}>
          <X />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {/* Photo + name */}
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            <Avatar className="size-20">
              {group.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={group.photoUrl} alt={group.name || "Group"} className="size-full rounded-full object-cover" />
              ) : (
                <AvatarFallback className="bg-primary/15 text-primary">
                  <Users className="size-9" />
                </AvatarFallback>
              )}
            </Avatar>
            {isAdmin && (
              <>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) await uploadGroupPhoto(file, group.gid, group.photoUrl);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  className="bg-primary text-primary-foreground absolute right-0 bottom-0 grid size-7 place-items-center rounded-full shadow"
                  aria-label="Change group photo"
                  onClick={() => photoInputRef.current?.click()}
                >
                  <Plus className="size-4" />
                </button>
              </>
            )}
          </div>
          <div className="text-muted-foreground text-xs">
            {memberUids.length} {tr("thread.members")}
          </div>
        </div>

        {/* Editable fields (admins only) */}
        <div className="mt-4 flex flex-col gap-3">
          <div>
            <Label htmlFor="gi-name" className="text-muted-foreground text-xs">{tr("newchat.groupName")}</Label>
            <Input id="gi-name" value={name} onChange={(e) => setName(e.target.value)} disabled={!isAdmin} maxLength={50} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="gi-desc" className="text-muted-foreground text-xs">{tr("newchat.description")}</Label>
            <Input
              id="gi-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!isAdmin}
              maxLength={200}
              placeholder={tr("newchat.descriptionPlaceholder")}
              className="mt-1"
            />
          </div>
          {isAdmin && (
            <Button onClick={save} disabled={saving || name.trim().length < 2}>
              {saving ? tr("common.saving") : tr("newchat.saveGroup")}
            </Button>
          )}
        </div>

        {/* Disappearing messages */}
        <div className="mt-5">
          <div className="mb-2 text-sm font-medium">{tr("thread.disappearing")}</div>
          {canToggleDisappearing && (
            <div className="flex w-full items-center gap-1 rounded-lg border p-0.5">
              {([
                ["off", tr("thread.disappearingOff")],
                ["24h", "24h"],
                ["7d", "7d"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={cn(
                    "flex flex-1 items-center justify-center rounded-md px-2 py-1 text-xs font-medium transition-colors",
                    disappearing === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                  )}
                  onClick={() => setDisappearing(chatId, value)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Members */}
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">
              {tr("newchat.members")} ({memberUids.length})
            </span>
            {isAdmin && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAdding((v) => !v)}>
                <Plus className="size-3.5" /> {tr("newchat.addMembers")}
              </Button>
            )}
          </div>

          {adding && (
            <div className="mb-3 rounded-lg border p-2">
              <Input
                placeholder={tr("newchat.searchAllPlaceholder")}
                value={addQuery}
                onChange={(e) => setAddQuery(e.target.value)}
                className="h-8 text-sm"
              />
              <div className="mt-2 max-h-44 overflow-y-auto">
                {candidates.length === 0 && (
                  <div className="text-muted-foreground px-2 py-3 text-center text-xs">{tr("list.noUser")}</div>
                )}
                {candidates.map(([uid, u]) => (
                  <button
                    key={uid}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
                    onClick={() => {
                      setPickedAdd((prev) => {
                        const next = new Set(prev);
                        if (next.has(uid)) next.delete(uid);
                        else next.add(uid);
                        return next;
                      });
                    }}
                  >
                    <Avatar className="size-7">
                      {u.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={u.photoUrl} alt={u.name || "User"} className="size-full rounded-full object-cover" />
                      ) : (
                        <AvatarFallback className="text-[10px]">{getInitials(u.name || "U")}</AvatarFallback>
                      )}
                    </Avatar>
                    <span className="min-w-0 flex-1 truncate text-xs">{u.name || "Unknown"}</span>
                    <span
                      className={cn(
                        "grid size-4 shrink-0 place-items-center rounded-full border",
                        pickedAdd.has(uid) ? "border-primary bg-primary text-primary-foreground" : "border-border",
                      )}
                    >
                      {pickedAdd.has(uid) && <Check className="size-2.5" />}
                    </span>
                  </button>
                ))}
              </div>
              {pickedAdd.size > 0 && (
                <Button
                  size="sm"
                  className="mt-2 w-full"
                  onClick={async () => {
                    await addGroupMembers(group.gid, Array.from(pickedAdd));
                    setPickedAdd(new Set());
                    setAdding(false);
                    setAddQuery("");
                  }}
                >
                  {tr("newchat.addMembers")} ({pickedAdd.size})
                </Button>
              )}
            </div>
          )}

          <div className="flex flex-col gap-1">
            {memberUids.map((uid) => {
              const u = users[uid];
              const isGroupAdmin = !!group.admins?.[uid];
              return (
                <div key={uid} className="flex items-center gap-3 rounded-lg px-1 py-1.5">
                  <Avatar className="size-8">
                    {u?.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={u.photoUrl} alt={u?.name || "User"} className="size-full rounded-full object-cover" />
                    ) : (
                      <AvatarFallback className="text-xs">{getInitials(u?.name || "U")}</AvatarFallback>
                    )}
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{uid === me?.uid ? tr("common.you") : u?.name || "Unknown"}</span>
                      {isGroupAdmin && (
                        <span className="text-primary shrink-0 text-[10px] font-semibold uppercase">{tr("newchat.admin")}</span>
                      )}
                    </div>
                    <div className="text-muted-foreground text-xs">#{u?.uniqueId || "????"}</div>
                  </div>
                  {isAdmin && uid !== me?.uid && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive h-7 text-xs"
                      onClick={() => removeGroupMember(group.gid, uid, u?.name || "Member")}
                    >
                      {tr("newchat.removeMember")}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Leave */}
        <Button variant="destructive" className="mt-6 w-full" onClick={confirmLeave}>
          <LogOut className="size-4" /> {tr("newchat.leaveGroup")}
        </Button>
      </div>
    </div>
  );
}
