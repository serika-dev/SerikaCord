"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useGT } from "gt-next";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Loader } from "@/components/ui/Loader";
import { SettingsButton } from "@/components/settings/blocks/SettingsButton";
import type { ChannelSettingsKind } from "@/lib/servers/channelSettings";

/**
 * "Delete Channel" confirmation: the channel name has to be typed before
 * the red button unlocks (a category keeps its channels).
 */
export function DeleteChannelDialog({
  open,
  onOpenChange,
  kind,
  name,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: ChannelSettingsKind;
  /** Display name (decoded). */
  name: string;
  /** Resolves when deleted; rejects to keep the dialog open. */
  onConfirm: () => Promise<void>;
}) {
  const gt = useGT();
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const matches = typed.trim() === name.trim();
  const isCategory = kind === "category";
  const isThread = kind === "thread";

  const close = (next: boolean) => {
    if (deleting) return;
    if (!next) setTyped("");
    onOpenChange(next);
  };

  const confirm = async () => {
    if (!matches || deleting) return;
    setDeleting(true);
    try {
      await onConfirm();
      setTyped("");
    } catch {
      // The caller already explained what went wrong.
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent showCloseButton={false} className="max-w-md gap-0 overflow-hidden border border-[var(--border-subtle)] bg-[var(--bg-card)] p-0 text-[var(--text-primary)]">
        <div className="space-y-4 p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-500/12 text-red-500">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-lg font-semibold leading-tight">
                {isCategory ? gt("Delete Category") : isThread ? gt("Delete Thread") : gt("Delete Channel")}
              </DialogTitle>
              <DialogDescription className="mt-1 text-sm leading-snug text-[var(--text-secondary)]">
                {isCategory
                  ? gt("Are you sure you want to delete {name}? This can't be undone. The channels in it are kept.", { name })
                  : gt("Are you sure you want to delete {name}? This can't be undone. All of its messages will be lost.", { name })}
              </DialogDescription>
            </div>
          </div>
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-[var(--text-secondary)]">{gt("Type {name} to confirm", { name })}</span>
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void confirm();
                }
              }}
              placeholder={name}
              aria-label={gt("Type {name} to confirm", { name })}
              className="h-10 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-red-500 focus:ring-2 focus:ring-red-500/25 max-md:text-base"
            />
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--border-subtle)] bg-[var(--bg-app)] px-5 py-3">
          <SettingsButton variant="ghost" onClick={() => close(false)} disabled={deleting}>
            {gt("Cancel")}
          </SettingsButton>
          <SettingsButton variant="dangerFilled" onClick={() => void confirm()} disabled={!matches || deleting}>
            {deleting && <Loader size={14} />}
            {isCategory ? gt("Delete Category") : isThread ? gt("Delete Thread") : gt("Delete Channel")}
          </SettingsButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}
