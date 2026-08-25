"use client";

/** Call history — ports Chatme's call log with incoming/outgoing/missed states. */
import { PhoneCall, PhoneIncoming, PhoneMissed, PhoneOutgoing, Video } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { cn, getInitials } from "@/lib/utils";
import { formatCallDuration, formatTime } from "@/lib/format";

import { useChatApp, useAppLang } from "../_lib/store";
import { t } from "@/lib/i18n";
import { startCall } from "../_lib/webrtc";

export function CallsPanel() {
  const lang = useAppLang();
  const me = useChatApp((s) => s.me);
  const users = useChatApp((s) => s.users);
  const calls = useChatApp((s) => s.calls);

  if (!me) return null;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-4 py-3">
        <h1 className="font-medium text-xl">{t(lang, "panel.calls")}</h1>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-1 p-3">
          {calls.length === 0 && <div className="text-muted-foreground px-1 py-8 text-center text-sm">{t(lang, "panel.noCalls")}</div>}
          {calls.map((call) => {
            const outgoing = call.callerId === me.uid;
            const otherUid = outgoing ? call.receiverId : call.callerId;
            const other = users[otherUid];
            const name = other?.name || (outgoing ? call.receiverName || "User" : call.callerName || "User");
            const missed = call.status === "missed" || call.status === "declined" || call.status === "busy";

            return (
              <div key={call.key} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/60">
                <Avatar className="size-9">
                  {other?.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={other.photoUrl} alt={name} className="size-full rounded-full object-cover" />
                  ) : (
                    <AvatarFallback className="text-xs">{getInitials(name)}</AvatarFallback>
                  )}
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{name}</div>
                  <div className="flex items-center gap-1 text-muted-foreground text-xs">
                    {missed ? (
                      <PhoneMissed className="size-3 text-red-500" />
                    ) : outgoing ? (
                      <PhoneOutgoing className="size-3 text-green-600" />
                    ) : (
                      <PhoneIncoming className="size-3 text-green-600" />
                    )}
                    {formatTime(call.startTime)}
                    {call.status === "connected" && call.endTime ? ` · ${formatCallDuration(call.startTime, call.endTime)}` : ""}
                    {missed ? " · missed" : ""}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Call back audio"
                    onClick={() => startCall(me.uid, me.name || "You", otherUid, name, "audio")}
                  >
                    <PhoneCall className={cn("size-4", missed && "text-red-500")} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Call back video"
                    onClick={() => startCall(me.uid, me.name || "You", otherUid, name, "video")}
                  >
                    <Video className="size-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
