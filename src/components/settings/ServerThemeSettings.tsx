"use client";

import { useGT } from "gt-next";
import { RotateCcw } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import {
  clampAccentForContrast,
  normalizeHexColor,
  parseThemeGradientKey,
  themeGradientKey,
} from "@/lib/appearance/customization";
import { SettingsCard, SettingsRow, SettingsSection } from "@/components/settings/SettingsSection";
import { GradientThemePicker } from "@/components/settings/GradientThemePicker";
import type { SettingsDraftApi } from "@/hooks/useSettingsDraft";

const DEFAULT_ACCENT = "#8b5cf6";

/** Draft keys (saved by the dialog's bulk save as `theme.*`). */
export const SERVER_THEME_DRAFT_KEYS = {
  accent: "theme.accentColor",
  gradient: "theme.gradient",
} as const;

/**
 * Server Settings → Overview → Server Theme (CORD-50). Members who keep
 * "Use server themes" on see this accent and gradient while they're in the
 * server. Part of the settings draft: edits show the unsaved-changes bar and
 * save with everything else (MANAGE_GUILD, validated server-side). The
 * gradient lives in the draft as its string key (themeGradientKey) so dirty
 * tracking compares by value.
 */
export function ServerThemeSettings({
  draft,
  errors,
}: {
  draft: SettingsDraftApi;
  errors?: { accent?: string; gradient?: string };
}) {
  const gt = useGT();
  const { settings: themeSettings } = useTheme();
  const accentRaw = draft.draft[SERVER_THEME_DRAFT_KEYS.accent];
  const accent = typeof accentRaw === "string" ? accentRaw : "";
  const gradient = parseThemeGradientKey(draft.draft[SERVER_THEME_DRAFT_KEYS.gradient]);
  const shownAccent = normalizeHexColor(accent);
  const adjusted = shownAccent ? clampAccentForContrast(shownAccent) : null;

  const setAccent = (value: string) => draft.update(SERVER_THEME_DRAFT_KEYS.accent, value);

  return (
    <SettingsSection
      title={gt("Server Theme")}
      description={gt("Members see this gradient and accent colour while they're in this server, unless they turned off server themes.")}
    >
      <GradientThemePicker
        value={gradient}
        onChange={(next) => draft.update(SERVER_THEME_DRAFT_KEYS.gradient, themeGradientKey(next))}
        previewTheme={themeSettings.theme}
        previewAccent={adjusted}
        noneLabel={gt("None: members keep their own theme")}
        previewCaption={gt("How members see your server with your current theme. Gradients are darkened (or lightened) so text stays readable.")}
      />
      {errors?.gradient && <p className="text-xs text-[var(--app-danger)]">{errors.gradient}</p>}
      <SettingsCard>
        <SettingsRow
          label={gt("Accent colour")}
          description={
            errors?.accent ??
            (shownAccent && adjusted && adjusted !== shownAccent ? gt("This accent is adjusted slightly so text on it stays readable.") : undefined)
          }
          control={
            <div className="flex items-center gap-2">
              {accent && (
                <button
                  type="button"
                  onClick={() => setAccent("")}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                  title={gt("Reset")}
                  aria-label={gt("Reset")}
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
              )}
              <label
                className="relative h-9 w-12 cursor-pointer overflow-hidden rounded-md border border-[var(--border-subtle)]"
                style={{ backgroundColor: shownAccent ?? "transparent" }}
              >
                <input
                  type="color"
                  aria-label={gt("Accent colour")}
                  value={shownAccent ?? DEFAULT_ACCENT}
                  onChange={(e) => setAccent(e.target.value)}
                  className="absolute inset-[-10px] h-[200%] w-[200%] cursor-pointer opacity-0"
                />
              </label>
            </div>
          }
        />
      </SettingsCard>
    </SettingsSection>
  );
}
