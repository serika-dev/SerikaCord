"use client";

import { useState } from "react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * First-message consent prompt for the Discord bridge. Shown the first time a
 * user sends a message in a channel that mirrors to Discord. Their choice is
 * persisted to settings.dataPrivacy so we never ask again and the backend
 * (replicateToDiscord) only forwards their messages once they've agreed.
 */
export function DiscordBridgeConsentDialog({ open, onOpenChange }: Props) {
  const gt = useGT();
  const { user, updateUser } = useAuth();
  const [saving, setSaving] = useState(false);

  const decide = async (agreed: boolean) => {
    setSaving(true);
    const patch = {
      dataPrivacy: {
        ...(user?.settings?.dataPrivacy || {}),
        discordBridgeOutbound: agreed,
        discordBridgePrompted: true,
      },
    };
    try {
      const res = await fetch("/api/users/me/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ settings: patch }),
      });
      if (!res.ok) throw new Error("save failed");
      // Reflect immediately in client state so we don't re-prompt this session.
      updateUser({
        settings: {
          ...(user?.settings || {}),
          dataPrivacy: { ...(user?.settings?.dataPrivacy || {}), discordBridgeOutbound: agreed, discordBridgePrompted: true },
        },
      });
      toast.success(agreed ? gt("Your messages will now sync to Discord") : gt("Your messages will not be sent to Discord"));
    } catch {
      toast.error(gt("Failed to save your choice"));
    } finally {
      setSaving(false);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{gt("This channel is bridged to Discord")}</DialogTitle>
          <DialogDescription>
            {gt("Messages you send here can be mirrored to a linked Discord server. To sync your messages, we need your consent to process them (your username, avatar, and message content) via Discord. You can change this anytime in Settings → Data & Privacy.")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <button
            onClick={() => decide(false)}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-white/[0.06] hover:bg-white/[0.12] text-[var(--text-secondary)] disabled:opacity-60 transition-colors"
          >
            {gt("Don't sync my messages")}
          </button>
          <button
            onClick={() => decide(true)}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#5865F2] hover:bg-[#4752c4] text-white disabled:opacity-60 transition-colors"
          >
            {gt("I agree")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
