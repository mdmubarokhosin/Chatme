"use client";

/**
 * Chat — main orchestrator (multi-player design) wired to Firebase:
 * auth gate, conversation list + thread + profile panel (desktop grid,
 * mobile slide), feature views (statuses / calls / announcements / settings),
 * call overlays and dialogs.
 */
import { useEffect, useState } from "react";

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useIsLg } from "@/hooks/use-lg";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

import { AnnouncementsPanel } from "./announcements-panel";
import { CallOverlay, IncomingCallDialog } from "./call-overlay";
import { CallsPanel } from "./calls-panel";
import { ChatConversationList } from "./chat-conversation-list";
import { ChatProfileDetails } from "./chat-profile-details";
import { ChatThread } from "./chat-thread";
import { GroupCallOverlay, IncomingGroupCallDialog } from "./group-call-overlay";
import { GroupInfoPanel } from "./group-info-panel";
import { NewChatDialog } from "./new-chat-dialog";
import { PinLockScreen } from "./pin-lock-screen";
import { PremiumBanner, PremiumModal } from "./premium-modal";
import { SettingsPanel } from "./settings-panel";
import { StatusPanel, StatusViewer } from "./status-panel";
import { useChatApp, useUiStore, setView } from "../_lib/store";
import type { GroupChat, UserProfile } from "@/lib/types";

