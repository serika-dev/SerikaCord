import { describe, expect, test } from "bun:test";
import {
  DEFAULT_QUICK_REACTIONS,
  emojiKey,
  emojiToken,
  frecencyFromRecentList,
  frecencyScore,
  MAX_FRECENCY_ENTRIES,
  quickReactions,
  rankFrecentEmojis,
  recordEmojiUse,
  sanitizeFrecencyState,
  type FrecencyEmoji,
  type FrecencyState,
} from "@/lib/chat/emojiFrecency";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
const u = (emoji: string): FrecencyEmoji => ({ kind: "unicode", emoji });
const custom: FrecencyEmoji = { kind: "custom", id: "11111111-1111-4111-8111-111111111111", name: "blob", url: "https://cdn/x.png", animated: true };

function useMany(state: FrecencyState, emoji: FrecencyEmoji, times: number, at: number): FrecencyState {
  let s = state;
  for (let i = 0; i < times; i++) s = recordEmojiUse(s, emoji, at + i);
  return s;
}

describe("emoji frecency", () => {
  test("frequent beats once-used; recent beats old at equal counts", () => {
    let s: FrecencyState = {};
    s = useMany(s, u("👍"), 5, NOW - DAY);
    s = useMany(s, u("🔥"), 1, NOW);
    expect(rankFrecentEmojis(s, NOW).map(emojiKey)).toEqual(["u:👍", "u:🔥"]);

    let t: FrecencyState = {};
    t = useMany(t, u("😂"), 3, NOW - 60 * DAY);
    t = useMany(t, u("😮"), 3, NOW - DAY);
    expect(rankFrecentEmojis(t, NOW)[0]).toEqual(u("😮"));
  });

  test("scores decay with age", () => {
    const fresh = recordEmojiUse({}, u("a"), NOW)["u:a"];
    const old = recordEmojiUse({}, u("a"), NOW - 200 * DAY)["u:a"];
    expect(frecencyScore(fresh, NOW)).toBeGreaterThan(frecencyScore(old, NOW));
  });

  test("custom emojis keep their metadata and token", () => {
    const s = recordEmojiUse({}, custom, NOW);
    expect(rankFrecentEmojis(s, NOW)[0]).toEqual(custom);
    expect(emojiToken(custom)).toBe("<a:blob:11111111-1111-4111-8111-111111111111>");
    expect(emojiToken(u("👍"))).toBe("👍");
  });

  test("the store is bounded", () => {
    let s: FrecencyState = {};
    for (let i = 0; i < MAX_FRECENCY_ENTRIES + 20; i++) s = recordEmojiUse(s, u(`e${i}`), NOW + i);
    expect(Object.keys(s).length).toBe(MAX_FRECENCY_ENTRIES);
    // The newest one survives the pruning.
    expect(s[`u:e${MAX_FRECENCY_ENTRIES + 19}`]).toBeDefined();
  });

  test("sanitize drops junk; legacy recent lists migrate in order", () => {
    expect(sanitizeFrecencyState({ x: { emoji: { kind: "nope" } }, y: 3 })).toEqual({});
    expect(sanitizeFrecencyState("x")).toEqual({});
    const migrated = frecencyFromRecentList([u("1"), u("2"), u("3")], NOW);
    expect(rankFrecentEmojis(migrated, NOW).map(emojiKey)).toEqual(["u:1", "u:2", "u:3"]);
  });

  test("quick reactions: frecent first, padded with Discord's defaults, no duplicates", () => {
    expect(quickReactions([], 4)).toEqual(DEFAULT_QUICK_REACTIONS.slice(0, 4));
    expect(quickReactions([u("🔥"), custom], 4).map(emojiKey)).toEqual(["u:🔥", emojiKey(custom), "u:👍", "u:❤️"]);
  });
});
