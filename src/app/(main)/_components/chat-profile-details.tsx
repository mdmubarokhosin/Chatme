"use client";

import { useState } from "react";
import { toast } from "sonner";

import { AtSign, Ban, CheckCircle2, Hash, Mail, PhoneCall, ShieldCheck, Smile, Video, X } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn, getInitials } from "@/lib/utils";
import { formatDate, formatTime } from "@/lib/format";
import type { UserProfile } from "@/lib/types";

import { blockUser, unblockUser } from "../_lib/chat-actions";
import { useChatApp } from "../_lib/store";
import { startCall } from "../_lib/webrtc";

interface ChatProfileDetailsProps {
  contact: UserProfile;
  onClose?: () => void;
}

export function ChatProfileDetails({ contact, onClose }: ChatProfileDetailsProps) {
  const me = useChatApp((s) => s.me);
  const [working, setWorking] = useState(false);
  const isBlocked = !!(me?.blocked && me.blocked[contact.uid]);

  if (!me) return null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-start gap-3">
        <Avatar size="lg" className="shrink-0">
          {contact.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={contact.photoUrl} alt={contact.name || "User"} className="size-full rounded-full object-cover" />
          ) : (
            <AvatarFallback className="bg-background">{getInitials(contact.name || "U")}</AvatarFallback>
          )}
        </Avatar>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 truncate font-medium leading-5">
            {contact.name || "Unknown"}
            {contact.isOnline && <span className="size-2 shrink-0 rounded-full bg-green-600" />}
          </div>
          <div className="text-muted-foreground truncate text-xs">
            {contact.isOnline ? "Online" : contact.lastSeen ? `Last seen ${formatTime(contact.lastSeen)}` : "Offline"}
          </div>
        </div>

        <Button variant="ghost" size="icon-sm" aria-label="Close profile" onClick={onClose}>
          <X />
        </Button>
      </div>

      <div className="flex gap-2">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Audio call"
          onClick={() => startCall(me.uid, me.name || "You", contact.uid, contact.name || "User", "audio")}
        >
          <PhoneCall className="size-3.5" />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Video call"
          onClick={() => startCall(me.uid, me.name || "You", contact.uid, contact.name || "User", "video")}
        >
          <Video className="size-3.5" />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Copy ID"
          onClick={async () => {
            await navigator.clipboard.writeText(`#${contact.uniqueId || ""}`).catch(() => {});
            toast.success("ID copied!");
          }}
        >
          <Hash className="size-3.5" />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label="Message" disabled>
          <Smile className="size-3.5" />
        </Button>
      </div>

      <Tabs defaultValue="details">
        <TabsList variant="line" className="w-full justify-between border-b px-0 **:data-[slot=tabs-trigger]:flex-1">
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex items-center gap-2">
            <Hash className="text-muted-foreground size-4 shrink-0" />
            <span className="text-muted-foreground text-sm">ChatBD ID</span>
            <span className="ml-auto truncate font-mono text-sm">#{contact.uniqueId || "????"}</span>
          </div>
          <div className="flex items-center gap-2">
            <Mail className="text-muted-foreground size-4 shrink-0" />
            <span className="text-muted-foreground text-sm">Email</span>
            <span className="ml-auto max-w-40 truncate text-sm">{contact.email || "-"}</span>
          </div>
          <div className="flex items-center gap-2">
            <AtSign className="text-muted-foreground size-4 shrink-0" />
            <span className="text-muted-foreground text-sm">About</span>
            <span className="ml-auto max-w-40 truncate text-sm">{contact.bio || "-"}</span>
          </div>
        </div>

        <Separator />

        <div className="flex flex-col gap-3 text-sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="text-muted-foreground size-4 shrink-0" />
            <span className="text-muted-foreground text-sm">Member since</span>
            <span className="ml-auto text-sm">{formatDate(contact.createdAt)}</span>
          </div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="text-muted-foreground size-4 shrink-0" />
            <span className="text-muted-foreground text-sm">Role</span>
            <Badge variant="secondary" className={cn("ml-auto", contact.role === "admin" && "bg-primary/15 text-primary")}>
              {contact.role === "admin" ? "Admin" : "User"}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Smile className="text-muted-foreground size-4 shrink-0" />
            <span className="text-muted-foreground text-sm">Premium</span>
            <Badge variant="secondary" className="ml-auto">
              {contact.isPremium ? "Premium" : "Free"}
            </Badge>
          </div>
        </div>

        <Separator />

        <Button
          variant={isBlocked ? "outline" : "destructive"}
          className="w-full"
          disabled={working}
          onClick={async () => {
            setWorking(true);
            if (isBlocked) {
              await unblockUser(me.uid, contact.uid, contact.name || "User");
            } else {
              await blockUser(me.uid, contact.uid, contact.name || "User");
            }
            setWorking(false);
          }}
        >
          <Ban className="size-4" />
          {isBlocked ? "Unblock user" : "Block user"}
        </Button>
      </div>
    </div>
  );
}
