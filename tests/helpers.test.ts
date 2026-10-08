import { describe, expect, test } from "bun:test";
import { isChunkLoadError, reloadForNewBuild } from "@/lib/chunkReload";
import { extractUserMentionIds } from "@/lib/services/messageSignals";
import { parseSearchQuery, hasActiveFilters } from "@/lib/chat/searchQuery";
import { BoundedMap } from "@/lib/utils/boundedMap";

const U1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const U2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ROLE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("isChunkLoadError", () => {
  test("detects a stale-build chunk failure from every bundler/browser wording", () => {
    const errors = [
      Object.assign(new Error("whatever"), { name: "ChunkLoadError" }),
      new Error("Loading chunk 4821 failed."),
      new Error("Loading CSS chunk app-layout failed"),
      new TypeError("Failed to fetch dynamically imported module: https://serika.chat/_next/x.js"),
      new TypeError("Importing a module script failed."),
      new TypeError("error loading dynamically imported module"),
    ];
    for (const err of errors) expect(isChunkLoadError(err)).toBeTrue();
  });

  test("ignores ordinary errors and non-errors", () => {
    expect(isChunkLoadError(new Error("Network request failed"))).toBeFalse();
    expect(isChunkLoadError(new TypeError("x is undefined"))).toBeFalse();
    expect(isChunkLoadError(null)).toBeFalse();
    expect(isChunkLoadError(undefined)).toBeFalse();
    expect(isChunkLoadError("Loading chunk 1 failed")).toBeFalse();
    expect(isChunkLoadError({})).toBeFalse();
  });

  test("reloadForNewBuild is a no-op outside the browser", () => {
    expect(reloadForNewBuild()).toBeFalse();
  });
});

describe("extractUserMentionIds", () => {
  test("finds <@id> and <@!id> mentions, once each", () => {
    expect(extractUserMentionIds(`hi <@${U1}> and <@!${U2}>, again <@${U1}>`)).toEqual([U1, U2]);
  });

  test("ignores role and channel mentions", () => {
    expect(extractUserMentionIds(`<@&${ROLE}> <#${ROLE}> @everyone`)).toEqual([]);
  });

  test("handles empty input", () => {
    expect(extractUserMentionIds("")).toEqual([]);
    expect(extractUserMentionIds(null)).toEqual([]);
    expect(extractUserMentionIds(undefined)).toEqual([]);
  });
});

describe("parseSearchQuery", () => {
  test("pulls filters out of the free text", () => {
    const q = parseSearchQuery("deploy from:@alice has:Image before:2026-01-01 in:#general broke");
    expect(q).toEqual({
      text: "deploy broke",
      from: "alice",
      has: "image",
      before: "2026-01-01",
      inChannel: "general",
    });
    expect(hasActiveFilters(q)).toBeTrue();
  });

  test("ignores unknown has: values and empty filters", () => {
    const q = parseSearchQuery("has:pizza from: hello");
    expect(q.has).toBeUndefined();
    expect(q.from).toBeUndefined();
    expect(q.text).toBe("from: hello");
    expect(hasActiveFilters(q)).toBeFalse();
  });
});

describe("BoundedMap", () => {
  test("evicts the oldest entry past maxSize", () => {
    const m = new BoundedMap<string, number>(2);
    m.set("a", 1).set("b", 2).set("c", 3);
    expect([...m.keys()]).toEqual(["b", "c"]);
  });

  test("re-setting a key refreshes its position", () => {
    const m = new BoundedMap<string, number>(2);
    m.set("a", 1).set("b", 2).set("a", 10).set("c", 3);
    expect([...m.entries()]).toEqual([["a", 10], ["c", 3]]);
  });
});
