/**
 * Read-side guards for profile customization values that end up in CSS
 * (display name style, profile card background / border).
 *
 * The API validates what it stores (customizationPatch.ts), but rows written
 * before that validation existed may hold anything a modded client sent. These
 * helpers run where a value becomes a style, so a stored `url(...)`, `;` or
 * `}` never reaches `background` / `color` / `box-shadow`.
 *
 * Pure (no env, DB or React): shared by the client and tests.
 */

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const NUM = String.raw`\s*-?\d{1,3}(?:\.\d{1,4})?%?\s*`;
const RGB_RE = new RegExp(String.raw`^rgba?\(${NUM},${NUM},${NUM}(?:,${NUM})?\)$`, "i");

/** A colour that is safe inside a CSS value (`#hex` or numeric `rgb()`/`rgba()`), or null. */
export function safeCssColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (v.length === 0 || v.length > 48) return null;
  if (HEX_RE.test(v) || RGB_RE.test(v)) return v;
  return null;
}

/**
 * Gradient stops: every entry must be a safe colour, else the whole gradient
 * is dropped (a half-gradient would look broken anyway). Capped at `max` stops.
 */
export function safeCssColorList(value: unknown, max = 6): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > max) return [];
  const out: string[] = [];
  for (const c of value) {
    const safe = safeCssColor(c);
    if (!safe) return [];
    out.push(safe);
  }
  return out;
}

/** A finite number clamped to [min, max]; `fallback` for anything else. */
export function safeNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** Gradient angle in degrees, normalised into [0, 360). */
export function safeGradientAngle(value: unknown, fallback = 135): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return ((Math.round(value) % 360) + 360) % 360;
}

/** Keyword positions a radial profile gradient may use (`circle at <pos>`). */
export const RADIAL_POSITIONS = [
  "center",
  "top",
  "bottom",
  "left",
  "right",
  "top left",
  "top right",
  "bottom left",
  "bottom right",
] as const;
export type RadialPosition = (typeof RADIAL_POSITIONS)[number];

const PERCENT_POSITION_RE = /^(?:100|[1-9]?\d)% (?:100|[1-9]?\d)%$/;

/** A radial gradient position: a keyword above or `NN% NN%`, else `fallback`. */
export function safeRadialPosition(value: unknown, fallback = "center"): string {
  if (typeof value !== "string") return fallback;
  const v = value.trim().toLowerCase().replace(/\s+/g, " ");
  if ((RADIAL_POSITIONS as readonly string[]).includes(v)) return v;
  if (PERCENT_POSITION_RE.test(v)) return v;
  return fallback;
}

/** `oneOf(value, list, fallback)`: an enum member or the fallback. */
export function safeEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/**
 * A custom status emoji image URL that may go into `<img src>`: our CDN
 * (`cdnBase`) or a same-origin path. Anything else (other hosts, `javascript:`,
 * `data:`, protocol-relative) is null.
 */
export function safeStatusEmojiUrl(url: unknown, cdnBase: string): string | null {
  if (typeof url !== "string") return null;
  const u = url.trim();
  if (!u || u.length > 512) return null;
  if (/^\/(?![/\\])/.test(u)) return u;
  const base = cdnBase.replace(/\/+$/, "");
  if (!base || !u.startsWith(base + "/")) return null;
  try {
    const parsed = new URL(u);
    const baseUrl = new URL(base);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (parsed.origin !== baseUrl.origin) return null;
    return u;
  } catch {
    return null;
  }
}
