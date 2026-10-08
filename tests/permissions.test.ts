import { describe, expect, test } from "bun:test";
import {
  ALL_PERMISSIONS,
  PERMISSION_BITS,
  hasAnyPermission,
  hasPermission,
} from "@/lib/permissions/bits";
import {
  hasPermissionBit,
  parsePermissionBitfield,
  setPermissionBit,
  stringifyPermissionBitfield,
} from "@/lib/roles/bitfield";
import { PERMISSIONS, bitfieldHas } from "@/lib/roles/permissions";
import { canSendInChannel, canViewChannel } from "@/lib/roles/channelPermissions";
import { ROLE_PERMISSION_CATEGORIES } from "@/lib/constants/rolePermissions";
import {
  DEFAULT_EVERYONE_PERMISSIONS,
  applyChannelOverwrites,
  computeChannelPermissions,
  hasBit,
} from "@/lib/permissions/channelOverwrites";

const P = PERMISSION_BITS;

describe("PERMISSION_BITS", () => {
  test("every flag is a single, unique bit", () => {
    const values = Object.values(P);
    expect(new Set(values).size).toBe(values.length);
    for (const bit of values) {
      expect(bit > 0n).toBeTrue();
      expect(bit & (bit - 1n)).toBe(0n); // power of two
    }
  });

  test("bit numbers match Discord so bitfields are interchangeable", () => {
    expect(P.CREATE_INVITE).toBe(1n);
    expect(P.ADMINISTRATOR).toBe(8n);
    expect(P.VIEW_CHANNEL).toBe(1024n);
    expect(P.SEND_MESSAGES).toBe(2048n);
    expect(P.MANAGE_MESSAGES).toBe(8192n);
    expect(P.MENTION_EVERYONE).toBe(1n << 17n);
    expect(P.MANAGE_ROLES).toBe(1n << 28n);
    expect(P.MODERATE_MEMBERS).toBe(1n << 40n);
    expect(P.PIN_MESSAGES).toBe(1n << 51n);
  });

  test("ALL_PERMISSIONS contains every flag", () => {
    for (const bit of Object.values(P)) {
      expect(ALL_PERMISSIONS & bit).toBe(bit);
    }
  });
});

describe("hasPermission / hasAnyPermission", () => {
  test("a granted bit passes, a missing bit fails", () => {
    const bitfield = P.SEND_MESSAGES | P.VIEW_CHANNEL;
    expect(hasPermission(bitfield, P.SEND_MESSAGES)).toBeTrue();
    expect(hasPermission(bitfield, P.MANAGE_MESSAGES)).toBeFalse();
    expect(hasPermission(0n, P.VIEW_CHANNEL)).toBeFalse();
  });

  test("a combined mask needs every bit in it", () => {
    const mask = P.SEND_MESSAGES | P.ATTACH_FILES;
    expect(hasPermission(P.SEND_MESSAGES, mask)).toBeFalse();
    expect(hasPermission(mask, mask)).toBeTrue();
  });

  test("ADMINISTRATOR implies everything", () => {
    for (const bit of Object.values(P)) {
      expect(hasPermission(P.ADMINISTRATOR, bit)).toBeTrue();
    }
    expect(hasAnyPermission(P.ADMINISTRATOR, [P.BAN_MEMBERS])).toBeTrue();
  });

  test("hasAnyPermission needs at least one", () => {
    expect(hasAnyPermission(P.KICK_MEMBERS, [P.BAN_MEMBERS, P.KICK_MEMBERS])).toBeTrue();
    expect(hasAnyPermission(P.KICK_MEMBERS, [P.BAN_MEMBERS, P.MODERATE_MEMBERS])).toBeFalse();
    expect(hasAnyPermission(P.KICK_MEMBERS, [])).toBeFalse();
  });

  test("the client UI helpers are the same table and rule", () => {
    expect(PERMISSIONS).toBe(PERMISSION_BITS);
    expect(bitfieldHas(P.ADMINISTRATOR, P.MANAGE_ROLES)).toBeTrue();
    expect(bitfieldHas(P.VIEW_CHANNEL, P.MANAGE_ROLES)).toBeFalse();
  });
});

