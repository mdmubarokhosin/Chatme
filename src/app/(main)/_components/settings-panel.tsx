"use client";

/**
 * Settings panel — beautifully organised, production-quality settings page
 * with a hero profile header, quick actions, and card-based sections for
 * Appearance / Profile / Notifications / Privacy / Storage & Account.
 *
 * Responsive across mobile (< 480px), tablet (480–1024px), and desktop.
 */
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  AtSign,
  Ban,
  Bell,
  CalendarClock,
  Check,
  Crown,
  Hash,
  Image as ImageIcon,
  LogOut,
  Laptop,
  MessageSquarePlus,
  Monitor,
  Moon,
  Palette,
  Smartphone,
  Sun,
  Trash2,
  TriangleAlert,
  UserRound,
  X,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { cn, getInitials } from "@/lib/utils";
import { auth, db } from "@/lib/firebase";
import { formatFileSize } from "@/lib/format";
import { WALLPAPERS } from "@/lib/types";
import { t } from "@/lib/i18n";

import { deleteAccount, removeProfilePicture, uploadProfilePicture, uploadCoverPhoto, removeCoverPhoto, cancelScheduledMessage, revokeSession } from "../_lib/chat-actions";
import { setView, useChatApp, useUiStore, useAppLang } from "../_lib/store";
import { wallpaperClass } from "./wallpaper-util";
import { QrDialog } from "./qr-dialog";
/* Theme presets (must match lib/preferences/theme.ts values) */
const THEME_PRESETS = [
  { id: "default", label: "Default", swatch: "bg-zinc-900 dark:bg-zinc-100" },
  { id: "brutalist", label: "Brutalist", swatch: "bg-orange-500" },
  { id: "soft-pop", label: "Soft Pop", swatch: "bg-violet-500" },
  { id: "tangerine", label: "Tangerine", swatch: "bg-orange-600" },
] as const;

