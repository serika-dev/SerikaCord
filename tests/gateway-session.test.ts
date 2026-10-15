import { describe, expect, test } from "bun:test";
import {
  CLOSE,
  REPLAY_MAX_FRAMES,
  SEND_LIMIT,
  countPayload,
  framesAfter,
  isSupportedVersion,
  newReplayBuffer,
  parseIdentify,
  presenceStatus,
  pushReplay,
  shardOfSnowflake,
  shardOfUuid,
} from "@/lib/gateway/session";
import { GatewayHub, newSession, OP, type Conn } from "@/lib/gateway/core";
import { clampLargeThreshold } from "@/lib/gateway/guildPayload";
import { toDiscordChannel, toDiscordGuildMember, toDiscordOverwrites, toDiscordRole } from "@/lib/services/gatewayEvents";
import { applicationFlags, parseApplicationPatch, toDiscordApplication } from "@/lib/botapi/application";

const GUILD = "0b7c1d1e-1111-4a2b-9c3d-0000000000aa";
const BOT = "0b7c1d1e-1111-4a2b-9c3d-0000000000b0";
const EVERYONE = "0b7c1d1e-1111-4a2b-9c3d-0000000000ee";

describe("IDENTIFY validation", () => {
  test("token, intents and shard", () => {
    expect(parseIdentify({ token: "Bot abc", intents: 513 })).toEqual({ ok: true, value: { token: "abc", intents: 513, shard: null, largeThreshold: undefined, presence: undefined } });
    expect(parseIdentify({ intents: 1 })).toMatchObject({ ok: false, close: CLOSE.AUTHENTICATION_FAILED });
    expect(parseIdentify({ token: "x", intents: 1 << 27 })).toMatchObject({ ok: false, close: CLOSE.INVALID_INTENTS });
    expect(parseIdentify({ token: "x", intents: -1 })).toMatchObject({ ok: false, close: CLOSE.INVALID_INTENTS });
    expect(parseIdentify({ token: "x", intents: 1.5 })).toMatchObject({ ok: false, close: CLOSE.INVALID_INTENTS });
    expect(parseIdentify({ token: "x", intents: 1, shard: [1, 2] })).toMatchObject({ ok: true, value: { shard: [1, 2] } });
    expect(parseIdentify({ token: "x", intents: 1, shard: [2, 2] })).toMatchObject({ ok: false, close: CLOSE.INVALID_SHARD });
    expect(parseIdentify({ token: "x", intents: 1, shard: [0, 0] })).toMatchObject({ ok: false, close: CLOSE.INVALID_SHARD });
  });
  test("versions, presence, large_threshold", () => {
    expect(isSupportedVersion("10")).toBe(true);
    expect(isSupportedVersion(null)).toBe(true);
    expect(isSupportedVersion("8")).toBe(false);
    expect(presenceStatus("dnd")).toBe("dnd");
    expect(presenceStatus("busy")).toBeNull();
    expect(clampLargeThreshold(10)).toBe(50);
    expect(clampLargeThreshold(1000)).toBe(250);
    expect(clampLargeThreshold(undefined)).toBe(50);
  });
});

describe("sharding", () => {
  test("Discord formula on snowflakes", () => {
    // (id >> 22) % n
    const id = "175928847299117063";
    expect(shardOfSnowflake(id, 1)).toBe(0);
    expect(shardOfSnowflake(id, 4)).toBe(Number((BigInt(id) >> 22n) % 4n));
    const s = shardOfUuid(GUILD, 3);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThan(3);
    expect(shardOfUuid(GUILD, 3)).toBe(s);
  });
});

