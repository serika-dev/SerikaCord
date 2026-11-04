import { describe, expect, test } from "bun:test";
import {
  RpcError, cardStatus, checkLaunch, discordChannelType, discordInstance, dispatchFrame, errorFrame, isInstanceId, liveParticipants,
  locationId, parseAuthorizeScopes, parseInboundFrame, platformFamily, replyFrame, safeExternalLink, sdkPlatform, sdkUser, shouldEnd,
  type LaunchCheckInput,
} from "@/lib/activities/instances";
import {
  appCsp, downstreamResponseHeaders, hostOrigins, relayCsp, relayHtml, rewriteLocation, sdkQuery, upstreamRequestHeaders,
} from "@/lib/activities/relay";
import { activityFrameSource, activityOrigin } from "@/lib/activities/settings";
import { PERMISSION_BITS } from "@/lib/permissions/bits";

const P = PERMISSION_BITS;
const base = (over: Partial<LaunchCheckInput> = {}): LaunchCheckInput => ({
  channel: { id: "c", type: "text", serverId: "s", nsfw: false },
  permissions: P.VIEW_CHANNEL | P.SEND_MESSAGES | P.USE_EMBEDDED_ACTIVITIES | P.CONNECT,
  inVoiceRoom: false,
  voice: false,
  ageConfirmed: false,
  app: { enabled: true, ageGated: false, supportedPlatforms: ["web", "desktop"] },
  platform: "web",
  domainConfigured: true,
  ...over,
});

describe("checkLaunch", () => {
  test("server text channel needs USE_EMBEDDED_ACTIVITIES and SEND_MESSAGES to launch", () => {
    expect(checkLaunch(base(), "launch")).toEqual({ ok: true });
    expect(checkLaunch(base({ permissions: P.VIEW_CHANNEL | P.SEND_MESSAGES }), "launch")).toEqual({ ok: false, reason: "missing_permissions" });
    expect(checkLaunch(base({ permissions: P.VIEW_CHANNEL | P.USE_EMBEDDED_ACTIVITIES }), "launch")).toEqual({ ok: false, reason: "missing_permissions" });
    // Joining a running one doesn't need to post.
    expect(checkLaunch(base({ permissions: P.VIEW_CHANNEL | P.USE_EMBEDDED_ACTIVITIES }), "join")).toEqual({ ok: true });
    expect(checkLaunch(base({ permissions: 0n }), "join")).toEqual({ ok: false, reason: "no_access" });
    expect(checkLaunch(base({ permissions: P.ADMINISTRATOR }), "launch")).toEqual({ ok: true });
  });
  test("calls need the voice channel, CONNECT and being in the call", () => {
    const voice = { channel: { id: "v", type: "voice", serverId: "s" }, voice: true };
    expect(checkLaunch(base({ ...voice, inVoiceRoom: true }), "launch")).toEqual({ ok: true });
    expect(checkLaunch(base({ ...voice, inVoiceRoom: false }), "launch")).toEqual({ ok: false, reason: "not_in_call" });
    expect(checkLaunch(base({ ...voice, inVoiceRoom: true, permissions: P.VIEW_CHANNEL | P.USE_EMBEDDED_ACTIVITIES }), "launch")).toEqual({ ok: false, reason: "missing_permissions" });
    expect(checkLaunch(base({ voice: true, inVoiceRoom: true }), "launch")).toEqual({ ok: false, reason: "channel_type" });
  });
  test("DMs need only membership; DM calls need the call", () => {
    const dm = { channel: { id: "d", type: "dm", serverId: null }, permissions: 0n };
    expect(checkLaunch(base(dm), "launch")).toEqual({ ok: true });
    expect(checkLaunch(base({ ...dm, voice: true }), "launch")).toEqual({ ok: false, reason: "not_in_call" });
    expect(checkLaunch(base({ ...dm, channel: { id: "g", type: "group_dm" }, voice: true, inVoiceRoom: true }), "launch")).toEqual({ ok: true });
  });
  test("age gate (a confirmed warning, anywhere), platform, configuration", () => {
    const gated = { app: { enabled: true, ageGated: true, supportedPlatforms: ["web"] } };
    expect(checkLaunch(base(gated), "launch")).toEqual({ ok: false, reason: "age_confirm" });
    expect(checkLaunch(base(gated), "join")).toEqual({ ok: false, reason: "age_confirm" });
    expect(checkLaunch(base({ ...gated, ageConfirmed: true }), "launch")).toEqual({ ok: true });
    expect(checkLaunch(base({ ...gated, ageConfirmed: true, channel: { id: "d", type: "dm" }, permissions: 0n }), "launch")).toEqual({ ok: true });
    expect(checkLaunch(base({ platform: "ios" }), "launch")).toEqual({ ok: false, reason: "platform" });
    expect(checkLaunch(base({ domainConfigured: false }), "launch")).toEqual({ ok: false, reason: "not_configured" });
    expect(checkLaunch(base({ app: { enabled: false, ageGated: false, supportedPlatforms: ["web"] } }), "launch")).toEqual({ ok: false, reason: "not_enabled" });
    expect(checkLaunch(base({ channel: { id: "x", type: "category", serverId: "s" } }), "launch")).toEqual({ ok: false, reason: "channel_type" });
  });
});

