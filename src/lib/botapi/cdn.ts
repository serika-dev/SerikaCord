/**
 * Discord CDN compatibility (WP6), pure part (tests/bot-cdn.test.ts).
 *
 * Discord objects carry image *hashes* (`avatar: "a_1269e7..."`) and libraries
 * build URLs like `{cdn}/avatars/{user_id}/{hash}.png?size=256`. Serika stores
 * full media URLs on its own CDN (cdn.serika.chat, wsrv.nl transforms over B2).
 *
 * Outbound (snowflake-format apps only, via the id boundary): CDN URL fields
 * become a stable hash = hex sha256 of the storage key (32 chars), `a_`
 * prefixed when the file is a GIF. The hash -> key map is remembered
 * (process + Redis) so ./cdnCompat.ts can redirect `/cdn-compat/...` paths to
 * the object on our CDN, with `size` / format mapped to wsrv params.
 * Legacy (UUID-format) apps keep getting full URLs.
 *
 * Only URLs on our own CDN (or its legacy B2 hosts) are hashed; anything else
 * becomes null (the library then shows a default avatar). Redirect targets
 * are always built from the configured CDN origin plus a validated key, so the
 * shim can never redirect elsewhere.
 */
import { createHash } from 'crypto';

/** Object keys whose string value is a Discord image hash. */
export const CDN_HASH_KEYS = new Set(['avatar', 'banner', 'icon', 'splash', 'discovery_splash', 'cover_image', 'image']);

/** A bucket key we will redirect to: path-safe characters only, no traversal. */
export function isSafeKey(key: string): boolean {
  if (!key || key.length > 512) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9._\-/]*$/.test(key)) return false;
  return !key.split('/').some((seg) => seg === '' || seg === '.' || seg === '..');
}

/**
 * The storage key of a media URL on our CDN (`cdnBase`) or on the legacy B2
 * hosts of `bucket`; null for anything else (external URLs, data URIs, ...).
 */
export function cdnKeyOf(url: unknown, cdnBase: string, bucket: string): string | null {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url) || url.length > 2048) return null;
  let u: URL;
  let base: URL;
  try {
    u = new URL(url);
    base = new URL(cdnBase);
  } catch {
    return null;
  }
  let key: string | null = null;
  let path: string;
  try {
    path = decodeURIComponent(u.pathname).replace(/^\/+/, '');
  } catch {
    return null;
  }
  if (u.host === base.host) key = path;
  else if (/\.backblazeb2\.com$/i.test(u.hostname)) {
    if (u.hostname.toLowerCase().startsWith(`${bucket.toLowerCase()}.`)) key = path; // virtual-host style
    else {
      const p = path.replace(/^file\//, '');
      if (p.startsWith(`${bucket}/`)) key = p.slice(bucket.length + 1); // path style / friendly URL
    }
  }
  return key && isSafeKey(key) ? key : null;
}

export function isAnimatedKey(key: string): boolean {
  return /\.gif$/i.test(key);
}

/** Discord-style image hash of a storage key. */
export function cdnHash(key: string): string {
  const h = createHash('sha256').update(key).digest('hex').slice(0, 32);
  return isAnimatedKey(key) ? `a_${h}` : h;
}

/** A syntactically valid hash (what /cdn-compat paths accept). */
export function isCdnHash(v: string): boolean {
  return /^(a_)?[0-9a-f]{32}$/.test(v);
}

/**
 * `payload` with every CDN URL under a hash key replaced by its hash
 * (non-CDN URLs become null). `remember(hash, key)` is called for each.
 */
export function rewriteCdnFields<T>(payload: T, opts: { cdnBase: string; bucket: string; remember: (hash: string, key: string) => void }): T {
  const walk = (v: unknown, key: string | null): unknown => {
    if (typeof v === 'string') {
      if (key === null || !CDN_HASH_KEYS.has(key) || !/^https?:\/\//i.test(v)) return v;
      const k = cdnKeyOf(v, opts.cdnBase, opts.bucket);
      if (!k) return null;
      const h = cdnHash(k);
      opts.remember(h, k);
      return h;
    }
    if (!v || typeof v !== 'object' || v instanceof Date) return v;
    if (Array.isArray(v)) return v.map((x) => walk(x, key));
    const out: Record<string, unknown> = {};
    for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
      const nv = walk(child, k);
      if (k === '__proto__') Object.defineProperty(out, k, { value: nv, enumerable: true, writable: true, configurable: true });
      else out[k] = nv;
    }
    return out;
  };
  return walk(payload, null) as T;
}

