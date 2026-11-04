import { describe, expect, test } from "bun:test";
import {
  AA_LARGE,
  AA_TEXT,
  composite,
  computeProfilePalette,
  contrastRatio,
  getProfileCardColors,
  parseColor,
  profileNameContrastStyle,
  readableRoleColor,
  relativeLuminance,
  sampleGradient,
  worstContrast,
  type RGBA,
} from "../src/lib/profiles/profileContrast";

const C = (s: string) => parseColor(s) as RGBA;

describe("colour maths", () => {
  test("parses hex, rgb() and stop positions", () => {
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("#c9b8ea")).toEqual({ r: 0xc9, g: 0xb8, b: 0xea, a: 1 });
    expect(parseColor("#00000080")?.a).toBeCloseTo(128 / 255, 3);
    expect(parseColor("rgba(10, 20, 30, 0.5)")).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseColor("rgb(10 20 30 / 50%)")).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseColor("#2a5aa8 60%")).toEqual({ r: 0x2a, g: 0x5a, b: 0xa8, a: 1 });
    expect(parseColor("var(--x)")).toBeNull();
    expect(parseColor("")).toBeNull();
    expect(parseColor(undefined)).toBeNull();
  });

  test("luminance and contrast match WCAG reference values", () => {
    expect(relativeLuminance(C("#ffffff"))).toBeCloseTo(1, 5);
    expect(relativeLuminance(C("#000000"))).toBeCloseTo(0, 5);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    // The classic AA boundary grey.
    expect(contrastRatio("#767676", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#777777", "#ffffff")).toBeLessThan(4.5);
  });

  test("compositing and gradient sampling", () => {
    expect(composite(C("rgba(255,255,255,0.5)"), C("#000000"))).toEqual({ r: 127.5, g: 127.5, b: 127.5, a: 1 });
    const s = sampleGradient([C("#ff0000"), C("#00ff00")], 4);
    expect(s).toHaveLength(5);
    // The midpoint of red → green is darker than either end.
    expect(relativeLuminance(s[2])).toBeLessThan(relativeLuminance(C("#ff0000")));
  });
});

