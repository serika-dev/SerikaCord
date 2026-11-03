/**
 * Validation of the `customization` patch sent to PUT / POST /api/users/me.
 *
 * Only keys the profile editors write are accepted; each value is checked and
 * clamped. Unknown keys are dropped (they were never rendered, and a modded
 * client could otherwise park arbitrary JSON on every user payload). Keys with
 * their own route are dropped too:
 *   - serverTag            PUT /api/users/@me/server-tag (membership-checked)
 *   - customStatusEmoji /
 *     customStatusExpiresAt  the top-level fields of PUT /users/me
 *                            (applyCustomStatusPatch, sanitizeStatusEmoji)
 *
 * Pure (no env, DB or React) so it is unit-tested in
 * tests/customization-patch.test.ts.
 */
import { normalizeHexColor } from "@/lib/appearance/customization";
import { sanitizeNameplate } from "@/lib/constants/nameplates";
import { sanitizeDisplayNameStyle, sanitizeTheme, type MemberDisplayNameStyle } from "@/lib/profiles/memberProfile";
import { RADIAL_POSITIONS } from "@/lib/profiles/customizationSafety";

/** Largest `customization` patch accepted, as serialized JSON (bytes). */
export const CUSTOMIZATION_PATCH_MAX_BYTES = 8 * 1024;

export const PROFILE_GRADIENT_TYPES = ["linear", "radial"] as const;
export const PROFILE_CARD_EFFECTS = ["normal", "glassmorphism", "glow", "holographic", "neon"] as const;

/** Ranges of the profile card sliders (settings page). */
export const PROFILE_CARD_LIMITS = {
  blur: { min: 0, max: 24 },
  opacity: { min: 0.1, max: 1 },
  borderWidth: { min: 1, max: 5 },
} as const;

/** Every key the patch may carry. */
export const CUSTOMIZATION_PATCH_KEYS = [
  "displayNameStyle",
  "nameplate",
  "profileColor",
  "profileAccentColor",
  "profileGradient",
  "profileGradientAngle",
  "profileGradientType",
  "profileGradientRadialPosition",
  "profileCardEffect",
  "profileCardBlur",
  "profileCardOpacity",
  "profileCardBorderColor",
  "profileCardBorderGlow",
  "profileCardBorderWidth",
] as const;
export type CustomizationPatchKey = (typeof CUSTOMIZATION_PATCH_KEYS)[number];

export interface CustomizationPatchContext {
  userId: string;
  cdnUrl: string;
}

type Result = { customization: Record<string, unknown> } | { error: string };

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** Serialized size in bytes (UTF-8); Infinity when it can't be serialized. */
export function serializedSize(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value) ?? "").length;
  } catch {
    return Infinity;
  }
}

function numberIn(value: unknown, min: number, max: number, round?: (n: number) => number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const n = Math.min(max, Math.max(min, value));
  return round ? round(n) : n;
}

/** `""` (unset) or an uppercase `#RRGGBB`; null when invalid. */
function optionalHex(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return "";
  return normalizeHexColor(value)?.toUpperCase() ?? null;
}

/**
 * Merge a client `customization` patch into the stored customization.
 *
 * - `null` for a key resets it (the key is removed).
 * - `displayNameStyle` is merged over the stored one (editors may send one
 *   field), then validated as a whole by `sanitizeDisplayNameStyle`.
 * - `profileColor` / `profileGradient` go through `sanitizeTheme`.
 * - `nameplate` replaces the stored one (`sanitizeNameplate`).
 * - Numbers are clamped to the slider ranges, enums must be known values.
 *
 * Stored keys the patch doesn't mention are kept as they are.
 */
