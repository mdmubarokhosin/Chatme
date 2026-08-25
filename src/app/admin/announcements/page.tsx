"use client";

/** Announcements management — create, edit, delete admin broadcasts. */
import { useState } from "react";
import { toast } from "sonner";

import { Megaphone, Pencil, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatTime } from "@/lib/format";

import { deleteAnnouncement, saveAnnouncement, useAdmin } from "../_lib/admin-store";

type FormData = { key?: string; title: string; message: string; priority: string };

export default function AdminAnnouncementsPage() {
  const announcements = useAdmin((s) => s.announcements);
  const [form, setForm] = useState<FormData | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Announcements</h1>
          <p className="text-muted-foreground text-sm">Broadcast messages to every ChatBD user.</p>
        </div>
        <Button size="sm" onClick={() => setForm({ title: "", message: "", priority: "normal" })}>
          <Plus /> New announcement
        </Button>
      </div>

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="text-xl leading-none">Published ({announcements.length})</CardTitle>
          <CardDescription>Users see these in the announcements panel with an unread badge.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col px-0">
          {announcements.length === 0 && (
            <div className="text-muted-foreground flex flex-col items-center gap-2 px-4 py-12 text-center text-sm">
              <Megaphone className="size-8 opacity-40" />
              No announcements published yet
            </div>
          )}
          {announcements.map((a) => (
            <div key={a.key} className="flex items-start gap-3 border-t px-4 py-3">
              <div className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-full">
                <Megaphone className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold">{a.title}</span>
                  {a.priority === "high" && <Badge variant="destructive" className="text-[10px]">important</Badge>}
                </div>
                <div className="text-muted-foreground mt-0.5 text-sm leading-relaxed whitespace-pre-wrap">{a.message}</div>
                <div className="text-muted-foreground mt-1 text-xs">{formatTime(a.timestamp)}</div>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button variant="ghost" size="icon-sm" aria-label="Edit" onClick={() => setForm({ key: a.key, title: a.title, message: a.message, priority: a.priority || "normal" })}>
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Delete"
                  className="text-destructive"
                  onClick={async () => {
                    if (!confirm("Delete this announcement?")) return;
                    await deleteAnnouncement(a.key);
                    toast.success("Announcement deleted");
                  }}
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Editor dialog */}
      {form && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/50 p-4" onClick={() => setForm(null)}>
          <div className="w-full max-w-md rounded-xl border bg-background p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 font-medium">{form.key ? "Edit announcement" : "New announcement"}</div>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="ann-title">Title</Label>
                <Input id="ann-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Announcement title" />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="ann-message">Message</Label>
                <Textarea id="ann-message" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="Write your announcement..." rows={4} />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Priority</Label>
                <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="high">Important</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="mt-2 flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setForm(null)}>
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  disabled={!form.title.trim() || !form.message.trim()}
                  onClick={async () => {
                    await saveAnnouncement({ ...form, title: form.title.trim(), message: form.message.trim() });
                    toast.success(form.key ? "Announcement updated" : "Announcement published");
                    setForm(null);
                  }}
                >
                  {form.key ? "Update" : "Publish"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
