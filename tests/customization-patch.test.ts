import { describe, expect, test } from "bun:test";
import {
  CUSTOMIZATION_PATCH_MAX_BYTES,
  applyCustomizationPatchSafe,
} from "@/lib/profiles/customizationPatch";
import {
  safeCssColor,
  safeCssColorList,
  safeGradientAngle,
  safeNumber,
  safeRadialPosition,
  safeStatusEmojiUrl,
} from "@/lib/profiles/customizationSafety";
import { parseProfilePatchBody, validateProfilePatchBody } from "@/lib/profiles/profilePatchBody";
import { getDisplayNameStyleInline, getProfileBackgroundStyle, getProfileBannerStyle } from "@/lib/userDisplayNameStyle";

const ctx = { userId: "11111111-1111-1111-1111-111111111111", cdnUrl: "https://cdn.serika.chat" };

function ok(stored: unknown, patch: unknown) {
  const r = applyCustomizationPatchSafe(stored, patch, ctx);
  if ("error" in r) throw new Error(`unexpected error: ${r.error}`);
  return r.customization;
}

function err(stored: unknown, patch: unknown) {
  const r = applyCustomizationPatchSafe(stored, patch, ctx);
  if (!("error" in r)) throw new Error("expected an error");
  return r.error;
}

describe("safeCssColor", () => {
  test("accepts hex and numeric rgb()", () => {
    expect(safeCssColor("#abc")).toBe("#abc");
    expect(safeCssColor("#AABBCC")).toBe("#AABBCC");
    expect(safeCssColor("#aabbccdd")).toBe("#aabbccdd");
    expect(safeCssColor("rgb(1, 2, 3)")).toBe("rgb(1, 2, 3)");
    expect(safeCssColor("rgba(12, 12, 16, 0.85)")).toBe("rgba(12, 12, 16, 0.85)");
  });

  test("rejects anything that could inject CSS", () => {
    for (const bad of [
      "url(https://evil.example/x.png)",
      "red",
      "#fff; background: url(x)",
      "#fff)",
      "rgb(1,2,3), url(x)",
      "expression(alert(1))",
      "var(--x)",
      "",
      null,
      42,
    ]) {
      expect(safeCssColor(bad)).toBeNull();
    }
  });

  test("a gradient with one bad stop is dropped whole", () => {
    expect(safeCssColorList(["#000000", "#ffffff"])).toEqual(["#000000", "#ffffff"]);
    expect(safeCssColorList(["#000000", "url(x)"])).toEqual([]);
    expect(safeCssColorList("#000000")).toEqual([]);
    expect(safeCssColorList(new Array(10).fill("#000000"))).toEqual([]);
  });

  test("numbers, angle and radial position", () => {
    expect(safeNumber(50, 0, 24, 8)).toBe(24);
    expect(safeNumber("8px", 0, 24, 8)).toBe(8);
    expect(safeNumber(Number.NaN, 0, 24, 8)).toBe(8);
    expect(safeGradientAngle(450)).toBe(90);
    expect(safeGradientAngle(-90)).toBe(270);
    expect(safeGradientAngle("90deg); background: url(x")).toBe(135);
    expect(safeRadialPosition("top left")).toBe("top left");
    expect(safeRadialPosition("50% 20%")).toBe("50% 20%");
    expect(safeRadialPosition("center, url(x)")).toBe("center");
  });

  test("status emoji URLs: own CDN or same-origin path only", () => {
    const cdn = "https://cdn.serika.chat";
    expect(safeStatusEmojiUrl("https://cdn.serika.chat/emojis/a.png", cdn)).toBe("https://cdn.serika.chat/emojis/a.png");
    expect(safeStatusEmojiUrl("/api/emojis/a.png", cdn)).toBe("/api/emojis/a.png");
    expect(safeStatusEmojiUrl("//evil.example/a.png", cdn)).toBeNull();
    expect(safeStatusEmojiUrl("https://cdn.serika.chat.evil.example/a.png", cdn)).toBeNull();
    expect(safeStatusEmojiUrl("https://evil.example/a.png", cdn)).toBeNull();
    expect(safeStatusEmojiUrl("javascript:alert(1)", cdn)).toBeNull();
    expect(safeStatusEmojiUrl("data:image/svg+xml,<svg/>", cdn)).toBeNull();
  });
});

