"use client";

/**
 * BottomNav — ports Chatme's bottom navigation (4 tabs: Chats, Status,
 * Calls, Settings) styled for the new design. Mobile/tablet only; the
 * desktop layout keeps its sidebar navigation.
 */
import { MessageCircle, Phone, Settings, CircleDot } from "lucide-react";

import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";

import { setView, useChatApp, useAppLang, ChatView } from "../_lib/store";

const TABS: { id: ChatView; labelKey: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "inbox", labelKey: "nav.chats", icon: MessageCircle },
  { id: "statuses", labelKey: "nav.status", icon: CircleDot },
  { id: "calls", labelKey: "nav.calls", icon: Phone },
  { id: "settings", labelKey: "nav.settings", icon: Settings },
];

export function BottomNav() {
  const view = useChatApp((s) => s.view);
  const me = useChatApp((s) => s.me);
  const announcementBadge = useChatApp((s) => s.announcementBadge);
  const lang = useAppLang();

  const unreadCount = useChatApp((s) => {
    if (!s.me) return 0;
    return Object.values(s.chats).filter((c) => c.unread && c.unread[s.me!.uid]).length;
  });

  if (!me) return null;

  function badgeFor(id: ChatView): string | number | null {
    if (id === "inbox" && unreadCount > 0) return unreadCount > 9 ? "9+" : unreadCount;
    if (id === "announcements" && announcementBadge > 0) return announcementBadge > 9 ? "9+" : announcementBadge;
    return null;
  }

  return (
    <nav
      className="flex h-14 min-h-14 shrink-0 items-stretch border-t bg-background md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      {TABS.map((tab) => {
        const isActive = view === tab.id;
        const badge = badgeFor(tab.id);
        return (
          <button
            key={tab.id}
            type="button"
            className={cn(
              "relative flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 transition-colors",
              isActive ? "text-primary" : "text-muted-foreground",
            )}
            onClick={() => setView(tab.id)}
            aria-current={isActive ? "page" : undefined}
          >
            <span className="relative">
              <tab.icon className={cn("size-5", isActive && "fill-primary/15")} />
              {badge !== null && (
                <span className="absolute -top-1.5 -right-2 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-destructive px-1 text-[8px] font-bold text-white">
                  {badge}
                </span>
              )}
            </span>
            <span className={cn("text-[10px] font-medium", isActive && "font-semibold")}>{t(lang, tab.labelKey)}</span>
            {isActive && <span className="bg-primary absolute top-0 h-0.5 w-8 rounded-full" />}
          </button>
        );
      })}
    </nav>
  );
}