export function SettingsPanel() {
  const me = useChatApp((s) => s.me);
  const settings = useChatApp((s) => s.settings);
  const users = useChatApp((s) => s.users);
  const chats = useChatApp((s) => s.chats);
  const announcementBadge = useChatApp((s) => s.announcementBadge);
  const scheduled = useChatApp((s) => s.scheduled);
  const sessions = useChatApp((s) => s.sessions);
  const setNewChatOpen = useUiStore((s) => s.setNewChatOpen);
  const lang = useAppLang();
  const tr = (key: string) => t(lang, key);
  const mySessionId = typeof window !== "undefined" ? localStorage.getItem("chatbd-session-id") : null;

  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [wallpaper, setWallpaper] = useState("default");
  const [themeMode, setThemeMode] = useState<"light" | "dark">("light");
  const [themePreset, setThemePreset] = useState<string>("default");
  const [storage, setStorage] = useState<{ messages: number; statuses: number; calls: number } | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [qrOpen, setQrOpen] = useState(false);

  useEffect(() => {
    if (me) {
      setName(me.name || "");
      setBio(me.bio || "");
    }
  }, [me?.uid]);

  useEffect(() => {
    setWallpaper(localStorage.getItem("chatbd-wallpaper") || "default");
    setThemeMode(document.documentElement.classList.contains("dark") ? "dark" : "light");
    setThemePreset(document.documentElement.getAttribute("data-theme-preset") || "default");
  }, []);

  useEffect(() => {
    async function calc() {
      try {
        const [msgSnap, statusSnap, callSnap] = await Promise.all([
          db.ref("messages").once("value"),
          db.ref("statuses").once("value"),
          db.ref("calls").once("value"),
        ]);
        setStorage({
          messages: JSON.stringify(msgSnap.val()).length,
          statuses: JSON.stringify(statusSnap.val()).length,
          calls: JSON.stringify(callSnap.val()).length,
        });
      } catch {
        /* silent */
      }
    }
    calc();
  }, []);

  if (!me) return null;

  const myUid = me.uid;
  const premiumEnabled = settings.premium?.enabled && !me.isPremium;

  async function saveProfile() {
    if (name.trim().length < 2) {
      toast.error("Name must be at least 2 characters");
      return;
    }
    setSaving(true);
    try {
      await db.ref(`users/${myUid}`).update({ name: name.trim(), bio: bio.trim() });
      toast.success("Profile updated");
    } catch {
      toast.error("Could not save profile");
    }
    setSaving(false);
  }

  function setNotif(key: string, value: boolean | string) {
    db.ref(`users/${myUid}/settings/notifications/${key}`)
      .set(value)
      .then(() => toast.success("Settings saved"))
      .catch(() => toast.error("Could not save"));
  }

  function setPrivacy(key: string, value: boolean | string) {
    db.ref(`users/${myUid}/settings/privacy/${key}`)
      .set(value)
      .then(() => toast.success("Settings saved"))
      .catch(() => toast.error("Could not save"));
  }

  function setAppearance(key: string, value: boolean | string) {
    db.ref(`users/${myUid}/settings/appearance/${key}`)
      .set(value)
      .then(() => toast.success(tr("settings.settingsSaved")))
      .catch(() => toast.error(tr("settings.saveFailed")));
  }

  function applyThemeMode(next: "light" | "dark") {
    const root = document.documentElement;
    root.classList.toggle("dark", next === "dark");
    root.style.colorScheme = next;
    root.setAttribute("data-theme-mode", next);
    document.cookie = `theme_mode=${next}; path=/; max-age=31536000`;
    localStorage.setItem("chatbd-dark-mode", String(next === "dark"));
    setThemeMode(next);
  }

  function applyThemePreset(preset: string) {
    const root = document.documentElement;
    root.setAttribute("data-theme-preset", preset);
    document.cookie = `theme_preset=${preset}; path=/; max-age=31536000`;
    localStorage.setItem("chatbd-theme-preset", preset);
    setThemePreset(preset);
    toast.success(`Theme: ${THEME_PRESETS.find((p) => p.id === preset)?.label ?? preset}`);
  }

  const notifications = { messageNotif: true, showPreview: true, notifTone: "default", vibrate: true, groupNotif: true, callNotif: true, ...(me.settings?.notifications || {}) };
  const privacy = { lastSeen: "all", profilePhoto: "all", about: "all", readReceipts: true, status: "all", groups: "all", fingerprintLock: false, autoLockMinutes: 0, ...(me.settings?.privacy || {}) };
  const appearance = { chatBubbles: true, ...(me.settings?.appearance || {}) };
  const blockedUids = Object.entries(me.blocked || {})
    .filter(([, v]) => v)
    .map(([k]) => k);

  return (
    <div className="flex h-full flex-col">
      {/* ==================== Header ==================== */}
      <div className="border-b bg-gradient-to-b from-muted/40 to-background px-3 py-3 sm:px-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <h1 className="font-semibold text-lg sm:text-xl">{tr("settings.title")}</h1>
          <span className="text-muted-foreground text-xs">{settings.versionText || "v15"}</span>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-3xl p-3 sm:p-4">
          {/* ==================== Premium banner ==================== */}
          {premiumEnabled && (
            <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
              <div className="flex items-center gap-2 font-medium text-sm">
                <Crown className="size-4 text-amber-500" /> ChatBD Premium
              </div>
              <div className="text-muted-foreground mt-1 text-sm">
                {settings.premium?.price ? `${settings.premium.price}/month · ` : ""}
                {settings.premium?.description || "Ask the administrator to activate premium."}
              </div>
            </div>
          )}

          {/* ==================== Hero profile card ==================== */}
          <div className="mb-4 overflow-hidden rounded-xl border bg-card">
            <div className="relative h-20 sm:h-28">
              {me.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={me.coverUrl}
                  alt="Cover"
                  className="size-full w-full object-cover"
                />
              ) : (
                <div className="size-full w-full bg-gradient-to-r from-primary/30 via-primary/15 to-primary/30" />
              )}
              {/* Cover edit controls (top-right) */}
              <div className="absolute top-2 right-2 flex items-center gap-1">
                <input
                  ref={coverInputRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) await uploadCoverPhoto(file, me.uid, me.coverUrl);
                    e.target.value = "";
                  }}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 gap-1 px-2 text-xs shadow-sm backdrop-blur-sm"
                  onClick={() => coverInputRef.current?.click()}
                >
                  <ImageIcon className="size-3.5" />
                  <span className="hidden sm:inline">{me.coverUrl ? "Change" : "Cover"}</span>
                </Button>
                {me.coverUrl && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-7 px-2 text-xs shadow-sm"
                    onClick={() => removeCoverPhoto(me.uid, me.coverUrl)}
                    aria-label="Remove cover"
                  >
                    <X className="size-3.5" />
                  </Button>
                )}
              </div>
            </div>
            {/* Mobile: stack vertically; Desktop: side-by-side */}
            <div className="flex flex-col items-center gap-4 px-4 pb-4 -mt-8 sm:flex-row sm:items-end sm:-mt-12">
              <div className="relative flex flex-col items-center gap-2">
                <Avatar className="size-16 ring-4 ring-card ring-offset-0 sm:size-20">
                  {me.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={me.photoUrl} alt={me.name || "Me"} className="size-full rounded-full object-cover" />
                  ) : (
                    <AvatarFallback className="text-lg font-semibold sm:text-xl">{getInitials(me.name || "U")}</AvatarFallback>
                  )}
                </Avatar>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) await uploadProfilePicture(file, me.uid, me.photoUrl);
                    e.target.value = "";
                  }}
                />
                {/* Mobile: buttons below avatar */}
                <div className="flex w-full items-center justify-center gap-1.5 sm:hidden">
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => photoInputRef.current?.click()}>
                    <ImageIcon className="size-3.5" /> Photo
                  </Button>
                  {me.photoUrl && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive text-xs h-7"
                      onClick={() => removeProfilePicture(me.uid, me.photoUrl)}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </div>

              <div className="min-w-0 flex-1 text-center sm:text-left pb-1">
                <div className="flex items-center justify-center gap-2 sm:justify-start">
                  <span className="truncate font-semibold text-base sm:text-lg">{me.name || "User"}</span>
                  {me.isPremium && <Crown className="size-4 shrink-0 text-amber-500" />}
                </div>
                <div className="text-muted-foreground text-sm truncate">{me.email || `#${me.uniqueId}`}</div>
              </div>

              {/* Desktop: photo buttons on the right */}
              <div className="hidden flex-col gap-1.5 pb-1 sm:flex">
                <Button size="sm" variant="outline" onClick={() => photoInputRef.current?.click()}>
                  <ImageIcon className="size-4" /> Photo
                </Button>
                {me.photoUrl && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive text-xs h-7"
                    onClick={() => removeProfilePicture(me.uid, me.photoUrl)}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>
            {/* ID row */}
            <div className="flex flex-col items-center justify-between gap-2 border-t bg-muted/30 px-4 py-3 sm:flex-row sm:gap-3">
              <div className="flex items-center gap-2">
                <Hash className="size-4 text-primary" />
                <span className="text-muted-foreground text-xs font-medium tracking-wider uppercase">{tr("settings.chatbdId")}</span>
                <span className="font-bold text-lg tracking-widest text-primary">#{me.uniqueId || "????"}</span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  await navigator.clipboard.writeText(`#${me.uniqueId || ""}`).catch(() => {});
                  toast.success(tr("settings.idCopied"));
                }}
              >
                {tr("settings.copy")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setQrOpen(true)}>
                {tr("thread.shareQr")}
              </Button>
            </div>
          </div>

          {/* ==================== Quick Actions ==================== */}
          <SectionCard
            title={tr("settings.quickActions")}
            icon={<Bell className="size-4" />}
            className="mb-4"
          >
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <QuickAction
                icon={<MessageSquarePlus className="size-5" />}
                label={tr("settings.newChat")}
                onClick={() => setNewChatOpen(true)}
              />
              <QuickAction
                icon={<Bell className="size-5" />}
                label={tr("nav.announcements")}
                badge={announcementBadge > 0 ? (announcementBadge > 9 ? "9+" : announcementBadge) : undefined}
                onClick={() => setView("announcements")}
              />
              <QuickAction
                icon={themeMode === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}
                label={themeMode === "dark" ? tr("settings.light") : tr("settings.dark")}
                onClick={() => applyThemeMode(themeMode === "dark" ? "light" : "dark")}
              />
              {me?.role === "admin" && (
                <QuickAction
                  icon={<UserRound className="size-5" />}
                  label={tr("settings.adminPanel")}
                  onClick={() => window.open("/admin", "_blank")}
                />
              )}
            </div>
          </SectionCard>

          {/* ==================== Appearance ==================== */}
          <SectionCard
            title={tr("settings.appearance")}
            icon={<Palette className="size-4" />}
            className="mb-4"
          >
            {/* Theme mode toggle */}
            <SettingRow label={tr("settings.themeMode")} desc={tr("settings.themeModeDesc")}>
              <div className="flex w-full items-center gap-1 rounded-lg border p-0.5 sm:w-auto">
                <button
                  type="button"
                  onClick={() => applyThemeMode("light")}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors sm:flex-none",
                    themeMode === "light" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  <Sun className="size-3.5" /> {tr("settings.light")}
                </button>
                <button
                  type="button"
                  onClick={() => applyThemeMode("dark")}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors sm:flex-none",
                    themeMode === "dark" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  <Moon className="size-3.5" /> {tr("settings.dark")}
                </button>
              </div>
            </SettingRow>

            {/* Language selector */}
            <SettingRow label={tr("settings.language")} desc={tr("settings.languageDesc")}>
              <div className="flex w-full items-center gap-1 rounded-lg border p-0.5 sm:w-auto">
                <button
                  type="button"
                  onClick={() => setAppearance("language", "en")}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors sm:flex-none",
                    lang === "en" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  🇬🇧 English
                </button>
                <button
                  type="button"
                  onClick={() => setAppearance("language", "bn")}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors sm:flex-none",
                    lang === "bn" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  🇧🇩 বাংলা
                </button>
              </div>
            </SettingRow>

            {/* Chat bubbles */}
            <SettingRow
              label={tr("settings.chatBubbles")}
              desc={tr("settings.chatBubblesDesc")}
            >
              <Switch checked={appearance.chatBubbles !== false} onCheckedChange={(v) => setAppearance("chatBubbles", v)} />
            </SettingRow>

            {/* Theme presets */}
            <SettingRow label={tr("settings.colorPreset")} desc={tr("settings.colorPresetDesc")}>
              <div className="flex items-center gap-1.5">
                {THEME_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => applyThemePreset(p.id)}
                    className={cn(
                      "flex size-7 items-center justify-center rounded-full transition-all",
                      p.swatch,
                      themePreset === p.id ? "ring-2 ring-offset-2 ring-offset-background ring-foreground" : "hover:scale-110",
                    )}
                    title={p.label}
                    aria-label={p.label}
                  >
                    {themePreset === p.id && <Check className="size-3.5 text-white" />}
                  </button>
                ))}
              </div>
            </SettingRow>

            <Separator className="my-3" />

            {/* Wallpaper */}
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Palette className="size-4" /> {tr("settings.wallpaper")}
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {WALLPAPERS.map((wp) => (
                <button
                  key={wp.id}
                  type="button"
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-lg border p-2.5 text-xs hover:bg-muted/60",
                    wallpaper === wp.id && "border-primary bg-primary/5",
                  )}
                  onClick={() => {
                    localStorage.setItem("chatbd-wallpaper", wp.id);
                    window.dispatchEvent(new Event("chatbd-wallpaper-change"));
                    setWallpaper(wp.id);
                    toast.success("Wallpaper updated");
                  }}
                >
                  <span className={cn("size-8 rounded-md border", wallpaperClass(wp.id))} />
                  {wp.label}
                  {wallpaper === wp.id && <Check className="text-primary size-3.5" />}
                </button>
              ))}
            </div>
          </SectionCard>

          {/* ==================== Profile ==================== */}
          <SectionCard
            title={tr("settings.profile")}
            icon={<UserRound className="size-4" />}
            className="mb-4"
          >
            <div className="flex flex-col gap-3">
              <div>
                <Label htmlFor="settings-name" className="text-xs text-muted-foreground">{tr("settings.name")}</Label>
                <Input
                  id="settings-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={40}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="settings-bio" className="text-xs text-muted-foreground">{tr("settings.about")}</Label>
                <Input
                  id="settings-bio"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  maxLength={120}
                  placeholder={tr("settings.aboutPlaceholder")}
                  className="mt-1"
                />
              </div>
              <div className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-2">
                <div className="flex items-center gap-2 sm:flex-1">
                  <AtSign className="text-muted-foreground size-4 shrink-0" />
                  <span className="text-muted-foreground">{tr("settings.email")}</span>
                </div>
                <span className="sm:ml-auto sm:max-w-52 sm:truncate">{me.email}</span>
              </div>
              <div className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-2">
                <div className="flex items-center gap-2 sm:flex-1">
                  <Crown className="text-muted-foreground size-4 shrink-0" />
                  <span className="text-muted-foreground">{tr("settings.plan")}</span>
                </div>
                <span className="sm:ml-auto">{me.isPremium ? tr("settings.premiumMember") : tr("settings.free")}</span>
              </div>
              <Button onClick={saveProfile} disabled={saving}>
                {saving ? tr("common.saving") : tr("settings.saveProfile")}
              </Button>
            </div>
          </SectionCard>

          {/* ==================== Notifications ==================== */}
          <SectionCard
            title={tr("settings.notifications")}
            icon={<Bell className="size-4" />}
            className="mb-4"
          >
            <SettingRow label={tr("settings.messageNotif")}>
              <Switch checked={!!notifications.messageNotif} onCheckedChange={(v) => setNotif("messageNotif", v)} />
            </SettingRow>
            <SettingRow label={tr("settings.showPreview")}>
              <Switch checked={!!notifications.showPreview} onCheckedChange={(v) => setNotif("showPreview", v)} />
            </SettingRow>
            <SettingRow label={tr("settings.notifTone")}>
              <Select value={String(notifications.notifTone)} onValueChange={(v) => setNotif("notifTone", v)}>
                <SelectTrigger size="sm" className="w-full sm:w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">{tr("settings.toneDefault")}</SelectItem>
                  <SelectItem value="silent">{tr("settings.toneSilent")}</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>
            <SettingRow label={tr("settings.vibrate")}>
              <Switch checked={!!notifications.vibrate} onCheckedChange={(v) => setNotif("vibrate", v)} />
            </SettingRow>
            <SettingRow label={tr("settings.groupNotif")}>
              <Switch checked={!!notifications.groupNotif} onCheckedChange={(v) => setNotif("groupNotif", v)} />
            </SettingRow>
            <SettingRow label={tr("settings.callNotif")}>
              <Switch checked={!!notifications.callNotif} onCheckedChange={(v) => setNotif("callNotif", v)} />
            </SettingRow>
          </SectionCard>

          {/* ==================== Privacy ==================== */}
          <SectionCard
            title={tr("settings.privacy")}
            icon={<Monitor className="size-4" />}
            className="mb-4"
          >
            <SettingRow label={tr("settings.lastSeen")}>
              <Select value={String(privacy.lastSeen)} onValueChange={(v) => setPrivacy("lastSeen", v)}>
                <SelectTrigger size="sm" className="w-full sm:w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{tr("settings.everyone")}</SelectItem>
                  <SelectItem value="contacts">{tr("settings.myContacts")}</SelectItem>
                  <SelectItem value="nobody">{tr("settings.nobody")}</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>
            <SettingRow label={tr("settings.profilePhoto")}>
              <Select value={String(privacy.profilePhoto)} onValueChange={(v) => setPrivacy("profilePhoto", v)}>
                <SelectTrigger size="sm" className="w-full sm:w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{tr("settings.everyone")}</SelectItem>
                  <SelectItem value="contacts">{tr("settings.myContacts")}</SelectItem>
                  <SelectItem value="nobody">{tr("settings.nobody")}</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>
            <SettingRow label={tr("settings.readReceipts")}>
              <Switch checked={!!privacy.readReceipts} onCheckedChange={(v) => setPrivacy("readReceipts", v)} />
            </SettingRow>
            <SettingRow label={tr("settings.appLock")}>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => {
                    useChatApp.setState({ pinLocked: true, pinSetupMode: true });
                  }}
                >
                  {tr("settings.resetPin")}
                </Button>
                <Switch checked={!!privacy.fingerprintLock} onCheckedChange={(v) => setPrivacy("fingerprintLock", v)} />
              </div>
            </SettingRow>
            <SettingRow label={tr("settings.autoLock")}>
              <Select value={String(privacy.autoLockMinutes || 0)} onValueChange={(v) => setPrivacy("autoLockMinutes", v)}>
                <SelectTrigger size="sm" className="w-full sm:w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">{tr("settings.autoLockOff")}</SelectItem>
                  <SelectItem value="1">1 min</SelectItem>
                  <SelectItem value="5">5 min</SelectItem>
                  <SelectItem value="15">15 min</SelectItem>
                  <SelectItem value="30">30 min</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>

            <Separator className="my-3" />

            {/* ==================== Scheduled messages ==================== */}
            <div className="text-muted-foreground mb-1 flex items-center gap-2 px-1 text-sm font-medium">
              <CalendarClock className="size-4" /> {tr("settings.scheduled")} ({scheduled.length})
            </div>
            {scheduled.length === 0 && (
              <div className="text-muted-foreground px-1 py-2 text-sm">{tr("settings.noScheduled")}</div>
            )}
            {scheduled.map((item) => (
              <div key={item.key} className="flex items-start gap-3 rounded-lg px-1 py-2">
                <CalendarClock className="text-primary mt-0.5 size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{item.text}</div>
                  <div className="text-muted-foreground text-xs">
                    → {item.otherName || users[item.otherUid]?.name || "User"} · {new Date(item.sendAt).toLocaleString()}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive h-7 text-xs"
                  onClick={() => cancelScheduledMessage(me.uid, item.key)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}

            <Separator className="my-3" />

            {/* ==================== Login sessions ==================== */}
            <div className="text-muted-foreground mb-1 flex items-center gap-2 px-1 text-sm font-medium">
              <Laptop className="size-4" /> {tr("settings.sessions")} ({sessions.length})
            </div>
            {sessions.map((session) => (
              <div key={session.sid} className="flex items-center gap-3 rounded-lg px-1 py-2">
                {session.device === "Phone" ? (
                  <Smartphone className="text-muted-foreground size-4 shrink-0" />
                ) : (
                  <Laptop className="text-muted-foreground size-4 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">
                    {session.device} · {session.browser}
                    {session.sid === mySessionId && <span className="text-primary ml-1 text-xs font-medium">({tr("settings.thisDevice")})</span>}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {session.lastActive ? tr("settings.lastActive") + " " + new Date(session.lastActive).toLocaleString() : ""}
                  </div>
                </div>
                {session.sid !== mySessionId && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive h-7 text-xs"
                    onClick={() => revokeSession(me.uid, session.sid)}
                  >
                    <LogOut className="size-3.5" />
                  </Button>
                )}
              </div>
            ))}

            <Separator className="my-3" />

            <div className="text-muted-foreground mb-1 flex items-center gap-2 px-1 text-sm font-medium">
              <Ban className="size-4" /> {tr("settings.blockedContacts")} ({blockedUids.length})
            </div>
            {blockedUids.length === 0 && (
              <div className="text-muted-foreground px-1 py-2 text-sm">{tr("settings.noBlocked")}</div>
            )}
            {blockedUids.map((uid) => {
              const u = users[uid];
              return (
                <div key={uid} className="flex items-center gap-3 rounded-lg px-1 py-2">
                  <Avatar className="size-8 shrink-0">
                    {u?.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={u.photoUrl} alt={u.name || "User"} className="size-full rounded-full object-cover" />
                    ) : (
                      <AvatarFallback className="text-xs">{getInitials(u?.name || "U")}</AvatarFallback>
                    )}
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{u?.name || "Unknown"}</div>
                    <div className="text-muted-foreground text-xs">#{u?.uniqueId || "????"}</div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      await db.ref(`users/${me.uid}/blocked/${uid}`).remove();
                      toast.success(tr("settings.settingsSaved"));
                    }}
                  >
                    {tr("settings.unblock")}
                  </Button>
                </div>
              );
            })}
          </SectionCard>

          {/* ==================== Storage & Account ==================== */}
          <SectionCard
            title={tr("settings.storageAccount")}
            icon={<Trash2 className="size-4" />}
            className="mb-4"
          >
            <div className="mb-3">
              <div className="mb-2 text-sm font-medium">{tr("settings.storageUsage")}</div>
              <div className="text-muted-foreground flex flex-col gap-1 text-sm">
                <div className="flex justify-between">
                  <span>{tr("settings.messages")}</span>
                  <span>{storage ? formatFileSize(storage.messages) : "..."}</span>
                </div>
                <div className="flex justify-between">
                  <span>{tr("settings.statuses")}</span>
                  <span>{storage ? formatFileSize(storage.statuses) : "..."}</span>
                </div>
                <div className="flex justify-between">
                  <span>{tr("settings.callLogs")}</span>
                  <span>{storage ? formatFileSize(storage.calls) : "..."}</span>
                </div>
              </div>
              <Button
                variant="outline"
                className="mt-3 w-full"
                onClick={async () => {
                  if (!confirm(tr("settings.clearWarning"))) return;
                  if (!confirm(tr("settings.clearWarning2"))) return;
                  const promises: Promise<unknown>[] = [];
                  Object.values(chats).forEach((chat) => {
                    if (chat.participant1 === me.uid || chat.participant2 === me.uid) {
                      promises.push(db.ref(`messages/${chat.chatId}`).remove());
                    }
                  });
                  await Promise.all(promises).catch(() => {});
                  toast.success(tr("settings.storageCleared"));
                }}
              >
                <Trash2 className="size-4" /> {tr("settings.clearAllMessages")}
              </Button>
            </div>

            <Separator className="my-3" />

            <Button
              variant="outline"
              className="w-full"
              onClick={async () => {
                await db.ref(`users/${me.uid}`).update({ isOnline: false }).catch(() => {});
                await auth.signOut();
                toast.success(tr("settings.loggedOut"));
              }}
            >
              <LogOut className="size-4" /> {tr("settings.logOut")}
            </Button>

            <Separator className="my-3" />

            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <div className="mb-2 flex items-center gap-2 text-destructive text-sm font-medium">
                <TriangleAlert className="size-4" /> {tr("settings.deleteAccount")}
              </div>
              <p className="text-muted-foreground mb-2 text-xs leading-relaxed">
                {tr("settings.deleteAccountDesc")}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input placeholder="DELETE" value={deleteText} onChange={(e) => setDeleteText(e.target.value)} className="sm:flex-1" />
                <Button
                  variant="destructive"
                  disabled={deleteText.trim() !== "DELETE"}
                  onClick={async () => {
                    await deleteAccount(me.uid, me.uniqueId != null ? String(me.uniqueId) : undefined);
                    await auth.signOut();
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
          </SectionCard>

          {/* ==================== About ==================== */}
          <div className="text-center text-muted-foreground text-xs leading-relaxed py-4">
            <div className="font-medium text-foreground">ChatBD {settings.versionText || "v15"}</div>
            <div className="mt-1">{settings.footerText || "Fast, simple & reliable real-time messaging"}</div>
          </div>
        </div>
      </ScrollArea>
      <QrDialog open={qrOpen} onClose={() => setQrOpen(false)} />
    </div>
  );
}

/* ============================== Helper components ============================== */

function SectionCard({
  title,
  icon,
  className,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("overflow-hidden rounded-xl border bg-card", className)}>
      <header className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2.5 sm:px-4">
        {icon && <span className="text-muted-foreground">{icon}</span>}
        <h2 className="font-medium text-sm">{title}</h2>
      </header>
      <div className="p-3 sm:p-4">{children}</div>
    </section>
  );
}

function SettingRow({
  label,
  desc,
  children,
}: {
  label: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 py-2.5 sm:flex-row sm:items-center sm:gap-3 sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="text-sm">{label}</div>
        {desc && <div className="text-muted-foreground text-xs">{desc}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function QuickAction({
  icon,
  label,
  badge,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  badge?: string | number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex flex-col items-center justify-center gap-2 rounded-lg border bg-background p-3 text-center transition-all hover:bg-muted/60 hover:shadow-sm"
    >
      {badge !== undefined && (
        <span className="absolute top-1.5 right-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-white">
          {badge}
        </span>
      )}
      <span className="text-primary group-hover:scale-110 transition-transform">{icon}</span>
      <span className="text-xs font-medium leading-tight">{label}</span>
    </button>
  );
}
