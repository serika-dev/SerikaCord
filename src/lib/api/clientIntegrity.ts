// Client mod reports (src/lib/clientIntegrity), mounted at /api.
//
//   POST /users/@me/client-integrity   { signals: string[] }
//
// The web app sends the signs of a client mod it found (once per session).
// Kept per user for 30 days for staff (GET /api/admin/users/:id). Log only:
// nothing is blocked or enforced from it.
import { Elysia, t } from 'elysia';
import { authenticateRequest } from '@/lib/services/auth';
import { checkRateLimit } from '@/lib/security';
import { cache } from '@/lib/db';
import { parseSignals, type ClientIntegritySignal } from '@/lib/clientIntegrity/signals';

const TTL_SECONDS = 30 * 24 * 3600;

export interface ClientIntegrityRecord {
  /** Every signal seen in the window. */
  signals: ClientIntegritySignal[];
  /** The latest report's signals. */
  lastSignals: ClientIntegritySignal[];
  firstSeen: string;
  lastSeen: string;
  reports: number;
}

const keyFor = (userId: string) => `clientint:${userId.toLowerCase()}`;

export async function getClientIntegrity(userId: string): Promise<ClientIntegrityRecord | null> {
  const record = (await cache.get<ClientIntegrityRecord>(keyFor(userId)).catch(() => null)) ?? null;
  if (!record) return null;
  // Only signals still in the list (retired ones drop out of old records).
  const signals = parseSignals(record.signals);
  return signals.length ? { ...record, signals, lastSignals: parseSignals(record.lastSignals) } : null;
}

export const clientIntegrityRoutes = new Elysia({ prefix: '/users' })
  .post('/@me/client-integrity', async ({ headers, cookie, body, set }) => {
    const authToken = (cookie as Record<string, { value?: unknown }>).auth_token?.value;
    const { user } = await authenticateRequest(
      headers.authorization ?? null,
      typeof authToken === 'string' ? { auth_token: authToken } : {},
    );
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    const limit = await checkRateLimit('clientIntegrity', user.id);
    if (!limit.success) { set.status = 429; return { error: 'Too many reports' }; }
    const signals = parseSignals(body.signals);
    if (signals.length === 0) return { ok: true };
    const now = new Date().toISOString();
    const prev = await getClientIntegrity(user.id);
    const record: ClientIntegrityRecord = {
      signals: parseSignals([...(prev?.signals ?? []), ...signals]),
      lastSignals: signals,
      firstSeen: prev?.firstSeen ?? now,
      lastSeen: now,
      reports: (prev?.reports ?? 0) + 1,
    };
    await cache.set(keyFor(user.id), record, TTL_SECONDS).catch(() => {});
    return { ok: true };
  }, {
    body: t.Object({ signals: t.Array(t.String({ maxLength: 40 }), { maxItems: 20 }) }),
  });
