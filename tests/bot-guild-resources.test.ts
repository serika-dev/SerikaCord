import { describe, expect, test } from "bun:test";
import {
  applyChannelPositions,
  applyRolePositions,
  changedOverwriteBits,
  isPrunable,
  likePrefix,
  overwriteBits,
  overwriteType,
  parseBulkBan,
  parseChannelFields,
  parseChannelPositions,
  parseDeleteMessageSeconds,
  parseGuildFields,
  parseLimit,
  parseOverwrites,
  parsePruneOptions,
  parseRoleFields,
  parseRolePositions,
} from "@/lib/botapi/guildResources";
import { FormErrors } from "@/lib/botapi/formErrors";
import { decodeImageDataUri, sniffImage } from "@/lib/botapi/imageData";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const pngUri = `data:image/png;base64,${PNG.toString("base64")}`;

describe("channel bodies", () => {
  test("create requires a name and maps Discord types", () => {
    const missing = parseChannelFields({ type: 0 }, null);
    expect(missing.errors.ok).toBe(false);
    expect(missing.errors.toBody().errors.name).toBeDefined();

    const voice = parseChannelFields({ name: "talk", type: 2, bitrate: 96000, user_limit: 10, topic: "ignored" }, null);
    expect(voice.errors.ok).toBe(true);
    expect(voice.fields).toEqual({ name: "talk", type: "voice", bitrate: 96000, userLimit: 10 });

    expect(parseChannelFields({ name: "x", type: 11 }, null).errors.ok).toBe(false); // threads: thread routes
  });

  test("limits match Discord", () => {
    const r = parseChannelFields({ name: "a", rate_limit_per_user: 21601, topic: "t".repeat(1025) }, null);
    const tree = r.errors.toBody().errors;
    expect(tree.rate_limit_per_user).toBeDefined();
    expect(tree.topic).toBeDefined();
    expect(parseChannelFields({ name: "a".repeat(101) }, null).errors.ok).toBe(false);
    expect(parseChannelFields({ name: "v", type: 2, user_limit: 100 }, null).errors.ok).toBe(false);
  });

  test("only text <-> announcement conversions on edit", () => {
    expect(parseChannelFields({ type: 5 }, { type: "text" }).fields.type).toBe("announcement");
    expect(parseChannelFields({ type: 2 }, { type: "text" }).errors.ok).toBe(false);
    // Same type: no change, no error.
    const same = parseChannelFields({ type: 0 }, { type: "text" });
    expect(same.errors.ok).toBe(true);
    expect(same.fields.type).toBeUndefined();
  });

  test("categories cannot have a parent; null clears it", () => {
    expect(parseChannelFields({ name: "c", type: 4, parent_id: "abc" }, null).errors.ok).toBe(false);
    expect(parseChannelFields({ parent_id: null }, { type: "text" }).fields.parentId).toBeNull();
  });

  test("name and topic go through the cleaner", () => {
    const r = parseChannelFields({ name: "<b>x</b>", topic: "<i>y</i>" }, null, { clean: (s) => s.replace(/<[^>]+>/g, "") });
    expect(r.fields.name).toBe("x");
    expect(r.fields.topic).toBe("y");
  });

  test("lock_permissions only on edit", () => {
    expect(parseChannelFields({ name: "x", lock_permissions: true }, null).fields.lockPermissions).toBeUndefined();
    expect(parseChannelFields({ lock_permissions: true }, { type: "text" }).fields.lockPermissions).toBe(true);
  });
});

describe("permission overwrites", () => {
  test("Discord and Serika types, bitfields as strings or numbers", () => {
    const e = new FormErrors();
    const list = parseOverwrites([
      { id: "r1", type: 0, allow: "1024", deny: 0 },
      { id: "u1", type: "1", allow: 2048 },
      { id: "r1", type: 0, allow: "1" }, // duplicate target dropped
    ], e);
    expect(e.ok).toBe(true);
    expect(list).toEqual([
      { id: "r1", type: "role", allow: "1024", deny: "0" },
      { id: "u1", type: "member", allow: "2048", deny: "0" },
    ]);
  });

  test("bad entries give an errors tree with indexes", () => {
    const e = new FormErrors();
    expect(parseOverwrites([{ id: "x", type: 7 }, { type: 0 }, { id: "y", type: 0, allow: "-1" }], e)).toBeNull();
    const tree = e.toBody().errors.permission_overwrites as Record<string, Record<string, unknown>>;
    expect(tree["0"].type).toBeDefined();
    expect(tree["1"].id).toBeDefined();
    expect(tree["2"].allow).toBeDefined();
  });

  test("at most 100", () => {
    const e = new FormErrors();
    expect(parseOverwrites(Array.from({ length: 101 }, (_, i) => ({ id: `r${i}`, type: 0 })), e)).toBeNull();
  });

  test("overwriteType", () => {
    expect(overwriteType(0)).toBe("role");
    expect(overwriteType("member")).toBe("member");
    expect(overwriteType(2)).toBeNull();
  });

  test("bits a bot must hold: everything set, or only what changed", () => {
    expect(overwriteBits([{ allow: "1024", deny: "2048" }, { allow: "1", deny: "0" }])).toBe(1024n | 2048n | 1n);
    const before = [{ id: "r", type: "role" as const, allow: "1024", deny: "8" }];
    const after = [{ id: "R", type: "role" as const, allow: "1024", deny: "0" }, { id: "u", type: "member" as const, allow: "16", deny: "0" }];
    // Removing deny 8 and adding allow 16; the untouched 1024 isn't needed.
    expect(changedOverwriteBits(before, after)).toBe(8n | 16n);
    expect(changedOverwriteBits(before, before)).toBe(0n);
  });
});

