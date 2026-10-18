import { describe, expect, test } from "bun:test";
import { DOUBLE_SPACE_WINDOW_MS, shouldInsertDoubleSpacePeriod } from "../src/lib/chat/doubleSpacePeriod";

describe("shouldInsertDoubleSpacePeriod", () => {
  test("a quick second space after a word becomes a period", () => {
    expect(shouldInsertDoubleSpacePeriod("hello ", 120)).toBe(true);
    expect(shouldInsertDoubleSpacePeriod("route 66 ", 200)).toBe(true);
    expect(shouldInsertDoubleSpacePeriod("こんにちは ", 200)).toBe(true);
  });

  test("too slow, or no space before the caret, does nothing", () => {
    expect(shouldInsertDoubleSpacePeriod("hello ", DOUBLE_SPACE_WINDOW_MS + 1)).toBe(false);
    expect(shouldInsertDoubleSpacePeriod("hello", 100)).toBe(false);
    expect(shouldInsertDoubleSpacePeriod("hello ", -5)).toBe(false);
  });

  test("not after punctuation, a second space, or an empty composer", () => {
    expect(shouldInsertDoubleSpacePeriod("hello. ", 100)).toBe(false);
    expect(shouldInsertDoubleSpacePeriod("hello!  ", 100)).toBe(false);
    expect(shouldInsertDoubleSpacePeriod("hello  ", 100)).toBe(false);
    expect(shouldInsertDoubleSpacePeriod(" ", 100)).toBe(false);
    expect(shouldInsertDoubleSpacePeriod("", 100)).toBe(false);
  });
});
