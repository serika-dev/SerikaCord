/**
 * Presence for the Discord-compatible gateway:
 *  - a bot's op 3 activities ("Playing ...") shown in the web UI through the
 *    existing rich presence store (rich_presence rows, the same ones the
 *    desktop app reports; GameActivityCard renders them), custom status
 *    (activity type 4) through users.custom_status;
 *  - Discord presence objects for PRESENCE_UPDATE and GUILD_CREATE `presences`.
 * The mapping functions are pure (tests/bot-presence.test.ts).
 */
import { resolveEffectiveStatus } from './presence';
import { activitySharing } from '@/lib/settings/privacy';

/** Discord activity types. */
export const ACTIVITY_TYPE = { PLAYING: 0, STREAMING: 1, LISTENING: 2, WATCHING: 3, CUSTOM: 4, COMPETING: 5 } as const;

export interface RichPresenceInput {
  type: string;
  name: string;
  details: string | null;
  state: string | null;
}

const clip = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);

/**
 * Discord activities -> rich presence rows (at most 5, custom status
 * excluded). "Playing" shows as a game, "Listening to" as music, the rest
 * as an app, which the existing activity card already renders.
 */
export function activitiesToRichPresence(activities: unknown[]): RichPresenceInput[] {
  const out: RichPresenceInput[] = [];
  const seen = new Set<string>();
  for (const raw of activities.slice(0, 5)) {
    if (!raw || typeof raw !== 'object') continue;
    const a = raw as Record<string, unknown>;
    const t = Number(a.type ?? 0);
    if (t === ACTIVITY_TYPE.CUSTOM) continue;
    const name = clip(a.name, 128);
    if (!name) continue;
    const type = t === ACTIVITY_TYPE.PLAYING ? 'game' : t === ACTIVITY_TYPE.LISTENING ? 'music' : 'other';
    const key = `${type}:${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type, name, details: clip(a.details, 128), state: clip(a.state, 128) });
  }
  return out;
}

/** The custom status text of a type 4 activity, or null. */
export function customStatusOf(activities: unknown[]): string | null {
  for (const raw of activities) {
    if (!raw || typeof raw !== 'object') continue;
    const a = raw as Record<string, unknown>;
    if (Number(a.type) === ACTIVITY_TYPE.CUSTOM) return clip(a.state, 128) ?? clip(a.name !== 'Custom Status' ? a.name : null, 128);
  }
  return null;
}

/** Discord activities for a stored user (their custom status). */
export function presenceActivitiesOf(user: { customStatus?: string | null; createdAt?: Date | string | null }): unknown[] {
  if (!user.customStatus) return [];
  return [{ id: 'custom', name: 'Custom Status', type: ACTIVITY_TYPE.CUSTOM, state: user.customStatus, created_at: Date.now() }];
}

/** Discord's activity objects from rich presence rows (GUILD_CREATE presences). */
export function richPresenceToActivities(rows: Array<{ type?: string | null; name: string; details?: string | null; state?: string | null; startedAt?: Date | null }>): unknown[] {
  return rows.slice(0, 5).map((r) => ({
    name: r.name,
    type: r.type === 'game' ? ACTIVITY_TYPE.PLAYING : r.type === 'music' ? ACTIVITY_TYPE.LISTENING : ACTIVITY_TYPE.PLAYING,
    ...(r.details ? { details: r.details } : {}),
    ...(r.state ? { state: r.state } : {}),
    created_at: (r.startedAt ?? new Date()).getTime(),
    ...(r.startedAt ? { timestamps: { start: r.startedAt.getTime() } } : {}),
  }));
}

/**
 * GUILD_CREATE `presences` for the members in the payload: online ones only
 * (Discord omits offline members), activities only for users who show them.
 */
export function buildPresences(
  users: Iterable<{ id: string; status?: string | null; presenceLastHeartbeatAt?: Date | string | null; isSystem?: boolean | null; customStatus?: string | null; settings?: unknown }>,
  richByUser: Map<string, Array<{ type?: string | null; name: string; details?: string | null; state?: string | null; startedAt?: Date | null }>>,
  now = Date.now(),
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const u of users) {
    const status = resolveEffectiveStatus(u, now);
    if (status === 'offline') continue;
    // Rich presence rows are games/apps: the user's "games & apps" switch.
    const showGames = activitySharing(u.settings).games;
    const activities = [
      ...presenceActivitiesOf(u),
      ...(showGames ? richPresenceToActivities(richByUser.get(u.id) ?? []) : []),
    ];
    out.push({ user: { id: u.id }, status, activities, client_status: { web: status } });
  }
  return out;
}

/**
 * The fields of a bot's op 3 activities other bots may see in
 * PRESENCE_UPDATE (lengths capped, unknown keys dropped).
 */
export function sanitizeActivities(activities: unknown[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const raw of activities.slice(0, 5)) {
    if (!raw || typeof raw !== 'object') continue;
    const a = raw as Record<string, unknown>;
    const type = Number(a.type ?? 0);
    if (!Number.isInteger(type) || type < 0 || type > 5) continue;
    const name = clip(a.name, 128) ?? (type === ACTIVITY_TYPE.CUSTOM ? 'Custom Status' : null);
    if (!name) continue;
    const act: Record<string, unknown> = { name, type, created_at: Date.now() };
    const state = clip(a.state, 128);
    const details = clip(a.details, 128);
    if (state) act.state = state;
    if (details) act.details = details;
    if (type === ACTIVITY_TYPE.STREAMING && typeof a.url === 'string' && a.url.length <= 512 && /^https:\/\/(www\.)?(twitch\.tv|youtube\.com)\//i.test(a.url)) act.url = a.url;
    out.push(act);
  }
  return out;
}

// ─── Storage (bots' op 3) ─────────────────────────────────────────────────────

/** Rich presence rows written for a bot live this long; heartbeats extend them. */
export const BOT_ACTIVITY_TTL_MS = 10 * 60_000;
/** Extend when less than this is left. */
export const BOT_ACTIVITY_REFRESH_MS = 5 * 60_000;

async function dropActivityCache(userId: string) {
  const { cache } = await import('@/lib/db/redis');
  await cache.del(`activity:${userId.toLowerCase()}`).catch(() => {});
  await cache.del(`activity:${userId}`).catch(() => {});
}

/** Replace the bot's rich presence rows (and custom status) with its op 3 activities. */
export async function setBotActivities(botId: string, activities: unknown[], opts: { customStatusChanged?: boolean } = {}): Promise<void> {
  const { db, schema } = await import('@/lib/db/postgres');
  const { and, eq, inArray } = await import('drizzle-orm');
  const t = schema.richPresence;
  const rows = activitiesToRichPresence(activities);
  const expiresAt = new Date(Date.now() + BOT_ACTIVITY_TTL_MS);
  for (const r of rows) {
    await db.insert(t)
      .values({ userId: botId, type: r.type, name: r.name, details: r.details, state: r.state, startedAt: new Date(), expiresAt })
      .onConflictDoUpdate({ target: [t.userId, t.type, t.name], set: { details: r.details, state: r.state, expiresAt, updatedAt: new Date() } });
  }
  const keep = rows.map((r) => `${r.type}:${r.name}`);
  const current = await db.select({ id: t.id, type: t.type, name: t.name }).from(t).where(eq(t.userId, botId));
  const stale = current.filter((c) => !keep.includes(`${c.type ?? 'other'}:${c.name}`)).map((c) => c.id);
  if (stale.length > 0) await db.delete(t).where(and(eq(t.userId, botId), inArray(t.id, stale)));
  if (opts.customStatusChanged) {
    await db.update(schema.users).set({ customStatus: customStatusOf(activities), updatedAt: new Date() }).where(eq(schema.users.id, botId));
    const { invalidateUserCache } = await import('./auth');
    await invalidateUserCache(botId).catch(() => {});
  }
  await dropActivityCache(botId);
}

/** Keep the bot's activity rows alive while it heartbeats. */
export async function refreshBotActivities(botId: string): Promise<void> {
  const { db, schema } = await import('@/lib/db/postgres');
  const { and, eq, lt } = await import('drizzle-orm');
  const t = schema.richPresence;
  await db.update(t).set({ expiresAt: new Date(Date.now() + BOT_ACTIVITY_TTL_MS) })
    .where(and(eq(t.userId, botId), lt(t.expiresAt, new Date(Date.now() + BOT_ACTIVITY_REFRESH_MS))));
}

/** The bot's last connection closed: its activities and custom status go away. */
export async function clearBotActivities(botId: string, opts: { customStatus?: boolean } = {}): Promise<void> {
  const { db, schema } = await import('@/lib/db/postgres');
  const { and, eq, isNotNull } = await import('drizzle-orm');
  await db.delete(schema.richPresence).where(eq(schema.richPresence.userId, botId));
  if (opts.customStatus) {
    await db.update(schema.users).set({ customStatus: null }).where(and(eq(schema.users.id, botId), eq(schema.users.isBot, true), isNotNull(schema.users.customStatus)));
  }
  await dropActivityCache(botId);
}
