"use client";

/** Statuses management — view, delete, and bulk-clean expired statuses. */
import { useMemo } from "react";
import { toast } from "sonner";

import { Clock, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatTime } from "@/lib/format";

import { deleteExpiredStatuses, deleteStatus, useAdmin } from "../_lib/admin-store";

export default function AdminStatusesPage() {
  const statuses = useAdmin((s) => s.statuses);

  const rows = useMemo(() => {
    const now = Date.now();
    return [...statuses]
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .map((s) => ({ ...s, expired: now > (s.expiresAt || 0) }));
  }, [statuses]);

  const active = rows.filter((r) => !r.expired).length;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Statuses</h1>
        <p className="text-muted-foreground text-sm">24-hour status updates shared by users.</p>
      </div>

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="text-xl leading-none">All statuses ({rows.length})</CardTitle>
          <CardDescription>{active} active · {rows.length - active} expired</CardDescription>
          <CardAction>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const count = await deleteExpiredStatuses();
                toast.success(count > 0 ? `${count} expired statuses deleted` : "No expired statuses to clean");
              }}
            >
              <Clock /> Clean expired
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col px-0">
          {rows.length === 0 && <div className="text-muted-foreground px-4 py-10 text-center text-sm">No statuses shared yet.</div>}
          {rows.map((status) => (
            <div key={status.key} className="flex items-start gap-3 border-t px-4 py-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full text-white text-xs font-semibold" style={{ background: status.color || "#008069" }}>
                {(status.userName || "U").charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{status.userName || "Unknown"}</span>
                  <Badge variant={status.expired ? "outline" : "secondary"} className="text-[10px]">
                    {status.expired ? "expired" : "active"}
                  </Badge>
                </div>
                <div className="text-muted-foreground mt-0.5 line-clamp-2 text-xs leading-relaxed">{status.text}</div>
                <div className="text-muted-foreground mt-1 text-xs">
                  {formatTime(status.timestamp)} · {status.viewerCount || 0} views
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Delete status"
                className="text-destructive"
                onClick={async () => {
                  if (!confirm("Delete this status?")) return;
                  await deleteStatus(status.key);
                  toast.success("Status deleted");
                }}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
