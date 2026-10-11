import { Elysia, t, type Context } from 'elysia';
import { CHANGELOG_LIMITS, validateChangelogDraft } from '@/lib/changelogAnnouncements';
import { AdminLog } from '@/lib/models/AdminLog';
import { Changelog } from '@/lib/models/Changelog';
import { checkRateLimit } from '@/lib/security';
import { authenticateRequest } from '@/lib/services/auth';
import { getStaffAuth } from '@/lib/services/staffAuth';
import { hasStaffPermission } from '@/lib/staff/permissions';

const idParams = t.Object({ id: t.String({ format: 'uuid' }) });
const contentBody = t.Object({
  title: t.String({ minLength: 1, maxLength: CHANGELOG_LIMITS.title }),
  version: t.Optional(t.Union([t.String({ maxLength: CHANGELOG_LIMITS.version }), t.Null()])),
  body: t.String({ minLength: 1, maxLength: CHANGELOG_LIMITS.body }),
}, { additionalProperties: false });

async function getAuth(headers: Record<string, string | undefined>, cookie: Record<string, { value?: unknown }>) {
  const token = cookie.auth_token?.value;
  return authenticateRequest(headers.authorization ?? null, typeof token === 'string' ? { auth_token: token } : {});
}

/** Fail gracefully until the owner applies the additive manual migration. */
async function withStorage<T>(set: Pick<Context['set'], 'status'>, action: () => Promise<T>) {
  try {
    return await action();
  } catch (error) {
    let cause: unknown = error;
    for (let depth = 0; depth < 5 && cause && typeof cause === 'object'; depth += 1) {
      if ('code' in cause && cause.code === '42P01') {
        set.status = 503;
        return { error: 'Changelog storage is not available yet' };
      }
      cause = 'cause' in cause ? cause.cause : null;
    }
    throw error;
  }
}

async function logChange(userId: string, id: string, operation: string) {
  try {
    await AdminLog.create({
      adminId: userId,
      action: 'update_settings',
      targetType: 'platform',
      targetId: id,
      details: { feature: 'changelog', operation },
    });
  } catch (error) {
    console.error('Failed to record changelog audit action:', error instanceof Error ? error.message : 'Unknown error');
  }
}

export const changelogRoutes = new Elysia({ prefix: '/changelogs' })
  .get('/', async ({ headers, cookie, set }) => {
    const { user, error } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
    set.headers['Cache-Control'] = 'private, no-store';
    return withStorage(set, () => Changelog.feed(user.id));
  })
  .post('/:id/read', async ({ headers, cookie, params, set }) => {
    const { user, error } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
    const limit = await checkRateLimit('api', `changelog-read:${user.id}`);
    if (!limit.success) {
      set.status = 429;
      return { error: 'Rate limited', retryAfter: limit.retryAfter };
    }
    return withStorage(set, async () => {
      await Changelog.markRead(params.id, user.id);
      return { success: true };
    });
  }, { params: idParams });

// getStaffAuth re-reads current grants and applies the admin rate limit to
// every request, including each mutation. Publishing is independently gated.
export const adminChangelogRoutes = new Elysia({ prefix: '/admin/changelogs' })
  .get('/', async ({ headers, cookie, set }) => {
    const auth = await getStaffAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!auth.user || !auth.isAdmin) {
      set.status = auth.user ? 403 : auth.status;
      return { error: auth.error || 'Changelog management access required' };
    }
    if (!hasStaffPermission(auth.access, 'changelog.manage') && !hasStaffPermission(auth.access, 'changelog.publish')) {
      set.status = 403;
      return { error: 'Changelog access required' };
    }
    set.headers['Cache-Control'] = 'private, no-store';
    return withStorage(set, async () => ({ entries: await Changelog.listAdmin() }));
  })
  .post('/', async ({ headers, cookie, body, set }) => {
    const auth = await getStaffAuth(headers, cookie as Record<string, { value?: unknown }>, 'changelog.manage');
    if (!auth.user || !auth.isAdmin) {
      set.status = auth.status;
      return { error: auth.error || 'Changelog management access required' };
    }
    const validationError = validateChangelogDraft(body);
    if (validationError) {
      set.status = 400;
      return { error: validationError };
    }
    const userId = auth.user.id;
    return withStorage(set, async () => {
      const entry = await Changelog.createDraft(body, userId);
      await logChange(userId, entry.id, 'create_draft');
      set.status = 201;
      return { entry };
    });
  }, { body: contentBody })
  .patch('/:id', async ({ headers, cookie, params, body, set }) => {
    const auth = await getStaffAuth(headers, cookie as Record<string, { value?: unknown }>, 'changelog.manage');
    if (!auth.user || !auth.isAdmin) {
      set.status = auth.status;
      return { error: auth.error || 'Changelog management access required' };
    }
    const validationError = validateChangelogDraft(body);
    if (validationError) {
      set.status = 400;
      return { error: validationError };
    }
    const userId = auth.user.id;
    return withStorage(set, async () => {
      const entry = await Changelog.editDraft(params.id, body, userId);
      if (!entry) {
        const current = await Changelog.findById(params.id);
        set.status = current ? 409 : 404;
        return { error: current ? 'Unpublish this changelog before editing it' : 'Changelog not found' };
      }
      await logChange(userId, entry.id, 'edit_draft');
      return { entry };
    });
  }, { params: idParams, body: contentBody })
  .post('/:id/publish', async ({ headers, cookie, params, set }) => {
    const auth = await getStaffAuth(headers, cookie as Record<string, { value?: unknown }>, 'changelog.publish');
    if (!auth.user || !auth.isAdmin) {
      set.status = auth.status;
      return { error: auth.error || 'Changelog publishing access required' };
    }
    const userId = auth.user.id;
    return withStorage(set, async () => {
      const entry = await Changelog.publish(params.id, userId);
      if (!entry) {
        set.status = 404;
        return { error: 'Changelog not found' };
      }
      await logChange(userId, entry.id, 'publish');
      return { entry };
    });
  }, { params: idParams })
  .post('/:id/unpublish', async ({ headers, cookie, params, set }) => {
    const auth = await getStaffAuth(headers, cookie as Record<string, { value?: unknown }>, 'changelog.publish');
    if (!auth.user || !auth.isAdmin) {
      set.status = auth.status;
      return { error: auth.error || 'Changelog publishing access required' };
    }
    const userId = auth.user.id;
    return withStorage(set, async () => {
      const entry = await Changelog.unpublish(params.id, userId);
      if (!entry) {
        set.status = 404;
        return { error: 'Changelog not found' };
      }
      await logChange(userId, entry.id, 'unpublish');
      return { entry };
    });
  }, { params: idParams });
