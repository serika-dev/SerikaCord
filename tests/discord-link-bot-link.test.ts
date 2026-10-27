import { describe, expect, test } from "bun:test";
import {
  INVALID_DISCORD_TOKEN, NOT_LINKED, classifyDiscordUserResponse, discordTokenClaimedId, isDiscordSnowflake,
  normalizeDiscordToken, parseDiscordLinkBody, serializeDiscordLink,
} from "@/lib/discord/botLink";

const BOT_ID = "1310000000000000123";
const b64 = (s: string) => Buffer.from(s).toString("base64").replace(/=+$/, "");
// Shape of a real Discord bot token: base64(user id).timestamp.hmac (fake values).
const token = `${b64(BOT_ID)}.GhJk7a.${"x".repeat(38)}`;

describe("Discord bot token shape", () => {
  test("a Discord-shaped token claims its bot user id", () => {
    expect(discordTokenClaimedId(token)).toBe(BOT_ID);
  });

  test("url-safe base64 first segments decode too", () => {
    const urlSafe = `${b64(BOT_ID).replace(/\+/g, "-").replace(/\//g, "_")}.GhJk7a.${"y".repeat(38)}`;
    expect(discordTokenClaimedId(urlSafe)).toBe(BOT_ID);
  });

  test("a SerikaCord bot token (two segments) is refused before reaching Discord", () => {
    expect(discordTokenClaimedId(`1730000000000000000.${"ab".repeat(24)}`)).toBeNull();
  });

  test("garbage, wrong segment counts and non-id first segments are refused", () => {
    expect(discordTokenClaimedId("")).toBeNull();
    expect(discordTokenClaimedId("a.b.c")).toBeNull();
    expect(discordTokenClaimedId(`${b64("not-an-id-at-all!")}.GhJk7a.${"x".repeat(38)}`)).toBeNull();
    expect(discordTokenClaimedId(`${token}.extra`)).toBeNull();
    expect(discordTokenClaimedId(`${b64(BOT_ID)}.Gh Jk7a.${"x".repeat(38)}`)).toBeNull();
    expect(discordTokenClaimedId(`${b64(BOT_ID)}.GhJk7a.${"x".repeat(300)}`)).toBeNull();
  });

  test("whitespace and a pasted Bot prefix are stripped", () => {
    expect(normalizeDiscordToken(`  Bot ${token} \n`)).toBe(token);
    expect(normalizeDiscordToken(token)).toBe(token);
  });
});

describe("PUT body validation", () => {
  test("accepts { discord_bot_token }", () => {
    expect(parseDiscordLinkBody({ discord_bot_token: ` Bot ${token}` })).toEqual({ ok: true, token });
  });

  test("missing body or field is 50035 Invalid Form Body", () => {
    for (const body of [null, undefined, "x", [], {}, { discord_bot_token: "" }, { discord_bot_token: null }]) {
      const r = parseDiscordLinkBody(body);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.code).toBe(50035);
        expect(r.error.errors?.discord_bot_token).toBeDefined();
      }
    }
  });

  test("a non-string token is a type error", () => {
    const r = parseDiscordLinkBody({ discord_bot_token: 123 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(JSON.stringify(r.error)).toContain("BASE_TYPE_STRING");
  });

  test("a malformed token answers 'Invalid Discord bot token' (50035)", () => {
    const r = parseDiscordLinkBody({ discord_bot_token: "definitely-not-a-token" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe(50035);
      expect(r.error.message).toBe(INVALID_DISCORD_TOKEN.message);
    }
  });

  test("the token never appears in an error body", () => {
    const bad = `${b64("12")}.GhJk7a.${"z".repeat(38)}`;
    const r = parseDiscordLinkBody({ discord_bot_token: bad });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(bad);
  });
});

describe("Discord's answer to GET /users/@me", () => {
  test("a bot whose id matches the token is ok", () => {
    expect(classifyDiscordUserResponse(200, { id: BOT_ID, bot: true, username: "serika" }, BOT_ID))
      .toEqual({ kind: "ok", id: BOT_ID, username: "serika" });
  });

  test("401 / 403 / other 4xx mean the token is invalid", () => {
    for (const status of [400, 401, 403, 404]) {
      expect(classifyDiscordUserResponse(status, { code: 0, message: "401: Unauthorized" }, BOT_ID).kind).toBe("invalid");
    }
  });

  test("a user account (not a bot) is refused", () => {
    expect(classifyDiscordUserResponse(200, { id: BOT_ID, username: "someone" }, BOT_ID).kind).toBe("invalid");
    expect(classifyDiscordUserResponse(200, { id: BOT_ID, bot: false }, BOT_ID).kind).toBe("invalid");
  });

  test("an id that differs from the one the token claims is refused", () => {
    expect(classifyDiscordUserResponse(200, { id: "1310000000000000999", bot: true }, BOT_ID).kind).toBe("invalid");
  });

  test("network errors, 429 and 5xx are 'unavailable', not 'invalid'", () => {
    expect(classifyDiscordUserResponse(0, null, BOT_ID).kind).toBe("unavailable");
    expect(classifyDiscordUserResponse(429, null, BOT_ID).kind).toBe("unavailable");
    expect(classifyDiscordUserResponse(502, null, BOT_ID).kind).toBe("unavailable");
    expect(classifyDiscordUserResponse(200, null, BOT_ID).kind).toBe("unavailable");
  });
});

describe("link view", () => {
  test("serializes the stored row", () => {
    const at = new Date("2026-10-27T12:00:00.000Z");
    expect(serializeDiscordLink({ discordBotUserId: BOT_ID, discordApplicationId: "1310000000000000124", discordLinkedAt: at }))
      .toEqual({ discord_bot_user_id: BOT_ID, discord_application_id: "1310000000000000124", linked_at: at.toISOString() });
  });

  test("no link, or a cleared one, is null", () => {
    expect(serializeDiscordLink(null)).toBeNull();
    expect(serializeDiscordLink({ discordBotUserId: null, discordApplicationId: null, discordLinkedAt: null })).toBeNull();
  });

  test("a missing application id is null", () => {
    const v = serializeDiscordLink({ discordBotUserId: BOT_ID, discordApplicationId: null, discordLinkedAt: new Date() });
    expect(v?.discord_application_id).toBeNull();
  });

  test("not linked is a Discord-style 404 body", () => {
    expect(NOT_LINKED).toEqual({ code: 10002, message: "Unknown Application" });
  });

  test("snowflake check", () => {
    expect(isDiscordSnowflake(BOT_ID)).toBe(true);
    expect(isDiscordSnowflake("6a4a78b3-9c1f-460c-2d06-a90700000000")).toBe(false);
    expect(isDiscordSnowflake(123)).toBe(false);
  });
});
