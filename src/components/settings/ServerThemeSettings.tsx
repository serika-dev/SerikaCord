"use client";

import { useState } from "react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { clampAccentForContrast, normalizeHexColor, type ServerTheme } from "@/lib/appearance/customization";
import { SettingsCard, SettingsRow, SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsButton } from "@/components/settings/blocks/SettingsButton";

const DEFAULT_ACCENT = "#8b5cf6";
const DEFAULT_TINT = "#2eb5cb";

/**
 * Server Settings → Overview → Server Theme (CORD-50). Members who keep
 * "Use server themes" on see this accent and background tint while they're in
 * the server. Saved to servers.settings.theme (MANAGE_GUILD, validated
 * server-side).
 */
export function ServerThemeSettings({
  serverId,
  theme,
  onSaved,
}: {
  serverId: string;
  theme: ServerTheme | null | undefined;
  onSaved: () => void | Promise<void>;
}) {
  const gt = useGT();
  const [accent, setAccent] = useState<string>(theme?.accentColor ?? "");
  const [tint, setTint] = useState<string>(theme?.backgroundTint ?? "");
  const [saving, setSaving] = useState(false);

  const dirty = accent !== (theme?.accentColor ?? "") || tint !== (theme?.backgroundTint ?? "");
  const shownAccent = normalizeHexColor(accent);
  const adjusted = shownAccent ? clampAccentForContrast(shownAccent) : null;

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/servers/${serverId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { theme: accent || tint ? { accentColor: accent || null, backgroundTint: tint || null } : null } }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.fieldErrors?.theme || data?.error || gt("Failed to save server theme"));
        return;
      }
      toast.success(gt("Server theme saved"));
      await onSaved();
    } catch {
      toast.error(gt("Failed to save server theme"));
    } finally {
      setSaving(false);
    }
  };

  const swatch = (value: string, fallback: string, onChange: (v: string) => void, label: string) => (
    <div className="flex items-center gap-2">
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          title={gt("Reset")}
          aria-label={gt("Reset")}
        >
          <RotateCcw className="h-4 w-4" />
        </button>
      )}
      <label
        className="relative h-9 w-12 cursor-pointer overflow-hidden rounded-md border border-[var(--border-subtle)]"
        style={{ backgroundColor: normalizeHexColor(value) ?? "transparent" }}
      >
        <input
          type="color"
          aria-label={label}
          value={normalizeHexColor(value) ?? fallback}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-[-10px] h-[200%] w-[200%] cursor-pointer opacity-0"
        />
      </label>
    </div>
  );

  return (
    <SettingsSection
      title={gt("Server Theme")}
      description={gt("Members see this accent colour and background tint while they're in this server, unless they turned off server themes.")}
      action={
        <SettingsButton size="sm" variant="primary" disabled={!dirty || saving} onClick={() => void save()}>
          {gt("Save theme")}
        </SettingsButton>
      }
    >
      <SettingsCard>
        <SettingsRow
          label={gt("Accent colour")}
          description={shownAccent && adjusted && adjusted !== shownAccent ? gt("This accent is adjusted slightly so text on it stays readable.") : undefined}
          control={swatch(accent, DEFAULT_ACCENT, setAccent, gt("Accent colour"))}
        />
        <SettingsRow label={gt("Background tint")} control={swatch(tint, DEFAULT_TINT, setTint, gt("Background tint"))} />
      </SettingsCard>
    </SettingsSection>
  );
}
