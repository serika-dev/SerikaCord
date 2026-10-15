import { describe, expect, test } from "bun:test";
import {
  DISCORD_EPOCH,
  candidateSnowflake,
  compareSnowflakes,
  decodeSnowflake,
  encodeSnowflake,
  isSnowflake,
  seedFor,
  snowflakeForTime,
  snowflakeTimestamp,
} from "@/lib/botapi/snowflake";
import {
  emojiParamId,
  isUuid,
  parseJsonBig,
  quoteBigInts,
  rewriteInbound,
  rewriteOutbound,
  scanInbound,
  scanOutbound,
  unknownIdError,
} from "@/lib/botapi/idTranslate";
import { apiError, errorsTree, invalidFormBody, validationErrorBody } from "@/lib/botapi/errors";
import { idFormatOf } from "@/lib/botapi/boundary";

const U1 = "0b7c1d1e-1111-4a2b-9c3d-000000000001";
const U2 = "0b7c1d1e-1111-4a2b-9c3d-000000000002";
const U3 = "0b7c1d1e-1111-4a2b-9c3d-000000000003";
const ROLE_EVERYONE = "0b7c1d1e-1111-4a2b-9c3d-0000000000ee";
const GUILD = "0b7c1d1e-1111-4a2b-9c3d-0000000000aa";

describe("snowflake codec", () => {
  test("round-trips timestamp, worker and seq", () => {
    const ts = Date.parse("2026-10-16T12:34:56.789Z");
    const sf = encodeSnowflake({ timestamp: ts, worker: 513, seq: 4095 });
    expect(decodeSnowflake(sf)).toEqual({ timestamp: ts, worker: 513, seq: 4095 });
    expect(snowflakeTimestamp(sf)).toBe(ts);
  });

  test("matches Discord's documented example", () => {
    // https://discord.com/developers/docs/reference#snowflakes
    expect(snowflakeTimestamp("175928847299117063")).toBe(1462015105796);
    expect(decodeSnowflake("175928847299117063")).toEqual({ timestamp: 1462015105796, worker: 32, seq: 7 });
  });

  test("orders by time and compares numerically, not lexically", () => {
    const a = snowflakeForTime(DISCORD_EPOCH + 1000);
    const b = snowflakeForTime(Date.parse("2026-01-01T00:00:00Z"));
    expect(a.length).toBeLessThan(b.length);
    expect(compareSnowflakes(a, b)).toBe(-1);
    expect(compareSnowflakes(b, a)).toBe(1);
    expect(compareSnowflakes(b, b)).toBe(0);
    expect(compareSnowflakes("9", "10")).toBe(-1);
  });

  test("clamps times before the epoch", () => {
    expect(snowflakeTimestamp(encodeSnowflake({ timestamp: 0, worker: 0, seq: 1 }))).toBe(DISCORD_EPOCH);
  });

  test("isSnowflake accepts positive int64 decimal strings only", () => {
    expect(isSnowflake("175928847299117063")).toBe(true);
    expect(isSnowflake("1")).toBe(true);
    expect(isSnowflake("0")).toBe(false);
    expect(isSnowflake("9223372036854775808")).toBe(false); // 2^63
    expect(isSnowflake("12a")).toBe(false);
    expect(isSnowflake(U1)).toBe(false);
    expect(isSnowflake(123 as unknown)).toBe(false);
  });

  test("candidates are deterministic per uuid and distinct per attempt", () => {
    const ts = Date.parse("2026-05-01T00:00:00Z");
    expect(candidateSnowflake(U1, ts)).toBe(candidateSnowflake(U1, ts));
    expect(candidateSnowflake(U1, ts, 1)).not.toBe(candidateSnowflake(U1, ts, 0));
    expect(snowflakeTimestamp(candidateSnowflake(U1, ts, 7))).toBe(ts);
    const s = seedFor(U2);
    expect(s.worker).toBeLessThan(1024);
    expect(s.seq).toBeLessThan(4096);
    // seq wrap moves into the worker bits but keeps the timestamp
    const wrapped = candidateSnowflake(U1, ts, 5000);
    expect(snowflakeTimestamp(wrapped)).toBe(ts);
  });
});

