import { describe, expect, test } from "bun:test";
import {
  applyReactionToMessages,
  decodeHtmlEntities,
  formatFileSize,
  formatMessageTimestamp,
  groupMessages,
  normalizeIncomingMessage,
} from "@/lib/chat/messages";
import { reactionEmojiIdentifier, type ChatMessage } from "@/lib/chat/types";

const ALICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EMOJI_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const T0 = Date.parse("2026-01-01T12:00:00.000Z");

function msg(id: string, authorId: string, minutesAfterT0: number, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    content: `message ${id}`,
    authorId,
    author: { id: authorId, username: authorId === ALICE ? "alice" : "bob", displayName: "" },
    channelId: "channel",
    createdAt: new Date(T0 + minutesAfterT0 * 60_000).toISOString(),
    reactions: [],
    ...extra,
  };
}

describe("normalizeIncomingMessage", () => {
  test("maps _id to id and fills every list with an empty default", () => {
    const m = normalizeIncomingMessage({ _id: "m1", authorId: ALICE, author: { id: ALICE, username: "alice", displayName: "Alice" } });
    expect(m.id).toBe("m1");
    expect(m.content).toBe("");
    expect(m.attachments).toEqual([]);
    expect(m.embeds).toEqual([]);
    expect(m.reactions).toEqual([]);
    expect(m.customEmojis).toEqual([]);
    expect(m.mentionedUserIds).toEqual([]);
    expect(m.mentionEveryone).toBeFalse();
  });

  test("accepts a populated author object in authorId", () => {
    const m = normalizeIncomingMessage({ id: "m2", authorId: { _id: BOB, username: "bob", avatar: "a.png" } });
    expect(m.authorId).toBe(BOB);
    expect(m.author).toEqual({ id: BOB, username: "bob", displayName: "bob", avatar: "a.png" });
  });

  test("falls back to an Unknown author instead of crashing", () => {
    const m = normalizeIncomingMessage({ id: "m3" });
    expect(m.author.displayName).toBe("Unknown");
    expect(m.author.id).toBe("unknown");
  });
});

describe("groupMessages", () => {
  test("groups one author's consecutive messages within 5 minutes", () => {
    const groups = groupMessages([msg("1", ALICE, 0), msg("2", ALICE, 2), msg("3", ALICE, 4.9)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].messages.map((m) => m.id)).toEqual(["1", "2", "3"]);
    expect(groups[0].timestamp).toBe(msg("1", ALICE, 0).createdAt);
  });

  test("starts a new group for another author or after the window", () => {
    const groups = groupMessages([
      msg("1", ALICE, 0),
      msg("2", BOB, 1),
      msg("3", BOB, 7), // 6 minutes after the previous one
      msg("4", ALICE, 8),
    ]);
    expect(groups.map((g) => g.messages.map((m) => m.id))).toEqual([["1"], ["2"], ["3"], ["4"]]);
  });

  test("drops duplicate ids (an SSE echo of an optimistic send)", () => {
    const groups = groupMessages([msg("1", ALICE, 0), msg("1", ALICE, 0), msg("2", ALICE, 1)]);
    expect(groups[0].messages.map((m) => m.id)).toEqual(["1", "2"]);
  });

  test("keeps the original message objects (MessageGroup memo relies on it)", () => {
    const a = msg("1", ALICE, 0);
    const b = msg("2", ALICE, 1);
    const [group] = groupMessages([a, b]);
    expect(group.messages[0]).toBe(a);
    expect(group.messages[1]).toBe(b);
  });

  test("empty input gives no groups", () => {
    expect(groupMessages([])).toEqual([]);
  });
});

