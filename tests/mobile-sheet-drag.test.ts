import { describe, expect, test } from "bun:test";
import { sheetBackdropOpacity, sheetDragOffset, sheetTakesOver, shouldDismissSheet } from "@/lib/mobile/gestures";

describe("sheet drag", () => {
  test("follows down 1:1, gives only a little upward", () => {
    expect(sheetDragOffset(120)).toBe(120);
    expect(sheetDragOffset(-40)).toBeLessThan(0);
    expect(sheetDragOffset(-400)).toBeGreaterThan(-24);
  });
  test("backdrop fades with progress", () => {
    expect(sheetBackdropOpacity(0, 500)).toBe(1);
    expect(sheetBackdropOpacity(250, 500)).toBe(0.5);
    expect(sheetBackdropOpacity(900, 500)).toBe(0);
  });
  test("content scrolls first, then hands over at the top", () => {
    expect(sheetTakesOver(5, 120)).toBe(false);
    expect(sheetTakesOver(5, 0)).toBe(true);
    expect(sheetTakesOver(5, null)).toBe(true);
    expect(sheetTakesOver(-5, 0)).toBe(false);
  });
  test("dismiss on distance or a flick, otherwise spring back", () => {
    expect(shouldDismissSheet(120, 0)).toBe(true);
    expect(shouldDismissSheet(40, 0.8)).toBe(true);
    expect(shouldDismissSheet(40, 0.1)).toBe(false);
    expect(shouldDismissSheet(10, 2)).toBe(false);
  });
});
