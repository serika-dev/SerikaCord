import { Elysia, t } from 'elysia';
import { authenticateRequest } from '@/lib/services/auth';
import { User, RichPresence, WidgetConfig, WidgetUserData, Application } from '@/lib/models';
import {
  getUserLibrary, getUserCategory, isValidCategory, addGame, removeGame, updateGame,
} from '@/lib/services/gamesLibrary';

/**
 * Serika Social SDK — public native API (`/api/v1`).
 *
 * Designed so a native binary SDK can wrap these HTTP endpoints later. Auth is
 * a bearer token (OAuth2 access token) or the session cookie; application-scoped
 * writes additionally validate the caller against the target application.
 * See docs/social-sdk-design.md §2.
 */

async function auth(headers: Record<string, string | undefined>, cookie: Record<string, { value?: unknown }>) {
  const authHeader = headers.authorization ?? null;
  const token = cookie.auth_token?.value;
  const cookies: Record<string, string> = {};
  if (typeof token === 'string') cookies.auth_token = token;
  return authenticateRequest(authHeader, cookies);
}

function publicUser(u: any) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    display_name: u.displayName ?? u.username,
    avatar: u.avatar ?? null,
    banner: u.banner ?? null,
    bio: u.bio ?? null,
    pronouns: u.pronouns ?? null,
    status: u.status ?? 'offline',
    badges: u.badges ?? [],
    bot: !!u.isBot,
    created_at: u.createdAt ?? null,
  };
}

function serializePresence(doc: any) {
  return {
    type: doc.type,
    name: doc.name,
    details: doc.details ?? null,
    state: doc.state ?? null,
    application_id: doc.applicationId ?? null,
    assets: doc.assets ?? {
      large_image: doc.largeImageUrl ?? null,
      large_text: doc.largeImageText ?? null,
      small_image: doc.smallImageUrl ?? null,
      small_text: doc.smallImageText ?? null,
    },
    buttons: doc.buttons ?? null,
    party_id: doc.partyId ?? null,
    party_size: doc.partySize ?? null,
    started_at: doc.startedAt ?? null,
    ends_at: doc.endsAt ?? null,
    expires_at: doc.expiresAt ?? null,
  };
}

