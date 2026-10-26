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
  | "crimson-moon"
  | "forest"
  | "sunset"
  | "aurora"
  | "sepia"
  | "hanami"
  | "chroma-glow"
  | "mint-apple"
  | "citrus-sherbert"
  | "retro-raincloud"
  | "dusk"
  | "neon-nights";

export interface ThemeGradientPreset {
  id: ThemeGradientPresetId;
  gradient: ThemeGradient;
}

export const THEME_GRADIENT_PRESETS: readonly ThemeGradientPreset[] = [
  { id: "serika", gradient: DEFAULT_THEME_GRADIENT },
  { id: "midnight-blue", gradient: { stops: ["#3550c8", "#18225e", "#070a1c"], angle: 165 } },
  { id: "crimson-moon", gradient: { stops: ["#c0213f", "#3c0a18", "#070204"], angle: 165 } },
  { id: "forest", gradient: { stops: ["#2f7a45", "#173a26", "#08120c"], angle: 165 } },
  { id: "sunset", gradient: { stops: ["#f07a3a", "#a2306a", "#2a0f3a"], angle: 160 } },
  { id: "aurora", gradient: { stops: ["#1fc0a5", "#2a58c0", "#6a2ab0"], angle: 150 } },
  { id: "sepia", gradient: { stops: ["#b08454", "#5a3f28", "#1c140d"], angle: 165 } },
  { id: "hanami", gradient: { stops: ["#f2a7c3", "#c9a0dc", "#8fd3b6"], angle: 135 } },
  { id: "chroma-glow", gradient: { stops: ["#0ec5ff", "#8a2be2", "#ff3d9a"], angle: 135 } },
  { id: "mint-apple", gradient: { stops: ["#3fd6a0", "#8ae07a", "#1f8f6a"], angle: 150 } },
  { id: "citrus-sherbert", gradient: { stops: ["#ffb347", "#ff7a59", "#ffd166"], angle: 140 } },
  { id: "retro-raincloud", gradient: { stops: ["#4a7fa8", "#7a6fa8", "#2f3e5c"], angle: 160 } },
  { id: "dusk", gradient: { stops: ["#6a5acd", "#c0607a", "#1f1a3a"], angle: 180 } },
  { id: "neon-nights", gradient: { stops: ["#00e5d4", "#5b2bd6", "#ff2e88"], angle: 120 } },
];

/** The preset a gradient matches exactly, if any. */
export function findThemeGradientPreset(gradient: ThemeGradient | null | undefined): ThemeGradientPreset | null {
  if (!gradient) return null;
  const key = themeGradientKey(gradient);
  return THEME_GRADIENT_PRESETS.find((p) => themeGradientKey(p.gradient) === key) ?? null;
}
