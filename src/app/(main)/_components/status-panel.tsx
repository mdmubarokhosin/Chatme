"use client";

/**
 * Status panel — 24-hour text statuses (Chatme feature):
 * create with background colors, view with auto-advance, viewer tracking.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn, getInitials } from "@/lib/utils";
import { formatTime } from "@/lib/format";
import { STATUS_COLORS } from "@/lib/types";

import { markStatusViewed, postStatus } from "../_lib/chat-actions";
import { useChatApp, useAppLang } from "../_lib/store";
import { t } from "@/lib/i18n";

export function StatusPanel() {
  const lang = useAppLang();
  const me = useChatApp((s) => s.me);
  const statuses = useChatApp((s) => s.statuses);

  const [creatorOpen, setCreatorOpen] = useState(false);
  const [text, setText] = useState("");
  const [color, setColor] = useState(STATUS_COLORS[0]);
  const [posting, setPosting] = useState(false);

  const myStatuses = useMemo(() => statuses.filter((s) => s.userId === me?.uid), [statuses, me]);
  const otherByUser = useMemo(() => {
    const map = new Map<string, typeof statuses>();
    for (const s of statuses) {
      if (s.userId === me?.uid) continue;
      const arr = map.get(s.userId) || [];
      arr.push(s);
      map.set(s.userId, arr);
    }
    return Array.from(map.entries());
  }, [statuses, me]);

  async function handlePost() {
    if (!text.trim() || !me) return;
    setPosting(true);
    try {
      await postStatus(me.uid, me.name || "User", text.trim(), color);
      setText("");
      setCreatorOpen(false);
    } catch {
      /* handled in action */
    }
    setPosting(false);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h1 className="font-medium text-xl">{t(lang, "panel.statuses")}</h1>
        <Button size="sm" onClick={() => setCreatorOpen(true)}>
          <Plus className="size-4" /> Add status
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-1 p-3">
          {/* My status */}
          <div className="mb-2 px-1 text-muted-foreground text-xs font-medium">My status</div>
          <StatusRow
            name={(me?.name || "You") + (myStatuses.length ? "" : " · tap to add")}
            time={myStatuses.length ? formatTime(myStatuses[myStatuses.length - 1].timestamp) : "No status yet"}
            ring={myStatuses.length > 0}
            avatarName={me?.name || "You"}
            photoUrl={me?.photoUrl}
            onClick={() => (myStatuses.length ? undefined : setCreatorOpen(true))}
            onOpenViewer={myStatuses.length ? () => document.getElementById("open-my-statuses")?.click() : undefined}
          />
          {myStatuses.length > 0 && (
            <button id="open-my-statuses" type="button" className="hidden" onClick={() => window.dispatchEvent(new CustomEvent("chatbd-open-statuses", { detail: myStatuses }))} />
          )}

          {otherByUser.length > 0 && <div className="mt-4 mb-2 px-1 text-muted-foreground text-xs font-medium">Recent updates</div>}
          {otherByUser.map(([uid, list]) => (
            <StatusRow
              key={uid}
              name={list[0].userName || "Unknown"}
              time={formatTime(list[list.length - 1].timestamp)}
              ring
              avatarName={list[0].userName || "U"}
              onClick={() => window.dispatchEvent(new CustomEvent("chatbd-open-statuses", { detail: list }))}
            />
          ))}

          {otherByUser.length === 0 && myStatuses.length === 0 && (
            <div className="text-muted-foreground px-1 py-8 text-center text-sm">No status updates yet</div>
          )}
        </div>
      </ScrollArea>

      {/* Creator dialog */}
      {creatorOpen && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/50 p-6" onClick={() => setCreatorOpen(false)}>
          <div className="w-full max-w-md rounded-xl border bg-background p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <div className="font-medium">New status</div>
              <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={() => setCreatorOpen(false)}>
                <X />
              </Button>
            </div>
            <div
              className="mb-3 flex min-h-40 items-center justify-center rounded-lg p-6 text-center text-lg font-medium text-white"
              style={{ background: color }}
            >
              {text || "Type your status..."}
            </div>
            <Input placeholder="What's on your mind?" value={text} onChange={(e) => setText(e.target.value)} maxLength={200} />
            <div className="mt-3 flex flex-wrap gap-2">
              {STATUS_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Color ${c}`}
                  className={cn("size-7 rounded-full border-2 transition-transform", color === c ? "scale-110 border-white ring-2 ring-primary" : "border-transparent")}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
            <Button className="mt-4 w-full" disabled={!text.trim() || posting} onClick={handlePost}>
              {posting ? "Posting..." : "Post status"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusRow({
  name,
  time,
  ring,
  avatarName,
  photoUrl,
  onClick,
  onOpenViewer,
}: {
  name: string;
  time: string;
  ring?: boolean;
  avatarName: string;
  photoUrl?: string;
  onClick?: () => void;
  onOpenViewer?: () => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted/60"
      onClick={() => (onOpenViewer ? onOpenViewer() : onClick?.())}
    >
      <span className={cn("rounded-full p-[2.5px]", ring ? "bg-green-500" : "bg-muted")}>
        <Avatar className="size-9 border-2 border-background">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt={avatarName} className="size-full rounded-full object-cover" />
          ) : (
            <AvatarFallback className="text-xs">{getInitials(avatarName)}</AvatarFallback>
          )}
        </Avatar>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{name}</span>
        <span className="text-muted-foreground block text-xs">{time}</span>
      </span>
    </button>
  );
}

/* ==================== STATUS VIEWER (full screen, auto-advance 5s) ==================== */

export function StatusViewer() {
  const [data, setData] = useState<{ key: string; userId: string; userName: string; text: string; color?: string; timestamp: number; viewerCount?: number }[] | null>(null);
  const [index, setIndex] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const me = useChatApp((s) => s.me);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setData(detail);
      setIndex(0);
    };
    window.addEventListener("chatbd-open-statuses", handler);
    return () => window.removeEventListener("chatbd-open-statuses", handler);
  }, []);

  useEffect(() => {
    if (!data) return;
    const current = data[index];
    if (current && me) markStatusViewed(current.key, me.uid, current.viewerCount);

    timerRef.current = setTimeout(() => {
      setIndex((i) => {
        if (i + 1 >= (data?.length || 0)) {
          setData(null);
          return i;
        }
        return i + 1;
      });
    }, 5000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [data, index, me]);

  if (!data || data.length === 0) return null;
  const s = data[index];

  return (
    <div className="fixed inset-0 z-100 flex flex-col" style={{ background: s.color || "#008069" }}>
      <div className="flex gap-1 p-3">
        {data.map((_, i) => (
          <div key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-white/30">
            <div className={cn("h-full bg-white", i < index && "w-full", i === index && "status-progress w-full")} style={{ animationDuration: "5s" }} />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 px-4 py-2 text-white">
        <Avatar className="size-9 border border-white/40">
          <AvatarFallback className="bg-white/20 text-xs text-white">{getInitials(s.userName)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{s.userName}</div>
          <div className="text-white/70 text-xs">{formatTime(s.timestamp)}</div>
        </div>
        <Button variant="ghost" size="icon-sm" className="text-white hover:bg-white/20" aria-label="Close" onClick={() => setData(null)}>
          <X />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 items-center px-4 pb-16">
        <button type="button" aria-label="Previous" className="h-full w-1/4" onClick={() => setIndex((i) => Math.max(0, i - 1))}>
          <ChevronLeft className="hidden" />
        </button>
        <div className="flex w-1/2 items-center justify-center text-center text-2xl font-medium break-words text-white">{s.text}</div>
        <button
          type="button"
          aria-label="Next"
          className="h-full w-1/4"
          onClick={() =>
            setIndex((i) => {
              if (i + 1 >= data.length) {
                setData(null);
                return i;
              }
              return i + 1;
            })
          }
        >
          <ChevronRight className="hidden" />
        </button>
      </div>
    </div>
  );
}
