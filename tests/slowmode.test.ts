import { describe, expect, test } from "bun:test";
import { slowmodeRemaining } from "@/lib/services/slowmode";

describe("slowmodeRemaining", () => {
  test("counts down from the last post", () => {
    expect(slowmodeRemaining(10_000, 30, 20_000)).toBe(20);
    expect(slowmodeRemaining(10_000, 30, 39_500)).toBe(1);
    expect(slowmodeRemaining(10_000, 30, 40_000)).toBe(0);
  });
  test("lowering slowmode applies to an older slot", () => {
    expect(slowmodeRemaining(10_000, 5, 20_000)).toBe(0);
  });
  test("no post yet or no slowmode", () => {
    expect(slowmodeRemaining(null, 30)).toBe(0);
    expect(slowmodeRemaining(10_000, 0, 10_001)).toBe(0);
  });
});
