import { describe, expect, test } from "bun:test";
import {
  DEFAULT_ACTIVITY_SETTINGS,
  clientIdFromActivityHost,
  isActivitiesHost,
  isIpLiteral,
  normalizePrefix,
  normalizeTarget,
  resolveUrlMapping,
  settingsFromRow,
  validateActivitySettingsPatch,
  validateUrlMappings,
} from "@/lib/activities/settings";

describe("normalizePrefix", () => {
  test("accepts root and simple prefixes, trims trailing slashes", () => {
    expect(normalizePrefix("/")).toEqual({ ok: true, prefix: "/", tokens: [] });
    expect(normalizePrefix("api/")).toEqual({ ok: true, prefix: "/api", tokens: [] });
    expect(normalizePrefix("/google/{subdomain}")).toEqual({ ok: true, prefix: "/google/{subdomain}", tokens: ["subdomain"] });
  });
  test("rejects dot segments, empty segments, odd characters and reserved paths", () => {
    expect(normalizePrefix("/a/../b").ok).toBe(false);
    expect(normalizePrefix("/a//b").ok).toBe(false);
    expect(normalizePrefix("/a b").ok).toBe(false);
    expect(normalizePrefix("/.serika").ok).toBe(false);
    expect(normalizePrefix("/.proxy/api").ok).toBe(false);
    expect(normalizePrefix("/{a}/{a}").ok).toBe(false);
    expect(normalizePrefix("").ok).toBe(false);
    expect(normalizePrefix(42).ok).toBe(false);
  });
});

describe("normalizeTarget", () => {
  test("accepts hosts, ports and directory paths", () => {
    expect(normalizeTarget("Example.com/", [])).toEqual({ ok: true, target: "example.com" });
    expect(normalizeTarget("api.example.com:8443/v2/", [])).toEqual({ ok: true, target: "api.example.com:8443/v2" });
    expect(normalizeTarget("{subdomain}.google.com", ["subdomain"])).toEqual({ ok: true, target: "{subdomain}.google.com" });
  });
  test("rejects protocols, IPs, internal names and loops to the Activities domain", () => {
    expect(normalizeTarget("https://example.com", []).ok).toBe(false);
    expect(normalizeTarget("127.0.0.1", []).ok).toBe(false);
    expect(normalizeTarget("[::1]", []).ok).toBe(false);
    expect(normalizeTarget("2130706433", []).ok).toBe(false);
    expect(normalizeTarget("localhost", []).ok).toBe(false);
    expect(normalizeTarget("redis.internal", []).ok).toBe(false);
    expect(normalizeTarget("db.local", []).ok).toBe(false);
    expect(normalizeTarget("user@example.com", []).ok).toBe(false);
    expect(normalizeTarget("example.com?x=1", []).ok).toBe(false);
    expect(normalizeTarget("1.serika.games", [], { blockedHosts: ["serika.games"] }).ok).toBe(false);
    expect(normalizeTarget("123-abcdef12.serika.games", [], { blockedHosts: ["serika.games"] }).ok).toBe(false);
    expect(normalizeTarget("serika.games", [], { blockedHosts: ["serika.games"] }).ok).toBe(false);
    expect(normalizeTarget("{id}.serika.games", ["id"], { blockedHosts: ["serika.games"] }).ok).toBe(false);
    // Other names under the Activities domain are ordinary upstreams (doodle.waifu.ws).
    expect(normalizeTarget("doodle.serika.games", [], { blockedHosts: ["serika.games"] })).toEqual({ ok: true, target: "doodle.serika.games" });
    expect(normalizeTarget("example.com:0", []).ok).toBe(false);
  });
  test("parameters must come from the prefix and stay in the host", () => {
    expect(normalizeTarget("{sub}.google.com", []).ok).toBe(false);
    expect(normalizeTarget("google.{tld}", ["tld"]).ok).toBe(false);
    expect(normalizeTarget("{a}.{b}", ["a", "b"]).ok).toBe(false);
    expect(normalizeTarget("example.com/{x}", ["x"]).ok).toBe(false);
    expect(normalizeTarget("example.com/a/../b", []).ok).toBe(false);
  });
  test("isIpLiteral", () => {
    expect(isIpLiteral("10.0.0.1")).toBe(true);
    expect(isIpLiteral("0x7f.1")).toBe(true);
    expect(isIpLiteral("fe80::1")).toBe(true);
    expect(isIpLiteral("123.example.com")).toBe(false);
  });
});

