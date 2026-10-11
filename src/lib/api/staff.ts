import { Elysia, t } from 'elysia';
import { StaffMutationError, StaffRole } from '../models/StaffRole';
import { getStaffAuth, isMissingStaffTable } from '../services/staffAuth';
import { isStaffPermission, STAFF_PERMISSIONS } from '../staff/permissions';

const uuid = t.String({ format: 'uuid', pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' });
const roleParams = t.Object({ roleId: uuid });
const permissionsBody = t.Array(t.String(), { maxItems: STAFF_PERMISSIONS.length, uniqueItems: true });

async function notifyAccessChanged(userIds: string[]) {
  if (!userIds.length) return;
  const { fanoutToUsers } = await import('./activity');
  await fanoutToUsers({ userIds }, { type: 'staff_access_changed' }).catch(() => {});
}

async function mutate<T>(set: { status?: number | string }, action: () => Promise<T>) {
  try { return await action(); }
  catch (error) {
    if (!(error instanceof StaffMutationError)) throw error;
    set.status = error.status;
    return { error: error.message };
  }
}

export const staffRoutes = new Elysia({ prefix: '/admin' })
  .onError(({ error, set }) => {
    if (isMissingStaffTable(error)) {
      set.status = 503;
      return { error: 'Staff role management is not available yet. Apply the staff roles migration to finish setup.' };
    }
  })
  .onBeforeHandle(({ set }) => { set.headers['Cache-Control'] = 'private, no-store'; })
  .get('/access', async ({ headers, cookie, set }) => {
    const auth = await getStaffAuth(headers, cookie);
    if (!auth.user || !auth.access) {
      set.status = auth.status;
      return { error: auth.error || 'Unauthorized' };
    }
    return auth.access;
  })
  .get('/staff/roles', async ({ headers, cookie, set }) => {
    const auth = await getStaffAuth(headers, cookie, 'staff.manage');
    if (!auth.user) { set.status = auth.status; return { error: auth.error }; }
    return { roles: await StaffRole.list() };
  })
  .post('/staff/roles', async ({ headers, cookie, body, set }) => {
    const auth = await getStaffAuth(headers, cookie, 'staff.manage');
    if (!auth.user) { set.status = auth.status; return { error: auth.error }; }
    if (!body.name.trim() || body.permissions.some((permission) => !isStaffPermission(permission))) {
      set.status = 400;
      return { error: 'A role name and valid permissions are required' };
    }
    return mutate(set, async () => {
      const role = await StaffRole.create(auth.user.id, {
        name: body.name.trim(), description: body.description?.trim() || '', permissions: body.permissions,
      });
      set.status = 201;
      return { role };
    });
  }, {
    body: t.Object({
      name: t.String({ minLength: 1, maxLength: 64 }),
      description: t.Optional(t.String({ maxLength: 500 })),
      permissions: permissionsBody,
    }),
  })
  .patch('/staff/roles/:roleId', async ({ headers, cookie, params, body, set }) => {
    const auth = await getStaffAuth(headers, cookie, 'staff.manage');
    if (!auth.user) { set.status = auth.status; return { error: auth.error }; }
    if ((body.name !== undefined && !body.name.trim()) || body.permissions?.some((permission) => !isStaffPermission(permission))) {
      set.status = 400;
      return { error: 'A role name and valid permissions are required' };
    }
    return mutate(set, async () => {
      const { role, affectedUserIds } = await StaffRole.update(auth.user.id, params.roleId, {
        ...body,
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.description !== undefined ? { description: body.description.trim() } : {}),
      });
      await notifyAccessChanged(affectedUserIds);
      return { role };
    });
  }, {
    params: roleParams,
    body: t.Object({
      name: t.Optional(t.String({ minLength: 1, maxLength: 64 })),
      description: t.Optional(t.String({ maxLength: 500 })),
      permissions: t.Optional(permissionsBody),
    }),
  })
  .delete('/staff/roles/:roleId', async ({ headers, cookie, params, set }) => {
    const auth = await getStaffAuth(headers, cookie, 'staff.manage');
    if (!auth.user) { set.status = auth.status; return { error: auth.error }; }
    return mutate(set, async () => {
      await StaffRole.delete(auth.user.id, params.roleId);
      return { success: true };
    });
  }, { params: roleParams })
  .get('/staff/members', async ({ headers, cookie, query, set }) => {
    const auth = await getStaffAuth(headers, cookie, 'staff.manage');
    if (!auth.user) { set.status = auth.status; return { error: auth.error }; }
    const [members, roles] = await Promise.all([StaffRole.members(query.q), StaffRole.list()]);
    return { members, roles };
  }, { query: t.Object({ q: t.Optional(t.String({ maxLength: 100 })) }) })
  .put('/staff/members/:userId', async ({ headers, cookie, params, body, set }) => {
    const auth = await getStaffAuth(headers, cookie, 'staff.manage');
    if (!auth.user) { set.status = auth.status; return { error: auth.error }; }
    return mutate(set, async () => {
      const member = await StaffRole.assign(auth.user.id, params.userId, body.roleIds.map((id) => id.toLowerCase()));
      await notifyAccessChanged([params.userId]);
      return { success: true, member };
    });
  }, {
    params: t.Object({ userId: uuid }),
    body: t.Object({ roleIds: t.Array(uuid, { maxItems: 50, uniqueItems: true }) }),
  });
