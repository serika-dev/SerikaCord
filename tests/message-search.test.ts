import { describe, expect, test } from "bun:test";
import {
  isSearchable,
  normalizeSearchDate,
  parseSearchQuery,
  replaceSearchSpan,
  searchTimeWindow,
  tokenAtCaret,
} from "@/lib/chat/searchQuery";
import {
  CONTENT_FLAG,
  contentFlags,
  extraSearchText,
  indexTerms,
  matchesAllTerms,
  queryTerms,
  relevanceScore,
  searchWords,
  stripMessageTokens,
} from "@/lib/chat/searchTokens";
import {
  buildSearchRequest,
  groupSearchHits,
  localDateString,
  pushSearchHistory,
  searchPageNumbers,
} from "@/lib/chat/searchClient";

const U1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const C1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("parseSearchQuery (full grammar)", () => {
  test("repeatable filters, quoted values, pinned, during, authorType", () => {
    const q = parseSearchQuery('hi from:alice from:"Bob Smith" mentions:@carol has:link has:file pinned:true during:2026/3/14 authorType:bot there');
    expect(q.text).toBe("hi there");
    expect(q.from).toEqual(["alice", "Bob Smith"]);
    expect(q.mentions).toEqual(["carol"]);
    expect(q.has).toEqual(["link", "file"]);
    expect(q.pinned).toBeTrue();
    expect(q.during).toBe("2026-03-14");
    expect(q.authorTypes).toEqual(["bot"]);
    expect(q.tokens.map((t) => t.key)).toEqual(["from", "from", "mentions", "has", "has", "pinned", "during", "authorType"]);
  });

  test("invalid values are kept as invalid tokens and not applied", () => {
    const q = parseSearchQuery("before:yesterday pinned:maybe has:sticker has:poll");
    expect(q.before).toBeUndefined();
    expect(q.pinned).toBeUndefined();
    expect(q.has).toEqual(["sticker", "poll"]);
    expect(q.tokens.filter((t) => !t.valid).map((t) => t.key)).toEqual(["before", "pinned"]);
  });

  test("unknown keys stay in the text", () => {
    const q = parseSearchQuery("http://example.com foo:bar");
    expect(q.text).toBe("http://example.com foo:bar");
    expect(isSearchable(q)).toBeTrue();
    expect(isSearchable(parseSearchQuery("   "))).toBeFalse();
  });

  test("normalizeSearchDate rejects impossible dates", () => {
    expect(normalizeSearchDate("2026-02-31")).toBeNull();
    expect(normalizeSearchDate("2026-2-3")).toBe("2026-02-03");
    expect(normalizeSearchDate("13/01/2026")).toBeNull();
  });

  test("searchTimeWindow uses Discord day semantics in local time", () => {
    // UTC+2 (getTimezoneOffset = -120): local midnight is 22:00 UTC the day before.
    const w = searchTimeWindow({ after: "2026-03-01", before: "2026-03-05" }, -120);
    expect(w.minTime).toBe("2026-03-01T22:00:00.000Z");
    expect(w.maxTime).toBe("2026-03-04T22:00:00.000Z");
    const d = searchTimeWindow({ during: "2026-03-14" }, 0);
    expect(d).toEqual({ minTime: "2026-03-14T00:00:00.000Z", maxTime: "2026-03-15T00:00:00.000Z" });
  });

  test("tokenAtCaret finds the filter being typed", () => {
    const raw = "hello from:al";
    expect(tokenAtCaret(raw, raw.length)).toEqual({ key: "from", partial: "al", start: 6, end: 13 });
    expect(tokenAtCaret(raw, 2)).toEqual({ key: null, partial: "hello", start: 0, end: 5 });
    expect(tokenAtCaret("x ", 2).key).toBeNull();
  });

  test("replaceSearchSpan inserts and adds a trailing space", () => {
    expect(replaceSearchSpan("from:al rest", 0, 7, "from:alice")).toEqual({ value: "from:alice rest", caret: 11 });
  });
});