describe("validateUrlMappings", () => {
  test("requires a root mapping when enabled and rejects duplicates", () => {
    const noRoot = validateUrlMappings([{ prefix: "/api", target: "api.example.com" }], { requireRoot: true });
    expect(noRoot.ok).toBe(false);
    const dup = validateUrlMappings([{ prefix: "/", target: "a.com" }, { prefix: "/", target: "b.com" }]);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.errors[0].index).toBe(1);
  });
  test("root mapping can't use parameters; errors carry index + field", () => {
    const res = validateUrlMappings([{ prefix: "/x/{a}", target: "{a}.example.com" }, { prefix: "/", target: "example.com" }, { prefix: "/bad", target: "http://x.com" }]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.map((e) => [e.index, e.field])).toEqual([[2, "target"]]);
  });
  test("warns when a shorter prefix shadows a later one", () => {
    const res = validateUrlMappings([
      { prefix: "/", target: "app.example.com" },
      { prefix: "/foo", target: "foo.com" },
      { prefix: "/foo/bar", target: "bar.com" },
    ]);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.warnings.map((w) => w.index)).toEqual([2]);
  });
  test("caps the list size", () => {
    const many = Array.from({ length: 31 }, (_, i) => ({ prefix: `/p${i}`, target: "example.com" }));
    expect(validateUrlMappings(many).ok).toBe(false);
    expect(validateUrlMappings("nope").ok).toBe(false);
  });
});

describe("resolveUrlMapping", () => {
  const mappings = [
    { prefix: "/api", target: "api.example.com/v2" },
    { prefix: "/google/{subdomain}", target: "{subdomain}.google.com" },
    { prefix: "/", target: "app.example.com" },
  ];
  test("root serves the app; /.proxy and plain paths resolve the same", () => {
    expect(resolveUrlMapping(mappings, "/")).toMatchObject({ host: "app.example.com", path: "/" });
    expect(resolveUrlMapping(mappings, "/index.js")).toMatchObject({ host: "app.example.com", path: "/index.js" });
    expect(resolveUrlMapping(mappings, "/.proxy/api/token")).toMatchObject({ host: "api.example.com", path: "/v2/token" });
    expect(resolveUrlMapping(mappings, "/api/token")).toMatchObject({ host: "api.example.com", path: "/v2/token" });
    expect(resolveUrlMapping(mappings, "/api")).toMatchObject({ host: "api.example.com", path: "/v2" });
  });
  test("prefixes match whole segments only", () => {
    expect(resolveUrlMapping(mappings, "/apis/x")).toMatchObject({ host: "app.example.com", path: "/apis/x" });
  });
  test("parameters substitute into the host", () => {
    expect(resolveUrlMapping(mappings, "/google/Maps/v1/x")).toMatchObject({ host: "maps.google.com", path: "/v1/x" });
  });
  test("root mapping is tried last even when listed first", () => {
    const rootFirst = [{ prefix: "/", target: "app.example.com" }, { prefix: "/api", target: "api.example.com" }];
    expect(resolveUrlMapping(rootFirst, "/api/x")).toMatchObject({ host: "api.example.com", path: "/x" });
  });
  test("reserved paths and missing root resolve to null", () => {
    expect(resolveUrlMapping(mappings, "/.serika/frame")).toBeNull();
    expect(resolveUrlMapping(mappings, "/.proxy/.serika/frame")).toBeNull();
    expect(resolveUrlMapping([{ prefix: "/api", target: "api.example.com" }], "/x")).toBeNull();
    expect(resolveUrlMapping(mappings, "relative")).toBeNull();
  });
});

