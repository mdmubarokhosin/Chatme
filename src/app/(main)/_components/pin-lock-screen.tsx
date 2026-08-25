"use client";

/**
 * PIN lock screen — ports Chatme's fingerprint lock:
 * locked when settings/privacy/fingerprintLock is on, unlock with the
 * device PIN (default 1234, stored in localStorage 'chatbd-pin').
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Lock, LockKeyhole } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useChatApp } from "../_lib/store";

export function PinLockScreen() {
  const pinLocked = useChatApp((s) => s.pinLocked);
  const pinSetupMode = useChatApp((s) => s.pinSetupMode);
  const [pin, setPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [settingNew, setSettingNew] = useState(false);

  useEffect(() => {
    if (pinSetupMode) setSettingNew(true);
  }, [pinSetupMode]);

  if (!pinLocked) return null;

  function unlock() {
    const stored = localStorage.getItem("chatbd-pin") || "1234";
    if (pin === stored) {
      useChatApp.setState({ pinLocked: false, pinSetupMode: false });
      setPin("");
      setSettingNew(false);
    } else {
      toast.error("Wrong PIN");
    }
  }

  function saveNewPin() {
    if (newPin.length >= 4) {
      localStorage.setItem("chatbd-pin", newPin);
      toast.success("New PIN saved");
      if (pinSetupMode) {
        /* came from settings Reset PIN — done */
        useChatApp.setState({ pinLocked: false, pinSetupMode: false });
      }
      setSettingNew(false);
      setNewPin("");
    } else {
      toast.error("PIN must be at least 4 digits");
    }
  }

  return (
    <div className="fixed inset-0 z-400 flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-xs text-center">
        <div className="bg-muted mx-auto mb-5 flex size-16 items-center justify-center rounded-2xl">
          <LockKeyhole className="text-muted-foreground size-8" />
        </div>
        <h1 className="mb-1 text-xl font-semibold">ChatBD is locked</h1>
        <p className="text-muted-foreground mb-6 text-sm">Enter your PIN to unlock the app</p>

        {settingNew ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2 text-left">
              <Label htmlFor="new-pin">New PIN (min 4 digits)</Label>
              <Input
                id="new-pin"
                type="password"
                inputMode="numeric"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveNewPin();
                }}
                autoFocus
              />
            </div>
            <Button onClick={saveNewPin}>Save PIN</Button>
            {!pinSetupMode && (
              <Button variant="ghost" onClick={() => setSettingNew(false)}>
                Back to unlock
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2 text-left">
              <Label htmlFor="pin">PIN</Label>
              <Input
                id="pin"
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") unlock();
                }}
                autoFocus
              />
            </div>
            <Button onClick={unlock}>
              <Lock /> Unlock
            </Button>
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setSettingNew(true)}>
              Change PIN
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
