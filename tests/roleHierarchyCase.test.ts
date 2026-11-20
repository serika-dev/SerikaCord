import { describe, expect, test } from "bun:test";
import { PERMISSION_BITS as P } from "@/lib/permissions/bits";
import {
  buildActorContext,
  checkMemberRoleChange,
  checkRoleReorder,
  grantablePermissions,
  memberPermissions,
  topRolePosition,
  type HierarchyRole,
} from "@/lib/permissions/roleHierarchy";

// Realistic lowercase uuids, as Postgres returns them.
const EVERYONE = "00000000-0000-4000-8000-00000000000a";
const MEMBER = "00000000-0000-4000-8000-00000000000b";
const MOD = "00000000-0000-4000-8000-00000000000c";
const ADMIN = "00000000-0000-4000-8000-00000000000d";
const UNKNOWN = "00000000-0000-4000-8000-0000000000ff";

const roles: HierarchyRole[] = [
  { id: EVERYONE, position: 0, isDefault: true, permissions: String(P.VIEW_CHANNEL) },
  { id: MEMBER, position: 1, permissions: "0" },
  { id: MOD, position: 2, permissions: String(P.MANAGE_ROLES | P.KICK_MEMBERS) },
  { id: ADMIN, position: 3, permissions: String(P.ADMINISTRATOR) },
];
const rolesById = new Map(roles.map((r) => [r.id, r]));
const modActor = buildActorContext(false, [EVERYONE, MOD], roles);

const base = {
  actor: modActor,
  actorId: "11111111-1111-4111-8111-111111111111",
  targetIsOwner: false,
  rolesById,
};

describe("checkMemberRoleChange: id case", () => {
  test("an uppercase copy of a higher role id is still refused", () => {
    expect(checkMemberRoleChange({
      ...base, targetId: base.actorId, targetTopPosition: 2,
      currentRoleIds: [EVERYONE, MOD], requestedRoleIds: [EVERYONE, MOD, ADMIN.toUpperCase()],
    })).not.toBeNull();
  });

  test("the actor id is matched case-insensitively (self is not 'a higher member')", () => {
    expect(checkMemberRoleChange({
      ...base, targetId: base.actorId.toUpperCase(), targetTopPosition: 2,
      currentRoleIds: [EVERYONE, MOD], requestedRoleIds: [EVERYONE, MOD, MEMBER],
    })).toBeNull();
  });

  test("an uppercase current id equal to a requested lowercase id is not a change", () => {
    // Keeping a higher role the target already holds (stored in another case)
    // is not "removing and re-adding" it.
    expect(checkMemberRoleChange({
      ...base, actor: buildActorContext(false, [EVERYONE, ADMIN], roles), targetId: "u2", targetTopPosition: 2,
      currentRoleIds: [EVERYONE, MOD.toUpperCase()], requestedRoleIds: [EVERYONE, MOD, MEMBER],
    })).toBeNull();
  });

  test("an unknown requested id is refused instead of skipping the check", () => {
    expect(checkMemberRoleChange({
      ...base, targetId: "u2", targetTopPosition: 0,
      currentRoleIds: [EVERYONE], requestedRoleIds: [EVERYONE, UNKNOWN],
    })).not.toBeNull();
  });

  test("a stale unknown id already on the member may still be dropped", () => {
    expect(checkMemberRoleChange({
      ...base, targetId: "u2", targetTopPosition: 0,
      currentRoleIds: [EVERYONE, UNKNOWN], requestedRoleIds: [EVERYONE, MEMBER],
    })).toBeNull();
  });

  test("an uppercase rolesById key still resolves", () => {
    const upperMap = new Map(roles.map((r) => [r.id.toUpperCase(), r]));
    expect(checkMemberRoleChange({
      ...base, rolesById: upperMap, targetId: base.actorId, targetTopPosition: 2,
      currentRoleIds: [EVERYONE, MOD], requestedRoleIds: [EVERYONE, MOD, ADMIN],
    })).not.toBeNull();
  });

  test("the owner bypasses even unknown ids", () => {
    expect(checkMemberRoleChange({
      ...base, actor: buildActorContext(true, [EVERYONE], roles), targetId: "u2", targetTopPosition: 0,
      currentRoleIds: [EVERYONE], requestedRoleIds: [EVERYONE, UNKNOWN],
    })).toBeNull();
  });
});

describe("hierarchy helpers: id case", () => {
  test("held roles stored in uppercase still count toward rank and permissions", () => {
    expect(topRolePosition([ADMIN.toUpperCase()], roles)).toBe(3);
    expect(memberPermissions([ADMIN.toUpperCase()], roles) & P.ADMINISTRATOR).toBe(P.ADMINISTRATOR);
  });

  test("reorder protection matches uppercase ids", () => {
    const nonDefault = roles.filter((r) => !r.isDefault);
    expect(checkRoleReorder(modActor, nonDefault, [ADMIN.toUpperCase(), MOD.toUpperCase(), MEMBER])).toBeNull();
    expect(checkRoleReorder(modActor, nonDefault, [MEMBER, ADMIN.toUpperCase(), MOD])).not.toBeNull();
  });
});

describe("grantablePermissions", () => {
  test("non-admins keep only the bits they hold", () => {
    const bits = P.ADMINISTRATOR | P.MANAGE_ROLES | P.BAN_MEMBERS;
    expect(grantablePermissions(modActor, bits)).toBe(P.MANAGE_ROLES);
  });

  test("owner and administrators may grant everything", () => {
    const bits = P.ADMINISTRATOR | P.BAN_MEMBERS;
    expect(grantablePermissions(buildActorContext(true, [EVERYONE], roles), bits)).toBe(bits);
    expect(grantablePermissions(buildActorContext(false, [EVERYONE, ADMIN], roles), bits)).toBe(bits);
  });
});
