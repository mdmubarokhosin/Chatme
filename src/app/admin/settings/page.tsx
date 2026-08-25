"use client";

/** Admin settings — maintenance mode, registration, GitHub storage, message limit, admin profile, version & footer text. */
import { useState } from "react";
import { toast } from "sonner";

import { Gauge, Globe, HardDrive, Hash, KeyRound, MessageSquare, Save, ShieldCheck, Tag, TriangleAlert, UserRound, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { db } from "@/lib/firebase";
import { t } from "@/lib/i18n";

import { Textarea } from "@/components/ui/textarea";

import { adminLog, setSetting, useAdmin, useAdminLang, wipeData } from "../_lib/admin-store";

export default function AdminSettingsPage() {
  const settings = useAdmin((s) => s.settings);
  const admin = useAdmin((s) => s.admin);
  const lang = useAdminLang();
  const tr = (key: string) => t(lang, key);

  async function saveAdminLanguage(value: string) {
    await setSetting("adminLanguage", value);
    adminLog("settings", `Admin panel language set to ${value}`);
    toast.success(value === "bn" ? "ভাষা সেভ হয়েছে: বাংলা" : "Language saved: English");
  }

  const [githubToken, setGithubToken] = useState(settings.githubStorage?.token || "");
  const [githubRepo, setGithubRepo] = useState(settings.githubStorage?.repo || "");
  const [githubBranch, setGithubBranch] = useState(settings.githubStorage?.branch || "main");
  const [maxMessages, setMaxMessages] = useState(String(settings.maxMessages ?? 200));
  const [welcomeMessage, setWelcomeMessage] = useState(settings.welcomeMessage || "");
  const [versionText, setVersionText] = useState(settings.versionText || "");
  const [bannedWords, setBannedWords] = useState((settings as { bannedWords?: string }).bannedWords || "");
  const [rateLimit, setRateLimit] = useState(String((settings as { rateLimitPerMinute?: number }).rateLimitPerMinute ?? 0));
  const [footerText, setFooterText] = useState(settings.footerText || "");
  const [profileName, setProfileName] = useState(admin?.name || "");
  const [saving, setSaving] = useState(false);
  const [wipeAllText, setWipeAllText] = useState("");

  async function toggleMaintenance(on: boolean) {
    await setSetting("maintenanceMode", on);
    toast.success(`Maintenance mode ${on ? "enabled" : "disabled"}`);
  }

  async function toggleRegistration(on: boolean) {
    await setSetting("registrationOpen", on);
    toast.success(`Registration ${on ? "opened" : "closed"}`);
  }

  async function saveGithub() {
    setSaving(true);
    await db.ref("settings/githubStorage").set({ token: githubToken, repo: githubRepo, branch: githubBranch });
    adminLog("settings", "GitHub storage settings updated");
    setSaving(false);
    toast.success("GitHub storage settings saved");
  }

  async function saveMaxMessages() {
    await setSetting("maxMessages", Number(maxMessages) || 200);
    toast.success("Message limit saved");
  }

  async function saveWelcomeMessage() {
    await setSetting("welcomeMessage", welcomeMessage);
    toast.success("Welcome message saved");
  }

  async function saveVersionText() {
    await setSetting("versionText", versionText.trim());
    adminLog("settings", `Version label set to "${versionText.trim()}"`);
    toast.success("Version label saved");
  }

  async function saveFooterText() {
    await setSetting("footerText", footerText.trim());
    adminLog("settings", `Footer text updated`);
    toast.success("Footer text saved");
  }

  async function saveBannedWords() {
    await setSetting("bannedWords", bannedWords.trim());
    adminLog("settings", "Banned words list updated");
    toast.success("Banned words saved");
  }

  async function saveRateLimit() {
    await setSetting("rateLimitPerMinute", Number(rateLimit) || 0);
    adminLog("settings", "Rate limit updated");
    toast.success("Rate limit saved");
  }

  async function saveProfile() {
    if (!admin) return;
    await db.ref(`users/${admin.uid}/name`).set(profileName.trim());
    adminLog("settings", "Admin profile name updated");
    toast.success("Profile updated");
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{tr("admin.settings")}</h1>
        <p className="text-muted-foreground text-sm">{tr("admin.settings.subtitle")}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Platform switches */}
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="text-lg">{tr("admin.platform")}</CardTitle>
            <CardDescription>{tr("admin.platformDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
              <div className="flex items-start gap-3">
                <Wrench className="text-muted-foreground mt-0.5 size-4" />
                <div>
                  <div className="text-sm font-medium">{tr("admin.maintenanceMode")}</div>
                  <div className="text-muted-foreground text-xs">{tr("admin.maintenanceModeDesc")}</div>
                </div>
              </div>
              <Switch checked={settings.maintenanceMode === true} onCheckedChange={toggleMaintenance} />
            </div>

            <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
              <div className="flex items-start gap-3">
                <Globe className="text-muted-foreground mt-0.5 size-4" />
                <div>
                  <div className="text-sm font-medium">{tr("admin.registrationOpen")}</div>
                  <div className="text-muted-foreground text-xs">{tr("admin.registrationOpenDesc")}</div>
                </div>
              </div>
              <Switch checked={settings.registrationOpen !== false} onCheckedChange={toggleRegistration} />
            </div>

            <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
              <div className="flex items-start gap-3">
                <MessageSquare className="text-muted-foreground mt-0.5 size-4" />
                <div>
                  <div className="text-sm font-medium">{tr("admin.messageLimit")}</div>
                  <div className="text-muted-foreground text-xs">{tr("admin.messageLimitDesc")}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Input className="h-8 w-20 text-center" type="number" min={10} value={maxMessages} onChange={(e) => setMaxMessages(e.target.value)} />
                <Button size="sm" variant="outline" onClick={saveMaxMessages}>
                  Save
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-2 rounded-lg border px-3 py-2.5">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Globe className="text-muted-foreground size-4" /> {tr("admin.welcomeMessage")}
              </div>
              <Textarea
                placeholder={tr("admin.welcomeMessagePlaceholder")}
                value={welcomeMessage}
                onChange={(e) => setWelcomeMessage(e.target.value)}
                rows={3}
              />
              <div>
                <Button size="sm" variant="outline" onClick={saveWelcomeMessage}>
                  <Save className="size-4" /> {tr("admin.saveWelcomeMessage")}
                </Button>
              </div>
            </div>

            {/* Auto-moderation: banned words */}
            <div className="flex flex-col gap-2 rounded-lg border px-3 py-2.5">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ShieldCheck className="text-muted-foreground size-4" /> Banned words
              </div>
              <Input
                placeholder="word1, word2, word3..."
                value={bannedWords}
                onChange={(e) => setBannedWords(e.target.value)}
              />
              <div className="text-muted-foreground text-xs leading-relaxed">
                Comma-separated. Messages containing any of these words are blocked for all users.
              </div>
              <div>
                <Button size="sm" variant="outline" onClick={saveBannedWords}>
                  <Save className="size-4" /> Save banned words
                </Button>
              </div>
            </div>

            {/* Anti-spam rate limit */}
            <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
              <div className="flex items-start gap-3">
                <Gauge className="text-muted-foreground mt-0.5 size-4" />
                <div>
                  <div className="text-sm font-medium">Messages per minute (anti-spam)</div>
                  <div className="text-muted-foreground text-xs">0 = unlimited. Blocks bursts of messages from one user.</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Input className="h-8 w-20 text-center" type="number" min={0} value={rateLimit} onChange={(e) => setRateLimit(e.target.value)} />
                <Button size="sm" variant="outline" onClick={saveRateLimit}>
                  Save
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Branding: version & footer text */}
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Tag className="size-4" /> {tr("admin.branding")}
            </CardTitle>
            <CardDescription>
              {tr("admin.brandingDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2 rounded-lg border px-3 py-2.5">
              <Label htmlFor="version-text" className="flex items-center gap-1 text-sm font-medium">
                <Hash className="text-muted-foreground size-3" /> {tr("admin.versionLabel")}
              </Label>
              <Input
                id="version-text"
                value={versionText}
                onChange={(e) => setVersionText(e.target.value)}
                placeholder="e.g. v8, 2.1.0, beta-3, শান্তি"
                maxLength={32}
              />
              <div className="text-muted-foreground text-xs leading-relaxed">
                {tr("admin.versionLabelDesc")}
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground text-xs">
                  Live preview: <span className="text-foreground font-medium">{versionText || "v11"}</span>
                </span>
                <Button size="sm" variant="outline" onClick={saveVersionText} disabled={!versionText.trim()}>
                  <Save className="size-4" /> {tr("admin.saveVersion")}
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-2 rounded-lg border px-3 py-2.5">
              <Label htmlFor="footer-text" className="flex items-center gap-1 text-sm font-medium">
                <MessageSquare className="text-muted-foreground size-3" /> {tr("admin.footerText")}
              </Label>
              <Textarea
                id="footer-text"
                placeholder={tr("admin.footerTextPlaceholder")}
                value={footerText}
                onChange={(e) => setFooterText(e.target.value)}
                rows={3}
                maxLength={200}
              />
              <div className="text-muted-foreground text-xs leading-relaxed">
                {tr("admin.footerTextDesc")}
              </div>
              <div>
                <Button size="sm" variant="outline" onClick={saveFooterText}>
                  <Save className="size-4" /> {tr("admin.saveFooter")}
                </Button>
              </div>
            </div>

            {/* Admin panel language selector */}
            <div className="flex flex-col gap-2 rounded-lg border px-3 py-2.5">
              <div className="text-sm font-medium">{tr("admin.adminLanguage")}</div>
              <div className="text-muted-foreground text-xs leading-relaxed">
                {tr("admin.adminLanguageDesc")}
              </div>
              <div className="flex w-full items-center gap-1 rounded-lg border p-0.5 sm:w-auto">
                <button
                  type="button"
                  onClick={() => saveAdminLanguage("en")}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors sm:flex-none",
                    lang === "en" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  🇬🇧 English
                </button>
                <button
                  type="button"
                  onClick={() => saveAdminLanguage("bn")}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors sm:flex-none",
                    lang === "bn" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  🇧🇩 বাংলা
                </button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* GitHub storage */}
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2 text-lg">
              <HardDrive className="size-4" /> {tr("admin.githubStorage")}
            </CardTitle>
            <CardDescription>
              {tr("admin.githubStorageDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="gh-token" className="flex items-center gap-1">
                <KeyRound className="size-3" /> {tr("admin.personalAccessToken")}
              </Label>
              <Input id="gh-token" type="password" value={githubToken} onChange={(e) => setGithubToken(e.target.value)} placeholder="ghp_..." />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="gh-repo">{tr("admin.repository")}</Label>
              <Input id="gh-repo" value={githubRepo} onChange={(e) => setGithubRepo(e.target.value)} placeholder="username/chatbd-uploads" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="gh-branch">{tr("admin.branch")}</Label>
              <Input id="gh-branch" value={githubBranch} onChange={(e) => setGithubBranch(e.target.value)} placeholder="main" />
            </div>
            <Button onClick={saveGithub} disabled={saving}>
              <Save /> {saving ? tr("common.saving") : tr("admin.saveStorageSettings")}
            </Button>
            <div className="text-muted-foreground text-xs leading-relaxed">
              Tip: create a fine-grained token with Contents read/write permission on a dedicated repository. Files are stored under
              uploads/chat_files/, uploads/profile_pictures/ and uploads/cover_photos/.
            </div>
            <div className="border-t pt-3">
              <Button asChild variant="outline" size="sm">
                <a href="/admin/storage">
                  <HardDrive className="size-4" /> Open Storage Manager →
                </a>
              </Button>
              <div className="text-muted-foreground mt-1 text-xs">
                Browse, rename, replace or delete files hosted in your GitHub repository.
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Admin profile */}
        <Card className="lg:col-span-2">
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2 text-lg">
              <UserRound className="size-4" /> {tr("admin.adminProfile")}
            </CardTitle>
            <CardDescription>{tr("admin.adminProfileDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="admin-name">{tr("admin.displayName")}</Label>
              <Input id="admin-name" value={profileName} onChange={(e) => setProfileName(e.target.value)} />
            </div>
            <Button onClick={saveProfile} disabled={!profileName.trim()}>
              <Save /> {tr("admin.updateProfile")}
            </Button>
          </CardContent>
        </Card>

        {/* Danger zone (Chatme dashboard feature) */}
        <Card className="border-destructive/40 lg:col-span-2">
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2 text-lg text-destructive">
              <TriangleAlert className="size-4" /> {tr("admin.dangerZone")}
            </CardTitle>
            <CardDescription>{tr("admin.dangerZoneDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {([
                ["messages", "Wipe all messages"],
                ["calls", "Wipe call logs"],
                ["statuses", "Wipe statuses"],
                ["announcements", "Wipe announcements"],
                ["activityLogs", "Wipe activity logs"],
              ] as const).map(([type, label]) => (
                <Button
                  key={type}
                  variant="outline"
                  size="sm"
                  className="border-destructive/40 text-destructive hover:bg-destructive/10"
                  onClick={async () => {
                    if (!confirm(`Delete ALL ${type}? This cannot be undone.`)) return;
                    const ok = await wipeData(type);
                    toast[ok ? "success" : "error"](ok ? `${type} wiped` : "Wipe failed");
                  }}
                >
                  {label}
                </Button>
              ))}
            </div>

            <Separator className="my-1" />

            <div className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
              <div className="text-destructive text-sm font-semibold">Wipe the entire database</div>
              <p className="text-muted-foreground text-xs leading-relaxed">
                Deletes all messages, calls, statuses, announcements and activity logs at once. Users are kept. This action cannot be
                undone.
              </p>
              <div className="flex gap-2">
                <Input placeholder='Type "DELETE ALL" to confirm' value={wipeAllText} onChange={(e) => setWipeAllText(e.target.value)} />
                <Button
                  variant="destructive"
                  disabled={wipeAllText.trim() !== "DELETE ALL"}
                  onClick={async () => {
                    if (wipeAllText.trim() !== "DELETE ALL") return;
                    const ok = await wipeData("all");
                    toast[ok ? "success" : "error"](ok ? "Database wiped" : "Wipe failed");
                    setWipeAllText("");
                  }}
                >
                  Wipe everything
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Separator />

      <div className="text-muted-foreground text-xs leading-relaxed">
        ChatBD {settings.versionText || "v9"} · Next.js 16 static export for Cloudflare Pages · Firebase Realtime Database + Auth · WebRTC P2P calls.
      </div>
    </div>
  );
}
