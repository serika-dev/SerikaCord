import { describe, expect, test } from "bun:test";
import {
  classifySwipe,
  clampScale,
  dismissProgressOpacity,
  doubleTapScale,
  pinchScale,
  touchDistance,
  LIGHTBOX_DOUBLE_TAP_SCALE,
  LIGHTBOX_MAX_SCALE,
} from "@/lib/ui/lightboxGestures";

describe("classifySwipe", () => {
  test("long horizontal swipes navigate", () => {
    expect(classifySwipe(-120, 10, 400, true)).toBe("next");
    expect(classifySwipe(120, -10, 400, true)).toBe("prev");
  });

  test("short slow drags do nothing", () => {
    expect(classifySwipe(-30, 0, 600, true)).toBeNull();
    expect(classifySwipe(0, 40, 600, true)).toBeNull();
  });

  test("quick flicks count even when short", () => {
    expect(classifySwipe(-40, 0, 50, true)).toBe("next");
    expect(classifySwipe(0, 40, 50, true)).toBe("dismiss");
  });

  test("no navigation for a single image", () => {
    expect(classifySwipe(-200, 0, 300, false)).toBeNull();
  });

  test("pulling down dismisses, pushing up does not", () => {
    expect(classifySwipe(10, 150, 500, true)).toBe("dismiss");
    expect(classifySwipe(10, -150, 500, true)).toBeNull();
  });
});

describe("zoom helpers", () => {
  test("pinch scales relative to the starting finger distance", () => {
    expect(pinchScale(1, 100, 200)).toBe(2);
    expect(pinchScale(2, 100, 50)).toBe(1);
  });

  test("scale is clamped", () => {
    expect(pinchScale(1, 100, 10000)).toBe(LIGHTBOX_MAX_SCALE);
    expect(pinchScale(1, 100, 10)).toBe(1);
    expect(pinchScale(3, 0, 50)).toBe(3);
    expect(clampScale(Number.NaN)).toBe(1);
  });

  test("double tap toggles", () => {
    expect(doubleTapScale(1)).toBe(LIGHTBOX_DOUBLE_TAP_SCALE);
    expect(doubleTapScale(2)).toBe(1);
  });

  test("touch distance", () => {
    expect(touchDistance({ clientX: 0, clientY: 0 }, { clientX: 3, clientY: 4 })).toBe(5);
  });

  test("dismiss fade", () => {
    expect(dismissProgressOpacity(-20)).toBe(1);
    expect(dismissProgressOpacity(0)).toBe(1);
    expect(dismissProgressOpacity(200)).toBe(0.5);
    expect(dismissProgressOpacity(5000)).toBe(0.35);
  });
});
