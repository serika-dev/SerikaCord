import { Elysia, t } from 'elysia';
import { authenticateRequest } from '@/lib/services/auth';
import { User, RichPresence, WidgetConfig, WidgetUserData, Application } from '@/lib/models';
import {
  getUserLibrary, getUserCategory, isValidCategory, addGame, removeGame, updateGame,
} from '@/lib/services/gamesLibrary';
import {
  WIDGET_SURFACES, GAME_WIDGET_TYPES, GAME_WIDGET_LIMITS, GAME_WIDGET_TAG_VALUES, GAME_WIDGET_SKILL_TAGS,
  type GameWidgetType,
} from '@/lib/constants/widgets';

/** Serialize the layout definitions into the Discord "layout definition" shape. */
function layoutDefinitions() {
  return WIDGET_SURFACES.flatMap((surface) =>
    surface.layouts.map((l) => ({
      key: l.key,
      surface: surface.key,
      display_name: l.label,
      components: Object.fromEntries(l.components.map((c) => [c.key, {
        display_name: c.label,
        required: !!c.required,
        fields: Object.fromEntries(c.fields.map((f) => [f.key, {
          display_name: f.label,
          required: !!f.required,
          allowed_presentation_types: f.allowedPresentationTypes ?? (f.kind === 'image' ? ['image'] : ['text']),
        }])),
      }])),
    })),
  );
}

/** Validate + normalize an incoming array of Game Widget Objects. */
function normalizeGameWidgets(input: unknown): { ok: true; widgets: any[] } | { ok: false; error: string } {
  const arr = Array.isArray(input) ? input : [];
  const seen = new Set<string>();
  const widgets: any[] = [];
  for (const raw of arr) {
    const data = (raw as any)?.data ?? {};
    const type = data.type as GameWidgetType;
    if (!GAME_WIDGET_TYPES.includes(type)) return { ok: false, error: `Invalid widget type: ${type}` };
    if (seen.has(type)) return { ok: false, error: `Duplicate widget type: ${type}` };
    seen.add(type);
    const games = Array.isArray(data.games) ? data.games : [];
    if (type !== 'application' && games.length > GAME_WIDGET_LIMITS[type]) {
      return { ok: false, error: `${type} allows at most ${GAME_WIDGET_LIMITS[type]} games` };
    }
    for (const g of games) {
      const tags: string[] = Array.isArray(g.tags) ? g.tags : [];
      if (tags.some((tg) => !GAME_WIDGET_TAG_VALUES.includes(tg as any))) return { ok: false, error: 'Unknown game widget tag' };
      if (tags.filter((tg) => GAME_WIDGET_SKILL_TAGS.includes(tg as any)).length > 1) {
        return { ok: false, error: 'Only one skill tag is allowed per game' };
      }
    }
    widgets.push({
      id: (raw as any)?.id ?? `${type}:${Date.now()}`,
      updated_at: new Date().toISOString(),
      data: {
        type,
        ...(type === 'application' ? { application_id: data.application_id } : { games }),
      },
    });
  }
  return { ok: true, widgets };
}

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
  })

  // ── Layout definitions (public) ───────────────────────────────────────────
  .get('/widget-configs/layout-definitions', () => ({ definitions: layoutDefinitions() }))

  // ── Featured widget configs (published, grouped by application) ────────────
  .get('/widget-configs/featured', async () => {
    const configs = await WidgetConfig.findPublished(50);
    const byApp: Record<string, any[]> = {};
    for (const c of configs) {
      (byApp[c.applicationId] ??= []).push({
        application_id: c.applicationId,
        config_id: c.id,
        display_name: c.name,
        surfaces: c.surfaces,
        status: c.status,
        published_at: c.publishedAt ?? null,
        updated_at: c.updatedAt ?? null,
      });
    }
    return { application_ids: Object.keys(byApp), configs: byApp };
  })

  // ── Profile game widgets (Game Widget Objects, max 1 per type) ─────────────
  .put('/users/@me/widgets', async ({ headers, cookie, body, set }) => {
    const { user } = await auth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    const result = normalizeGameWidgets((body as any).widgets);
    if (!result.ok) { set.status = 400; return { error: result.error }; }
    // Preserve existing application placements; replace game-widget entries.
    const existing: any[] = Array.isArray((user as any).profileWidgets) ? (user as any).profileWidgets : [];
    const appPlacements = existing.filter((p) => p.type === 'application');
    await User.updateById((user as any).id, { profileWidgets: [...result.widgets, ...appPlacements] });
    return { widgets: result.widgets };
  }, {
    body: t.Object({ widgets: t.Array(t.Any(), { maxItems: GAME_WIDGET_TYPES.length }) }),
  })

  // ── Suggested games for profile widgets ────────────────────────────────────
  .get('/users/@me/widgets/suggested-games', async ({ headers, cookie, set }) => {
    const { user } = await auth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    const lib = await getUserLibrary((user as any).id) as Record<string, any[]>;
    const idOf = (g: any) => String(g.igdbId ?? g.gameId ?? g.id ?? '');
    const suggested = [...(lib.favorite ?? []), ...(lib.liked ?? []), ...(lib.rotation ?? [])].map(idOf).filter(Boolean);
    const wishlist = (lib.wishlist ?? []).map(idOf).filter(Boolean);
    return { suggested_games: suggested, suggested_wishlist_games: wishlist };
  })

  // ── User application identities ─────────────────────────────────────────────
  .get('/users/:id/application-identities', async ({ headers, cookie, params, set }) => {
    const { user } = await auth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    // Identity data is provider-issued; we currently surface widget-data owners.
    const targetId = params.id === '@me' ? (user as any).id : params.id;
    const { db, schema } = await import('@/lib/db/postgres');
    const { eq } = await import('drizzle-orm');
    const rows = await db.select({ applicationId: schema.widgetUserData.applicationId })
      .from(schema.widgetUserData)
      .where(eq(schema.widgetUserData.userId, targetId));
    return { identities: rows.map((r) => ({ application_id: r.applicationId, provider_issued_user_id: targetId })) };
  });