describe("profile palette", () => {
  test("no customisation keeps the classic dark tokens exactly", () => {
    const p = computeProfilePalette(null);
    expect(p.custom).toBe(false);
    expect(p.tone).toBe("dark");
    expect(p.tokens["--profile-fg"]).toBe("#ffffff");
    expect(p.tokens["--profile-text"]).toBe("#e2e2ee");
    expect(p.tokens["--profile-muted"]).toBe("#9a9aad");
    expect(p.tokens["--profile-section-bg"]).toBe("rgba(255, 255, 255, 0.03)");
    expect(p.tokens["--profile-scrim"]).toBe("transparent");
    expect(p.contrast.muted).toBeGreaterThanOrEqual(AA_TEXT);
  });

  test("a dark custom theme on which the classic tokens pass is unchanged", () => {
    const p = computeProfilePalette({ profileGradient: ["#1a1033", "#0d1b2a"] });
    expect(p.custom).toBe(true);
    expect(p.tone).toBe("dark");
    expect(p.tokens["--profile-muted"]).toBe("#9a9aad");
    expect(p.scrimAlpha).toBe(0);
  });

  test("the reported lavender → blue gradient gets readable text everywhere", () => {
    // Owner's screenshot: light lavender at the top fading to blue at the bottom, light banner.
    const p = computeProfilePalette({ profileGradient: ["#c9b8ea", "#2a5aa8"], profileGradientAngle: 180 }, { extraColors: [] });
    // Neither tone passes on both ends unaided, so a scrim is added.
    expect(worstContrast(C("#ffffff"), getProfileCardColors({ profileGradient: ["#c9b8ea", "#2a5aa8"] }).colors)).toBeLessThan(AA_TEXT);
    expect(worstContrast(C("#0b0b10"), getProfileCardColors({ profileGradient: ["#c9b8ea", "#2a5aa8"] }).colors)).toBeLessThan(AA_TEXT);
    expect(p.scrimAlpha).toBeGreaterThan(0);
    expect(p.contrast.fg).toBeGreaterThanOrEqual(AA_TEXT);
    expect(p.contrast.text).toBeGreaterThanOrEqual(AA_TEXT);
    expect(p.contrast.muted).toBeGreaterThanOrEqual(AA_TEXT);
    expect(p.contrast.faint).toBeGreaterThanOrEqual(AA_LARGE);
    // The old hard-coded grey failed badly on the lavender end.
    expect(contrastRatio("#9a9aad", "#c9b8ea")).toBeLessThan(2);
  });

  test("a light theme switches to dark text with darker chips", () => {
    const p = computeProfilePalette({ profileColor: "#f3eefe" });
    expect(p.tone).toBe("light");
    expect(relativeLuminance(C(p.tokens["--profile-fg"]))).toBeLessThan(0.05);
    expect(p.tokens["--profile-chip-bg"]).toContain("rgba(0, 0, 0");
    expect(p.contrast.muted).toBeGreaterThanOrEqual(AA_TEXT);
    // Global text tokens follow the card so shared components (note field) read.
    expect((p.vars as Record<string, string>)["--text-muted"]).toBe(p.tokens["--profile-muted"]);
  });

  test("a light banner colour behind the body is part of the worst case", () => {
    const dark = computeProfilePalette({ profileColor: "#1b1b2b" });
    expect(dark.tokens["--profile-muted"]).toBe("#9a9aad");
    const withBanner = computeProfilePalette({ profileColor: "#1b1b2b" }, { extraColors: ["#f5f0ff"] });
    expect(withBanner.contrast.muted).toBeGreaterThanOrEqual(AA_TEXT);
    expect(withBanner.scrimAlpha).toBeGreaterThan(0);
  });

  test("holographic and glass cards pass too", () => {
    const holo = computeProfilePalette({ profileCardEffect: "holographic" });
    expect(holo.contrast.muted).toBeGreaterThanOrEqual(AA_TEXT);
    const glass = computeProfilePalette({ profileColor: "#ffffff", profileCardEffect: "glassmorphism", profileCardOpacity: 0.5 }, { opaque: false, backdrop: "#05060a" });
    expect(glass.contrast.text).toBeGreaterThanOrEqual(AA_TEXT);
  });

  test("mid-luminance colours pass in either tone", () => {
    for (const c of ["#8b5cf6", "#2a5aa8", "#e64980", "#12b886", "#808080", "#ff7b00"]) {
      const p = computeProfilePalette({ profileColor: c });
      expect(p.contrast.text).toBeGreaterThanOrEqual(AA_TEXT);
      expect(p.contrast.muted).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  test("a wash over the card (mobile profile page) is accounted for", () => {
    const p = computeProfilePalette({ profileColor: "#c9b8ea" }, { overlay: { color: "#05060a", alpha: 0.4 } });
    expect(p.contrast.muted).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe("roles and names", () => {
  test("pale role colours fall back to the card text colour on light cards", () => {
    const light = computeProfilePalette({ profileColor: "#f3eefe" });
    expect(readableRoleColor("#e0e0ff", light)).toBe("var(--profile-text)");
    expect(readableRoleColor("#1e3a8a", light)).toBe("#1e3a8a");
    expect(readableRoleColor(undefined, light)).toBe("var(--profile-text)");
    const dark = computeProfilePalette(null);
    expect(readableRoleColor("#e0e0ff", dark)).toBe("#e0e0ff");
  });

  test("names keep their colour but get a halo when they can't reach 3:1", () => {
    const light = computeProfilePalette({ profileGradient: ["#c9b8ea", "#2a5aa8"] });
    expect(profileNameContrastStyle({ effect: "gradient", gradient: ["#ffffff", "#e9d5ff"] }, light).filter).toContain("drop-shadow");
    expect(profileNameContrastStyle({ effect: "neon", color: "#8b5cf6" }, computeProfilePalette({ profileColor: "#f3eefe" })).filter).toContain("rgba(0, 0, 0");
    expect(profileNameContrastStyle({ effect: "toon" }, light)).toEqual({});
    // Pop draws its own 3D shadow: no halo on top, even in a colour that can't reach 3:1.
    expect(profileNameContrastStyle({ effect: "pop", color: "#d946ef" }, computeProfilePalette({ profileColor: "#3b0764" }))).toEqual({});
    expect(profileNameContrastStyle(undefined, light)).toEqual({});
    expect(profileNameContrastStyle({ effect: "solid", color: "#ffffff" }, computeProfilePalette(null))).toEqual({});
  });
});
