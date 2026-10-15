import { describe, expect, test } from "bun:test";
import {
  MAX_BOT_FILES,
  effectiveFilename,
  imageDimensions,
  isSpoilerFilename,
  parseBotMessageBody,
  planAttachments,
} from "@/lib/chat/botMultipart";
import {
  BOT_LIMITS,
  botApiTokenFromRequest,
  botRequestBuckets,
  rateLimitHeaders,
  rateLimitedResponse,
} from "@/lib/security/botRateLimit";
import { routeDecision, type RoutingSession } from "@/lib/gateway/routing";
import { INTENT } from "@/lib/gateway/intents";

const file = (name: string, type = "image/png", bytes: Uint8Array<ArrayBuffer> = new Uint8Array([1, 2, 3])) =>
  new File([bytes], name, { type });

describe("multipart message bodies", () => {
  test("JSON bodies pass through untouched", () => {
    const r = parseBotMessageBody({ content: "hi", embeds: [] });
    expect(r).toEqual({ ok: true, payload: { content: "hi", embeds: [] }, files: [], multipart: false });
  });

  test("files[n] + payload_json", () => {
    const r = parseBotMessageBody({
      payload_json: JSON.stringify({ content: "pic", attachments: [{ id: 1, description: "b" }] }),
      "files[1]": file("b.png"),
      "files[0]": file("a.png"),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.multipart).toBe(true);
    expect(r.payload.content).toBe("pic");
    expect(r.files.map((f) => [f.index, f.file.name])).toEqual([[0, "a.png"], [1, "b.png"]]);
  });

  test("plain form fields without payload_json", () => {
    const r = parseBotMessageBody({ content: "x", tts: "true", flags: "4096", embeds: '[{"title":"t"}]', "files[0]": file("a.png") });
    expect(r.ok && r.payload).toEqual({ content: "x", tts: true, flags: 4096, embeds: [{ title: "t" }] });
  });

  test("rejects bad payload_json, duplicate and unknown file fields, too many files", () => {
    expect(parseBotMessageBody({ payload_json: "{nope", "files[0]": file("a.png") })).toMatchObject({ ok: false, code: 50109 });
    expect(parseBotMessageBody({ payload_json: "[1]" })).toMatchObject({ ok: false, code: 50035 });
    expect(parseBotMessageBody({ "files[0]": [file("a.png"), file("b.png")] })).toMatchObject({ ok: false });
    expect(parseBotMessageBody({ avatar: file("a.png") })).toMatchObject({ ok: false });
    expect(parseBotMessageBody({ "files[0]": "not a file" })).toMatchObject({ ok: false });
    const many: Record<string, unknown> = {};
    for (let i = 0; i <= MAX_BOT_FILES; i++) many[`files[${i}]`] = file(`${i}.png`);
    expect(parseBotMessageBody(many)).toMatchObject({ ok: false });
  });

  test("attachments[] metadata references files[n]", () => {
    const plan = planAttachments({ payloadAttachments: [{ id: 0, filename: "cat.png", description: "A cat", duration_secs: 2, waveform: "AA" }], fileIndexes: [0], mode: "create" });
    expect(plan.ok && plan.meta.get(0)).toEqual({ filename: "cat.png", description: "A cat", durationSecs: 2, waveform: "AA" });
    expect(planAttachments({ payloadAttachments: [{ id: 3 }], fileIndexes: [0], mode: "create" }).ok).toBe(false);
    expect(planAttachments({ payloadAttachments: [{ id: 0, description: "x".repeat(1025) }], fileIndexes: [0], mode: "create" }).ok).toBe(false);
    expect(planAttachments({ payloadAttachments: "nope", fileIndexes: [], mode: "create" }).ok).toBe(false);
  });

  test("edit keeps listed existing attachments; no list keeps all", () => {
    const keep = planAttachments({ payloadAttachments: [{ id: "abc123" }, { id: 0 }], fileIndexes: [0], existingIds: ["abc123", "def456"], mode: "edit" });
    expect(keep.ok && keep.keepExistingIds).toEqual(["abc123"]);
    const all = planAttachments({ payloadAttachments: undefined, fileIndexes: [], existingIds: ["abc123"], mode: "edit" });
    expect(all.ok && all.keepExistingIds).toBeNull();
    expect(planAttachments({ payloadAttachments: [{ id: "zzz" }], fileIndexes: [], existingIds: ["abc123"], mode: "edit" }).ok).toBe(false);
  });

  test("filename overrides may not change the extension; SPOILER_ prefix", () => {
    expect(effectiveFilename("a.png", "cat.png")).toBe("cat.png");
    expect(effectiveFilename("a.png", "cat.exe")).toBeNull();
    expect(effectiveFilename("a.png")).toBe("a.png");
    expect(isSpoilerFilename("SPOILER_a.png")).toBe(true);
    expect(isSpoilerFilename("a.png")).toBe(false);
  });

  test("image dimensions from headers", () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    png.set([0, 0, 0x01, 0x00], 16); // 256
    png.set([0, 0, 0x00, 0x80], 20); // 128
    expect(imageDimensions(png)).toEqual({ width: 256, height: 128 });
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 10, 0, 20, 0]);
    expect(imageDimensions(gif)).toEqual({ width: 10, height: 20 });
    // JPEG: SOI, APP0 (len 4), SOF0 with height 300, width 400
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0x90, 0x03, 0, 0, 0, 0]);
    expect(imageDimensions(jpeg)).toEqual({ width: 400, height: 300 });
    expect(imageDimensions(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe("per-bot rate limits", () => {
  const BOT = "11111111-1111-4111-8111-111111111111";

  test("message sends are bucketed per channel, plus the global budget", () => {
    const a = botRequestBuckets(BOT, "POST", "/api/v10/channels/:channelId/messages", { channelId: "c1" });
    const b = botRequestBuckets(BOT, "POST", "/api/v10/channels/:channelId/messages", { channelId: "c2" });
    expect(a.map((x) => x.limiter)).toEqual(["botMessageSend", "botGlobal"]);
    expect(a[0].key).not.toBe(b[0].key);
    expect(a[0].bucket).toBe(b[0].bucket);
    expect(a[0].limit).toBe(BOT_LIMITS.botMessageSend.points);
  });

  test("reads only count against the global budget; reactions and deletes have their own", () => {
    expect(botRequestBuckets(BOT, "GET", "/api/v10/channels/:channelId/messages", { channelId: "c" }).map((x) => x.limiter)).toEqual(["botGlobal"]);
    expect(botRequestBuckets(BOT, "PUT", "/api/v10/channels/:channelId/messages/:messageId/reactions/:emoji/@me", { channelId: "c" })[0].limiter).toBe("botReaction");
    expect(botRequestBuckets(BOT, "DELETE", "/api/v10/channels/:channelId/messages/:messageId", { channelId: "c" })[0].limiter).toBe("botMessageDelete");
    expect(botRequestBuckets(BOT, "PATCH", "/api/v10/guilds/:guildId/members/:userId", { guildId: "g" })[0].limiter).toBe("botWrite");
  });

  test("Discord-style headers and 429 body", () => {
    const h = rateLimitHeaders({ limit: 5, remaining: 2, resetAfterSeconds: 1.5, bucket: "abc", now: 1_000_000 });
    expect(h).toEqual({
      "X-RateLimit-Limit": "5",
      "X-RateLimit-Remaining": "2",
      "X-RateLimit-Reset": "1001.500",
      "X-RateLimit-Reset-After": "1.500",
      "X-RateLimit-Bucket": "abc",
    });
    const r = rateLimitedResponse({ retryAfterSeconds: 0.25, global: false });
    expect(r.body).toEqual({ message: "You are being rate limited.", retry_after: 0.25, global: false, code: 0 });
    expect(r.headers["Retry-After"]).toBe("1");
    expect(r.headers.Via).toBeDefined(); // discord.py needs it
    expect(rateLimitedResponse({ retryAfterSeconds: 1, global: true }).headers["X-RateLimit-Global"]).toBe("true");
  });

  test("only /api/v10 (v9) requests with a Bot header are candidates for the per-bot path", () => {
    expect(botApiTokenFromRequest("/api/v10/users/@me", "Bot abc.def")).toBe("abc.def");
    expect(botApiTokenFromRequest("/api/v9/users/@me", "bot abc")).toBe("abc");
    expect(botApiTokenFromRequest("/api/users/@me", "Bot abc")).toBeNull();
    expect(botApiTokenFromRequest("/api/v10x/users", "Bot abc")).toBeNull();
    expect(botApiTokenFromRequest("/api/v10/users/@me", "Bearer abc")).toBeNull();
    expect(botApiTokenFromRequest("/api/v10/users/@me", null)).toBeNull();
  });
});

describe("GUILD_DELETE drops the guild from the session", () => {
  const BOT = "11111111-1111-4111-8111-111111111111";
  const G = "99999999-9999-4999-8999-999999999999";
  const s = (intents: number): RoutingSession => ({ botId: BOT, intents, guildIds: new Set([G]), dmChannelIds: new Set() });

  test("targeted removal (kick / ban / leave)", () => {
    expect(routeDecision(s(INTENT.GUILDS), { t: "GUILD_DELETE", guildId: G, intent: INTENT.GUILDS, d: { id: G }, targetBotId: BOT }))
      .toEqual({ deliver: true, removeGuildId: G });
    expect(routeDecision(s(INTENT.GUILDS), { t: "GUILD_DELETE", guildId: G, intent: INTENT.GUILDS, d: { id: G }, targetBotId: "other" }).deliver).toBe(false);
  });

  test("removed even without the GUILDS intent, just not delivered", () => {
    expect(routeDecision(s(0), { t: "GUILD_DELETE", guildId: G, intent: INTENT.GUILDS, d: { id: G } }))
      .toEqual({ deliver: false, removeGuildId: G });
  });

  test("a guild the bot isn't in is ignored", () => {
    expect(routeDecision({ ...s(INTENT.GUILDS), guildIds: new Set() }, { t: "GUILD_DELETE", guildId: G, intent: INTENT.GUILDS, d: { id: G } }).deliver).toBe(false);
  });
});
