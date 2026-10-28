import { describe, expect, it } from "bun:test";
import {
  PROFILE_POPOVER_COLLISION_PADDING,
  PROFILE_POPOVER_SIDE_OFFSET,
  profilePopoverPositioning,
  profilePopoverSide,
} from "@/lib/profiles/profilePopoverPlacement";

describe("profile card placement", () => {
  it("opens to the right of chat triggers and to the left of the member list", () => {
    expect(profilePopoverSide("chat")).toBe("right");
    expect(profilePopoverSide("rightPanel")).toBe("left");
  });

  it("defaults to the chat placement", () => {
    expect(profilePopoverPositioning().side).toBe("right");
  });

  it("top-aligns the card with its trigger, beside it", () => {
    for (const surface of ["chat", "rightPanel"] as const) {
      const p = profilePopoverPositioning(surface);
      expect(p.align).toBe("start");
      expect(p.sideOffset).toBe(PROFILE_POPOVER_SIDE_OFFSET);
      expect(p.sideOffset).toBeGreaterThanOrEqual(8);
      expect(p.sideOffset).toBeLessThanOrEqual(12);
    }
  });

  it("keeps the card inside the viewport: flips, shifts all the way and pads the edges", () => {
    const p = profilePopoverPositioning("chat");
    expect(p.avoidCollisions).toBe(true);
    // "partial" would stop shifting once the card leaves its trigger's edge,
    // which is what let tall cards hang off the bottom of the window.
    expect(p.sticky).toBe("always");
    expect(p.collisionPadding).toBe(PROFILE_POPOVER_COLLISION_PADDING);
    expect(p.collisionPadding).toBe(12);
    expect(p.hideWhenDetached).toBe(true);
  });
});
