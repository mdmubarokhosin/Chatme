"use client";

/** Data export — download JSON snapshots (users, messages, calls, statuses, all). */
import { toast } from "sonner";

import { Database, Download, FileJson, MessageSquare, Phone, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { exportData, useAdmin } from "../_lib/admin-store";

export default function AdminExportPage() {
  const users = useAdmin((s) => s.users);
  const chats = useAdmin((s) => s.chats);
  const calls = useAdmin((s) => s.calls);
  const statuses = useAdmin((s) => s.statuses);

  const cards = [
    { key: "users" as const, title: "Users", desc: "All user profiles, roles, premium and ban states.", count: Object.keys(users).length, icon: Users },
    { key: "messages" as const, title: "Messages", desc: "Every conversation with all message records (encrypted payloads).", count: Object.keys(chats).length, icon: MessageSquare },
    { key: "calls" as const, title: "Calls", desc: "Complete call log history.", count: calls.length, icon: Phone },
    { key: "statuses" as const, title: "Statuses", desc: "All status updates with viewer data.", count: statuses.length, icon: FileJson },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Data Export</h1>
        <p className="text-muted-foreground text-sm">Download JSON snapshots of your ChatBD data.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {cards.map((card) => (
          <Card key={card.key}>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2 text-lg">
                <card.icon className="size-4" /> {card.title}
                <span className="text-muted-foreground ml-auto text-sm font-normal tabular-nums">{card.count} records</span>
              </CardTitle>
              <CardDescription>{card.desc}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" size="sm" onClick={() => { exportData(card.key); toast.success(`${card.title} export started`); }}>
                <Download /> Export {card.title.toLowerCase()}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Database className="size-4" /> Full backup
          </CardTitle>
          <CardDescription>Download users, messages, calls and statuses in one go.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button size="sm" onClick={() => { exportData("all"); toast.success("Full export started"); }}>
            <Download /> Export everything
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
