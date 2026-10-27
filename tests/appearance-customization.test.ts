import { describe, expect, test } from "bun:test";
import {
  DEFAULT_THEME_GRADIENT,
  GRADIENT_SURFACE_ALPHA,
  SURFACE_OVERRIDE_VARS,
  SURFACE_SOLID_VARS,
  THEME_SURFACES,
  THEME_TEXT,
  clampAccentForContrast,
  clampBackgroundBlur,
  clampBackgroundDim,
  compositeOver,
  computeSurfaceOverrides,
  contrastRatio,
  gradientFromTint,
  hexToRgb,
  mixHex,
  parseThemeGradientKey,
  readUserThemeGradient,
  relativeLuminance,
  renderThemeGradient,
  resolveThemeGradient,
  sanitizeThemeGradient,
  serverThemeGradient,
  themeGradientCss,
  themeGradientKey,
  themeGradientMean,
  userThemeGradient,
  type AppThemeName,
  cssImageUrl,
  fontFamilyCss,
  isOwnAppearanceMediaUrl,
  normalizeHexColor,
  parseAppearanceMediaUrl,
  readServerTheme,
  sanitizeAppearanceSettingsPatch,
  sanitizeFontFamily,
  sanitizeServerTheme,
  uniqueFontFamilies,
} from "../src/lib/appearance/customization";
import { THEME_GRADIENT_PRESETS, findThemeGradientPreset } from "../src/lib/appearance/themeGradients";
import { getNameplateBackground, sanitizeNameplate } from "../src/lib/constants/nameplates";

const CDN = "https://cdn.serika.chat";
const USER = "6a4a60b4-8ea4-59dc-83a8-490d00000000";
const OTHER = "11111111-2222-3333-4444-555555555555";
const bg = (owner = USER, file = "AbCdEf0123456789.webp") => `${CDN}/backgrounds/${owner}/${file}`;
const plate = (owner = USER) => `${CDN}/nameplates/${owner}/Xy_-0123456789ab.png`;

describe("appearance media URLs", () => {
  test("accepts own CDN uploads and rebuilds them", () => {
    expect(parseAppearanceMediaUrl(bg(), ["background"], CDN)).toEqual({ ownerId: USER, url: bg() });
    expect(isOwnAppearanceMediaUrl(bg(), ["background"], USER, CDN)).toBe(true);
    expect(isOwnAppearanceMediaUrl(bg(), ["background"], USER.toUpperCase(), CDN)).toBe(true);
  });

  test("rejects other users, folders, hosts and tricks", () => {
    expect(isOwnAppearanceMediaUrl(bg(OTHER), ["background"], USER, CDN)).toBe(false);
    expect(parseAppearanceMediaUrl(bg(), ["nameplate"], CDN)).toBeNull();
    expect(parseAppearanceMediaUrl(`https://evil.example/backgrounds/${USER}/a.png`, ["background"], CDN)).toBeNull();
    expect(parseAppearanceMediaUrl(`http://cdn.serika.chat/backgrounds/${USER}/a.png`, ["background"], CDN)).toBeNull();
    expect(parseAppearanceMediaUrl(`${bg()}?x=1`, ["background"], CDN)).toBeNull();
    expect(parseAppearanceMediaUrl(`${bg()}#x`, ["background"], CDN)).toBeNull();
    expect(parseAppearanceMediaUrl(`https://a:b@cdn.serika.chat/backgrounds/${USER}/a.png`, ["background"], CDN)).toBeNull();
    expect(parseAppearanceMediaUrl(`${CDN}/backgrounds/${USER}/a.svg`, ["background"], CDN)).toBeNull();
    expect(parseAppearanceMediaUrl(`${CDN}/backgrounds/${USER}/x/a.png`, ["background"], CDN)).toBeNull();
    expect(parseAppearanceMediaUrl(`${CDN}/backgrounds/${USER}/a").png`, ["background"], CDN)).toBeNull();
    expect(parseAppearanceMediaUrl(`${CDN}/backgrounds/../avatars/a.png`, ["background"], CDN)).toBeNull();
    expect(parseAppearanceMediaUrl("javascript:alert(1)", ["background"], CDN)).toBeNull();
    expect(parseAppearanceMediaUrl(42, ["background"], CDN)).toBeNull();
  });

  test("cssImageUrl quotes only validated URLs", () => {
    expect(cssImageUrl(bg(), ["background"], CDN)).toBe(`url("${bg()}")`);
    expect(cssImageUrl("x); background: red", ["background"], CDN)).toBeNull();
  });
});

