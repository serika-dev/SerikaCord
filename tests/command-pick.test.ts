import { describe, expect, test } from "bun:test";
import { pickedCommandStillTyped } from "@/lib/chat/commandPick";

describe("picked bot command", () => {
  test("still typed: the picked command runs", () => {
    expect(pickedCommandStillTyped("/roll", "roll")).toBe(true);
    expect(pickedCommandStillTyped("/roll  type:waifu", "roll")).toBe(true);
    expect(pickedCommandStillTyped("/settings channel add", "settings channel")).toBe(true);
    expect(pickedCommandStillTyped("/ROLL", "roll")).toBe(true);
  });
  test("edited away: fall back to normal matching", () => {
    expect(pickedCommandStillTyped("/rolls", "roll")).toBe(false);
    expect(pickedCommandStillTyped("/8ball", "roll")).toBe(false);
    expect(pickedCommandStillTyped("roll", "roll")).toBe(false);
    expect(pickedCommandStillTyped("/settings series", "settings channel")).toBe(false);
    expect(pickedCommandStillTyped("/roll", "")).toBe(false);
  });
});
