import { Elysia, t } from 'elysia';
import { authenticateRequest, invalidateUserCache } from '@/lib/services/auth';
import { User } from '@/lib/models';

type GifItem = {
  id: string;
  title: string;
  url: string;
  previewUrl: string;
  source: 'serika';
  tags: string[];
};

const SERIKA_GIFS_API = process.env.SERIKA_GIFS_API || 'https://gifs.serika.dev/api';
const SERIKA_GIFS_API_KEY =
  process.env.SERIKA_GIFS_API_KEY ||
  process.env.SERIKA_GIFS ||
  process.env.SERIKA_GIFS_KEY ||
  '';

async function getAuth(headers: Record<string, string | undefined>, cookie: Record<string, { value?: unknown }>) {
  const authHeader = headers.authorization ?? null;
  const authToken = cookie.auth_token?.value;
  const cookies: Record<string, string> = {};
  if (typeof authToken === 'string') {
    cookies.auth_token = authToken;
  }
  return authenticateRequest(authHeader, cookies);
}

async function searchSerikaGifs(query: string, limit: number): Promise<GifItem[]> {
  const endpoint = query.trim().length > 0
    ? `${SERIKA_GIFS_API}/gifs?search=${encodeURIComponent(query)}&limit=${limit}&page=1`
    : `${SERIKA_GIFS_API}/gifs?sort=trending&limit=${limit}&page=1`;

  const headers = getSerikaGifAuthHeaders();

  const res = await fetch(endpoint, { headers });
  if (!res.ok) {
    return [];
  }

  const data = await res.json() as {
    gifs?: Array<{
      id?: string;
      slug?: string;
      title?: string;
      url?: string;
      thumbnailUrl?: string;
      tags?: Array<{ name?: string; slug?: string } | string>;
    }>;
  };

  const gifs: GifItem[] = [];
  for (const item of data.gifs || []) {
    const gifUrl = item.url;
    if (!gifUrl) continue;

    const tags = (item.tags || []).map((tag) => {
      if (typeof tag === 'string') return tag;
      return tag.slug || tag.name || '';
    }).filter(Boolean);

    gifs.push({
      id: item.id || item.slug || gifUrl,
      title: item.title || 'GIF',
      url: gifUrl,
      previewUrl: item.thumbnailUrl || gifUrl,
      source: 'serika',
      tags,
    });
  }
  return gifs;
}

function getSerikaGifAuthHeaders(): HeadersInit {
  if (!SERIKA_GIFS_API_KEY) return {};
  return {
    'X-API-Key': SERIKA_GIFS_API_KEY,
    Authorization: `Bearer ${SERIKA_GIFS_API_KEY}`,
  };
}

