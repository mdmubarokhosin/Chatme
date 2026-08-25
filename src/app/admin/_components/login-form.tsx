"use client";

/** Admin login — email/password with admin role verification. */
import { useState } from "react";
import { toast } from "sonner";

import { Loader2, LogIn, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { auth, db } from "@/lib/firebase";

export function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const cred = await auth.signInWithEmailAndPassword(email.trim(), password);
      const snap = await db.ref(`users/${cred.user!.uid}`).once("value");
      const data = snap.val() as { role?: string; isBanned?: boolean } | null;
      if (!data || data.role !== "admin") {
        await auth.signOut();
        setError("This account does not have administrator privileges.");
      } else if (data.isBanned) {
        await auth.signOut();
        setError("This admin account has been banned.");
      } else {
        toast.success("Welcome back, Admin!");
      }
    } catch (err) {
      const code = (err as { code?: string }).code;
      const messages: Record<string, string> = {
        "auth/user-not-found": "No account exists with this email.",
        "auth/wrong-password": "Incorrect password.",
        "auth/invalid-credential": "Invalid email or password.",
        "auth/too-many-requests": "Too many attempts. Try again later.",
      };
      setError(messages[code || ""] || "Login failed. Please try again.");
    }
    setLoading(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <ShieldCheck className="size-8" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">ChatBD Admin</h1>
          <p className="text-muted-foreground mt-1 text-sm">Sign in with an administrator account</p>
        </div>

        <div className="rounded-xl border bg-background p-6 shadow-sm">
          {error && (
            <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm">{error}</div>
          )}
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="admin-email">Email</Label>
              <Input id="admin-email" type="email" placeholder="admin@chatbd.com" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={loading} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="admin-password">Password</Label>
              <Input id="admin-password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required disabled={loading} />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
              {loading ? "Verifying..." : "Sign in"}
            </Button>
          </form>
        </div>

        <p className="text-muted-foreground mt-6 text-center text-xs">
          Administrator access only. Regular users should use the <a href="/" className="text-primary hover:underline">main chat app</a>.
        </p>
      </div>
    </div>
  );
}