describe("search tokenizer", () => {
  test("normalizes case and accents and strips mention tokens", () => {
    expect(searchWords(`Café <@${U1}> DEPLOY <:pog:${U1}>`)).toEqual(["cafe", "deploy", "pog"]);
    expect(stripMessageTokens(`<#${U1}> hi`)).toBe("  hi");
  });

  test("CJK runs become characters and bigrams", () => {
    expect(searchWords("日本語abc")).toEqual(["日", "日本", "本", "本語", "語", "abc"]);
  });

  test("index terms carry prefixes; queries match words or prefixes", () => {
    const idx = indexTerms("Deploying the new build");
    expect(idx.words.has("deploying")).toBeTrue();
    expect(idx.prefixes.has("depl")).toBeTrue();
    expect(idx.prefixes.has("deploying")).toBeFalse();
    expect(matchesAllTerms(idx, queryTerms("depl build"))).toBeTrue();
    expect(matchesAllTerms(idx, queryTerms("ploy"))).toBeFalse();
    expect(matchesAllTerms(idx, queryTerms("deploy missing"))).toBeFalse();
  });

  test("content flags detect links and media URLs", () => {
    expect(contentFlags("see https://x.dev/a.png")).toBe(CONTENT_FLAG.LINK | CONTENT_FLAG.IMAGE_URL);
    expect(contentFlags("clip https://x.dev/v.mp4?x=1")).toBe(CONTENT_FLAG.LINK | CONTENT_FLAG.VIDEO_URL);
    expect(contentFlags("no links here")).toBe(0);
  });

  test("embed text and attachment names are searchable", () => {
    const extra = extraSearchText(
      [{ title: "Release notes", fields: [{ name: "Version", value: "1.2" }] }],
      [{ filename: "report-final.pdf" }],
    );
    const idx = indexTerms(extra);
    expect(matchesAllTerms(idx, queryTerms("release report"))).toBeTrue();
  });

  test("relevance prefers whole words and phrases", () => {
    const terms = queryTerms("build failed");
    const exact = relevanceScore("the build failed again", terms, "build failed");
    const prefix = relevanceScore("builder failedness", terms, "build failed");
    expect(exact).toBeGreaterThan(prefix);
  });
});

describe("search client helpers", () => {
  const users = [{ id: U1, username: "alice", displayName: "Alice A" }];
  const channels = [{ id: C1, name: "general" }];

  test("buildSearchRequest resolves names and turns dates into a window", () => {
    const { params, impossible } = buildSearchRequest(
      parseSearchQuery("hi from:Alice from:zed mentions:alice in:general has:image during:2026-01-02"),
      { users, channels, sort: "oldest", page: 2, tzOffsetMinutes: 0 },
    );
    expect(impossible).toBeFalse();
    expect(params.q).toBe("hi");
    expect(params.authorId).toBe(U1);
    expect(params.author).toBe("zed");
    expect(params.mentions).toBe(U1);
    expect(params.channelId).toBe(C1);
    expect(params.has).toBe("image");
    expect(params.minTime).toBe("2026-01-02T00:00:00.000Z");
    expect(params.maxTime).toBe("2026-01-03T00:00:00.000Z");
    expect(params.sort).toBe("oldest");
    expect(params.offset).toBe("50");
  });

  test("unknown in: channel or an empty date window can't match", () => {
    expect(buildSearchRequest(parseSearchQuery("in:nope"), { users, channels, sort: "newest", page: 0, tzOffsetMinutes: 0 }).impossible).toBeTrue();
    expect(buildSearchRequest(parseSearchQuery("after:2026-01-05 before:2026-01-03"), { users, channels, sort: "newest", page: 0, tzOffsetMinutes: 0 }).impossible).toBeTrue();
  });

  test("groupSearchHits groups consecutive hits per channel", () => {
    const g = groupSearchHits([
      { id: "1", channelId: "a" },
      { id: "2", channelId: "a" },
      { id: "3", channelId: "b" },
      { id: "4", channelId: "a" },
    ]);
    expect(g.map((x) => [x.channelId, x.hits.length])).toEqual([["a", 2], ["b", 1], ["a", 1]]);
  });

  test("searchPageNumbers windows with ellipses", () => {
    expect(searchPageNumbers(0, 1)).toEqual([0]);
    expect(searchPageNumbers(2, 5)).toEqual([0, 1, 2, 3, 4]);
    expect(searchPageNumbers(0, 20)).toEqual([0, 1, 2, 3, 4, null, 19]);
    expect(searchPageNumbers(10, 20)).toEqual([0, null, 9, 10, 11, null, 19]);
    expect(searchPageNumbers(19, 20)).toEqual([0, null, 15, 16, 17, 18, 19]);
  });

  test("history is deduped, most recent first, capped", () => {
    let h: string[] = [];
    for (const q of ["a", "b", "c", "a", "d", "e", "f"]) h = pushSearchHistory(h, q);
    expect(h).toEqual(["f", "e", "d", "a", "c"]);
  });

  test("localDateString counts back calendar days", () => {
    expect(localDateString(1, new Date(2026, 2, 1, 12))).toBe("2026-02-28");
  });
});
