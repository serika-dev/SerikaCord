/**
 * Pure validators and helpers for user-provided appearance values that end up
 * in CSS: custom app background (CORD-46), app font (CORD-45), server themes
 * (CORD-50) and nameplate images (CORD-44).
 *
 * Shared by the server (validation before anything is saved) and the client
 * (defence in depth before a value reaches a style). Nothing here reads env or
 * the DB, so it is unit-tested in tests/appearanceCustomization.test.ts.
 *
 * Rules:
 * - colours are `#rrggbb` only (no names, functions or `url()`),
 * - images must be files on our CDN inside the uploader's own folder
 *   (`<cdn>/<folder>/<userId>/<nanoid>.<ext>`), rebuilt from validated parts,
 * - font names use a letters/digits/space/`_.-` charset and are quoted.
 */

/** Public CDN origin the client renders from (server passes config.CDN_URL). */
export const DEFAULT_CDN_URL = "https://cdn.serika.chat";

/** Upload folders for appearance images, keyed by what they're for. */
export const APPEARANCE_MEDIA_FOLDERS = {
  background: "backgrounds",
  nameplate: "nameplates",
  /** The user's own profile banner can be picked as the app background. */
  banner: "banners",
} as const;
export type AppearanceMediaKind = keyof typeof APPEARANCE_MEDIA_FOLDERS;

const MEDIA_FILE_RE = /^[A-Za-z0-9_-]{1,64}\.(?:png|jpe?g|gif|webp)$/;
const ID_SEGMENT_RE = /^[A-Za-z0-9-]{1,64}$/;
const MAX_URL_LENGTH = 512;

/**
 * Parse a CDN media URL of the form `<cdn>/<folder>/<ownerId>/<file>`.
 * Returns the owner id and a canonical rebuilt URL, or null when the URL is
 * anything else (foreign host, query string, credentials, odd characters...).
 */
export function parseAppearanceMediaUrl(
  url: unknown,
  kinds: readonly AppearanceMediaKind[],
  cdnUrl: string = DEFAULT_CDN_URL,
): { ownerId: string; url: string } | null {
  if (typeof url !== "string" || url.length === 0 || url.length > MAX_URL_LENGTH) return null;
  let cdn: URL;
  let parsed: URL;
  try {
    cdn = new URL(cdnUrl);
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== cdn.protocol ||
    parsed.host !== cdn.host ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    return null;
  }
  const base = cdn.pathname.replace(/\/+$/, "");
  if (!parsed.pathname.startsWith(`${base}/`)) return null;
  const parts = parsed.pathname.slice(base.length + 1).split("/");
  if (parts.length !== 3) return null;
  const [folder, ownerId, file] = parts;
  const allowedFolders = kinds.map((k) => APPEARANCE_MEDIA_FOLDERS[k]) as string[];
  if (!allowedFolders.includes(folder)) return null;
  if (!ID_SEGMENT_RE.test(ownerId) || !MEDIA_FILE_RE.test(file)) return null;
  return { ownerId, url: `${cdn.origin}${base}/${folder}/${ownerId}/${file}` };
}

/** True when `url` is one of `userId`'s own uploads in an allowed folder. */
export function isOwnAppearanceMediaUrl(
  url: unknown,
  kinds: readonly AppearanceMediaKind[],
  userId: string,
  cdnUrl: string = DEFAULT_CDN_URL,
): boolean {
  const parsed = parseAppearanceMediaUrl(url, kinds, cdnUrl);
  return !!parsed && parsed.ownerId.toLowerCase() === String(userId).toLowerCase();
}

/** `url("...")` for an already-validated media URL, or null. */
export function cssImageUrl(url: unknown, kinds: readonly AppearanceMediaKind[], cdnUrl: string = DEFAULT_CDN_URL): string | null {
  const parsed = parseAppearanceMediaUrl(url, kinds, cdnUrl);
  return parsed ? `url("${parsed.url}")` : null;
}

// ── Colours ──────────────────────────────────────────────────────────────

const HEX6_RE = /^#[0-9a-f]{6}$/i;
const HEX3_RE = /^#[0-9a-f]{3}$/i;

