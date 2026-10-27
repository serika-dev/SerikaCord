import { describe, expect, test } from "bun:test";
import {
  communityEmojiViews,
  customEmojiIds,
  formatCustomEmoji,
  fromDiscordEmoji,
  normalizeCommunityEmoji,
  normalizeWelcomeEmoji,
  parseCommunityEmoji,
  serverEmojiLookup,
  toDiscordEmoji,
  validUnicodeEmoji,
  welcomeEmojiValue,
} from "@/lib/servers/communityEmoji";
import { normalizeOnboardingConfig } from "@/lib/servers/onboarding";
import { normalizeWelcomeScreen } from "@/lib/servers/community";
import { fromDiscordOnboarding, toDiscordOnboarding } from "@/lib/botapi/communityRules";

const OWN = "0b6f1a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
const OWN_ANIMATED = "1c7a2b4f-2d3e-4f60-9b0c-1d2e3f4a5b6c";
const FOREIGN = "9e8d7c6b-5a49-4382-a170-6f5e4d3c2b1a";

const emojis = serverEmojiLookup([
  { id: OWN, name: "wave", animated: false },
  { id: OWN_ANIMATED.toUpperCase(), name: "party_cat", animated: true },
  { id: "2d8b3c5a-3e4f-4a71-8c1d-2e3f4a5b6c7d", name: "gone", available: false },
]);

describe("parseCommunityEmoji", () => {
  test("unicode emoji are kept", () => {
    expect(parseCommunityEmoji("🎮")).toEqual({ kind: "unicode", value: "🎮" });
    expect(parseCommunityEmoji(" 👍🏽 ")).toEqual({ kind: "unicode", value: "👍🏽" });
    expect(parseCommunityEmoji("1️⃣")).toEqual({ kind: "unicode", value: "1️⃣" });
    expect(parseCommunityEmoji("🇯🇵")).toEqual({ kind: "unicode", value: "🇯🇵" });
    expect(parseCommunityEmoji("👨‍👩‍👧")).toEqual({ kind: "unicode", value: "👨‍👩‍👧" });
  });
  test("custom tokens, static and animated, including the HTML-escaped form", () => {
    expect(parseCommunityEmoji(`<:wave:${OWN}>`)).toEqual({ kind: "custom", id: OWN, name: "wave", animated: false });
    expect(parseCommunityEmoji(`<a:party_cat:${OWN_ANIMATED}>`)).toEqual({ kind: "custom", id: OWN_ANIMATED, name: "party_cat", animated: true });
    expect(parseCommunityEmoji(`&lt;:wave:${OWN}&gt;`)).toEqual({ kind: "custom", id: OWN, name: "wave", animated: false });
  });
  test("malformed values are rejected", () => {
    for (const bad of [
      "", "   ", "abc", "has space", "🎮🎲", "<:wave:123>", `<:wa ve:${OWN}>`, `<b:wave:${OWN}>`, `<:wave:${OWN}`,
      `<img src=x onerror=alert(1)>`, "<script>", ":wave:", "1", "#", null, 42, { name: "🎮" },
    ]) {
      expect(parseCommunityEmoji(bad)).toBeNull();
    }
    expect(validUnicodeEmoji("x".repeat(40))).toBeNull();
  });
});

describe("normalizeCommunityEmoji", () => {
  test("this server's custom emoji is accepted and takes its current name", () => {
    expect(normalizeCommunityEmoji(`<:old_name:${OWN}>`, emojis)).toBe(`<:wave:${OWN}>`);
    expect(normalizeCommunityEmoji(`<:party_cat:${OWN_ANIMATED}>`, emojis)).toBe(`<a:party_cat:${OWN_ANIMATED}>`);
  });
  test("another server's emoji (or an unavailable one) is rejected on save", () => {
    expect(normalizeCommunityEmoji(`<:wave:${FOREIGN}>`, emojis)).toBeNull();
    expect(normalizeCommunityEmoji(`<:gone:2d8b3c5a-3e4f-4a71-8c1d-2e3f4a5b6c7d>`, emojis)).toBeNull();
  });
  test("reading stored data keeps well-formed tokens without a lookup", () => {
    expect(normalizeCommunityEmoji(`<:wave:${OWN.toUpperCase()}>`)).toBe(`<:wave:${OWN}>`);
  });
  test("unicode is kept with or without a lookup; malformed is dropped", () => {
    expect(normalizeCommunityEmoji("✅", emojis)).toBe("✅");
    expect(normalizeCommunityEmoji("✅")).toBe("✅");
    expect(normalizeCommunityEmoji("not an emoji", emojis)).toBeNull();
  });
  test("token names are reduced to word characters", () => {
    expect(formatCustomEmoji({ id: OWN, name: "my-emoji!" })).toBe(`<:myemoji:${OWN}>`);
    expect(formatCustomEmoji({ id: OWN, name: "---" })).toBe(`<:emoji:${OWN}>`);
  });
});

