"use client";

import { memo } from "react";
import { useGT } from "gt-next";
import { Check } from "lucide-react";
import { AppearanceCustomizationPanel, AppThemeSection } from "@/components/settings/AppearanceCustomizationPanel";
import { readUserThemeGradient, type UserThemeGradient } from "@/lib/appearance/customization";
import { SettingsCard, SettingsPageHeader, SettingsSection, SettingsToggleRow } from "@/components/settings/SettingsSection";
import type { SettingsPatch } from "@/lib/settings/mergeSettings";
import { cn } from "@/lib/utils";
import type { UserSettingsValue } from "@/components/settings/user/types";

/** Theme previews: sidebar strip, channel list and chat colours of each theme. */
const THEMES = [
  { id: "dark", stripA: "#111111", stripB: "#0f0f0f", body: "#0a0a0a", line: "#2a2a2a" },
  { id: "midnight", stripA: "#0b1020", stripB: "#101728", body: "#050913", line: "#1d2740" },
  { id: "light", stripA: "#e5e5e5", stripB: "#f0f0f0", body: "#ffffff", line: "#d4d4d4" },
] as const;

const ACCENTS = ["#8B5CF6", "#6366F1", "#3B82F6", "#06B6D4", "#10B981", "#F59E0B", "#EF4444", "#EC4899"] as const;

export interface AppearanceThemeDefaults {
  theme?: string;
  accentColor?: string;
  fontSize?: number;
  saturation?: number;
  fontFamily: string;
  backgroundImage: string;
  backgroundDim: number;
  backgroundBlur: number;
  useServerThemes: boolean;
  themeGradient?: UserThemeGradient;
  compactMode?: boolean;
  showTimestamps?: boolean;
  showRoleColors?: boolean;
  enableAnimations?: boolean;
}

/**
 * Discord's Appearance page: theme tiles, accent colour, chat font scaling
 * with a live preview, saturation, font / background customisation and
 * message display toggles.
 */
