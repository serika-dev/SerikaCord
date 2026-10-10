"use client";

import { useEffect, useState } from "react";
import { Smile, X } from "lucide-react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { CustomEmojiPicker } from "@/components/chat/CustomEmojiPicker";
import { StatusEmoji } from "@/components/user/CustomStatus";
import { useAuth } from "@/contexts/AuthContext";
import {
  activeCustomStatus,
  clearAfterToExpiry,
  guessClearAfter,
  type ClearAfterChoice,
  type CustomStatusEmoji,
} from "@/lib/social/customStatus";
import { toClientStatus, type ClientStatus } from "@/lib/presenceChoice";
import { statusLabelInvisible } from "@/lib/statusLabels";

interface PickerEmoji {
  id: string;
  name: string;
  url: string;
  animated?: boolean;
}

/**
 * Discord's "Set a custom status" modal: emoji + text, "Clear after"
 * (Today / 4 hours / 1 hour / 30 minutes / Don't clear) and the online status.
 */
export function CustomStatusDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const gt = useGT();
  const { user, updateUser, setOnlineStatus } = useAuth();
  const current = activeCustomStatus(user?.customStatus, user?.customization);
  const [text, setText] = useState(current.text ?? "");
  const [emoji, setEmoji] = useState<CustomStatusEmoji | null>(current.emoji);
  const [clearAfter, setClearAfter] = useState<ClearAfterChoice>(() => (current.text || current.emoji ? guessClearAfter(current.expiresAt, Date.now()) : "today"));
  const [presence, setPresence] = useState<ClientStatus>(toClientStatus(user?.status));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverEmojis, setServerEmojis] = useState<PickerEmoji[]>([]);

  useEffect(() => {
    if (!pickerOpen || serverEmojis.length > 0) return;
    let active = true;
    fetch("/api/users/@me/emojis")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (active && data) setServerEmojis(data.emojis || []); })
      .catch(() => {});
    return () => { active = false; };
  }, [pickerOpen, serverEmojis.length]);

  const clearOptions: Array<{ value: ClearAfterChoice; label: string }> = [
    { value: "today", label: gt("Today") },
    { value: "4h", label: gt("4 hours") },
    { value: "1h", label: gt("1 hour") },
    { value: "30m", label: gt("30 minutes") },
    { value: "never", label: gt("Don't clear") },
  ];
  const presenceOptions: ClientStatus[] = ["online", "idle", "dnd", "offline"];

  const save = async () => {
    if (!user) return;
    setSaving(true);
    const trimmed = text.trim();
    const empty = !trimmed && !emoji;
    const expiresAt = empty ? null : clearAfterToExpiry(clearAfter, Date.now(), new Date().getTimezoneOffset());
    try {
      const res = await fetch("/api/users/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customStatus: trimmed || null,
          customStatusEmoji: emoji,
          customStatusExpiresAt: expiresAt,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || gt("Failed to update custom status"));
        return;
      }
      if (data?.user) {
        updateUser({ customStatus: data.user.customStatus ?? undefined, customization: data.user.customization });
      }
      if (presence !== toClientStatus(user.status)) await setOnlineStatus(presence);
      onOpenChange(false);
    } catch {
      toast.error(gt("Failed to update custom status"));
    } finally {
      setSaving(false);
    }
  };

  const name = user?.displayName || user?.username || "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-primary)] sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="text-center">{gt("Set a custom status")}</DialogTitle>
          <DialogDescription className="sr-only">{gt("Choose an emoji, a message and when it clears.")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)] mb-2" htmlFor="custom-status-text">
              {gt("What's cookin', {name}?", { name })}
            </label>
            <div className="flex items-center gap-2 rounded-md bg-[var(--bg-app)] border border-[var(--border-subtle)] px-2 focus-within:border-[var(--app-accent)]">
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="shrink-0 p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"
                    aria-label={gt("Choose an emoji")}
                  >
                    {emoji ? <StatusEmoji emoji={emoji} className="w-5 h-5 text-lg" /> : <Smile className="w-5 h-5" />}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-[440px] max-w-[calc(100vw-1rem)] p-0 border-none" side="bottom" align="start">
                  <CustomEmojiPicker
                    initialTab="emoji"
                    availableServerEmojis={serverEmojis}
                    allowServerEmojisInDMs
                    onEmojiSelect={(value, isCustom, data) => {
                      setEmoji(isCustom && data ? { name: data.name, id: data.id, url: data.url, animated: Boolean(data.animated) } : { name: value });
                      setPickerOpen(false);
                    }}
                  />
                </PopoverContent>
              </Popover>
              <input
                id="custom-status-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
                maxLength={128}
                autoFocus
                placeholder={gt("Support has arrived!")}
                className="flex-1 min-w-0 bg-transparent py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
              />
              {(text || emoji) && (
                <button
                  type="button"
                  onClick={() => { setText(""); setEmoji(null); }}
                  className="shrink-0 p-1 rounded-full text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  aria-label={gt("Clear")}
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)] mb-2">{gt("Clear after")}</div>
            <Select value={clearAfter} onValueChange={(v) => setClearAfter(v as ClearAfterChoice)}>
              <SelectTrigger className="w-full bg-[var(--bg-app)] border-[var(--border-subtle)]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {clearOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="pt-4 border-t border-[var(--border-subtle)]">
            <div className="text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)] mb-2">{gt("Status")}</div>
            <Select value={presence} onValueChange={(v) => setPresence(v as ClientStatus)}>
              <SelectTrigger className="w-full bg-[var(--bg-app)] border-[var(--border-subtle)]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {presenceOptions.map((p) => (
                  <SelectItem key={p} value={p}>{statusLabelInvisible(p, gt)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            {gt("Cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {gt("Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