describe("outbound id rewrite", () => {
  const map = new Map([[U1, "1001"], [U2, "1002"], [U3, "1003"], [GUILD, "2000"], [ROLE_EVERYONE, "2000"]]);
  const lookup = { get: (u: string) => map.get(u), everyoneRoles: new Set([ROLE_EVERYONE]) };

  test("rewrites id fields, nested objects, arrays and tokens", () => {
    const msg = {
      id: U1,
      channel_id: U2,
      guild_id: GUILD,
      author: { id: U3, username: "bob" },
      content: `hi <@${U3}> <@!${U3}> in <#${U2}> <@&${U1}> <:wave:${U1}> <a:dance:${U2}> </cmd sub:${U1}> ${U1}`,
      mentions: [{ id: U3 }],
      mention_roles: [U1],
      nonce: U1,
      timestamp: "2026-10-16T00:00:00.000Z",
      member: { roles: [ROLE_EVERYONE, U1], joined_at: "2026-10-16T00:00:00.000Z" },
      referenced_message: { id: U2, author: { id: U1 } },
    };
    const out = rewriteOutbound(msg, lookup);
    expect(out.id).toBe("1001");
    expect(out.channel_id).toBe("1002");
    expect(out.guild_id).toBe("2000");
    expect(out.author.id).toBe("1003");
    expect(out.author.username).toBe("bob");
    expect(out.mentions[0].id).toBe("1003");
    expect(out.mention_roles).toEqual(["1001"]);
    // free text keeps a bare UUID, tokens are rewritten
    expect(out.content).toBe("hi <@1003> <@!1003> in <#1002> <@&1001> <:wave:1001> <a:dance:1002> </cmd sub:1001> " + U1);
    expect(out.nonce).toBe(U1);
    // @everyone never appears in member roles
    expect(out.member.roles).toEqual(["1001"]);
    expect(out.referenced_message.author.id).toBe("1001");
    // input untouched
    expect(msg.id).toBe(U1);
  });

  test("rewrites UUID object keys (interaction resolved maps) and id-typed option values", () => {
    const ix = {
      data: {
        resolved: { users: { [U1]: { id: U1 } } },
        options: [
          { name: "who", type: 6, value: U1 },
          { name: "text", type: 3, value: U2 },
        ],
      },
      authorizing_integration_owners: { "0": GUILD },
      permission_overwrites: [{ id: U2, type: 0, allow: "1024", deny: "0" }],
    };
    const out = rewriteOutbound(ix, lookup);
    expect(Object.keys(out.data.resolved.users)).toEqual(["1001"]);
    expect((out.data.resolved.users as Record<string, { id: string }>)["1001"].id).toBe("1001");
    expect(out.data.options[0].value).toBe("1001");
    expect(out.data.options[1].value).toBe(U2);
    expect(out.authorizing_integration_owners["0"]).toBe("2000");
    expect(out.permission_overwrites[0]).toEqual({ id: "1002", type: 0, allow: "1024", deny: "0" });
  });

  test("scan collects ids and message timestamp hints", () => {
    const s = scanOutbound([{ id: U1, channel_id: U2, timestamp: "2026-10-16T00:00:00.000Z", content: `<@${U3}>` }]);
    expect([...s.uuids].sort()).toEqual([U1, U2, U3].sort());
    expect(s.hints.get(U1)).toEqual({ ts: Date.parse("2026-10-16T00:00:00.000Z"), kind: 4 });
  });

  test("unknown uuids are left alone", () => {
    expect(rewriteOutbound({ id: "0b7c1d1e-1111-4a2b-9c3d-999999999999" }, lookup).id).toBe("0b7c1d1e-1111-4a2b-9c3d-999999999999");
  });
});

describe("inbound id rewrite", () => {
  const m = new Map([["1001", U1], ["1002", U2], ["2000", GUILD]]);
  const get = (sf: string, ctx: "role" | "any") => (ctx === "role" && sf === "2000" ? ROLE_EVERYONE : m.get(sf));

  test("only id-shaped keys are translated; bitfields and nonces stay", () => {
    const body = {
      content: "hey <@1001> <#1002> <@&2000> 1001",
      nonce: "1001",
      message_reference: { message_id: "1001", channel_id: 1002 },
      allowed_mentions: { parse: [], users: ["1001", 1002], roles: ["2000"] },
      permission_overwrites: [
        { id: "2000", type: 0, allow: "1001", deny: "0" },
        { id: "1001", type: 1, allow: "0", deny: "1002" },
      ],
      roles: ["1002", "2000"],
      color: 1001,
      sticker_ids: ["1001"],
    };
    const scan = scanInbound(body);
    expect([...scan.snowflakes].sort()).toEqual(["1001", "1002", "2000"]);
    expect(scan.roleSnowflakes.has("2000")).toBe(true);
    const out = rewriteInbound(body, { get });
    expect(out.content).toBe(`hey <@${U1}> <#${U2}> <@&${ROLE_EVERYONE}> 1001`);
    expect(out.nonce).toBe("1001");
    expect(out.message_reference).toEqual({ message_id: U1, channel_id: U2 });
    expect(out.allowed_mentions.users).toEqual([U1, U2]);
    expect(out.allowed_mentions.roles).toEqual([ROLE_EVERYONE]);
    expect(out.permission_overwrites[0]).toEqual({ id: ROLE_EVERYONE, type: 0, allow: "1001", deny: "0" });
    expect(out.permission_overwrites[1]).toEqual({ id: U1, type: 1, allow: "0", deny: "1002" });
    expect(out.roles).toEqual([U2, ROLE_EVERYONE]);
    expect(out.color).toBe(1001);
    expect(out.sticker_ids).toEqual([U1]);
  });

  test("UUIDs and unknown snowflakes pass through", () => {
    const out = rewriteInbound({ channel_id: U1, message_id: "4242" }, { get });
    expect(out).toEqual({ channel_id: U1, message_id: "4242" });
  });

  test("outbound then inbound round-trips a payload", () => {
    const fwd = new Map([[U1, "1001"], [U2, "1002"]]);
    const back = new Map([["1001", U1], ["1002", U2]]);
    const original = { id: U1, channel_id: U2, users: [U1, U2], content: `<@${U1}> and <#${U2}>` };
    const sf = rewriteOutbound(original, { get: (u) => fwd.get(u) });
    const again = rewriteInbound(sf, { get: (s) => back.get(s) });
    expect(again).toEqual(original);
  });
});

