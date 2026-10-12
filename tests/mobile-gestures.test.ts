import { describe, expect, test } from "bun:test";
import { gestureAxis, resistedDrag, shouldDismissSheet } from "@/lib/mobile/gestures";

describe("mobile gesture intent", () => {
  test("tap jitter does not claim a gesture", () => {
    expect(gestureAxis(5, 4)).toBeNull();
    expect(gestureAxis(-7, 7)).toBeNull();
  });

  test("scrolling and ambiguous diagonals favor the vertical axis", () => {
    expect(gestureAxis(3, 14)).toBe("vertical");
    expect(gestureAxis(15, 14)).toBe("vertical");
    expect(gestureAxis(-16, -16)).toBe("vertical");
  });

  test("deliberate horizontal gestures work in either direction", () => {
    expect(gestureAxis(16, 3)).toBe("horizontal");
    expect(gestureAxis(-16, 3)).toBe("horizontal");
  });
});

describe("drag resistance", () => {
  test("tracks the finger to the action threshold without a discontinuity", () => {
    expect(resistedDrag(-10, 56)).toBe(0);
    expect(resistedDrag(28, 56)).toBe(28);
    expect(resistedDrag(56, 56)).toBe(56);
    expect(resistedDrag(56.01, 56)).toBeGreaterThan(56);
    expect(resistedDrag(56.01, 56)).toBeLessThan(56.01);
  });

  test("long drags stay bounded and continue to increase smoothly", () => {
    const distances = [60, 80, 120, 240, 1000].map((n) => resistedDrag(n, 56));
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
    expect(distances.every((n) => n > 56 && n <= 84)).toBe(true);
  });
});

describe("sheet dismissal", () => {
  test("a long downward pull dismisses without needing a flick", () => {
    expect(shouldDismissSheet(90, 0)).toBe(true);
    expect(shouldDismissSheet(89, 0.1)).toBe(false);
  });

  test("quick flicks require enough travel, while upward releases snap back", () => {
    expect(shouldDismissSheet(32, 0.8)).toBe(true);
    expect(shouldDismissSheet(12, 3)).toBe(false);
    expect(shouldDismissSheet(40, -0.8)).toBe(false);
    expect(shouldDismissSheet(40, 0)).toBe(false);
  });
});