describe("validateActivitySettingsPatch", () => {
  const current = { ...DEFAULT_ACTIVITY_SETTINGS };
  test("enabling needs a root mapping (from the patch or stored)", () => {
    expect(validateActivitySettingsPatch({ enabled: true }, current).ok).toBe(false);
    const ok = validateActivitySettingsPatch({ enabled: true, urlMappings: [{ prefix: "/", target: "app.example.com" }] }, current);
    expect(ok.ok).toBe(true);
    const stored = { ...current, urlMappings: [{ prefix: "/", target: "app.example.com" }] };
    expect(validateActivitySettingsPatch({ enabled: true }, stored).ok).toBe(true);
  });
  test("removing the root mapping while enabled fails", () => {
    const on = { ...current, enabled: true, urlMappings: [{ prefix: "/", target: "app.example.com" }] };
    expect(validateActivitySettingsPatch({ urlMappings: [] }, on).ok).toBe(false);
    expect(validateActivitySettingsPatch({ enabled: false, urlMappings: [] }, on).ok).toBe(true);
  });
  test("validates platforms, orientation, name, image and participants", () => {
    const r = validateActivitySettingsPatch({
      supportedPlatforms: ["android", "web", "web"], orientationLockPhone: 2, displayName: "  Chess\u0007 ", maxParticipants: 8, imageUrl: null,
    }, current);
    expect(r).toEqual({ ok: true, warnings: [], patch: { supportedPlatforms: ["web", "android"], orientationLockPhone: 2, displayName: "Chess", maxParticipants: 8, imageUrl: null } });
    expect(validateActivitySettingsPatch({ supportedPlatforms: [] }, current).ok).toBe(false);
    expect(validateActivitySettingsPatch({ supportedPlatforms: ["xbox"] }, current).ok).toBe(false);
    expect(validateActivitySettingsPatch({ orientationLockTablet: 4 }, current).ok).toBe(false);
    expect(validateActivitySettingsPatch({ maxParticipants: 1000 }, current).ok).toBe(false);
    expect(validateActivitySettingsPatch({ imageUrl: "https://evil.example/x.png" }, current).ok).toBe(false);
    expect(validateActivitySettingsPatch({ imageUrl: "https://cdn/x.png" }, current, { isOwnedImageUrl: () => true }).ok).toBe(true);
    expect(validateActivitySettingsPatch({ enabled: "yes" }, current).ok).toBe(false);
    expect(validateActivitySettingsPatch(null, current).ok).toBe(false);
  });
});

describe("settingsFromRow / hosts", () => {
  test("falls back to defaults for junk", () => {
    expect(settingsFromRow(null)).toEqual(DEFAULT_ACTIVITY_SETTINGS);
    const s = settingsFromRow({ enabled: true, urlMappings: "x", supportedPlatforms: ["ios", "nope"], orientationLockPhone: 9 });
    expect(s.enabled).toBe(true);
    expect(s.urlMappings).toEqual([]);
    expect(s.supportedPlatforms).toEqual(["ios"]);
    expect(s.orientationLockPhone).toBe(1);
  });
  test("client id from an Activity host", () => {
    expect(clientIdFromActivityHost("1234567890.serika.games", "serika.games")).toBe("1234567890");
    expect(clientIdFromActivityHost("1234567890.Serika.Games:443", "serika.games")).toBe("1234567890");
    expect(clientIdFromActivityHost("serika.games", "serika.games")).toBeNull();
    expect(clientIdFromActivityHost("a.b.serika.games", "serika.games")).toBeNull();
    expect(clientIdFromActivityHost("123.serika.games.evil.com", "serika.games")).toBeNull();
    expect(clientIdFromActivityHost("123.activities.localhost:3000", "activities.localhost")).toBe("123");
  });
});

