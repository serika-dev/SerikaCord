import { describe, expect, test } from "bun:test";
import {
  exceedsLongPressSlop,
  filterMobileChannelGroups,
  groupMobileChannels,
} from "../src/lib/mobile/channelGroups";

const ch = (id: string, type: string, position: number, parentId?: string | null, name = id) => ({
  id,
  name,
  type,
  position,
  parentId: parentId ?? null,
});

describe("groupMobileChannels", () => {
  test("groups by category in position order, loose channels first", () => {
    const groups = groupMobileChannels([
      ch("catB", "category", 2),
      ch("catA", "category", 1),
      ch("t2", "text", 2, "catA"),
      ch("t1", "text", 1, "catA"),
      ch("v1", "voice", 0, "catB"),
      ch("loose", "text", 5),
    ]);
    expect(groups.map((g) => g.id)).toEqual([null, "catA", "catB"]);
    expect(groups[0].name).toBeNull();
    expect(groups[1].channels.map((c) => c.id)).toEqual(["t1", "t2"]);
    expect(groups[2].channels.map((c) => c.id)).toEqual(["v1"]);
  });

  test("orphaned channels fall back to uncategorized and threads are hidden", () => {
    const groups = groupMobileChannels([
      ch("orphan", "text", 0, "deletedCat"),
      ch("thread", "public_thread", 0, "orphan"),
      ch("priv", "private_thread", 0, "orphan"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].channels.map((c) => c.id)).toEqual(["orphan"]);
  });

  test("keeps empty categories and omits an empty uncategorized group", () => {
    const groups = groupMobileChannels([ch("cat", "category", 0)]);
    expect(groups).toEqual([{ id: "cat", name: "cat", channels: [] }]);
  });
});

describe("filterMobileChannelGroups", () => {
  const groups = groupMobileChannels([
    ch("cat", "category", 0, null, "Text"),
    ch("a", "text", 0, "cat", "general"),
    ch("b", "text", 1, "cat", "memes"),
    ch("c", "text", 0, null, "Rules"),
  ]);

  test("blank query returns the groups untouched", () => {
    expect(filterMobileChannelGroups(groups, "  ")).toBe(groups);
  });

  test("matches case-insensitively and drops empty groups", () => {
    const out = filterMobileChannelGroups(groups, "GEN");
    expect(out).toHaveLength(1);
    expect(out[0].channels.map((c) => c.id)).toEqual(["a"]);
  });
});

describe("exceedsLongPressSlop", () => {
  test("small jitter keeps the press, a scroll cancels it", () => {
    expect(exceedsLongPressSlop(3, 4)).toBe(false);
    expect(exceedsLongPressSlop(0, 12)).toBe(true);
    expect(exceedsLongPressSlop(8, 8)).toBe(true);
  });
});
