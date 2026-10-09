"use client";

/**
 * Per-server / per-channel (category, DM) notification settings: level
 * (All messages / Only @mentions / Nothing), mute for a while, and for servers
 * @everyone / role-mention suppression. Stored server-side, synced across devices.
 */

import { useMemo } from "react";
import { useGT } from "gt-next";
import { Bell, BellOff } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { useAuth } from "@/contexts/AuthContext";
import {
  isMuteActive,
  muteUntilFor,
  resolveNotification,
  type NotificationLevel,
} from "@/lib/notifications/levels";
import { updateNotificationOverride, useNotificationPrefs } from "@/lib/notifications/prefsStore";
import type { NotificationSettingsTarget } from "@/lib/notifications/events";
import { cn } from "@/lib/utils";
import { useMuteOptions, useMutedUntilLabel } from "./useMuteOptions";

export default function NotificationSettingsDialog({
  open,
  onOpenChange,
  target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: NotificationSettingsTarget | null;
}) {
  const gt = useGT();
  const { user } = useAuth();
  const prefs = useNotificationPrefs();
  const muteOptions = useMuteOptions();
  const mutedUntilLabel = useMutedUntilLabel();

  const scope = target?.scope ?? "server";
  const id = target?.id ?? "";
  const isServer = scope === "server";
  const isDM = target?.kind === "dm";
  const entry = isServer ? prefs.doc.servers[id] : prefs.doc.channels[id];
  // `prefs` changes when a timed mute runs out, so this stays current.
  const muted = isMuteActive(entry);

  // What this entry falls back to when it has no level of its own.
  const inherited = useMemo<NotificationLevel>(() => {
    if (!target) return "mentions";
    const globalAll = user?.settings?.notifications?.notifyAllMessages === true;
    if (target.scope === "server") {
      return globalAll ? "all" : prefs.serverDefaults[target.id] ?? "mentions";
    }
    const channels = { ...prefs.doc.channels };
    delete channels[target.id];
    return resolveNotification({
      doc: { servers: prefs.doc.servers, channels },
      serverId: target.serverId ?? null,
      channelId: target.id,
      ancestorIds: [target.parentId],
      serverDefault: target.serverId ? prefs.serverDefaults[target.serverId] : undefined,
      globalAllMessages: globalAll,
    }).level;
  }, [target, prefs, user?.settings?.notifications?.notifyAllMessages]);

  const levelLabels: Record<NotificationLevel, string> = {
    all: gt("All Messages"),
    mentions: gt("Only @mentions"),
    nothing: gt("Nothing"),
  };

  if (!target) return null;

  const patch = (p: Parameters<typeof updateNotificationOverride>[2]) => {
    void updateNotificationOverride(scope, id, p);
  };

  const levelChoices: Array<{ value: NotificationLevel | null; label: string; hint?: string }> = [
    {
      value: null,
      label: isServer ? gt("Server default") : gt("Use default"),
      hint: levelLabels[inherited],
    },
    { value: "all", label: levelLabels.all },
    { value: "mentions", label: levelLabels.mentions },
    { value: "nothing", label: levelLabels.nothing },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-primary)]">
        <DialogHeader>
          <DialogTitle>{gt("Notification Settings")}</DialogTitle>
          <DialogDescription className="truncate text-[var(--text-secondary)]">{target.name}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Mute */}
          <section className="space-y-2">
            {muted ? (
              <div className="flex items-center justify-between gap-3 rounded-md bg-[var(--bg-sidebar-elevated)] px-3 py-2">
                <span className="flex items-center gap-2 text-sm">
                  <BellOff className="h-4 w-4 text-red-400" />
                  {mutedUntilLabel(entry?.muteUntil)}
                </span>
                <button
                  onClick={() => patch({ muteUntil: null })}
                  className="rounded-md bg-[var(--app-accent)] px-3 py-1 text-xs font-semibold text-[var(--text-on-accent)] hover:opacity-90"
                >
                  {gt("Unmute")}
                </button>
              </div>
            ) : (
              <>
                <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">
                  <Bell className="h-3.5 w-3.5" />
                  {isServer ? gt("Mute server") : isDM ? gt("Mute conversation") : gt("Mute channel")}
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {muteOptions.map((o) => (
                    <button
                      key={o.key}
                      onClick={() => patch({ muteUntil: muteUntilFor(o.minutes) })}
                      className="rounded-md border border-[var(--border-subtle)] px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-[var(--text-muted)]">
                  {gt("Muting hides the unread glow and silences notifications. Mentions still show a badge.")}
                </p>
              </>
            )}
          </section>

          {/* Level */}
          {!isDM && (
            <section className={cn("space-y-1", muted && "opacity-60")}>
              <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">
                {isServer ? gt("Server notification settings") : gt("Notification level")}
              </h3>
              <div role="radiogroup" className="space-y-1">
                {levelChoices.map((c) => {
                  const selected = (entry?.level ?? null) === c.value;
                  return (
                    <button
                      key={c.value ?? "inherit"}
                      role="radio"
                      aria-checked={selected}
                      onClick={() => patch({ level: c.value })}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
                        selected ? "bg-[var(--bg-active)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2",
                          selected ? "border-[var(--app-accent)]" : "border-[var(--text-muted)]",
                        )}
                      >
                        {selected && <span className="h-2 w-2 rounded-full bg-[var(--app-accent)]" />}
                      </span>
                      <span className="flex-1">{c.label}</span>
                      {c.hint && <span className="text-xs text-[var(--text-muted)]">{c.hint}</span>}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* Suppression (servers) */}
          {isServer && (
            <section className="space-y-3">
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>{gt("Suppress @everyone and @here")}</span>
                <ToggleSwitch
                  checked={entry?.suppressEveryone === true}
                  onCheckedChange={(v) => patch({ suppressEveryone: v ? true : null })}
                  aria-label={gt("Suppress @everyone and @here")}
                />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>{gt("Suppress all role @mentions")}</span>
                <ToggleSwitch
                  checked={entry?.suppressRoles === true}
                  onCheckedChange={(v) => patch({ suppressRoles: v ? true : null })}
                  aria-label={gt("Suppress all role @mentions")}
                />
              </label>
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
