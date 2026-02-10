import { Elysia, t } from 'elysia';
import { authenticateRequest } from '@/lib/services/auth';

type GifItem = {
  id: string;
  title: string;
  url: string;
  previewUrl: string;
  source: 'tenor' | 'fallback';
  tags: string[];
};

const FALLBACK_GIFS: GifItem[] = [
  { id: 'cheer-1', title: 'Cheer', url: 'https://media.giphy.com/media/111ebonMs90YLu/giphy.gif', previewUrl: 'https://media.giphy.com/media/111ebonMs90YLu/200w.gif', source: 'fallback', tags: ['happy', 'cheer', 'yes'] },
  { id: 'wow-1', title: 'Wow', url: 'https://media.giphy.com/media/3oEjI6SIIHBdRxXI40/giphy.gif', previewUrl: 'https://media.giphy.com/media/3oEjI6SIIHBdRxXI40/200w.gif', source: 'fallback', tags: ['wow', 'surprised'] },
  { id: 'party-1', title: 'Party', url: 'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif', previewUrl: 'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/200w.gif', source: 'fallback', tags: ['party', 'celebration'] },
  { id: 'laugh-1', title: 'Laugh', url: 'https://media.giphy.com/media/10JhviFuU2gWD6/giphy.gif', previewUrl: 'https://media.giphy.com/media/10JhviFuU2gWD6/200w.gif', source: 'fallback', tags: ['lol', 'laugh'] },
  { id: 'thumbs-up-1', title: 'Thumbs up', url: 'https://media.giphy.com/media/XreQmk7ETCak0/giphy.gif', previewUrl: 'https://media.giphy.com/media/XreQmk7ETCak0/200w.gif', source: 'fallback', tags: ['ok', 'yes', 'approve'] },
  { id: 'sad-1', title: 'Sad', url: 'https://media.giphy.com/media/9Y5BbDSkSTiY8/giphy.gif', previewUrl: 'https://media.giphy.com/media/9Y5BbDSkSTiY8/200w.gif', source: 'fallback', tags: ['sad', 'cry'] },
  { id: 'clap-1', title: 'Clap', url: 'https://media.giphy.com/media/26u4lOMA8JKSnL9Uk/giphy.gif', previewUrl: 'https://media.giphy.com/media/26u4lOMA8JKSnL9Uk/200w.gif', source: 'fallback', tags: ['clap', 'nice'] },
  { id: 'wave-1', title: 'Wave', url: 'https://media.giphy.com/media/xT9IgG50Fb7Mi0prBC/giphy.gif', previewUrl: 'https://media.giphy.com/media/xT9IgG50Fb7Mi0prBC/200w.gif', source: 'fallback', tags: ['hello', 'wave'] },
];

async function getAuth(headers: Record<string, string | undefined>, cookie: Record<string, { value?: unknown }>) {
  const authHeader = headers.authorization ?? null;
  const authToken = cookie.auth_token?.value;
  const cookies: Record<string, string> = {};
  if (typeof authToken === 'string') {
    cookies.auth_token = authToken;
  }
  return authenticateRequest(authHeader, cookies);
}

async function searchTenor(query: string, limit: number): Promise<GifItem[]> {
  const tenorKey = process.env.TENOR_API_KEY;
  if (!tenorKey) return [];

  const endpoint = query
    ? `https://tenor.googleapis.com/v2/search?key=${encodeURIComponent(tenorKey)}&q=${encodeURIComponent(query)}&limit=${limit}&media_filter=gif,tinygif&contentfilter=medium`
    : `https://tenor.googleapis.com/v2/featured?key=${encodeURIComponent(tenorKey)}&limit=${limit}&media_filter=gif,tinygif&contentfilter=medium`;

  const res = await fetch(endpoint);
  if (!res.ok) return [];

  const data = await res.json() as {
    results?: Array<{
      id?: string;
      title?: string;
      content_description?: string;
      media_formats?: {
        gif?: { url?: string };
        tinygif?: { url?: string };
      };
      tags?: string[];
    }>;
  };

  const gifs: GifItem[] = [];
  for (const item of data.results || []) {
    const gifUrl = item.media_formats?.gif?.url;
    const tinyUrl = item.media_formats?.tinygif?.url || gifUrl;
    if (!gifUrl) continue;
    gifs.push({
      id: item.id || gifUrl,
      title: item.title || item.content_description || 'GIF',
      url: gifUrl,
      previewUrl: tinyUrl || gifUrl,
      source: 'tenor',
      tags: item.tags || [],
    });
  }
  return gifs;
}

function searchFallback(query: string, limit: number): GifItem[] {
  if (!query.trim()) {
    return FALLBACK_GIFS.slice(0, limit);
  }

  const lowered = query.trim().toLowerCase();
  return FALLBACK_GIFS
    .filter((gif) => gif.title.toLowerCase().includes(lowered) || gif.tags.some((tag) => tag.includes(lowered)))
    .slice(0, limit);
}

export const gifRoutes = new Elysia({ prefix: '/gifs' })
  .get('/search', async ({ headers, cookie, query, set }) => {
    const { user, error } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }

    const q = (query.q || '').trim();
    const limit = Math.min(parseInt(query.limit || '24', 10), 50);

    try {
      const tenorResults = await searchTenor(q, limit);
      if (tenorResults.length > 0) {
        return { gifs: tenorResults };
      }
    } catch {
      // Fallback handled below.
    }

    return { gifs: searchFallback(q, limit) };
  }, {
    query: t.Object({
      q: t.Optional(t.String()),
      limit: t.Optional(t.String()),
    }),
  });
