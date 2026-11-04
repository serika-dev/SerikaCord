import type { CSSProperties } from "react";

/**
 * Readable text on custom profile themes.
 *
 * Profile cards paint the user's own colours (solid, gradient, glass,
 * holographic) behind their content. The card used to hard-code light text,
 * which vanished on light themes. `computeProfilePalette` samples every colour
 * that can sit behind the text (each gradient stop plus points in between,
 * since an sRGB blend can dip darker than both ends), picks light or dark
 * text, adds a scrim when one tone can't reach WCAG AA everywhere, and nudges
 * each text token until it passes against the worst sample. The result is a
 * set of CSS variables the card sets on its root (`--profile-*`), plus
 * overrides of the global text tokens so nested shared components follow.
 *
 * Pure: no DOM, no React state. Covered by tests/profile-contrast.test.ts.
 */

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

const clamp255 = (n: number) => Math.max(0, Math.min(255, n));
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

const NAMED: Record<string, RGBA> = {
  white: { r: 255, g: 255, b: 255, a: 1 },
  black: { r: 0, g: 0, b: 0, a: 1 },
  transparent: { r: 0, g: 0, b: 0, a: 0 },
};

/** Parses #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba() (comma or space syntax) and a few names. A trailing stop position ("#fff 40%") is ignored. */
export function parseColor(input: string | null | undefined): RGBA | null {
  if (!input || typeof input !== "string") return null;
  const s = input.trim().toLowerCase();
  if (!s) return null;
  const fn = /^rgba?\(([^)]*)\)/.exec(s);
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const ch = (p: string) => (p.endsWith("%") ? (parseFloat(p) / 100) * 255 : parseFloat(p));
    const [r, g, b] = parts.slice(0, 3).map(ch);
    let a = 1;
    if (parts[3] !== undefined) a = parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    if ([r, g, b, a].some((n) => !Number.isFinite(n))) return null;
    return { r: clamp255(r), g: clamp255(g), b: clamp255(b), a: clamp01(a) };
  }
  const token = s.split(/\s+/)[0];
  if (NAMED[token]) return { ...NAMED[token] };
  const hex = /^#([0-9a-f]{3,8})$/.exec(token);
  if (!hex) return null;
  let h = hex[1];
  if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6 && h.length !== 8) return null;
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
}

const lin = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};