describe("colours and contrast", () => {
  test("normalizeHexColor", () => {
    expect(normalizeHexColor("#ABCDEF")).toBe("#abcdef");
    expect(normalizeHexColor("#abc")).toBe("#aabbcc");
    expect(normalizeHexColor("red")).toBeNull();
    expect(normalizeHexColor("url(x)")).toBeNull();
    expect(normalizeHexColor("#12345")).toBeNull();
  });

  test("clampAccentForContrast keeps white text readable and avoids near-black", () => {
    for (const c of ["#ffffff", "#ffff00", "#000000", "#010203", "#8b5cf6"]) {
      const out = clampAccentForContrast(c);
      expect(contrastRatio(out, "#ffffff")).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(out, "#000000")).toBeGreaterThanOrEqual(2.9);
    }
    expect(clampAccentForContrast("#5b3fd6")).toBe("#5b3fd6");
  });
});

describe("fonts", () => {
  test("sanitizeFontFamily", () => {
    expect(sanitizeFontFamily("  JetBrains   Mono ")).toBe("JetBrains Mono");
    expect(sanitizeFontFamily("")).toBe("");
    expect(sanitizeFontFamily(undefined)).toBe("");
    expect(sanitizeFontFamily("メイリオ")).toBe("メイリオ");
    expect(sanitizeFontFamily('Arial"; color: red')).toBeNull();
    expect(sanitizeFontFamily("a, b")).toBeNull();
    expect(sanitizeFontFamily("url(x)")).toBeNull();
    expect(sanitizeFontFamily("x".repeat(65))).toBeNull();
    expect(sanitizeFontFamily(5)).toBeNull();
  });

  test("fontFamilyCss quotes names, keeps generic keywords", () => {
    expect(fontFamilyCss("Fira Code")).toBe('"Fira Code"');
    expect(fontFamilyCss("system-ui")).toBe("system-ui");
    expect(fontFamilyCss("")).toBeNull();
    expect(fontFamilyCss("bad;")).toBeNull();
  });

  test("uniqueFontFamilies dedupes and drops invalid names", () => {
    expect(uniqueFontFamilies([{ family: "Roboto" }, { family: "Arial" }, { family: "Roboto" }, { family: "x{y}" }])).toEqual(["Arial", "Roboto"]);
  });
});

describe("appearance settings patch", () => {
  const opts = { userId: USER, cdnUrl: CDN };
  test("accepts valid values and clamps sliders", () => {
    const r = sanitizeAppearanceSettingsPatch({ backgroundImage: bg(), backgroundDim: 200, backgroundBlur: -4, fontFamily: " Inter ", theme: "dark" }, opts);
    expect(r).toEqual({ patch: { backgroundImage: bg(), backgroundDim: 90, backgroundBlur: 0, fontFamily: "Inter", theme: "dark" } });
  });
  test("own profile banner may be the background; clearing works", () => {
    expect("patch" in sanitizeAppearanceSettingsPatch({ backgroundImage: `${CDN}/banners/${USER}/AbCdEf0123456789.gif` }, opts)).toBe(true);
    expect(sanitizeAppearanceSettingsPatch({ backgroundImage: null }, opts)).toEqual({ patch: { backgroundImage: "" } });
  });
  test("rejects foreign images, bad fonts, non-boolean toggles", () => {
    expect("error" in sanitizeAppearanceSettingsPatch({ backgroundImage: bg(OTHER) }, opts)).toBe(true);
    expect("error" in sanitizeAppearanceSettingsPatch({ backgroundImage: "https://evil.example/a.png" }, opts)).toBe(true);
    expect("error" in sanitizeAppearanceSettingsPatch({ fontFamily: "x;y" }, opts)).toBe(true);
    expect("error" in sanitizeAppearanceSettingsPatch({ useServerThemes: "yes" }, opts)).toBe(true);
  });
  test("slider clamps", () => {
    expect(clampBackgroundDim("x")).toBe(50);
    expect(clampBackgroundBlur(12.6)).toBe(13);
  });
});

