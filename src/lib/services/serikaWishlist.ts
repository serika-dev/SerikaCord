import { config } from '../config';
import { BoundedMap } from '../utils/boundedMap';
import { accountsIdFromUserId, sanitizeWishlistProfile, type WishlistProfile } from '../serikaWishlist';
import { getAccountsUserId } from './moeActivity';

/**
 * Server-side client for Serika Wishlist's public API (wish.serika.dev).
 *
 * Profiles only ever show lists their owner made public there, and only for
 * SerikaCord users who turned the Wishlist widget on. We proxy instead of
 * letting browsers call wish.serika.dev directly so we can (a) map the
 * SerikaCord user to their Serika account id, (b) gate on the widget being
 * enabled, and (c) cache: a profile opened by many people costs one upstream
 * request per user every five minutes.
 */

export type WishlistLookup =
  | { status: 'ok'; profile: WishlistProfile }
  | { status: 'not_found' }
  | { status: 'error' };

const CACHE_TTL_MS = 5 * 60_000;
const ERROR_TTL_MS = 60_000;
const MIN_REFRESH_MS = 15_000;
const REQUEST_TIMEOUT_MS = 5_000;
const ITEMS_PER_LIST = 12;

const cache = new BoundedMap<string, { value: WishlistLookup; fetchedAt: number; expiresAt: number }>(2000);
const inflight = new Map<string, Promise<WishlistLookup>>();

async function fetchByAccountId(accountId: string): Promise<WishlistLookup> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const url = `${config.SERIKA_WISHLIST_URL}/api/public/users/${encodeURIComponent(accountId)}/wishlists?items=${ITEMS_PER_LIST}`;
    const res = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'SerikaCord (+https://serika.chat)' },
      signal: controller.signal,
      cache: 'no-store',
    });
    if (res.status === 404) return { status: 'not_found' };
    if (!res.ok) return { status: 'error' };
    const profile = sanitizeWishlistProfile(await res.json(), ITEMS_PER_LIST);
    return profile ? { status: 'ok', profile } : { status: 'error' };
  } catch {
    return { status: 'error' };
  } finally {
    clearTimeout(timeout);
  }
}

async function lookup(userId: string): Promise<WishlistLookup> {
  // The SerikaCord id is the accounts id in UUID clothing for anyone who signed
  // up through Serika accounts; try that first (no extra round trip), then ask
  // the accounts service by email (covers merged / legacy local accounts).
  const tried = new Set<string>();
  let sawError = false;
  const direct = accountsIdFromUserId(userId);
  if (direct) {
    tried.add(direct);
    const r = await fetchByAccountId(direct);
    if (r.status === 'ok') return r;
    if (r.status === 'error') sawError = true;
  }
  const viaAccounts = await getAccountsUserId(userId).catch(() => null);
  if (viaAccounts && !tried.has(viaAccounts)) {
    const r = await fetchByAccountId(viaAccounts);
    if (r.status === 'ok') return r;
    if (r.status === 'error') sawError = true;
  }
  return sawError ? { status: 'error' } : { status: 'not_found' };
}

/**
 * Public wishlists for a SerikaCord user. `refresh` skips the cache (owner
 * pressing refresh in settings) but never more than once per 15 seconds.
 */
export async function getSerikaWishlist(userId: string, opts: { refresh?: boolean } = {}): Promise<WishlistLookup> {
  const now = Date.now();
  const hit = cache.get(userId);
  if (hit) {
    const fresh = hit.expiresAt > now;
    const refreshAllowed = opts.refresh && now - hit.fetchedAt > MIN_REFRESH_MS;
    if (fresh && !refreshAllowed) return hit.value;
  }

  const pending = inflight.get(userId);
  if (pending) return pending;

  const p = lookup(userId)
    .then((value) => {
      // Keep serving the last good answer through a transient upstream error.
      if (value.status === 'error' && hit && hit.value.status === 'ok') {
        cache.set(userId, { value: hit.value, fetchedAt: Date.now(), expiresAt: Date.now() + ERROR_TTL_MS });
        return hit.value;
      }
      const ttl = value.status === 'error' ? ERROR_TTL_MS : CACHE_TTL_MS;
      cache.set(userId, { value, fetchedAt: Date.now(), expiresAt: Date.now() + ttl });
      return value;
    })
    .finally(() => inflight.delete(userId));
  inflight.set(userId, p);
  return p;
}

/**
 * Lazily migrate a pre-1-list-per-widget wishlist placement (listSlug null)
 * to the owner's first public list, or drop it when they have none. Writes
 * the result back once; on an upstream error the stored value is returned
 * unchanged and the client falls back to showing the first public list.
 */
export async function resolveLegacyWishlistPlacements(userId: string, profileWidgets: unknown): Promise<unknown> {
  const { hasLegacyWishlistPlacement, migrateLegacyWishlistPlacements } = await import('../serikaWishlist');
  if (!hasLegacyWishlistPlacement(profileWidgets)) return profileWidgets;
  const result = await getSerikaWishlist(userId);
  if (result.status === 'error') return profileWidgets;
  const next = migrateLegacyWishlistPlacements(profileWidgets, result.status === 'ok' ? result.profile.lists : []);
  if (!next) return profileWidgets;
  try {
    const { User } = await import('../models/User');
    await User.updateById(userId, { profileWidgets: next });
    const { invalidateUserCache } = await import('./auth');
    await invalidateUserCache(userId).catch(() => {});
  } catch {
    // Serve the migrated shape anyway; the write is retried on the next read.
  }
  return next;
}
