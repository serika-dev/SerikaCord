import { describe, expect, test } from "bun:test";
import { reuseUnchanged } from "../src/lib/state/reuseUnchanged";

const key = (m: { id: string }) => m.id;

describe("reuseUnchanged", () => {
  test("returns prev when nothing changed", () => {
    const prev = [{ id: "a", s: 1 }, { id: "b", s: 2 }];
    const next = [{ id: "a", s: 1 }, { id: "b", s: 2 }];
    expect(reuseUnchanged(prev, next, key)).toBe(prev);
  });

  test("reuses unchanged items and swaps changed ones", () => {
    const prev = [{ id: "a", s: 1 }, { id: "b", s: 2 }];
    const next = [{ id: "a", s: 1 }, { id: "b", s: 3 }];
    const out = reuseUnchanged(prev, next, key);
    expect(out).not.toBe(prev);
    expect(out[0]).toBe(prev[0]);
    expect(out[1]).toBe(next[1]);
  });

  test("reordering yields a new array of the old objects", () => {
    const prev = [{ id: "a", s: 1 }, { id: "b", s: 2 }];
    const next = [{ id: "b", s: 2 }, { id: "a", s: 1 }];
    const out = reuseUnchanged(prev, next, key);
    expect(out).not.toBe(prev);
    expect(out[0]).toBe(prev[1]);
    expect(out[1]).toBe(prev[0]);
  });

  test("length change is a change", () => {
    const prev = [{ id: "a", s: 1 }];
    const next = [{ id: "a", s: 1 }, { id: "c", s: 0 }];
    const out = reuseUnchanged(prev, next, key);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(prev[0]);
  });
});
