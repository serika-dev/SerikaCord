import { describe, expect, test } from "bun:test";
import { applyAllowedMentions, normalizeAllowedMentions } from "@/lib/chat/allowedMentions";
import { EMBED_TOTAL_LIMIT, validateEmbeds } from "@/lib/chat/embedValidation";
import {
  aroundSplit,
  pageReactionUsers,
  parseMessagePageQuery,
  parsePageCursor,
  snowflakeTimestamp,
  sortNewestFirst,
} from "@/lib/chat/messagePagination";
import { clientEmojiString, discordEmoji, parseReactionEmojiParam } from "@/lib/chat/reactionEmoji";
import { interpretNonceSlot, nonceKey, normalizeNonce, NONCE_PENDING } from "@/lib/chat/messageNonce";
import { discordMessageType, serializeMessage } from "@/lib/chat/discordMessage";
import { addFormError, invalidFormBody } from "@/lib/chat/discordFormErrors";
import { botRequestBuckets } from "@/lib/security/botRateLimit";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const R1 = "44444444-4444-4444-8444-444444444444";
const R2 = "55555555-5555-4555-8555-555555555555";
const BOT = "66666666-6666-4666-8666-666666666666";

function allowed(raw: unknown) {
  const r = normalizeAllowedMentions(raw);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.value;
}

