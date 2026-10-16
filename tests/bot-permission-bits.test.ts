import { describe, expect, test } from "bun:test";
import { ALL_PERMISSIONS, PERMISSION_BITS, type PermissionName } from "@/lib/permissions/bits";
import {
  DISCORD_BIT_OF, discordToSerika, permissionsToDiscord, permissionsToSerika, serikaToDiscord,
} from "@/lib/botapi/permissionBits";
import { fromPublicView, rewriteOutbound, toPublicView } from "@/lib/botapi/boundary";
import { parsePermissionsParam, permissionNumberingOf } from "@/lib/oauth/authorize";

/** Discord API v10 PermissionFlagsBits (discord-api-types 0.38.56), by Discord name. */
const DISCORD_V10: Record<string, bigint> = {
  CreateInstantInvite: 1n << 0n, KickMembers: 1n << 1n, BanMembers: 1n << 2n, Administrator: 1n << 3n,
  ManageChannels: 1n << 4n, ManageGuild: 1n << 5n, AddReactions: 1n << 6n, ViewAuditLog: 1n << 7n,
  PrioritySpeaker: 1n << 8n, Stream: 1n << 9n, ViewChannel: 1n << 10n, SendMessages: 1n << 11n,
  SendTTSMessages: 1n << 12n, ManageMessages: 1n << 13n, EmbedLinks: 1n << 14n, AttachFiles: 1n << 15n,
  ReadMessageHistory: 1n << 16n, MentionEveryone: 1n << 17n, UseExternalEmojis: 1n << 18n,
  ViewGuildInsights: 1n << 19n, Connect: 1n << 20n, Speak: 1n << 21n, MuteMembers: 1n << 22n,
  DeafenMembers: 1n << 23n, MoveMembers: 1n << 24n, UseVAD: 1n << 25n, ChangeNickname: 1n << 26n,
  ManageNicknames: 1n << 27n, ManageRoles: 1n << 28n, ManageWebhooks: 1n << 29n,
  ManageGuildExpressions: 1n << 30n, UseApplicationCommands: 1n << 31n, RequestToSpeak: 1n << 32n,
  ManageEvents: 1n << 33n, ManageThreads: 1n << 34n, CreatePublicThreads: 1n << 35n,
  CreatePrivateThreads: 1n << 36n, UseExternalStickers: 1n << 37n, SendMessagesInThreads: 1n << 38n,
  UseEmbeddedActivities: 1n << 39n, ModerateMembers: 1n << 40n, ViewCreatorMonetizationAnalytics: 1n << 41n,
  UseSoundboard: 1n << 42n, CreateGuildExpressions: 1n << 43n, CreateEvents: 1n << 44n,
  UseExternalSounds: 1n << 45n, SendVoiceMessages: 1n << 46n, SetVoiceChannelStatus: 1n << 48n,
  SendPolls: 1n << 49n, UseExternalApps: 1n << 50n, PinMessages: 1n << 51n, BypassSlowmode: 1n << 52n,
};

/** Serika name -> Discord name (only where they differ in spelling). */
const DISCORD_NAME: Partial<Record<PermissionName, string>> = {
  CREATE_INVITE: "CreateInstantInvite", MANAGE_SERVER: "ManageGuild", VIDEO: "Stream",
  VIEW_SERVER_INSIGHTS: "ViewGuildInsights", USE_VOICE_ACTIVITY: "UseVAD",
  MANAGE_EMOJIS_AND_STICKERS: "ManageGuildExpressions", CREATE_EXPRESSIONS: "CreateGuildExpressions",
  SEND_TTS_MESSAGES: "SendTTSMessages",
};
const pascal = (n: string) => n.toLowerCase().replace(/(^|_)([a-z])/g, (_, __, c: string) => c.toUpperCase());
const discordNameOf = (n: PermissionName) => DISCORD_NAME[n] ?? pascal(n);

