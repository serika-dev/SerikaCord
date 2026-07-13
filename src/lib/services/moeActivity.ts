import { config } from '../config';

/**
 * Client for serika.moe's live "now watching" presence.
 *
 * SerikaCord users link their serika.moe account via the "serika" connection
 * provider in user_connections. The connection's `accountId` is the serika.moe
 * username (e.g. "roxy"), which is what serika.moe's API expects — NOT the
 * SerikaCord user UUID.
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

// Cache the serika connection lookup (userId → { accountId, moeId })
const connectionCache = new Map<string, { accountId: string; moeId: string | null; expiresAt: number }>();
const CONNECTION_CACHE_TTL_MS = 60_000;

async function getSerikaConnection(userId: string): Promise<{ accountId: string; moeId: string | null } | null> {
  const cached = connectionCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.accountId ? { accountId: cached.accountId, moeId: cached.moeId } : null;
  }

  // 1. Try local UserConnection table first
  try {
    const { UserConnection } = await import('../models/UserConnection');
    const conn = await UserConnection.findOne({ userId, provider: 'serika' as any });
    if (conn?.accountId) {
      const moeId = (conn.metadata as any)?.serikaMoeId || null;
      connectionCache.set(userId, { accountId: conn.accountId, moeId, expiresAt: Date.now() + CONNECTION_CACHE_TTL_MS });
      return { accountId: conn.accountId, moeId };
    }
  } catch {
    // ignore — try fallback next
  }

  // 2. Fall back to querying the accounts service directly.
  // This handles instances (like canary) where local connections might not have
  // been synced, but the user is logged in and has their SerikaMoe account linked.
  try {
    const { accountsInternalGetUserByOriginalId } = await import('./accountsClient');
    const { ok, data } = await accountsInternalGetUserByOriginalId(userId);
    if (ok && data?.user?.serikaMoeUsername) {
      const accountId = data.user.serikaMoeUsername;
      const moeId = data.user.serikaMoeId || null;

      // Auto-upsert local UserConnection
      try {
        const { UserConnection } = await import('../models/UserConnection');
        const connData = {
          userId,
          provider: 'serika' as any,
          accountId,
          displayName: accountId,
          visible: true,
          metadata: { serikaMoeId: moeId },
        };
        const existing = await UserConnection.findOne({ userId, provider: 'serika' as any });
        if (existing) {
          await UserConnection.updateById(existing.id, connData);
        } else {
          const crypto = await import('crypto');
          await UserConnection.create({
            ...connData,
            id: crypto.randomUUID(),
          });
        }
      } catch (dbErr) {
        console.error('Failed to auto-upsert local serika connection:', dbErr);
      }

      connectionCache.set(userId, { accountId, moeId, expiresAt: Date.now() + CONNECTION_CACHE_TTL_MS });
      return { accountId, moeId };
    }
  } catch (accountsErr) {
    console.error('Failed to fetch user from accounts service in moeActivity:', accountsErr);
  }

  connectionCache.set(userId, { accountId: '', moeId: null, expiresAt: Date.now() + CONNECTION_CACHE_TTL_MS });
  return null;
}

/**
 * Fetch the live watch activity for a SerikaCord user.
 * Looks up the user's serika.moe connection to get the correct accountId,
 * then queries serika.moe's API for their current watching activity.
 * Tries both the serikaMoeId (UUID) and username for the API call.
 * Returns null when the account isn't linked, isn't watching, or on any error.
 */
export async function getMoeActivity(userId: string): Promise<MoeActivity | null> {
  if (!userId || !config.SERIKA_MOE_SERVICE_KEY) return null;

  const cached = cache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  // Look up the user's serika.moe connection
  const conn = await getSerikaConnection(userId);
  if (!conn) {
    cache.set(userId, { value: null, expiresAt: Date.now() + CACHE_TTL_MS });
    return null;
  }

  // Try serikaMoeId first (UUID), then fall back to username
  const candidates = [conn.moeId, conn.accountId].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const url = `${config.SERIKA_MOE_URL}/api/serika-account/status?accountId=${encodeURIComponent(candidate)}`;
      const res = await fetch(url, {
        headers: { 'x-service-key': config.SERIKA_MOE_SERVICE_KEY },
        signal: controller.signal,
        cache: 'no-store',
      });

      if (!res.ok) continue;

      const data = (await res.json()) as { linked?: boolean; activity?: MoeActivity | null };
      if (data.linked) {
        const value = data.activity ?? null;
        cache.set(userId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
        return value;
      }
      // Not linked with this candidate — try next
    } catch {
      // Network error / timeout — try next candidate
    } finally {
      clearTimeout(timeout);
    }
  }

  // None of the candidates were linked
  cache.set(userId, { value: null, expiresAt: Date.now() + CACHE_TTL_MS });
  return null;
}