// ─── /cdn-compat paths ────────────────────────────────────────────────────────

export type CdnRequest =
  | { kind: 'hash'; resource: 'avatars' | 'banners' | 'icons' | 'splashes' | 'discovery-splashes' | 'role-icons' | 'app-icons' | 'app-assets' | 'channel-icons' | 'guild-events' | 'member-avatars' | 'member-banners'; ids: string[]; hash: string; ext: string }
  | { kind: 'emoji' | 'sticker'; id: string; ext: string }
  | { kind: 'default-avatar'; index: number; ext: string };

const EXT = '(png|jpe?g|webp|gif|avif|json)';
const ID = '([0-9]{1,20}|[0-9a-fA-F-]{36})';
const HASH = '((?:a_)?[0-9a-f]{32})';

/** Parse a path below the /cdn-compat prefix (e.g. `/avatars/1/abc.png`). */
export function parseCdnPath(path: string): CdnRequest | null {
  let m = new RegExp(`^/(avatars|banners|icons|splashes|discovery-splashes|role-icons|app-icons|app-assets|channel-icons|guild-events)/${ID}/${HASH}\\.${EXT}$`).exec(path);
  if (m) return { kind: 'hash', resource: m[1] as never, ids: [m[2]], hash: m[3], ext: m[4].toLowerCase() };
  m = new RegExp(`^/guilds/${ID}/users/${ID}/(avatars|banners)/${HASH}\\.${EXT}$`).exec(path);
  if (m) return { kind: 'hash', resource: m[3] === 'avatars' ? 'member-avatars' : 'member-banners', ids: [m[1], m[2]], hash: m[4], ext: m[5].toLowerCase() };
  m = new RegExp(`^/(emojis|stickers)/${ID}\\.${EXT}$`).exec(path);
  if (m) return { kind: m[1] === 'emojis' ? 'emoji' : 'sticker', id: m[2], ext: m[3].toLowerCase() };
  m = /^\/embed\/avatars\/([0-9])\.(png)$/.exec(path);
  if (m) return { kind: 'default-avatar', index: Number(m[1]), ext: m[2] };
  return null;
}

/** Discord's `size` (a power of two, 16..4096) or null. */
export function parseSize(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 16 || n > 4096 || (n & (n - 1)) !== 0) return null;
  return n;
}

/**
 * The redirect target on our CDN for `key`, with `size` / format mapped to
 * wsrv params. Null when the key is unsafe or `cdnBase` is not an http(s) origin.
 */
export function cdnRedirectUrl(cdnBase: string, key: string, opts: { ext: string; size: number | null; animated: boolean }): string | null {
  if (!isSafeKey(key)) return null;
  let base: URL;
  try {
    base = new URL(cdnBase);
  } catch {
    return null;
  }
  if (base.protocol !== 'https:' && base.protocol !== 'http:') return null;
  const url = new URL(`${base.origin}/${key.split('/').map(encodeURIComponent).join('/')}`);
  if (url.origin !== base.origin) return null;
  const ext = opts.ext === 'jpeg' ? 'jpg' : opts.ext;
  if (opts.size) {
    url.searchParams.set('w', String(opts.size));
    url.searchParams.set('h', String(opts.size));
    url.searchParams.set('fit', 'inside');
  }
  if (ext === 'png' || ext === 'jpg' || ext === 'webp' || ext === 'gif' || ext === 'avif') url.searchParams.set('format', ext);
  const keyAnimated = isAnimatedKey(key);
  // gif (or webp?animated=true) keeps every frame; other formats get the first.
  if (ext === 'gif' || (ext === 'webp' && opts.animated)) url.searchParams.set('n', '-1');
  else if (keyAnimated) url.searchParams.set('n', '1');
  return url.toString();
}
