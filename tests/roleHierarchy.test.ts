import { describe, expect, test } from "bun:test";
import { ALL_PERMISSIONS, PERMISSION_BITS as P } from "@/lib/permissions/bits";
import { RolePermCache } from "@/lib/permissions/roleCache";
import {
  buildActorContext,
  canAssignRole,
  canEditRole,
  canGrantPermissions,
  canModerateTarget,
  checkMemberRoleChange,
  checkRoleReorder,
  memberPermissions,
  normalizePermissionInput,
  topRolePosition,
  type HierarchyRole,
} from "@/lib/permissions/roleHierarchy";

const everyone: HierarchyRole = { id: "everyone", position: 0, isDefault: true, permissions: String(P.VIEW_CHANNEL | P.SEND_MESSAGES) };
const member: HierarchyRole = { id: "member", position: 1, permissions: "0" };
const mod: HierarchyRole = { id: "mod", position: 2, permissions: String(P.MANAGE_ROLES | P.KICK_MEMBERS | P.BAN_MEMBERS) };
const admin: HierarchyRole = { id: "admin", position: 3, permissions: String(P.ADMINISTRATOR) };
const bot: HierarchyRole = { id: "bot", position: 1, permissions: "0", managed: true };
const roles = [everyone, member, mod, admin, bot];
const byId = new Map(roles.map((r) => [r.id, r]));

const modActor = buildActorContext(false, ["everyone", "mod"], roles);
const adminActor = buildActorContext(false, ["everyone", "admin"], roles);
const ownerActor = buildActorContext(true, ["everyone"], roles);

describe("normalizePermissionInput", () => {
  test("accepts plain decimal bitfields and masks unknown bits", () => {
    expect(normalizePermissionInput("8")).toBe("8");
    expect(normalizePermissionInput(" 0 ")).toBe("0");
    expect(normalizePermissionInput((ALL_PERMISSIONS | (1n << 60n)).toString())).toBe(ALL_PERMISSIONS.toString());
  });
  test("rejects negative, hex, non-numeric and oversized values", () => {
    expect(normalizePermissionInput("-1")).toBeNull();
    expect(normalizePermissionInput("x")).toBeNull();
    expect(normalizePermissionInput("0x8")).toBeNull();
    expect(normalizePermissionInput("1".repeat(21))).toBeNull();
    expect(normalizePermissionInput(8)).toBeNull();
  });
});

describe("actor context", () => {
  test("includes @everyone permissions and ignores its position", () => {
    expect(memberPermissions(["mod"], roles) & P.SEND_MESSAGES).toBe(P.SEND_MESSAGES);
    expect(topRolePosition(["everyone"], roles)).toBe(0);
    expect(modActor.topPosition).toBe(2);
    expect(modActor.isAdmin).toBe(false);
    expect(adminActor.isAdmin).toBe(true);
  });
});

describe("granting and editing roles", () => {
  test("non-admins can only grant bits they hold", () => {
    expect(canGrantPermissions(modActor, P.KICK_MEMBERS)).toBe(true);
    expect(canGrantPermissions(modActor, P.ADMINISTRATOR)).toBe(false);
    expect(canGrantPermissions(modActor, P.MANAGE_SERVER)).toBe(false);
    expect(canGrantPermissions(adminActor, P.ADMINISTRATOR)).toBe(true);
    expect(canGrantPermissions(ownerActor, ALL_PERMISSIONS)).toBe(true);
  });
  test("roles at or above the actor's top are off limits", () => {
    expect(canEditRole(modActor, member)).toBe(true);
    expect(canEditRole(modActor, mod)).toBe(false);
    expect(canEditRole(modActor, admin)).toBe(false);
    expect(canEditRole(modActor, everyone)).toBe(true);
    expect(canEditRole(ownerActor, admin)).toBe(true);
  });
  test("managed roles cannot be assigned by non-owners", () => {
    expect(canAssignRole(modActor, bot)).toBe(false);
    expect(canAssignRole(ownerActor, bot)).toBe(true);
  });
});

