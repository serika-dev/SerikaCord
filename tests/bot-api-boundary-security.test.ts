import { describe, expect, test } from "bun:test";
import { isPublicSnowflake } from "@/lib/botapi/snowflake";
import {
  MAX_INBOUND_IDS, MAX_OUTBOUND_IDS, STRUCTURAL_KIND, rewriteInbound, scanInbound, scanOutbound,
} from "@/lib/botapi/idTranslate";
import { botTokenOf, translateInbound } from "@/lib/botapi/boundary";
import { errorsTree } from "@/lib/botapi/errors";
import { isAcceptableEndpointUrl, readCapped } from "@/lib/botapi/endpointVerify";
import { botViewChecker, threadVisibleToBot } from "@/lib/gateway/guildPayload";
import { GatewayHub, MAX_DETACHED_PER_BOT, newSession, OP, type Conn } from "@/lib/gateway/core";
import { CLOSE } from "@/lib/gateway/session";

const U = (n: number) => `0b7c1d1e-1111-4a2b-9c3d-${n.toString(16).padStart(12, "0")}`;
const GUILD = U(0xaa);
const BOT = U(0xb0);

describe("inbound limits", () => {
  test("only 15+ digit numbers are snowflakes", () => {
    expect(isPublicSnowflake("123456789012345")).toBe(true);
    expect(isPublicSnowflake("12345678901234")).toBe(false);
    const scan = scanInbound({ channel_id: "12345", user_id: "123456789012345", content: "<@1234> <@123456789012345>" });
    expect([...scan.snowflakes]).toEqual(["123456789012345"]);
  });

  test("the scan stops past the id cap", () => {
    const ids = Array.from({ length: MAX_INBOUND_IDS + 50 }, (_, i) => String(100000000000000000n + BigInt(i)));
    const scan = scanInbound({ user_ids: ids });
    expect(scan.overflow).toBe(true);
    expect(scan.snowflakes.size).toBeLessThanOrEqual(MAX_INBOUND_IDS + 1);
  });

  test("too many ids answers 50035 without any lookup", async () => {
    const ids = Array.from({ length: 2000 }, (_, i) => String(100000000000000000n + BigInt(i)));
    const res = await translateInbound({ body: { user_ids: ids } });
    expect(res.error?.status).toBe(400);
    expect(res.error?.body.code).toBe(50035);
    const q = await translateInbound({ query: { user_ids: ids.join(",") } });
    expect(q.error?.status).toBe(400);
  });

  test("bot token syntax", () => {
    expect(botTokenOf("Bot 3670230831863158.0123456789abcdef0123456789abcdef")).toBe("3670230831863158.0123456789abcdef0123456789abcdef");
    expect(botTokenOf("Bearer abc")).toBeNull();
    expect(botTokenOf("Bot short")).toBeNull();
    expect(botTokenOf("Bot has spaces in it which is not a token")).toBeNull();
    expect(botTokenOf(undefined)).toBeNull();
  });

  test("__proto__ keys stay plain keys", () => {
    const body = JSON.parse('{"__proto__": {"polluted": true}, "channel_id": "123456789012345678"}');
    const out = rewriteInbound(body, { get: () => U(1) }) as Record<string, unknown>;
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(out.channel_id).toBe(U(1));
    const tree = errorsTree([{ path: "__proto__.polluted", code: "X", message: "y" }]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(tree)).toEqual(["__proto__"]);
  });
});

describe("outbound minting provenance", () => {
  test("tokens in text are never structural; attachments, tags and interactions are", () => {
    const fake = U(0xf00);
    const scan = scanOutbound({
      id: U(1), token: "tok", application_id: "123", type: 2,
      content: `look <#${fake}>`,
      attachments: [{ id: U(2), filename: "a.png" }],
      available_tags: [{ id: U(3), name: "t" }],
      applied_tags: [U(4)],
      embeds: [{ description: `<@${U(5)}>` }],
      values: [U(6)],
    });
    expect(scan.uuids.has(fake)).toBe(true); // still looked up (an existing channel resolves)
    expect(scan.kinds.has(fake)).toBe(false); // but never minted on its own
    expect(scan.kinds.get(U(1))).toBe(STRUCTURAL_KIND.interaction);
    expect(scan.kinds.get(U(2))).toBe(STRUCTURAL_KIND.attachment);
    expect(scan.kinds.get(U(3))).toBe(STRUCTURAL_KIND.tag);
    expect(scan.kinds.get(U(4))).toBe(STRUCTURAL_KIND.tag);
    expect(scan.kinds.has(U(5))).toBe(false);
    expect(scan.uuids.has(U(6))).toBe(false); // select values are free text
  });

  test("per-payload cap", () => {
    const many = Array.from({ length: MAX_OUTBOUND_IDS + 100 }, (_, i) => ({ id: U(i + 1) }));
    expect(scanOutbound(many).uuids.size).toBe(MAX_OUTBOUND_IDS);
  });
});

