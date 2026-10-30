import { describe, expect, test } from "bun:test";
import { assignGroupKeys } from "../src/lib/chat/messageWindow";

const g = (...ids: string[]) => ({ messages: ids.map((id) => ({ id })) });

describe("assignGroupKeys", () => {
  test("new groups are keyed by their first message", () => {
    expect(assignGroupKeys([g("a", "b"), g("c")], new Map())).toEqual(["group-a", "group-c"]);
  });

  test("older history prepended to a group keeps its key", () => {
    const memory = new Map<string, string>();
    const [first] = assignGroupKeys([g("c", "d", "e")], memory);
    expect(assignGroupKeys([g("a", "b", "c", "d", "e")], memory)).toEqual([first]);
  });

  test("appending to a group keeps its key", () => {
    const memory = new Map<string, string>();
    const keys = assignGroupKeys([g("a"), g("b", "c")], memory);
    expect(assignGroupKeys([g("a"), g("b", "c", "d")], memory)).toEqual(keys);
  });

  test("a split group: the first half keeps the key, the second gets a new one", () => {
    const memory = new Map<string, string>();
    const [k] = assignGroupKeys([g("a", "b", "c", "d")], memory);
    const next = assignGroupKeys([g("a", "b"), g("c", "d")], memory);
    expect(next[0]).toBe(k);
    expect(next[1]).not.toBe(k);
    expect(new Set(next).size).toBe(2);
  });

  test("keys stay unique", () => {
    const memory = new Map<string, string>([["x", "group-a"]]);
    const keys = assignGroupKeys([g("a"), g("x")], memory);
    expect(new Set(keys).size).toBe(2);
  });
});