describe("checkMemberRoleChange", () => {
  const base = {
    actor: modActor,
    actorId: "modUser",
    targetIsOwner: false,
    rolesById: byId,
  };
  test("mod cannot give themselves the admin role", () => {
    expect(checkMemberRoleChange({
      ...base, targetId: "modUser", targetTopPosition: 2,
      currentRoleIds: ["everyone", "mod"], requestedRoleIds: ["everyone", "mod", "admin"],
    })).not.toBeNull();
  });
  test("mod can give a lower member a lower role", () => {
    expect(checkMemberRoleChange({
      ...base, targetId: "u2", targetTopPosition: 0,
      currentRoleIds: ["everyone"], requestedRoleIds: ["everyone", "member"],
    })).toBeNull();
  });
  test("mod cannot change roles of an equal or higher member, or the owner", () => {
    expect(checkMemberRoleChange({
      ...base, targetId: "u3", targetTopPosition: 2,
      currentRoleIds: ["everyone", "mod"], requestedRoleIds: ["everyone", "mod", "member"],
    })).not.toBeNull();
    expect(checkMemberRoleChange({
      ...base, targetId: "owner", targetIsOwner: true, targetTopPosition: 0,
      currentRoleIds: ["everyone"], requestedRoleIds: ["everyone", "member"],
    })).not.toBeNull();
  });
  test("mod cannot strip the admin role from someone", () => {
    expect(checkMemberRoleChange({
      ...base, targetId: "u4", targetTopPosition: 1,
      currentRoleIds: ["everyone", "member", "admin"], requestedRoleIds: ["everyone", "member"],
    })).not.toBeNull();
  });
  test("owner bypasses everything", () => {
    expect(checkMemberRoleChange({
      ...base, actor: ownerActor, targetId: "u5", targetTopPosition: 3,
      currentRoleIds: ["everyone", "admin"], requestedRoleIds: ["everyone"],
    })).toBeNull();
  });
});

describe("checkRoleReorder", () => {
  const nonDefault = [member, mod, admin, bot];
  test("reordering below the actor's top is allowed", () => {
    expect(checkRoleReorder(modActor, nonDefault, ["admin", "mod", "bot", "member"])).toBeNull();
  });
  test("moving a role above the actor's top, or moving protected roles, is rejected", () => {
    expect(checkRoleReorder(modActor, nonDefault, ["member", "admin", "mod", "bot"])).not.toBeNull();
    expect(checkRoleReorder(modActor, nonDefault, ["mod", "admin", "member", "bot"])).not.toBeNull();
  });
  test("owner can reorder freely", () => {
    expect(checkRoleReorder(ownerActor, nonDefault, ["member", "bot", "mod", "admin"])).toBeNull();
  });
});

describe("canModerateTarget", () => {
  test("strictly higher rank required, admins protected from non-admins", () => {
    expect(canModerateTarget(modActor, { isOwner: false, isSelf: false, topPosition: 1, perms: 0n })).toBe(true);
    expect(canModerateTarget(modActor, { isOwner: false, isSelf: false, topPosition: 2, perms: 0n })).toBe(false);
    expect(canModerateTarget(modActor, { isOwner: false, isSelf: false, topPosition: 3, perms: P.ADMINISTRATOR })).toBe(false);
    expect(canModerateTarget(modActor, { isOwner: false, isSelf: false, topPosition: 0, perms: P.ADMINISTRATOR })).toBe(false);
  });
  test("nobody moderates the owner or themselves; the owner moderates anyone else", () => {
    expect(canModerateTarget(ownerActor, { isOwner: false, isSelf: false, topPosition: 3, perms: P.ADMINISTRATOR })).toBe(true);
    expect(canModerateTarget(adminActor, { isOwner: true, isSelf: false, topPosition: 0, perms: 0n })).toBe(false);
    expect(canModerateTarget(ownerActor, { isOwner: false, isSelf: true, topPosition: 0, perms: 0n })).toBe(false);
  });
});

describe("RolePermCache", () => {
  test("entries expire after the TTL on every write path", () => {
    let now = 1_000;
    const cache = new RolePermCache(100, 60_000, () => now);
    cache.set("s", "r", "8");
    expect(cache.get("s", "r")).toBe("8");
    now += 59_999;
    expect(cache.get("s", "r")).toBe("8");
    now += 1;
    expect(cache.get("s", "r")).toBeUndefined();
    // Re-warming restarts the TTL instead of making the entry permanent.
    cache.set("s", "r", "0");
    now += 60_000;
    expect(cache.get("s", "r")).toBeUndefined();
  });
  test("invalidates one role or a whole server", () => {
    const cache = new RolePermCache();
    cache.set("s1", "a", "1");
    cache.set("s1", "b", "2");
    cache.set("s2", "a", "3");
    cache.invalidate("s1", "a");
    expect(cache.get("s1", "a")).toBeUndefined();
    expect(cache.get("s1", "b")).toBe("2");
    cache.invalidate("s1");
    expect(cache.get("s1", "b")).toBeUndefined();
    expect(cache.get("s2", "a")).toBe("3");
  });
});