describe("JSON with big integers", () => {
  test("quotes 16+ digit integers outside strings only", () => {
    const text = '{"a":175928847299117063,"b":12,"c":"175928847299117063","d":[1234567890123456789,-5,1.5e3],"e":"x\\"9999999999999999"}';
    const v = parseJsonBig(text) as Record<string, unknown>;
    expect(v.a).toBe("175928847299117063");
    expect(v.b).toBe(12);
    expect(v.c).toBe("175928847299117063");
    expect(v.d).toEqual(["1234567890123456789", -5, 1500]);
    expect(v.e).toBe('x"9999999999999999');
    expect(quoteBigInts('{"x":1}')).toBe('{"x":1}');
  });
});

describe("path helpers", () => {
  test("custom emoji params", () => {
    expect(emojiParamId("wave:1001")).toEqual({ name: "wave", id: "1001" });
    expect(emojiParamId("a:dance:1002")).toEqual({ name: "dance", id: "1002" });
    expect(emojiParamId(encodeURIComponent("abc:1003"))).toEqual({ name: "abc", id: "1003" });
    expect(emojiParamId("%F0%9F%91%8D")).toBeNull();
  });
  test("unknown id errors use Discord codes", () => {
    expect(unknownIdError("channelId")).toEqual({ status: 404, body: { code: 10003, message: "Unknown Channel" } });
    expect(unknownIdError("messageId").body.code).toBe(10008);
    expect(unknownIdError("guildId").body.code).toBe(10004);
    expect(unknownIdError("roleId").body.code).toBe(10011);
    expect(unknownIdError("userId").body.code).toBe(10013);
  });
  test("isUuid", () => {
    expect(isUuid(U1)).toBe(true);
    expect(isUuid("1001")).toBe(false);
  });
  test("id format per application", () => {
    expect(idFormatOf({ apiIdFormat: "snowflake" })).toBe("snowflake");
    expect(idFormatOf({ apiIdFormat: null })).toBe("uuid");
    expect(idFormatOf(null)).toBe("uuid");
  });
});

describe("Discord error bodies", () => {
  test("errors tree", () => {
    expect(errorsTree([
      { path: "content", code: "BASE_TYPE_MAX_LENGTH", message: "Must be 2000 or fewer in length." },
      { path: "embeds.0.title", code: "BASE_TYPE_REQUIRED", message: "This field is required" },
      { path: ["embeds", 0, "title"], code: "X", message: "y" },
    ])).toEqual({
      content: { _errors: [{ code: "BASE_TYPE_MAX_LENGTH", message: "Must be 2000 or fewer in length." }] },
      embeds: { "0": { title: { _errors: [{ code: "BASE_TYPE_REQUIRED", message: "This field is required" }, { code: "X", message: "y" }] } } },
    });
  });
  test("apiError omits empty errors", () => {
    expect(apiError(10003, "Unknown Channel")).toEqual({ code: 10003, message: "Unknown Channel" });
    expect(invalidFormBody([{ path: "name", code: "BASE_TYPE_REQUIRED", message: "This field is required" }]).code).toBe(50035);
  });
  test("maps Elysia validation errors", () => {
    const err = { all: [
      { path: "/content", message: "Expected string length less or equal to 2000", schema: { maxLength: 2000 }, value: "x".repeat(2001) },
      { path: "/content", message: "dup", schema: {}, value: 1 },
      { path: "/name", message: "Expected required property", schema: {}, value: undefined },
    ] };
    expect(validationErrorBody(err)).toEqual({
      code: 50035,
      message: "Invalid Form Body",
      errors: {
        content: { _errors: [{ code: "BASE_TYPE_MAX_LENGTH", message: "Must be 2000 or fewer in length." }] },
        name: { _errors: [{ code: "BASE_TYPE_REQUIRED", message: "This field is required" }] },
      },
    });
    expect(validationErrorBody(new Error("x"))).toEqual({ code: 50035, message: "Invalid Form Body" });
  });
});
