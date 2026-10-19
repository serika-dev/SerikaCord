import { describe, expect, test } from "bun:test";
import { formatDayDivider, groupMessages, isDifferentDay, startsNewDay } from "@/lib/chat/messages";
import type { ChatMessage } from "@/lib/chat/types";

const ALICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** Local-time timestamps so the tests hold in every time zone. */
function at(y: number, mo: number, d: number, h: number, mi: number): string {
  return new Date(y, mo, d, h, mi).toISOString();
}

function msg(id: string, createdAt: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    content: "message " + id,
    authorId: ALICE,
    author: { id: ALICE, username: "alice", displayName: "" },
    channelId: "channel",
    createdAt,
    reactions: [],
    ...extra,
  };
}

describe("date dividers (CORD-41)", () => {
  test("isDifferentDay compares local calendar days", () => {
    expect(isDifferentDay(at(2026, 0, 1, 23, 58), at(2026, 0, 2, 0, 1))).toBe(true);
    expect(isDifferentDay(at(2026, 0, 1, 0, 1), at(2026, 0, 1, 23, 59))).toBe(false);
    expect(isDifferentDay(at(2025, 11, 31, 12, 0), at(2026, 11, 31, 12, 0))).toBe(true);
    expect(isDifferentDay("not a date", at(2026, 0, 1, 0, 0))).toBe(false);
  });

  test("a group never spans midnight, even within the 5 minute window", () => {
    const groups = groupMessages([
      msg("1", at(2026, 0, 1, 23, 58)),
      msg("2", at(2026, 0, 1, 23, 59)),
      msg("3", at(2026, 0, 2, 0, 1)),
    ]);
    expect(groups.map((g) => g.messages.map((m) => m.id))).toEqual([["1", "2"], ["3"]]);
  });

  test("startsNewDay marks the first group of each day", () => {
    const groups = [
      { timestamp: at(2026, 0, 1, 10, 0) },
      { timestamp: at(2026, 0, 1, 18, 0) },
      { timestamp: at(2026, 0, 3, 9, 0) },
    ];
    expect(groups.map((_, i) => startsNewDay(groups, i))).toEqual([false, false, true]);
    // The very first message gets one only once the whole history is loaded.
    expect(startsNewDay(groups, 0, true)).toBe(true);
    expect(startsNewDay(groups, 5, true)).toBe(false);
  });

  test("formatDayDivider uses the locale", () => {
    const ts = at(2026, 9, 18, 12, 0);
    expect(formatDayDivider(ts, "en-US")).toBe("October 18, 2026");
    expect(formatDayDivider(ts, "de-DE")).toBe("18. Oktober 2026");
    expect(formatDayDivider("garbage", "en-US")).toBe("");
  });
});