export function Chat() {
  const me = useChatApp((s) => s.me);
  const users = useChatApp((s) => s.users);
  const groups = useChatApp((s) => s.groups);
  const chats = useChatApp((s) => s.chats);
  const view = useChatApp((s) => s.view);
  const activeChatUserId = useChatApp((s) => s.activeChatUserId);
  const newChatOpen = useUiStore((s) => s.newChatOpen);
  const setNewChatOpen = useUiStore((s) => s.setNewChatOpen);

  const [showContact, setShowContact] = useState(false);
  const [showThread, setShowThread] = useState(false);
  const isLg = useIsLg();
  const isMobile = useIsMobile();

  /* Active group (when the selected conversation is a group chat) */
  const activeGroup: GroupChat | null =
    activeChatUserId && activeChatUserId.startsWith("g_")
      ? groups[activeChatUserId.slice(2)] || null
      : null;

  /* 1:1 contact OR a pseudo-profile representing the group for ChatThread */
  const activeContact: UserProfile | undefined = activeGroup
    ? {
        uid: `g_${activeGroup.gid}`,
        name: activeGroup.name || "Group",
        photoUrl: activeGroup.photoUrl,
        isOnline: false,
        lastSeen: 0,
      }
    : activeChatUserId
      ? users[activeChatUserId]
      : undefined;
  const isFeatureView = view !== "inbox";

  /* Auto-open chat thread on mobile when a chat is selected (via search dropdown
     or conversation tap) so the user actually sees the conversation. */
  useEffect(() => {
    if (activeChatUserId) setShowThread(true);
  }, [activeChatUserId]);

  /* Reset chat thread visibility when user navigates to a feature view (settings,
     statuses, calls, announcements) — otherwise settings panel + chat thread
     overlap on mobile. */
  useEffect(() => {
    if (isFeatureView) setShowThread(false);
  }, [isFeatureView, view]);

  /* Keyboard shortcuts (desktop):
     Ctrl/Cmd+K → focus search · Ctrl/Cmd+N → new chat · Esc → close thread */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setView("inbox");
        window.dispatchEvent(new CustomEvent("chatbd-open-search"));
      } else if (mod && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setNewChatOpen(true);
      } else if (e.key === "Escape") {
        setShowContact(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setNewChatOpen]);

  return (
    <>
      <div
        className="grid h-full min-h-0 min-w-0 flex-1 grid-cols-1 overflow-hidden shadow-sm transition-[grid-template-columns] duration-300 ease-out *:min-h-0 *:min-w-0 md:grid-cols-[22.5rem_minmax(0,1fr)] md:*:first:border-r lg:grid-cols-[22.5rem_minmax(0,1fr)_var(--profile-width)]"
        style={
          {
            "--profile-width": showContact && activeContact ? "20rem" : "0rem",
          } as React.CSSProperties
        }
      >
        {/* Left column: conversations OR feature panel */}
        <div
          className={cn(
            "min-h-0 max-md:col-start-1 max-md:row-start-1",
            !isFeatureView &&
              "transition-transform duration-300 ease-out will-change-transform",
            !isFeatureView && showThread && "max-md:pointer-events-none max-md:-translate-x-full",
          )}
        >
          {isFeatureView ? (
            <div className="h-full">
              {view === "statuses" && <StatusPanel />}
              {view === "calls" && <CallsPanel />}
              {view === "announcements" && <AnnouncementsPanel />}
              {view === "settings" && <SettingsPanel />}
            </div>
          ) : (
            <div className="flex h-full flex-col">
              <PremiumBanner />
              <ChatConversationList onSelectConversation={() => setShowThread(true)} className="min-h-0 flex-1" />
            </div>
          )}
        </div>

        {/* Thread */}
        {activeContact ? (
          <ChatThread
            contact={activeContact}
            showBackButton={isMobile}
            onBack={() => setShowThread(false)}
            onOpenContact={() => setShowContact(true)}
            className={cn(
              "transition-transform duration-300 ease-out will-change-transform max-md:col-start-1 max-md:row-start-1",
              isFeatureView && "max-md:pointer-events-none max-md:hidden",
              !isFeatureView && (showThread ? "max-md:translate-x-0" : "max-md:pointer-events-none max-md:translate-x-full"),
            )}
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 p-8 text-center max-md:col-start-1 max-md:row-start-1 max-md:hidden">
            <div className="bg-muted flex size-16 items-center justify-center rounded-full">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted-foreground size-8">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <div className="font-medium">Select a conversation</div>
            <div className="text-muted-foreground max-w-xs text-sm leading-relaxed">
              Pick a chat from the inbox or start a new conversation with someone's 4-digit ChatBD ID.
            </div>
          </div>
        )}

        {/* Profile details (desktop) — group info panel for groups */}
        <div
          aria-hidden={!showContact}
          className={cn(
            "hidden overflow-hidden border-l transition-colors duration-300 lg:block",
            !showContact && "pointer-events-none border-l-transparent",
          )}
        >
          <div
            className={cn(
              "h-full w-80 transition-[opacity,transform] duration-300 ease-out",
              showContact ? "translate-x-0 opacity-100" : "translate-x-full opacity-0",
            )}
          >
            {activeContact && activeGroup && (
              <GroupInfoPanel group={activeGroup} chatId={`g_${activeGroup.gid}`} onClose={() => setShowContact(false)} />
            )}
            {activeContact && !activeGroup && (
              <ChatProfileDetails contact={activeContact} onClose={() => setShowContact(false)} />
            )}
          </div>
        </div>
      </div>

      {/* Tablet/Mobile: profile sheet */}
      {!isLg && activeContact && (
        <Sheet open={showContact} onOpenChange={setShowContact}>
          <SheetContent side="right" className="w-80 p-0" showCloseButton={false}>
            <SheetTitle className="sr-only">Contact profile</SheetTitle>
            <SheetDescription className="sr-only">View contact details and activity</SheetDescription>
            {activeGroup ? (
              <GroupInfoPanel group={activeGroup} chatId={`g_${activeGroup.gid}`} onClose={() => setShowContact(false)} />
            ) : (
              <ChatProfileDetails contact={activeContact} onClose={() => setShowContact(false)} />
            )}
          </SheetContent>
        </Sheet>
      )}

      {/* Overlays */}
      <NewChatDialog open={newChatOpen} onClose={() => setNewChatOpen(false)} />
      <CallOverlay />
      <IncomingCallDialog />
      <GroupCallOverlay />
      <IncomingGroupCallDialog />
      <StatusViewer />
      <PremiumModal />
      <PinLockScreen />
    </>
  );
}
