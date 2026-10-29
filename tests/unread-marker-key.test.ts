import { describe, expect, test } from "bun:test";
import { parseReadMarkerKey, readMarkerKey } from "../src/lib/chat/unreadMarker";

describe("read marker keys", () => {
  test("round-trip a marker", () => {
    const marker = { lastReadAt: "2026-10-29T10:00:00.000Z", lastReadMessageId: "m1" };
    expect(parseReadMarkerKey(readMarkerKey(marker))).toEqual(marker);
  });

  test("never-read marker and no conversation", () => {
    const empty = { lastReadAt: null, lastReadMessageId: null };
    expect(parseReadMarkerKey(readMarkerKey(empty))).toEqual(empty);
    expect(parseReadMarkerKey(null)).toBeNull();
    expect(parseReadMarkerKey("not json")).toBeNull();
  });

  test("equal markers give equal keys (selector stays put)", () => {
    const a = readMarkerKey({ lastReadAt: "2026-01-01T00:00:00.000Z", lastReadMessageId: "x" });
    const b = readMarkerKey({ lastReadAt: "2026-01-01T00:00:00.000Z", lastReadMessageId: "x" });
    expect(a).toBe(b);
  });
});
