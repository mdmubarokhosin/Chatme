"use client";

/**
 * Auth screen — ports Chatme's login / register / recovery flows
 * (email+password, 4-digit unique ID generation, ban & maintenance gates)
 * styled in the multi-player design language. Includes a forgot-password
 * flow that calls Firebase's sendPasswordResetEmail().
 */
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ArrowLeft, AtSign, Check, Copy, KeyRound, Loader2, LogIn, MailCheck, MessageCircle, UserRound } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";

import { auth, db, generateUniqueId, serverTimestamp } from "@/lib/firebase";
import { useAppLang } from "../_lib/store";

type Mode = "login" | "register" | "forgot";

export function AuthScreen({ registrationOpen, maintenance }: { registrationOpen: boolean; maintenance: boolean }) {
  const [mode, setMode] = useState<Mode>("login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const lang = useAppLang();
  const tr = (key: string) => t(lang, key);

  // login
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // register
  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirm, setRegConfirm] = useState("");

  // forgot password
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSent, setForgotSent] = useState(false);

  // registration success
  const [successId, setSuccessId] = useState<string | null>(null);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!loginEmail.trim() || !loginPassword) {
      setError("Please fill in all fields.");
      return;
    }
    setLoading(true);
    try {
      await auth.signInWithEmailAndPassword(loginEmail.trim(), loginPassword);
    } catch (err) {
      const code = (err as { code?: string }).code;
      const messages: Record<string, string> = {
        "auth/user-not-found": "No account exists with this email.",
        "auth/wrong-password": "Incorrect password.",
        "auth/invalid-email": "Invalid email format.",
        "auth/too-many-requests": "Too many attempts. Try again later.",
        "auth/network-request-failed": "Network error. Check your connection.",
        "auth/invalid-credential": "Invalid email or password.",
      };
      setError(messages[code || ""] || "Login failed. Please try again.");
    }
    setLoading(false);
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (regName.trim().length < 2) {
      setError("Name must be at least 2 characters.");
      return;
    }
    if (regPassword.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (regPassword !== regConfirm) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    (window as unknown as { __chatbd_set_registering?: (v: boolean) => void }).__chatbd_set_registering?.(true);
    try {
      const cred = await auth.createUserWithEmailAndPassword(regEmail.trim(), regPassword);
      const user = cred.user!;
      const newUid = user.uid;
      try {
        await user.getIdToken(true);
      } catch {
        /* token refresh warning */
      }
      await new Promise((r) => setTimeout(r, 1500));

      const uniqueId = await generateUniqueId();

      let writeSuccess = false;
      let lastErr: unknown = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await user.getIdToken(true);
          await db.ref(`uniqueIds/${uniqueId}`).set(true);
          await db.ref(`users/${newUid}`).set({
            uid: newUid,
            uniqueId,
            name: regName.trim(),
            email: regEmail.trim(),
            role: "user",
            isBanned: false,
            isOnline: false,
            lastSeen: serverTimestamp,
            createdAt: serverTimestamp,
            bio: "",
          });
          writeSuccess = true;
          break;
        } catch (writeErr) {
          lastErr = writeErr;
          if (attempt < 3) await new Promise((r) => setTimeout(r, 2000));
        }
      }

      if (!writeSuccess) throw lastErr || new Error("Database write failed");

      setSuccessId(uniqueId);
      await auth.signOut();
    } catch (err) {
      const code = (err as { code?: string }).code;
      const messages: Record<string, string> = {
        "auth/email-already-in-use": "An account with this email already exists.",
        "auth/invalid-email": "Invalid email format.",
        "auth/weak-password": "Password is too weak.",
        "auth/network-request-failed": "Network error. Check your connection.",
        "auth/too-many-requests": "Too many attempts. Try again later.",
      };
      let msg = messages[code || ""] || "Registration failed. Please try again.";
      const errMsg = (err as Error).message || "";
      if (!code || !code.startsWith("auth/")) {
        if (errMsg.includes("Permission denied")) {
          msg = "Database permission error! Update your Firebase Realtime Database rules.";
        } else if (errMsg) {
          msg = errMsg;
        }
      }
      setError(msg);
      try {
        if (auth.currentUser) await auth.currentUser.delete();
      } catch {
        /* cleanup best-effort */
      }
    }
    (window as unknown as { __chatbd_set_registering?: (v: boolean) => void }).__chatbd_set_registering?.(false);
    setLoading(false);
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!forgotEmail.trim()) {
      setError("Please enter your account email.");
      return;
    }
    setLoading(true);
    try {
      await auth.sendPasswordResetEmail(forgotEmail.trim());
      setForgotSent(true);
      toast.success("Password reset link sent!");
    } catch (err) {
      const code = (err as { code?: string }).code;
      const messages: Record<string, string> = {
        "auth/user-not-found": "No account exists with this email.",
        "auth/invalid-email": "Invalid email format.",
        "auth/network-request-failed": "Network error. Check your connection.",
        "auth/too-many-requests": "Too many attempts. Try again later.",
      };
      setError(messages[code || ""] || "Could not send reset email. Please try again.");
    }
    setLoading(false);
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError("");
    setForgotSent(false);
  }

  if (maintenance) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-6 flex size-20 items-center justify-center rounded-2xl bg-muted">
            <MessageCircle className="size-10 text-muted-foreground" />
          </div>
          <h1 className="mb-2 text-2xl font-semibold">{tr("auth.maintenanceTitle")}</h1>
          <p className="text-muted-foreground leading-relaxed">
            {tr("auth.maintenanceBody")}
          </p>
        </div>
      </div>
    );
  }

  if (successId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm rounded-xl border bg-background p-8 text-center shadow-sm">
          <div className="mx-auto mb-6 flex size-20 items-center justify-center rounded-full bg-green-600/10">
            <Check className="size-10 text-green-600" />
          </div>
          <h1 className="mb-1 text-xl font-semibold">{tr("auth.accountCreated")}</h1>
          <p className="text-muted-foreground mb-6 text-sm leading-relaxed">
            {tr("auth.saveIdNotice")}
          </p>
          <div className="mb-6 rounded-lg border-2 border-dashed border-primary/40 bg-primary/5 px-6 py-4">
            <div className="text-muted-foreground text-xs font-medium tracking-wider uppercase">{tr("auth.yourUniqueId")}</div>
            <div className="mt-1 text-4xl font-bold tracking-[0.2em] text-primary">#{successId}</div>
          </div>
          <Button
            variant="outline"
            className="mb-3 w-full"
            onClick={async () => {
              await navigator.clipboard.writeText(`#${successId}`).catch(() => {});
              toast.success("ID copied!");
            }}
          >
            <Copy className="size-4" /> {tr("auth.copyId")}
          </Button>
          <Button className="w-full" onClick={() => { setSuccessId(null); setMode("login"); }}>
            <LogIn className="size-4" /> {tr("auth.continueToLogin")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-muted/30 to-background p-4 sm:p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <MessageCircle className="size-8" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">ChatBD</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {mode === "login" && tr("auth.loginSubtitle")}
            {mode === "register" && tr("auth.registerSubtitle")}
            {mode === "forgot" && tr("auth.forgotSubtitle")}
          </p>
        </div>

        <div className="rounded-xl border bg-background p-6 shadow-sm">
          {error && (
            <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm">
              {error}
            </div>
          )}

          {/* ==================== FORGOT PASSWORD ==================== */}
          {mode === "forgot" ? (
            forgotSent ? (
              <div className="flex flex-col items-center gap-4 py-4 text-center">
                <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-green-600/10">
                  <MailCheck className="size-8 text-green-600" />
                </div>
                <div>
                  <h2 className="mb-1 text-lg font-semibold">{tr("auth.resetSent")}</h2>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    {tr("auth.resetSentBody")} <span className="font-medium text-foreground">{forgotEmail}</span>.
                    {tr("auth.resetSentBody2")}
                  </p>
                </div>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setForgotEmail("");
                    setForgotSent(false);
                    setMode("login");
                  }}
                >
                  <ArrowLeft className="size-4" /> {tr("auth.backToLogin")}
                </Button>
              </div>
            ) : (
              <form onSubmit={handleForgotPassword} className="flex flex-col gap-4">
                <div className="text-muted-foreground text-sm leading-relaxed">
                  {tr("auth.forgotIntro")}
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="forgot-email">{tr("auth.email")}</Label>
                  <div className="relative">
                    <AtSign className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                    <Input
                      id="forgot-email"
                      type="email"
                      className="pl-9"
                      placeholder="you@example.com"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      disabled={loading}
                      required
                      autoFocus
                    />
                  </div>
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? <Loader2 className="size-4 animate-spin" /> : <MailCheck className="size-4" />}
                  {loading ? tr("auth.sending") : tr("auth.sendResetLink")}
                </Button>
                <button
                  type="button"
                  className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
                  onClick={() => switchMode("login")}
                >
                  <ArrowLeft className="size-3.5" /> {tr("auth.backToLogin")}
                </button>
              </form>
            )
          ) : mode === "login" ? (
            /* ==================== LOGIN ==================== */
            <form onSubmit={handleLogin} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">{tr("auth.email")}</Label>
                <div className="relative">
                  <AtSign className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                  <Input
                    id="email"
                    type="email"
                    className="pl-9"
                    placeholder="you@example.com"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    disabled={loading}
                    required
                  />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">{tr("auth.password")}</Label>
                  <button
                    type="button"
                    className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                    onClick={() => switchMode("forgot")}
                  >
                    {tr("auth.forgotLink")}
                  </button>
                </div>
                <div className="relative">
                  <KeyRound className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                  <Input
                    id="password"
                    type="password"
                    className="pl-9"
                    placeholder="••••••••"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    disabled={loading}
                    required
                  />
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
                {loading ? tr("auth.signingIn") : tr("auth.signIn")}
              </Button>
            </form>
          ) : (
            /* ==================== REGISTER ==================== */
            <form onSubmit={handleRegister} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="name">{tr("auth.fullName")}</Label>
                <div className="relative">
                  <UserRound className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                  <Input
                    id="name"
                    className="pl-9"
                    placeholder={tr("auth.namePlaceholder")}
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    disabled={loading || !registrationOpen}
                    required
                  />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="reg-email">{tr("auth.email")}</Label>
                <Input
                  id="reg-email"
                  type="email"
                  placeholder="you@example.com"
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  disabled={loading || !registrationOpen}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="reg-password">{tr("auth.password")}</Label>
                <Input
                  id="reg-password"
                  type="password"
                  placeholder="At least 6 characters"
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                  disabled={loading || !registrationOpen}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="reg-confirm">{tr("auth.confirmPassword")}</Label>
                <Input
                  id="reg-confirm"
                  type="password"
                  placeholder="Repeat your password"
                  value={regConfirm}
                  onChange={(e) => setRegConfirm(e.target.value)}
                  disabled={loading || !registrationOpen}
                  required
                />
              </div>
              {!registrationOpen && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-600 text-sm dark:text-amber-400">
                  Registration is currently closed by the administrator.
                </div>
              )}
              <Button type="submit" className="w-full" disabled={loading || !registrationOpen}>
                {loading ? <Loader2 className="size-4 animate-spin" /> : <UserRound className="size-4" />}
                {loading ? tr("auth.creatingAccount") : tr("auth.createAccount")}
              </Button>
            </form>
          )}
        </div>

        {mode !== "forgot" && (
          <div className="mt-5 text-center text-sm">
            <span className="text-muted-foreground">
              {mode === "login" ? tr("auth.noAccount") : tr("auth.hasAccount")}
            </span>
            <button
              type="button"
              className="font-medium text-primary underline-offset-4 hover:underline"
              onClick={() => switchMode(mode === "login" ? "register" : "login")}
            >
              {mode === "login" ? tr("auth.register") : tr("auth.signInLink")}
            </button>
          </div>
        )}

        <p className="text-muted-foreground mt-6 text-center text-xs leading-relaxed">
          {tr("auth.footer")}
        </p>
      </div>
    </div>
  );
}
