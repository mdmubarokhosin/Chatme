"use client";

import type { ReactNode } from "react";

import { SidebarProvider } from "@/components/ui/sidebar";

import { AppProvider } from "./_lib/app-provider";
import { useChatApp } from "./_lib/store";
import { AuthScreen } from "./_components/auth-screen";
import { BottomNav } from "./_components/bottom-nav";
import { ChatSidebar } from "./_components/chat-sidebar";

export default function ChatLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <AppProvider>
      <ChatShell>{children}</ChatShell>
    </AppProvider>
  );
}

function ChatShell({ children }: { children: ReactNode }) {
  const authUid = useChatApp((s) => s.authUid);
  const me = useChatApp((s) => s.me);
  const maintenance = useChatApp((s) => s.maintenance);
  const registrationOpen = useChatApp((s) => s.registrationOpen);

  if (authUid === undefined) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="border-primary size-8 animate-spin rounded-full border-2 border-t-transparent" />
          <div className="text-muted-foreground text-sm">Loading ChatBD...</div>
        </div>
      </div>
    );
  }

  if (authUid === null || !me) {
    return <AuthScreen registrationOpen={registrationOpen} maintenance={maintenance} />;
  }

  return (
    <SidebarProvider className="flex h-screen flex-col">
      <div className="flex min-h-0 flex-1">
        {/* Desktop navigation sidebar (hidden on mobile — bottom nav takes over) */}
        <div className="hidden md:flex">
          <ChatSidebar />
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      </div>
      {/* Mobile bottom navigation (Chatme style: Chats / Status / Calls / Settings) */}
      <BottomNav />
    </SidebarProvider>
  );
}