export const AppearancePage = memo(function AppearancePage({
  userSettings,
  themeSettings,
  profileBanner,
  saveAppearancePatch,
}: {
  userSettings: UserSettingsValue;
  themeSettings: AppearanceThemeDefaults;
  profileBanner?: string | null;
  saveAppearancePatch: (patch: SettingsPatch, opts?: { debounce?: boolean }) => void;
}) {
  const gt = useGT();
  const ap = userSettings?.appearance || {};
  const currentTheme = ap.theme || ap.themeStyle || themeSettings.theme || "dark";
  const accent = (ap.accentColor || themeSettings.accentColor || "#8B5CF6").toLowerCase();
  const fontSize: number = ap.fontSize ?? themeSettings.fontSize ?? 14;
  const saturation: number = ap.saturation ?? themeSettings.saturation ?? 100;

  const themeLabel = (id: (typeof THEMES)[number]["id"]) => (id === "dark" ? gt("Dark") : id === "midnight" ? gt("Midnight") : gt("Light"));
  const accentLabel = (color: (typeof ACCENTS)[number]) => {
    switch (color) {
      case "#8B5CF6": return gt("Purple");
      case "#6366F1": return gt("Indigo");
      case "#3B82F6": return gt("Blue");
      case "#06B6D4": return gt("Cyan");
      case "#10B981": return gt("Emerald");
      case "#F59E0B": return gt("Amber");
      case "#EF4444": return gt("Red");
      default: return gt("Pink");
    }
  };

  return (
    <div className="space-y-10">
      <SettingsPageHeader title={gt("Appearance")} description={gt("Make SerikaCord look the way you like.")} />

      <SettingsSection title={gt("Theme")}>
        <div role="radiogroup" aria-label={gt("Theme")} className="grid grid-cols-3 gap-3">
          {THEMES.map((t) => {
            const selected = currentTheme === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => saveAppearancePatch({ theme: t.id })}
                className={cn(
                  "group rounded-xl border-2 bg-[var(--bg-app)] p-2 text-left transition-[border-color,transform] duration-(--motion-fast) active:scale-[0.98]",
                  selected ? "border-[var(--app-accent)]" : "border-transparent hover:border-[var(--border-strong)]",
                )}
              >
                <div className="relative mb-2 aspect-video overflow-hidden rounded-lg ring-1 ring-black/10" style={{ backgroundColor: t.body }}>
                  <div className="absolute inset-0 flex">
                    <div className="w-[10%]" style={{ backgroundColor: t.stripA }} />
                    <div className="w-[24%]" style={{ backgroundColor: t.stripB }} />
                    <div className="flex flex-1 flex-col justify-end gap-1.5 p-2">
                      <span className="block h-1.5 w-3/4 rounded-full" style={{ backgroundColor: t.line }} />
                      <span className="block h-1.5 w-1/2 rounded-full" style={{ backgroundColor: t.line }} />
                      <span className="mt-1 block h-3 w-full rounded" style={{ backgroundColor: t.stripB }} />
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between px-1">
                  <span className="text-sm font-medium text-[var(--text-primary)]">{themeLabel(t.id)}</span>
                  <span
                    aria-hidden
                    className={cn(
                      "flex h-[18px] w-[18px] items-center justify-center rounded-full border-2",
                      selected ? "border-[var(--app-accent)] bg-[var(--app-accent)]" : "border-[var(--text-muted)]",
                    )}
                  >
                    {selected && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </SettingsSection>

      {/* Gradient behind the app (presets, none, custom) */}
      <AppThemeSection
        theme={currentTheme}
        value={"themeGradient" in ap ? readUserThemeGradient(ap.themeGradient) : (themeSettings.themeGradient ?? null)}
        hasBackgroundImage={Boolean(typeof ap.backgroundImage === "string" ? ap.backgroundImage : themeSettings.backgroundImage)}
        save={saveAppearancePatch}
      />

      <SettingsSection title={gt("Accent Colour")} description={gt("Choose your primary accent colour")}>
        <div className="flex flex-wrap gap-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] p-4">
          {ACCENTS.map((color) => {
            const selected = color.toLowerCase() === accent;
            const name = accentLabel(color);
            return (
              <button
                key={color}
                type="button"
                aria-pressed={selected}
                aria-label={name}
                title={name}
                onClick={() => saveAppearancePatch({ accentColor: color })}
                className={cn(
                  "relative h-10 w-10 rounded-full transition-transform duration-(--motion-fast) hover:scale-110 active:scale-95",
                  selected && "ring-2 ring-[var(--text-primary)] ring-offset-2 ring-offset-[var(--bg-app)]",
                )}
                style={{ backgroundColor: color }}
              >
                {selected && <Check className="absolute inset-0 m-auto h-5 w-5 text-white" />}
              </button>
            );
          })}
        </div>
      </SettingsSection>

      <SettingsSection title={gt("Chat Font Size")} description={gt("Adjust the size of text in chat")}>
        <SettingsCard>
          <div className="space-y-4 px-4 py-4">
            {/* Live preview, like Discord's sample message */}
            <div className="flex items-start gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-3">
              <span className="h-9 w-9 shrink-0 rounded-full bg-[var(--app-accent)]" aria-hidden />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--text-primary)]">SerikaCord</p>
                <p className="text-[var(--text-primary)]" style={{ fontSize: `${fontSize}px` }}>
                  {gt("Preview ({size}px): This is how your chat will look.", { size: fontSize })}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-xs tabular-nums text-[var(--text-secondary)]">12px</span>
              <input
                type="range"
                min="12"
                max="20"
                value={fontSize}
                onChange={(e) => saveAppearancePatch({ fontSize: Number(e.target.value) }, { debounce: true })}
                aria-label={gt("Chat Font Size")}
                className="flex-1 cursor-pointer accent-[var(--app-accent)]"
              />
              <span className="text-xs tabular-nums text-[var(--text-secondary)]">20px</span>
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={gt("Saturation")} description={gt("Adjust the colour saturation of the entire app")}>
        <SettingsCard>
          <div className="flex items-center gap-4 px-4 py-4">
            <span className="text-xs tabular-nums text-[var(--text-secondary)]">0%</span>
            <input
              type="range"
              min="0"
              max="200"
              value={saturation}
              onChange={(e) => saveAppearancePatch({ saturation: Number(e.target.value) }, { debounce: true })}
              aria-label={gt("Saturation")}
              className="flex-1 cursor-pointer accent-[var(--app-accent)]"
            />
            <span className="text-xs tabular-nums text-[var(--text-secondary)]">200%</span>
            <span className="w-12 text-right text-sm font-medium tabular-nums text-[var(--text-primary)]">{saturation}%</span>
          </div>
        </SettingsCard>
      </SettingsSection>

      {/* Font, background image, server themes (CORD-45/46/50) */}
      <AppearanceCustomizationPanel
        values={{
          fontFamily: typeof ap.fontFamily === "string" ? ap.fontFamily : themeSettings.fontFamily,
          backgroundImage: typeof ap.backgroundImage === "string" ? ap.backgroundImage : themeSettings.backgroundImage,
          backgroundDim: ap.backgroundDim ?? themeSettings.backgroundDim,
          backgroundBlur: ap.backgroundBlur ?? themeSettings.backgroundBlur,
          useServerThemes: ap.useServerThemes ?? themeSettings.useServerThemes,
        }}
        profileBanner={profileBanner}
        save={saveAppearancePatch}
      />

      <SettingsSection title={gt("Message Display")}>
        <SettingsCard>
          {userSettings && (
            <SettingsToggleRow
              label={gt("Compact mode")}
              checked={Boolean(ap.compactMode ?? themeSettings.compactMode)}
              onCheckedChange={(checked) => saveAppearancePatch({ compactMode: checked })}
            />
          )}
          <SettingsToggleRow
            label={gt("Show Timestamps")}
            description={gt("Display message timestamps")}
            checked={Boolean(ap.showTimestamps ?? themeSettings.showTimestamps)}
            onCheckedChange={(checked) => saveAppearancePatch({ showTimestamps: checked })}
          />
          <SettingsToggleRow
            label={gt("Show Role Colours")}
            description={gt("Colour usernames by their highest role")}
            checked={Boolean(ap.showRoleColors ?? themeSettings.showRoleColors)}
            onCheckedChange={(checked) => saveAppearancePatch({ showRoleColors: checked })}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={gt("Animations")}>
        <SettingsCard>
          <SettingsToggleRow
            label={gt("Enable Animations")}
            description={gt("Show smooth transitions and animations")}
            checked={Boolean(ap.enableAnimations ?? themeSettings.enableAnimations)}
            onCheckedChange={(checked) => saveAppearancePatch({ enableAnimations: checked })}
          />
        </SettingsCard>
      </SettingsSection>
    </div>
  );
});
