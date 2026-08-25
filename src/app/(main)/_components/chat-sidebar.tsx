"use client";

import { Crown, EllipsisVertical, LogOut, MessageSquarePlus, Settings, ShieldCheck, UserRound } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { getInitials } from "@/lib/utils";
import { auth, db, serverTimestamp } from "@/lib/firebase";

import { setView, useChatApp, useUiStore } from "../_lib/store";

type NavItem = {
  id: string;
  title: string;
  badge?: number;
  onSelect: () => void;
};

export function ChatSidebar() {
  const { state } = useSidebar();
  const _isCollapsed = state === "collapsed";
  const setNewChatOpen = useUiStore((s) => s.setNewChatOpen);

  const view = useChatApp((s) => s.view);
  const me = useChatApp((s) => s.me);
  const announcementBadge = useChatApp((s) => s.announcementBadge);
  const unreadCount = useChatApp((s) => {
    if (!s.me) return 0;
    return Object.values(s.chats).filter((c) => c.unread && c.unread[s.me!.uid]).length;
  });

  const navItems: NavItem[] = [
    { id: "inbox", title: "Inbox", badge: unreadCount > 0 ? unreadCount : undefined, onSelect: () => setView("inbox") },
    { id: "statuses", title: "Statuses", onSelect: () => setView("statuses") },
    { id: "calls", title: "Calls", onSelect: () => setView("calls") },
    {
      id: "announcements",
      title: "Announcements",
      badge: announcementBadge > 0 ? announcementBadge : undefined,
      onSelect: () => setView("announcements"),
    },
    {
      id: "settings",
      title: "Settings",
      onSelect: () => setView("settings"),
    },
  ];

  async function handleLogout() {
    if (auth.currentUser) {
      await db
        .ref(`users/${auth.currentUser.uid}`)
        .update({ isOnline: false, lastSeen: serverTimestamp })
        .catch(() => {});
    }
    await auth.signOut();
  }

  return (
    <Sidebar
      collapsible="offcanvas"
      className="h-full! **:data-[sidebar=sidebar]:bg-background"
    >
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="font-normal">Navigation</SidebarGroupLabel>
          <SidebarMenu className="gap-1">
            {navItems.map((item) => (
              <SidebarMenuItem key={item.id}>
                <SidebarMenuButton
                  className="[&_svg]:size-3.5"
                  size="sm"
                  isActive={view === item.id}
                  tooltip={item.title}
                  onClick={item.onSelect}
                >
                  <ViewIcon id={item.id} />
                  <span className="font-medium">{item.title}</span>
                </SidebarMenuButton>
                {item.badge ? <SidebarMenuBadge className="font-medium">{item.badge}</SidebarMenuBadge> : null}
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="font-normal">Quick</SidebarGroupLabel>
          <SidebarMenu className="gap-1">
            <SidebarMenuItem>
              <SidebarMenuButton className="[&_svg]:size-3.5" size="sm" tooltip="New chat" onClick={() => setNewChatOpen(true)}>
                <MessageSquarePlus />
                <span className="font-medium">New chat</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            {me?.role === "admin" && (
              <SidebarMenuItem>
                <SidebarMenuButton className="[&_svg]:size-3.5" size="sm" tooltip="Admin panel" asChild>
                  <a href="/admin" target="_blank" rel="noreferrer">
                    <ShieldCheck />
                    <span className="font-medium">Admin panel</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <Separator />
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <Avatar>
                    <AvatarFallback className="text-xs">{getInitials(me?.name || "User")}</AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="flex min-w-0 items-center gap-1">
                      <span className="truncate font-medium">{me?.name || "User"}</span>
                      {me?.isPremium && <Crown className="size-3 shrink-0 text-amber-500" />}
                    </span>
                    <span className="truncate text-muted-foreground text-xs">{me?.email || `#${me?.uniqueId}`}</span>
                  </div>
                  <EllipsisVertical className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width) min-w-56" side="top">
                <DropdownMenuLabel className="p-0 font-normal">
                  <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                    <Avatar>
                      <AvatarFallback className="text-xs">{getInitials(me?.name || "User")}</AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-medium">{me?.name || "User"}</span>
                      <span className="truncate text-muted-foreground text-xs">#{me?.uniqueId || "????"}</span>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem onSelect={() => setView("settings")}>
                    <UserRound />
                    Account
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setView("settings")}>
                    <Settings />
                    Settings
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={handleLogout}>
                  <LogOut />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}


function ViewIcon({ id }: { id: string }) {
  if (id === "statuses") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3.5">
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="4" />
      </svg>
    );
  }
  if (id === "calls") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3.5">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
      </svg>
    );
  }
  if (id === "settings") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3.5">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }
  if (id === "announcements") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3.5">
        <path d="M3 11l19-9-9 19-2.5-7.5z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3.5">
      <path d="m 3 11 18-8-8 18-2.5-7.5 z" />
    </svg>
  );
}