describe("normalizeOnboardingConfig with server emojis", () => {
  const input = {
    enabled: true,
    questions: [{
      id: "q",
      title: "Games?",
      options: [
        { id: "a", title: "Own", emoji: `<:wave:${OWN}>` },
        { id: "b", title: "Foreign", emoji: `<:wave:${FOREIGN}>` },
        { id: "c", title: "Unicode", emoji: "🎲" },
        { id: "d", title: "Junk", emoji: "lol" },
      ],
    }],
    guide: {
      enabled: true,
      todos: [{ id: "t", kind: "profile", title: "Profile", emoji: `<a:party_cat:${OWN_ANIMATED}>` }],
      resources: [
        { id: "r1", title: "FAQ", emoji: `<:x:${FOREIGN}>` },
        { id: "r2", title: "Rules", emoji: "📜" },
      ],
    },
  };
  test("own custom kept, foreign stripped, unicode kept, junk dropped", () => {
    const cfg = normalizeOnboardingConfig(input, { emojis });
    expect(cfg.questions[0].options.map((o) => o.emoji)).toEqual([`<:wave:${OWN}>`, null, "🎲", null]);
    expect(cfg.guide.todos[0].emoji).toBe(`<a:party_cat:${OWN_ANIMATED}>`);
    expect(cfg.guide.resources.map((r) => r.emoji)).toEqual([null, "📜"]);
  });
  test("custom emoji ids used by a config", () => {
    const cfg = normalizeOnboardingConfig(input);
    expect([...customEmojiIds(cfg.questions[0].options.map((o) => o.emoji))]).toEqual([OWN, FOREIGN]);
  });
});

describe("welcome screen emojis", () => {
  test("emojiId must be this server's; the name follows the emoji", () => {
    expect(normalizeWelcomeEmoji(OWN, "whatever", emojis)).toEqual({ emojiId: OWN, emojiName: "wave" });
    expect(normalizeWelcomeEmoji(FOREIGN, "wave", emojis)).toEqual({ emojiId: null, emojiName: null });
    expect(normalizeWelcomeEmoji("123", "wave", emojis)).toEqual({ emojiId: null, emojiName: null });
  });
  test("a token in emojiName is split; unicode stays a name", () => {
    expect(normalizeWelcomeEmoji(null, `<a:party_cat:${OWN_ANIMATED}>`, emojis)).toEqual({ emojiId: OWN_ANIMATED, emojiName: "party_cat" });
    expect(normalizeWelcomeEmoji(null, "📜", emojis)).toEqual({ emojiId: null, emojiName: "📜" });
    expect(normalizeWelcomeEmoji(null, "has space", emojis)).toEqual({ emojiId: null, emojiName: null });
  });
  test("normalizeWelcomeScreen applies it", () => {
    const screen = normalizeWelcomeScreen({
      enabled: true,
      welcomeChannels: [
        { channelId: "a", emojiId: OWN, emojiName: "wave" },
        { channelId: "b", emoji_id: FOREIGN, emoji_name: "nope" },
        { channelId: "c", emojiName: "🎉" },
      ],
    }, undefined, emojis);
    expect(screen.welcomeChannels.map((c) => [c.emojiId, c.emojiName])).toEqual([[OWN, "wave"], [null, null], [null, "🎉"]]);
    expect(welcomeEmojiValue(screen.welcomeChannels[0])).toBe(`<:wave:${OWN}>`);
    expect(welcomeEmojiValue(screen.welcomeChannels[2])).toBe("🎉");
  });
});

describe("display data", () => {
  test("only referenced, available emojis with an https image", () => {
    const rows = [
      { id: OWN, name: "wave", imageUrl: "https://cdn.serika.chat/emojis/wave.png" },
      { id: OWN_ANIMATED, name: "party_cat", imageUrl: "https://cdn.serika.chat/emojis/cat.gif", animated: true },
      { id: FOREIGN, name: "bad", imageUrl: "javascript:alert(1)" },
    ];
    expect(communityEmojiViews(rows, new Set([OWN]))).toEqual([{ id: OWN, name: "wave", animated: false, url: "https://cdn.serika.chat/emojis/wave.png" }]);
    expect(communityEmojiViews(rows).map((e) => e.id)).toEqual([OWN, OWN_ANIMATED]);
  });
});

describe("bot API (Discord) shapes", () => {
  test("emoji objects come out as { id, name, animated }", () => {
    expect(toDiscordEmoji(`<a:party_cat:${OWN_ANIMATED}>`)).toEqual({ id: OWN_ANIMATED, name: "party_cat", animated: true });
    expect(toDiscordEmoji("🎮")).toEqual({ id: null, name: "🎮", animated: false });
    expect(toDiscordEmoji(null)).toBeNull();
  });
  test("onboarding options round trip a custom emoji", () => {
    const cfg = normalizeOnboardingConfig({
      enabled: true,
      questions: [{ id: "q0", title: "Games?", options: [{ id: "q0_o0", title: "Chess", emoji: `<:wave:${OWN}>` }] }],
    });
    const out = toDiscordOnboarding("g", cfg);
    const opt = out.prompts[0].options[0];
    expect(opt.emoji).toEqual({ id: OWN, name: "wave", animated: false });
    expect([opt.emoji_id, opt.emoji_name, opt.emoji_animated]).toEqual([OWN, "wave", false]);
    const back = fromDiscordOnboarding(out, cfg) as { questions: Array<{ options: Array<{ emoji: string | null }> }> };
    expect(back.questions[0].options[0].emoji).toBe(`<:wave:${OWN}>`);
  });
  test("Discord input forms", () => {
    expect(fromDiscordEmoji({ emoji: { id: OWN, name: "wave", animated: true } })).toBe(`<a:wave:${OWN}>`);
    expect(fromDiscordEmoji({ emoji_id: OWN, emoji_name: "wave" })).toBe(`<:wave:${OWN}>`);
    expect(fromDiscordEmoji({ emoji_name: "🎮" })).toBe("🎮");
    expect(fromDiscordEmoji({ emoji: { id: "1234567890123456789", name: "x" } })).toBeNull();
    expect(fromDiscordEmoji({})).toBeNull();
  });
});
