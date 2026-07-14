import { config } from '../config';

/**
 * Client for serika.moe's live "now watching" presence.
 *
 * serika.moe's /api/serika-account/status endpoint expects the **accounts
 * service user ID** (Mongo ObjectId) as `accountId` — NOT the serika.moe
 * username or the SerikaCord user UUID.
 *
 * We resolve the accounts service ID by looking up the user's email in the
 * local DB, then calling the accounts service /internal/get-user endpoint.
 *
 * Results are cached briefly so profile cards / member lists that render many
 * users don't hammer serika.moe.
 */

export interface MoeActivity {
  titleName: string;
  episodeName: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  progressSeconds: number;
  durationSeconds: number | null;
  posterUrl: string | null;
  isPaused: boolean;
  startedAt: string;
  updatedAt: string;
}

interface CacheEntry {
  value: MoeActivity | null;
  expiresAt: number;
}

const CACHE_TTL_MS = 20_000;
const REQUEST_TIMEOUT_MS = 5_000;
const cache = new Map<string, CacheEntry>();

// Cache the accounts service ID lookup (userId → accountsUserId)
const connectionCache = new Map<string, { accountsUserId: string; expiresAt: number }>();
const CONNECTION_CACHE_TTL_MS = 60_000;

/**
 * Resolve the accounts service user ID (Mongo ObjectId) for a SerikaCord user.
 * serika.moe's API expects this ID as `accountId`.
 */
async function getAccountsUserId(userId: string): Promise<string | null> {
  const cached = connectionCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.accountsUserId || null;
  }

  // 1. Look up the user's email in the local DB
  let email: string | null = null;
  try {
    const { User } = await import('../models/User');
    const user = await User.findById(userId);
    email = user?.email ?? null;
  } catch {
    // ignore
  }

  if (!email) {
    connectionCache.set(userId, { accountsUserId: '', expiresAt: Date.now() + CONNECTION_CACHE_TTL_MS });
    return null;
  }

  // 2. Query the accounts service by email to get the Mongo ObjectId
  try {
    const { accountsInternalGetUser } = await import('./accountsClient');
    const { ok, data } = await accountsInternalGetUser(email);
    if (ok && data?.user?.id) {
      const accountsUserId = data.user.id;
      connectionCache.set(userId, { accountsUserId, expiresAt: Date.now() + CONNECTION_CACHE_TTL_MS });
      return accountsUserId;
    }
  } catch (accountsErr) {
    console.error('Failed to fetch user from accounts service in moeActivity:', accountsErr);
  }

  connectionCache.set(userId, { accountsUserId: '', expiresAt: Date.now() + CONNECTION_CACHE_TTL_MS });
  return null;
}

/**
 * Fetch the live watch activity for a SerikaCord user.
 * Resolves the accounts service user ID, then queries serika.moe's API.
 * Returns null when the account isn't linked, isn't watching, or on any error.
 */
export async function getMoeActivity(userId: string): Promise<MoeActivity | null> {
  if (!userId || !config.SERIKA_MOE_SERVICE_KEY) return null;

  const cached = cache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  // Resolve the accounts service user ID (Mongo ObjectId)
  const accountsUserId = await getAccountsUserId(userId);
  if (!accountsUserId) {
    cache.set(userId, { value: null, expiresAt: Date.now() + CACHE_TTL_MS });
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const url = `${config.SERIKA_MOE_URL}/api/serika-account/status?accountId=${encodeURIComponent(accountsUserId)}`;
    const res = await fetch(url, {
      headers: { 'x-service-key': config.SERIKA_MOE_SERVICE_KEY },
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!res.ok) {
      cache.set(userId, { value: null, expiresAt: Date.now() + CACHE_TTL_MS });
      return null;
    }

    const data = (await res.json()) as { linked?: boolean; activity?: MoeActivity | null };
    if (data.linked) {
      const value = data.activity ?? null;
      cache.set(userId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
      return value;
    }
  } catch {
    // Network error / timeout
  } finally {
    clearTimeout(timeout);
  }

  cache.set(userId, { value: null, expiresAt: Date.now() + CACHE_TTL_MS });
  return null;
}
