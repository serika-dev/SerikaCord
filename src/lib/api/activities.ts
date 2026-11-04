/**
 * Activities (Embedded App SDK, CORD-92), user-side routes (session auth):
 *
 *   GET  /api/activities/shelf?channelId=&voice=   apps that can launch here + what's running
 *   POST /api/activities/launch                    launch (or join the running one)
 *   GET  /api/activities/instances/:id             an instance (Game Invitation card, call bar)
 *   POST /api/activities/instances/:id/join        join; returns what the frame needs
 *   POST /api/activities/instances/:id/heartbeat   the frame is still open
 *   POST /api/activities/instances/:id/leave       closed the frame
 *   POST /api/activities/instances/:id/rpc         SDK commands that need the server
 *   GET  /api/activities/instances/:id/authorized  did the user already grant these scopes
 *
 * Only SerikaCord's own pages call these (same-origin session). The Activity's
 * frame is on another site and can't. Rules: src/lib/services/activityInstances.ts.
 */
import { Elysia, t } from 'elysia';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { config } from '@/lib/config';
import { User, Channel } from '@/lib/models';
import { authenticateRequest } from '@/lib/services/auth';
import { checkRateLimit, isValidObjectId } from '@/lib/security';
import { activityHostLabel, activityOrigin } from '@/lib/activities/settings';
import { isInstanceId, locationId, platformFamily, sdkPlatform, type ActivityInstanceRecord } from '@/lib/activities/instances';

type Cookie = Record<string, { value?: unknown }>;

async function sessionUser(headers: Record<string, string | undefined>, cookie: Cookie) {
  const authToken = cookie.auth_token?.value;
  const cookies: Record<string, string> = {};
  if (typeof authToken === 'string') cookies.auth_token = authToken;
  const { user } = await authenticateRequest(headers.authorization ?? null, cookies);
  if (!user) return null;
  const row = await User.findById(user.id);
  return row && !row.isBot ? row : null;
}

const PLATFORM = t.Optional(t.Union([t.Literal('web'), t.Literal('desktop'), t.Literal('ios'), t.Literal('android')]));

/** What the SerikaCord window needs to build the relay frame URL (ids in the app's format). */
async function frameInfo(rec: ActivityInstanceRecord, platform: string) {
  const { loadActivityApp, publicIdsFor } = await import('@/lib/services/activityInstances');
  const app = await loadActivityApp(rec.applicationId);
  const label = app ? activityHostLabel(app.clientId, rec.overrideToken ?? null) : null;
  if (!app || !label || !config.ACTIVITIES_DOMAIN) return null;
  const ids = await publicIdsFor(app, [rec.location.channelId, rec.location.guildId]);
  const channelId = ids.get(rec.location.channelId.toLowerCase()) ?? rec.location.channelId;
  const guildId = rec.location.guildId ? ids.get(rec.location.guildId.toLowerCase()) ?? rec.location.guildId : null;
  return {
    clientId: app.clientId,
    origin: activityOrigin(label, config.ACTIVITIES_DOMAIN, config.FRONTEND_URL),
    query: {
      instance_id: rec.id,
      launch_id: rec.launchId,
      location_id: locationId({ kind: rec.location.kind, channelId, guildId }),
      channel_id: channelId,
      ...(guildId ? { guild_id: guildId } : {}),
      platform: sdkPlatform(platform),
    },
    orientation: { phone: app.settings.orientationLockPhone, tablet: app.settings.orientationLockTablet },
    /** Where it runs, in SerikaCord ids (the client docks the frame there). */
    location: { channelId: rec.location.channelId, guildId: rec.location.guildId, voice: Boolean(rec.location.voiceRoomId) },
    app: { name: app.name, icon: app.icon, ageGated: app.settings.ageGated },
  };
}

async function limited(bucket: 'activityLaunch' | 'activityRpc' | 'activityHeartbeat', userId: string): Promise<boolean> {
  return !(await checkRateLimit(bucket, userId)).success;
}