function serikaUrl(path: string, params?: Record<string, string | undefined>) {
  const base = SERIKA_GIFS_API.endsWith('/') ? SERIKA_GIFS_API.slice(0, -1) : SERIKA_GIFS_API;
  const url = new URL(`${base}${path}`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

async function proxySerikaJson(
  path: string,
  params: Record<string, string | undefined>,
  set: { status?: number | string }
) {
  const upstream = await fetch(serikaUrl(path, params), {
    headers: getSerikaGifAuthHeaders(),
  });

  if (!upstream.ok) {
    set.status = upstream.status;
    let upstreamBody: unknown = null;
    try {
      upstreamBody = await upstream.json();
    } catch {
      // ignore parse errors
    }
    return {
      error: upstream.status === 429 ? 'GIF API rate limit exceeded' : 'GIF API request failed',
      upstreamStatus: upstream.status,
      upstreamBody,
    };
  }

  return upstream.json();
}

export const gifRoutes = new Elysia({ prefix: '/gifs' })
  .get('/gifs', async ({ headers, cookie, query, set }) => {
    const { user, error } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }

    return proxySerikaJson('/gifs', {
      search: query.search,
      sort: query.sort,
      tag: query.tag,
      collection: query.collection,
      limit: query.limit,
      page: query.page,
    }, set);
  }, {
    query: t.Object({
      search: t.Optional(t.String()),
      sort: t.Optional(t.String()),
      tag: t.Optional(t.String()),
      collection: t.Optional(t.String()),
      limit: t.Optional(t.String()),
      page: t.Optional(t.String()),
    }),
  })
  .get('/collections', async ({ headers, cookie, query, set }) => {
    const { user, error } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }

    return proxySerikaJson('/collections', {
      limit: query.limit,
      page: query.page,
    }, set);
  }, {
    query: t.Object({
      limit: t.Optional(t.String()),
      page: t.Optional(t.String()),
    }),
  })
  .get('/collections/:id', async ({ headers, cookie, params, set }) => {
    const { user, error } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }

    return proxySerikaJson(`/collections/${encodeURIComponent(params.id)}`, {}, set);
  })
  .get('/tags', async ({ headers, cookie, query, set }) => {
    const { user, error } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }

    // Note: the upstream /tags endpoint has no pagination support (no `page`
    // param, no pagination metadata) — passing `page` is silently ignored and
    // always returns the same slice, which used to break "load more". We
    // fetch the full tag list (max 100) once and paginate client-side.
    // Per-tag preview GIFs are fetched lazily by the client (with a random
    // sort) instead of N+1 fetching every tag here.
    return proxySerikaJson('/tags', {
      search: query.search,
      limit: query.limit,
    }, set);
  }, {
    query: t.Object({
      search: t.Optional(t.String()),
      limit: t.Optional(t.String()),
    }),
  })
  .get('/search', async ({ headers, cookie, query, set }) => {
    const { user, error } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }

    const q = (query.q || '').trim();
    const limit = Math.min(parseInt(query.limit || '24', 10), 50);

    try {
      const serikaResults = await searchSerikaGifs(q, limit);
      return { gifs: serikaResults };
    } catch {
      set.status = 502;
      return { error: 'Serika GIF service is unavailable', gifs: [] };
    }
  }, {
    query: t.Object({
      q: t.Optional(t.String()),
      limit: t.Optional(t.String()),
    }),
  })
  .get('/favorites', async ({ headers, cookie, set }) => {
    const { user, error } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
    const dbUser = await User.findById((user as any).id || (user as any)._id);
    return { favorites: dbUser?.gifFavorites || [] };
  })
  .post('/favorites', async ({ headers, cookie, body, set }) => {
    const { user, error } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
    const { url, title, source } = body as { url: string; title?: string; source?: string };
    if (!url || typeof url !== 'string') {
      set.status = 400;
      return { error: 'GIF URL is required' };
    }
    const userId = (user as any).id || (user as any)._id;
    const dbUser = await User.findById(userId);
    if (!dbUser) {
      set.status = 404;
      return { error: 'User not found' };
    }
    const favorites = (dbUser.gifFavorites as any[]) || [];
    if (!favorites.some((f: { url: string }) => f.url === url)) {
      favorites.push({ url, title: title || '', source: source || '', addedAt: Date.now() });
      const updatedFavorites = favorites.slice(-200);
      await User.updateById(userId, { gifFavorites: updatedFavorites });
      await invalidateUserCache(userId);
      return { favorites: updatedFavorites };
    }
    return { favorites: dbUser.gifFavorites };
  }, {
    body: t.Object({
      url: t.String(),
      title: t.Optional(t.String()),
      source: t.Optional(t.String()),
    }),
  })
  .delete('/favorites', async ({ headers, cookie, body, set }) => {
    const { user, error } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
    const { url } = body as { url: string };
    if (!url || typeof url !== 'string') {
      set.status = 400;
      return { error: 'GIF URL is required' };
    }
    const userId = (user as any).id || (user as any)._id;
    const dbUser = await User.findById(userId);
    if (!dbUser) {
      set.status = 404;
      return { error: 'User not found' };
    }
    const updatedFavorites = ((dbUser.gifFavorites as any[]) || []).filter((f: { url: string }) => f.url !== url);
    await User.updateById(userId, { gifFavorites: updatedFavorites });
    await invalidateUserCache(userId);
    return { favorites: updatedFavorites };
  }, {
    body: t.Object({
      url: t.String(),
    }),
  })
  // ── Emoji favorites ──────────────────────────────────────────────
  .get('/emoji-favorites', async ({ headers, cookie, set }) => {
    const { user, error } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
    const dbUser = await User.findById((user as any).id || (user as any)._id);
    return { favorites: dbUser?.emojiFavorites || [] };
  })
  .post('/emoji-favorites', async ({ headers, cookie, body, set }) => {
    const { user, error } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
    const { emoji, name, customEmojiId, url } = body as { emoji: string; name?: string; customEmojiId?: string; url?: string };
    if (!emoji || typeof emoji !== 'string') {
      set.status = 400;
      return { error: 'Emoji is required' };
    }
    const userId = (user as any).id || (user as any)._id;
    const dbUser = await User.findById(userId);
    if (!dbUser) {
      set.status = 404;
      return { error: 'User not found' };
    }
    const favorites = (dbUser.emojiFavorites as any[]) || [];
    const key = customEmojiId || emoji;
    if (!favorites.some((f: any) => (f.customEmojiId || f.emoji) === key)) {
      favorites.push({ emoji, name: name || '', customEmojiId: customEmojiId || null, url: url || null, addedAt: Date.now() });
      const updated = favorites.slice(-200);
      await User.updateById(userId, { emojiFavorites: updated });
      await invalidateUserCache(userId);
      return { favorites: updated };
    }
    return { favorites: dbUser.emojiFavorites };
  }, {
    body: t.Object({
      emoji: t.String(),
      name: t.Optional(t.String()),
      customEmojiId: t.Optional(t.String()),
      url: t.Optional(t.String()),
    }),
  })
  .delete('/emoji-favorites', async ({ headers, cookie, body, set }) => {
    const { user, error } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
    const { emoji, customEmojiId } = body as { emoji?: string; customEmojiId?: string };
    const userId = (user as any).id || (user as any)._id;
    const dbUser = await User.findById(userId);
    if (!dbUser) {
      set.status = 404;
      return { error: 'User not found' };
    }
    const key = customEmojiId || emoji;
    if (!key) {
      set.status = 400;
      return { error: 'Emoji or customEmojiId is required' };
    }
    const updated = ((dbUser.emojiFavorites as any[]) || []).filter((f: any) => (f.customEmojiId || f.emoji) !== key);
    await User.updateById(userId, { emojiFavorites: updated });
    await invalidateUserCache(userId);
    return { favorites: updated };
  }, {
    body: t.Object({
      emoji: t.Optional(t.String()),
      customEmojiId: t.Optional(t.String()),
    }),
  });
