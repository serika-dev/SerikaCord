"use client";

import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";

export interface ThemeSettings {
  theme: "dark" | "midnight" | "light";
  accentColor: string;
  fontSize: number;
  compactMode: boolean;
  showTimestamps: boolean;
  showRoleColors: boolean;
  enableAnimations: boolean;
  animatedEmojis: boolean;
  animatedAvatars: boolean;
  reducedMotion: boolean;
  saturation: number;
}

const defaultSettings: ThemeSettings = {
  theme: "dark",
  accentColor: "#8B5CF6",
  fontSize: 14,
  compactMode: false,
  showTimestamps: true,
  showRoleColors: true,
  enableAnimations: true,
  animatedEmojis: true,
  animatedAvatars: true,
  reducedMotion: false,
  saturation: 100,
};

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

    setSettings((prev) => ({
      ...prev,
      theme: (appearance.themeStyle || prev.theme) as ThemeSettings["theme"],
      accentColor: appearance.accentColor || prev.accentColor,
      fontSize: typeof appearance.fontSize === "number" ? appearance.fontSize : prev.fontSize,
      compactMode: typeof appearance.compactMode === "boolean" ? appearance.compactMode : prev.compactMode,
      showTimestamps: typeof appearance.showTimestamps === "boolean" ? appearance.showTimestamps : prev.showTimestamps,
      showRoleColors: typeof appearance.showRoleColors === "boolean" ? appearance.showRoleColors : prev.showRoleColors,
      enableAnimations: typeof appearance.enableAnimations === "boolean" ? appearance.enableAnimations : prev.enableAnimations,
      saturation: typeof appearance.saturation === "number" ? appearance.saturation : prev.saturation,
      reducedMotion: typeof accessibility.reducedMotion === "boolean" ? accessibility.reducedMotion : prev.reducedMotion,
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
    const stored = localStorage.getItem("serika-theme-settings");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setSettings({ ...defaultSettings, ...parsed });
      } catch (e) {
        console.error("Failed to parse theme settings:", e);
      }
    }
    setIsLoaded(true);
  }, []);

  // Hydrate from server-side persisted settings when available.
  useEffect(() => {
    if (!isLoaded) return;
    let active = true;

    fetch("/api/users/me/settings")
      .then(async (res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data?.settings) return;
        applyUserSettingsPatch(data.settings);
      })
      .catch(() => {
        // optional hydration; ignore when unauthenticated
      });

    return () => {
      active = false;
    };
  }, [applyUserSettingsPatch, isLoaded]);

  // Save settings to localStorage and apply CSS variables
  useEffect(() => {
    if (!isLoaded) return;

    localStorage.setItem("serika-theme-settings", JSON.stringify(settings));

    // Apply CSS variables
    const root = document.documentElement;
    root.classList.remove("theme-dark", "theme-midnight", "theme-light");
    root.classList.add(`theme-${settings.theme}`);
    if (settings.theme === "light") {
      root.classList.remove("dark");
      root.style.colorScheme = "light";
    } else {
      root.classList.add("dark");
      root.style.colorScheme = "dark";
    }
    
    // Accent color
    root.style.setProperty("--accent-color", settings.accentColor);
    root.style.setProperty("--app-accent", settings.accentColor);
    
    // Convert hex to HSL for Tailwind
    const hexToHsl = (hex: string) => {
      const r = parseInt(hex.slice(1, 3), 16) / 255;
      const g = parseInt(hex.slice(3, 5), 16) / 255;
      const b = parseInt(hex.slice(5, 7), 16) / 255;

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      let h = 0, s = 0, l = (max + min) / 2;

      if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
          case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
          case g: h = ((b - r) / d + 2) / 6; break;
          case b: h = ((r - g) / d + 4) / 6; break;
        }
      }

      return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
    };

    root.style.setProperty("--primary", hexToHsl(settings.accentColor));
    root.style.setProperty("--accent", hexToHsl(settings.accentColor));
    root.style.setProperty("--ring", hexToHsl(settings.accentColor));

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

  }, [settings, isLoaded]);

  const updateSetting = <K extends keyof ThemeSettings>(key: K, value: ThemeSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const updateSettings = (patch: Partial<ThemeSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  };

  const resetSettings = () => {
    setSettings(defaultSettings);
    localStorage.removeItem("serika-theme-settings");
  };

  return (
    <ThemeContext.Provider value={{ settings, updateSetting, updateSettings, applyUserSettingsPatch, resetSettings }}>
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