describe("applyReactionToMessages", () => {
  test("adds a new unicode reaction", () => {
    const [m] = applyReactionToMessages([msg("1", ALICE, 0)], "1", "👍", BOB, true);
    expect(m.reactions).toEqual([{ emoji: { name: "👍" }, count: 1, userIds: [BOB] }]);
  });

  test("is idempotent: the same add or remove twice changes nothing", () => {
    const once = applyReactionToMessages([msg("1", ALICE, 0)], "1", "👍", BOB, true);
    const twice = applyReactionToMessages(once, "1", "👍", BOB, true);
    expect(twice[0]).toBe(once[0]);
    expect(twice[0].reactions?.[0].count).toBe(1);

    const removed = applyReactionToMessages(twice, "1", "👍", BOB, false);
    const removedAgain = applyReactionToMessages(removed, "1", "👍", BOB, false);
    expect(removedAgain[0]).toBe(removed[0]);
    expect(removedAgain[0].reactions).toEqual([]);
  });

  test("counts several users and drops the reaction at zero", () => {
    let list = [msg("1", ALICE, 0)];
    list = applyReactionToMessages(list, "1", "🔥", ALICE, true);
    list = applyReactionToMessages(list, "1", "🔥", BOB, true);
    expect(list[0].reactions?.[0]).toEqual({ emoji: { name: "🔥" }, count: 2, userIds: [ALICE, BOB] });
    list = applyReactionToMessages(list, "1", "🔥", ALICE, false);
    expect(list[0].reactions?.[0].userIds).toEqual([BOB]);
    list = applyReactionToMessages(list, "1", "🔥", BOB, false);
    expect(list[0].reactions).toEqual([]);
  });

  test("removing a reaction that does not exist is a no-op", () => {
    const original = msg("1", ALICE, 0);
    const [m] = applyReactionToMessages([original], "1", "👍", BOB, false);
    expect(m).toBe(original);
  });

  test("custom emoji tokens resolve against the lookup and match by id", () => {
    const token = `<a:party:${EMOJI_ID}>`;
    let list = applyReactionToMessages([msg("1", ALICE, 0)], "1", token, BOB, true, [
      { id: EMOJI_ID, name: "party", url: "https://cdn.example/party.gif", animated: true },
    ]);
    expect(list[0].reactions?.[0].emoji).toEqual({ name: "party", id: EMOJI_ID, animated: true, url: "https://cdn.example/party.gif" });
    // A later event may carry the bare id instead of the token.
    list = applyReactionToMessages(list, "1", EMOJI_ID, ALICE, true);
    expect(list[0].reactions).toHaveLength(1);
    expect(list[0].reactions?.[0].count).toBe(2);
    expect(reactionEmojiIdentifier(list[0].reactions![0].emoji)).toBe(token);
  });

  test("leaves other messages untouched", () => {
    const other = msg("2", BOB, 1);
    const out = applyReactionToMessages([msg("1", ALICE, 0), other], "1", "👍", BOB, true);
    expect(out[1]).toBe(other);
  });
});

describe("decodeHtmlEntities", () => {
  test("restores what sanitizeInput encoded", () => {
    expect(decodeHtmlEntities("a &lt;b&gt; &amp; &quot;c&quot; &#39;d&#x27; &#x2F;e &nbsp;")).toBe(`a <b> & "c" 'd' /e  `);
  });

  test("does not double-decode", () => {
    expect(decodeHtmlEntities("&amp;lt;")).toBe("&lt;");
  });

  test("returns plain text unchanged", () => {
    expect(decodeHtmlEntities("no entities here")).toBe("no entities here");
    expect(decodeHtmlEntities("")).toBe("");
  });
});

describe("reactionEmojiIdentifier", () => {
  test("builds what the reactions API expects", () => {
    expect(reactionEmojiIdentifier({ name: "👍" })).toBe("👍");
    expect(reactionEmojiIdentifier({ name: "wave", id: EMOJI_ID })).toBe(`<:wave:${EMOJI_ID}>`);
    expect(reactionEmojiIdentifier({ name: "wave", id: EMOJI_ID, animated: true })).toBe(`<a:wave:${EMOJI_ID}>`);
  });
});

describe("formatFileSize", () => {
  test("uses B, KB and MB", () => {
    expect(formatFileSize(undefined)).toBe("");
    expect(formatFileSize(0)).toBe("");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("formatMessageTimestamp", () => {
  // Stand-in for gt(): interpolates {name} placeholders like gt-next does.
  const gt = (template: string, params?: Record<string, unknown>) =>
    template.replace(/\{(\w+)\}/g, (_, key: string) => String(params?.[key]));

  test("says Today / Yesterday / the date", () => {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    expect(formatMessageTimestamp(now.toISOString(), gt, "en-US")).toMatch(/^Today at /);
    expect(formatMessageTimestamp(yesterday.toISOString(), gt, "en-US")).toMatch(/^Yesterday at /);
    expect(formatMessageTimestamp("2020-03-04T10:00:00.000Z", gt, "en-US")).toMatch(/^Mar 4, 2020 at /);
  });

  test("routes every phrase through gt so it can be translated", () => {
    const seen: string[] = [];
    const spy = (template: string, params?: Record<string, unknown>) => {
      seen.push(template);
      return gt(template, params);
    };
    formatMessageTimestamp(new Date().toISOString(), spy, "en-US");
    formatMessageTimestamp("2020-03-04T10:00:00.000Z", spy, "en-US");
    expect(seen).toEqual(["Today at {time}", "{date} at {time}"]);
  });

  test("falls back to English without gt", () => {
    expect(formatMessageTimestamp(new Date().toISOString())).toMatch(/^Today at /);
  });
});
