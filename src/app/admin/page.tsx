"use client";

/** Admin dashboard — live stats, charts, online users bar and recent activity (Admin-Panel design + Chatme features). */
import { useMemo } from "react";

import { Activity, MessageSquare, Phone, TrendingUp, UserCheck, Users } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn, getInitials } from "@/lib/utils";
import { formatTime } from "@/lib/format";
import { t } from "@/lib/i18n";

import { useAdmin, useAdminLang } from "./_lib/admin-store";

export default function AdminDashboard() {
  const lang = useAdminLang();
  const tr = (key: string) => t(lang, key);
  const users = useAdmin((s) => s.users);
  const chats = useAdmin((s) => s.chats);
  const calls = useAdmin((s) => s.calls);
  const statuses = useAdmin((s) => s.statuses);
  const logs = useAdmin((s) => s.logs);
  const messageCount = useAdmin((s) => s.messageCount);
  const messageVolume = useAdmin((s) => s.messageVolume);

  const stats = useMemo(() => {
    const userList = Object.values(users);
    const now = Date.now();
    const premium = userList.filter((u) => u.isPremium);
    return {
      totalUsers: userList.length,
      onlineUsers: userList.filter((u) => u.isOnline),
      bannedUsers: userList.filter((u) => u.isBanned).length,
      premiumUsers: premium.length,
      premiumRate: userList.length > 0 ? ((premium.length / userList.length) * 100).toFixed(1) : "0",
      adminUsers: userList.filter((u) => u.role === "admin").length,
      totalChats: Object.keys(chats).length,
      totalMessages: messageCount,
      totalCalls: calls.length,
      activeStatuses: statuses.filter((s) => (s.expiresAt || 0) > now).length,
      totalStatusViews: statuses.reduce((acc, s) => acc + (s.viewerCount || 0), 0),
      newUsers7d: userList.filter((u) => now - (u.createdAt || 0) < 7 * 86400000).length,
    };
  }, [users, chats, calls, statuses, messageCount]);

  /* Signup trend for last 7 days */
  const trend = useMemo(() => {
    const days: { label: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const start = dayStart.getTime() - i * 86400000;
      const end = start + 86400000;
      const count = Object.values(users).filter((u) => (u.createdAt || 0) >= start && (u.createdAt || 0) < end).length;
      days.push({ label: new Date(start).toLocaleDateString("en-US", { weekday: "short" }), count });
    }
    return days;
  }, [users]);

  const maxTrend = Math.max(1, ...trend.map((d) => d.count));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{tr("admin.dashboard")}</h1>
        <p className="text-muted-foreground text-sm">{tr("admin.liveOverview")}</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard title={tr("admin.totalUsers")} value={stats.totalUsers} sub={`${stats.onlineUsers.length} ${tr("admin.onlineNow")}`} icon={Users} tone="primary" />
        <KpiCard title={tr("admin.messages")} value={stats.totalMessages} sub={`${stats.totalChats} ${tr("admin.conversationsCount")}`} icon={MessageSquare} tone="blue" />
        <KpiCard title={tr("admin.calls")} value={stats.totalCalls} sub={tr("admin.totalCallRecords")} icon={Phone} tone="violet" />
        <KpiCard title={tr("admin.activeStatuses")} value={stats.activeStatuses} sub={`${stats.totalStatusViews} ${tr("admin.totalViews")}`} icon={Activity} tone="green" />
      </div>

      {/* Online users bar (Chatme feature) */}
      <Card>
        <CardHeader className="border-b">
          <CardTitle className="text-lg">
            {tr("admin.onlineNowTitle")} <span className="text-muted-foreground ml-1 text-sm font-normal">({stats.onlineUsers.length} {tr("admin.usersOnline")})</span>
          </CardTitle>
          <CardDescription>{tr("admin.usersOnlineDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {stats.onlineUsers.length === 0 ? (
            <div className="text-muted-foreground py-4 text-center text-sm">{tr("admin.noUsersOnline")}</div>
          ) : (
            <div className="flex flex-wrap gap-3">
              {stats.onlineUsers.map((u) => (
                <div key={u.uid} className="flex w-16 flex-col items-center gap-1">
                  <div className="relative">
                    <Avatar className="size-10 border border-green-500/40">
                      {u.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={u.photoUrl} alt={u.name || "User"} className="size-full rounded-full object-cover" />
                      ) : (
                        <AvatarFallback className="text-xs">{getInitials(u.name || "U")}</AvatarFallback>
                      )}
                    </Avatar>
                    <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-background bg-green-500" />
                  </div>
                  <span className="w-full truncate text-center text-xs">{u.name || "Unknown"}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Signup trend */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">{tr("admin.newUsers7d")}</CardTitle>
            <CardDescription>{tr("admin.registrationsPerDay")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex h-40 items-end gap-3">
              {trend.map((d) => (
                <div key={d.label} className="flex flex-1 flex-col items-center gap-2">
                  <div className="text-muted-foreground text-xs tabular-nums">{d.count}</div>
                  <div
                    className="bg-primary/80 w-full rounded-md transition-all"
                    style={{ height: `${Math.max(4, (d.count / maxTrend) * 110)}px` }}
                  />
                  <div className="text-muted-foreground text-xs">{d.label}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Message volume trend */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{lang === "bn" ? "মেসেজ ভলিউম · শেষ ৭ দিন" : "Message volume · last 7 days"}</CardTitle>
          <CardDescription>{lang === "bn" ? "প্রতিদিনের পাঠানো মেসেজ" : "Messages sent per day"}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex h-40 items-end gap-3">
            {messageVolume.map((d) => {
              const max = Math.max(1, ...messageVolume.map((x) => x.count));
              return (
                <div key={d.label} className="flex flex-1 flex-col items-center gap-2">
                  <div className="text-muted-foreground text-xs tabular-nums">{d.count}</div>
                  <div
                    className="w-full rounded-md bg-violet-500/80 transition-all"
                    style={{ height: `${Math.max(4, (d.count / max) * 110)}px` }}
                  />
                  <div className="text-muted-foreground text-xs">{d.label}</div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{tr("admin.usersBreakdown")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <BreakRow icon={<UserCheck className="size-4 text-green-600" />} label={tr("admin.online")} value={stats.onlineUsers.length} />
            <BreakRow icon={<TrendingUp className="size-4 text-amber-600" />} label={`Premium (${stats.premiumRate}%)`} value={stats.premiumUsers} />
            <BreakRow icon={<Users className="size-4 text-violet-600" />} label={tr("admin.admins")} value={stats.adminUsers} />
            <BreakRow icon={<Users className="size-4 text-red-600" />} label={tr("admin.banned")} value={stats.bannedUsers} />
            <Separator />
            <div className="text-muted-foreground text-xs leading-relaxed">
              Premium users enjoy the crown badge and file sharing up to the configured size limit.
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent activity */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{tr("admin.recentActivity")}</CardTitle>
          <CardAction>
            <a href="/admin/logs" className="text-primary text-sm hover:underline">
              {tr("admin.viewAll")}
            </a>
          </CardAction>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <div className="text-muted-foreground py-8 text-center text-sm">{tr("admin.noActivity")}</div>
          ) : (
            <div className="flex flex-col gap-2">
              {logs.slice(0, 8).map((log) => (
                <div key={log.key} className="flex items-center gap-3 rounded-lg border px-3 py-2">
                  <Badge variant="secondary" className="shrink-0 capitalize">
                    {log.action.replace(/_/g, " ")}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-sm">{log.details}</span>
                  <span className="text-muted-foreground shrink-0 text-xs">{formatTime(log.timestamp)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  title,
  value,
  sub,
  icon: Icon,
  tone,
}: {
  title: string;
  value: number;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: "primary" | "blue" | "violet" | "green";
}) {
  const tones = {
    primary: "bg-primary/10 text-primary",
    blue: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    green: "bg-green-500/10 text-green-600 dark:text-green-400",
  };
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-sm">{title}</span>
          <span className="text-3xl font-semibold tabular-nums">{value}</span>
          <span className="text-muted-foreground text-xs">{sub}</span>
        </div>
        <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", tones[tone])}>
          <Icon className="size-5" />
        </div>
      </CardContent>
    </Card>
  );
}

function BreakRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      {icon}
      <span className="text-muted-foreground flex-1">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}