describe("surface overrides", () => {
  test("null when nothing applies", () => {
    expect(computeSurfaceOverrides({ theme: "dark" })).toBeNull();
  });
  test("translucent surfaces for a background", () => {
    const o = computeSurfaceOverrides({ theme: "light", translucent: true })!;
    expect(o["--app-bg"]).toBe("rgba(244, 247, 252, 0.55)");
    expect(o["--bg-card"]).toMatch(/^rgba\(/);
  });
  test("server tint mixes into opaque surfaces", () => {
    const o = computeSurfaceOverrides({ theme: "dark", tint: "#ff0000" })!;
    expect(o["--app-bg"]).toMatch(/^#[0-9a-f]{6}$/);
    expect(o["--app-bg"]).not.toBe("#05060a");
    expect(computeSurfaceOverrides({ theme: "dark", tint: "url(x)" })).toBeNull();
  });
});

describe("server themes", () => {
  test("sanitizeServerTheme", () => {
    expect(sanitizeServerTheme({ accentColor: "#ABC", backgroundTint: "" })).toEqual({ theme: { accentColor: "#aabbcc", backgroundTint: null, gradient: null } });
    expect(sanitizeServerTheme({ gradient: { stops: ["#112233", "#ABC"], angle: 90 } })).toEqual({
      theme: { accentColor: null, backgroundTint: null, gradient: { stops: ["#112233", "#aabbcc"], angle: 90 } },
    });
    expect(sanitizeServerTheme({ accentColor: "#123456", gradient: "" })).toEqual({ theme: { accentColor: "#123456", backgroundTint: null, gradient: null } });
    expect("error" in sanitizeServerTheme({ gradient: { stops: ["#000000"], angle: 0 } })).toBe(true);
    expect("error" in sanitizeServerTheme({ gradient: "linear-gradient(red, blue)" })).toBe(true);
    expect(sanitizeServerTheme(null)).toEqual({ theme: null });
    expect(sanitizeServerTheme({})).toEqual({ theme: null });
    expect("error" in sanitizeServerTheme({ accentColor: "red" })).toBe(true);
    expect("error" in sanitizeServerTheme({ backgroundTint: "url(x)" })).toBe(true);
    expect("error" in sanitizeServerTheme("x")).toBe(true);
  });
  test("readServerTheme ignores junk", () => {
    expect(readServerTheme({ theme: { accentColor: "#123456" } })).toEqual({ accentColor: "#123456", backgroundTint: null, gradient: null });
    expect(readServerTheme({ theme: { gradient: { stops: ["#123456", "url(x)"], angle: 1 } } })).toBeNull();
    expect(readServerTheme({ theme: { accentColor: "expression()" } })).toBeNull();
    expect(readServerTheme(null)).toBeNull();
  });
});

describe("nameplates", () => {
  const opts = { userId: USER, cdnUrl: CDN };
  test("sanitizeNameplate", () => {
    expect(sanitizeNameplate({ type: "image", imageUrl: plate(), color: "#fff" }, opts)).toEqual({ nameplate: { type: "image", imageUrl: plate() } });
    expect("error" in sanitizeNameplate({ type: "image", imageUrl: plate(OTHER) }, opts)).toBe(true);
    expect(sanitizeNameplate({ type: "image" }, opts)).toEqual({ nameplate: { type: "none" } });
    expect(sanitizeNameplate({ type: "color", color: "#F00" }, opts)).toEqual({ nameplate: { type: "color", color: "#ff0000" } });
    expect("error" in sanitizeNameplate({ type: "color", color: "url(x)" }, opts)).toBe(true);
    expect("error" in sanitizeNameplate({ type: "gradient", gradient: ["#000000"] }, opts)).toBe(true);
    expect(sanitizeNameplate({ type: "preset", presetId: "ocean" }, opts)).toEqual({ nameplate: { type: "preset", presetId: "ocean" } });
    expect("error" in sanitizeNameplate({ type: "preset", presetId: "nope" }, opts)).toBe(true);
    expect("error" in sanitizeNameplate({ type: "weird" }, opts)).toBe(true);
  });
  test("getNameplateBackground renders images and drops unsafe values", () => {
    expect(getNameplateBackground({ nameplate: { type: "image", imageUrl: plate() } })).toBe(`url("${plate()}") center / cover no-repeat`);
    expect(getNameplateBackground({ nameplate: { type: "image", imageUrl: "https://evil.example/a.png" } })).toBeNull();
    expect(getNameplateBackground({ nameplate: { type: "color", color: "url(https://evil.example/t)" } })).toBeNull();
    expect(getNameplateBackground({ nameplate: { type: "gradient", gradient: ["#000000", "#ffffff"] } })).toBe("linear-gradient(90deg, #000000, #ffffff)");
  });
});

describe("gradient app themes", () => {
  test("sanitizeThemeGradient", () => {
    expect(sanitizeThemeGradient({ stops: ["#ABC", "#123456"], angle: 400.4 })).toEqual({ stops: ["#aabbcc", "#123456"], angle: 40 });
    expect(sanitizeThemeGradient({ stops: ["#000000", "#111111", "#222222"], angle: -30 })).toEqual({ stops: ["#000000", "#111111", "#222222"], angle: 330 });
    expect(sanitizeThemeGradient({ stops: ["#000000", "#ffffff"] })?.angle).toBe(160);
    expect(sanitizeThemeGradient({ stops: ["#000000"], angle: 0 })).toBeNull();
    expect(sanitizeThemeGradient({ stops: ["#000000", "#111111", "#222222", "#333333"], angle: 0 })).toBeNull();
    expect(sanitizeThemeGradient({ stops: ["#000000", "red"], angle: 0 })).toBeNull();
    expect(sanitizeThemeGradient({ stops: ["#000000", "#ffffff"], angle: "90" })).toBeNull();
    expect(sanitizeThemeGradient({ stops: ["#000000", "#ffffff"], angle: Number.NaN })).toBeNull();
    expect(sanitizeThemeGradient(["#000000", "#ffffff"])).toBeNull();
    expect(sanitizeThemeGradient("none")).toBeNull();
  });

  test("keys round-trip and CSS is built only from validated parts", () => {
    const g = { stops: ["#112233", "#445566", "#778899"], angle: 165 };
    expect(themeGradientKey(g)).toBe("165:#112233,#445566,#778899");
    expect(parseThemeGradientKey(themeGradientKey(g))).toEqual(g);
    expect(themeGradientKey(null)).toBe("");
    expect(parseThemeGradientKey("")).toBeNull();
    expect(parseThemeGradientKey("90:#000000,url(x)")).toBeNull();
    expect(themeGradientCss(g)).toBe("linear-gradient(165deg, #112233 0%, #445566 50%, #778899 100%)");
    expect(themeGradientMean({ stops: ["#000000", "#ffffff"], angle: 0 })).toBe("#808080");
  });

  test("user setting in the appearance PATCH", () => {
    const opts = { userId: USER, cdnUrl: CDN };
    expect(sanitizeAppearanceSettingsPatch({ themeGradient: "none" }, opts)).toEqual({ patch: { themeGradient: "none" } });
    expect(sanitizeAppearanceSettingsPatch({ themeGradient: { stops: ["#ABC", "#000"], angle: 10 } }, opts)).toEqual({
      patch: { themeGradient: { stops: ["#aabbcc", "#000000"], angle: 10 } },
    });
    expect(sanitizeAppearanceSettingsPatch({ themeGradient: null, theme: "dark" }, opts)).toEqual({ patch: { theme: "dark" } });
    const bad = sanitizeAppearanceSettingsPatch({ themeGradient: { stops: ["url(x)", "#000000"], angle: 0 } }, opts);
    expect("error" in bad && bad.error).toContain("themeGradient");
    expect("error" in sanitizeAppearanceSettingsPatch({ themeGradient: "rainbow" }, opts)).toBe(true);
    expect("error" in sanitizeAppearanceSettingsPatch({ themeGradient: 5 }, opts)).toBe(true);
  });

  test("defaults: off until picked, none means none", () => {
    expect(readUserThemeGradient(undefined)).toBeNull();
    expect(readUserThemeGradient("none")).toBe("none");
    expect(readUserThemeGradient({ stops: ["bad"] })).toBeNull();
    expect(userThemeGradient(null)).toBeNull();
    expect(userThemeGradient("none")).toBeNull();
    const mine = { stops: ["#ff0000", "#0000ff"], angle: 90 };
    expect(userThemeGradient(mine)).toEqual(mine);
  });

  test("resolve: image > server theme > user", () => {
    const mine = { stops: ["#ff0000", "#0000ff"], angle: 90 };
    const serverG = { stops: ["#00ff00", "#000000"], angle: 45 };
    const server = { accentColor: null, backgroundTint: null, gradient: serverG };
    expect(resolveThemeGradient({ theme: "dark", user: mine, server })).toEqual(serverG);
    expect(resolveThemeGradient({ theme: "dark", user: "none", server })).toEqual(serverG);
    expect(resolveThemeGradient({ theme: "dark", user: mine, server, hasBackgroundImage: true })).toBeNull();
    expect(resolveThemeGradient({ theme: "dark", user: mine, server: null })).toEqual(mine);
    expect(resolveThemeGradient({ theme: "dark", user: null })).toBeNull();
    // An accent-only server theme keeps the user's gradient.
    expect(resolveThemeGradient({ theme: "dark", user: mine, server: { accentColor: "#123456", backgroundTint: null, gradient: null } })).toEqual(mine);
    // A legacy tint-only server renders [tint → dark].
    const legacy = { accentColor: null, backgroundTint: "#2eb5cb", gradient: null };
    expect(serverThemeGradient(legacy)).toEqual(gradientFromTint("#2eb5cb"));
    expect(resolveThemeGradient({ theme: "dark", user: "none", server: legacy })?.stops[0]).toBe("#2eb5cb");
    expect(gradientFromTint("url(x)")).toBeNull();
  });

  test("presets are valid, unique and Serika is the default", () => {
    const ids = new Set<string>();
    const keys = new Set<string>();
    for (const p of THEME_GRADIENT_PRESETS) {
      expect(sanitizeThemeGradient(p.gradient)).toEqual(p.gradient);
      ids.add(p.id);
      keys.add(themeGradientKey(p.gradient));
    }
    expect(ids.size).toBe(THEME_GRADIENT_PRESETS.length);
    expect(keys.size).toBe(THEME_GRADIENT_PRESETS.length);
    expect(THEME_GRADIENT_PRESETS.length).toBeGreaterThanOrEqual(28);
    expect(THEME_GRADIENT_PRESETS.some((p) => p.tone === "soft")).toBe(true);
    expect(THEME_GRADIENT_PRESETS.some((p) => p.tone === "deep")).toBe(true);
    expect(findThemeGradientPreset(DEFAULT_THEME_GRADIENT)?.id).toBe("serika");
    expect(findThemeGradientPreset({ stops: ["#010203", "#040506"], angle: 1 })).toBeNull();
  });

  test("rendering darkens on dark themes and lightens on light", () => {
    const vivid = { stops: ["#ffffff", "#ff00ff", "#000000"], angle: 160 };
    for (const theme of ["dark", "midnight"] as AppThemeName[]) {
      const r = renderThemeGradient(vivid, theme);
      expect(r.angle).toBe(160);
      for (const s of r.stops) expect(relativeLuminance(s)).toBeLessThanOrEqual(0.0265);
      expect(r.stops[2]).toBe("#000000"); // already dark: untouched
    }
    const light = renderThemeGradient(vivid, "light");
    for (const s of light.stops) expect(relativeLuminance(s)).toBeGreaterThanOrEqual(0.775);
    expect(light.stops[0]).toBe("#ffffff");
    // Keeps some hue: the Serika purple still reads as purple on dark.
    const [r0, , b0] = [1, 3, 5].map((i) => parseInt(renderThemeGradient(DEFAULT_THEME_GRADIENT, "dark").stops[0].slice(i, i + 2), 16));
    expect(b0).toBeGreaterThan(r0);
  });

  test("text stays WCAG AA on every preset (darkest and brightest stops)", () => {
    for (const theme of ["dark", "midnight", "light"] as AppThemeName[]) {
      const alphas = GRADIENT_SURFACE_ALPHA[theme === "light" ? "light" : "dark"];
      for (const p of [...THEME_GRADIENT_PRESETS, { id: "white", gradient: { stops: ["#ffffff", "#000000"], angle: 0 } }]) {
        const rendered = renderThemeGradient(p.gradient, theme);
        const byLum = [...rendered.stops].sort((a, b) => relativeLuminance(a) - relativeLuminance(b));
        const tint = mixHex(THEME_SURFACES[theme].bg, themeGradientMean(rendered), theme === "light" ? 0.08 : 0.14);
        for (const stop of [byLum[0], byLum[byLum.length - 1]]) {
          // The most see-through layer (chat / rail), one layer deep.
          const composite = compositeOver(tint, alphas.bg, stop);
          expect(contrastRatio(composite, THEME_TEXT[theme].primary)).toBeGreaterThanOrEqual(4.5);
          expect(contrastRatio(composite, THEME_TEXT[theme].secondary)).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  test("gradient surfaces: see-through layers, near-opaque cards, solid tooltips", () => {
    const rendered = renderThemeGradient(DEFAULT_THEME_GRADIENT, "dark");
    const o = computeSurfaceOverrides({ theme: "dark", gradient: rendered })!;
    const alpha = (v: string) => Number(/rgba\([^)]*,\s*([\d.]+)\)$/.exec(v)?.[1]);
    expect(alpha(o["--app-bg"])).toBe(GRADIENT_SURFACE_ALPHA.dark.bg);
    expect(alpha(o["--bg-sidebar"])).toBeGreaterThan(alpha(o["--app-bg"]));
    expect(alpha(o["--bg-card"])).toBeGreaterThanOrEqual(0.9);
    expect(o["--tooltip-bg"]).toMatch(/^#[0-9a-f]{6}$/);
    // Overlays (Mod View, dialogs, menus) get an opaque copy of --app-bg.
    expect(o["--app-bg-solid"]).toMatch(/^#[0-9a-f]{6}$/);
    expect(computeSurfaceOverrides({ theme: "light", translucent: true })!["--app-bg-solid"]).toBe("#f4f7fc");
    expect(computeSurfaceOverrides({ theme: "light", gradient: renderThemeGradient(DEFAULT_THEME_GRADIENT, "light") })!["--tooltip-bg"]).toBe("#ffffff");
    // Every surface has an opaque copy (same colour, no alpha) for floating
    // layers, and ThemeContext knows to set and clear it.
    for (const mode of [{ gradient: rendered }, { translucent: true }]) {
      const s = computeSurfaceOverrides({ theme: "dark", ...mode })!;
      for (const [key, solidVar] of Object.entries(SURFACE_SOLID_VARS)) {
        expect(SURFACE_OVERRIDE_VARS).toContain(solidVar);
        expect(s[solidVar]).toMatch(/^#[0-9a-f]{6}$/);
        const [r, g, b] = hexToRgb(s[solidVar]);
        const see = key === "bg" ? s["--app-bg"] : key === "sidebar" ? s["--bg-sidebar"] : key === "surface" ? s["--app-surface"] : key === "surfaceAlt" ? s["--app-surface-alt"] : s["--bg-card"];
        expect(see.startsWith(`rgba(${r}, ${g}, ${b}, `)).toBe(true);
      }
    }
    // Opaque themes (legacy tint only) need no copies: the stylesheet
    // defaults resolve to the opaque surfaces.
    expect(computeSurfaceOverrides({ theme: "dark", tint: "#8b5cf6" })!["--app-surface-solid"]).toBeUndefined();
    // A background image wins over the gradient (old translucent alphas).
    expect(computeSurfaceOverrides({ theme: "light", translucent: true, gradient: rendered })!["--app-bg"]).toBe("rgba(244, 247, 252, 0.55)");
  });
});
