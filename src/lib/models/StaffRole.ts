import { asc, eq, exists, ilike, inArray, or, sql } from 'drizzle-orm';
import { db, schema, type DB } from '../db/postgres';
import {
  hasStaffPermission, isLegacySuperAdmin, normalizeStaffPermissions, privilegedBadgeMutationError,
  resolveStaffAccess, sameStaffAuthoritySnapshot, staffAssignmentError, staffRoleMutationError, staffUnbanError,
  type StaffAccess, type StaffIdentity, type StaffMember, type StaffRole as StaffRoleData,
} from '../staff/permissions';

type Transaction = Parameters<Parameters<DB['transaction']>[0]>[0];
type Reader = DB | Transaction;
type StoredRole = typeof schema.staffRoles.$inferSelect;

export class StaffMutationError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404 | 409 = 403) {
    super(message);
  }
}

function toRole(role: StoredRole): StaffRoleData {
  return { ...role, permissions: normalizeStaffPermissions(role.permissions) };
}

async function rolesForUser(userId: string, reader: Reader = db): Promise<StaffRoleData[]> {
  const rows = await reader.select({ role: schema.staffRoles }).from(schema.staffRoleAssignments)
    .innerJoin(schema.staffRoles, eq(schema.staffRoles.id, schema.staffRoleAssignments.roleId))
    .where(eq(schema.staffRoleAssignments.userId, userId));
  return rows.map(({ role }) => toRole(role));
}

async function actorAccess(tx: Transaction, actorId: string): Promise<StaffAccess> {
  // Serialize all configuration changes, including role grants concurrent with edits.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('serikacord:staff_configuration'))`);
  const [actor] = await tx.select().from(schema.users).where(eq(schema.users.id, actorId)).limit(1).for('update');
  if (!actor || actor.isBanned) throw new StaffMutationError('Staff access no longer available');
  return resolveStaffAccess(actor, isLegacySuperAdmin(actor) ? [] : await rolesForUser(actorId, tx));
}

async function audit(tx: Transaction, actorId: string, targetId: string, details: Record<string, unknown>) {
  await tx.insert(schema.adminLogs).values({
    adminId: actorId, action: 'update_settings', targetType: 'platform', targetId, details,
  });
}

async function member(userId: string, reader: Reader = db): Promise<StaffMember | null> {
  const [user] = await reader.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!user) return null;
  const roles = await rolesForUser(userId, reader);
  const access = resolveStaffAccess(user, roles);
  return {
    id: user.id, username: user.username, displayName: user.displayName, avatar: user.avatar,
    isSuperAdmin: access.isSuperAdmin, permissions: access.permissions, roleIds: roles.map((role) => role.id),
  };
}

