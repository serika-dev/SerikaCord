import { describe, expect, test } from "bun:test";
import { DUPLICATE_SPAM_WINDOW_MS, isDuplicateSpam } from "@/lib/chat/duplicateSpam";

const now = Date.parse("2026-10-27T14:00:00Z");
const at = (msAgo: number) => new Date(now - msAgo);

describe("duplicate-spam guard", () => {
  test("four identical messages within a minute block the fifth", () => {
    const recent = [1, 5, 10, 20].map((s) => ({ fingerprint: "smash", createdAt: at(s * 1000) }));
    expect(isDuplicateSpam("smash", recent, 4, now)).toBe(true);
  });
  test("old messages never count (months-old 'smash' doesn't block today's)", () => {
    const recent = [1, 2, 3, 4].map((d) => ({ fingerprint: "smash", createdAt: at(d * 30 * 86_400_000) }));
    expect(isDuplicateSpam("smash", recent, 4, now)).toBe(false);
    const mixed = [{ fingerprint: "smash", createdAt: at(1000) }, { fingerprint: "smash", createdAt: at(2000) }, { fingerprint: "smash", createdAt: at(3000) }, { fingerprint: "smash", createdAt: at(DUPLICATE_SPAM_WINDOW_MS + 1) }];
    expect(isDuplicateSpam("smash", mixed, 4, now)).toBe(false);
  });
  test("different text, too few messages, or bad dates don't block", () => {
    expect(isDuplicateSpam("smash", [1, 2, 3, 4].map((s) => ({ fingerprint: s === 2 ? "pass" : "smash", createdAt: at(s * 1000) })), 4, now)).toBe(false);
    expect(isDuplicateSpam("smash", [{ fingerprint: "smash", createdAt: at(1000) }], 4, now)).toBe(false);
    expect(isDuplicateSpam("smash", [1, 2, 3, 4].map(() => ({ fingerprint: "smash", createdAt: null })), 4, now)).toBe(false);
    expect(isDuplicateSpam("", [], 4, now)).toBe(false);
  });
});