export const activityRoutes = new Elysia({ prefix: '/activities' })
  .get('/shelf', async ({ headers, cookie, query, set }) => {
    const user = await sessionUser(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    const channelId = String(query.channelId ?? '');
    if (!isValidObjectId(channelId)) { set.status = 400; return { error: 'Invalid channel' }; }
    if (!config.ACTIVITIES_DOMAIN) return { available: false, apps: [], running: [] };
    const channel = await Channel.findById(channelId);
    if (!channel) { set.status = 404; return { error: 'Unknown channel' }; }
    const { channelInstances } = await import('@/lib/services/activityInstances');
    const running = await channelInstances(user.id, channelId);
    // Like Discord's shelf: verified (and official) apps, the user's own apps,
    // and apps the user authorized (e.g. through the app's invite link).
    // Doodle Party is built in. Other unverified apps don't show.
    const rows = await db.select({
      id: schema.applications.id,
      name: schema.applications.name,
      icon: schema.applications.icon,
      coverImage: schema.applications.coverImage,
      ownerId: schema.applications.ownerId,
      verified: schema.applications.verified,
      official: schema.applications.official,
      description: schema.applications.description,
      directoryDelisted: schema.applications.directoryDelisted,
      displayName: schema.applicationActivitySettings.displayName,
      imageUrl: schema.applicationActivitySettings.imageUrl,
      ageGated: schema.applicationActivitySettings.ageGated,
      supportedPlatforms: schema.applicationActivitySettings.supportedPlatforms,
    })
      .from(schema.applicationActivitySettings)
      .innerJoin(schema.applications, eq(schema.applications.id, schema.applicationActivitySettings.applicationId))
      .where(and(eq(schema.applicationActivitySettings.enabled, true)))
      .limit(300)
      .catch(() => []);
    const { AuthorizedApp } = await import('@/lib/models');
    const authorized = new Set(
      ((await AuthorizedApp.find({ userId: user.id }).catch(() => [])) as Array<{ applicationId?: string | null }>)
        .map((a) => (a.applicationId ?? '').toLowerCase()).filter(Boolean),
    );
    const { doodleAppId } = await import('@/lib/activityApps/doodle/server');
    const builtIn = doodleAppId();
    const mine = (r: { ownerId: string }) => r.ownerId.toLowerCase() === user.id.toLowerCase();
    const apps = rows
      .filter((r) => mine(r) || r.official || (r.verified && !r.directoryDelisted) || r.id.toLowerCase() === builtIn || authorized.has(r.id.toLowerCase()))
      .map((r) => ({
        id: r.id,
        name: r.displayName || r.name,
        icon: r.icon ?? null,
        imageUrl: r.imageUrl ?? r.coverImage ?? null,
        description: r.description ?? '',
        ageGated: Boolean(r.ageGated),
        supportedPlatforms: r.supportedPlatforms ?? ['web', 'desktop'],
        developer: mine(r),
        verified: Boolean(r.verified || r.official),
      }))
      .sort((a, b) => Number(b.developer) - Number(a.developer) || Number(b.verified) - Number(a.verified) || a.name.localeCompare(b.name))
      .slice(0, 100);
    const { recentActivityApps } = await import('@/lib/services/activityInstances');
    const known = new Set(apps.map((a) => a.id.toLowerCase()));
    const recents = (await recentActivityApps(user.id)).filter((id) => known.has(id.toLowerCase())).slice(0, 8);
    const settings = (user as { settings?: { advanced?: { developerMode?: boolean } } }).settings;
    return { available: true, developerMode: settings?.advanced?.developerMode === true, apps, recents, running };
  })

  .post('/launch', async ({ headers, cookie, body, set }) => {
    const user = await sessionUser(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    if (!isValidObjectId(body.applicationId) || !isValidObjectId(body.channelId)) { set.status = 400; return { error: 'Invalid ID format' }; }
    if (await limited('activityLaunch', user.id)) { set.status = 429; return { error: 'You are launching Activities too fast.', code: 'rate_limited' }; }
    const platform = platformFamily(body.platform);
    // Developer shelf: "Use Activity URL Override" (own apps, developer mode on).
    let urlOverride: string | null = null;
    if (typeof body.urlOverride === 'string' && body.urlOverride.trim()) {
      const devMode = (user as { settings?: { advanced?: { developerMode?: boolean } } }).settings?.advanced?.developerMode === true;
      const { Application } = await import('@/lib/models');
      const app = await Application.findById(body.applicationId);
      if (!devMode || !app || app.ownerId.toLowerCase() !== user.id.toLowerCase()) {
        set.status = 403; return { error: 'Only the app\'s owner can use a URL override (with Developer Mode on).', code: 'override_forbidden' };
      }
      const { normalizeTarget } = await import('@/lib/activities/settings');
      const raw = body.urlOverride.trim().replace(/^https?:\/\//i, '');
      const t = normalizeTarget(raw, [], { blockedHosts: [config.ACTIVITIES_DOMAIN, 'activities.localhost'].filter(Boolean) });
      if (!t.ok) { set.status = 400; return { error: t.message, code: 'bad_override' }; }
      urlOverride = t.target;
    }
    const { launchActivity } = await import('@/lib/services/activityInstances');
    const r = await launchActivity({
      user: { id: user.id, username: user.username },
      applicationId: body.applicationId,
      channelId: body.channelId,
      voice: Boolean(body.voice),
      platform,
      ageConfirmed: body.ageConfirmed === true,
      urlOverride,
    });
    if (!r.ok) { set.status = r.status; return { error: r.error, code: r.reason }; }
    const frame = await frameInfo(r.instance, platform);
    return { instanceId: r.instance.id, created: r.created, frame };
  }, {
    body: t.Object({ applicationId: t.String({ maxLength: 64 }), channelId: t.String({ maxLength: 64 }), voice: t.Optional(t.Boolean()), platform: PLATFORM, ageConfirmed: t.Optional(t.Boolean()), urlOverride: t.Optional(t.String({ maxLength: 300 })) }),
  })

  .get('/instances/:id', async ({ headers, cookie, params, set }) => {
    const user = await sessionUser(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    if (!isInstanceId(params.id)) { set.status = 404; return { error: 'Unknown Activity' }; }
    const { instanceViewFor } = await import('@/lib/services/activityInstances');
    const view = await instanceViewFor(user.id, params.id);
    // Gone from Redis = ended long ago (the card shows "ended").
    if (!view) return { id: params.id, ended: true };
    return view;
  })

  .post('/instances/:id/join', async ({ headers, cookie, params, body, set }) => {
    const user = await sessionUser(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    if (!isInstanceId(params.id)) { set.status = 404; return { error: 'Unknown Activity' }; }
    if (await limited('activityLaunch', user.id)) { set.status = 429; return { error: 'You are joining Activities too fast.', code: 'rate_limited' }; }
    const platform = platformFamily(body.platform);
    const { joinActivity } = await import('@/lib/services/activityInstances');
    const r = await joinActivity({ id: user.id }, params.id, platform, body.ageConfirmed === true);
    if (!r.ok) { set.status = r.status; return { error: r.error, code: r.reason }; }
    const frame = await frameInfo(r.instance, platform);
    if (!frame) { set.status = 503; return { error: 'Activities are not available on this server.', code: 'not_configured' }; }
    return { instanceId: r.instance.id, frame };
  }, { body: t.Object({ platform: PLATFORM, ageConfirmed: t.Optional(t.Boolean()) }) })

  .post('/instances/:id/heartbeat', async ({ headers, cookie, params, set }) => {
    const user = await sessionUser(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    if (!isInstanceId(params.id)) { set.status = 404; return { error: 'Unknown Activity' }; }
    if (await limited('activityHeartbeat', user.id)) { set.status = 429; return { error: 'Too many requests' }; }
    const { heartbeatActivity } = await import('@/lib/services/activityInstances');
    return { active: await heartbeatActivity({ id: user.id }, params.id) };
  })

  .post('/instances/:id/leave', async ({ headers, cookie, params, set }) => {
    const user = await sessionUser(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    if (!isInstanceId(params.id)) { set.status = 404; return { error: 'Unknown Activity' }; }
    const { leaveActivity } = await import('@/lib/services/activityInstances');
    await leaveActivity({ id: user.id }, params.id);
    return { ok: true };
  })

  .post('/instances/:id/rpc', async ({ headers, cookie, params, body, set }) => {
    const user = await sessionUser(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    if (!isInstanceId(params.id)) { set.status = 404; return { error: 'Unknown Activity' }; }
    if (await limited('activityRpc', user.id)) return { ok: false, code: 4002, message: 'Rate limited' };
    const { handleActivityRpc } = await import('@/lib/services/activityRpc');
    return handleActivityRpc(user.id, params.id, body.cmd, (body.args ?? {}) as Record<string, unknown>);
  }, {
    body: t.Object({ cmd: t.String({ maxLength: 64, pattern: '^[A-Z_]+$' }), args: t.Optional(t.Record(t.String(), t.Any())) }),
  })

  .get('/instances/:id/authorized', async ({ headers, cookie, params, query, set }) => {
    const user = await sessionUser(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    if (!isInstanceId(params.id)) { set.status = 404; return { error: 'Unknown Activity' }; }
    const { getInstance } = await import('@/lib/services/activityInstances');
    const rec = await getInstance(params.id);
    if (!rec) return { authorized: false };
    const scopes = String(query.scopes ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20);
    const { alreadyAuthorized } = await import('@/lib/services/activityRpc');
    return { authorized: scopes.length > 0 && await alreadyAuthorized(user.id, rec.applicationId, scopes) };
  });
