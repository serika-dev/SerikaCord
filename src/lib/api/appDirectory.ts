// App Directory API.
//
// Public, read-only (works logged out, rate limited per IP, public fields only):
//   GET /api/apps/directory                ?search&category&sort&cursor&limit&featured&official
//   GET /api/apps/directory/:appId         one listed app (description, links, commands, install URL)
//   GET /api/apps/by-bot/:userId           the app behind a bot user (bot profile cards)
// Signed in, server member:
//   GET /api/apps/installed?serverId=      apps whose bot is in that server
// Staff (`apps.manage`, src/lib/staff/permissions.ts), audit-logged:
//   GET  /api/admin/apps/overview
//   GET  /api/admin/apps/verification      ?status=pending|approved|rejected
//   POST /api/admin/apps/:appId/verification   { action: approve|reject|revoke|verify, reason? }
//        (verify: staff verify any app directly, no request or server threshold)
//   POST /api/admin/apps/:appId/official   { official: boolean, reason? }
//   POST /api/admin/apps/:appId/listing    { shortDescription?, categories?, tags?, reason? }
//   GET  /api/admin/apps/directory         ?search&filter&page   (every app, listed or not)
//   POST /api/admin/apps/:appId/directory  { featured?, delisted?, reason? }
// Rules: src/lib/appDirectory/listing.ts (visibility), paging.ts (search/sort/cursor).
import { Elysia } from 'elysia';
import { checkRateLimit, getClientIP, isValidObjectId } from '@/lib/security';
import { authenticateRequest } from '@/lib/services/auth';
import { getStaffAuth } from '@/lib/services/staffAuth';
import { AdminLog } from '@/lib/models/AdminLog';
import { Application, ServerMember } from '@/lib/models';
import {
  cleanStaffReason, isAppCategory, isStaffVerificationAction, LISTING_LIMITS, planStaffVerification, showsVerified,
  validateStaffListingPatch,
} from '@/lib/appDirectory/listing';
import { clampLimit, decodeCursor, isDirectorySort, DIRECTORY_SEARCH_MAX, type DirectorySort } from '@/lib/appDirectory/paging';
import {
  appDirectoryOverview, getAppForStaff, getBotAppCached, getDirectoryAppCached, installedAppsForServer, invalidateAppDirectory,
  listDirectoryApps, listVerificationQueue, searchAppsForStaff, STAFF_DIRECTORY_FILTERS, syncBotUserVerified,
  type StaffDirectoryFilter, type VerificationQueueStatus,
} from '@/lib/services/appDirectory';

type Cookies = Record<string, { value?: unknown }>;

async function limitByIp(request: Request, set: { status?: number | string; headers?: Record<string, string | number> }) {
  const r = await checkRateLimit('appDirectory', getClientIP(request));
  if (r.success) return null;
  set.status = 429;
  return { error: 'Too many requests', retryAfter: r.retryAfter };
}

