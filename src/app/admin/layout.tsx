"use client";

/**
 * Admin layout — auth + role guard (admin only), Admin-Panel shell
 * (AppSidebar + inset header with sidebar trigger, theme switcher, admin menu).
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { auth, db, serverTimestamp } from "@/lib/firebase";
import { installPrivateMediaInterceptor } from "@/lib/media-resolver";
import type { UserProfile } from "@/lib/types";

import { AdminSidebar } from "./_components/admin-sidebar";
import { AdminLogin } from "./_components/login-form";
import { attachAdminListeners, detachAdminListeners, setAdmin, setAdminAuth, useAdmin } from "./_lib/admin-store";

export default function AdminLayout({ children }: Readonly<{ children: ReactNode }>) {
  const authUid = useAdmin((s) => s.authUid);
  const admin = useAdmin((s) => s.admin);
  const [checked, setChecked] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  /* Private-repo media support: re-fetch uploads-repo images through the
     GitHub API (token-authenticated) when the direct raw URL 404s. */
  useEffect(() => {
    installPrivateMediaInterceptor();
  }, []);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (user) => {
      if (user) {
        setAdminAuth(user.uid);
        try {
          const snap = await db.ref(`users/${user.uid}`).once("value");
          const data = snap.val() as UserProfile | null;
          if (data) {
            if (data.role === "admin" && !data.isBanned) {
              setAdmin({ ...data, uid: user.uid });
              attachAdminListeners();
              db.ref(`users/${user.uid}`).update({ isOnline: true, lastSeen: serverTimestamp }).catch(() => {});
              setForbidden(false);
            } else {
              setForbidden(true);
              setAdmin(null);
            }
          } else {
            setForbidden(true);
            setAdmin(null);
          }
        } catch {
          setForbidden(true);
        }
      } else {
        setAdminAuth(null);
        setAdmin(null);
        detachAdminListeners();
      }
      setChecked(true);
    });
    return () => unsub();
  }, []);

  if (!checked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="border-primary size-8 animate-spin rounded-full border-2 border-t-transparent" />
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md text-center">
          <h1 className="mb-2 text-2xl font-semibold">Access denied</h1>
          <p className="text-muted-foreground mb-6 leading-relaxed">
            This area is restricted to ChatBD administrators. Sign in with an admin account to continue.
          </p>
          <Button variant="outline" onClick={() => auth.signOut()}>
            Back to login
          </Button>
        </div>
      </div>
    );
  }

  if (!authUid || !admin) {
    return <AdminLogin />;
  }

  return <AdminShell>{children}</AdminShell>;
}

function AdminShell({ children }: { children: ReactNode }) {
  const [defaultOpen, setDefaultOpen] = useState(true);
  const admin = useAdmin((s) => s.admin);

  useEffect(() => {
    const match = document.cookie.split("; ").find((row) => row.startsWith("sidebar_state="));
    if (match && match.split("=")[1] === "false") setDefaultOpen(false);
  }, []);

  return (
    <SidebarProvider
      defaultOpen={defaultOpen}
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 68)",
        } as React.CSSProperties
      }
    >
      <AdminSidebar />
      <SidebarInset
        className={cn(
          "[html[data-content-layout=centered]_&>*]:mx-auto",
          "[html[data-content-layout=centered]_&>*]:w-full",
          "[html[data-content-layout=centered]_&>*]:max-w-screen-2xl",
          "peer-data-[variant=inset]:border",
          "[--dashboard-header-height:--spacing(12)]",
          "min-w-0 overflow-x-clip",
        )}
      >
        <header className="sticky top-0 z-50 flex h-12 shrink-0 items-center gap-2 border-b bg-background/50 backdrop-blur-md">
          <div className="flex w-full items-center justify-between px-4 lg:px-6">
            <div className="flex items-center gap-1 lg:gap-2">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4 data-[orientation=vertical]:self-center" />
              <div className="text-muted-foreground hidden text-sm sm:block">
                ChatBD Admin Panel · <span className="text-foreground font-medium">{admin?.name}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ThemeToggleButton />
            </div>
          </div>
        </header>
        <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function ThemeToggleButton() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const root = document.documentElement;
    const next = !root.classList.contains("dark");
    root.classList.toggle("dark", next);
    root.style.colorScheme = next ? "dark" : "light";
    root.setAttribute("data-theme-mode", next ? "dark" : "light");
    document.cookie = `theme_mode=${next ? "dark" : "light"}; path=/; max-age=31536000`;
    setDark(next);
  }

  return (
    <Button variant="ghost" size="icon-sm" aria-label="Toggle theme" onClick={toggle}>
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}
