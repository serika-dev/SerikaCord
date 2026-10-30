import { describe, expect, test } from "bun:test";
import { parseRowBadges, reuseRows, rowBadgeKey, sameRow, type DmListRow } from "../src/lib/mobile/dmList";

const row = (id: string, extra: Partial<DmListRow> = {}): DmListRow => ({
  id,
  recipientId: `u-${id}`,
  href: `/dm/u-${id}`,
  type: "dm",
  name: `Name ${id}`,
  username: `user${id}`,
  lastMessage: "hi",
  timestamp: "5m",
  status: "online",
  ...extra,
});

describe("DM list row badges", () => {
  test("key encodes unread and mention count per row, and parses back", () => {
    const unread = new Set(["b"]);
    const mentions: Record<string, number> = { c: 3 };
    const key = rowBadgeKey(
      { isChannelUnread: (id) => unread.has(id), getMentionCount: (id) => mentions[id] ?? 0 },
      [row("a"), row("b"), row("c")],
    );
    expect(key).toBe("a:0:0;b:1:0;c:0:3;");
    const parsed = parseRowBadges(key);
    expect(parsed.get("a")).toEqual({ unread: false, mentions: 0 });
    expect(parsed.get("b")).toEqual({ unread: true, mentions: 0 });
    expect(parsed.get("c")).toEqual({ unread: false, mentions: 3 });
    expect(parseRowBadges("").size).toBe(0);
  });

  test("key changes only when a badge changes", () => {
    const rows = [row("a"), row("b")];
    const src = (u: boolean) => ({ isChannelUnread: (id: string) => u && id === "a", getMentionCount: () => 0 });
    expect(rowBadgeKey(src(false), rows)).toBe(rowBadgeKey(src(false), rows));
    expect(rowBadgeKey(src(true), rows)).not.toBe(rowBadgeKey(src(false), rows));
  });
});

describe("DM list row reuse", () => {
  test("a refetch with identical rows keeps the previous array", () => {
    const prev = [row("a"), row("b", { type: "group", avatars: ["x", "y"] })];
    const next = [row("a"), row("b", { type: "group", avatars: ["x", "y"] })];
    expect(reuseRows(prev, next)).toBe(prev);
  });

  test("changed rows are replaced, unchanged rows keep their object, order follows the new list", () => {
    const a = row("a");
    const b = row("b");
    const c = row("c");
    const out = reuseRows([a, b, c], [row("c", { lastMessage: "new" }), row("a"), row("b")]);
    expect(out[0]).not.toBe(c);
    expect(out[0].lastMessage).toBe("new");
    expect(out[1]).toBe(a);
    expect(out[2]).toBe(b);
  });

  test("first load and removed rows", () => {
    const next = [row("a")];
    expect(reuseRows([], next)).toBe(next);
    const a = row("a");
    const out = reuseRows([a, row("b")], [row("a")]);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(a);
  });

  test("sameRow compares what a row shows", () => {
    expect(sameRow(row("a"), row("a"))).toBe(true);
    expect(sameRow(row("a"), row("a", { timestamp: "6m" }))).toBe(false);
    expect(sameRow(row("a"), row("a", { status: "idle" }))).toBe(false);
    expect(sameRow(row("a", { avatars: ["x"] }), row("a", { avatars: ["y"] }))).toBe(false);
  });
});
