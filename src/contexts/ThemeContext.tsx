"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from "react";
import { usePathname } from "next/navigation";
import { withVoiceService } from "@/lib/services/voiceServiceLazy";
import {
  BACKGROUND_DIM_DEFAULT,
  BACKGROUND_MEDIA_KINDS,
  SURFACE_OVERRIDE_VARS,
  clampAccentForContrast,
  clampBackgroundBlur,
  clampBackgroundDim,
  computeSurfaceOverrides,
  cssImageUrl,
  fontFamilyCss,
  normalizeHexColor,
  readUserThemeGradient,
  renderThemeGradient,
  resolveThemeGradient,
  sanitizeFontFamily,
  themeGradientCss,
  themeGradientKey,
  type ServerTheme,
  type UserThemeGradient,
} from "@/lib/appearance/customization";

export interface ThemeSettings {
  theme: "dark" | "midnight" | "light";
  accentColor: string;
  textColor: string;
  fontSize: number;
  compactMode: boolean;
  showTimestamps: boolean;
  showRoleColors: boolean;
  enableAnimations: boolean;
  animatedEmojis: boolean;
  animatedAvatars: boolean;
  reducedMotion: boolean;
  saturation: number;
  highContrast: boolean;
  dyslexicFont: boolean;
  messageSpacing: "compact" | "cozy";
  /** App font family name; "" = default (CORD-45). */
  fontFamily: string;
  /** Custom app background (own CDN upload) or "" (CORD-46). */
  backgroundImage: string;
  /** Overlay dim over the background, 0-90 (%). */
  backgroundDim: number;
  /** Background blur, 0-30 (px). */
  backgroundBlur: number;
  /** Apply a server's theme while inside it (CORD-50). */
  useServerThemes: boolean;
  /**
   * Gradient behind the app: null = default ("Serika" on dark/midnight, none
   * on light), "none" = solid, or a gradient.
   */
  themeGradient: UserThemeGradient;
}

const defaultSettings: ThemeSettings = {
  theme: "dark",
  accentColor: "#8B5CF6",
  textColor: "",
  fontSize: 14,
  compactMode: false,
  showTimestamps: true,
  showRoleColors: true,
  enableAnimations: true,
  animatedEmojis: true,
  animatedAvatars: true,
  reducedMotion: false,
  saturation: 100,
  highContrast: false,
  dyslexicFont: false,
  messageSpacing: "cozy",
  fontFamily: "",
  backgroundImage: "",
  backgroundDim: BACKGROUND_DIM_DEFAULT,
  backgroundBlur: 0,
  useServerThemes: true,
  themeGradient: null,
};

function coerceTheme(theme: unknown): ThemeSettings["theme"] {
  if (theme === "light" || theme === "dark" || theme === "midnight") {
    return theme;
  }
  return "dark";
}

