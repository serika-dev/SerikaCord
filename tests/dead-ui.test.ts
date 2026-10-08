import { describe, expect, test } from "bun:test";
import { HOTKEYS } from "@/lib/keybinds";
import { isReservedSlug, isValidVanityCode } from "@/lib/constants/reserved";

describe("hotkey table", () => {
  test("does not advertise actions that have no handler", () => {
    const actions = HOTKEYS.map((h) => h.action as string);
    for (const dead of ["toggle-soundboard", "toggle-streamer-mode", "start-dm-call", "create-group-dm"]) {
      expect(actions).not.toContain(dead);
    }
  });

  test("has no duplicate actions", () => {
    const actions = HOTKEYS.map((h) => h.action);
    expect(new Set(actions).size).toBe(actions.length);
  });
});

describe("reserved slugs", () => {
  test("password reset routes can't be claimed as invite/vanity codes", () => {
    expect(isReservedSlug("forgot-password")).toBe(true);
    expect(isReservedSlug("Reset-Password")).toBe(true);
    expect(isValidVanityCode("forgot-password")).toBe(false);
  });
});