/** `#rgb` / `#rrggbb` → lowercase `#rrggbb`; anything else → null. */
export function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (HEX6_RE.test(v)) return v.toLowerCase();
  if (HEX3_RE.test(v)) {
    const [r, g, b] = v.slice(1).toLowerCase();
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return null;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`;
}

/** Mix `a` toward `b` by `t` (0 = a, 1 = b). Both `#rrggbb`. */
export function mixHex(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex([0, 1, 2].map((i) => ca[i] + (cb[i] - ca[i]) * t) as [number, number, number]);
}

/** WCAG relative luminance of `#rrggbb`. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Keep a (server-provided) accent usable: white text on it stays readable
 * (≥ 3:1) and it doesn't vanish into the dark themes (≥ 3:1 against black).
 * Too light → darkened, too dark → lightened, in small steps.
 */
export function clampAccentForContrast(hex: string): string {
  let color = normalizeHexColor(hex) ?? "#8b5cf6";
  for (let i = 0; i < 40 && contrastRatio(color, "#ffffff") < 3; i++) color = mixHex(color, "#000000", 0.05);
  for (let i = 0; i < 40 && contrastRatio(color, "#000000") < 3; i++) color = mixHex(color, "#ffffff", 0.05);
  return color;
}

// ── Fonts ────────────────────────────────────────────────────────────────

const FONT_NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} _.-]{0,63}$/u;
const GENERIC_FONT_FAMILIES = new Set([
  "system-ui", "sans-serif", "serif", "monospace", "cursive",
  "ui-sans-serif", "ui-serif", "ui-monospace", "ui-rounded",
]);

/** Presets shown in Appearance → Font. "" is the default (Inter). */
export const FONT_PRESETS: readonly string[] = [
  "",
  "system-ui",
  "Segoe UI",
  "Roboto",
  "Helvetica Neue",
  "Arial",
  "Verdana",
  "Georgia",
  "ui-monospace",
  "JetBrains Mono",
  "Comic Sans MS",
];

/**
 * Normalize a font family name: "" means the default font; a valid name is
 * trimmed and inner whitespace collapsed; anything else (quotes, commas,
 * semicolons, braces, `url(`, too long) → null.
 */
export function sanitizeFontFamily(value: unknown): string | null {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") return null;
  const v = value.trim().replace(/\s+/g, " ");
  if (v === "") return "";
  return FONT_NAME_RE.test(v) ? v : null;
}

/** CSS `font-family` item for a sanitized name (generic keywords unquoted). */
export function fontFamilyCss(value: unknown): string | null {
  const name = sanitizeFontFamily(value);
  if (!name) return null;
  return GENERIC_FONT_FAMILIES.has(name.toLowerCase()) ? name.toLowerCase() : `"${name}"`;
}