export const socialSdkRoutes = new Elysia({ prefix: '/v1' })
  // ── Identity ──────────────────────────────────────────────────────────────
  .get('/users/@me', async ({ headers, cookie, set }) => {
    const { user } = await auth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    return publicUser(user);
  })
  .get('/users/:id', async ({ headers, cookie, params, set }) => {
    const { user } = await auth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    const target = params.id === '@me' ? user : await User.findById(params.id);
    if (!target) { set.status = 404; return { error: 'User not found' }; }
    return publicUser(target);
  })

  // ── Relationships (Social SDK core) ───────────────────────────────────────
  .get('/users/@me/relationships', async ({ headers, cookie, set }) => {
    const { user } = await auth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    const u = user as any;
    const friendIds: string[] = u.friends ?? [];
    const blockedIds: string[] = u.blockedUsers ?? [];
    const [friends, blocked] = await Promise.all([
      Promise.all(friendIds.map((id) => User.findById(id))),
      Promise.all(blockedIds.map((id) => User.findById(id))),
    ]);
    return {
      relationships: [
        ...friends.filter(Boolean).map((f) => ({ type: 'friend', user: publicUser(f) })),
        ...blocked.filter(Boolean).map((b) => ({ type: 'blocked', user: publicUser(b) })),
      ],
    };
  })

  // ── Presence ──────────────────────────────────────────────────────────────
  .get('/users/:id/presences', async ({ headers, cookie, params, set }) => {
    const { user } = await auth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    const targetId = params.id === '@me' ? (user as any).id : params.id;
    const docs = await RichPresence.find({ userId: targetId });
    const now = Date.now();
    const active = (docs as any[]).filter((d) => d.expiresAt && new Date(d.expiresAt).getTime() > now);
    return { presences: active.map(serializePresence) };
  })

  // ── Game library ──────────────────────────────────────────────────────────
  .get('/users/:id/games', async ({ headers, cookie, params, query, set }) => {
    const { user } = await auth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    const targetId = params.id === '@me' ? (user as any).id : params.id;
    const category = (query as Record<string, string | undefined>).category;
    if (category) {
      if (!isValidCategory(category)) { set.status = 400; return { error: 'Invalid category' }; }
      return { games: await getUserCategory(targetId, category) };
    }
    return { library: await getUserLibrary(targetId) };
  })
  .post('/users/@me/games', async ({ headers, cookie, body, set }) => {
    const { user } = await auth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    const b = body as any;
    if (!isValidCategory(b.category)) { set.status = 400; return { error: 'Invalid category' }; }
    try {
      return { game: await addGame((user as any).id, b.category, b) };
    } catch (e) {
      const err = e as { status?: number; message?: string };
      set.status = err.status || 400;
      return { error: err.message || 'Failed to add game' };
    }
  }, {
    body: t.Object({
      category: t.String(),
      igdbId: t.Optional(t.Number()),
      steamAppId: t.Optional(t.String()),
      name: t.String({ minLength: 1, maxLength: 256 }),
      coverUrl: t.Optional(t.String({ maxLength: 1024 })),
      tags: t.Optional(t.Array(t.String({ maxLength: 48 }), { maxItems: 12 })),
      note: t.Optional(t.String({ maxLength: 512 })),
    }),
  })
  .patch('/users/@me/games/:id', async ({ headers, cookie, params, body, set }) => {
    const { user } = await auth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    try {
      return { game: await updateGame((user as any).id, params.id, body as any) };
    } catch (e) {
      const err = e as { status?: number; message?: string };
      set.status = err.status || 400;
      return { error: err.message || 'Failed to update game' };
    }
  }, {
    body: t.Object({
      tags: t.Optional(t.Array(t.String({ maxLength: 48 }), { maxItems: 12 })),
      note: t.Optional(t.Union([t.String({ maxLength: 512 }), t.Null()])),
      coverUrl: t.Optional(t.Union([t.String({ maxLength: 1024 }), t.Null()])),
    }),
  })
  .delete('/users/@me/games/:id', async ({ headers, cookie, params, set }) => {
    const { user } = await auth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    try {
      await removeGame((user as any).id, params.id);
      return { success: true };
    } catch (e) {
      const err = e as { status?: number; message?: string };
      set.status = err.status || 400;
      return { error: err.message || 'Failed to remove game' };
    }
  })

  // ── Widget config (public, published only) ────────────────────────────────
  .get('/applications/:id/widget/config', async ({ params, set }) => {
    const config = await WidgetConfig.findByApplication(params.id);
    if (!config || config.status !== 'published') { set.status = 404; return { error: 'No published widget for this application' }; }
    return {
      application_id: config.applicationId,
      name: config.name,
      surfaces: config.surfaces,
      version: config.version,
    };
  })

  // ── Widget user-data (per-user dynamic values) ────────────────────────────
  .put('/applications/:id/users/@me/widget-data', async ({ headers, cookie, params, body, set }) => {
    const { user } = await auth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    const app = await Application.findById(params.id);
    if (!app) { set.status = 404; return { error: 'Application not found' }; }
    const saved = await WidgetUserData.upsert(params.id, (user as any).id, (body as any).data ?? body);
    return { ok: true, updated_at: saved?.updatedAt ?? null };
  }, {
    body: t.Object({
      data: t.Optional(t.Any()),
    }),
  })
  .get('/applications/:id/users/:uid/widget-data', async ({ headers, cookie, params, set }) => {
    const { user } = await auth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    const targetId = params.uid === '@me' ? (user as any).id : params.uid;
    const row = await WidgetUserData.findOne({ applicationId: params.id, userId: targetId });
    return { data: row?.data ?? null, updated_at: row?.updatedAt ?? null };
  });
