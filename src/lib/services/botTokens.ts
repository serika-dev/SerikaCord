/**
 * Bot token -> application lookup with a short process-wide cache, used by the
 * API rate-limit plugin (to tell a real bot from a made-up `Bot x` header) and
 * by bot API authentication. Keys are SHA-256 of the token, never the token.
 * Resetting a token clears the cache (invalidateBotTokenCache), so an old
 * token stops working immediately on this process and within TOKEN_TTL_MS on
 * others.
 */
import { createHash } from 'crypto';
import { BoundedMap } from '@/lib/utils/boundedMap';
import { processShared } from '@/lib/realtime/processShared';
import type { IApplication } from '@/lib/models';

const TOKEN_TTL_MS = 15_000;
const NEGATIVE_TTL_MS = 5_000;

const tokenCache = processShared(
  'botTokenCache',
  () => new BoundedMap<string, { app: IApplication | null; at: number }>(10_000),
);

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** The application owning `token` (with a bot user), or null. */
export async function resolveBotToken(token: string): Promise<IApplication | null> {
  if (!token || token.length > 512) return null;
  const key = hashToken(token);
  const hit = tokenCache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < (hit.app ? TOKEN_TTL_MS : NEGATIVE_TTL_MS)) return hit.app;
  const { Application } = await import('@/lib/models');
  const app = await Application.findOne({ botToken: token });
  const value = app && app.botId ? app : null;
  tokenCache.set(key, { app: value, at: now });
  return value;
}

export function invalidateBotTokenCache(): void {
  tokenCache.clear();
}
