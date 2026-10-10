import { describe, expect, test } from "bun:test";
import { isValidRoleIcon, isValidUnicodeEmoji, normalizeRoleIconInput, pickIconRole } from "@/lib/roles/roleIcon";

const CDN = "https://cdn.serika.chat";

describe("role icon validation", () => {
  test("only our CDN uploads", () => {
    expect(isValidRoleIcon("https://cdn.serika.chat/emojis/u1/abc.png", CDN)).toBe(true);
    expect(isValidRoleIcon("https://evil.example/emojis/u1/abc.png", CDN)).toBe(false);
    expect(isValidRoleIcon("https://cdn.serika.chat/avatars/u1/abc.png", CDN)).toBe(false);
    expect(isValidRoleIcon("javascript:alert(1)", CDN)).toBe(false);
    expect(isValidRoleIcon(42, CDN)).toBe(false);
  });

  test("unicode emoji, not text", () => {
    expect(isValidUnicodeEmoji("🔥")).toBe(true);
    expect(isValidUnicodeEmoji("👩‍💻")).toBe(true);
    expect(isValidUnicodeEmoji("🇯🇵")).toBe(true);
    expect(isValidUnicodeEmoji("hello")).toBe(false);
    expect(isValidUnicodeEmoji("🔥 fire")).toBe(false);
    expect(isValidUnicodeEmoji("")).toBe(false);
  });

  test("icon and emoji are mutually exclusive", () => {
    expect(normalizeRoleIconInput({ icon: `${CDN}/emojis/u/a.png` }, CDN)).toEqual({ icon: `${CDN}/emojis/u/a.png`, unicodeEmoji: null });
    expect(normalizeRoleIconInput({ unicodeEmoji: "⭐" }, CDN)).toEqual({ unicodeEmoji: "⭐", icon: null });
    expect(normalizeRoleIconInput({ icon: null, unicodeEmoji: null }, CDN)).toEqual({ icon: null, unicodeEmoji: null });
    expect("error" in normalizeRoleIconInput({ icon: "https://x.y/z.png" }, CDN)).toBe(true);
    expect("error" in normalizeRoleIconInput({ unicodeEmoji: "abc" }, CDN)).toBe(true);
  });
});

describe("pickIconRole", () => {
  test("highest role with an icon, never @everyone", () => {
    const roles = [
      { id: "everyone", isDefault: true, position: 0, unicodeEmoji: "🙂" },
      { id: "low", position: 1, unicodeEmoji: "⭐" },
      { id: "top", position: 5 },
      { id: "mid", position: 3, icon: "https://cdn.serika.chat/emojis/x.png" },
    ];
    expect(pickIconRole(roles)?.id).toBe("mid");
    expect(pickIconRole([{ id: "a", position: 1 }])).toBeNull();
    expect(pickIconRole(null)).toBeNull();
  });
});
