/**
 * Recent avatars / banners (the "Select an Image" dialog): pure helpers,
 * tested in tests/recent-media.test.ts.
 *
 * Each user keeps their last RECENT_MEDIA_LIMIT avatar URLs and banner URLs
 * (main profile and per-server profiles share one list per kind). Only images
 * on our own storage that belong to that user are ever listed:
 *
 *   main profile   `<avatars|banners>/<userId>/<file>`
 *   server profile `<avatars|banners>/<serverId>/<userId>/<file>`
 *
 * A file listed here is kept in storage until it falls off the list (or is
 * removed with the "x"), even when it is no longer anyone's avatar: see
 * src/lib/services/recentProfileMedia.ts for the storage side.
 */

export const RECENT_MEDIA_LIMIT = 6;

export type RecentMediaKind = 'avatar' | 'banner';

export interface RecentMediaEntry {
  url: string;
  /** When it was last set (ms). */
  at: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A generated file name (nanoid + extension), never a further path. */
const FILE_RE = /^[A-Za-z0-9_-]{1,64}\.[a-z0-9]{1,8}$/;
const MAX_URL_LENGTH = 512;

const FOLDER_KIND: Record<string, RecentMediaKind> = { avatars: 'avatar', banners: 'banner' };

export interface ParsedProfileMediaKey {
  kind: RecentMediaKind;
  /** Lower-cased owner id. */
  userId: string;
  /** Lower-cased server id for a per-server image, null for the main profile. */
  serverId: string | null;
}

/**
 * Parse a profile image storage key: `<avatars|banners>/<userId>/<file>` or
 * `<avatars|banners>/<serverId>/<userId>/<file>` with UUID ids and a plain
 * generated file name. Anything else (other folders, path tricks, deeper or
 * shorter paths) is null.
 */
export function parseProfileMediaKey(key: unknown): ParsedProfileMediaKey | null {
  if (typeof key !== 'string' || key.length === 0 || key.length > 256) return null;
  const parts = key.split('/');
  const kind = FOLDER_KIND[parts[0]];
  if (!kind) return null;
  if (parts.length === 3) {
    const [, userId, file] = parts;
    if (!UUID_RE.test(userId) || !FILE_RE.test(file)) return null;
    return { kind, userId: userId.toLowerCase(), serverId: null };
  }
  if (parts.length === 4) {
    const [, serverId, userId, file] = parts;
    if (!UUID_RE.test(serverId) || !UUID_RE.test(userId) || !FILE_RE.test(file)) return null;
    return { kind, userId: userId.toLowerCase(), serverId: serverId.toLowerCase() };
  }
  return null;
}

/** True when `key` is one of this user's own profile images (of `kind`, when given). */
export function isUserProfileMediaKey(key: unknown, userId: string, kind?: RecentMediaKind): boolean {
  const parsed = parseProfileMediaKey(key);
  if (!parsed || !userId) return false;
  if (kind && parsed.kind !== kind) return false;
  return parsed.userId === userId.toLowerCase();
}

/**
 * The storage key behind a profile image URL on our CDN (or a legacy
 * Backblaze host still found in older rows), or null for anything else:
 * other hosts, query strings, credentials, keys that aren't profile images.
 */
export function profileMediaKeyFromUrl(url: unknown, opts: { cdnUrl: string; bucket?: string }): string | null {
  if (typeof url !== 'string' || url.length === 0 || url.length > MAX_URL_LENGTH) return null;
  let parsed: URL;
  let cdn: URL;
  try {
    parsed = new URL(url);
    cdn = new URL(opts.cdnUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  let key: string;
  if (parsed.host === cdn.host && parsed.protocol === cdn.protocol) {
    const base = cdn.pathname.replace(/\/+$/, '');
    if (!parsed.pathname.startsWith(`${base}/`)) return null;
    key = parsed.pathname.slice(base.length + 1);
  } else if (parsed.protocol === 'https:' && parsed.hostname.toLowerCase().endsWith('.backblazeb2.com')) {
    key = parsed.pathname.replace(/^\/+/, '').replace(/^file\//, '');
    const bucket = opts.bucket ? `${opts.bucket}/` : '';
    if (bucket && key.startsWith(bucket)) key = key.slice(bucket.length);
  } else {
    return null;
  }
  return parseProfileMediaKey(key) ? key : null;
}

/** `<cdn>/<key>` for a key that parseProfileMediaKey accepts. */
export function profileMediaUrlForKey(key: string, cdnUrl: string): string {
  return `${cdnUrl.replace(/\/+$/, '')}/${key}`;
}

/** Clean a stored list: valid entries only, no duplicates, newest first, at most `limit`. */
export function normalizeRecentList(raw: unknown, limit = RECENT_MEDIA_LIMIT): RecentMediaEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: RecentMediaEntry[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { url, at } = item as { url?: unknown; at?: unknown };
    if (typeof url !== 'string' || url.length === 0 || url.length > MAX_URL_LENGTH) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url, at: typeof at === 'number' && Number.isFinite(at) ? at : 0 });
    if (out.length >= limit) break;
  }
  return out;
}

export function hasRecentMedia(list: readonly RecentMediaEntry[], url: string): boolean {
  return list.some((e) => e.url === url);
}

/**
 * Record a change: `url` (the new image, may be null when it was cleared)
 * moves to the front; `previous` (the image it replaced) is kept too when it
 * isn't listed yet, right behind it, so the image you just replaced is one
 * tap away. Entries pushed past `limit` come back in `evicted`.
 */
export function recordRecentMedia(
  list: readonly RecentMediaEntry[],
  change: { url?: string | null; previous?: string | null },
  now: number,
  limit = RECENT_MEDIA_LIMIT,
): { list: RecentMediaEntry[]; evicted: string[] } {
  let next = list.filter((e) => e.url !== change.url);
  if (change.url) next = [{ url: change.url, at: now }, ...next];
  if (change.previous && change.previous !== change.url && !hasRecentMedia(next, change.previous)) {
    const at = change.url ? 1 : 0;
    next = [...next.slice(0, at), { url: change.previous, at: now - 1 }, ...next.slice(at)];
  }
  return { list: next.slice(0, limit), evicted: next.slice(limit).map((e) => e.url) };
}

/** Remove one entry (the "x" on a recent tile). */
export function removeRecentMedia(list: readonly RecentMediaEntry[], url: string): { list: RecentMediaEntry[]; removed: boolean } {
  const next = list.filter((e) => e.url !== url);
  return { list: next, removed: next.length !== list.length };
}

// ── Linked Discord account ──────────────────────────────────────────────────

const SNOWFLAKE_RE = /^\d{17,20}$/;
const DISCORD_HASH_RE = /^(a_)?[0-9a-f]{32}$/;
export const DISCORD_CDN_HOST = 'cdn.discordapp.com';

/** Discord's image sizes are powers of two from 16 to 4096. */
function discordSize(size: number): number {
  let s = 16;
  while (s < size && s < 4096) s *= 2;
  return s;
}

function discordImageUrl(folder: 'avatars' | 'banners', userId: unknown, hash: unknown, size: number): string | null {
  if (typeof userId !== 'string' || !SNOWFLAKE_RE.test(userId)) return null;
  if (typeof hash !== 'string' || !DISCORD_HASH_RE.test(hash)) return null;
  const ext = hash.startsWith('a_') ? 'gif' : 'png';
  return `https://${DISCORD_CDN_HOST}/${folder}/${userId}/${hash}.${ext}?size=${discordSize(size)}`;
}

/** A Discord user's avatar on cdn.discordapp.com (animated `a_` hashes → GIF), or null. */
export function discordAvatarUrl(userId: unknown, hash: unknown, size = 1024): string | null {
  return discordImageUrl('avatars', userId, hash, size);
}

/** A Discord user's profile banner on cdn.discordapp.com (animated `a_` hashes → GIF), or null. */
export function discordBannerUrl(userId: unknown, hash: unknown, size = 1024): string | null {
  return discordImageUrl('banners', userId, hash, size);
}
