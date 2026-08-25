"use client";

/** Premium management — global premium config + grant/revoke per user. */
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Crown, Search } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getInitials } from "@/lib/utils";

import { savePremiumSettings, togglePremium, useAdmin } from "../_lib/admin-store";

export default function AdminPremiumPage() {
  const settings = useAdmin((s) => s.settings);
  const users = useAdmin((s) => s.users);

  const [enabled, setEnabled] = useState(settings.premium?.enabled ?? false);
  const [maxFileSize, setMaxFileSize] = useState(String(settings.premium?.maxFileSize ?? 10));
  const [allowedTypes, setAllowedTypes] = useState(settings.premium?.allowedTypes ?? "image/*,application/pdf");
  const [price, setPrice] = useState(settings.premium?.price ?? "৳0");
  const [description, setDescription] = useState(settings.premium?.description ?? "Ask the administrator to activate premium.");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    let list = Object.values(users).sort((a, b) => Number(b.isPremium || false) - Number(a.isPremium || false) || (b.createdAt || 0) - (a.createdAt || 0));
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((u) => (u.name || "").toLowerCase().includes(q) || String(u.uniqueId || "").includes(q.replace("#", "")));
    }
    return list;
  }, [users, search]);

  const premiumCount = Object.values(users).filter((u) => u.isPremium).length;

  async function save() {
    setSaving(true);
    await savePremiumSettings({
      enabled,
      maxFileSize: Number(maxFileSize) || 10,
      allowedTypes,
      price,
      description,
    });
    setSaving(false);
    toast.success("Premium settings saved");
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Premium</h1>
        <p className="text-muted-foreground text-sm">Configure the premium package and manage premium members.</p>
      </div>

      {/* Premium stats (Chatme dashboard feature) */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="flex flex-col gap-1 py-4">
            <span className="text-muted-foreground text-sm">Premium users</span>
            <span className="text-2xl font-semibold tabular-nums">{premiumCount}</span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1 py-4">
            <span className="text-muted-foreground text-sm">Total users</span>
            <span className="text-2xl font-semibold tabular-nums">{Object.keys(users).length}</span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1 py-4">
            <span className="text-muted-foreground text-sm">Premium rate</span>
            <span className="text-2xl font-semibold tabular-nums">
              {Object.keys(users).length > 0 ? ((premiumCount / Object.keys(users).length) * 100).toFixed(1) : "0"}%
            </span>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Crown className="size-4 text-amber-500" /> Package settings
            </CardTitle>
            <CardDescription>Shown to users in the premium banner and modal.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
              <div>
                <div className="text-sm font-medium">Premium enabled</div>
                <div className="text-muted-foreground text-xs">Show the premium banner to free users</div>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="p-maxsize">Max file size (MB)</Label>
              <Input id="p-maxsize" type="number" min={1} value={maxFileSize} onChange={(e) => setMaxFileSize(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="p-types">Allowed file types</Label>
              <Input id="p-types" value={allowedTypes} onChange={(e) => setAllowedTypes(e.target.value)} placeholder="image/*,application/pdf" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="p-price">Price label</Label>
              <Input id="p-price" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="৳99" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="p-desc">Description</Label>
              <Input id="p-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving..." : "Save settings"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <CardTitle className="text-lg">Premium members ({premiumCount})</CardTitle>
            <CardDescription>Grant or revoke premium access instantly.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="relative">
              <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input className="pl-9" placeholder="Search users..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="flex max-h-96 flex-col gap-1 overflow-y-auto">
              {rows.map((user) => (
                <div key={user.uid} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/50">
                  <Avatar className="size-8">
                    {user.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={user.photoUrl} alt={user.name || "User"} className="size-full rounded-full object-cover" />
                    ) : (
                      <AvatarFallback className="text-xs">{getInitials(user.name || "U")}</AvatarFallback>
                    )}
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{user.name || "Unknown"}</div>
                    <div className="text-muted-foreground font-mono text-xs">#{user.uniqueId || "????"}</div>
                  </div>
                  {user.isPremium ? (
                    <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400">
                      <Crown className="mr-1 size-3" /> Premium
                    </Badge>
                  ) : (
                    <Badge variant="secondary">Free</Badge>
                  )}
                  <Button
                    size="sm"
                    variant={user.isPremium ? "outline" : "default"}
                    onClick={async () => {
                      await togglePremium(user);
                      toast.success(user.isPremium ? "Premium revoked" : "Premium granted");
                    }}
                  >
                    {user.isPremium ? "Revoke" : "Grant"}
                  </Button>
                </div>
              ))}
              {rows.length === 0 && <div className="text-muted-foreground py-6 text-center text-sm">No users found</div>}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