describe("replay buffer", () => {
  test("frames after a seq, and refusal when trimmed or ahead", () => {
    const buf = newReplayBuffer();
    for (let s = 1; s <= 5; s++) pushReplay(buf, s, `f${s}`);
    expect(framesAfter(buf, 5, 3)).toEqual(["f4", "f5"]);
    expect(framesAfter(buf, 5, 5)).toEqual([]);
    expect(framesAfter(buf, 5, 0)).toEqual(["f1", "f2", "f3", "f4", "f5"]);
    expect(framesAfter(buf, 5, 6)).toBeNull();
    for (let s = 6; s <= REPLAY_MAX_FRAMES + 10; s++) pushReplay(buf, s, `f${s}`);
    expect(buf.frames.length).toBe(REPLAY_MAX_FRAMES);
    expect(framesAfter(buf, REPLAY_MAX_FRAMES + 10, 2)).toBeNull();
  });
  test("send rate limit", () => {
    const w = { start: 0, count: 0 };
    for (let i = 0; i < SEND_LIMIT; i++) expect(countPayload(w, 1000)).toBe(true);
    expect(countPayload(w, 1000)).toBe(false);
    expect(countPayload(w, 1000 + 60_000)).toBe(true);
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

function authed<T extends Conn>(conn: T): T {
  Object.assign(conn.data, { authenticated: true, ready: true, botId: BOT, intents: (1 << 0) | (1 << 9) | (1 << 15), guildIds: new Set([GUILD]) });
  return conn;
}

describe("GatewayHub (no DB paths)", () => {
  test("HELLO, heartbeat ACK, close codes before identify", async () => {
    const hub = new GatewayHub({ persistPresence: false });
    const c = fakeConn();
    hub.hello(c);
    expect(c.frames[0]).toMatchObject({ op: OP.HELLO, d: { heartbeat_interval: 41250 } });
    await hub.onFrame(c, JSON.stringify({ op: 1, d: null }));
    expect(c.frames[1]).toMatchObject({ op: OP.HEARTBEAT_ACK });
    await hub.onFrame(c, JSON.stringify({ op: 8, d: {} }));
    expect(c.closedWith).toBe(CLOSE.NOT_AUTHENTICATED);
    const d = fakeConn();
    await hub.onFrame(d, JSON.stringify({ op: 42 }));
    expect(d.closedWith).toBe(CLOSE.UNKNOWN_OPCODE);
    const e = fakeConn();
    await hub.onFrame(e, "{nope");
    expect(e.closedWith).toBe(CLOSE.DECODE_ERROR);
    const f = fakeConn();
    f.data.version = "6";
    hub.hello(f);
    expect(f.closedWith).toBe(CLOSE.INVALID_API_VERSION);
  });

  test("dispatches keep order and seq; detached sessions buffer for RESUME", async () => {
    const hub = new GatewayHub({ persistPresence: false });
    const c = authed(fakeConn());
    hub.adopt(c);
    const msg = (content: string) => ({
      t: "MESSAGE_CREATE", guildId: GUILD, intent: 1 << 9, audience: [BOT],
      d: { id: crypto.randomUUID(), channel_id: GUILD, guild_id: GUILD, author: { id: "someone" }, content, mentions: [] },
    });
    await Promise.all([hub.routeDispatch(msg("a")), hub.routeDispatch(msg("b")), hub.routeDispatch(msg("c"))]);
    expect(c.frames.map((f) => [f.s, (f.d as { content: string }).content])).toEqual([[1, "a"], [2, "b"], [3, "c"]]);
    // Disconnect: the session keeps buffering.
    hub.onClose(c);
    await hub.routeDispatch(msg("missed"));
    expect(c.frames.length).toBe(3);
    expect(c.data.seq).toBe(4);
    expect(framesAfter(c.data.replay, c.data.seq, 3)?.map((t) => JSON.parse(t).d.content)).toEqual(["missed"]);
  });

  test("pending dispatches wait for READY", async () => {
    const hub = new GatewayHub({ persistPresence: false });
    const c = authed(fakeConn());
    c.data.ready = false;
    hub.adopt(c);
    await hub.routeDispatch({ t: "GUILD_SCHEDULED_EVENT_CREATE", guildId: GUILD, intent: 0, d: { id: "e" } });
    expect(c.frames.length).toBe(0);
    expect(c.data.pending.length).toBe(1);
  });

  test("op 7 RECONNECT to everyone", () => {
    const hub = new GatewayHub({ persistPresence: false });
    const c = authed(fakeConn());
    hub.adopt(c);
    expect(hub.reconnectAll(10_000)).toBe(1);
    expect(c.frames.at(-1)).toMatchObject({ op: OP.RECONNECT });
  });
});

describe("guild serializers", () => {
  test("channel overwrites and types", () => {
    expect(toDiscordOverwrites([{ id: GUILD, type: "role", allow: "1024", deny: "2048" }, { id: BOT, type: "member", allow: null, deny: "x" }]))
      .toEqual([{ id: GUILD, type: 0, allow: "1024", deny: "2048" }, { id: BOT, type: 1, allow: "0", deny: "0" }]);
    const text = toDiscordChannel({ id: "c", serverId: GUILD, type: "text", name: "general", position: 2 }) as Record<string, unknown>;
    expect(text).toMatchObject({ id: "c", type: 0, guild_id: GUILD, name: "general", position: 2, permission_overwrites: [] });
    expect(toDiscordChannel({ id: "v", serverId: GUILD, type: "voice", name: "v" })).toMatchObject({ type: 2, bitrate: 64000, user_limit: 0 });
    const thread = toDiscordChannel({ id: "t", serverId: GUILD, type: "public_thread", parentId: "c", ownerId: BOT, createdAt: new Date(0) }) as { type: number; thread_metadata: Record<string, unknown> };
    expect(thread.type).toBe(11);
    expect(thread.thread_metadata.archived).toBe(false);
  });
  test("@everyone role and member roles", () => {
    expect(toDiscordRole({ id: EVERYONE, name: "x", isDefault: true, position: 5, permissions: "8" })).toMatchObject({ name: "@everyone", position: 0, permissions: "8" });
    expect(toDiscordRole({ id: "r", name: "bot", managed: true }, BOT).tags).toEqual({ bot_id: BOT });
    const m = toDiscordGuildMember({ roles: [EVERYONE, "r"], joinedAt: new Date(0) }, { id: BOT, username: "b", isBot: true }, EVERYONE);
    expect(m.roles).toEqual(["r"]);
    expect(m.user).toMatchObject({ id: BOT, discriminator: "0", bot: true });
  });
});

describe("application objects", () => {
  const app = { id: "a", name: "App", gatewayIntents: (1 << 15) | (1 << 30), createdAt: new Date(), flags: 0, publicKey: "ab", installParams: { scopes: ["bot"], permissions: "8" } };
  test("flags carry enabled privileged intents", () => {
    expect(applicationFlags(app)).toBe(1 << 18);
    const o = toDiscordApplication(app, { owner: { id: "o" }, bot: null, guildCount: 3 });
    expect(o).toMatchObject({ id: "a", verify_key: "ab", team: null, approximate_guild_count: 3, install_params: { scopes: ["bot"], permissions: "8" } });
    expect(o.integration_types_config["0"]).toEqual({ oauth2_install_params: { scopes: ["bot"], permissions: "8" } });
  });
  test("PATCH validation", () => {
    expect(parseApplicationPatch({ description: "hi", tags: ["a"] })).toEqual({ ok: true, updates: { description: "hi", tags: ["a"] } });
    const bad = parseApplicationPatch({ description: "x".repeat(401), tags: ["a", "b", "c", "d", "e", "f"] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.error.errors ?? {})).toEqual(["description", "tags"]);
    const flags = parseApplicationPatch({ flags: 1 << 19 });
    expect(flags.ok && flags.updates.gatewayIntents).toBe((1 << 15) | (1 << 30));
    expect(parseApplicationPatch({ interactions_endpoint_url: "http://insecure" }).ok).toBe(false);
    expect(parseApplicationPatch({ interactions_endpoint_url: null })).toEqual({ ok: true, updates: {}, interactionsEndpointUrl: null });
  });
});
