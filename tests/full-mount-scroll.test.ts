import { describe, expect, test } from "bun:test";
import { fullMountRestoreMode } from "../src/lib/chat/messageWindow";

const base = { atBottom: false, stuckToBottom: false, forcePending: false, hasAnchor: true };

describe("fullMountRestoreMode", () => {
  test("a reader at the newest messages stays there", () => {
    expect(fullMountRestoreMode({ ...base, atBottom: true })).toBe("bottom");
  });
  test("glued to the bottom or a pending force-scroll (switch, own send) wins", () => {
    expect(fullMountRestoreMode({ ...base, stuckToBottom: true })).toBe("bottom");
    expect(fullMountRestoreMode({ ...base, forcePending: true })).toBe("bottom");
  });
  test("a reader on older rows (the unread line) keeps that row in place", () => {
    expect(fullMountRestoreMode(base)).toBe("anchor");
  });
  test("without a visible row, by the height that was added", () => {
    expect(fullMountRestoreMode({ ...base, hasAnchor: false })).toBe("height");
  });
});