/** Deterministic PRNG (tests must not be flaky). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s; };
}
function randomBitfield(next: () => number): bigint {
  // 64 random bits.
  return (BigInt(next()) << 32n) | BigInt(next());
}

describe("permission bit table", () => {
  test("every Serika flag has its Discord v10 number", () => {
    for (const name of Object.keys(PERMISSION_BITS) as PermissionName[]) {
      const discord = DISCORD_V10[discordNameOf(name)];
      expect([name, typeof discord]).toEqual([name, "bigint"]);
      expect([name, DISCORD_BIT_OF[name]]).toEqual([name, discord]);
    }
  });

  test("the mismatches are exactly bits 42-46", () => {
    const mismatched = (Object.keys(PERMISSION_BITS) as PermissionName[])
      .filter((n) => PERMISSION_BITS[n] !== DISCORD_BIT_OF[n])
      .sort();
    expect(mismatched).toEqual(["CREATE_EVENTS", "CREATE_EXPRESSIONS", "SEND_VOICE_MESSAGES", "USE_EXTERNAL_SOUNDS", "USE_SOUNDBOARD"]);
  });

  test("Discord numbers are unique (the mapping is a bijection)", () => {
    const values = Object.values(DISCORD_BIT_OF);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("serikaToDiscord / discordToSerika", () => {
  test("each mismatched flag maps to Discord's bit and back", () => {
    const cases: Array<[PermissionName, bigint]> = [
      ["USE_EXTERNAL_SOUNDS", 1n << 45n],
      ["SEND_VOICE_MESSAGES", 1n << 46n],
      ["USE_SOUNDBOARD", 1n << 42n],
      ["CREATE_EXPRESSIONS", 1n << 43n],
      ["CREATE_EVENTS", 1n << 44n],
    ];
    for (const [name, discord] of cases) {
      expect(serikaToDiscord(PERMISSION_BITS[name])).toBe(discord);
      expect(discordToSerika(discord)).toBe(PERMISSION_BITS[name]);
      expect(serikaToDiscord(PERMISSION_BITS[name].toString())).toBe(discord.toString());
      expect(discordToSerika(discord.toString())).toBe(PERMISSION_BITS[name].toString());
    }
    expect(discordToSerika(DISCORD_V10.CreateEvents)).toBe(PERMISSION_BITS.CREATE_EVENTS);
  });

  test("every Serika flag lands on its Discord flag", () => {
    for (const name of Object.keys(PERMISSION_BITS) as PermissionName[]) {
      expect(serikaToDiscord(PERMISSION_BITS[name])).toBe(DISCORD_V10[discordNameOf(name)]);
    }
  });

  test("round trips over random bitfields (both directions)", () => {
    const next = rng(42);
    for (let i = 0; i < 5000; i++) {
      const b = randomBitfield(next);
      expect(discordToSerika(serikaToDiscord(b))).toBe(b);
      expect(serikaToDiscord(discordToSerika(b))).toBe(b);
      expect(discordToSerika(serikaToDiscord(b.toString()))).toBe(b.toString());
      // A permutation keeps the number of set bits.
      const pop = (x: bigint) => x.toString(2).split("").filter((c) => c === "1").length;
      expect(pop(serikaToDiscord(b))).toBe(pop(b));
    }
  });

  test("ALL_PERMISSIONS stays a full set and administrator is untouched", () => {
    const all = serikaToDiscord(ALL_PERMISSIONS);
    expect(discordToSerika(all)).toBe(ALL_PERMISSIONS);
    expect(serikaToDiscord("8")).toBe("8");
  });

  test("unknown and unmoved bits pass through unchanged", () => {
    for (const bit of [41n, 47n, 52n, 53n, 60n, 63n, 70n, 0n, 10n, 40n, 48n, 51n]) {
      const v = 1n << bit;
      expect(serikaToDiscord(v)).toBe(v);
      expect(discordToSerika(v)).toBe(v);
    }
    const huge = (1n << 100n) | (1n << 42n);
    expect(serikaToDiscord(huge)).toBe((1n << 100n) | (1n << 45n));
  });

  test("non-bitfield strings are left alone", () => {
    for (const v of ["", "abc", "-8", "1.5", " 8", "0x10", "1".repeat(41)]) {
      expect(serikaToDiscord(v)).toBe(v);
      expect(discordToSerika(v)).toBe(v);
    }
    // Unchanged values keep their exact spelling.
    expect(serikaToDiscord("0008")).toBe("0008");
  });
});

describe("payload transforms", () => {
  const S_EVENTS = PERMISSION_BITS.CREATE_EVENTS.toString(); // 1 << 46
  const D_EVENTS = (1n << 44n).toString();

  test("only permission keys change", () => {
    const payload = {
      id: S_EVENTS, // not a permission key
      position: 3,
      permissions: S_EVENTS,
      flags: Number(1n << 43n),
      color: S_EVENTS,
      permission_overwrites: [{ id: "x", type: 0, allow: S_EVENTS, deny: "0" }],
      nested: { app_permissions: S_EVENTS, default_member_permissions: null },
    };
    const out = permissionsToDiscord(payload);
    expect(out.id).toBe(S_EVENTS);
    expect(out.color).toBe(S_EVENTS);
    expect(out.flags).toBe(Number(1n << 43n));
    expect(out.permissions).toBe(D_EVENTS);
    expect(out.permission_overwrites[0].allow).toBe(D_EVENTS);
    expect(out.permission_overwrites[0].deny).toBe("0");
    expect(out.nested.app_permissions).toBe(D_EVENTS);
    expect(out.nested.default_member_permissions).toBeNull();
    // Input untouched (copy on write).
    expect(payload.permissions).toBe(S_EVENTS);
  });

  test("arrays named permissions and free-form subtrees are not bitfields", () => {
    const payload = {
      permissions: [{ id: "r", type: 1, permission: true }], // command permissions v2
      team: { members: [{ permissions: ["*"] }] },
      embeds: [{ fields: [{ name: "permissions", value: S_EVENTS }], permissions: S_EVENTS }],
      metadata: { permissions: S_EVENTS },
      components: [{ permissions: S_EVENTS }],
      options: [{ name: "permissions", value: S_EVENTS, permissions: S_EVENTS }],
      content: "permissions: 70368744177664",
    };
    const out = permissionsToDiscord(payload);
    expect(out).toEqual(payload);
    expect(out).toBe(payload); // nothing changed: same reference
  });

  test("audit log changes on permission keys", () => {
    const entry = {
      changes: [
        { key: "permissions", old_value: "0", new_value: S_EVENTS },
        { key: "name", old_value: S_EVENTS, new_value: S_EVENTS },
      ],
    };
    const out = permissionsToDiscord(entry);
    expect(out.changes[0].new_value).toBe(D_EVENTS);
    expect(out.changes[1]).toEqual(entry.changes[1]);
  });

  test("JSON numbers convert and stay numbers when safe", () => {
    const out = permissionsToSerika({ permissions: Number(1n << 44n), allow: 8 });
    expect(out.permissions).toBe(Number(1n << 46n));
    expect(out.allow).toBe(8);
  });

  test("__proto__ keys stay plain data", () => {
    const body = JSON.parse(`{"__proto__":{"permissions":"${D_EVENTS}"},"permissions":"${D_EVENTS}"}`);
    const out = permissionsToSerika(body) as Record<string, unknown>;
    expect(out.permissions).toBe(S_EVENTS);
    expect(({} as Record<string, unknown>).permissions).toBeUndefined();
  });
});

describe("boundary transforms (snowflake-format view)", () => {
  const U = (n: number) => `0b7c1d1e-1111-4a2b-9c3d-${n.toString(16).padStart(12, "0")}`;
  const ROLE = U(1), GUILD = U(2), CHANNEL = U(3), USER = U(4);
  const SF: Record<string, string> = { [ROLE]: "1100000000000000001", [GUILD]: "1100000000000000002", [CHANNEL]: "1100000000000000003", [USER]: "1100000000000000004" };
  const lookup = { get: (u: string) => SF[u] };
  const P = PERMISSION_BITS;

  test("GUILD_CREATE-like payload: ids become snowflakes, bits become Discord's", () => {
    const serikaRole = (P.CREATE_EVENTS | P.USE_SOUNDBOARD | P.SEND_MESSAGES).toString();
    const discordRole = ((1n << 44n) | (1n << 42n) | (1n << 11n)).toString();
    const d = {
      id: GUILD,
      roles: [{ id: ROLE, name: "events", permissions: serikaRole, color: 0 }],
      channels: [{ id: CHANNEL, permission_overwrites: [{ id: ROLE, type: 0, allow: P.SEND_VOICE_MESSAGES.toString(), deny: P.CREATE_EXPRESSIONS.toString() }] }],
      members: [{ user: { id: USER }, roles: [ROLE], joined_at: "2026-01-01T00:00:00Z" }],
    };
    const out = toPublicView(rewriteOutbound(d, lookup));
    expect(out.id).toBe(SF[GUILD]);
    expect(out.roles[0].id).toBe(SF[ROLE]);
    expect(out.roles[0].permissions).toBe(discordRole);
    expect(out.channels[0].permission_overwrites[0]).toEqual({ id: SF[ROLE], type: 0, allow: (1n << 46n).toString(), deny: (1n << 43n).toString() });
    expect(out.members[0].roles).toEqual([SF[ROLE]]);
  });

  test("interaction payload: member, resolved and app permissions", () => {
    const perms = (P.USE_EXTERNAL_SOUNDS | P.ADMINISTRATOR).toString();
    const interaction = {
      id: U(9), application_id: U(10), type: 2, token: "tok",
      app_permissions: perms,
      member: { user: { id: USER }, permissions: perms, roles: [], joined_at: "2026-01-01T00:00:00Z" },
      data: {
        resolved: { members: { [USER]: { permissions: perms } }, channels: { [CHANNEL]: { id: CHANNEL, permissions: perms } } },
        options: [{ name: "role", type: 8, value: ROLE }],
      },
    };
    const out = toPublicView(rewriteOutbound(interaction, lookup)) as typeof interaction;
    const want = ((1n << 45n) | (1n << 3n)).toString();
    expect(out.app_permissions).toBe(want);
    expect(out.member.permissions).toBe(want);
    expect(out.data.resolved.members[SF[USER]].permissions).toBe(want);
    expect(out.data.resolved.channels[SF[CHANNEL]].permissions).toBe(want);
    expect(out.data.options[0].value).toBe(SF[ROLE]);
  });

  test("application + command shapes", () => {
    const app = {
      install_params: { scopes: ["bot"], permissions: P.CREATE_EVENTS.toString() },
      integration_types_config: { "0": { oauth2_install_params: { scopes: ["bot"], permissions: P.CREATE_EVENTS.toString() } } },
      team: { members: [{ permissions: ["*"] }] },
    };
    const out = toPublicView(app);
    expect(out.install_params.permissions).toBe((1n << 44n).toString());
    expect(out.integration_types_config["0"].oauth2_install_params.permissions).toBe((1n << 44n).toString());
    expect(out.team.members[0].permissions).toEqual(["*"]);
    const cmds = toPublicView([{ name: "ev", default_member_permissions: P.CREATE_EVENTS.toString(), options: [] }, { name: "x", default_member_permissions: null }]);
    expect(cmds[0].default_member_permissions).toBe((1n << 44n).toString());
    expect(cmds[1].default_member_permissions).toBeNull();
  });

  test("inbound bodies: role create, overwrite PUT, channel PATCH, bulk commands, application PATCH", () => {
    const D = (b: bigint) => (1n << b).toString();
    expect(fromPublicView({ name: "r", permissions: D(44n), color: 5 })).toEqual({ name: "r", permissions: P.CREATE_EVENTS.toString(), color: 5 });
    expect(fromPublicView({ type: 0, allow: D(42n), deny: D(45n) })).toEqual({ type: 0, allow: P.USE_SOUNDBOARD.toString(), deny: P.USE_EXTERNAL_SOUNDS.toString() });
    expect(fromPublicView({ permission_overwrites: [{ id: "1", type: 1, allow: D(46n), deny: D(43n) }] }))
      .toEqual({ permission_overwrites: [{ id: "1", type: 1, allow: P.SEND_VOICE_MESSAGES.toString(), deny: P.CREATE_EXPRESSIONS.toString() }] });
    expect(fromPublicView([{ name: "a", default_member_permissions: D(44n) }])).toEqual([{ name: "a", default_member_permissions: P.CREATE_EVENTS.toString() }]);
    expect(fromPublicView({ install_params: { scopes: ["bot"], permissions: D(43n) } }))
      .toEqual({ install_params: { scopes: ["bot"], permissions: P.CREATE_EXPRESSIONS.toString() } });
    // Discord-only bits survive the round trip.
    expect(fromPublicView({ permissions: D(52n) })).toEqual({ permissions: D(52n) });
  });

  test("Serika -> Discord -> Serika through the boundary is the identity", () => {
    const next = rng(7);
    for (let i = 0; i < 500; i++) {
      const bits = (randomBitfield(next) & ALL_PERMISSIONS).toString();
      const role = { id: ROLE, permissions: bits };
      const out = toPublicView(rewriteOutbound(role, lookup));
      expect(fromPublicView({ permissions: out.permissions }).permissions).toBe(bits);
    }
  });
});

describe("OAuth2 authorize permissions", () => {
  test("snowflake-format apps read the URL with Discord numbers", () => {
    expect(permissionNumberingOf({ apiIdFormat: "snowflake" })).toBe("discord");
    expect(permissionNumberingOf({ apiIdFormat: null })).toBe("serika");
    expect(permissionNumberingOf(null)).toBe("serika");
    const url = ((1n << 44n) | 8n).toString();
    expect(parsePermissionsParam(url, "discord")).toBe(P_EVENTS | 8n);
    expect(parsePermissionsParam(url, "serika")).toBe((1n << 44n) | 8n); // legacy: USE_SOUNDBOARD
    // Discord-only bits are dropped (Serika can't grant them).
    expect(parsePermissionsParam((1n << 52n).toString(), "discord")).toBe(0n);
    expect(parsePermissionsParam("-1", "discord")).toBeNull();
  });
});

const P_EVENTS = PERMISSION_BITS.CREATE_EVENTS;