export const StaffRole = {
  rolesForUser,
  member,
  async unban(actorId: string, targetId: string) {
    return db.transaction(async (tx) => {
      const access = await actorAccess(tx, actorId);
      const [target] = await tx.select().from(schema.users).where(eq(schema.users.id, targetId)).limit(1).for('update');
      if (!target) throw new StaffMutationError('User not found', 404);
      const roles = access.isSuperAdmin ? [] : await rolesForUser(targetId, tx);
      const error = staffUnbanError(access, target, roles);
      if (error) throw new StaffMutationError(error);
      await tx.update(schema.users).set({ isBanned: false, banReason: null, updatedAt: new Date() })
        .where(eq(schema.users.id, targetId));
    });
  },
  async changeBadges(
    actorId: string,
    expected: StaffIdentity & { id: string },
    requestedBadges: string[],
    manualBadges: string[],
    staffUpdate: Pick<StaffIdentity, 'isStaff' | 'staffRole'>,
  ) {
    return db.transaction(async (tx) => {
      const access = await actorAccess(tx, actorId);
      if (!hasStaffPermission(access, 'badges.manage')) throw new StaffMutationError('Badge management permission required');
      const [target] = await tx.select().from(schema.users).where(eq(schema.users.id, expected.id)).limit(1).for('update');
      if (!target) throw new StaffMutationError('User not found', 404);
      if (!sameStaffAuthoritySnapshot(expected, target)) {
        throw new StaffMutationError('This account changed while you were editing. Reload it before saving again.', 409);
      }
      const error = privilegedBadgeMutationError(actorId, access, target, { ...target, ...staffUpdate, badges: requestedBadges });
      if (error) throw new StaffMutationError(error);
      const [updated] = await tx.update(schema.users).set({ ...staffUpdate, badges: manualBadges, updatedAt: new Date() })
        .where(eq(schema.users.id, target.id)).returning();
      await tx.insert(schema.adminLogs).values({
        adminId: actorId, action: 'edit_badges', targetType: 'user', targetId: target.id,
        details: { oldBadges: target.badges, newBadges: requestedBadges, staffUpdate },
      });
      return updated;
    });
  },
  async list(): Promise<StaffRoleData[]> {
    return (await db.select().from(schema.staffRoles).orderBy(asc(schema.staffRoles.name))).map(toRole);
  },
  async members(query?: string): Promise<StaffMember[]> {
    const q = query?.trim();
    const hasAssignment = exists(db.select({ id: schema.staffRoleAssignments.userId })
      .from(schema.staffRoleAssignments).where(eq(schema.staffRoleAssignments.userId, schema.users.id)));
    const filter = q
      ? or(ilike(schema.users.username, `%${q.replace(/[\\%_]/g, '\\$&')}%`), ilike(schema.users.displayName, `%${q.replace(/[\\%_]/g, '\\$&')}%`), sql`${schema.users.id}::text = ${q}`)
      : or(hasAssignment, eq(schema.users.isStaff, true), sql`${schema.users.badges} && ARRAY['admin', 'serikacord_developer']::text[]`);
    const users = await db.select({
      id: schema.users.id, username: schema.users.username, displayName: schema.users.displayName,
      avatar: schema.users.avatar, isStaff: schema.users.isStaff, staffRole: schema.users.staffRole,
      badges: schema.users.badges, isBanned: schema.users.isBanned,
    }).from(schema.users).where(filter).orderBy(asc(schema.users.username)).limit(q ? 50 : 500);
    if (!users.length) return [];
    const assignments = await db.select({ userId: schema.staffRoleAssignments.userId, role: schema.staffRoles })
      .from(schema.staffRoleAssignments)
      .innerJoin(schema.staffRoles, eq(schema.staffRoles.id, schema.staffRoleAssignments.roleId))
      .where(inArray(schema.staffRoleAssignments.userId, users.map((user) => user.id)));
    const rolesByUser = new Map<string, StaffRoleData[]>();
    for (const assignment of assignments) {
      const roles = rolesByUser.get(assignment.userId) || [];
      roles.push(toRole(assignment.role));
      rolesByUser.set(assignment.userId, roles);
    }
    return users.map((user) => {
      const roles = rolesByUser.get(user.id) || [];
      const access = resolveStaffAccess(user, roles);
      return {
        id: user.id, username: user.username, displayName: user.displayName, avatar: user.avatar,
        isSuperAdmin: access.isSuperAdmin, permissions: access.permissions, roleIds: roles.map((role) => role.id),
      };
    });
  },
  async create(actorId: string, data: { name: string; description: string; permissions: string[] }) {
    return db.transaction(async (tx) => {
      const access = await actorAccess(tx, actorId);
      const error = staffRoleMutationError(actorId, access, [], data.permissions);
      if (error) throw new StaffMutationError(error);
      const [created] = await tx.insert(schema.staffRoles).values({ ...data, permissions: normalizeStaffPermissions(data.permissions) }).returning();
      await audit(tx, actorId, created.id, { action: 'staff_role_create', role: created });
      return toRole(created);
    });
  },
  async update(actorId: string, roleId: string, data: { name?: string; description?: string; permissions?: string[] }) {
    return db.transaction(async (tx) => {
      const access = await actorAccess(tx, actorId);
      const [previous] = await tx.select().from(schema.staffRoles).where(eq(schema.staffRoles.id, roleId)).limit(1);
      if (!previous) throw new StaffMutationError('Staff role not found', 404);
      const assignments = await tx.select().from(schema.staffRoleAssignments).where(eq(schema.staffRoleAssignments.roleId, roleId));
      const error = staffRoleMutationError(actorId, access, previous.permissions, data.permissions ?? previous.permissions, assignments.map((row) => row.userId));
      if (error) throw new StaffMutationError(error);
      const [updated] = await tx.update(schema.staffRoles).set({ ...data, updatedAt: new Date() })
        .where(eq(schema.staffRoles.id, roleId)).returning();
      await audit(tx, actorId, roleId, { action: 'staff_role_update', before: previous, after: updated });
      return { role: toRole(updated), affectedUserIds: assignments.map((row) => row.userId) };
    });
  },
  async delete(actorId: string, roleId: string) {
    return db.transaction(async (tx) => {
      const access = await actorAccess(tx, actorId);
      const [previous] = await tx.select().from(schema.staffRoles).where(eq(schema.staffRoles.id, roleId)).limit(1);
      if (!previous) throw new StaffMutationError('Staff role not found', 404);
      const assignments = await tx.select().from(schema.staffRoleAssignments).where(eq(schema.staffRoleAssignments.roleId, roleId));
      const error = staffRoleMutationError(actorId, access, previous.permissions, [], assignments.map((row) => row.userId));
      if (error) throw new StaffMutationError(error);
      // Require explicit member reassignment before deleting an in-use role.
      if (assignments.length) throw new StaffMutationError('Remove this role from its members before deleting it', 409);
      await tx.delete(schema.staffRoles).where(eq(schema.staffRoles.id, roleId));
      await audit(tx, actorId, roleId, { action: 'staff_role_delete', role: previous });
    });
  },
  async assign(actorId: string, userId: string, roleIds: string[]) {
    return db.transaction(async (tx) => {
      const access = await actorAccess(tx, actorId);
      const [target] = await tx.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
      if (!target) throw new StaffMutationError('User not found', 404);
      if (target.isBot || target.isSystem) throw new StaffMutationError('Staff roles require a personal account', 400);
      const previousRoles = await rolesForUser(userId, tx);
      const allRoles = await tx.select().from(schema.staffRoles);
      const requestedIds = new Set(roleIds);
      const nextRoles = allRoles.filter((role) => requestedIds.has(role.id));
      if (nextRoles.length !== requestedIds.size) throw new StaffMutationError('Unknown staff role', 400);
      const error = staffAssignmentError(actorId, access, target, previousRoles.flatMap((role) => role.permissions), nextRoles.flatMap((role) => role.permissions));
      if (error) throw new StaffMutationError(error);
      await tx.delete(schema.staffRoleAssignments).where(eq(schema.staffRoleAssignments.userId, userId));
      if (nextRoles.length) await tx.insert(schema.staffRoleAssignments).values(nextRoles.map((role) => ({ userId, roleId: role.id, assignedBy: actorId })));
      await audit(tx, actorId, userId, { action: 'staff_member_roles', before: previousRoles.map((role) => role.id), after: [...requestedIds] });
      return (await member(userId, tx))!;
    });
  },
};
