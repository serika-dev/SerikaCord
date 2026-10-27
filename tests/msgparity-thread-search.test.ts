import { describe, expect, test } from "bun:test";
import { matchThreadName, parseSlop, relevanceScore, searchWords, snowflakeBoundMs, DEFAULT_SLOP } from "../src/lib/botapi/threadSearchMatch";
import { filterAndSortThreads, threadSearchPlan } from "../src/lib/botapi/threadRules";
import { snowflakeForTime } from "../src/lib/botapi/snowflake";

describe("thread search name matching", () => {
  test("words: lowercase, punctuation split", () => {
    expect(searchWords("Bug: Login-Page broken!")).toEqual(["bug", "login", "page", "broken"]);
  });
  test("prefix match, any order, within slop", () => {
    expect(matchThreadName("Login page is broken", ["log", "brok"], 2)).not.toBeNull();
    expect(matchThreadName("Login page is broken", ["brok", "log"], 2)).not.toBeNull();
    // 2 words between the matches: needs slop >= 2.
    expect(matchThreadName("Login page is broken", ["login", "broken"], 1)).toBeNull();
    expect(matchThreadName("Login page is broken", ["login", "broken"], 2)?.gap).toBe(2);
    expect(matchThreadName("Login page", ["logout"], 100)).toBeNull();
  });
  test("smallest window wins", () => {
    const m = matchThreadName("a x x x b a b", ["a", "b"], 0);
    expect(m).not.toBeNull();
    expect(m!.gap).toBe(0);
  });
  test("phrase and exact", () => {
    expect(matchThreadName("login page", ["login", "page"], 0)).toMatchObject({ phrase: true, exact: true });
    expect(matchThreadName("the login page", ["login", "page"], 0)).toMatchObject({ phrase: true, exact: false });
  });
  test("empty query matches everything", () => {
    expect(matchThreadName("anything", [], 0)).not.toBeNull();
  });
  test("relevance: exact > phrase > loose", () => {
    const exact = relevanceScore(matchThreadName("login page", ["login", "page"], 5)!);
    const phrase = relevanceScore(matchThreadName("new login page", ["login", "page"], 5)!);
    const loose = relevanceScore(matchThreadName("login on the page", ["login", "page"], 5)!);
    expect(exact).toBeGreaterThan(phrase);
    expect(phrase).toBeGreaterThan(loose);
  });
  test("slop: default 2, 0..100", () => {
    expect(parseSlop(undefined)).toBe(DEFAULT_SLOP);
    expect(parseSlop("0")).toBe(0);
    expect(parseSlop("100")).toBe(100);
    expect(parseSlop("101")).toBeNull();
    expect(parseSlop("x")).toBeNull();
  });
  test("min/max id bounds decode to creation times", () => {
    const t = Date.UTC(2026, 0, 1);
    expect(snowflakeBoundMs(snowflakeForTime(t))).toBe(t);
    expect(snowflakeBoundMs(undefined)).toBeUndefined();
    expect(Number.isNaN(snowflakeBoundMs("not-an-id")!)).toBe(true);
  });
});

describe("threadSearchPlan + filterAndSortThreads", () => {
  const rows = [
    { id: "1", name: "Login page broken", appliedTags: [], archived: false, createdAt: new Date(1000), updatedAt: new Date(9000) },
    { id: "2", name: "login", appliedTags: [], archived: false, createdAt: new Date(2000), updatedAt: new Date(3000) },
    { id: "3", name: "Broken login after the big update", appliedTags: [], archived: false, createdAt: new Date(3000), updatedAt: new Date(4000) },
  ];
  test("relevance sort", () => {
    expect(filterAndSortThreads(rows, threadSearchPlan({ name: "login", sort_by: "relevance" })).map((r) => r.id)).toEqual(["2", "1", "3"]);
  });
  test("slop filters far-apart words", () => {
    expect(filterAndSortThreads(rows, threadSearchPlan({ name: "login broken", slop: "0" })).map((r) => r.id)).toEqual(["3"]);
    expect(filterAndSortThreads(rows, threadSearchPlan({ name: "login broken", slop: "2" })).map((r) => r.id).sort()).toEqual(["1", "3"]);
  });
  test("min / max bounds (inclusive)", () => {
    expect(filterAndSortThreads(rows, threadSearchPlan({}, { minMs: 2000 })).map((r) => r.id)).toEqual(["3", "2"]);
    expect(filterAndSortThreads(rows, threadSearchPlan({}, { minMs: 2000, maxMs: 2000 })).map((r) => r.id)).toEqual(["2"]);
  });
});
