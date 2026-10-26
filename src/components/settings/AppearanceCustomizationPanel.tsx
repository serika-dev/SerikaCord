"use client";

import { useRef, useState } from "react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { ImagePlus, Loader2, Trash2, Type, UserSquare } from "lucide-react";
import { SettingsCard, SettingsSection, SettingsToggleRow } from "@/components/settings/SettingsSection";
import { GradientThemePicker } from "@/components/settings/GradientThemePicker";
import { cdnImage } from "@/lib/utils";
import {
  BACKGROUND_BLUR_MAX,
  BACKGROUND_DIM_MAX,
  BACKGROUND_MEDIA_KINDS,
  FONT_PRESETS,
  clampBackgroundBlur,
  clampBackgroundDim,
  fontFamilyCss,
  parseAppearanceMediaUrl,
  sanitizeFontFamily,
  uniqueFontFamilies,
  userThemeGradient,
  type AppThemeName,
  type ThemeGradient,
  type UserThemeGradient,
} from "@/lib/appearance/customization";
import { uploadAppearanceImage } from "@/lib/appearance/uploadAppearanceImage";

type LocalFontData = { family: string };
type QueryLocalFonts = () => Promise<LocalFontData[]>;

export interface AppearanceCustomizationValues {
  fontFamily: string;
  backgroundImage: string;
  backgroundDim: number;
  backgroundBlur: number;
  useServerThemes: boolean;
}

interface Props {
  values: AppearanceCustomizationValues;
  /** The signed-in user's profile banner (offered as a background). */
  profileBanner?: string | null;
  save: (patch: Partial<AppearanceCustomizationValues>, opts?: { debounce?: boolean }) => void;
}

/**
 * Appearance → App Theme: the gradient behind the whole app. Unset shows the
 * theme's default ("Serika" on dark/midnight, none on light); picking "None"
 * saves "none". Used by the desktop Appearance page and the phone settings
 * page.
 */
export function AppThemeSection({
  theme,
  value,
  hasBackgroundImage,
  save,
}: {
  theme: string;
  value: UserThemeGradient;
  hasBackgroundImage?: boolean;
  save: (patch: { themeGradient: ThemeGradient | "none" }, opts?: { debounce?: boolean }) => void;
}) {
  const gt = useGT();
  const appTheme: AppThemeName = theme === "light" || theme === "midnight" ? theme : "dark";
  return (
    <SettingsSection
      title={gt("App Theme")}
      description={
        hasBackgroundImage
          ? gt("Your background image is shown instead of a gradient. Remove it to use an app theme.")
          : gt("A gradient behind the whole app. Servers can show their own while you're in them.")
      }
    >
      <GradientThemePicker
        value={userThemeGradient(value)}
        previewTheme={appTheme}
        noneLabel={gt("None (solid)")}
        onChange={(next, opts) => save({ themeGradient: next ?? "none" }, opts)}
      />
    </SettingsSection>
  );
}

/**
 * Appearance → Font (CORD-45), Background (CORD-46) and "Use server themes"
 * (CORD-50). Values are validated again server-side and in ThemeContext.
 */