describe("interactions endpoint verification", () => {
  test("https only", () => {
    expect(isAcceptableEndpointUrl("https://bot.example.com/interactions")).toBe(true);
    expect(isAcceptableEndpointUrl("http://bot.example.com/interactions")).toBe(false);
    expect(isAcceptableEndpointUrl("https://user:pw@bot.example.com/")).toBe(false);
    expect(isAcceptableEndpointUrl("not a url")).toBe(false);
  });
  test("reply bodies are capped", async () => {
    expect(await readCapped(new Response('{"type":1}'))).toBe('{"type":1}');
    expect(await readCapped(new Response("x".repeat(70 * 1024)))).toBeNull();
    expect(await readCapped(new Response("x".repeat(100)), 10)).toBeNull();
  });
});

describe("GUILD_CREATE thread visibility", () => {
  const VIEW = 1n << 10n;
  const roles = [
    { id: U(0x10), permissions: String(VIEW), isDefault: true },
    { id: U(0x11), permissions: "0", isDefault: false },
  ];
  const canView = botViewChecker({ isOwner: false, serverId: GUILD, botId: BOT, memberRoleIds: [U(0x10), U(0x11)], roles });
  const open = { permissionOverwrites: [] };
  const hidden = { permissionOverwrites: [{ id: GUILD, type: "role", allow: "0", deny: String(VIEW) }] };
  const allowedForBot = { permissionOverwrites: [...hidden.permissionOverwrites, { id: BOT, type: "member", allow: String(VIEW), deny: "0" }] };
  test("public threads need a viewable parent", () => {
    expect(threadVisibleToBot({ type: "public_thread" }, open, BOT, canView)).toBe(true);
    expect(threadVisibleToBot({ type: "public_thread" }, hidden, BOT, canView)).toBe(false);
    expect(threadVisibleToBot({ type: "public_thread" }, allowedForBot, BOT, canView)).toBe(true);
    expect(threadVisibleToBot({ type: "public_thread" }, null, BOT, canView)).toBe(false);
    expect(threadVisibleToBot({ type: "public_thread", archived: true }, open, BOT, canView)).toBe(false);
  });
  test("private threads also need membership", () => {
    expect(threadVisibleToBot({ type: "private_thread", threadMemberIds: [] }, open, BOT, canView)).toBe(false);
    expect(threadVisibleToBot({ type: "private_thread", threadMemberIds: [BOT] }, open, BOT, canView)).toBe(true);
    expect(threadVisibleToBot({ type: "private_thread", threadMemberIds: [BOT] }, hidden, BOT, canView)).toBe(false);
  });
});

function fakeConn(): Conn & { frames: Array<Record<string, unknown>>; closedWith: number | null } {
  const frames: Array<Record<string, unknown>> = [];
  const conn = {
    data: newSession(),
    frames,
    closedWith: null as number | null,
    sendText(text: string) { frames.push(JSON.parse(text)); },
    close(code: number) { conn.closedWith = code; },
  };
  return conn;
}

describe("gateway session limits (no DB)", () => {
  test("a socket that never identifies is closed", async () => {
    const hub = new GatewayHub({ persistPresence: false, identifyTimeoutMs: 20 });
    const c = fakeConn();
    hub.hello(c);
    await new Promise((r) => setTimeout(r, 40));
    expect(c.closedWith).toBe(CLOSE.SESSION_TIMED_OUT);
  });

  test("resumable sessions are capped per bot", () => {
    const hub = new GatewayHub({ persistPresence: false });
    for (let i = 0; i < MAX_DETACHED_PER_BOT + 5; i++) {
      const c = fakeConn();
      Object.assign(c.data, { authenticated: true, ready: true, botId: BOT });
      hub.adopt(c);
      hub.onClose(c);
    }
    expect(hub.sessionCount(BOT)).toEqual({ live: 0, detached: MAX_DETACHED_PER_BOT });
  });

  test("op 8 full member lists are throttled per guild (RATE_LIMITED)", async () => {
    const hub = new GatewayHub({ persistPresence: false });
    const c = fakeConn();
    Object.assign(c.data, { authenticated: true, ready: true, botId: BOT, intents: 1 << 1, guildIds: new Set([GUILD]), memberListAt: new Map([[GUILD, Date.now()]]) });
    hub.adopt(c);
    await hub.onFrame(c, JSON.stringify({ op: OP.REQUEST_GUILD_MEMBERS, d: { guild_id: GUILD, query: "", limit: 0, nonce: "n" } }));
    const f = c.frames.at(-1) as { t: string; d: { opcode: number; retry_after: number; meta: { guild_id: string; nonce: string } } };
    expect(f.t).toBe("RATE_LIMITED");
    expect(f.d).toMatchObject({ opcode: 8, meta: { guild_id: GUILD, nonce: "n" } });
    expect(f.d.retry_after).toBeGreaterThan(0);
  });
});
