"use client";

// User settings > Streamer Mode (Discord-style). Per device: stored in
// localStorage by src/hooks/useStreamerMode.ts.
import { useGT } from "gt-next";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { isDesktopShell } from "@/lib/desktop/bridge";
import { setStreamerPrefs, useStreamerMode } from "@/hooks/useStreamerMode";
import type { StreamerModePrefs } from "@/lib/streamer/streamerMode";

function Row({
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-4 py-3 border-b border-[var(--border-subtle)] last:border-b-0">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-[var(--text-primary)]">{title}</span>
        <span className="block text-xs text-[var(--text-muted)] mt-0.5">{description}</span>
      </span>
      <ToggleSwitch size="sm" checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={title} />
    </label>
  );
}

export function StreamerModeSettings() {
  const gt = useGT();
  const { prefs, active, detected } = useStreamerMode();
  const set = (key: keyof StreamerModePrefs) => (v: boolean) => setStreamerPrefs({ [key]: v });

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--text-secondary)]">
        {gt("Streamer Mode hides personal information while you stream or share your screen. It only applies to this device.")}
      </p>
      {active && (
        <div className="rounded-lg border border-[var(--app-accent)] bg-[var(--bg-card)] px-4 py-3 text-sm text-[var(--text-primary)]">
          {detected && !prefs.enabled
            ? gt("Streamer Mode is on because streaming software is running.")
            : gt("Streamer Mode is on.")}
        </div>
      )}
      <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg px-4">
        <Row
          title={gt("Enable Streamer Mode")}
          description={gt("Turn Streamer Mode on now.")}
          checked={prefs.enabled}
          onChange={set("enabled")}
        />
        {isDesktopShell() && (
          <Row
            title={gt("Automatically enable")}
            description={gt("Turn on Streamer Mode while OBS, Streamlabs or XSplit is running.")}
            checked={prefs.autoEnable}
            onChange={set("autoEnable")}
          />
        )}
      </div>
      <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg px-4">
        <Row
          title={gt("Hide personal information")}
          description={gt("Hides your email address and connected accounts.")}
          checked={prefs.hidePersonalInfo}
          onChange={set("hidePersonalInfo")}
        />
        <Row
          title={gt("Hide invite links")}
          description={gt("Hides invite codes so viewers can't join from your screen.")}
          checked={prefs.hideInviteLinks}
          onChange={set("hideInviteLinks")}
        />
        <Row
          title={gt("Hide message previews")}
          description={gt("Notifications and the direct message list don't show what people wrote.")}
          checked={prefs.hideNotificationContent}
          onChange={set("hideNotificationContent")}
        />
      </div>
    </div>
  );
}
