import { describe, expect, test } from "bun:test";
import {
  isValidUnicodeReactionEmoji,
  MAX_REACTION_EMOJI_LENGTH,
} from "@/lib/chat/unicodeReactionEmoji";
import {
  addReaction,
  matchReactionEmoji,
  MAX_REACTION_EMOJIS,
  type StoredReaction,
} from "@/lib/chat/reactionMutations";
import { EMOJI_DATA } from "@/lib/chat/emojiData.generated";
import { applySkinTone, type SkinTone } from "@/lib/chat/emojiIndex";

const ALICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("isValidUnicodeReactionEmoji: accepts one emoji", () => {
  const ok: Array<[string, string]> = [
    ["simple pictograph", "👍"],
    ["face", "😀"],
    ["heart with VS16", "❤️"],
    ["heart without VS16", "❤"],
    ["copyright with VS16", "©️"],
    ["trade mark with VS16", "™️"],
    ["keycap one", "1️⃣"],
    ["keycap without VS16", "1⃣"],
    ["keycap hash", "#️⃣"],
    ["keycap star", "*️⃣"],
    ["flag JP", "🇯🇵"],
    ["flag US", "🇺🇸"],
    ["subdivision flag England", "🏴󠁧󠁢󠁥󠁮󠁧󠁿"],
    ["skin tone", "👍🏽"],
    ["skin tone dark", "👋🏿"],
    ["family ZWJ", "👨‍👩‍👧‍👦"],
    ["rainbow flag ZWJ", "🏳️‍🌈"],
    ["trans flag ZWJ", "🏳️‍⚧️"],
    ["technologist with tone", "👩🏽‍💻"],
    ["couple with heart, two tones", "👩🏻‍❤️‍👨🏿"],
    ["kiss, two tones", "👩🏻‍❤️‍💋‍👨🏼"],
    ["handshake people, two tones", "🧑🏽‍🤝‍🧑🏻"],
    ["hair component", "👨‍🦰"],
    ["eye in speech bubble", "👁️‍🗨️"],
    ["newer emoji (melting face)", "🫠"],
  ];
  for (const [label, emoji] of ok) {
    test(label, () => {
      expect(isValidUnicodeReactionEmoji(emoji)).toBe(true);
    });
  }

  test("every emoji the picker offers (all skin tones)", () => {
    const rejected: string[] = [];
    for (const [char, , , tones] of EMOJI_DATA) {
      const variants = tones ? ([0, 1, 2, 3, 4, 5] as SkinTone[]).map((t) => applySkinTone(char, t)) : [char];
      for (const v of variants) if (!isValidUnicodeReactionEmoji(v)) rejected.push(v);
    }
    expect(rejected).toEqual([]);
  });
});

describe("isValidUnicodeReactionEmoji: rejects everything else", () => {
  const bad: Array<[string, unknown]> = [
    ["empty", ""],
    ["non-string", 42],
    ["null", null],
    ["plain word", "hello"],
    ["single letter", "a"],
    ["digit without keycap", "1"],
    ["hash without keycap", "#"],
    ["URL", "https://evil.example/x.png"],
    ["shortcode", ":thumbsup:"],
    ["custom emoji token", "<:blob:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa>"],
    ["HTML", "<img src=x onerror=alert(1)>"],
    ["space", " "],
    ["emoji with leading space", " 👍"],
    ["emoji with trailing space", "👍 "],
    ["emoji with newline", "👍\n"],
    ["emoji then text", "👍lol"],
    ["text then emoji", "lol👍"],
    ["two emoji", "👍👍"],
    ["two emoji (different)", "😀😃"],
    ["single regional indicator", "🇦"],
    ["three regional indicators", "🇦🇧🇨"],
    ["dangling ZWJ", "👍\u200D"],
    ["leading ZWJ", "\u200D👍"],
    ["lone VS16", "\uFE0F"],
    ["lone ZWJ", "\u200D"],
    ["zero width space", "\u200B"],
    ["RTL override", "\u202E👍"],
    ["CJK", "漢"],
    ["accented letter", "é"],
  ];
  for (const [label, value] of bad) {
    test(label, () => {
      expect(isValidUnicodeReactionEmoji(value)).toBe(false);
    });
  }

  test(`over ${MAX_REACTION_EMOJI_LENGTH} code units`, () => {
    // A syntactically valid but absurd ZWJ chain.
    const chain = Array.from({ length: 12 }, () => "👨").join("\u200D");
    expect(chain.length).toBeGreaterThan(MAX_REACTION_EMOJI_LENGTH);
    expect(isValidUnicodeReactionEmoji(chain)).toBe(false);
  });

  test("an emoji padded with a long run of variation selectors", () => {
    expect(isValidUnicodeReactionEmoji("👍" + "\uFE0F".repeat(40))).toBe(false);
  });
});

describe("addReaction: distinct emoji cap", () => {
  const full = (n: number): StoredReaction[] =>
    Array.from({ length: n }, (_, i) => ({ emoji: { name: `e${i}` }, count: 1, userIds: [ALICE] }));

  test(`a new emoji is refused once ${MAX_REACTION_EMOJIS} exist`, () => {
    const input = full(MAX_REACTION_EMOJIS);
    const res = addReaction(input, matchReactionEmoji({ name: "new" }), { name: "new" }, BOB);
    expect(res.limitReached).toBe(true);
    expect(res.count).toBe(0);
    expect(res.reactions).toHaveLength(MAX_REACTION_EMOJIS);
    expect(res.reactions.some((r) => r.emoji.name === "new")).toBe(false);
  });

  test("joining an existing emoji is allowed at the cap", () => {
    const input = full(MAX_REACTION_EMOJIS);
    const res = addReaction(input, matchReactionEmoji({ name: "e3" }), { name: "e3" }, BOB);
    expect(res.limitReached).toBe(false);
    expect(res.count).toBe(2);
    expect(res.reactions).toHaveLength(MAX_REACTION_EMOJIS);
  });

  test("the 20th distinct emoji is still allowed", () => {
    const input = full(MAX_REACTION_EMOJIS - 1);
    const res = addReaction(input, matchReactionEmoji({ name: "new" }), { name: "new" }, BOB);
    expect(res.limitReached).toBe(false);
    expect(res.reactions).toHaveLength(MAX_REACTION_EMOJIS);
  });

  test("a custom cap can be passed", () => {
    const res = addReaction(full(3), matchReactionEmoji({ name: "new" }), { name: "new" }, BOB, undefined, 3);
    expect(res.limitReached).toBe(true);
  });

  test("a refused add leaves the input untouched", () => {
    const input = full(MAX_REACTION_EMOJIS);
    addReaction(input, matchReactionEmoji({ name: "new" }), { name: "new" }, BOB);
    expect(input).toHaveLength(MAX_REACTION_EMOJIS);
  });
});
