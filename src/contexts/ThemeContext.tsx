"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { voiceService } from "@/lib/services/voiceService";

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
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<ThemeSettings>(defaultSettings);
  const [isLoaded, setIsLoaded] = useState(false);

  const applyUserSettingsPatch = useCallback((patch: Record<string, any>) => {
    const appearance = patch?.appearance || {};
    const accessibility = patch?.accessibility || {};
    const voiceVideo = patch?.voiceVideo || {};
    const textImages = patch?.textImages || {};

    // Every settings load/save path funnels through here, so this keeps the
    // live voice call (mic processing, push-to-talk, volumes) in step.
    if (patch?.voiceVideo) voiceService.applyVoiceSettings(patch.voiceVideo);

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
    
    // Accent color
    root.style.setProperty("--accent-color", settings.accentColor);
    root.style.setProperty("--app-accent", settings.accentColor);
    root.style.setProperty("--accent", settings.accentColor);
    root.style.setProperty("--accent-hover", settings.accentColor);

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
    root.style.setProperty("--primary", settings.accentColor);
    root.style.setProperty("--ring", settings.accentColor);
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

  }, [settings, isLoaded]);

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
    () => ({ settings, updateSetting, updateSettings, applyUserSettingsPatch, resetSettings }),
    [settings, updateSetting, updateSettings, applyUserSettingsPatch, resetSettings]
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
