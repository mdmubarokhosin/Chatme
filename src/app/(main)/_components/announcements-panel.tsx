"use client";

/** Announcements panel — admin broadcasts with unread badge clear (Chatme feature). */
import { Megaphone } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { db } from "@/lib/firebase";
import { formatTime } from "@/lib/format";

import { useChatApp, useAppLang } from "../_lib/store";
import { t } from "@/lib/i18n";

export function AnnouncementsPanel() {
  const lang = useAppLang();
  const me = useChatApp((s) => s.me);
  const announcements = useChatApp((s) => s.announcements);

  function markAllSeen() {
    if (!me) return;
    db.ref(`users/${me.uid}/lastSeenAnnouncement`).set(Date.now()).catch(() => {});
    useChatApp.setState({ announcementBadge: 0 });
  }

  return (
    <div className="flex h-full flex-col" onPointerDown={markAllSeen}>
      <div className="border-b px-4 py-3">
        <h1 className="font-medium text-xl">{t(lang, "panel.announcements")}</h1>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-2 p-3">
          {announcements.length === 0 && (
            <div className="text-muted-foreground flex flex-col items-center gap-2 px-1 py-12 text-center text-sm">
              <Megaphone className="size-8 opacity-40" />
              {t(lang, "panel.noAnnouncements")}
            </div>
          )}
          {announcements.map((a) => (
            <div key={a.key} className="rounded-lg border p-3">
              <div className="mb-1 flex items-center gap-2">
                <div className="text-sm font-semibold">{a.title}</div>
                {a.priority === "high" && <Badge variant="destructive">Important</Badge>}
              </div>
              <div className="text-muted-foreground text-sm leading-relaxed whitespace-pre-wrap">{a.message}</div>
              <div className="text-muted-foreground mt-2 text-xs">{formatTime(a.timestamp)}</div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
