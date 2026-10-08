import { describe, expect, test } from "bun:test";
import { capTail, reconcileLatestPage, reinsertMessage } from "@/lib/chat/messageWindow";
import type { ChatMessage } from "@/lib/chat/types";

const T0 = Date.parse("2026-01-01T12:00:00.000Z");

function msg(id: string, minute: number, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    content: `message ${id}`,
    authorId: "a",
    author: { id: "a", username: "a", displayName: "" },
    channelId: "c",
    createdAt: new Date(T0 + minute * 60_000).toISOString(),
    ...extra,
  };
}
const ids = (list: ChatMessage[]) => list.map((m) => m.id);

describe("reconcileLatestPage", () => {
  test("drops cached messages deleted inside the page range and takes server copies", () => {
    const prev = [msg("1", 1), msg("2", 2), msg("3", 3, { content: "old" }), msg("4", 4)];
    const page = [msg("2", 2), msg("3", 3, { content: "edited" }), msg("5", 5)];
    const out = reconcileLatestPage(page, prev);
    expect(ids(out)).toEqual(["1", "2", "3", "5"]);
    expect(out[2].content).toBe("edited");
  });

  test("drops older cache when it doesn't overlap the page (possible gap)", () => {
    const prev = [msg("1", 1), msg("2", 2)];
    const page = [msg("10", 10), msg("11", 11)];
    expect(ids(reconcileLatestPage(page, prev))).toEqual(["10", "11"]);
  });

  test("keeps newer live messages, temps and ephemerals", () => {
    const prev = [
      msg("2", 2),
      msg("e", 2.5, { ephemeral: true }),
      msg("3", 3),
      msg("9", 9),
      msg("temp-1", 0),
    ];
    const page = [msg("2", 2), msg("3", 3)];
    expect(ids(reconcileLatestPage(page, prev))).toEqual(["2", "e", "3", "9", "temp-1"]);
  });

  test("empty page clears confirmed messages", () => {
    expect(ids(reconcileLatestPage([], [msg("1", 1), msg("temp-x", 2)]))).toEqual(["temp-x"]);
  });
});

describe("capTail", () => {
  test("keeps the newest entries", () => {
    expect(capTail([1, 2, 3, 4], 2)).toEqual([3, 4]);
    expect(capTail([1, 2], 5)).toEqual([1, 2]);
  });
});

describe("reinsertMessage", () => {
  test("restores after its neighbour without dropping newer arrivals", () => {
    const list = [msg("1", 1), msg("3", 3), msg("4", 4)];
    expect(ids(reinsertMessage(list, msg("2", 2), "1"))).toEqual(["1", "2", "3", "4"]);
  });

  test("falls back to createdAt order and is a no-op when present", () => {
    const list = [msg("1", 1), msg("3", 3)];
    expect(ids(reinsertMessage(list, msg("2", 2), "gone"))).toEqual(["1", "2", "3"]);
    expect(reinsertMessage(list, list[0])).toBe(list);
  });
});
