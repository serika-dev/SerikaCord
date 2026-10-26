"use client";

// User settings > Streamer Mode (Discord-style). Per device: stored in
// localStorage by src/hooks/useStreamerMode.ts.
import { useGT } from "gt-next";
import { Radio } from "lucide-react";
import { SettingsCard, SettingsSection, SettingsToggleRow } from "@/components/settings/SettingsSection";
import { isDesktopShell } from "@/lib/desktop/bridge";
import { setStreamerPrefs, useStreamerMode } from "@/hooks/useStreamerMode";
import type { StreamerModePrefs } from "@/lib/streamer/streamerMode";

export function StreamerModeSettings() {
  const gt = useGT();
  const { prefs, active, detected } = useStreamerMode();
  const set = (key: keyof StreamerModePrefs) => (v: boolean) => setStreamerPrefs({ [key]: v });

  return (
    <div className="space-y-8">
      <p className="text-[13px] leading-snug text-[var(--text-secondary)]">
        {gt("Streamer Mode hides personal information while you stream or share your screen. It only applies to this device.")}
      </p>
      {active && (
        <div role="status" className="flex items-center gap-3 rounded-xl border border-[color-mix(in_srgb,var(--app-accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)] px-4 py-3 text-sm text-[var(--text-primary)]">
          <Radio className="h-4 w-4 shrink-0 text-[var(--app-accent)]" aria-hidden />
          {detected && !prefs.enabled
            ? gt("Streamer Mode is on because streaming software is running.")
            : gt("Streamer Mode is on.")}
        </div>
      )}
      <SettingsCard>
        <SettingsToggleRow
          label={gt("Enable Streamer Mode")}
          description={gt("Turn Streamer Mode on now.")}
          checked={prefs.enabled}
          onCheckedChange={set("enabled")}
        />
        {isDesktopShell() && (
          <SettingsToggleRow
            label={gt("Automatically enable")}
            description={gt("Turn on Streamer Mode while OBS, Streamlabs or XSplit is running.")}
            checked={prefs.autoEnable}
            onCheckedChange={set("autoEnable")}
          />
        )}
      </SettingsCard>
      <SettingsSection title={gt("Options")}>
        <SettingsCard>
          <SettingsToggleRow
            label={gt("Hide personal information")}
            description={gt("Hides your email address and connected accounts.")}
            checked={prefs.hidePersonalInfo}
            onCheckedChange={set("hidePersonalInfo")}
          />
          <SettingsToggleRow
            label={gt("Hide invite links")}
            description={gt("Hides invite codes so viewers can't join from your screen.")}
            checked={prefs.hideInviteLinks}
            onCheckedChange={set("hideInviteLinks")}
          />
          <SettingsToggleRow
            label={gt("Hide message previews")}
            description={gt("Notifications and the direct message list don't show what people wrote.")}
            checked={prefs.hideNotificationContent}
            onCheckedChange={set("hideNotificationContent")}
          />
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}
