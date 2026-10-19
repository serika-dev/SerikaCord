// Nameplate presets — decorative backgrounds shown behind a user's name in the
// member list, DM list, and the sidebar user panel. Presets are CSS-based so
// they work without external image assets. Users can also pick a custom solid
// colour or gradient, or upload an image (CORD-44).

import type { CSSProperties } from "react";
import { cssImageUrl, normalizeHexColor, parseAppearanceMediaUrl } from "@/lib/appearance/customization";

export interface NameplatePreset {
  id: string;
  name: string;
  /** CSS `background` value used for the plate. */
  css: string;
}

export const NAMEPLATE_PRESETS: NameplatePreset[] = [
  { id: "sunset", name: "Sunset", css: "linear-gradient(90deg, #ff7e5f 0%, #feb47b 100%)" },
  { id: "ocean", name: "Ocean", css: "linear-gradient(90deg, #2193b0 0%, #6dd5ed 100%)" },
  { id: "grape", name: "Grape", css: "linear-gradient(90deg, #654ea3 0%, #eaafc8 100%)" },
  { id: "mint", name: "Mint", css: "linear-gradient(90deg, #11998e 0%, #38ef7d 100%)" },
  { id: "ember", name: "Ember", css: "linear-gradient(90deg, #f12711 0%, #f5af19 100%)" },
  { id: "midnight", name: "Midnight", css: "linear-gradient(90deg, #0f2027 0%, #203a43 50%, #2c5364 100%)" },
  { id: "sakura", name: "Sakura", css: "linear-gradient(90deg, #ffdde1 0%, #ee9ca7 100%)" },
  { id: "aurora", name: "Aurora", css: "linear-gradient(90deg, #00c3ff 0%, #7b2ff7 50%, #ff5edf 100%)" },
  { id: "gold", name: "Gold", css: "linear-gradient(90deg, #b8860b 0%, #ffd700 50%, #b8860b 100%)" },
  { id: "slate", name: "Slate", css: "linear-gradient(90deg, #434343 0%, #000000 100%)" },
  { id: "bubblegum", name: "Bubblegum", css: "linear-gradient(90deg, #ff9a9e 0%, #fad0c4 100%)" },
  { id: "neon", name: "Neon", css: "linear-gradient(90deg, #f857a6 0%, #ff5858 100%)" },
];

export function getNameplatePreset(id?: string | null): NameplatePreset | undefined {
  if (!id) return undefined;
  return NAMEPLATE_PRESETS.find((p) => p.id === id);
}

export interface NameplateCustomization {
  type?: "none" | "color" | "gradient" | "preset" | "image";
  color?: string;
  gradient?: string[];
  presetId?: string;
  /** type "image": the user's own upload, `<CDN>/nameplates/<userId>/<file>` (CORD-44). */
  imageUrl?: string;
}

/**
 * Returns the `background` CSS value for a user's nameplate, or `null` when the
 * user has no nameplate set. Callers typically render this as a low-opacity
 * layer behind the name.
 */
export function getNameplateBackground(
  // Index signature keeps this from being a "weak type", so any customization
  // object (with or without a declared `nameplate` field) can be passed.
  customization?: { nameplate?: NameplateCustomization | null; [key: string]: unknown } | null,
): string | null {
  const np = customization?.nameplate;
  if (!np || !np.type || np.type === "none") return null;

  // Every value is re-checked here: stored data predates server validation,
  // and this string goes straight into a `background` style.
  if (np.type === "color") return normalizeHexColor(np.color);
  if (np.type === "gradient" && Array.isArray(np.gradient) && np.gradient.length >= 2) {
    const stops = np.gradient.slice(0, 4).map(normalizeHexColor);
    if (stops.some((c) => !c)) return null;
    return `linear-gradient(90deg, ${stops.join(", ")})`;
  }
  if (np.type === "preset") {
    return getNameplatePreset(np.presetId)?.css ?? null;
  }
  if (np.type === "image") {
    const url = cssImageUrl(np.imageUrl, ["nameplate"]);
    return url ? `${url} center / cover no-repeat` : null;
  }
  return null;
}

/**
 * Server-side validation of a nameplate from a profile PATCH. Colours must be
 * hex, presets must exist, and an image must be the user's own upload on our
 * CDN (POST /api/upload/appearance/nameplate). Returns the clean value that
 * replaces the stored nameplate, or an error.
 */
export function sanitizeNameplate(
  raw: unknown,
  opts: { userId: string; cdnUrl: string },
): { nameplate: NameplateCustomization } | { error: string } {
  if (raw === null || raw === undefined) return { nameplate: { type: "none" } };
  if (typeof raw !== "object" || Array.isArray(raw)) return { error: "nameplate must be an object" };
  const np = raw as Record<string, unknown>;
  // A type picked without a value yet (e.g. "Image" before uploading) means
  // no nameplate rather than a failed profile save.
  const NONE = { nameplate: { type: "none" } as NameplateCustomization };
  const missing = (v: unknown) => v === undefined || v === null || v === "";
  switch (np.type ?? "none") {
    case "none":
      return { nameplate: { type: "none" } };
    case "color": {
      if (missing(np.color)) return NONE;
      const color = normalizeHexColor(np.color);
      return color ? { nameplate: { type: "color", color } } : { error: "nameplate.color must be a hex colour" };
    }
    case "gradient": {
      if (missing(np.gradient)) return NONE;
      const list = Array.isArray(np.gradient) ? np.gradient : [];
      const stops = list.map(normalizeHexColor);
      if (stops.length < 2 || stops.length > 4 || stops.some((c) => !c)) {
        return { error: "nameplate.gradient must be 2 to 4 hex colours" };
      }
      return { nameplate: { type: "gradient", gradient: stops as string[] } };
    }
    case "preset": {
      if (missing(np.presetId)) return NONE;
      const preset = getNameplatePreset(typeof np.presetId === "string" ? np.presetId : null);
      return preset ? { nameplate: { type: "preset", presetId: preset.id } } : { error: "Unknown nameplate preset" };
    }
    case "image": {
      if (missing(np.imageUrl)) return NONE;
      const parsed = parseAppearanceMediaUrl(np.imageUrl, ["nameplate"], opts.cdnUrl);
      if (!parsed || parsed.ownerId.toLowerCase() !== opts.userId.toLowerCase()) {
        return { error: "nameplate.imageUrl must be an image you uploaded to SerikaCord" };
      }
      return { nameplate: { type: "image", imageUrl: parsed.url } };
    }
    default:
      return { error: "Unknown nameplate type" };
  }
}

/**
 * Convenience style for a full-bleed nameplate layer. Render inside a
 * `position: relative` row, behind the name content, e.g.:
 *   {bg && <div className="absolute inset-0 -z-0" style={getNameplateLayerStyle(bg)} />}
 */
export function getNameplateLayerStyle(background: string, opacity = 0.5): CSSProperties {
  return { background, opacity };
}
