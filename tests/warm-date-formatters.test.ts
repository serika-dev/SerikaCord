import { describe, expect, test } from "bun:test";
import { formatDayDivider, formatMessageTimestamp, warmDateFormatters } from "../src/lib/chat/messages";

describe("warmDateFormatters", () => {
  test("never throws (invalid or missing locales) and leaves formatting unchanged", () => {
    const ts = "2024-03-05T14:07:00.000Z";
    const before = [formatDayDivider(ts, "en"), formatMessageTimestamp(ts, undefined, "en")];
    expect(() => warmDateFormatters([undefined, "", "en", "not a locale!!", "en"])).not.toThrow();
    expect([formatDayDivider(ts, "en"), formatMessageTimestamp(ts, undefined, "en")]).toEqual(before);
  });
});