describe("CSS consumers ignore bad stored values", () => {
  test("display name gradient with url() is not rendered", () => {
    const css = getDisplayNameStyleInline({ effect: "gradient", gradient: ["#000", "url(https://evil.example/x)"] });
    expect(JSON.stringify(css)).not.toContain("url(");
    const neon = getDisplayNameStyleInline({ effect: "neon", color: "red; background: url(x)" });
    expect(JSON.stringify(neon)).not.toContain("url(");
  });

  test("profile background / banner drop injected values", () => {
    const evil = {
      profileGradient: ["#000000", "url(https://evil.example/x)"],
      profileColor: "url(https://evil.example/y)",
      profileGradientType: "radial" as const,
      profileGradientRadialPosition: "center, url(https://evil.example/z)",
      profileCardBorderColor: "url(https://evil.example/b)",
      profileCardEffect: "glassmorphism" as const,
      profileCardBlur: 9999,
    };
    const bg = getProfileBackgroundStyle(evil);
    expect(JSON.stringify(bg)).not.toContain("url(");
    expect(bg.backdropFilter).toBe("blur(24px)");
    expect(JSON.stringify(getProfileBannerStyle(evil))).not.toContain("url(");
  });

  test("valid values still render", () => {
    expect(getProfileBannerStyle({ profileGradient: ["#FF3366", "#FFD12A"], profileGradientAngle: 90 })).toEqual({
      background: "linear-gradient(90deg, #FF3366, #FFD12A)",
    });
    expect(getDisplayNameStyleInline({ effect: "gradient", gradient: ["#FF3366", "#FFD12A"] }).backgroundImage).toBe(
      "linear-gradient(90deg, #FF3366, #FFD12A)",
    );
  });
});

