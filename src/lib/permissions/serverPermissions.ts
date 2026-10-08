/**
 * Server-side role permission lookups shared by the servers and channels API
 * modules: one process-wide expiring cache (so invalidating once covers every
 * caller and both Bun/Next module copies) plus owner-or-permission helpers and
 * the role-hierarchy actor context.
 */
import { Role, ServerMember } from '@/lib/models';
import { processShared } from '@/lib/realtime/processShared';
import { parsePermissionBitfield } from '@/lib/roles/bitfield';
import { hasPermission } from '@/lib/permissions/bits';
import { RolePermCache } from '@/lib/permissions/roleCache';
import { buildActorContext, type ActorRoleContext, type HierarchyRole } from '@/lib/permissions/roleHierarchy';

const rolePermCache = processShared('rolePermCache', () => new RolePermCache());

/** Permission bitfield of each found role (cached for ROLE_CACHE_TTL_MS). */
export async function getRolePermissions(roleIds: string[], serverId: string): Promise<Map<string, bigint>> {
  const result = new Map<string, bigint>();
  const uncachedIds: string[] = [];
  for (const id of roleIds) {
    const cached = rolePermCache.get(serverId, id);
    if (cached !== undefined) {
      result.set(id, parsePermissionBitfield(cached));
    } else {
      uncachedIds.push(id);
    }
  }
  if (uncachedIds.length > 0) {
    const roles = await Role.find({ id: { in: uncachedIds }, serverId });
    for (const role of roles) {
      const perms = role.permissions || '0';
      result.set(role.id, parsePermissionBitfield(perms));
      rolePermCache.set(serverId, role.id, perms);
    }
  }
  return result;
}

/** Store a freshly loaded role's permissions (same expiry as a miss). */
export function primeRolePermissions(serverId: string, roleId: string, perms: string): void {
  rolePermCache.set(serverId, roleId, perms);
}

/** Drop cached permissions for one role, or for every role of a server. */
export function invalidateRolePerms(serverId: string, roleId?: string): void {
  rolePermCache.invalidate(serverId, roleId);
}

/**
 * True for the server owner, or a member whose roles grant `bit` (or
 * ADMINISTRATOR). Pass `membership` when the caller already loaded it.
 */
export async function hasServerPermission(
  server: { ownerId: string; id: string },
  userId: string,
  bit: bigint,
  membership?: { roles?: string[] | null } | null,
): Promise<boolean> {
  if (server.ownerId === userId) return true;
  const member = membership ?? (await ServerMember.findOne({ serverId: server.id, userId }));
  if (!member) return false;
  const roleIds = (member.roles || []) as string[];
  if (roleIds.length === 0) return false;
  const rolePerms = await getRolePermissions(roleIds, server.id);
  for (const [, perms] of rolePerms) {
    if (hasPermission(perms, bit)) return true;
  }
  return false;
}

/**
 * Hierarchy context for `userId` in `server`, computed from fresh role rows.
 * `serverRoles` can be passed when the caller already loaded them. Returns
 * null for a non-owner who is not a member.
 */
export async function getActorRoleContext(
  server: { ownerId: string; id: string },
  userId: string,
  serverRoles?: HierarchyRole[],
): Promise<ActorRoleContext | null> {
  const isOwner = server.ownerId === userId;
  const [member, roles] = await Promise.all([
    ServerMember.findOne({ serverId: server.id, userId }),
    serverRoles ? Promise.resolve(serverRoles) : Role.find({ serverId: server.id }),
  ]);
  if (!member && !isOwner) return null;
  return buildActorContext(isOwner, (member?.roles || []) as string[], roles as HierarchyRole[]);
}
