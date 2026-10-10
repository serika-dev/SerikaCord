import { describe, expect, test } from "bun:test";
import { isSilentMessage, MESSAGE_FLAGS, parseSilentPrefix, sendFlags, withReplyMention } from "@/lib/chat/messageFlags";
import { isMessageReportReason } from "@/lib/chat/messageReport";

describe("@silent", () => {
  test("strips the prefix and marks the message silent", () => {
    expect(parseSilentPrefix("@silent hello")).toEqual({ content: "hello", silent: true });
    expect(parseSilentPrefix("@silent\nline two")).toEqual({ content: "line two", silent: true });
    expect(parseSilentPrefix("@silent")).toEqual({ content: "", silent: true });
  });

  test("only at the very start, and only the exact word", () => {
    expect(parseSilentPrefix("hi @silent there").silent).toBeFalse();
    expect(parseSilentPrefix(" @silent x").silent).toBeFalse();
    expect(parseSilentPrefix("@silently x").silent).toBeFalse();
    expect(parseSilentPrefix(undefined)).toEqual({ content: "", silent: false });
  });

  test("flags: prefix or request bit; unknown bits are dropped", () => {
    expect(isSilentMessage(sendFlags(undefined, true))).toBeTrue();
    expect(isSilentMessage(sendFlags(MESSAGE_FLAGS.SUPPRESS_NOTIFICATIONS, false))).toBeTrue();
    expect(sendFlags(1 << 6, false)).toBe(0);
    expect(sendFlags(-1, false)).toBe(0);
    expect(sendFlags("4096", false)).toBe(0);
    expect(isSilentMessage(undefined)).toBeFalse();
  });
});

describe("reply pings", () => {
  const me = "aaaaaaaa-0000-4000-8000-000000000001";
  const them = "bbbbbbbb-0000-4000-8000-000000000002";

  test("a reply pings the replied-to author by default", () => {
    expect(withReplyMention([], { repliedAuthorId: them, senderId: me })).toEqual([them]);
    expect(withReplyMention([], { repliedAuthorId: them, senderId: me, mentionRepliedUser: true })).toEqual([them]);
  });

  test("@OFF, replying to yourself, or an existing mention adds nothing", () => {
    expect(withReplyMention([], { repliedAuthorId: them, senderId: me, mentionRepliedUser: false })).toEqual([]);
    expect(withReplyMention([], { repliedAuthorId: me, senderId: me })).toEqual([]);
    expect(withReplyMention([them], { repliedAuthorId: them.toUpperCase(), senderId: me })).toEqual([them]);
    expect(withReplyMention([], { repliedAuthorId: null, senderId: me })).toEqual([]);
  });
});

test("report reasons are validated", () => {
  expect(isMessageReportReason("spam")).toBeTrue();
  expect(isMessageReportReason("drop table")).toBeFalse();
  expect(isMessageReportReason(undefined)).toBeFalse();
});