describe("applyCustomizationPatchSafe", () => {
  test("keeps what the profile editors send", () => {
    const out = ok({}, {
      displayNameStyle: { font: "serif", effect: "gradient", color: "", gradient: ["#ff3366", "#ffd12a"] },
      profileColor: "#8b5cf6",
      profileGradient: ["#FF3366", "#FFD12A"],
      profileGradientAngle: 135,
      profileGradientType: "linear",
      profileGradientRadialPosition: "center",
      profileCardEffect: "glassmorphism",
      profileCardBlur: 8,
      profileCardOpacity: 0.85,
      profileCardBorderColor: "",
      profileCardBorderGlow: false,
      profileCardBorderWidth: 1,
      nameplate: { type: "none" },
    });
    expect(out.displayNameStyle).toEqual({ font: "serif", effect: "gradient", color: "", gradient: ["#FF3366", "#FFD12A"] });
    expect(out.profileColor).toBe("#8B5CF6");
    expect(out.profileGradient).toEqual(["#FF3366", "#FFD12A"]);
    expect(out.profileCardEffect).toBe("glassmorphism");
    expect(out.profileCardOpacity).toBe(0.85);
    expect(out.nameplate).toEqual({ type: "none" });
  });

  test("drops unknown keys and keys with their own route", () => {
    const out = ok({ profileColor: "#000000" }, {
      evil: "x",
      __proto__: { polluted: true },
      serverTag: { serverId: "x" },
      customStatusEmoji: { name: "x", id: "a", url: "https://evil.example/x.png" },
      customStatusExpiresAt: "2099-01-01T00:00:00.000Z",
    });
    expect(out).toEqual({ profileColor: "#000000" });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  test("keeps stored keys it doesn't touch (custom status emoji stays)", () => {
    const stored = { customStatusEmoji: { name: "x" }, profileColor: "#000000" };
    const out = ok(stored, { profileCardBlur: 4 });
    expect(out.customStatusEmoji).toEqual({ name: "x" });
    expect(out.profileCardBlur).toBe(4);
  });

  test("rejects CSS injection in colours", () => {
    expect(err({}, { profileGradient: ["#000", "url(https://evil.example/x)"] })).toContain("profile colours");
    expect(err({}, { profileColor: "red;}" })).toContain("profile colours");
    expect(err({}, { displayNameStyle: { effect: "gradient", gradient: ["#000", "url(x)"] } })).toContain("display name style");
    expect(err({}, { profileCardBorderColor: "url(x)" })).toContain("profileCardBorderColor");
  });

  test("enums must be known, numbers are clamped", () => {
    expect(err({}, { profileCardEffect: "evil" })).toContain("profileCardEffect");
    expect(err({}, { profileGradientRadialPosition: "center, url(x)" })).toContain("profileGradientRadialPosition");
    expect(err({}, { profileCardBlur: "8" })).toContain("profileCardBlur");
    const out = ok({}, { profileCardBlur: 500, profileCardOpacity: 0, profileCardBorderWidth: 99, profileGradientAngle: 400 });
    expect(out.profileCardBlur).toBe(24);
    expect(out.profileCardOpacity).toBe(0.1);
    expect(out.profileCardBorderWidth).toBe(5);
    expect(out.profileGradientAngle).toBe(40);
  });

  test("a partial display name style merges over the stored one", () => {
    const stored = { displayNameStyle: { font: "mono", effect: "solid", color: "#112233", gradient: [] } };
    const out = ok(stored, { displayNameStyle: { color: "#445566" } });
    expect(out.displayNameStyle).toEqual({ font: "mono", effect: "solid", color: "#445566", gradient: [] });
  });

  test("an invalid stored style doesn't block a full new one", () => {
    const stored = { displayNameStyle: { font: "evil", color: "url(x)" } };
    const out = ok(stored, { displayNameStyle: { font: "bold", effect: "solid", color: "", gradient: [] } });
    expect(out.displayNameStyle).toEqual({ font: "bold", effect: "solid", color: "", gradient: [] });
  });

  test("null resets a key", () => {
    const out = ok({ profileCardEffect: "glow", displayNameStyle: { font: "mono" } }, { profileCardEffect: null, displayNameStyle: null });
    expect(out.profileCardEffect).toBeUndefined();
    expect(out.displayNameStyle).toBeUndefined();
  });

  test("nameplate goes through sanitizeNameplate", () => {
    expect(err({}, { nameplate: { type: "image", imageUrl: "https://evil.example/x.png" } })).toBeTruthy();
    expect(ok({}, { nameplate: { type: "color", color: "#ff0000" } }).nameplate).toMatchObject({ type: "color" });
  });

  test("size cap", () => {
    const big = { displayNameStyle: { font: "default", effect: "solid", padding: "x".repeat(CUSTOMIZATION_PATCH_MAX_BYTES) } };
    expect(err({}, big)).toBe("customization is too large");
    expect(err({}, "nope")).toBe("customization must be an object");
  });
});

describe("profile patch body (POST /users/me)", () => {
  test("parses a beacon string body", () => {
    expect(parseProfilePatchBody('{"bio":"hi"}')).toEqual({ bio: "hi" });
    expect(parseProfilePatchBody("not json")).toBeNull();
    expect(parseProfilePatchBody("[1,2]")).toBeNull();
    expect(parseProfilePatchBody({ bio: "hi" })).toEqual({ bio: "hi" });
  });

  test("same limits as PUT", () => {
    expect(validateProfilePatchBody({ bio: "x".repeat(1000), pronouns: "they/them", customStatus: null })).toBeNull();
    expect(validateProfilePatchBody({ bio: "x".repeat(1001) })).toBe("Invalid bio");
    expect(validateProfilePatchBody({ pronouns: "x".repeat(33) })).toBe("Invalid pronouns");
    expect(validateProfilePatchBody({ displayName: "x".repeat(33) })).toBe("Invalid displayName");
    expect(validateProfilePatchBody({ customStatus: "x".repeat(129) })).toBe("Invalid customStatus");
    expect(validateProfilePatchBody({ bio: 5 })).toBe("Invalid bio");
    expect(validateProfilePatchBody({ status: "busy" })).toBe("Invalid status");
    expect(validateProfilePatchBody({ customization: "x" })).toBe("Invalid customization");
    expect(validateProfilePatchBody({ settings: [] })).toBe("Invalid settings");
    expect(validateProfilePatchBody({ showTimezone: "yes" })).toBe("Invalid showTimezone");
    expect(validateProfilePatchBody({ gifFavorites: [{ url: 1 }] })).toBe("Invalid gifFavorites");
    expect(validateProfilePatchBody({ status: "invisible", gifFavorites: [{ url: "https://x" }] })).toBeNull();
  });
});