interface ThemeContextType {
  settings: ThemeSettings;
  updateSetting: <K extends keyof ThemeSettings>(key: K, value: ThemeSettings[K]) => void;
  updateSettings: (patch: Partial<ThemeSettings>) => void;
  applyUserSettingsPatch: (patch: Record<string, any>) => void;
  resetSettings: () => void;
  /** Theme of the server being viewed (null outside servers); see ServerThemeSync. */
  serverTheme: ServerTheme | null;
  setServerTheme: (theme: ServerTheme | null) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// Hover tint for the accent: 12% toward white (not color-mix(), which the
// Qt desktop shell's Chromium 102 lacks). Non-hex values pass through.
function hoverShade(color: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  const n = parseInt(m[1], 16);
  const mix = (c: number) => Math.round(c + (255 - c) * 0.12);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(mix);
  return `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<ThemeSettings>(defaultSettings);
  const [isLoaded, setIsLoaded] = useState(false);
  const [serverTheme, setServerThemeState] = useState<ServerTheme | null>(null);
  const pathname = usePathname() || "";
  const inApp = /^\/(channels|dm)(\/|$)/.test(pathname);
  const setServerTheme = useCallback((theme: ServerTheme | null) => {
    setServerThemeState((prev) =>
      prev?.accentColor === theme?.accentColor &&
      prev?.backgroundTint === theme?.backgroundTint &&
      themeGradientKey(prev?.gradient) === themeGradientKey(theme?.gradient)
        ? prev
        : theme,
    );
  }, []);

  const applyUserSettingsPatch = useCallback((patch: Record<string, any>) => {
    const appearance = patch?.appearance || {};
    const accessibility = patch?.accessibility || {};
    const voiceVideo = patch?.voiceVideo || {};
    const textImages = patch?.textImages || {};

    // Every settings load/save path funnels through here, so this keeps the
    // live voice call (mic processing, push-to-talk, volumes) in step.
    if (patch?.voiceVideo) {
      const voiceVideoPatch = patch.voiceVideo;
      withVoiceService((v) => v.applyVoiceSettings(voiceVideoPatch));
    }

    setSettings((prev) => ({
      ...prev,
      theme: coerceTheme(appearance.theme ?? appearance.themeStyle ?? prev.theme),
      accentColor: appearance.accentColor || prev.accentColor,
      textColor: appearance.textColor ?? prev.textColor,
      fontSize: typeof appearance.fontSize === "number" ? appearance.fontSize : prev.fontSize,
      compactMode: typeof appearance.compactMode === "boolean" ? appearance.compactMode : prev.compactMode,
      showTimestamps: typeof appearance.showTimestamps === "boolean" ? appearance.showTimestamps : prev.showTimestamps,
      showRoleColors: typeof appearance.showRoleColors === "boolean" ? appearance.showRoleColors : prev.showRoleColors,
      enableAnimations: typeof appearance.enableAnimations === "boolean" ? appearance.enableAnimations : prev.enableAnimations,
      saturation: typeof appearance.saturation === "number" ? appearance.saturation : prev.saturation,
      reducedMotion: typeof accessibility.reducedMotion === "boolean" ? accessibility.reducedMotion : prev.reducedMotion,
      highContrast: typeof accessibility.highContrast === "boolean" ? accessibility.highContrast : prev.highContrast,
      dyslexicFont: typeof accessibility.dyslexicFont === "boolean" ? accessibility.dyslexicFont : prev.dyslexicFont,
      messageSpacing: accessibility.messageSpacing === "compact" || accessibility.messageSpacing === "cozy" ? accessibility.messageSpacing : prev.messageSpacing,
      animatedEmojis:
        typeof textImages.gifAutoplay === "boolean"
          ? textImages.gifAutoplay
          : typeof voiceVideo.animatedEmojis === "boolean"
            ? voiceVideo.animatedEmojis
            : prev.animatedEmojis,
      animatedAvatars: typeof voiceVideo.animatedAvatars === "boolean" ? voiceVideo.animatedAvatars : prev.animatedAvatars,
      fontFamily: typeof appearance.fontFamily === "string" ? (sanitizeFontFamily(appearance.fontFamily) ?? "") : prev.fontFamily,
      backgroundImage: typeof appearance.backgroundImage === "string" ? appearance.backgroundImage : prev.backgroundImage,
      backgroundDim: typeof appearance.backgroundDim === "number" ? clampBackgroundDim(appearance.backgroundDim) : prev.backgroundDim,
      backgroundBlur: typeof appearance.backgroundBlur === "number" ? clampBackgroundBlur(appearance.backgroundBlur) : prev.backgroundBlur,
      useServerThemes: typeof appearance.useServerThemes === "boolean" ? appearance.useServerThemes : prev.useServerThemes,
      themeGradient: "themeGradient" in appearance ? readUserThemeGradient(appearance.themeGradient) : prev.themeGradient,
    }));
  }, []);

  // Load settings from localStorage
  useEffect(() => {
    const fallbackTheme = localStorage.getItem("theme");
    const stored = localStorage.getItem("serika-theme-settings");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setSettings({
          ...defaultSettings,
          ...parsed,
          theme: coerceTheme(parsed?.theme ?? fallbackTheme),
          themeGradient: readUserThemeGradient(parsed?.themeGradient),
        });
      } catch (e) {
        console.error("Failed to parse theme settings:", e);
        setSettings((prev) => ({ ...prev, theme: coerceTheme(fallbackTheme) }));
      }
    } else if (fallbackTheme) {
      setSettings((prev) => ({ ...prev, theme: coerceTheme(fallbackTheme) }));
    }
    setIsLoaded(true);
  }, []);

  // Gradient layer state for the crossfade: two stacked body layers (a/b);
  // a new gradient goes into the hidden one, which then fades in.
  const gradientLayerRef = useRef<{ active: "a" | "b"; css: string | null }>({ active: "a", css: null });

  // Server-side settings are hydrated per signed-in user by
  // <SettingsHydrator/> (inside AuthProvider), so login/account switches apply.

  // Save settings to localStorage and apply CSS variables
  useEffect(() => {
    if (!isLoaded) return;

    localStorage.setItem("serika-theme-settings", JSON.stringify(settings));

    // Apply CSS variables
    const root = document.documentElement;
    root.classList.remove("theme-dark", "theme-midnight", "theme-light");
    root.classList.add(`theme-${settings.theme}`);
    root.classList.toggle("dark", settings.theme !== "light");
    root.style.colorScheme = settings.theme === "light" ? "light" : "dark";
    
    // Accent color: a server's theme overrides the user's accent while inside
    // that server (unless "Use server themes" is off), clamped for contrast.
    const activeServerTheme = settings.useServerThemes ? serverTheme : null;
    const serverAccent = normalizeHexColor(activeServerTheme?.accentColor);
    const accentColor = serverAccent ? clampAccentForContrast(serverAccent) : settings.accentColor;
    root.style.setProperty("--accent-color", accentColor);
    root.style.setProperty("--app-accent", accentColor);
    root.style.setProperty("--accent", accentColor);
    root.style.setProperty("--accent-hover", hoverShade(accentColor));

    // Custom text color (overrides theme default when set)
    if (settings.textColor && settings.textColor.trim()) {
      root.style.setProperty("--app-text", settings.textColor);
    } else {
      // Reset to theme default by removing the inline override
      root.style.removeProperty("--app-text");
      // Re-apply the theme class to restore defaults from CSS
    }
    
    // Tailwind v4 maps --color-primary/--color-ring straight to these vars,
    // so they must hold real colors (not bare HSL triplets). --accent keeps
    // the hex set above.
    root.style.setProperty("--primary", accentColor);
    root.style.setProperty("--ring", accentColor);
    root.style.setProperty("--primary-foreground", "var(--text-on-accent)");
    localStorage.setItem("theme", settings.theme);

    // Font size
    root.style.setProperty("--chat-font-size", `${settings.fontSize}px`);

    // Saturation
    root.style.setProperty("--saturation", `${settings.saturation}%`);

    // Reduced motion
    if (settings.reducedMotion || !settings.enableAnimations) {
      root.classList.add("reduce-motion");
    } else {
      root.classList.remove("reduce-motion");
    }

    // Compact mode
    if (settings.compactMode) {
      root.classList.add("compact-mode");
    } else {
      root.classList.remove("compact-mode");
    }

    // Animated avatars
    if (!settings.animatedAvatars) {
      root.classList.add("no-animated-avatars");
    } else {
      root.classList.remove("no-animated-avatars");
    }

    // Animated emojis
    if (!settings.animatedEmojis) {
      root.classList.add("no-animated-emojis");
    } else {
      root.classList.remove("no-animated-emojis");
    }

    // High contrast
    root.classList.toggle("high-contrast", settings.highContrast);

    // Dyslexic font
    root.classList.toggle("dyslexic-font", settings.dyslexicFont);

    // Message spacing
    root.classList.remove("message-spacing-compact", "message-spacing-cozy");
    root.classList.add(`message-spacing-${settings.messageSpacing}`);

    // Saturation filter (only apply class when not default 100 to avoid unnecessary filter)
    root.classList.toggle("saturation-filter", settings.saturation !== 100);

    // App font (CORD-45): only a validated, quoted family name reaches CSS.
    const font = fontFamilyCss(settings.fontFamily);
    if (font) root.style.setProperty("--app-font-family", font);
    else root.style.removeProperty("--app-font-family");
    root.classList.toggle("custom-font", Boolean(font));

    // Custom background (CORD-46): only our CDN, the user's own folders.
    const bgImage = cssImageUrl(settings.backgroundImage, BACKGROUND_MEDIA_KINDS);
    if (bgImage) {
      root.style.setProperty("--custom-bg-image", bgImage);
      root.style.setProperty("--custom-bg-dim", String(clampBackgroundDim(settings.backgroundDim) / 100));
      root.style.setProperty("--custom-bg-blur", `${clampBackgroundBlur(settings.backgroundBlur)}px`);
    } else {
      for (const v of ["--custom-bg-image", "--custom-bg-dim", "--custom-bg-blur"]) root.style.removeProperty(v);
    }
    root.classList.toggle("has-custom-bg", Boolean(bgImage));

    // Gradient app theme: the open server's (when allowed), else the user's;
    // a custom background image wins over both. Rendered dark/light enough
    // for text on the current theme.
    // Only the app (/channels, /dm) wears it: the landing, login and invite
    // pages keep their own design.
    const rawGradient = !inApp ? null : resolveThemeGradient({
      theme: settings.theme,
      user: settings.themeGradient,
      server: activeServerTheme,
      hasBackgroundImage: Boolean(bgImage),
    });
    const gradient = rawGradient ? renderThemeGradient(rawGradient, settings.theme) : null;
    const gradientCss = gradient ? themeGradientCss(gradient) : null;
    const layer = gradientLayerRef.current;
    if (gradientCss !== layer.css) {
      if (!gradientCss) {
        for (const v of ["--theme-gradient", "--theme-gradient-a", "--theme-gradient-b"]) root.style.removeProperty(v);
        root.classList.remove("has-theme-gradient", "theme-gradient-b");
        layer.active = "a";
      } else if (!layer.css) {
        root.style.setProperty("--theme-gradient-a", gradientCss);
        root.style.removeProperty("--theme-gradient-b");
        root.classList.remove("theme-gradient-b");
        root.classList.add("has-theme-gradient");
        layer.active = "a";
      } else {
        const next = layer.active === "a" ? "b" : "a";
        root.style.setProperty(`--theme-gradient-${next}`, gradientCss);
        root.classList.toggle("theme-gradient-b", next === "b");
        layer.active = next;
      }
      if (gradientCss) root.style.setProperty("--theme-gradient", gradientCss);
      layer.css = gradientCss;
    }

    // Surfaces: see-through over a background image or gradient, or tinted
    // by a server's legacy tint.
    const surfaces = computeSurfaceOverrides({
      theme: settings.theme,
      tint: activeServerTheme?.backgroundTint,
      translucent: Boolean(bgImage),
      gradient,
    });
    for (const v of SURFACE_OVERRIDE_VARS) {
      if (surfaces?.[v]) root.style.setProperty(v, surfaces[v]);
      else root.style.removeProperty(v);
    }
  }, [settings, isLoaded, serverTheme, inApp]);

  const updateSetting = useCallback(<K extends keyof ThemeSettings>(key: K, value: ThemeSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  }, []);

  const updateSettings = useCallback((patch: Partial<ThemeSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const resetSettings = useCallback(() => {
    setSettings(defaultSettings);
    localStorage.removeItem("serika-theme-settings");
  }, []);

  const value = useMemo(
    () => ({ settings, updateSetting, updateSettings, applyUserSettingsPatch, resetSettings, serverTheme, setServerTheme }),
    [settings, updateSetting, updateSettings, applyUserSettingsPatch, resetSettings, serverTheme, setServerTheme]
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