export function AppearanceCustomizationPanel({ values, profileBanner, save }: Props) {
  const gt = useGT();
  const [fontDraft, setFontDraft] = useState(values.fontFamily);
  const [installedFonts, setInstalledFonts] = useState<string[] | null>(null);
  const [loadingFonts, setLoadingFonts] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const supportsLocalFonts = typeof window !== "undefined" && typeof (window as unknown as { queryLocalFonts?: QueryLocalFonts }).queryLocalFonts === "function";
  const draftValid = sanitizeFontFamily(fontDraft) !== null;
  const previewFont = fontFamilyCss(fontDraft) ?? undefined;
  const bannerUrl = parseAppearanceMediaUrl(profileBanner, ["banner"])?.url ?? null;
  const backgroundUrl = parseAppearanceMediaUrl(values.backgroundImage, BACKGROUND_MEDIA_KINDS)?.url ?? null;

  const applyFont = (name: string) => {
    const clean = sanitizeFontFamily(name);
    if (clean === null) {
      toast.error(gt("Font names can only use letters, numbers, spaces, dots, dashes and underscores."));
      return;
    }
    setFontDraft(clean);
    save({ fontFamily: clean });
  };

  const browseInstalledFonts = async () => {
    const query = (window as unknown as { queryLocalFonts?: QueryLocalFonts }).queryLocalFonts;
    if (!query) return;
    setLoadingFonts(true);
    try {
      setInstalledFonts(uniqueFontFamilies(await query()));
    } catch {
      toast.error(gt("Couldn't read your installed fonts. Allow font access in your browser, or type a font name."));
    } finally {
      setLoadingFonts(false);
    }
  };

  const onPickBackground = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadAppearanceImage("background", file);
      save({ backgroundImage: url });
    } catch (error) {
      toast.error(gt("Upload failed: {error}", { error: error instanceof Error ? error.message : "" }));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <>
      {/* Font */}
      <SettingsSection title={gt("Font")} description={gt("Use any font installed on this device. Leave empty for the default font.")}>
      <SettingsCard>
      <div className="px-4 py-4 space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {FONT_PRESETS.map((preset) => {
            const on = (values.fontFamily || "") === preset;
            return (
              <button
                key={preset || "default"}
                type="button"
                onClick={() => applyFont(preset)}
                className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${on ? "border-[var(--app-accent)] text-[var(--text-primary)] bg-[var(--bg-active)]" : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}
                style={{ fontFamily: fontFamilyCss(preset) ?? undefined }}
              >
                {preset || gt("Default")}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={fontDraft}
            list={installedFonts ? "serika-installed-fonts" : undefined}
            onChange={(e) => setFontDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && draftValid) applyFont(fontDraft); }}
            placeholder={gt("Font name, e.g. JetBrains Mono")}
            maxLength={64}
            aria-invalid={!draftValid}
            className="flex-1 min-w-[180px] h-9 px-3 rounded-md bg-[var(--bg-input)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] outline-none focus:border-[var(--app-accent)]"
          />
          {installedFonts && (
            <datalist id="serika-installed-fonts">
              {installedFonts.map((f) => <option key={f} value={f} />)}
            </datalist>
          )}
          <button
            type="button"
            disabled={!draftValid || fontDraft.trim() === values.fontFamily}
            onClick={() => applyFont(fontDraft)}
            className="h-9 px-3 rounded-md bg-[var(--app-accent)] text-[var(--text-on-accent)] text-sm font-semibold disabled:opacity-50"
          >
            {gt("Apply")}
          </button>
          {supportsLocalFonts && (
            <button
              type="button"
              onClick={() => void browseInstalledFonts()}
              className="h-9 px-3 rounded-md border border-[var(--border-subtle)] text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center gap-1.5"
            >
              {loadingFonts ? <Loader2 className="w-4 h-4 animate-spin" /> : <Type className="w-4 h-4" />}
              {gt("Browse installed fonts")}
            </button>
          )}
        </div>
        {installedFonts && (
          <select
            value=""
            onChange={(e) => { if (e.target.value) applyFont(e.target.value); }}
            className="w-full h-9 px-2 rounded-md bg-[var(--bg-input)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)]"
            aria-label={gt("Installed fonts")}
          >
            <option value="">{gt("{count} installed fonts", { count: installedFonts.length })}</option>
            {installedFonts.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        )}
        {!draftValid && (
          <p className="text-xs text-[var(--app-danger)]">{gt("Font names can only use letters, numbers, spaces, dots, dashes and underscores.")}</p>
        )}
        <p className="text-sm text-[var(--text-secondary)]" style={{ fontFamily: previewFont }}>
          {gt("The quick brown fox jumps over the lazy dog.")}
        </p>
      </div>
      </SettingsCard>
      </SettingsSection>

      {/* Background image */}
      <SettingsSection title={gt("Background Image")} description={gt("Show an image behind the app. Panels turn see-through so it shows.")}>
      <SettingsCard>
      <div className="px-4 py-4 space-y-4">
        <div
          className="relative h-28 rounded-lg overflow-hidden border border-[var(--border-subtle)] bg-[var(--bg-card)]"
          aria-hidden
        >
          {backgroundUrl && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={cdnImage(backgroundUrl)}
                alt=""
                className="absolute inset-0 w-full h-full object-cover"
                style={{ filter: `blur(${clampBackgroundBlur(values.backgroundBlur) / 3}px)` }}
              />
              <div className="absolute inset-0 bg-[var(--app-bg)]" style={{ opacity: clampBackgroundDim(values.backgroundDim) / 100 }} />
            </>
          )}
          <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--text-primary)]">
            {backgroundUrl ? gt("Preview") : gt("No background image")}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="hidden"
            onChange={(e) => void onPickBackground(e.target.files?.[0])}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            className="h-9 px-3 rounded-md bg-[var(--app-accent)] text-[var(--text-on-accent)] text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
            {gt("Upload image")}
          </button>
          {bannerUrl && bannerUrl !== backgroundUrl && (
            <button
              type="button"
              onClick={() => save({ backgroundImage: bannerUrl })}
              className="h-9 px-3 rounded-md border border-[var(--border-subtle)] text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center gap-1.5"
            >
              <UserSquare className="w-4 h-4" />
              {gt("Use my profile banner")}
            </button>
          )}
          {backgroundUrl && (
            <button
              type="button"
              onClick={() => save({ backgroundImage: "" })}
              className="h-9 px-3 rounded-md border border-[var(--border-subtle)] text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center gap-1.5"
            >
              <Trash2 className="w-4 h-4" />
              {gt("Remove")}
            </button>
          )}
        </div>
        {backgroundUrl && (
          <>
            <label className="block">
              <span className="text-sm text-[var(--text-primary)]">{gt("Dim")}</span>
              <div className="flex items-center gap-3 mt-1">
                <input
                  type="range"
                  min={0}
                  max={BACKGROUND_DIM_MAX}
                  value={clampBackgroundDim(values.backgroundDim)}
                  onChange={(e) => save({ backgroundDim: Number(e.target.value) }, { debounce: true })}
                  className="flex-1 accent-[var(--app-accent)] cursor-pointer"
                />
                <span className="text-xs text-[var(--text-secondary)] tabular-nums w-10 text-right">{clampBackgroundDim(values.backgroundDim)}%</span>
              </div>
            </label>
            <label className="block">
              <span className="text-sm text-[var(--text-primary)]">{gt("Blur")}</span>
              <div className="flex items-center gap-3 mt-1">
                <input
                  type="range"
                  min={0}
                  max={BACKGROUND_BLUR_MAX}
                  value={clampBackgroundBlur(values.backgroundBlur)}
                  onChange={(e) => save({ backgroundBlur: Number(e.target.value) }, { debounce: true })}
                  className="flex-1 accent-[var(--app-accent)] cursor-pointer"
                />
                <span className="text-xs text-[var(--text-secondary)] tabular-nums w-10 text-right">{clampBackgroundBlur(values.backgroundBlur)}px</span>
              </div>
            </label>
          </>
        )}
      </div>
      </SettingsCard>
      </SettingsSection>

      {/* Server themes */}
      <SettingsCard>
        <SettingsToggleRow
          label={gt("Use server themes")}
          description={gt("Let servers change the accent colour and app gradient while you're in them.")}
          checked={values.useServerThemes}
          onCheckedChange={(checked) => save({ useServerThemes: checked })}
        />
      </SettingsCard>
    </>
  );
}
