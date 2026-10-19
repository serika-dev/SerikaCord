import { describe, expect, test } from "bun:test";
import {
  hasDiscoveryTag,
  isIgdbCoverUrl,
  normalizeDiscoveryTags,
  normalizeServerGames,
  readDiscoveryTags,
  readServerGames,
  readServerTagConfig,
  resolvedTagOf,
  serverTagPointer,
  stripServerTagWrite,
  validateServerTagText,
  validateTagEmoji,
  withServerTag,
  type ResolvedServerTag,
} from "../src/lib/servers/serverProfile";

const COVER = "https://images.igdb.com/igdb/image/upload/t_cover_big/co1wyy.jpg";

describe("server tag text (CORD-53)", () => {
  test("accepts 2-4 letters or numbers, unicode included", () => {
    expect(validateServerTagText("GG")).toEqual({ ok: true, value: "GG" });
    expect(validateServerTagText(" ab12 ")).toEqual({ ok: true, value: "ab12" });
    expect(validateServerTagText("日本")).toEqual({ ok: true, value: "日本" });
  });
  test("rejects wrong length, symbols, markup and non-strings", () => {
    expect(validateServerTagText("A").ok).toBe(false);
    expect(validateServerTagText("ABCDE").ok).toBe(false);
    expect(validateServerTagText("A B").ok).toBe(false);
    expect(validateServerTagText("<b>").ok).toBe(false);
    expect(validateServerTagText("a​b").ok).toBe(false);
    expect(validateServerTagText(42).ok).toBe(false);
  });
});

describe("tag emoji", () => {
  test("one emoji only", () => {
    expect(validateTagEmoji("🔥").ok).toBe(true);
    expect(validateTagEmoji("👍🏽").ok).toBe(true);
    expect(validateTagEmoji("🇯🇵").ok).toBe(true);
    expect(validateTagEmoji("👨‍👩‍👧").ok).toBe(true);
    expect(validateTagEmoji("🔥🔥").ok).toBe(false);
    expect(validateTagEmoji("a").ok).toBe(false);
    expect(validateTagEmoji("<img>").ok).toBe(false);
    expect(validateTagEmoji("").ok).toBe(false);
  });
});

describe("stored tag config", () => {
  test("only enabled, valid tags are read", () => {
    expect(readServerTagConfig(null)).toBeNull();
    expect(readServerTagConfig({ enabled: false, tag: "GG" })).toBeNull();
    expect(readServerTagConfig({ enabled: true, tag: "X" })).toBeNull();
    const cfg = readServerTagConfig({ enabled: true, tag: "GG", icon: "nope", color: "red", emojiUrl: "javascript:alert(1)" });
    expect(cfg).toMatchObject({ tag: "GG", icon: "star", color: "#8B5CF6", emojiUrl: null });
  });
});

describe("customization pointer and resolution", () => {
  const resolved: ResolvedServerTag = { serverId: "s1", serverName: "Srv", tag: "GG", icon: "zap", color: "#10B981" };

  test("pointer is read from customization", () => {
    expect(serverTagPointer({ serverTag: { serverId: "s1" } })).toBe("s1");
    expect(serverTagPointer({ serverTag: "s1" })).toBeNull();
    expect(serverTagPointer(null)).toBeNull();
  });

  test("withServerTag swaps or removes the tag without mutating", () => {
    const c = { profileColor: "#000000", serverTag: { serverId: "s1" } };
    expect(withServerTag(c, resolved)).toEqual({ profileColor: "#000000", serverTag: resolved });
    expect(withServerTag(c, null)).toEqual({ profileColor: "#000000" });
    expect(c.serverTag).toEqual({ serverId: "s1" });
    expect(withServerTag(null, resolved)).toEqual({ serverTag: resolved });
  });

  test("client writes cannot set serverTag", () => {
    expect(stripServerTagWrite({ serverTag: { serverId: "x", tag: "ADMN" }, nameplate: { type: "none" } })).toEqual({ nameplate: { type: "none" } });
    expect(stripServerTagWrite({ a: 1 })).toEqual({ a: 1 });
  });

  test("resolvedTagOf renders only resolved, valid tags", () => {
    expect(resolvedTagOf({ serverTag: resolved })).toMatchObject({ tag: "GG", icon: "zap" });
    expect(resolvedTagOf({ serverTag: { serverId: "s1" } })).toBeNull();
    expect(resolvedTagOf({ serverTag: { serverId: "s1", tag: "TOOLONG" } })).toBeNull();
  });
});

describe("discovery tags (CORD-52)", () => {
  test("normalizes, dedupes and limits", () => {
    expect(normalizeDiscoveryTags(["  Chill  vibes ", "chill vibes", "Art", ""])).toEqual({ ok: true, value: ["Chill vibes", "Art"] });
    expect(normalizeDiscoveryTags(["a", "b", "c", "d", "e", "f"]).ok).toBe(false);
    expect(normalizeDiscoveryTags(["x".repeat(25)]).ok).toBe(false);
    expect(normalizeDiscoveryTags(["<script>"]).ok).toBe(false);
    expect(normalizeDiscoveryTags("art").ok).toBe(false);
    expect(normalizeDiscoveryTags(["C++", "Rock & Roll", "#1 fans"]).ok).toBe(false);
    expect(normalizeDiscoveryTags(["C++", "Rock & Roll"]).ok).toBe(true);
  });
  test("reading and matching", () => {
    expect(readDiscoveryTags({ discoveryTags: ["Art", 5] })).toEqual([]);
    expect(readDiscoveryTags({ discoveryTags: ["Art", "Music"] })).toEqual(["Art", "Music"]);
    expect(readDiscoveryTags(null)).toEqual([]);
    expect(hasDiscoveryTag(["Art", "Music"], " music ")).toBe(true);
    expect(hasDiscoveryTag(["Art"], "")).toBe(false);
  });
});

describe("server games (CORD-51)", () => {
  test("only IGDB covers", () => {
    expect(isIgdbCoverUrl(COVER)).toBe(true);
    expect(isIgdbCoverUrl("https://evil.example/igdb/image/upload/t_cover_big/a.jpg")).toBe(false);
    expect(isIgdbCoverUrl("http://images.igdb.com/igdb/image/upload/t_cover_big/a.jpg")).toBe(false);
  });
  test("validates catalog entries", () => {
    expect(normalizeServerGames([{ igdbId: 1, name: " Celeste ", coverUrl: COVER }, { igdbId: 1, name: "dup" }]))
      .toEqual({ ok: true, value: [{ igdbId: 1, name: "Celeste", coverUrl: COVER }] });
    expect(normalizeServerGames([{ igdbId: 2, name: "X", coverUrl: "https://cdn.example/x.png" }]).ok).toBe(false);
    expect(normalizeServerGames([{ igdbId: -1, name: "X" }]).ok).toBe(false);
    expect(normalizeServerGames([{ igdbId: 3, name: "" }]).ok).toBe(false);
    expect(normalizeServerGames(Array.from({ length: 11 }, (_, i) => ({ igdbId: i + 1, name: `G${i}` }))).ok).toBe(false);
  });
  test("reading drops bad entries", () => {
    expect(readServerGames({ games: [{ igdbId: 1, name: "A" }, { igdbId: "x", name: "B" }] })).toEqual([{ igdbId: 1, name: "A", coverUrl: null }]);
  });
});