describe("allowed_mentions", () => {
  const content = { userIds: [A, B], roleIds: [R1, R2], everyone: true };

  test("absent: everything in the content pings, and the reply pings its author", () => {
    const m = applyAllowedMentions(content, allowed(undefined), { authorId: BOT, repliedAuthorId: C });
    expect(m.userIds).toEqual([A, B, C]);
    expect(m.roleIds).toEqual([R1, R2]);
    expect(m.everyone).toBe(true);
    expect(m.repliedUserPinged).toBe(true);
  });

  test("empty object: nothing pings, replied_user defaults to false", () => {
    const m = applyAllowedMentions(content, allowed({}), { authorId: BOT, repliedAuthorId: C });
    expect(m).toEqual({ userIds: [], roleIds: [], everyone: false, repliedUserPinged: false });
  });

  test("parse types are independent", () => {
    expect(applyAllowedMentions(content, allowed({ parse: ["users"] }), { authorId: BOT })).toMatchObject({ userIds: [A, B], roleIds: [], everyone: false });
    expect(applyAllowedMentions(content, allowed({ parse: ["roles"] }), { authorId: BOT })).toMatchObject({ userIds: [], roleIds: [R1, R2], everyone: false });
    expect(applyAllowedMentions(content, allowed({ parse: ["everyone"] }), { authorId: BOT })).toMatchObject({ userIds: [], roleIds: [], everyone: true });
  });

  test("whitelists only allow ids that are also in the content", () => {
    const m = applyAllowedMentions(content, allowed({ users: [B.toUpperCase(), C], roles: [R1] }), { authorId: BOT });
    expect(m.userIds).toEqual([B]);
    expect(m.roleIds).toEqual([R1]);
    expect(m.everyone).toBe(false);
  });

  test("replied_user true pings the replied author once; never the sender", () => {
    expect(applyAllowedMentions(content, allowed({ replied_user: true }), { authorId: BOT, repliedAuthorId: C }).userIds).toEqual([C]);
    expect(applyAllowedMentions(content, allowed({ parse: ["users"], replied_user: true }), { authorId: BOT, repliedAuthorId: A }).userIds).toEqual([A, B]);
    expect(applyAllowedMentions(content, allowed(undefined), { authorId: BOT, repliedAuthorId: BOT }).userIds).toEqual([A, B]);
  });

  test("everyone in parse only matters when the content (after permissions) has it", () => {
    const m = applyAllowedMentions({ userIds: [], roleIds: [], everyone: false }, allowed({ parse: ["everyone"] }), { authorId: BOT });
    expect(m.everyone).toBe(false);
  });

  test("validation errors", () => {
    const ex = normalizeAllowedMentions({ parse: ["users"], users: [A] });
    expect(ex.ok).toBe(false);
    if (!ex.ok) expect(ex.errors.allowed_mentions).toBeDefined();
    const bad = normalizeAllowedMentions({ parse: ["users", "nope"] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(JSON.stringify(bad.errors)).toContain("ENUM_TYPE_COERCE");
    const many = normalizeAllowedMentions({ users: Array.from({ length: 101 }, (_, i) => String(i)) });
    expect(many.ok).toBe(false);
    expect(normalizeAllowedMentions({ parse: ["users"], users: [] }).ok).toBe(true);
    expect(normalizeAllowedMentions("x").ok).toBe(false);
  });
});

describe("embed validation", () => {
  test("normalizes a rich embed and drops unknown keys", () => {
    const r = validateEmbeds([{ title: "Hi", description: "d", color: 0xff0000, foo: 1, video: { url: "https://x/v.mp4" }, fields: [{ name: "a", value: "b", inline: true }] }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.embeds[0]).toEqual({ type: "rich", title: "Hi", description: "d", color: 0xff0000, fields: [{ name: "a", value: "b", inline: true }] });
  });

  test("length limits and error paths", () => {
    const r = validateEmbeds([{ title: "x".repeat(257) }, { fields: [{ name: "", value: "v" }] }]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect((r.errors as never as { embeds: Record<string, { title?: { _errors: Array<{ code: string }> } }> }).embeds["0"].title?._errors[0].code).toBe("BASE_TYPE_MAX_LENGTH");
      expect(JSON.stringify(r.errors)).toContain("BASE_TYPE_REQUIRED");
    }
    expect(validateEmbeds(Array.from({ length: 11 }, () => ({ title: "a" }))).ok).toBe(false);
    expect(validateEmbeds([{ fields: Array.from({ length: 26 }, () => ({ name: "a", value: "b" })) }]).ok).toBe(false);
  });

  test("6000 total characters across all embeds", () => {
    const big = { description: "x".repeat(4000) };
    const r = validateEmbeds([big, big]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(JSON.stringify(r.errors)).toContain(String(EMBED_TOTAL_LIMIT));
    expect(validateEmbeds([{ description: "x".repeat(3000) }, { description: "x".repeat(3000) }]).ok).toBe(true);
  });

  test("URLs: http(s) only, attachment:// resolved against the message's files", () => {
    const js = validateEmbeds([{ url: "javascript:alert(1)" }]);
    expect(js.ok).toBe(false);
    if (!js.ok) expect(JSON.stringify(js.errors)).toContain("URL_TYPE_INVALID_SCHEME");
    const files = new Map([["cat.png", "https://cdn.example/cat.png"]]);
    const r = validateEmbeds([{ image: { url: "attachment://cat.png" }, thumbnail: { url: "attachment://missing.png" }, footer: { text: "f", icon_url: "https://a.b/c.png" } }], { attachments: files });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.embeds[0].image).toEqual({ url: "https://cdn.example/cat.png" });
      expect(r.embeds[0].thumbnail).toBeUndefined();
      expect(r.embeds[0].footer).toEqual({ text: "f", icon_url: "https://a.b/c.png" });
    }
    // attachment:// is not allowed for the embed's own link
    expect(validateEmbeds([{ url: "attachment://cat.png" }], { attachments: files }).ok).toBe(false);
  });

  test("color and timestamp", () => {
    expect(validateEmbeds([{ color: 0x1000000 }]).ok).toBe(false);
    expect(validateEmbeds([{ color: -1 }]).ok).toBe(false);
    expect(validateEmbeds([{ timestamp: "not a date" }]).ok).toBe(false);
    const r = validateEmbeds([{ timestamp: "2024-01-02T03:04:05Z" }]);
    expect(r.ok && r.embeds[0].timestamp).toBe("2024-01-02T03:04:05.000Z");
  });
});

describe("message pagination", () => {
  test("defaults and limit bounds", () => {
    const r = parseMessagePageQuery({});
    expect(r.ok && r.query).toEqual({ mode: "latest", cursor: null, limit: 50 });
    expect(parseMessagePageQuery({ limit: "100" }).ok).toBe(true);
    expect(parseMessagePageQuery({ limit: "0" }).ok).toBe(false);
    expect(parseMessagePageQuery({ limit: "101" }).ok).toBe(false);
    expect(parseMessagePageQuery({ limit: "abc" }).ok).toBe(false);
  });

  test("around > before > after; ids or snowflakes", () => {
    const r = parseMessagePageQuery({ before: A, after: B, around: C });
    expect(r.ok && r.query.mode).toBe("around");
    const b = parseMessagePageQuery({ before: A, after: B });
    expect(b.ok && b.query).toEqual({ mode: "before", cursor: { kind: "message", id: A }, limit: 50 });
    const s = parseMessagePageQuery({ after: "175928847299117063" });
    expect(s.ok && s.query.cursor).toEqual({ kind: "time", at: new Date(1462015105796) });
    expect(parseMessagePageQuery({ before: "not-an-id" }).ok).toBe(false);
  });

  test("snowflake timestamps", () => {
    expect(snowflakeTimestamp("175928847299117063")).toBe(1462015105796);
    expect(snowflakeTimestamp("0")).toBe(1420070400000);
    expect(snowflakeTimestamp("x1")).toBeNull();
    expect(parsePageCursor(A.toUpperCase())).toEqual({ kind: "message", id: A });
  });

  test("around takes the cursor plus both sides", () => {
    expect(aroundSplit(1)).toEqual({ newer: 0, olderInclusive: 1 });
    expect(aroundSplit(50)).toEqual({ newer: 25, olderInclusive: 25 });
    expect(aroundSplit(5)).toEqual({ newer: 2, olderInclusive: 3 });
  });

  test("newest first with id tiebreak and dedupe", () => {
    const t = new Date("2024-01-01T00:00:00Z");
    const rows = sortNewestFirst([
      { id: A, createdAt: t },
      { id: C, createdAt: new Date(t.getTime() + 1) },
      { id: B, createdAt: t },
      { id: A, createdAt: t },
    ]);
    expect(rows.map((r) => r.id)).toEqual([C, B, A]);
  });

  test("reaction user pages are ordered by id and continue after the cursor", () => {
    const ids = [C, A, B, A];
    expect(pageReactionUsers(ids, { limit: 2 })).toEqual([A, B]);
    expect(pageReactionUsers(ids, { limit: 2, after: B })).toEqual([C]);
    expect(pageReactionUsers(ids, { limit: 2, after: C })).toEqual([]);
    expect(pageReactionUsers(ids, { limit: 10, type: 1 })).toEqual([]);
  });
});

describe("reaction emoji parsing", () => {
  test("unicode", () => {
    expect(parseReactionEmojiParam("👍")).toEqual({ kind: "unicode", name: "👍" });
    expect(parseReactionEmojiParam(encodeURIComponent("🇯🇵"))).toEqual({ kind: "unicode", name: "🇯🇵" });
    expect(parseReactionEmojiParam("1️⃣")).toEqual({ kind: "unicode", name: "1️⃣" });
    expect(parseReactionEmojiParam("hello")).toBeNull();
    expect(parseReactionEmojiParam("")).toBeNull();
  });

  test("custom name:id, a:name:id and <:name:id>", () => {
    expect(parseReactionEmojiParam(`blob:${A}`)).toEqual({ kind: "custom", name: "blob", id: A, animated: false });
    expect(parseReactionEmojiParam(encodeURIComponent(`a:party:${A.toUpperCase()}`))).toEqual({ kind: "custom", name: "party", id: A, animated: true });
    expect(parseReactionEmojiParam(`<:blob:${A}>`)).toEqual({ kind: "custom", name: "blob", id: A, animated: false });
    expect(parseReactionEmojiParam(`<a:blob:${A}>`)).toMatchObject({ animated: true });
    expect(parseReactionEmojiParam("blob:175928847299117063")).toEqual({ kind: "snowflake", name: "blob", snowflakeId: "175928847299117063", animated: false });
    expect(parseReactionEmojiParam("b:blob:1")).toBeNull();
    expect(parseReactionEmojiParam("bad name:1")).toBeNull();
  });

  test("client and Discord forms", () => {
    expect(clientEmojiString({ name: "blob", id: A })).toBe(`<:blob:${A}>`);
    expect(clientEmojiString({ name: "blob", id: A, animated: true })).toBe(`<a:blob:${A}>`);
    expect(clientEmojiString({ name: "👍" })).toBe("👍");
    expect(discordEmoji({ name: "👍" })).toEqual({ id: null, name: "👍" });
    expect(discordEmoji({ name: "blob", id: A })).toEqual({ id: A, name: "blob", animated: false });
  });
});

describe("nonce", () => {
  test("validation", () => {
    expect(normalizeNonce(undefined)).toEqual({ ok: true, nonce: null });
    expect(normalizeNonce("abc")).toEqual({ ok: true, nonce: "abc" });
    expect(normalizeNonce(123)).toEqual({ ok: true, nonce: 123 });
    expect(normalizeNonce("x".repeat(26)).ok).toBe(false);
    expect(normalizeNonce(1.5).ok).toBe(false);
    expect(normalizeNonce({}).ok).toBe(false);
  });

  test("dedupe slot", () => {
    expect(nonceKey(BOT.toUpperCase(), A, 5)).toBe(`botnonce:${BOT}:${A}:5`);
    expect(interpretNonceSlot(null)).toEqual({ action: "create" });
    expect(interpretNonceSlot(NONCE_PENDING)).toEqual({ action: "wait" });
    expect(interpretNonceSlot(B)).toEqual({ action: "existing", messageId: B });
  });
});

describe("message serializer", () => {
  const users = new Map([
    [A, { id: A, username: "alice", displayName: "Alice" }],
    [BOT, { id: BOT, username: "bot", isBot: true }],
  ]);

  test("reply with reactions computed for the viewer", () => {
    const msg = serializeMessage({
      id: B,
      channelId: C,
      serverId: R1,
      authorId: A,
      content: "hi <@" + BOT + ">",
      type: "reply",
      referencedMessageId: R2,
      createdAt: new Date("2024-01-01T00:00:00Z"),
      mentionedUserIds: [BOT, "77777777-7777-4777-8777-777777777777"],
      mentionedRoleIds: [R1],
      reactions: [
        { emoji: { name: "👍" }, count: 2, userIds: [A, BOT] },
        { emoji: { name: "blob", id: R2 }, count: 1, userIds: [A] },
      ],
      attachments: [{ id: "x", filename: "SPOILER_a.png", url: "https://cdn/a.png", contentType: "image/png", size: 3, width: 1, height: 2 }],
      sticker: { id: R2, name: "st", imageUrl: "https://cdn/s.gif" },
    }, { users, viewerId: BOT, referenced: null, includeGuildId: true });
    expect(msg.type).toBe(19);
    expect(msg.guild_id).toBe(R1);
    expect(msg.author).toMatchObject({ id: A, username: "alice", global_name: "Alice", bot: false });
    expect(msg.mentions.map((u) => u.id)).toEqual([BOT]);
    expect(msg.mention_roles).toEqual([R1]);
    expect(msg.message_reference).toEqual({ type: 0, message_id: R2, channel_id: C, guild_id: R1 });
    expect(msg.referenced_message).toBeNull();
    expect(msg.reactions?.[0]).toEqual({ count: 2, count_details: { burst: 0, normal: 2 }, me: true, me_burst: false, burst_colors: [], emoji: { id: null, name: "👍" } });
    expect(msg.reactions?.[1].me).toBe(false);
    expect(msg.attachments[0]).toMatchObject({ id: "x", filename: "SPOILER_a.png", content_type: "image/png", flags: 8, width: 1, height: 2 });
    expect(msg.sticker_items).toEqual([{ id: R2, name: "st", format_type: 4 }]);
    expect(msg.timestamp).toBe("2024-01-01T00:00:00.000Z");
  });

  test("REST shape omits guild_id; unknown authors are Deleted User; webhooks get webhook_id", () => {
    const m = serializeMessage({ id: A, channelId: C, serverId: R1, authorId: B, content: "x" }, { users });
    expect(m.guild_id).toBeUndefined();
    expect(m.author.username).toBe("Deleted User");
    expect(m.reactions).toBeUndefined();
    const w = serializeMessage({ id: A, channelId: C, authorId: B, content: "x" }, { users, webhooks: new Map([[B, { id: B, name: "Hook" }]]) });
    expect(w.webhook_id).toBe(B);
    expect(w.author).toMatchObject({ id: B, username: "Hook", bot: true });
  });

  test("encrypted DM messages never expose their payload", () => {
    const m = serializeMessage({
      id: A, channelId: C, authorId: A, content: "ciphertext?", e2ee: { v: 1, ct: "..." },
      attachments: [{ id: "1", url: "https://x" }], embeds: [{ title: "x" }],
    }, { users });
    expect(m.content).toBe("");
    expect(m.attachments).toEqual([]);
    expect(m.embeds).toEqual([]);
    const notice = serializeMessage({ id: A, channelId: C, authorId: A, content: "", e2ee: { v: 1, notice: "enabled" } }, { users });
    expect(notice.content).toBe("");
  });

  test("forwards, polls, suppressed embeds, types", () => {
    const f = serializeMessage({ id: A, channelId: C, authorId: A }, { users, forward: { messageId: B, channelId: R1, serverId: R2, content: "orig", createdAt: "2024-01-01T00:00:00.000Z" } });
    expect(f.message_reference).toEqual({ type: 1, message_id: B, channel_id: R1, guild_id: R2 });
    expect(f.message_snapshots?.[0].message.content).toBe("orig");
    const s = serializeMessage({ id: A, channelId: C, authorId: A, embeds: [{ title: "x" }], flags: 4 }, { users });
    expect(s.embeds).toEqual([]);
    expect(discordMessageType({ type: "default", interaction: { name: "ping" } })).toBe(20);
    expect(discordMessageType({ type: "poll_result" })).toBe(46);
    expect(discordMessageType({ type: "member_leave" })).toBe(0);
  });
});

describe("bot message rate-limit buckets", () => {
  test("bulk delete and typing get their own per-channel buckets", () => {
    const bulk = botRequestBuckets(BOT, "POST", "/api/v10/channels/:channelId/messages/bulk-delete", { channelId: A });
    expect(bulk.map((b) => b.limiter)).toEqual(["botBulkDelete", "botGlobal"]);
    const typing = botRequestBuckets(BOT, "POST", "/api/v10/channels/:channelId/typing", { channelId: A });
    expect(typing[0].limiter).toBe("botTyping");
    const react = botRequestBuckets(BOT, "DELETE", "/api/v10/channels/:channelId/messages/:messageId/reactions/:emoji", { channelId: A });
    expect(react[0].limiter).toBe("botReaction");
    expect(react[0].key).not.toBe(botRequestBuckets(BOT, "DELETE", "/api/v10/channels/:channelId/messages/:messageId/reactions/:emoji", { channelId: B })[0].key);
  });
});

describe("form errors", () => {
  test("nested errors tree", () => {
    const t = addFormError({}, ["embeds", 0, "title"], "BASE_TYPE_MAX_LENGTH", "too long");
    addFormError(t, ["embeds", 0, "title"], "X", "y");
    expect(invalidFormBody(t)).toEqual({
      code: 50035,
      message: "Invalid Form Body",
      errors: { embeds: { "0": { title: { _errors: [{ code: "BASE_TYPE_MAX_LENGTH", message: "too long" }, { code: "X", message: "y" }] } } } },
    });
  });
});
