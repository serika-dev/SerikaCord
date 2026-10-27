import { describe, expect, test } from "bun:test";
import { placeMenu } from "@/hooks/useMenuPlacement";

const vp = { width: 1280, height: 800 };
const menu = { width: 200, height: 300 };

describe("placeMenu", () => {
  test("opens down-right of the pointer when it fits", () => {
    expect(placeMenu(100, 100, menu, vp)).toEqual({ left: 100, top: 100 });
  });
  test("flips up near the bottom (channel at the bottom of the list)", () => {
    expect(placeMenu(100, 780, menu, vp)).toEqual({ left: 100, top: 480 });
  });
  test("flips left near the right edge", () => {
    expect(placeMenu(1250, 100, menu, vp)).toEqual({ left: 1050, top: 100 });
  });
  test("clamps a menu taller than the space on both sides", () => {
    expect(placeMenu(100, 200, { width: 200, height: 700 }, vp).top).toBe(8);
    expect(placeMenu(100, 200, { width: 200, height: 900 }, vp).top).toBe(8);
  });
});