export function applyCustomizationPatchSafe(
  stored: unknown,
  patch: unknown,
  ctx: CustomizationPatchContext,
): Result {
  if (!isObject(patch)) return { error: "customization must be an object" };
  if (serializedSize(patch) > CUSTOMIZATION_PATCH_MAX_BYTES) return { error: "customization is too large" };

  const current: Record<string, unknown> = isObject(stored) ? { ...stored } : {};
  const out: Record<string, unknown> = { ...current };
  const has = (k: CustomizationPatchKey) => Object.prototype.hasOwnProperty.call(patch, k) && patch[k] !== undefined;

  // Display name style.
  if (has("displayNameStyle")) {
    const raw = patch.displayNameStyle;
    if (raw === null) delete out.displayNameStyle;
    else {
      if (!isObject(raw)) return { error: "Invalid display name style" };
      // A stored style that no longer validates is ignored rather than
      // blocking every later save.
      const base: MemberDisplayNameStyle = sanitizeDisplayNameStyle(current.displayNameStyle) ?? {};
      const style = sanitizeDisplayNameStyle({ ...base, ...raw });
      if (!style) return { error: "Invalid display name style" };
      out.displayNameStyle = style;
    }
  }

  // Nameplate (own CDN images, known presets, hex colours).
  if (has("nameplate")) {
    const result = sanitizeNameplate(patch.nameplate, { userId: ctx.userId, cdnUrl: ctx.cdnUrl });
    if ("error" in result) return { error: result.error };
    out.nameplate = result.nameplate;
  }

  // Profile theme colours.
  if (has("profileColor") || has("profileGradient")) {
    const theme = sanitizeTheme({
      profileColor: has("profileColor") ? patch.profileColor : undefined,
      profileGradient: has("profileGradient") ? patch.profileGradient : undefined,
    });
    if (!theme) return { error: "Invalid profile colours" };
    if (has("profileColor")) out.profileColor = theme.profileColor;
    if (has("profileGradient")) out.profileGradient = theme.profileGradient;
  }

  for (const key of ["profileAccentColor", "profileCardBorderColor"] as const) {
    if (!has(key)) continue;
    const c = optionalHex(patch[key]);
    if (c === null) return { error: `Invalid ${key}` };
    out[key] = c;
  }

  // Enums.
  const enums: [CustomizationPatchKey, readonly string[]][] = [
    ["profileGradientType", PROFILE_GRADIENT_TYPES],
    ["profileCardEffect", PROFILE_CARD_EFFECTS],
    ["profileGradientRadialPosition", RADIAL_POSITIONS],
  ];
  for (const [key, allowed] of enums) {
    if (!has(key)) continue;
    const v = patch[key];
    if (v === null) { delete out[key]; continue; }
    if (typeof v !== "string" || !allowed.includes(v)) return { error: `Invalid ${key}` };
    out[key] = v;
  }

  // Numbers.
  const numbers: [CustomizationPatchKey, number, number, ((n: number) => number) | undefined][] = [
    ["profileGradientAngle", -Infinity, Infinity, (n) => ((Math.round(n) % 360) + 360) % 360],
    ["profileCardBlur", PROFILE_CARD_LIMITS.blur.min, PROFILE_CARD_LIMITS.blur.max, Math.round],
    ["profileCardOpacity", PROFILE_CARD_LIMITS.opacity.min, PROFILE_CARD_LIMITS.opacity.max, (n) => Math.round(n * 100) / 100],
    ["profileCardBorderWidth", PROFILE_CARD_LIMITS.borderWidth.min, PROFILE_CARD_LIMITS.borderWidth.max, Math.round],
  ];
  for (const [key, min, max, round] of numbers) {
    if (!has(key)) continue;
    const v = patch[key];
    if (v === null) { delete out[key]; continue; }
    const n = numberIn(v, min, max, round);
    if (n === null) return { error: `Invalid ${key}` };
    out[key] = n;
  }

  if (has("profileCardBorderGlow")) {
    const v = patch.profileCardBorderGlow;
    if (v === null) delete out.profileCardBorderGlow;
    else if (typeof v !== "boolean") return { error: "Invalid profileCardBorderGlow" };
    else out.profileCardBorderGlow = v;
  }

  return { customization: out };
}
