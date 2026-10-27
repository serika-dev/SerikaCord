/**
 * Storage keys for application images (pure).
 *
 * Icons and covers are uploaded under a prefix keyed by the application id
 * (`app-icons/<appId>/<file>`, `app-covers/<appId>/<file>`). When an image is
 * replaced, the old file is deleted only if its stored URL provably points at
 * that app's own prefix on our CDN. Anything else (legacy `app-icons/<userId>/`
 * keys, other users' media, foreign hosts) is left alone: a stored URL is
 * never trusted to name a file the app owns. Tested in tests/app-directory.test.ts.
 */

export type AppAssetKind = 'icon' | 'cover';

export const APP_ASSET_CATEGORY: Record<AppAssetKind, 'app-icons' | 'app-covers'> = {
  icon: 'app-icons',
  cover: 'app-covers',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function appAssetPrefix(kind: AppAssetKind, appId: string): string {
  return `${APP_ASSET_CATEGORY[kind]}/${appId.toLowerCase()}/`;
}

/**
 * True when `url` is on the CDN origin (`cdnBase`) and its key is exactly
 * `<prefix><file>` with a plain generated filename (no further path segments,
 * no encoded characters). Only then may the file be deleted.
 */
export function isCdnKeyUnderPrefix(url: unknown, cdnBase: string, prefix: string): url is string {
  if (typeof url !== 'string' || !url || url.length > 1024 || !prefix.endsWith('/')) return false;
  let u: URL;
  let base: URL;
  try {
    u = new URL(url);
    base = new URL(cdnBase);
  } catch {
    return false;
  }
  if (u.origin !== base.origin || u.username || u.password || u.search || u.hash) return false;
  const basePath = base.pathname.replace(/\/+$/, '');
  if (basePath && !u.pathname.startsWith(`${basePath}/`)) return false;
  const key = u.pathname.slice(basePath.length).replace(/^\//, '');
  if (!key.startsWith(prefix)) return false;
  return /^[A-Za-z0-9_-]{8,64}\.[a-z0-9]{1,8}$/.test(key.slice(prefix.length));
}

/** An app icon/cover URL stored under that app's own prefix on our CDN. */
export function isOwnedAppAssetUrl(url: unknown, cdnBase: string, kind: AppAssetKind, appId: string): url is string {
  if (!UUID_RE.test(appId)) return false;
  return isCdnKeyUnderPrefix(url, cdnBase, appAssetPrefix(kind, appId));
}

/** A bot user's avatar/banner URL stored under `avatars|banners/<botUserId>/`. */
export function isOwnedBotImageUrl(url: unknown, cdnBase: string, kind: 'avatar' | 'banner', botUserId: string): url is string {
  if (!UUID_RE.test(botUserId)) return false;
  return isCdnKeyUnderPrefix(url, cdnBase, `${kind === 'banner' ? 'banners' : 'avatars'}/${botUserId.toLowerCase()}/`);
}
