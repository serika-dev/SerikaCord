/**
 * `/cdn-compat/*`: Discord CDN paths for bots (discord.js `rest.cdn`,
 * discord.py `Asset.BASE`), served by a fast path in server.ts. Every answer
 * is a 302 to our own CDN (config.CDN_URL + a validated storage key, see
 * ./cdn.ts cdnRedirectUrl) or a 404; nothing else is ever redirected to.
 *
 * Hash lookups: hashes the boundary emitted are remembered in-process and in
 * Redis (`cdnc:<hash>`, 30 days). On a miss (expired, other instance without
 * Redis) the entity named in the path is loaded and its current image(s)
 * re-hashed, so no extra Postgres table is needed. Emojis and stickers are
 * looked up by id.
 */
import { config } from '@/lib/config';
import { processShared } from '@/lib/realtime/processShared';
import { BoundedMap } from '@/lib/utils/boundedMap';
import { cdnHash, cdnKeyOf, cdnRedirectUrl, parseCdnPath, parseSize, rewriteCdnFields, type CdnRequest } from './cdn';

export const CDN_COMPAT_PREFIX = '/cdn-compat';

const HASH_TTL_S = 30 * 86_400;
const known = processShared('cdnCompat:hashes', () => new BoundedMap<string, string>(20_000));
const written = processShared('cdnCompat:written', () => new BoundedMap<string, number>(20_000));
const byId = processShared('cdnCompat:byId', () => new BoundedMap<string, { key: string | null; at: number }>(5_000));
const BY_ID_TTL_MS = 10 * 60_000;
const WRITE_EVERY_MS = 24 * 3600_000;

/** Remember hash -> key (Redis write at most once a day per hash per process). */
export function rememberCdnHash(hash: string, key: string) {
  known.set(hash, key);
  const last = written.get(hash) ?? 0;
  if (Date.now() - last < WRITE_EVERY_MS) return;
  written.set(hash, Date.now());
  void import('@/lib/db/redis')
    .then(({ getRedis }) => getRedis()?.set(`cdnc:${hash}`, key, 'EX', HASH_TTL_S))
    .catch(() => {});
}

/** The boundary's outbound hook: CDN URLs -> hashes (snowflake-format apps). */
export function toCdnHashes<T>(payload: T): T {
  return rewriteCdnFields(payload, { cdnBase: config.CDN_URL, bucket: config.B2_BUCKET_NAME, remember: rememberCdnHash });
}

async function keyForHash(hash: string): Promise<string | null> {
  const hit = known.get(hash);
  if (hit) return hit;
  try {
    const { getRedis } = await import('@/lib/db/redis');
    const v = await getRedis()?.get(`cdnc:${hash}`);
    if (typeof v === 'string' && v) { known.set(hash, v); return v; }
  } catch { /* fall back to the entity */ }
  return null;
}

/** Public ids in the path (snowflakes or UUIDs) -> internal UUIDs. */
async function toUuids(ids: string[], appIdIndex = -1): Promise<Array<string | null>> {
  const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  const sfs = ids.filter((v) => !isUuid(v));
  let map = new Map<string, { uuid: string }>();
  if (sfs.length > 0) {
    const { uuidsForSnowflakes, applicationByClientId } = await import('./snowflakeStore');
    map = (await uuidsForSnowflakes(sfs)).map as Map<string, { uuid: string }>;
    if (appIdIndex >= 0 && !isUuid(ids[appIdIndex]) && !map.has(ids[appIdIndex])) {
      const app = await applicationByClientId(ids[appIdIndex]);
      if (app) map.set(ids[appIdIndex], { uuid: app });
    }
  }
  return ids.map((v) => (isUuid(v) ? v.toLowerCase() : map.get(v)?.uuid ?? null));
}

/** Current image URLs of the entity a hash path names (for the cache-miss fallback). */
async function entityImages(req: Extract<CdnRequest, { kind: 'hash' }>): Promise<Array<string | null | undefined>> {
  const ids = await toUuids(req.ids, req.resource === 'app-icons' || req.resource === 'app-assets' ? 0 : -1);
  if (ids.some((v) => !v)) return [];
  const { db, schema } = await import('@/lib/db/postgres');
  const { and, eq } = await import('drizzle-orm');
  const id = ids[0]!;
  switch (req.resource) {
    case 'avatars': {
      const [u] = await db.select({ a: schema.users.avatar }).from(schema.users).where(eq(schema.users.id, id)).limit(1);
      if (u) return [u.a];
      const [w] = await db.select({ a: schema.channelWebhooks.avatar }).from(schema.channelWebhooks).where(eq(schema.channelWebhooks.id, id)).limit(1);
      return w ? [w.a] : [];
    }
    case 'banners': {
      const [u] = await db.select({ b: schema.users.banner }).from(schema.users).where(eq(schema.users.id, id)).limit(1);
      if (u) return [u.b];
      const [s] = await db.select({ b: schema.servers.banner }).from(schema.servers).where(eq(schema.servers.id, id)).limit(1);
      return s ? [s.b] : [];
    }
    case 'icons':
    case 'splashes':
    case 'discovery-splashes': {
      const [s] = await db.select({ icon: schema.servers.icon, splash: schema.servers.splash, ds: schema.servers.discoverySplash }).from(schema.servers).where(eq(schema.servers.id, id)).limit(1);
      if (!s) return [];
      return req.resource === 'icons' ? [s.icon] : req.resource === 'splashes' ? [s.splash] : [s.ds];
    }
    case 'role-icons': {
      const [r] = await db.select({ icon: schema.roles.icon }).from(schema.roles).where(eq(schema.roles.id, id)).limit(1);
      return r ? [r.icon] : [];
    }
    case 'app-icons':
    case 'app-assets': {
      const [a] = await db.select({ icon: schema.applications.icon, cover: schema.applications.coverImage }).from(schema.applications).where(eq(schema.applications.id, id)).limit(1);
      return a ? [a.icon, a.cover] : [];
    }
    case 'guild-events': {
      const [e] = await db.select({ image: schema.serverScheduledEvents.image }).from(schema.serverScheduledEvents).where(eq(schema.serverScheduledEvents.id, id)).limit(1);
      return e ? [e.image] : [];
    }
    case 'member-avatars':
    case 'member-banners': {
      const [m] = await db.select({ a: schema.serverMembers.avatar, b: schema.serverMembers.banner }).from(schema.serverMembers)
        .where(and(eq(schema.serverMembers.serverId, id), eq(schema.serverMembers.userId, ids[1]!))).limit(1);
      return m ? [req.resource === 'member-avatars' ? m.a : m.b] : [];
    }
    default:
      return [];
  }
}

