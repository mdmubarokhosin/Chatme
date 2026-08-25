"use client";

/** Premium modal — ports Chatme's premium modal (price, description, perks). */
import { Check, Crown, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useChatApp } from "../_lib/store";

export function PremiumModal() {
  const open = useChatApp((s) => s.premiumModalOpen);
  const settings = useChatApp((s) => s.settings);
  const me = useChatApp((s) => s.me);

  if (!open || !me) return null;

  const premium = settings.premium || {};
  const perks = [
    "Premium crown badge on your profile",
    `Send files up to ${premium.maxFileSize || 10}MB`,
    "Priority support from the ChatBD team",
    "Early access to new features",
  ];

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/50 p-4" onClick={() => useChatApp.setState({ premiumModalOpen: false })}>
      <div className="w-full max-w-sm overflow-hidden rounded-xl border bg-background" onClick={(e) => e.stopPropagation()}>
        <div className="from-primary/15 to-primary/5 relative bg-gradient-to-b p-6 text-center">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close"
            className="absolute top-2 right-2"
            onClick={() => useChatApp.setState({ premiumModalOpen: false })}
          >
            <X />
          </Button>
          <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-full bg-amber-500/15">
            <Crown className="size-7 text-amber-500" />
          </div>
          <h2 className="text-xl font-semibold">ChatBD Premium</h2>
          <div className="mt-2 text-3xl font-bold">
            {premium.price || "Free"}
            <span className="text-muted-foreground text-sm font-normal">/month</span>
          </div>
          <Badge variant="secondary" className="mt-2">
            {me.isPremium ? "You are a premium member" : "Upgrade your experience"}
          </Badge>
        </div>

        <div className="p-5">
          <p className="text-muted-foreground mb-4 text-sm leading-relaxed">
            {premium.description || "Ask the administrator to activate premium."}
          </p>
          <Separator className="mb-4" />
          <div className="flex flex-col gap-2.5">
            {perks.map((perk) => (
              <div key={perk} className="flex items-center gap-2 text-sm">
                <Check className="size-4 shrink-0 text-green-600" />
                {perk}
              </div>
            ))}
          </div>
          <Button className="mt-5 w-full" variant="outline" onClick={() => useChatApp.setState({ premiumModalOpen: false })}>
            {me.isPremium ? "Enjoy your premium" : "Contact admin to activate"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Premium banner shown above the conversation list (Chatme feature). */
export function PremiumBanner() {
  const settings = useChatApp((s) => s.settings);
  const me = useChatApp((s) => s.me);

  if (!settings.premium?.enabled || !me || me.isPremium) return null;

  return (
    <button
      type="button"
      className="from-primary/10 to-primary/5 border-primary/25 hover:border-primary/50 mx-2 mb-1 flex w-auto items-center gap-3 rounded-lg border bg-gradient-to-r px-3 py-2.5 text-left transition-colors"
      onClick={() => useChatApp.setState({ premiumModalOpen: true })}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-500/15">
        <Crown className="size-4.5 text-amber-500" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">ChatBD Premium</span>
        <span className="text-muted-foreground block truncate text-xs">
          {settings.premium.price ? `${settings.premium.price}/month · ` : ""}
          {settings.premium.description || "Upgrade for premium perks"}
        </span>
      </span>
      <span className="text-primary shrink-0 text-xs font-semibold">Upgrade</span>
    </button>
  );
}
