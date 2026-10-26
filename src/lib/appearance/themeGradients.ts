/**
 * Gradient app theme presets (Appearance → App Theme, Server Settings →
 * Server Theme), modelled on Discord's colour themes. Presets are only UI
 * shortcuts: what gets saved is the plain gradient, so a preset can be
 * retuned here without touching stored settings (an old value just shows as
 * "Custom"). Colours are the vivid source colours; renderThemeGradient
 * darkens them on the dark themes and lightens them on light.
 */
import { DEFAULT_THEME_GRADIENT, themeGradientKey, type ThemeGradient } from "@/lib/appearance/customization";

export type ThemeGradientPresetId =
  | "serika"
  | "midnight-blue"
  | "midnight-violet"
  | "twilight"
  | "crimson-moon"
  | "mars"
  | "ember"
  | "forest"
  | "matcha"
  | "under-the-sea"
  | "ocean"
  | "retro-storm"
  | "sepia"
  | "dusk"
  | "sunset"
  | "aurora"
  | "chroma-glow"
  | "neon-nights"
  | "cyberpunk"
  | "sakura-night"
  | "glacier"
  | "hanami"
  | "mint-apple"
  | "citrus-sherbert"
  | "retro-raincloud"
  | "sunrise"
  | "cotton-candy"
  | "lofi-vibes"
  | "desert-khaki"
  | "strawberry-lemonade"
  | "lavender-haze"
  | "easter-egg";

/** "deep": dark and saturated; "soft": pastel (Discord's lighter colour themes). */
export type ThemeGradientTone = "deep" | "soft";

export interface ThemeGradientPreset {
  id: ThemeGradientPresetId;
  tone: ThemeGradientTone;
  gradient: ThemeGradient;
}

export const THEME_GRADIENT_PRESETS: readonly ThemeGradientPreset[] = [
  { id: "serika", tone: "deep", gradient: DEFAULT_THEME_GRADIENT },
  { id: "midnight-blue", tone: "deep", gradient: { stops: ["#3550c8", "#18225e", "#070a1c"], angle: 165 } },
  { id: "midnight-violet", tone: "deep", gradient: { stops: ["#5865f2", "#2b2d7a", "#0b0b24"], angle: 160 } },
  { id: "twilight", tone: "deep", gradient: { stops: ["#7b5cff", "#3a2a8c", "#120a2a"], angle: 150 } },
  { id: "crimson-moon", tone: "deep", gradient: { stops: ["#c0213f", "#3c0a18", "#070204"], angle: 165 } },
  { id: "mars", tone: "deep", gradient: { stops: ["#d4552c", "#6b1e12", "#1a0705"], angle: 160 } },
  { id: "ember", tone: "deep", gradient: { stops: ["#ff7a18", "#af002d", "#319197"], angle: 150 } },
  { id: "forest", tone: "deep", gradient: { stops: ["#2f7a45", "#173a26", "#08120c"], angle: 165 } },
  { id: "matcha", tone: "deep", gradient: { stops: ["#7da453", "#3d5a2a", "#10180a"], angle: 160 } },
  { id: "under-the-sea", tone: "deep", gradient: { stops: ["#1f8a8a", "#145a6e", "#06202a"], angle: 165 } },
  { id: "ocean", tone: "deep", gradient: { stops: ["#0077be", "#023e7d", "#001233"], angle: 170 } },
  { id: "retro-storm", tone: "deep", gradient: { stops: ["#4a6fa5", "#3a3f6e", "#141628"], angle: 155 } },
  { id: "sepia", tone: "deep", gradient: { stops: ["#b08454", "#5a3f28", "#1c140d"], angle: 165 } },
  { id: "dusk", tone: "deep", gradient: { stops: ["#6a5acd", "#c0607a", "#1f1a3a"], angle: 180 } },
  { id: "sunset", tone: "deep", gradient: { stops: ["#f07a3a", "#a2306a", "#2a0f3a"], angle: 160 } },
  { id: "aurora", tone: "deep", gradient: { stops: ["#1fc0a5", "#2a58c0", "#6a2ab0"], angle: 150 } },
  { id: "chroma-glow", tone: "deep", gradient: { stops: ["#0ec5ff", "#8a2be2", "#ff3d9a"], angle: 135 } },
  { id: "neon-nights", tone: "deep", gradient: { stops: ["#00e5d4", "#5b2bd6", "#ff2e88"], angle: 120 } },
  { id: "cyberpunk", tone: "deep", gradient: { stops: ["#f9f871", "#ff2e88", "#2b1055"], angle: 135 } },
  { id: "sakura-night", tone: "deep", gradient: { stops: ["#e86a9e", "#6a2c70", "#140a1c"], angle: 160 } },
  { id: "glacier", tone: "deep", gradient: { stops: ["#7fd6f5", "#2c6e9a", "#0a1a2a"], angle: 170 } },
  { id: "hanami", tone: "soft", gradient: { stops: ["#f2a7c3", "#c9a0dc", "#8fd3b6"], angle: 135 } },
  { id: "mint-apple", tone: "soft", gradient: { stops: ["#3fd6a0", "#8ae07a", "#1f8f6a"], angle: 150 } },
  { id: "citrus-sherbert", tone: "soft", gradient: { stops: ["#ffb347", "#ff7a59", "#ffd166"], angle: 140 } },
  { id: "retro-raincloud", tone: "soft", gradient: { stops: ["#4a7fa8", "#7a6fa8", "#2f3e5c"], angle: 160 } },
  { id: "sunrise", tone: "soft", gradient: { stops: ["#ff9a8b", "#ff6a88", "#ffd36e"], angle: 135 } },
  { id: "cotton-candy", tone: "soft", gradient: { stops: ["#f7b2d9", "#b5c7f7", "#e6c7ff"], angle: 135 } },
  { id: "lofi-vibes", tone: "soft", gradient: { stops: ["#a3c9f1", "#c7b8e8", "#f2c4d6"], angle: 145 } },
  { id: "desert-khaki", tone: "soft", gradient: { stops: ["#e5c99a", "#c9a27a", "#a58b6f"], angle: 150 } },
  { id: "strawberry-lemonade", tone: "soft", gradient: { stops: ["#ff5f8f", "#ffb36b", "#ffe66d"], angle: 130 } },
  { id: "lavender-haze", tone: "soft", gradient: { stops: ["#b8a4e3", "#e3a4d8", "#a4c8e3"], angle: 140 } },
  { id: "easter-egg", tone: "soft", gradient: { stops: ["#a0e7e5", "#b4f8c8", "#fbe7c6"], angle: 135 } },
];

/** The preset a gradient matches exactly, if any. */
export function findThemeGradientPreset(gradient: ThemeGradient | null | undefined): ThemeGradientPreset | null {
  if (!gradient) return null;
  const key = themeGradientKey(gradient);
  return THEME_GRADIENT_PRESETS.find((p) => themeGradientKey(p.gradient) === key) ?? null;
}
