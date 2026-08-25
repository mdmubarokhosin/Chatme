"use client";

/** Activity logs — admin action history feed. */
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatTime } from "@/lib/format";

import { useAdmin } from "../_lib/admin-store";

export default function AdminLogsPage() {
  const logs = useAdmin((s) => s.logs);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Activity Logs</h1>
        <p className="text-muted-foreground text-sm">Every administrative action, newest first.</p>
      </div>

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="text-xl leading-none">Recent activity ({logs.length})</CardTitle>
          <CardDescription>Bans, role changes, deletions, exports and settings updates.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col px-0">
          {logs.length === 0 && <div className="text-muted-foreground px-4 py-10 text-center text-sm">No activity recorded yet.</div>}
          {logs.map((log) => (
            <div key={log.key} className="flex items-center gap-3 border-t px-4 py-3">
              <Badge variant="secondary" className="shrink-0 capitalize">
                {log.action.replace(/_/g, " ")}
              </Badge>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{log.details}</div>
                <div className="text-muted-foreground text-xs">
                  by {log.userName || "Admin"} · {formatTime(log.timestamp)}
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
