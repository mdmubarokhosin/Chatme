"use client";

/** Call logs — view and delete call records. */
import { useMemo } from "react";
import { toast } from "sonner";

import { PhoneIncoming, PhoneMissed, PhoneOutgoing, Phone, Video, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatCallDuration, formatTime } from "@/lib/format";

import { deleteCall, useAdmin } from "../_lib/admin-store";

export default function AdminCallsPage() {
  const calls = useAdmin((s) => s.calls);
  const users = useAdmin((s) => s.users);

  const rows = useMemo(() => {
    return calls.map((call) => {
      const caller = users[call.callerId]?.name || call.callerName || call.callerId?.slice(0, 6) || "?";
      const receiver = users[call.receiverId]?.name || call.receiverName || call.receiverId?.slice(0, 6) || "?";
      return { ...call, caller, receiver };
    });
  }, [calls, users]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Call Logs</h1>
        <p className="text-muted-foreground text-sm">All audio & video call records on the platform.</p>
      </div>

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="text-xl leading-none">Calls ({rows.length})</CardTitle>
          <CardDescription>WebRTC P2P call history with durations.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col px-0">
          {rows.length === 0 && <div className="text-muted-foreground px-4 py-10 text-center text-sm">No call records yet.</div>}
          {rows.map((call) => {
            const missed = call.status === "missed" || call.status === "declined";
            return (
              <div key={call.key} className="flex items-center gap-3 border-t px-4 py-3 hover:bg-muted/40">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
                  {call.type === "video" ? <Video className="size-4" /> : <Phone className="size-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {call.caller} → {call.receiver}
                  </div>
                  <div className="text-muted-foreground flex items-center gap-2 text-xs">
                    {missed ? (
                      <PhoneMissed className="size-3 text-red-500" />
                    ) : call.callerId === call.callerId ? (
                      <PhoneOutgoing className="size-3 text-green-600" />
                    ) : (
                      <PhoneIncoming className="size-3 text-green-600" />
                    )}
                    {formatTime(call.startTime)}
                    {call.status === "connected" && call.endTime ? ` · ${formatCallDuration(call.startTime, call.endTime)}` : ""}
                    <Badge variant="outline" className={cn("text-[10px]", missed && "border-destructive/40 text-destructive")}>
                      {call.status}
                    </Badge>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Delete call log"
                  className="text-destructive"
                  onClick={async () => {
                    if (!confirm("Delete this call record?")) return;
                    await deleteCall(call.key);
                    toast.success("Call log deleted");
                  }}
                >
                  <Trash2 />
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
