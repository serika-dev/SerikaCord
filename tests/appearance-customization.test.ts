import { describe, expect, test } from "bun:test";
import {
  clampAccentForContrast,
  clampBackgroundBlur,
  clampBackgroundDim,
  computeSurfaceOverrides,
  contrastRatio,
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
    expect(sanitizeServerTheme({ accentColor: "#ABC", backgroundTint: "" })).toEqual({ theme: { accentColor: "#aabbcc", backgroundTint: null } });
    expect(sanitizeServerTheme(null)).toEqual({ theme: null });
    expect(sanitizeServerTheme({})).toEqual({ theme: null });
    expect("error" in sanitizeServerTheme({ accentColor: "red" })).toBe(true);
    expect("error" in sanitizeServerTheme({ backgroundTint: "url(x)" })).toBe(true);
    expect("error" in sanitizeServerTheme("x")).toBe(true);
  });
  test("readServerTheme ignores junk", () => {
    expect(readServerTheme({ theme: { accentColor: "#123456" } })).toEqual({ accentColor: "#123456", backgroundTint: null });
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