export const appDirectoryRoutes = new Elysia({ prefix: '/apps' })
  .get('/directory', async ({ query, request, set }) => {
    const limited = await limitByIp(request, set);
    if (limited) return limited;
    const q = query as Record<string, string | undefined>;

    const search = typeof q.search === 'string' ? q.search.trim() : '';
    if (search.length > DIRECTORY_SEARCH_MAX) { set.status = 400; return { error: 'Search is too long' }; }
    const category = q.category ? q.category : null;
    if (category !== null && !isAppCategory(category)) { set.status = 400; return { error: 'Unknown category' }; }
    if (q.sort && !isDirectorySort(q.sort)) { set.status = 400; return { error: 'Unknown sort' }; }
    const sort: DirectorySort = isDirectorySort(q.sort) ? q.sort : 'popular';
    const cursor = q.cursor ? decodeCursor(q.cursor, sort) : null;
    if (q.cursor && !cursor) { set.status = 400; return { error: 'Invalid cursor' }; }

    const page = await listDirectoryApps({
      search, category, sort, cursor, limit: clampLimit(q.limit), featuredOnly: q.featured === 'true', officialOnly: q.official === 'true',
    });
    set.headers['Cache-Control'] = 'public, max-age=30';
    return { apps: page.items, nextCursor: page.nextCursor, total: page.total };
  })

  .get('/directory/:appId', async ({ params, request, set }) => {
    const limited = await limitByIp(request, set);
    if (limited) return limited;
    if (!isValidObjectId(params.appId)) { set.status = 400; return { error: 'Invalid ID format' }; }
    const app = await getDirectoryAppCached(params.appId);
    if (!app) { set.status = 404; return { error: 'App not found' }; }
    set.headers['Cache-Control'] = 'public, max-age=30';
    return { app };
  })

  .get('/by-bot/:userId', async ({ params, request, set }) => {
    const limited = await limitByIp(request, set);
    if (limited) return limited;
    if (!isValidObjectId(params.userId)) { set.status = 400; return { error: 'Invalid ID format' }; }
    const app = await getBotAppCached(params.userId);
    if (!app) { set.status = 404; return { error: 'App not found' }; }
    set.headers['Cache-Control'] = 'public, max-age=60';
    return { app };
  })

  .get('/installed', async ({ headers, cookie, query, set }) => {
    const authToken = (cookie as Cookies).auth_token?.value;
    const { user, error } = await authenticateRequest(headers.authorization ?? null, typeof authToken === 'string' ? { auth_token: authToken } : {});
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const serverId = (query as Record<string, string | undefined>).serverId ?? '';
    if (!isValidObjectId(serverId)) { set.status = 400; return { error: 'Invalid ID format' }; }
    const member = await ServerMember.findOne({ serverId, userId: user.id });
    if (!member) { set.status = 403; return { error: 'You are not a member of this server' }; }
    return { apps: await installedAppsForServer(serverId) };
  });

// ─── Staff ───────────────────────────────────────────────────────────────────

async function logAppAction(adminId: string, appId: string, details: Record<string, unknown>, reason?: string | null) {
  try {
    // admin_action_type has no app-specific values; app actions are recorded
    // as platform updates with an `op` (like badges and TTS), so no enum change.
    await AdminLog.create({
      adminId, action: 'update_settings', targetType: 'platform', targetId: `application:${appId}`,
      details: { appDirectory: true, ...details }, reason: reason ?? undefined,
    });
  } catch (error) {
    console.error('Failed to log app directory action:', error);
  }
}

const QUEUE_STATUSES: ReadonlySet<string> = new Set(['pending', 'approved', 'rejected']);
const STAFF_FILTERS: ReadonlySet<string> = new Set(STAFF_DIRECTORY_FILTERS);

/**
 * After a staff change to verified/official: sync the bot user's
 * users.is_verified (BOT tag check), the owner's Verified Bot Developer badge
 * and the bot's Official SerikaCord App badge. Badge work runs in the background.
 */
async function syncAppIdentity(app: { ownerId: string; botId?: string | null }, next: { verified: boolean; official: boolean }) {
  try {
    await syncBotUserVerified(app.botId, showsVerified(next));
  } catch (error) {
    console.error('Failed to sync bot user verification:', error);
  }
  const { recalculateUserBadges } = await import('@/lib/services/badges');
  void recalculateUserBadges(app.ownerId).catch(() => {});
  if (app.botId) void recalculateUserBadges(app.botId).catch(() => {});
}