describe("instance bookkeeping", () => {
  test("location ids, instance ids and Discord's instance shape", () => {
    expect(locationId({ kind: "gc", guildId: "g", channelId: "c" })).toBe("gc-g-c");
    expect(locationId({ kind: "pc", guildId: null, channelId: "c" })).toBe("pc-c");
    expect(isInstanceId("i-abcdefgh123")).toBe(true);
    expect(isInstanceId("i-../x")).toBe(false);
    expect(isInstanceId(42)).toBe(false);
    const rec = { id: "i-abcdefghijkl", applicationId: "app", launchId: "123", location: { kind: "pc" as const, channelId: "c", guildId: null, voiceRoomId: null }, launcherId: "u", startedAt: 0, messageId: null, endedAt: null };
    expect(discordInstance(rec, { applicationId: "A", channelId: "C", guildId: null, users: ["u1"] })).toEqual({
      application_id: "A", instance_id: "i-abcdefghijkl", launch_id: "123", location: { id: "pc-C", kind: "pc", channel_id: "C" }, users: ["u1"],
    });
  });
  test("participants time out; instances end when empty (after a grace) or too old", () => {
    expect(liveParticipants([{ userId: "a", seenAt: 1000 }, { userId: "b", seenAt: 90_000 }], 100_000)).toEqual({ live: ["b"], stale: ["a"] });
    expect(shouldEnd({ startedAt: 0, endedAt: null }, 0, 5_000)).toBe(false);
    expect(shouldEnd({ startedAt: 0, endedAt: null }, 0, 20_000)).toBe(true);
    expect(shouldEnd({ startedAt: 0, endedAt: null }, 3, 20_000)).toBe(false);
    expect(shouldEnd({ startedAt: 0, endedAt: null }, 3, 13 * 3600_000)).toBe(true);
    expect(shouldEnd({ startedAt: 0, endedAt: 5 }, 0, 20_000)).toBe(false);
  });
  test("card status line", () => {
    expect(cardStatus(null)).toBe("ended");
    expect(cardStatus({ ended: true, participantCount: 2 })).toBe("ended");
    expect(cardStatus({ ended: false, participantCount: 0 })).toBe("waiting");
    expect(cardStatus({ ended: false, participantCount: 2 })).toBe("playing");
  });
  test("platforms and channel types", () => {
    expect(platformFamily("ios")).toBe("ios");
    expect(platformFamily("xbox")).toBe("web");
    expect(sdkPlatform("android")).toBe("mobile");
    expect(sdkPlatform("desktop")).toBe("desktop");
    expect(discordChannelType("voice")).toBe(2);
    expect(discordChannelType("group_dm")).toBe(3);
    expect(sdkUser({ id: "u", username: "a", displayName: "A" }, "123")).toMatchObject({ id: "123", username: "a", discriminator: "0", global_name: "A", bot: false });
  });
});

describe("SDK protocol frames", () => {
  test("parses the SDK's handshake, commands and close", () => {
    expect(parseInboundFrame([0, { v: 1, encoding: "json", client_id: "123", frame_id: "f" }])).toEqual({ op: 0, handshake: { v: 1, encoding: "json", client_id: "123", frame_id: "f", sdk_version: undefined } });
    expect(parseInboundFrame([1, { cmd: "AUTHORIZE", args: { scope: ["identify"] }, nonce: "n" }])).toEqual({ op: 1, frame: { cmd: "AUTHORIZE", args: { scope: ["identify"] }, nonce: "n", evt: null } });
    expect(parseInboundFrame([1, { cmd: "SUBSCRIBE", args: null, evt: "READY", nonce: "n" }])).toMatchObject({ op: 1, frame: { args: {}, evt: "READY" } });
    expect(parseInboundFrame([2, { code: 1000, message: "bye" }])).toEqual({ op: 2, close: { code: 1000, message: "bye" } });
    expect(parseInboundFrame([3, null])).toEqual({ op: 3 });
  });
  test("ignores malformed messages", () => {
    for (const bad of [null, "x", [], [1], [9, {}], [1, { cmd: "lower", nonce: "n" }], [1, { cmd: "X" }], [0, { v: 1 }], [1, []], [0, { v: 1, client_id: "x".repeat(65), frame_id: "f" }]]) {
      expect(parseInboundFrame(bad)).toBeNull();
    }
  });
  test("reply, error and dispatch frames have Discord's shape", () => {
    expect(replyFrame("GET_CHANNEL", "n", { id: "1" })).toEqual([1, { cmd: "GET_CHANNEL", evt: null, nonce: "n", data: { id: "1" } }]);
    expect(replyFrame("CAPTURE_LOG", "n", undefined)).toEqual([1, { cmd: "CAPTURE_LOG", evt: null, nonce: "n", data: null }]);
    expect(errorFrame("FOO", "n", RpcError.INVALID_COMMAND, "Invalid command: FOO")).toEqual([1, { cmd: "FOO", evt: "ERROR", nonce: "n", data: { code: 4002, message: "Invalid command: FOO" } }]);
    expect(dispatchFrame("READY", { v: 1 })).toEqual([1, { cmd: "DISPATCH", evt: "READY", nonce: null, data: { v: 1 } }]);
  });
  test("authorize scopes and external links", () => {
    expect(parseAuthorizeScopes(["identify", "guilds", "identify"])).toEqual({ ok: true, scopes: ["identify", "guilds"] });
    expect(parseAuthorizeScopes([]).ok).toBe(false);
    expect(parseAuthorizeScopes(["bot"]).ok).toBe(false);
    expect(parseAuthorizeScopes("identify").ok).toBe(false);
    expect(safeExternalLink("https://example.com/x")).toBe("https://example.com/x");
    expect(safeExternalLink("javascript:alert(1)")).toBeNull();
    expect(safeExternalLink("https://user:pw@example.com")).toBeNull();
    expect(safeExternalLink(5)).toBeNull();
  });
});