describe("bitfield string helpers", () => {
  test("parses the stored string form and tolerates junk", () => {
    expect(parsePermissionBitfield("8")).toBe(8n);
    expect(parsePermissionBitfield(" 2048 ")).toBe(2048n);
    expect(parsePermissionBitfield("not a number")).toBe(0n);
    expect(parsePermissionBitfield("")).toBe(0n);
    expect(parsePermissionBitfield("   ")).toBe(0n);
    expect(parsePermissionBitfield(null)).toBe(0n);
    expect(parsePermissionBitfield(undefined)).toBe(0n);
    expect(parsePermissionBitfield(1024)).toBe(1024n);
    expect(parsePermissionBitfield(3.9)).toBe(3n);
    expect(parsePermissionBitfield(-5)).toBe(0n);
    expect(parsePermissionBitfield(42n)).toBe(42n);
  });

  test("keeps bits above 2^53 exact (no float rounding)", () => {
    const high = (1n << 60n) | 1n;
    expect(parsePermissionBitfield(high.toString())).toBe(high);
    expect(stringifyPermissionBitfield(high)).toBe(high.toString());
  });

  test("setPermissionBit toggles one bit and is idempotent", () => {
    const on = setPermissionBit("0", P.SEND_MESSAGES, true);
    expect(on).toBe("2048");
    expect(setPermissionBit(on, P.SEND_MESSAGES, true)).toBe("2048");
    expect(setPermissionBit(on, P.SEND_MESSAGES, false)).toBe("0");
    expect(setPermissionBit("0", P.SEND_MESSAGES, false)).toBe("0");
    const both = setPermissionBit(on, P.VIEW_CHANNEL, true);
    expect(parsePermissionBitfield(both)).toBe(P.SEND_MESSAGES | P.VIEW_CHANNEL);
  });

  test("hasPermissionBit is a raw bit test (no ADMINISTRATOR shortcut)", () => {
    expect(hasPermissionBit("2048", P.SEND_MESSAGES)).toBeTrue();
    expect(hasPermissionBit("8", P.SEND_MESSAGES)).toBeFalse();
    expect(hasPermissionBit(null, P.SEND_MESSAGES)).toBeFalse();
  });
});