export const adminAppRoutes = new Elysia({ prefix: '/admin/apps' })
  .get('/overview', async ({ headers, cookie, set }) => {
    const auth = await getStaffAuth(headers, cookie as Cookies, 'apps.manage');
    if (!auth.user) { set.status = auth.status; return { error: auth.error }; }
    return { overview: await appDirectoryOverview() };
  })

  .get('/verification', async ({ headers, cookie, query, set }) => {
    const auth = await getStaffAuth(headers, cookie as Cookies, 'apps.manage');
    if (!auth.user) { set.status = auth.status; return { error: auth.error }; }
    const status = (query as Record<string, string | undefined>).status ?? 'pending';
    if (!QUEUE_STATUSES.has(status)) { set.status = 400; return { error: 'Unknown status' }; }
    return { apps: await listVerificationQueue(status as VerificationQueueStatus) };
  })

  .post('/:appId/verification', async ({ headers, cookie, params, body, set }) => {
    const auth = await getStaffAuth(headers, cookie as Cookies, 'apps.manage');
    if (!auth.user) { set.status = auth.status; return { error: auth.error }; }
    if (!isValidObjectId(params.appId)) { set.status = 400; return { error: 'Invalid ID format' }; }
    const b = (body && typeof body === 'object' ? body : {}) as { action?: unknown; reason?: unknown };
    const action = b.action;
    if (!isStaffVerificationAction(action)) { set.status = 400; return { error: 'Unknown action' }; }
    const reason = cleanStaffReason(b.reason, LISTING_LIMITS.verificationNote);

    const app = await Application.findById(params.appId);
    if (!app) { set.status = 404; return { error: 'Application not found' }; }
    const plan = planStaffVerification(app, action, reason);
    if (!plan.ok) { set.status = plan.httpStatus; return { error: plan.error }; }

    await Application.updateById(app.id, {
      verificationReviewedAt: new Date(),
      verificationReviewedBy: auth.user.id,
      verified: plan.verified,
      verificationStatus: plan.verificationStatus,
      verificationNote: reason,
    });
    await syncAppIdentity(app, { verified: plan.verified, official: app.official === true });
    invalidateAppDirectory();
    await logAppAction(auth.user.id, app.id, {
      op: `app_verification_${action}`, appName: app.name, ownerId: app.ownerId, botId: app.botId ?? null,
      previousStatus: app.verificationStatus, previousVerified: app.verified === true,
    }, reason);
    return { app: await getAppForStaff(app.id) };
  })

  .post('/:appId/official', async ({ headers, cookie, params, body, set }) => {
    const auth = await getStaffAuth(headers, cookie as Cookies, 'apps.manage');
    if (!auth.user) { set.status = auth.status; return { error: auth.error }; }
    if (!isValidObjectId(params.appId)) { set.status = 400; return { error: 'Invalid ID format' }; }
    const b = (body && typeof body === 'object' ? body : {}) as { official?: unknown; reason?: unknown };
    if (typeof b.official !== 'boolean') { set.status = 400; return { error: 'official must be a boolean' }; }
    const reason = cleanStaffReason(b.reason, LISTING_LIMITS.verificationNote);

    const app = await Application.findById(params.appId);
    if (!app) { set.status = 404; return { error: 'Application not found' }; }
    if ((app.official === true) === b.official) {
      set.status = 409;
      return { error: b.official ? 'Application is already official' : 'Application is not official' };
    }

    await Application.updateById(app.id, { official: b.official });
    await syncAppIdentity(app, { verified: app.verified === true, official: b.official });
    invalidateAppDirectory();
    await logAppAction(auth.user.id, app.id, {
      op: b.official ? 'app_official_on' : 'app_official_off', appName: app.name, ownerId: app.ownerId, botId: app.botId ?? null,
    }, reason);
    return { app: await getAppForStaff(app.id) };
  })

  .post('/:appId/listing', async ({ headers, cookie, params, body, set }) => {
    const auth = await getStaffAuth(headers, cookie as Cookies, 'apps.manage');
    if (!auth.user) { set.status = auth.status; return { error: auth.error }; }
    if (!isValidObjectId(params.appId)) { set.status = 400; return { error: 'Invalid ID format' }; }
    const r = validateStaffListingPatch(body);
    if (!r.ok) { set.status = 400; return { error: r.error }; }
    const reason = cleanStaffReason((body as { reason?: unknown }).reason, LISTING_LIMITS.delistReason);

    const app = await Application.findById(params.appId);
    if (!app) { set.status = 404; return { error: 'Application not found' }; }

    const update: Record<string, unknown> = {};
    const before: Record<string, unknown> = {};
    if (r.patch.shortDescription !== undefined) { update.description = r.patch.shortDescription; before.description = app.description ?? ''; }
    if (r.patch.categories !== undefined) { update.directoryCategories = r.patch.categories; before.directoryCategories = app.directoryCategories ?? []; }
    if (r.patch.tags !== undefined) { update.tags = r.patch.tags; before.tags = app.tags ?? []; }
    await Application.updateById(app.id, update);
    invalidateAppDirectory();
    await logAppAction(auth.user.id, app.id, { op: 'app_listing_edit', appName: app.name, ownerId: app.ownerId, before, after: update }, reason);
    return { app: await getAppForStaff(app.id) };
  })

  .get('/directory', async ({ headers, cookie, query, set }) => {
    const auth = await getStaffAuth(headers, cookie as Cookies, 'apps.manage');
    if (!auth.user) { set.status = auth.status; return { error: auth.error }; }
    const q = query as Record<string, string | undefined>;
    const filter = q.filter ?? 'all';
    if (!STAFF_FILTERS.has(filter)) { set.status = 400; return { error: 'Unknown filter' }; }
    const page = Math.max(1, Math.min(1000, parseInt(q.page ?? '1', 10) || 1));
    const limit = 25;
    const search = typeof q.search === 'string' ? q.search.slice(0, 100) : null;
    const result = await searchAppsForStaff({ search, filter: filter as StaffDirectoryFilter, page, limit });
    return { ...result, page, limit };
  })

  .post('/:appId/directory', async ({ headers, cookie, params, body, set }) => {
    const auth = await getStaffAuth(headers, cookie as Cookies, 'apps.manage');
    if (!auth.user) { set.status = auth.status; return { error: auth.error }; }
    if (!isValidObjectId(params.appId)) { set.status = 400; return { error: 'Invalid ID format' }; }
    const b = (body && typeof body === 'object' ? body : {}) as { featured?: unknown; delisted?: unknown; reason?: unknown };
    if (b.featured !== undefined && typeof b.featured !== 'boolean') { set.status = 400; return { error: 'featured must be a boolean' }; }
    if (b.delisted !== undefined && typeof b.delisted !== 'boolean') { set.status = 400; return { error: 'delisted must be a boolean' }; }
    if (b.featured === undefined && b.delisted === undefined) { set.status = 400; return { error: 'Nothing to update' }; }
    const reason = cleanStaffReason(b.reason, LISTING_LIMITS.delistReason);
    if (b.delisted === true && !reason) { set.status = 400; return { error: 'A reason is required to delist an app' }; }

    const app = await Application.findById(params.appId);
    if (!app) { set.status = 404; return { error: 'Application not found' }; }

    const update: Record<string, unknown> = {};
    if (b.featured !== undefined) update.directoryFeatured = b.featured;
    if (b.delisted === true) {
      update.directoryDelisted = true;
      update.directoryDelistedReason = reason;
      // A delisted app can't stay featured.
      update.directoryFeatured = false;
    } else if (b.delisted === false) {
      update.directoryDelisted = false;
      update.directoryDelistedReason = null;
    }
    await Application.updateById(app.id, update);
    invalidateAppDirectory();
    const ops: string[] = [];
    if (b.featured !== undefined && b.delisted !== true) ops.push(b.featured ? 'app_feature' : 'app_unfeature');
    if (b.delisted !== undefined) ops.push(b.delisted ? 'app_delist' : 'app_relist');
    await logAppAction(auth.user.id, app.id, { op: ops.join(','), appName: app.name, ownerId: app.ownerId, ...update }, reason);
    return { app: await getAppForStaff(app.id) };
  });
