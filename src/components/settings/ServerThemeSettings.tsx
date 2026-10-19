"use client";

import { useState } from "react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { clampAccentForContrast, normalizeHexColor, type ServerTheme } from "@/lib/appearance/customization";

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
      <label className="relative w-9 h-9 rounded-md overflow-hidden cursor-pointer border border-[var(--border-subtle)]" style={{ backgroundColor: normalizeHexColor(value) ?? "transparent" }}>
        <input
          type="color"
          aria-label={label}
          value={normalizeHexColor(value) ?? fallback}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-[-10px] w-[200%] h-[200%] cursor-pointer opacity-0"
        />
      </label>
      <span className="text-sm text-[var(--text-primary)]">{label}</span>
      {value && (
        <button type="button" onClick={() => onChange("")} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]" title={gt("Reset")}>
          <RotateCcw className="w-4 h-4" />
        </button>
      )}
    </div>
  );

  return (
    <div className="pt-6 border-t border-[var(--border-subtle)] space-y-3">
      <div>
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">{gt("Server Theme")}</h3>
        <p className="text-sm text-[var(--text-secondary)]">
          {gt("Members see this accent colour and background tint while they're in this server, unless they turned off server themes.")}
        </p>
      </div>
      <div className="flex flex-wrap gap-6">
        {swatch(accent, DEFAULT_ACCENT, setAccent, gt("Accent colour"))}
        {swatch(tint, DEFAULT_TINT, setTint, gt("Background tint"))}
      </div>
      {shownAccent && adjusted && adjusted !== shownAccent && (
        <p className="text-xs text-[var(--text-muted)]">{gt("This accent is adjusted slightly so text on it stays readable.")}</p>
      )}
      <button
        type="button"
        disabled={!dirty || saving}
        onClick={() => void save()}
        className="h-9 px-4 rounded-md bg-[var(--app-accent)] text-[var(--text-on-accent)] text-sm font-semibold disabled:opacity-50"
      >
        {gt("Save theme")}
      </button>
    </div>
  );
}