describe("entry point commands (validateCommand)", () => {
  // Imported lazily so this file stays focused on pure Activities rules.
  const load = () => import("@/lib/botapi/commands");
  test("type 4 is accepted globally with a default handler of 2", async () => {
    const { validateCommand, CommandType } = await load();
    const { FormErrors } = await import("@/lib/botapi/formErrors");
    const errors = new FormErrors();
    const def = validateCommand({ name: "Launch", description: "Launch Chess", type: CommandType.PRIMARY_ENTRY_POINT }, { errors });
    expect(errors.ok).toBe(true);
    expect(def).toMatchObject({ name: "Launch", type: 4, handler: 2, options: [] });
  });
  test("handler 1 is kept; bad handlers, options, missing descriptions and guild scope fail", async () => {
    const { validateCommand } = await load();
    const { FormErrors } = await import("@/lib/botapi/formErrors");
    const ok = new FormErrors();
    expect(validateCommand({ name: "launch", description: "d", type: 4, handler: 1 }, { errors: ok })?.handler).toBe(1);
    for (const [body, guildScoped] of [
      [{ name: "launch", description: "d", type: 4, handler: 3 }, false],
      [{ name: "launch", description: "d", type: 4, options: [{ type: 3, name: "x", description: "x" }] }, false],
      [{ name: "launch", type: 4 }, false],
      [{ name: "launch", description: "d", type: 4 }, true],
    ] as const) {
      const errors = new FormErrors();
      validateCommand(body, { errors, guildScoped });
      expect(errors.ok).toBe(false);
    }
  });
  test("handler is dropped on other command types; one entry point per scope", async () => {
    const { validateCommand, checkScopeLimits } = await load();
    const { FormErrors } = await import("@/lib/botapi/formErrors");
    const errors = new FormErrors();
    expect(validateCommand({ name: "roll", description: "d", type: 1, handler: 2 }, { errors })?.handler).toBeNull();
    const limits = new FormErrors();
    checkScopeLimits([{ type: 4 }, { type: 4 }], limits);
    expect(limits.ok).toBe(false);
  });
});

describe("isActivitiesHost", () => {
  test("matches the domain and its subdomains only", () => {
    expect(isActivitiesHost("waifu.ws", "waifu.ws")).toBe(true);
    expect(isActivitiesHost("123.WAIFU.ws:443", "waifu.ws")).toBe(true);
    expect(isActivitiesHost("a.b.waifu.ws", "waifu.ws")).toBe(true);
    expect(isActivitiesHost("notwaifu.ws", "waifu.ws")).toBe(false);
    expect(isActivitiesHost("canary.serika.chat", "waifu.ws")).toBe(false);
    expect(isActivitiesHost("waifu.ws", "")).toBe(false);
    expect(isActivitiesHost(null, "waifu.ws")).toBe(false);
  });
});

describe("URL-override hosts", () => {
  test("parse <client_id>[-<token>] hosts", async () => {
    const { parseActivityHost, activityHostLabel, withRootOverride } = await import("@/lib/activities/settings");
    expect(parseActivityHost("123.waifu.ws", "waifu.ws")).toEqual({ clientId: "123", overrideToken: null });
    expect(parseActivityHost("123-abcdef12.waifu.ws", "waifu.ws")).toEqual({ clientId: "123", overrideToken: "abcdef12" });
    expect(parseActivityHost("123-ab.waifu.ws", "waifu.ws")).toBeNull();
    expect(parseActivityHost("x-abcdef12.waifu.ws", "waifu.ws")).toBeNull();
    expect(clientIdFromActivityHost("123-abcdef12.waifu.ws", "waifu.ws")).toBeNull();
    expect(activityHostLabel("123", "abcdef12")).toBe("123-abcdef12");
    expect(activityHostLabel("123", "BAD!")).toBeNull();
    expect(withRootOverride([{ prefix: "/api", target: "api.x.com" }, { prefix: "/", target: "x.com" }], "dev.tunnel.com"))
      .toEqual([{ prefix: "/api", target: "api.x.com" }, { prefix: "/", target: "dev.tunnel.com" }]);
  });
});

describe("verification by players", () => {
  test("Activity apps need 100 different players instead of 100 servers", async () => {
    const { verificationRequirements, VERIFICATION_PLAYER_THRESHOLD } = await import("@/lib/appDirectory/listing");
    expect(verificationRequirements({ botId: "b" }, 0, 99).map((r) => [r.id, r.met])).toEqual([["bot", true], ["players", false]]);
    expect(verificationRequirements({ botId: "b" }, 0, VERIFICATION_PLAYER_THRESHOLD).every((r) => r.met)).toBe(true);
    expect(verificationRequirements({ botId: "b" }, 150).map((r) => r.id)).toEqual(["bot", "servers"]);
  });
});
