"use client";

import { memo } from "react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { Clock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SettingsCard, SettingsPageHeader, SettingsRow, SettingsSection, SettingsToggleRow } from "@/components/settings/SettingsSection";
import { SettingsSkeleton } from "@/components/settings/blocks/SettingsSkeleton";
import { SettingsStatusPill } from "@/components/settings/blocks/SettingsStatusPill";
import { requestNotificationPermission } from "@/lib/services/notificationService";
import { cn } from "@/lib/utils";
import type { SaveSettingsPatch, SaveSettingsPatchDebounced, UserSettingsValue } from "@/components/settings/user/types";

const SOUND_TYPES = ["chime", "ding", "pop", "coin", "none"] as const;

/** Discord's Notifications page: DND / focus, desktop + push, sounds, toasts. */
export const NotificationsPage = memo(function NotificationsPage({
  userSettings,
  saveSettingsPatch,
  saveSettingsPatchDebounced,
}: {
  userSettings: UserSettingsValue;
  saveSettingsPatch: SaveSettingsPatch;
  saveSettingsPatchDebounced: SaveSettingsPatchDebounced;
}) {
  const gt = useGT();
  const n = userSettings?.notifications || {};
  const save = (patch: Record<string, unknown>) => saveSettingsPatch({ notifications: { ...n, ...patch } }, "notifications");
  const soundLabel = (value: (typeof SOUND_TYPES)[number]) => {
    switch (value) {
      case "chime": return gt("Chime");
      case "ding": return gt("Ding");
      case "pop": return gt("Pop");
      case "coin": return gt("Coin");
      default: return gt("Silent");
    }
  };

  return (
    <div className="space-y-10">
      <SettingsPageHeader title={gt("Notifications")} description={gt("Choose what reaches you, and how.")} />

      {!userSettings ? (
        <SettingsSkeleton variant="rows" count={6} />
      ) : (
        <>
          <SettingsSection title={gt("Do Not Disturb")}>
            <SettingsCard>
              <SettingsToggleRow
                label={gt("Enable Do Not Disturb")}
                description={gt("Suppresses all sounds, desktop notifications, and toasts")}
                checked={Boolean(n.dnd)}
                onCheckedChange={(checked) => save({ dnd: checked })}
              />
              {n.dnd && (
                <SettingsToggleRow
                  icon={Clock}
                  label={gt("Scheduled Quiet Hours")}
                  checked={Boolean(n.dndSchedule?.enabled)}
                  onCheckedChange={(checked) => save({ dndSchedule: { ...(n.dndSchedule || { start: "22:00", end: "08:00" }), enabled: checked } })}
                >
                  {n.dndSchedule?.enabled && (
                    <div className="flex items-center gap-3 pl-11 max-sm:pl-0">
                      <label className="flex-1 space-y-1">
                        <span className="text-xs font-bold uppercase tracking-[0.04em] text-[var(--text-secondary)]">{gt("Start")}</span>
                        <Input
                          type="time"
                          value={n.dndSchedule?.start || "22:00"}
                          onChange={(e) => save({ dndSchedule: { ...(n.dndSchedule || { enabled: true, end: "08:00" }), start: e.target.value } })}
                          className="h-9 border-[var(--border-subtle)] bg-[var(--bg-input)]"
                        />
                      </label>
                      <label className="flex-1 space-y-1">
                        <span className="text-xs font-bold uppercase tracking-[0.04em] text-[var(--text-secondary)]">{gt("End")}</span>
                        <Input
                          type="time"
                          value={n.dndSchedule?.end || "08:00"}
                          onChange={(e) => save({ dndSchedule: { ...(n.dndSchedule || { enabled: true, start: "22:00" }), end: e.target.value } })}
                          className="h-9 border-[var(--border-subtle)] bg-[var(--bg-input)]"
                        />
                      </label>
                    </div>
                  )}
                </SettingsToggleRow>
              )}
            </SettingsCard>
          </SettingsSection>

          <SettingsSection title={gt("Focus Mode")}>
            <SettingsCard>
              <SettingsToggleRow
                label={gt("Enable Focus Mode")}
                description={gt("Suppress everything except direct @mentions and DMs")}
                checked={Boolean(n.focusMode)}
                onCheckedChange={(checked) => save({ focusMode: checked })}
              />
            </SettingsCard>
          </SettingsSection>

          <SettingsSection title={gt("Desktop Notifications")}>
            <SettingsCard>
              <SettingsToggleRow
                label={gt("Enable Desktop & Push Notifications")}
                description={gt("Receive native notifications on desktop, mobile and browser")}
                checked={Boolean(n.desktop)}
                onCheckedChange={async (checked) => {
                  if (checked) {
                    const granted = await requestNotificationPermission();
                    if (!granted) {
                      toast.error(gt("Notification permission denied. Please enable it in your browser/OS settings."));
                      return;
                    }
                  }
                  save({ desktop: checked });
                }}
              >
                {n.desktop && typeof Notification !== "undefined" && Notification.permission !== "granted" && (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                    <p className="text-[13px] text-amber-700 dark:text-amber-400">{gt("Browser permission not granted yet.")}</p>
                    <button
                      type="button"
                      onClick={async () => {
                        const granted = await requestNotificationPermission();
                        if (granted) toast.success(gt("Notifications enabled!"));
                        else toast.error(gt("Permission denied. Check browser settings."));
                      }}
                      className="shrink-0 text-[13px] font-semibold text-amber-700 underline dark:text-amber-300"
                    >
                      {gt("Grant Permission")}
                    </button>
                  </div>
                )}
              </SettingsToggleRow>
              <SettingsToggleRow
                label={
                  <span className="inline-flex items-center gap-1.5">
                    {gt("Mentions only")} <SettingsStatusPill tone="accent">{gt("Default")}</SettingsStatusPill>
                  </span>
                }
                description={
                  <>
                    {gt("Only send desktop notifications when you are mentioned. Turn off to notify on all messages.")}
                    <span className="mt-0.5 block text-xs text-[var(--text-muted)]">{gt("Each server, category, channel and DM can override this: right-click it and pick Notification Settings.")}</span>
                  </>
                }
                checked={n.notifyAllMessages !== true}
                onCheckedChange={(checked) => save({ notifyAllMessages: !checked })}
              />
              <SettingsToggleRow
                label={gt("Mute @everyone and @here")}
                description={gt("Suppress popup notifications for @everyone and @here pings")}
                checked={Boolean(n.muteEveryone)}
                onCheckedChange={(checked) => save({ muteEveryone: checked })}
              />
              <SettingsToggleRow
                label={gt("Show message preview")}
                description={gt("Display message content in desktop notifications")}
                checked={n.showPreview !== false}
                onCheckedChange={(checked) => save({ showPreview: checked })}
              />
            </SettingsCard>
          </SettingsSection>

          <SettingsSection title={gt("Sound")}>
            <SettingsCard>
              <SettingsToggleRow
                label={gt("Message Sounds")}
                description={gt("Play a sound when a new message arrives")}
                checked={Boolean(n.sounds)}
                onCheckedChange={(checked) => save({ sounds: checked })}
              />
              <SettingsToggleRow
                label={gt("Incoming call ringtone")}
                description={gt("Ring when someone calls you, even with message sounds off. Do Not Disturb still silences it.")}
                checked={n.callRingtone !== false}
                onCheckedChange={(checked) => save({ callRingtone: checked })}
              />
              {n.sounds && (
                <>
                  <SettingsRow label={gt("Sound type")} stackOnMobile>
                    <div role="radiogroup" aria-label={gt("Sound type")} className="inline-flex max-w-full flex-wrap gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-1">
                      {SOUND_TYPES.map((value) => {
                        const selected = (n.soundType || "chime") === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            onClick={() => save({ soundType: value })}
                            className={cn(
                              "h-7 rounded-md px-3 text-xs font-semibold transition-colors duration-(--motion-fast)",
                              selected
                                ? "bg-[var(--app-accent)] text-white shadow-sm"
                                : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
                            )}
                          >
                            {soundLabel(value)}
                          </button>
                        );
                      })}
                    </div>
                  </SettingsRow>
                  <SettingsRow
                    label={gt("Volume")}
                    control={<span className="text-xs tabular-nums text-[var(--text-muted)]">{n.soundVolume ?? 50}%</span>}
                  >
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={n.soundVolume ?? 50}
                      onChange={(e) => saveSettingsPatchDebounced({ notifications: { soundVolume: Number(e.target.value) } }, "notifications")}
                      aria-label={gt("Volume")}
                      className="w-full cursor-pointer accent-[var(--app-accent)]"
                    />
                  </SettingsRow>
                  <SettingsToggleRow
                    label={gt("Suppress sound when tab is focused")}
                    description={gt("Don't play notification sound when you're already viewing the app")}
                    checked={n.suppressSoundWhenFocused !== false}
                    onCheckedChange={(checked) => save({ suppressSoundWhenFocused: checked })}
                  />
                </>
              )}
            </SettingsCard>
          </SettingsSection>

          <SettingsSection title={gt("In-App Toasts")}>
            <SettingsCard>
              <SettingsToggleRow
                label={gt("Suppress in-app toast notifications")}
                description={gt("Hide the toast popups that appear in-app for new messages")}
                checked={Boolean(n.suppressToasts)}
                onCheckedChange={(checked) => save({ suppressToasts: checked })}
              />
            </SettingsCard>
          </SettingsSection>
        </>
      )}
    </div>
  );
});