/** WCAG 2.x relative luminance (alpha ignored; composite first). */
export function relativeLuminance(c: RGBA): number {
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/** WCAG contrast ratio, 1..21. Accepts colours or CSS strings (unparseable = black). */
export function contrastRatio(a: RGBA | string, b: RGBA | string): number {
  const ca = typeof a === "string" ? parseColor(a) ?? NAMED.black : a;
  const cb = typeof b === "string" ? parseColor(b) ?? NAMED.black : b;
  const la = relativeLuminance(ca);
  const lb = relativeLuminance(cb);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Source-over compositing of `top` onto an opaque `bottom` (sRGB, as browsers blend). */
export function composite(top: RGBA, bottom: RGBA): RGBA {
  const a = top.a;
  return {
    r: top.r * a + bottom.r * (1 - a),
    g: top.g * a + bottom.g * (1 - a),
    b: top.b * a + bottom.b * (1 - a),
    a: 1,
  };
}

/** Linear sRGB-space mix (what a CSS gradient does between two stops). */
export function mix(a: RGBA, b: RGBA, t: number): RGBA {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t, a: a.a + (b.a - a.a) * t };
}

export function toCss(c: RGBA): string {
  const r = Math.round(c.r);
  const g = Math.round(c.g);
  const b = Math.round(c.b);
  if (c.a >= 0.999) return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  return `rgba(${r}, ${g}, ${b}, ${Math.round(c.a * 1000) / 1000})`;
}

const withAlpha = (c: RGBA, a: number): RGBA => ({ ...c, a });

/**
 * Every colour a gradient paints: the stops plus `perSegment - 1` points
 * between each pair. Luminance along an sRGB blend is convex, so its minimum
 * can sit between two stops (red → green dips through olive).
 */
export function sampleGradient(stops: RGBA[], perSegment = 8): RGBA[] {
  if (stops.length <= 1) return stops.slice();
  const out: RGBA[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    for (let k = 0; k < perSegment; k++) out.push(mix(stops[i], stops[i + 1], k / perSegment));
  }
  out.push(stops[stops.length - 1]);
  return out;
}

/** Lowest contrast of `fg` against any of `bgs`. */
export function worstContrast(fg: RGBA, bgs: RGBA[]): number {
  let worst = Infinity;
  for (const bg of bgs) worst = Math.min(worst, contrastRatio(fg, bg));
  return worst === Infinity ? 21 : worst;
}

// ── profile palette ──

export interface ProfileThemeInput {
  profileColor?: string;
  profileAccentColor?: string;
  profileGradient?: string[];
  profileCardEffect?: "normal" | "glassmorphism" | "glow" | "holographic" | "neon";
  profileCardOpacity?: number;
  [key: string]: unknown;
}

export interface ProfilePaletteOptions {
  /** What shows through a translucent card (glass, alpha stops). Default: the card's dark base. */
  backdrop?: string;
  /** The card is rendered with `getProfileBackgroundStyle(..., { opaque: true })`. Default true. */
  opaque?: boolean;
  /** A wash painted over the card colours before the text (e.g. the mobile profile page). */
  overlay?: { color: string; alpha: number };
  /** More colours that sit behind the text, e.g. a banner's average colour when the body uses the banner. */
  extraColors?: (string | null | undefined)[];
}

/** The dark card everything used to assume. */
export const PROFILE_CARD_BASE = "#0c0c10";
const HOLOGRAPHIC = ["#ff7b00", "#ff007b", "#9900ff", "#0022ff", "#00ff77"];

export const AA_TEXT = 4.5;
/** What the strongest text reaches on the body, so muted shades have room to pass too. */
const BODY_TARGET = 6;
export const AA_LARGE = 3;

export type ProfileVarName =
  | "--profile-fg"
  | "--profile-text"
  | "--profile-muted"
  | "--profile-faint"
  | "--profile-section-bg"
  | "--profile-section-border"
  | "--profile-chip-bg"
  | "--profile-border"
  | "--profile-button-bg"
  | "--profile-button-hover"
  | "--profile-hover"
  | "--profile-scrim"
  | "--profile-ring"
  | "--profile-banner-fade"
  | "--profile-pane-bg";

export interface ProfilePalette {
  /** "dark" = light text on a dark card, "light" = dark text on a light card. */
  tone: "dark" | "light";
  /** The user set their own card colours. */
  custom: boolean;
  /** Body scrim alpha (0 = none). */
  scrimAlpha: number;
  tokens: Record<ProfileVarName, string>;
  /** Every opaque colour body text can land on (body, sections, chips, pane). */
  surfaces: RGBA[];
  /** Body colours only (outside sections), for the display name. */
  bodySurfaces: RGBA[];
  /** Lowest contrast each token reaches where it is used (muted/faint: body, sections, pane; fg/text: those plus chips and buttons). */
  contrast: { fg: number; text: number; muted: number; faint: number };
  /** CSS custom properties for the card root (profile tokens + global text token overrides). */
  vars: CSSProperties;
}

/** The look profile cards have always had on the default dark card; kept exactly so dark themes don't change. */
const DARK_DEFAULT: Record<ProfileVarName, string> = {
  "--profile-fg": "#ffffff",
  "--profile-text": "#e2e2ee",
  "--profile-muted": "#9a9aad",
  "--profile-faint": "rgba(255, 255, 255, 0.4)",
  "--profile-section-bg": "rgba(255, 255, 255, 0.03)",
  "--profile-section-border": "rgba(255, 255, 255, 0.05)",
  "--profile-chip-bg": "rgba(255, 255, 255, 0.04)",
  "--profile-border": "rgba(255, 255, 255, 0.06)",
  "--profile-button-bg": "rgba(255, 255, 255, 0.06)",
  "--profile-button-hover": "rgba(255, 255, 255, 0.12)",
  "--profile-hover": "rgba(255, 255, 255, 0.05)",
  "--profile-scrim": "transparent",
  "--profile-ring": PROFILE_CARD_BASE,
  "--profile-banner-fade": "rgba(12, 12, 16, 0.7)",
  "--profile-pane-bg": "#111114",
};

/** The colours a profile card paints behind its content, already composited to opaque. */
export function getProfileCardColors(c: ProfileThemeInput | null | undefined, opts: ProfilePaletteOptions = {}): { colors: RGBA[]; custom: boolean } {
  const backdrop = parseColor(opts.backdrop) ?? (parseColor(PROFILE_CARD_BASE) as RGBA);
  const opaque = opts.opaque !== false;
  let stops: RGBA[] = [];
  let custom = false;
  if (c) {
    const effect = c.profileCardEffect ?? "normal";
    const grad = Array.isArray(c.profileGradient) ? c.profileGradient.map(parseColor).filter((x): x is RGBA => !!x) : [];
    if (effect === "holographic") {
      stops = HOLOGRAPHIC.map((h) => parseColor(h) as RGBA);
      custom = true;
    } else if (grad.length >= 2) {
      stops = grad;
      custom = true;
    } else {
      const solid = parseColor(c.profileColor);
      if (solid) {
        stops = [solid];
        custom = true;
      }
    }
    if (effect === "glassmorphism" && !opaque) {
      const op = typeof c.profileCardOpacity === "number" ? clamp01(c.profileCardOpacity) : 0.85;
      stops = (stops.length ? stops : [parseColor("rgb(12, 12, 16)") as RGBA]).map((s) => withAlpha(s, s.a * op));
      custom = true;
    }
  }
  if (!stops.length) stops = [backdrop];
  let colors = sampleGradient(stops).map((s) => (s.a < 1 ? composite(s, backdrop) : s));
  const overlay = opts.overlay ? parseColor(opts.overlay.color) : null;
  if (overlay && opts.overlay) {
    const ov = withAlpha(overlay, clamp01(opts.overlay.alpha) * overlay.a);
    colors = colors.map((s) => composite(ov, s));
    custom = true;
  }
  for (const extra of opts.extraColors ?? []) {
    const e = parseColor(extra);
    if (e) {
      colors.push(e.a < 1 ? composite(e, backdrop) : e);
      custom = true;
    }
  }
  return { colors, custom };
}

const over = (layer: RGBA, bgs: RGBA[]) => (layer.a > 0 ? bgs.map((b) => composite(layer, b)) : bgs);

/** Moves `start` toward `toward` in 5% steps until it reaches `target` contrast on every surface. */
function adjustToPass(start: RGBA, toward: RGBA, surfaces: RGBA[], target: number): RGBA {
  for (let i = 0; i <= 20; i++) {
    const c = mix(start, toward, i / 20);
    if (worstContrast(c, surfaces) >= target) return c;
  }
  return toward;
}

/** Smallest alpha (2.5% steps, capped) of `scrim` over `bgs` for which `fg` reaches `target`. */
function scrimFor(fg: RGBA, scrim: RGBA, bgs: RGBA[], target: number, cap: number, layers: RGBA[] = []): number {
  for (let a = 0; a <= cap + 1e-9; a += 0.025) {
    const body = over(withAlpha(scrim, a), bgs);
    const all = [body, ...layers.map((l) => over(l, body))].flat();
    if (worstContrast(fg, all) >= target) return Math.round(a * 1000) / 1000;
  }
  return cap;
}

function buildVars(tokens: Record<ProfileVarName, string>): CSSProperties {
  const vars: Record<string, string> = { ...tokens };
  // Shared components inside the card (note field, server tag, ...) read the
  // app's text tokens; point them at the card's own.
  vars["--text-primary"] = tokens["--profile-text"];
  vars["--text-secondary"] = tokens["--profile-muted"];
  vars["--text-muted"] = tokens["--profile-muted"];
  vars["--border-subtle"] = tokens["--profile-border"];
  vars["--bg-hover"] = tokens["--profile-hover"];
  return vars as CSSProperties;
}

/**
 * Picks the card's text and surface tokens. Default and dark themes on which
 * the classic tokens already pass AA keep them exactly.
 */
export function computeProfilePalette(c: ProfileThemeInput | null | undefined, opts: ProfilePaletteOptions = {}): ProfilePalette {
  const { colors, custom } = getProfileCardColors(c, opts);
  const P = (s: string) => parseColor(s) as RGBA;

  // 1. Do the classic dark tokens already pass here? Then nothing changes.
  const darkSurfaces = [
    ...colors,
    ...over(P(DARK_DEFAULT["--profile-section-bg"]), colors),
    ...over(P(DARK_DEFAULT["--profile-chip-bg"]), colors),
    ...over(P(DARK_DEFAULT["--profile-button-bg"]), colors),
  ];
  const classic = {
    fg: worstContrast(P(DARK_DEFAULT["--profile-fg"]), darkSurfaces),
    text: worstContrast(P(DARK_DEFAULT["--profile-text"]), darkSurfaces),
    muted: worstContrast(P(DARK_DEFAULT["--profile-muted"]), darkSurfaces),
  };
  if (!custom || (classic.muted >= AA_TEXT && classic.text >= AA_TEXT && classic.fg >= AA_TEXT)) {
    const tokens = { ...DARK_DEFAULT };
    return {
      tone: "dark",
      custom,
      scrimAlpha: 0,
      tokens,
      surfaces: darkSurfaces,
      bodySurfaces: colors,
      contrast: { ...classic, faint: worstContrast(composite(P(tokens["--profile-faint"]), colors[0]), colors) },
      vars: buildVars(tokens),
    };
  }

  // 2. Pick the tone whose extreme text colour does better in the worst spot.
  // Light text gets a 20% head start: on saturated mid colours (violet, blue)
  // white text with a light dark scrim keeps the colour the user picked,
  // where dark text would need the colour washed out.
  const WHITE = P("#ffffff");
  const INK = P("#0b0b10");
  const tone: "dark" | "light" = worstContrast(WHITE, colors) >= worstContrast(INK, colors) * 0.8 ? "dark" : "light";
  const fg = tone === "dark" ? WHITE : INK;
  const scrimColor = tone === "dark" ? P("#08080c") : WHITE;

  const layers = tone === "dark"
    ? { section: P("rgba(0, 0, 0, 0.18)"), chip: P("rgba(255, 255, 255, 0.08)"), button: P("rgba(255, 255, 255, 0.1)"), hover: "rgba(255, 255, 255, 0.08)", buttonHover: "rgba(255, 255, 255, 0.16)", border: "rgba(255, 255, 255, 0.1)", sectionBorder: "rgba(255, 255, 255, 0.08)" }
    : { section: P("rgba(255, 255, 255, 0.4)"), chip: P("rgba(0, 0, 0, 0.07)"), button: P("rgba(0, 0, 0, 0.07)"), hover: "rgba(0, 0, 0, 0.06)", buttonHover: "rgba(0, 0, 0, 0.12)", border: "rgba(0, 0, 0, 0.12)", sectionBorder: "rgba(0, 0, 0, 0.08)" };

  // 3. Body scrim: enough that the strongest text clears AA with headroom on
  // the body and on chips / buttons sitting on it, so the muted tone can too.
  const scrimAlpha = scrimFor(fg, scrimColor, colors, BODY_TARGET, 0.8, [layers.chip, layers.button]);
  const body = over(withAlpha(scrimColor, scrimAlpha), colors);

  // 4. Sections get their own layer; thicken it until body text reaches 7:1 inside.
  let section = layers.section;
  for (let a = section.a; a <= 0.9 + 1e-9; a += 0.05) {
    section = withAlpha(section, Math.round(a * 1000) / 1000);
    if (worstContrast(fg, over(section, body)) >= 7) break;
  }

  // 5. The desktop full-profile pane: classic opaque dark on dark tones, frosted on light ones.
  const paneLayer = tone === "dark" ? P(DARK_DEFAULT["--profile-pane-bg"]) : P("rgba(255, 255, 255, 0.55)");
  // Muted and faint text (labels, dates, placeholders) sits on the body,
  // sections and the pane; chips and buttons carry the main text colour.
  const textSurfaces = [...body, ...over(section, body), ...over(paneLayer, colors)];
  const surfaces = [...textSurfaces, ...over(layers.chip, body), ...over(layers.button, body)];

  // 6. Text tokens start from the tone's usual shades and move toward the
  // extreme until they pass on every surface they're used on.
  const text = adjustToPass(tone === "dark" ? P("#e2e2ee") : P("#1c1c24"), fg, surfaces, AA_TEXT);
  const muted = adjustToPass(tone === "dark" ? P("#a8a8ba") : P("#4a4a5a"), fg, textSurfaces, AA_TEXT);
  const faint = adjustToPass(mix(fg, scrimColor, 0.55), fg, textSurfaces, AA_LARGE);

  const ring = body[0];
  const tokens: Record<ProfileVarName, string> = {
    "--profile-fg": toCss(fg),
    "--profile-text": toCss(text),
    "--profile-muted": toCss(muted),
    "--profile-faint": toCss(faint),
    "--profile-section-bg": toCss(section),
    "--profile-section-border": layers.sectionBorder,
    "--profile-chip-bg": toCss(layers.chip),
    "--profile-border": layers.border,
    "--profile-button-bg": toCss(layers.button),
    "--profile-button-hover": layers.buttonHover,
    "--profile-hover": layers.hover,
    "--profile-scrim": scrimAlpha > 0 ? toCss(withAlpha(scrimColor, scrimAlpha)) : "transparent",
    "--profile-ring": toCss(ring),
    "--profile-banner-fade": toCss(withAlpha(ring, 0.7)),
    "--profile-pane-bg": toCss(paneLayer),
  };
  return {
    tone,
    custom,
    scrimAlpha,
    tokens,
    surfaces,
    bodySurfaces: body,
    contrast: {
      fg: worstContrast(fg, surfaces),
      text: worstContrast(text, surfaces),
      muted: worstContrast(muted, textSurfaces),
      faint: worstContrast(faint, textSurfaces),
    },
    // Inputs (the note field) get their own surface so typing stays readable.
    vars: { ...buildVars(tokens), "--profile-input-bg": tone === "dark" ? "rgba(0, 0, 0, 0.35)" : "rgba(255, 255, 255, 0.75)" } as CSSProperties,
  };
}

/** A role's colour when it reads on this card, else the card's text colour. */
export function readableRoleColor(color: string | null | undefined, palette: ProfilePalette): string {
  const c = parseColor(color);
  if (!c || c.a < 1) return "var(--profile-text)";
  return worstContrast(c, palette.surfaces) >= AA_TEXT ? (color as string) : "var(--profile-text)";
}