describe("role editor metadata", () => {
  const all = ROLE_PERMISSION_CATEGORIES.flatMap((c) => c.permissions);

  test("every entry points at a real permission bit", () => {
    const known = new Set(Object.values(P));
    for (const def of all) {
      expect(known.has(def.bit)).toBeTrue();
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(0);
    }
  });

  test("keys are unique", () => {
    const keys = all.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("channel overwrite checks (client mirror of the server rules)", () => {
  const SERVER = "11111111-1111-4111-8111-111111111111";
  const MOD_ROLE = "22222222-2222-4222-8222-222222222222";
  const OTHER_ROLE = "33333333-3333-4333-8333-333333333333";
  const s = (bit: bigint) => bit.toString();

  const everyone = (allow = 0n, deny = 0n) => ({ id: SERVER, type: "role", allow: s(allow), deny: s(deny) });
  const role = (id: string, allow = 0n, deny = 0n) => ({ id, type: "role", allow: s(allow), deny: s(deny) });
  const channel = (...permissionOverwrites: ReturnType<typeof role>[]) => ({ serverId: SERVER, permissionOverwrites });

  test("no channel or no overwrites means allowed", () => {
    expect(canViewChannel(null, [], [], false, false)).toBeTrue();
    expect(canViewChannel(channel(), [], [], false, false)).toBeTrue();
    expect(canSendInChannel(channel(), [], [], false, false)).toBeTrue();
  });

  test("@everyone deny hides the channel from a plain member", () => {
    const ch = channel(everyone(0n, P.VIEW_CHANNEL));
    expect(canViewChannel(ch, [], [], false, false)).toBeFalse();
    expect(canViewChannel(ch, [OTHER_ROLE], [P.SEND_MESSAGES], false, false)).toBeFalse();
  });

  test("owner, admin flag, ADMINISTRATOR or MANAGE_CHANNELS role bypass overwrites", () => {
    const ch = channel(everyone(0n, P.VIEW_CHANNEL | P.SEND_MESSAGES));
    expect(canViewChannel(ch, [], [], true, false)).toBeTrue();
    expect(canViewChannel(ch, [], [], false, true)).toBeTrue();
    expect(canViewChannel(ch, [MOD_ROLE], [P.ADMINISTRATOR], false, false)).toBeTrue();
    expect(canSendInChannel(ch, [MOD_ROLE], [P.MANAGE_CHANNELS], false, false)).toBeTrue();
  });

  test("a role deny blocks, a role allow permits when @everyone is neutral", () => {
    expect(canViewChannel(channel(role(MOD_ROLE, 0n, P.VIEW_CHANNEL)), [MOD_ROLE], [0n], false, false)).toBeFalse();
    expect(canViewChannel(channel(role(MOD_ROLE, P.VIEW_CHANNEL)), [MOD_ROLE], [0n], false, false)).toBeTrue();
  });

  test("overwrites for roles the member does not have are ignored", () => {
    const ch = channel(role(OTHER_ROLE, 0n, P.SEND_MESSAGES));
    expect(canSendInChannel(ch, [MOD_ROLE], [0n], false, false)).toBeTrue();
  });

  test("view and send are resolved independently", () => {
    const readOnly = channel(everyone(0n, P.SEND_MESSAGES));
    expect(canViewChannel(readOnly, [], [], false, false)).toBeTrue();
    expect(canSendInChannel(readOnly, [], [], false, false)).toBeFalse();
  });

  // Discord applies @everyone first, then role overwrites, then the member, so a
  // role allow re-grants what @everyone denied ("Private Channel" + allowed roles).
  test("a role allow overrides an @everyone deny (Discord order)", () => {
    const priv = channel(everyone(0n, P.VIEW_CHANNEL), role(MOD_ROLE, P.VIEW_CHANNEL));
    expect(canViewChannel(priv, [MOD_ROLE], [0n], false, false)).toBeTrue();
    expect(canViewChannel(priv, [OTHER_ROLE], [0n], false, false)).toBeFalse();
    const announce = channel(everyone(0n, P.SEND_MESSAGES), role(MOD_ROLE, P.SEND_MESSAGES));
    expect(canSendInChannel(announce, [MOD_ROLE], [0n], false, false)).toBeTrue();
    expect(canSendInChannel(announce, [], [], false, false)).toBeFalse();
  });

  test("the @everyone overwrite keyed by the @everyone role id is recognized", () => {
    const EVERYONE_ROLE = "44444444-4444-4444-8444-444444444444";
    const priv = channel(role(EVERYONE_ROLE, 0n, P.VIEW_CHANNEL), role(MOD_ROLE, P.VIEW_CHANNEL));
    const opts = { everyoneRoleId: EVERYONE_ROLE };
    // Members always carry the @everyone role id; that must not turn its deny into a role deny.
    expect(canViewChannel(priv, [EVERYONE_ROLE, MOD_ROLE], [0n, 0n], false, false, opts)).toBeTrue();
    expect(canViewChannel(priv, [EVERYONE_ROLE], [0n], false, false, opts)).toBeFalse();
    // Applies even when the member's role list lacks the @everyone id.
    expect(canViewChannel(priv, [], [], false, false, opts)).toBeFalse();
  });

  test("a role deny beats an @everyone allow; a member overwrite beats both", () => {
    const USER = "55555555-5555-4555-8555-555555555555";
    const member = { id: USER, type: "member", allow: s(P.VIEW_CHANNEL), deny: "0" };
    const ch = channel(everyone(P.VIEW_CHANNEL), role(MOD_ROLE, 0n, P.VIEW_CHANNEL));
    expect(canViewChannel(ch, [MOD_ROLE], [0n], false, false)).toBeFalse();
    expect(canViewChannel({ ...ch, permissionOverwrites: [...ch.permissionOverwrites, member] }, [MOD_ROLE], [0n], false, false, { userId: USER })).toBeTrue();
  });

  test("base role permissions apply even without overwrites", () => {
    const opts = { everyonePermissions: P.VIEW_CHANNEL };
    expect(canSendInChannel(channel(), [], [], false, false, opts)).toBeFalse();
    expect(canSendInChannel(channel(), [MOD_ROLE], [P.SEND_MESSAGES], false, false, opts)).toBeTrue();
    // A channel allow grants what the base lacks.
    expect(canSendInChannel(channel(everyone(P.SEND_MESSAGES)), [], [], false, false, opts)).toBeTrue();
  });
});

describe("computeChannelPermissions", () => {
  const SERVER = "11111111-1111-4111-8111-111111111111";
  test("owner and ADMINISTRATOR get everything", () => {
    expect(computeChannelPermissions({ isOwner: true, everyonePermissions: 0n, ctx: { serverId: SERVER } })).toBe(ALL_PERMISSIONS);
    expect(computeChannelPermissions({ everyonePermissions: 0n, rolePermissions: [P.ADMINISTRATOR], ctx: { serverId: SERVER } })).toBe(ALL_PERMISSIONS);
  });

  test("unknown @everyone permissions fall back to the default role permissions", () => {
    const perms = computeChannelPermissions({ ctx: { serverId: SERVER } });
    expect(perms).toBe(DEFAULT_EVERYONE_PERMISSIONS);
    expect(hasBit(perms, P.VIEW_CHANNEL) && hasBit(perms, P.SEND_MESSAGES) && hasBit(perms, P.ATTACH_FILES)).toBeTrue();
  });

  test("MANAGE_CHANNELS keeps view and send through overwrites", () => {
    const overwrites = [{ id: SERVER, type: "role", allow: "0", deny: (P.VIEW_CHANNEL | P.SEND_MESSAGES | P.ADD_REACTIONS).toString() }];
    const perms = computeChannelPermissions({ everyonePermissions: P.MANAGE_CHANNELS | P.ADD_REACTIONS, overwrites, ctx: { serverId: SERVER } });
    expect(hasBit(perms, P.VIEW_CHANNEL)).toBeTrue();
    expect(hasBit(perms, P.SEND_MESSAGES)).toBeTrue();
    expect(hasBit(perms, P.ADD_REACTIONS)).toBeFalse();
  });

  test("malformed bitfields are treated as empty", () => {
    expect(applyChannelOverwrites(P.VIEW_CHANNEL, [{ id: SERVER, type: "role", allow: "x", deny: "nope" }], { serverId: SERVER })).toBe(P.VIEW_CHANNEL);
  });
});
