/**
 * Pure role-hierarchy rules (no DB access) shared by the server role,
 * member-role and moderation routes.
 *
 * Model (mirrors Discord): every non-owner actor has a "top position", the
 * highest `position` among their non-default roles (0 when they only have
 * @everyone). A non-owner may only manage roles strictly below that position,
 * may only grant permission bits they hold themselves (ADMINISTRATOR holders
 * hold everything), and may only moderate members whose top role is strictly
 * below theirs. The server owner bypasses every check.
 */
import { ALL_PERMISSIONS, PERMISSION_BITS } from '@/lib/permissions/bits';
import { parsePermissionBitfield } from '@/lib/roles/bitfield';

export interface HierarchyRole {
  id: string;
  position?: number | null;
  permissions?: string | null;
  isDefault?: boolean | null;
  managed?: boolean | null;
}

export interface ActorRoleContext {
  isOwner: boolean;
  /** OR of every role the actor holds, @everyone included. */
  perms: bigint;
  isAdmin: boolean;
  /** Highest position among the actor's non-default roles (0 = only @everyone). */
  topPosition: number;
}

const PERMISSION_INPUT_RE = /^\d{1,20}$/;

/**
 * Validate a client-supplied permission bitfield. Returns the masked bitfield
 * as a decimal string, or null when the input is not a plain non-negative
 * integer (e.g. "-1", "x", "0x8").
 */
export function normalizePermissionInput(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!PERMISSION_INPUT_RE.test(trimmed)) return null;
  return (BigInt(trimmed) & ALL_PERMISSIONS).toString();
}

export function rolePosition(role: { position?: number | null } | null | undefined): number {
  const p = role?.position;
  return typeof p === 'number' && Number.isFinite(p) ? p : 0;
}

/** Highest non-default role position among `memberRoleIds` (0 when none). */
export function topRolePosition(memberRoleIds: readonly string[], serverRoles: readonly HierarchyRole[]): number {
  const held = new Set(memberRoleIds);
  let top = 0;
  for (const role of serverRoles) {
    if (role.isDefault || !held.has(role.id)) continue;
    top = Math.max(top, rolePosition(role));
  }
  return top;
}

/** OR of the permissions of every held role plus @everyone. */
export function memberPermissions(memberRoleIds: readonly string[], serverRoles: readonly HierarchyRole[]): bigint {
  const held = new Set(memberRoleIds);
  let perms = 0n;
  for (const role of serverRoles) {
    if (role.isDefault || held.has(role.id)) perms |= parsePermissionBitfield(role.permissions);
  }
  return perms;
}

export function buildActorContext(
  isOwner: boolean,
  memberRoleIds: readonly string[],
  serverRoles: readonly HierarchyRole[],
): ActorRoleContext {
  const perms = memberPermissions(memberRoleIds, serverRoles);
  return {
    isOwner,
    perms,
    isAdmin: (perms & PERMISSION_BITS.ADMINISTRATOR) === PERMISSION_BITS.ADMINISTRATOR,
    topPosition: topRolePosition(memberRoleIds, serverRoles),
  };
}

/** Whether the actor may grant every bit in `bits`. */
export function canGrantPermissions(actor: ActorRoleContext, bits: bigint): boolean {
  if (actor.isOwner || actor.isAdmin) return true;
  return (bits & ~actor.perms) === 0n;
}

/**
 * Whether the actor may edit or delete `role`. @everyone is editable by any
 * role manager (permission edits are still subject to canGrantPermissions).
 */
export function canEditRole(actor: ActorRoleContext, role: HierarchyRole): boolean {
  if (actor.isOwner) return true;
  if (role.isDefault) return true;
  return rolePosition(role) < actor.topPosition;
}

/** Whether the actor may add `role` to, or remove it from, a member. */
export function canAssignRole(actor: ActorRoleContext, role: HierarchyRole): boolean {
  if (actor.isOwner) return true;
  if (role.isDefault) return true;
  if (role.managed) return false;
  return rolePosition(role) < actor.topPosition;
}

/**
 * Validate a member role change. Returns an error message or null when allowed.
 * `targetTopPosition` is the target member's current top position.
 */
export function checkMemberRoleChange(params: {
  actor: ActorRoleContext;
  actorId: string;
  targetId: string;
  targetIsOwner: boolean;
  targetTopPosition: number;
  currentRoleIds: readonly string[];
  requestedRoleIds: readonly string[];
  rolesById: ReadonlyMap<string, HierarchyRole>;
}): string | null {
  const { actor, actorId, targetId, targetIsOwner, targetTopPosition, currentRoleIds, requestedRoleIds, rolesById } = params;
  if (actor.isOwner) return null;
  if (targetIsOwner) return 'You cannot change the roles of the server owner';
  if (targetId !== actorId && targetTopPosition >= actor.topPosition) {
    return 'You cannot change the roles of a member whose highest role is at or above yours';
  }
  const current = new Set(currentRoleIds);
  const requested = new Set(requestedRoleIds);
  const changed = [
    ...requestedRoleIds.filter((id) => !current.has(id)),
    ...currentRoleIds.filter((id) => !requested.has(id)),
  ];
  for (const id of changed) {
    const role = rolesById.get(id);
    if (!role) continue; // stale ids on the member are simply dropped
    if (!canAssignRole(actor, role)) {
      return 'You can only assign or remove roles below your highest role';
    }
  }
  return null;
}

/**
 * Validate a full role reorder (`orderedRoleIds` is highest first and lists
 * every non-default role). Non-owners may not move any role at or above their
 * top position, nor move a role into that range: the protected roles must stay
 * the top of the list in their current relative order.
 */
export function checkRoleReorder(
  actor: ActorRoleContext,
  currentRoles: readonly HierarchyRole[],
  orderedRoleIds: readonly string[],
): string | null {
  if (actor.isOwner) return null;
  const byId = new Map(currentRoles.map((r) => [r.id, r]));
  const protectedIds = new Set(
    currentRoles.filter((r) => !r.isDefault && rolePosition(r) >= actor.topPosition).map((r) => r.id),
  );
  const k = protectedIds.size;
  const head = orderedRoleIds.slice(0, k);
  if (head.some((id) => !protectedIds.has(id))) {
    return 'You can only reorder roles below your highest role';
  }
  for (let i = 1; i < head.length; i++) {
    if (rolePosition(byId.get(head[i - 1])) < rolePosition(byId.get(head[i]))) {
      return 'You can only reorder roles below your highest role';
    }
  }
  return null;
}

/**
 * Whether `actor` may ban/kick/time out a member with the given top position
 * and permissions. Strict comparison: equal ranks cannot act on each other.
 */
export function canModerateTarget(
  actor: ActorRoleContext,
  target: { isOwner: boolean; isSelf: boolean; topPosition: number; perms: bigint },
): boolean {
  if (target.isOwner || target.isSelf) return false;
  if (actor.isOwner) return true;
  const targetIsAdmin = (target.perms & PERMISSION_BITS.ADMINISTRATOR) === PERMISSION_BITS.ADMINISTRATOR;
  if (targetIsAdmin && !actor.isAdmin) return false;
  return actor.topPosition > target.topPosition;
}
