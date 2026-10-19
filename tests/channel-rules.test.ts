import { describe, expect, test } from "bun:test";
import {
  CHANNEL_NAME_MAX,
  channelNameMatches,
  channelsToMarkNsfw,
  normalizeChannelName,
  resolveChannelNsfw,
} from "../src/lib/servers/channelRules";

describe("normalizeChannelName (CORD-56)", () => {
  test("keeps spaces and capital letters", () => {
    expect(normalizeChannelName("General Chat")).toBe("General Chat");
    expect(normalizeChannelName("Memes & Stuff")).toBe("Memes & Stuff");
  });

  test("keeps dash-style names untouched", () => {
    expect(normalizeChannelName("general-chat")).toBe("general-chat");
  });

  test("collapses whitespace and trims", () => {
    expect(normalizeChannelName("  hello    world  ")).toBe("hello world");
    expect(normalizeChannelName("a\tb\nc")).toBe("a b c");
  });

  test("removes control and bidi override characters", () => {
    expect(normalizeChannelName("evil\u202Etxt.exe")).toBe("evil txt.exe");
    expect(normalizeChannelName("bell\u0007")).toBe("bell");
    expect(normalizeChannelName("\u0000\u0001")).toBe("");
  });

  test("keeps emoji joiner sequences", () => {
    expect(normalizeChannelName("👨‍👩‍👧 family")).toBe("👨‍👩‍👧 family");
  });

  test("caps the length", () => {
    expect(normalizeChannelName("x".repeat(150))).toHaveLength(CHANNEL_NAME_MAX);
  });

  test("rejects empty and non-strings", () => {
    expect(normalizeChannelName("   ")).toBe("");
    expect(normalizeChannelName(undefined)).toBe("");
    expect(normalizeChannelName(42)).toBe("");
  });
});

describe("channelNameMatches", () => {
  test("matches across space, dash and underscore", () => {
    expect(channelNameMatches("General Chat", "general-ch")).toBe(true);
    expect(channelNameMatches("general-chat", "General")).toBe(true);
    expect(channelNameMatches("dev_logs", "dev-l")).toBe(true);
  });

  test("empty query matches everything, unrelated query doesn't", () => {
    expect(channelNameMatches("anything", "")).toBe(true);
    expect(channelNameMatches("General Chat", "voice")).toBe(false);
  });
});

describe("category NSFW inheritance (CORD-60)", () => {
  test("a channel in an NSFW category is NSFW", () => {
    expect(resolveChannelNsfw({ type: "text", requested: false, parentNsfw: true })).toBe(true);
    expect(resolveChannelNsfw({ type: "voice", requested: undefined, parentNsfw: true })).toBe(true);
    expect(resolveChannelNsfw({ type: "text", requested: true, parentNsfw: false })).toBe(true);
    expect(resolveChannelNsfw({ type: "text", requested: false, parentNsfw: false })).toBe(false);
  });

  test("a category keeps its own flag", () => {
    expect(resolveChannelNsfw({ type: "category", requested: true })).toBe(true);
    expect(resolveChannelNsfw({ type: "category", requested: false, parentNsfw: true })).toBe(false);
  });

  test("channelsToMarkNsfw picks direct, unmarked, non-category children", () => {
    const cat = "AAAAAAAA-0000-0000-0000-000000000001";
    const channels = [
      { id: "1", type: "text", parentId: cat.toLowerCase(), nsfw: false },
      { id: "2", type: "voice", parentId: cat, nsfw: null },
      { id: "3", type: "text", parentId: cat, nsfw: true },
      { id: "4", type: "text", parentId: "other", nsfw: false },
      { id: "5", type: "text", parentId: null, nsfw: false },
    ];
    expect(channelsToMarkNsfw(cat, channels).map((c) => c.id)).toEqual(["1", "2"]);
  });
});