describe("positions", () => {
  const roles = [
    { id: "everyone", position: 0, isDefault: true },
    { id: "a", position: 1 },
    { id: "b", position: 2 },
    { id: "c", position: 3 },
    { id: "d", position: 4 },
  ];
  const pos = (m: Map<string, number>) => Object.fromEntries([...m.entries()].sort());

  test("moving a role up lands exactly on the requested position", () => {
    const r = applyRolePositions(roles, [{ id: "a", position: 3 }]);
    expect(pos(r.positions)).toEqual({ a: 3, b: 1, c: 2, d: 4 });
    expect(r.orderedHighestFirst).toEqual(["d", "a", "c", "b"]);
  });

  test("moving a role down too", () => {
    const r = applyRolePositions(roles, [{ id: "d", position: 2 }]);
    expect(pos(r.positions)).toEqual({ a: 1, b: 3, c: 4, d: 2 });
  });

  test("gaps are renumbered 1..N and @everyone is left alone", () => {
    const r = applyRolePositions([{ id: "e", position: 0, isDefault: true }, { id: "x", position: 7 }, { id: "y", position: 3 }], []);
    expect(pos(r.positions)).toEqual({ x: 2, y: 1 });
  });

  test("channel siblings per parent, renumbered from 0", () => {
    const chans = [
      { id: "cat", type: "category", position: 0, parentId: null },
      { id: "t1", type: "text", position: 0, parentId: "cat" },
      { id: "t2", type: "text", position: 1, parentId: "cat" },
      { id: "t3", type: "text", position: 5, parentId: null },
    ];
    const r = applyChannelPositions(chans, [{ id: "t2", position: 0 }]);
    expect(r.get("t2")).toEqual({ position: 0, parentId: "cat" });
    expect(r.get("t1")).toEqual({ position: 1, parentId: "cat" });
    expect(r.get("t3")).toEqual({ position: 0, parentId: null });
    expect(r.has("cat")).toBe(false);
    const moved = applyChannelPositions(chans, [{ id: "t3", parentId: "cat", position: 0 }]);
    expect(moved.get("t3")).toEqual({ position: 0, parentId: "cat" });
  });

  test("position bodies", () => {
    expect(parseChannelPositions([{ id: "1", position: 2, parent_id: null, lock_permissions: true }]).updates)
      .toEqual([{ id: "1", position: 2, parentId: null, lockPermissions: true }]);
    expect(parseChannelPositions({}).errors.ok).toBe(false);
    expect(parseChannelPositions([{ id: "1" }, { id: "1" }]).errors.ok).toBe(false);
    expect(parseRolePositions([{ id: "9", position: "3" }]).updates).toEqual([{ id: "9", position: 3 }]);
    expect(parseRolePositions([{ position: 1 }]).errors.ok).toBe(false);
  });
});

describe("guild and role bodies", () => {
  test("enums by Discord number", () => {
    const r = parseGuildFields({ verification_level: 4, explicit_content_filter: 2, default_message_notifications: 0, afk_timeout: 900 });
    expect(r.errors.ok).toBe(true);
    expect(r.fields).toEqual({ verificationLevel: "very_high", explicitContentFilter: "all_members", defaultNotifications: "all_messages", afkTimeout: 900 });
    expect(parseGuildFields({ verification_level: 9 }).errors.ok).toBe(false);
    expect(parseGuildFields({ afk_timeout: 61 }).errors.ok).toBe(false);
  });

  test("images must be data URIs (no arbitrary URLs); null removes", () => {
    expect(parseGuildFields({ icon: "https://evil.example/x.png" }).errors.ok).toBe(false);
    expect(parseGuildFields({ icon: null }).fields.icon).toBeNull();
    expect(parseGuildFields({ banner: pngUri }).fields.banner).toBe(pngUri);
  });

  test("guild name 2..100, channel refs and owner", () => {
    expect(parseGuildFields({ name: "a" }).errors.ok).toBe(false);
    const r = parseGuildFields({ system_channel_id: "5", rules_channel_id: null, owner_id: 7 });
    expect(r.fields).toEqual({ systemChannelId: "5", rulesChannelId: null, ownerId: "7" });
  });

  test("roles: colors.primary_color wins, permissions as bigint, icon data only", () => {
    const r = parseRoleFields({ name: "mods", color: 1, colors: { primary_color: 0xff0000 }, permissions: "8", hoist: true });
    expect(r.errors.ok).toBe(true);
    expect(r.fields).toEqual({ name: "mods", color: 0xff0000, permissions: 8n, hoist: true });
    expect(parseRoleFields({ color: 0x1000000 }).errors.ok).toBe(false);
    expect(parseRoleFields({ permissions: "0x8" }).errors.ok).toBe(false);
    expect(parseRoleFields({ icon: "https://x/y.png" }).errors.ok).toBe(false);
    expect(parseRoleFields({ icon: null, unicode_emoji: null }).fields).toEqual({ icon: null, unicodeEmoji: null });
    expect(parseRoleFields(null).errors.ok).toBe(true);
  });
});

