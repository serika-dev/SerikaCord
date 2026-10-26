/**
 * Swatches offered by the in-profile editor. The same colours as the
 * profile page of User Settings, so both editors feel like one tool.
 */
export const SOLID_SWATCHES = [
  "#F43F5E", "#EAB308", "#22C55E", "#10B981", "#06B6D4", "#3B82F6", "#6366F1", "#8B5CF6",
  "#D946EF", "#FF1744", "#00E676", "#00B0FF", "#D500F9", "#FF9800", "#9C27B0",
] as const;

export const GRADIENT_SWATCHES: ReadonlyArray<readonly [string, string]> = [
  ["#FF3366", "#FFD12A"], ["#00E676", "#00B0FF"], ["#D500F9", "#FF1744"], ["#1DE9B6", "#3D5AFE"],
  ["#FF4081", "#E040FB"], ["#2979FF", "#00E5FF"], ["#7C4DFF", "#E040FB"], ["#FF9800", "#FF5722"],
  ["#4CAF50", "#8BC34A"], ["#9C27B0", "#673AB7"], ["#00BCD4", "#009688"], ["#434343", "#000000"],
];

export const NAME_FONTS = ["default", "serif", "mono", "rounded", "cursive", "bold"] as const;
export const NAME_EFFECTS = ["solid", "gradient", "neon", "toon", "pop"] as const;

export type NameFont = (typeof NAME_FONTS)[number];
export type NameEffect = (typeof NAME_EFFECTS)[number];

/** Fallback pair for the two theme swatches when nothing is set yet. */
export const DEFAULT_THEME_PAIR: readonly [string, string] = ["#8B5CF6", "#4F46E5"];