async function keyForEmojiOrSticker(kind: 'emoji' | 'sticker', rawId: string): Promise<string | null> {
  const memoKey = `${kind}:${rawId}`;
  const hit = byId.get(memoKey);
  if (hit && Date.now() - hit.at < BY_ID_TTL_MS) return hit.key;
  const [id] = await toUuids([rawId]);
  let url: string | null | undefined = null;
  if (id) {
    const { db, schema } = await import('@/lib/db/postgres');
    const { eq } = await import('drizzle-orm');
    if (kind === 'emoji') {
      const [e] = await db.select({ u: schema.serverEmojis.imageUrl }).from(schema.serverEmojis).where(eq(schema.serverEmojis.id, id)).limit(1);
      url = e?.u;
      if (!url) {
        const [a] = await db.select({ u: schema.appEmojis.image }).from(schema.appEmojis).where(eq(schema.appEmojis.id, id)).limit(1);
        url = a?.u;
      }
    } else {
      const [st] = await db.select({ u: schema.serverStickers.imageUrl }).from(schema.serverStickers).where(eq(schema.serverStickers.id, id)).limit(1);
      url = st?.u;
    }
  }
  const key = cdnKeyOf(url, config.CDN_URL, config.B2_BUCKET_NAME);
  byId.set(memoKey, { key, at: Date.now() });
  return key;
}

function notFound(): Response {
  return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=60' } });
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location, 'cache-control': 'public, max-age=3600' } });
}

const UUID_OR_SF = /^([0-9]{1,20}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Handle a request whose path starts with CDN_COMPAT_PREFIX. */
export async function handleCdnCompat(req: Request): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  const url = new URL(req.url);
  const parsed = parseCdnPath(url.pathname.slice(CDN_COMPAT_PREFIX.length));
  if (!parsed) return notFound();
  const size = parseSize(url.searchParams.get('size'));
  const animated = url.searchParams.get('animated') === 'true';

  if (parsed.kind === 'default-avatar') {
    // Discord's default avatars: Serika's own default (a fixed asset).
    return redirect(new URL('/serika-avatar.png', config.API_BASE_URL).toString());
  }

  const ids = parsed.kind === 'hash' ? parsed.ids : [parsed.id];
  if (!ids.every((v) => UUID_OR_SF.test(v))) return notFound();

  let key: string | null = null;
  try {
    if (parsed.kind === 'hash') {
      key = await keyForHash(parsed.hash);
      if (!key) {
        // Cache miss: DB lookups, so count it against the caller's IP.
        const { checkRateLimit, getClientIP } = await import('@/lib/security');
        const limited = await checkRateLimit('cdnCompat', getClientIP(req)).catch(() => ({ success: true }));
        if (!limited.success) return new Response('Too Many Requests', { status: 429, headers: { 'Retry-After': '10' } });
        for (const u of await entityImages(parsed)) {
          const k = cdnKeyOf(u, config.CDN_URL, config.B2_BUCKET_NAME);
          if (k && cdnHash(k) === parsed.hash) { key = k; rememberCdnHash(parsed.hash, k); break; }
        }
      }
    } else {
      const memo = byId.get(`${parsed.kind}:${parsed.id}`);
      if (!memo || Date.now() - memo.at >= BY_ID_TTL_MS) {
        const { checkRateLimit, getClientIP } = await import('@/lib/security');
        const limited = await checkRateLimit('cdnCompat', getClientIP(req)).catch(() => ({ success: true }));
        if (!limited.success) return new Response('Too Many Requests', { status: 429, headers: { 'Retry-After': '10' } });
      }
      key = await keyForEmojiOrSticker(parsed.kind, parsed.id);
    }
  } catch (err) {
    console.error('[cdn-compat] lookup failed:', (err as Error)?.message ?? err);
    return new Response('Service Unavailable', { status: 503 });
  }
  if (!key) return notFound();
  const target = cdnRedirectUrl(config.CDN_URL, key, { ext: parsed.ext, size, animated });
  return target ? redirect(target) : notFound();
}