/** Unique, sorted, valid family names from `queryLocalFonts()` results. */
export function uniqueFontFamilies(fonts: Iterable<{ family?: unknown }>): string[] {
  const out = new Set<string>();
  for (const f of fonts) {
    const name = sanitizeFontFamily(f?.family);
    if (name) out.add(name);
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

// ── Background image settings ────────────────────────────────────────────

export const BACKGROUND_DIM_DEFAULT = 50;
export const BACKGROUND_DIM_MAX = 90;
export const BACKGROUND_BLUR_MAX = 30;

function clampInt(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(Math.min(max, Math.max(min, value)));
}

export function clampBackgroundDim(value: unknown): number {
  return clampInt(value, 0, BACKGROUND_DIM_MAX) ?? BACKGROUND_DIM_DEFAULT;
}

export function clampBackgroundBlur(value: unknown): number {
  return clampInt(value, 0, BACKGROUND_BLUR_MAX) ?? 0;
}

/** Folders a custom app background may come from. */
export const BACKGROUND_MEDIA_KINDS: readonly AppearanceMediaKind[] = ["background", "banner"];

/**
 * Server-side check of the appearance fields this module owns, applied to a
 * settings PATCH (`settings.appearance`). Returns the cleaned patch or an
 * error message. Other appearance keys pass through untouched.
 */
export function sanitizeAppearanceSettingsPatch(
  appearance: Record<string, unknown>,
  opts: { userId: string; cdnUrl: string },
): { patch: Record<string, unknown> } | { error: string } {
  const next = { ...appearance };
  if ("backgroundImage" in next) {
    const v = next.backgroundImage;
    if (v === null || v === "") {
      next.backgroundImage = "";
    } else {
      const parsed = parseAppearanceMediaUrl(v, BACKGROUND_MEDIA_KINDS, opts.cdnUrl);
      if (!parsed || parsed.ownerId.toLowerCase() !== opts.userId.toLowerCase()) {
        return { error: "appearance.backgroundImage must be an image you uploaded to SerikaCord" };
      }
      next.backgroundImage = parsed.url;
    }
  }
  if ("backgroundDim" in next) next.backgroundDim = clampBackgroundDim(next.backgroundDim);
  if ("backgroundBlur" in next) next.backgroundBlur = clampBackgroundBlur(next.backgroundBlur);
  if ("fontFamily" in next) {
    const font = sanitizeFontFamily(next.fontFamily);
    if (font === null) return { error: "appearance.fontFamily must be a plain font name" };
    next.fontFamily = font;
  }
  if ("useServerThemes" in next && typeof next.useServerThemes !== "boolean") {
    return { error: "appearance.useServerThemes must be true or false" };
  }
  return { patch: next };
}

// ── Theme surfaces (custom background translucency + server tint) ────────

export type AppThemeName = "dark" | "midnight" | "light";

interface SurfacePalette {
  bg: string;
  sidebar: string;
  surface: string;
  surfaceAlt: string;
  card: string;
}

/** Mirrors the base tokens in globals.css (:root/.dark, .theme-midnight, .theme-light). */
const THEME_SURFACES: Record<AppThemeName, SurfacePalette> = {
  dark: { bg: "#05060a", sidebar: "#05060a", surface: "#0c0f17", surfaceAlt: "#131a28", card: "#0c0f17" },
  midnight: { bg: "#01040b", sidebar: "#040a14", surface: "#060b16", surfaceAlt: "#0b1423", card: "#060b16" },
  light: { bg: "#f4f7fc", sidebar: "#edf2fb", surface: "#ffffff", surfaceAlt: "#edf2fb", card: "#ffffff" },
};

/** How opaque each surface stays over a custom background. */
const TRANSLUCENT_ALPHA: Record<keyof SurfacePalette, number> = {
  bg: 0.55,
  sidebar: 0.6,
  surface: 0.74,
  surfaceAlt: 0.82,
  card: 0.78,
};

const SURFACE_VARS: Record<keyof SurfacePalette, string[]> = {
  bg: ["--app-bg", "--bg-app"],
  sidebar: ["--bg-sidebar"],
  surface: ["--app-surface", "--bg-sidebar-elevated"],
  surfaceAlt: ["--app-surface-alt"],
  card: ["--bg-card"],
};

/** CSS custom properties ThemeContext may set inline for surfaces. */
export const SURFACE_OVERRIDE_VARS: readonly string[] = Object.values(SURFACE_VARS).flat();

function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Inline surface tokens for the current theme: tinted toward a server's
 * background tint and/or made translucent so a custom background shows
 * through. Null when neither applies (the stylesheet defaults stay).
 */
export function computeSurfaceOverrides(opts: {
  theme: AppThemeName;
  tint?: string | null;
  translucent?: boolean;
}): Record<string, string> | null {
  const tint = normalizeHexColor(opts.tint);
  if (!tint && !opts.translucent) return null;
  const base = THEME_SURFACES[opts.theme] ?? THEME_SURFACES.dark;
  // Light themes need a lighter touch or the tint reads as a colour wash.
  const amount = opts.theme === "light" ? 0.06 : 0.1;
  const out: Record<string, string> = {};
  for (const key of Object.keys(base) as (keyof SurfacePalette)[]) {
    const color = tint ? mixHex(base[key], tint, amount) : base[key];
    const value = opts.translucent ? withAlpha(color, TRANSLUCENT_ALPHA[key]) : color;
    for (const cssVar of SURFACE_VARS[key]) out[cssVar] = value;
  }
  return out;
}

// ── Server themes (servers.settings.theme) ───────────────────────────────

export interface ServerTheme {
  accentColor: string | null;
  backgroundTint: string | null;
}

/**
 * Validate a server theme from a settings PATCH. `null` clears it. Each
 * colour is `#rrggbb` or null/"" (unset); anything else is rejected.
 */
export function sanitizeServerTheme(raw: unknown): { theme: ServerTheme | null } | { error: string } {
  if (raw === null) return { theme: null };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "theme must be an object" };
  const r = raw as Record<string, unknown>;
  const pick = (key: "accentColor" | "backgroundTint"): string | null | undefined => {
    const v = r[key];
    if (v === undefined || v === null || v === "") return null;
    return normalizeHexColor(v) ?? undefined;
  };
  const accentColor = pick("accentColor");
  if (accentColor === undefined) return { error: "theme.accentColor must be a hex colour like #8b5cf6" };
  const backgroundTint = pick("backgroundTint");
  if (backgroundTint === undefined) return { error: "theme.backgroundTint must be a hex colour like #8b5cf6" };
  if (!accentColor && !backgroundTint) return { theme: null };
  return { theme: { accentColor, backgroundTint } };
}

/** Read the stored theme back out of servers.settings (re-validated). */
export function readServerTheme(settings: unknown): ServerTheme | null {
  const raw = settings && typeof settings === "object" ? (settings as Record<string, unknown>).theme : undefined;
  if (raw === undefined || raw === null) return null;
  const result = sanitizeServerTheme(raw);
  return "theme" in result ? result.theme : null;
}
