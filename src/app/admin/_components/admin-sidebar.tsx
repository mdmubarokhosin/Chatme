"use client";

/**
 * Admin sidebar — Admin-Panel design (SidebarHeader + collapsible NavMain
 * groups + NavUser footer) with ChatBD admin navigation.
 */
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  Bell,
  ChevronRight,
  Crown,
  FileJson,
  HardDrive,
  LayoutDashboard,
  MessageSquare,
  Phone,
  Settings,
  ShieldCheck,
  Activity,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";

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
import { LogOut } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { getInitials } from "@/lib/utils";
import { APP_CONFIG } from "@/config/app-config";
import { t } from "@/lib/i18n";

import { adminLogout, useAdmin, useAdminLang } from "../_lib/admin-store";

type SubItem = { id: string; labelKey: string; url: string; icon?: LucideIcon };
type MainItem = { id: string; labelKey: string; url?: string; icon?: LucideIcon; subItems?: SubItem[] };
type NavGroup = { id: number; labelKey?: string; items: MainItem[] };

const NAV: NavGroup[] = [
  {
    id: 1,
    items: [{ id: "dashboard", labelKey: "admin.dashboard", url: "/admin", icon: LayoutDashboard }],
  },
  {
    id: 2,
    labelKey: "admin.management",
    items: [
      { id: "users", labelKey: "admin.users", url: "/admin/users", icon: Users },
      { id: "chats", labelKey: "admin.conversations", url: "/admin/chats", icon: MessageSquare },
      { id: "calls", labelKey: "admin.callLogs", url: "/admin/calls", icon: Phone },
      {
        id: "content",
        labelKey: "admin.content",
        icon: FileJson,
        subItems: [
          { id: "statuses", labelKey: "admin.statuses", url: "/admin/statuses", icon: Activity },
          { id: "announcements", labelKey: "admin.announcements", url: "/admin/announcements", icon: Bell },
        ],
      },
    ],
  },
  {
    id: 3,
    labelKey: "admin.configuration",
    items: [
      { id: "premium", labelKey: "admin.premium", url: "/admin/premium", icon: Crown },
      { id: "storage", labelKey: "admin.storage", url: "/admin/storage", icon: HardDrive },
      { id: "settings", labelKey: "admin.settings", url: "/admin/settings", icon: Settings },
      { id: "logs", labelKey: "admin.activityLogs", url: "/admin/logs", icon: Activity },
      { id: "export", labelKey: "admin.dataExport", url: "/admin/export", icon: FileJson },
    ],
  },
];

export function AdminSidebar() {
  const path = usePathname();
  const admin = useAdmin((s) => s.admin);
  const lang = useAdminLang();

  const isActive = (item: MainItem) => {
    if (item.subItems?.length) return item.subItems.some((sub) => path === sub.url);
    if (item.url === "/admin") return path === "/admin";
    return !!item.url && path.startsWith(item.url);
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <Link prefetch={false} href="/admin">
                <ShieldCheck />
                <span className="font-semibold text-base">{APP_CONFIG.name} Admin</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {NAV.map((group) => (
          <SidebarGroup key={group.id}>
            {group.labelKey && <SidebarGroupLabel className="group-data-[collapsible=icon]:pointer-events-none">{t(lang, group.labelKey)}</SidebarGroupLabel>}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) =>
                  item.subItems?.length ? (
                    <CollapsibleNav key={item.id} item={item} active={isActive(item)} path={path} />
                  ) : (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton asChild tooltip={t(lang, item.labelKey)} isActive={isActive(item)}>
                        <Link prefetch={false} href={item.url || "/admin"}>
                          {item.icon && <item.icon />}
                          <span>{t(lang, item.labelKey)}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ),
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <Avatar className="h-8 w-8 rounded-lg">
                    <AvatarFallback className="rounded-lg">{getInitials(admin?.name || "Admin")}</AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{admin?.name || "Admin"}</span>
                    <span className="truncate text-muted-foreground text-xs">{admin?.email || ""}</span>
                  </div>
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg" side="right" align="end" sideOffset={4}>
                <DropdownMenuLabel className="p-0 font-normal">
                  <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                    <Avatar className="h-8 w-8 rounded-lg">
                      <AvatarFallback className="rounded-lg">{getInitials(admin?.name || "Admin")}</AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-medium">{admin?.name || "Admin"}</span>
                      <span className="truncate text-muted-foreground text-xs">{admin?.email || ""}</span>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem asChild>
                    <Link prefetch={false} href="/" target="_blank">
                      <MessageSquare />
                      Open ChatBD
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link prefetch={false} href="/admin/settings">
                      <UserRound />
                      Admin profile
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => adminLogout()}>
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

function CollapsibleNav({ item, active, path }: { item: MainItem; active: boolean; path: string }) {
  const { isMobile, setOpen } = useSidebar();
  const lang = useAdminLang();
  const defaultOpen = item.subItems?.some((sub) => path === sub.url) || false;
  const [open, setOpenState] = useSidebarOpen(defaultOpen);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton tooltip={t(lang, item.labelKey)} isActive={active} onClick={() => setOpenState(!open)}>
        {item.icon && <item.icon />}
        <span>{t(lang, item.labelKey)}</span>
        <ChevronRight className={`ml-auto transition-transform duration-200 ${open ? "rotate-90" : ""}`} />
      </SidebarMenuButton>
      {open && (
        <SidebarMenuSub>
          {item.subItems?.map((sub) => (
            <SidebarMenuSubItem key={sub.id}>
              <SidebarMenuSubButton asChild isActive={path === sub.url}>
                <Link
                  prefetch={false}
                  href={sub.url}
                  onClick={() => {
                    if (isMobile) setOpen(false);
                  }}
                >
                  {sub.icon && <sub.icon />}
                  <span>{t(lang, sub.labelKey)}</span>
                </Link>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          ))}
        </SidebarMenuSub>
      )}
    </SidebarMenuItem>
  );
}

function useSidebarOpen(defaultValue: boolean): [boolean, (v: boolean) => void] {
  const [open, setOpen] = useState(defaultValue);
  return [open, setOpen];
}