describe("relay page and proxy headers", () => {
  test("only the SDK's query params reach the app", () => {
    const q = sdkQuery(new URLSearchParams("frame_id=f&instance_id=i-1&platform=desktop&evil=1&channel_id=<script>"));
    expect(q.toString()).toBe("frame_id=f&instance_id=i-1&platform=desktop");
  });
  test("host origins are https (or local http), deduplicated", () => {
    expect(hostOrigins(["https://serika.chat/x", "https://serika.chat", "http://evil.com", "http://localhost:3000", "junk", null])).toEqual(["https://serika.chat", "http://localhost:3000"]);
  });
  test("relay page: nonce'd script, escaped title, allowed origins baked in", () => {
    const html = relayHtml({ nonce: "abc", appSrc: "/?frame_id=f", allowedOrigins: ["https://serika.chat"], title: "<b>x</b>", allow: ["autoplay"] });
    expect(html).toContain('<script nonce="abc">');
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain('["https://serika.chat"]');
    expect(relayCsp("abc", ["https://serika.chat"])).toContain("frame-ancestors https://serika.chat");
    expect(relayCsp("abc", [])).toContain("frame-ancestors 'none'");
  });
  test("app CSP keeps everything on the proxy except SerikaCord's API / CDN", () => {
    const csp = appCsp({ host: "1.waifu.ws", apiOrigins: ["https://serika.chat"], cdnOrigin: "https://cdn.serika.chat", ancestors: ["https://serika.chat", "https://canary.serika.chat"] });
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self' wss://1.waifu.ws https://serika.chat https://cdn.serika.chat");
    // Every ancestor is checked: the relay (self) AND the SerikaCord page above it.
    expect(csp).toContain("frame-ancestors 'self' https://serika.chat https://canary.serika.chat");
  });
  test("no cookies or forwarding headers go upstream; no cookies come back", () => {
    const up = upstreamRequestHeaders(new Headers({ cookie: "a=b", "x-forwarded-for": "1.1.1.1", "cf-connecting-ip": "2.2.2.2", accept: "text/html", connection: "keep-alive" }), { clientIp: "9.9.9.9", publicHost: "1.waifu.ws", clientId: "1" });
    expect(up.get("cookie")).toBeNull();
    expect(up.get("cf-connecting-ip")).toBeNull();
    expect(up.get("connection")).toBeNull();
    expect(up.get("x-forwarded-for")).toBe("9.9.9.9");
    expect(up.get("accept")).toBe("text/html");
    const down = downstreamResponseHeaders(new Headers({ "set-cookie": "s=1", "content-type": "text/html", "x-frame-options": "DENY", "strict-transport-security": "max-age=1" }));
    expect(down.get("set-cookie")).toBeNull();
    expect(down.get("x-frame-options")).toBeNull();
    expect(down.get("strict-transport-security")).toBeNull();
    expect(down.get("content-type")).toBe("text/html");
  });
  test("redirects are rewritten onto mapped hosts only", () => {
    const maps = [{ prefix: "/api", target: "api.example.com" }, { prefix: "/", target: "app.example.com" }];
    const up = new URL("https://app.example.com/start");
    expect(rewriteLocation("/next", up, "https://1.waifu.ws", maps)).toBe("https://1.waifu.ws/next");
    expect(rewriteLocation("https://api.example.com/v1/x?y=1", up, "https://1.waifu.ws", maps)).toBe("https://1.waifu.ws/.proxy/api/v1/x?y=1");
    expect(rewriteLocation("https://evil.com/", up, "https://1.waifu.ws", maps)).toBeNull();
    expect(rewriteLocation("javascript:alert(1)", up, "https://1.waifu.ws", maps)).toBeNull();
  });
  test("Activity origins: https in production, http + port for *.localhost", () => {
    expect(activityOrigin("123", "waifu.ws")).toBe("https://123.waifu.ws");
    expect(activityOrigin("123", "activities.localhost", "http://localhost:3000")).toBe("http://123.activities.localhost:3000");
    expect(activityFrameSource("waifu.ws")).toBe("https://*.waifu.ws");
    expect(activityFrameSource("activities.localhost")).toBe("http://*.activities.localhost:*");
  });
});