describe("members, bans, prune", () => {
  test("limit defaults and bounds", () => {
    expect(parseLimit(undefined, 1, 1000)).toBe(1);
    expect(parseLimit("1000", 1, 1000)).toBe(1000);
    expect(parseLimit("0", 1, 1000)).toBeNull();
    expect(parseLimit("abc", 1, 1000)).toBeNull();
  });

  test("delete_message_seconds and the deprecated days", () => {
    const e = new FormErrors();
    expect(parseDeleteMessageSeconds({ delete_message_seconds: 3600 }, e)).toBe(3600);
    expect(parseDeleteMessageSeconds({ delete_message_days: 2 }, e)).toBe(172800);
    expect(parseDeleteMessageSeconds({}, e)).toBe(0);
    expect(e.ok).toBe(true);
    parseDeleteMessageSeconds({ delete_message_seconds: 604801 }, e);
    expect(e.ok).toBe(false);
  });

  test("bulk ban: 1..200 distinct ids", () => {
    expect(parseBulkBan({ user_ids: ["A", "a", "b"] }).userIds).toEqual(["a", "b"]);
    expect(parseBulkBan({ user_ids: [] }).errors.ok).toBe(false);
    expect(parseBulkBan({ user_ids: Array.from({ length: 201 }, (_, i) => String(i)) }).errors.ok).toBe(false);
    expect(parseBulkBan({}).errors.ok).toBe(false);
  });

  test("prune options", () => {
    expect(parsePruneOptions({ days: "14", include_roles: "1,2" }, "GET").options).toEqual({ days: 14, includeRoles: ["1", "2"], computeCount: true });
    expect(parsePruneOptions({ days: 31 }, "POST").errors.ok).toBe(false);
    expect(parsePruneOptions({ compute_prune_count: false }, "POST").options.computeCount).toBe(false);
  });

  test("who is prunable", () => {
    const now = Date.UTC(2026, 9, 16);
    const old = new Date(now - 10 * 86_400_000);
    const base = { roles: ["everyone"], isBot: false, isOwner: false, lastSeenAt: old };
    const opts = { days: 7, includeRoles: [] as string[], everyoneRoleId: "everyone", now };
    expect(isPrunable(base, opts)).toBe(true);
    expect(isPrunable({ ...base, lastSeenAt: new Date(now - 86_400_000) }, opts)).toBe(false);
    expect(isPrunable({ ...base, roles: ["everyone", "r1"] }, opts)).toBe(false);
    expect(isPrunable({ ...base, roles: ["everyone", "R1"] }, { ...opts, includeRoles: ["r1"] })).toBe(true);
    expect(isPrunable({ ...base, isBot: true }, opts)).toBe(false);
    expect(isPrunable({ ...base, isOwner: true }, opts)).toBe(false);
  });

  test("search prefix escapes LIKE wildcards", () => {
    expect(likePrefix("a%b_c\\")).toBe("a\\%b\\_c\\\\%");
  });
});

describe("image data", () => {
  test("sniffs real types and rejects mismatches", () => {
    expect(sniffImage(PNG)).toBe("image/png");
    expect(decodeImageDataUri(pngUri, 1024).ok).toBe(true);
    // Declared as GIF but the bytes are PNG.
    expect(decodeImageDataUri(`data:image/gif;base64,${PNG.toString("base64")}`, 1024).ok).toBe(false);
    expect(decodeImageDataUri("data:image/svg+xml;base64,PHN2Zz4=", 1024).ok).toBe(false);
    expect(decodeImageDataUri("https://example.com/a.png", 1024).ok).toBe(false);
  });

  test("size limit", () => {
    expect(decodeImageDataUri(pngUri, 4).ok).toBe(false);
  });
});
