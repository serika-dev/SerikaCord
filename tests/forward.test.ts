import { describe, expect, test } from "bun:test";
import {
  MAX_FORWARD_TARGETS,
  forwardJumpHref,
  isForwardable,
  normalizeForwardNote,
  normalizeForwardTargets,
  parseStoredForward,
  rankForwardTargets,
  type ForwardTarget,
} from "@/lib/chat/forward";
import { extractMediaFromMessage } from "@/lib/chat/media";
import { isComposerlessMessage } from "@/lib/chat/messages";

const ID = (n: number) => `0000000${n}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;

describe("what can be forwarded", () => {
  const msg = { id: ID(1), content: "hello", attachments: [], embeds: [] };
  test("normal messages with text, files, embeds or a sticker", () => {
    expect(isForwardable(msg)).toBe(true);
    expect(isForwardable({ ...msg, content: "", attachments: [{ id: "a", url: "u", filename: "f", contentType: "image/png" }] })).toBe(true);
    expect(isForwardable({ ...msg, content: "", sticker: { id: "s", name: "s", imageUrl: "u" } })).toBe(true);
    expect(isForwardable({ ...msg, content: "  " })).toBe(false);
  });

  test("never pending, ephemeral, system rows or polls", () => {
    expect(isForwardable({ ...msg, id: "temp-1" })).toBe(false);
    expect(isForwardable({ ...msg, pending: true })).toBe(false);
    expect(isForwardable({ ...msg, ephemeral: true })).toBe(false);
    expect(isForwardable({ ...msg, type: "call" })).toBe(false);
    expect(isForwardable({ ...msg, type: "poll_result" })).toBe(false);
    expect(isForwardable({ ...msg, type: "recipient_add" })).toBe(false);
    expect(isForwardable({ ...msg, poll: {} as never })).toBe(false);
  });

  test("a forward can be forwarded again (even with no text of its own)", () => {
    expect(isForwardable({ ...msg, content: "", forward: {} as never })).toBe(true);
  });
});

describe("request validation", () => {
  test("targets: 1..5 unique ids", () => {
    expect(normalizeForwardTargets([ID(1), ID(1).toUpperCase(), ID(2)])).toEqual({ targets: [ID(1), ID(2)] });
    expect("error" in normalizeForwardTargets([])).toBe(true);
    expect("error" in normalizeForwardTargets(["nope!"])).toBe(true);
    const six = Array.from({ length: MAX_FORWARD_TARGETS + 1 }, (_, i) => ID(i + 1));
    expect("error" in normalizeForwardTargets(six)).toBe(true);
  });

  test("note: trimmed, empty is none", () => {
    expect(normalizeForwardNote("  hi  ")).toBe("hi");
    expect(normalizeForwardNote("   ")).toBeNull();
    expect(normalizeForwardNote(5)).toBeNull();
  });
});

describe("jump links", () => {
  test("server channel, DM and group DM", () => {
    expect(forwardJumpHref({ kind: "channel", serverId: "s", channelId: "c" }, "m")).toBe("/channels/s/c?jump=m");
    expect(forwardJumpHref({ kind: "dm", recipientId: "u" }, "m")).toBe("/dm/u?jump=m");
    expect(forwardJumpHref({ kind: "group_dm", channelId: "g" }, "m")).toBe("/dm/group/g?jump=m");
  });
});

describe("stored snapshot", () => {
  test("parses and fills defaults", () => {
    const s = parseStoredForward({
      messageId: "m",
      channelId: "c",
      serverId: null,
      authorId: "u",
      author: { id: "u", username: "alice" },
      content: "enc",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(s).toEqual({
      messageId: "m",
      channelId: "c",
      serverId: null,
      authorId: "u",
      author: { id: "u", username: "alice", displayName: "alice", avatar: null },
      content: "enc",
      attachments: [],
      embeds: [],
      sticker: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      edited: false,
    });
    expect(parseStoredForward({ channelId: "c" })).toBeNull();
  });

  test("a forward's images open in the gallery and its echo never replaces a pending bubble", () => {
    const items = extractMediaFromMessage({
      id: "f",
      content: "",
      attachments: [],
      forward: { content: "", attachments: [{ url: "https://cdn/x.png", contentType: "image/png", filename: "x.png" }] },
    });
    expect(items).toEqual([{ src: "https://cdn/x.png", alt: "x.png", messageId: "f" }]);
    expect(isComposerlessMessage({ type: "default", forward: {} as never })).toBe(true);
  });
});

describe("picker search", () => {
  const targets: ForwardTarget[] = [
    { id: "1", kind: "dm", name: "Alice", username: "alice" },
    { id: "2", kind: "channel", name: "general", serverName: "Cats" },
    { id: "3", kind: "channel", name: "alerts", serverName: "Dogs" },
    { id: "4", kind: "group_dm", name: "The gang" },
  ];
  test("empty query keeps recency order", () => {
    expect(rankForwardTargets(targets, "  ").map((t) => t.id)).toEqual(["1", "2", "3", "4"]);
  });
  test("prefix beats substring beats server name; # and @ are ignored", () => {
    expect(rankForwardTargets(targets, "al").map((t) => t.id)).toEqual(["1", "3", "2"]);
    expect(rankForwardTargets(targets, "#gen").map((t) => t.id)).toEqual(["2"]);
    expect(rankForwardTargets(targets, "cats").map((t) => t.id)).toEqual(["2"]);
    expect(rankForwardTargets(targets, "ang").map((t) => t.id)).toEqual(["4"]);
  });
});
