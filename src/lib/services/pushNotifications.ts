// Mobile push notifications for the Capacitor app (Firebase Cloud Messaging,
// HTTP v1). Device tokens live in `push_devices`; pushes go out for DMs,
// mentions and incoming calls when the user isn't using the app right now
// (no live activity stream / recent heartbeat, or the phone app reported it
// went to the background). Without FCM_SERVICE_ACCOUNT_JSON everything here is
// a no-op, so the web app and local notifications keep working unchanged.
import { createSign } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { config } from '@/lib/config';
import { db, schema } from '@/lib/db/postgres';
import { getRedis } from '@/lib/db/redis';
import { normalizeId } from '@/lib/db/normalizeId';
import {
  buildFcmMessage,
  classifyFcmResponse,
  parseServiceAccount,
  pushPreview,
  shouldPushToUser,
  type FcmServiceAccount,
  type PushPayload,
} from '@/lib/push/fcm';
import { decideMessageAlert, resolveNotification } from '@/lib/notifications/levels';

const table = schema.pushDevices;
const MAX_DEVICES_PER_USER = 10;
const MAX_MENTION_PUSH_RECIPIENTS = 200;
const AWAY_TTL_SECONDS = 12 * 60 * 60;
const SEND_CONCURRENCY = 8;

type PushGlobal = {
  __pushSchema?: Promise<void> | null;
  __fcmAccount?: { raw: string; account: FcmServiceAccount | null };
  __fcmToken?: { token: string; expires: number } | null;
  __fcmTokenInflight?: Promise<string | null> | null;
  __fcmWarned?: boolean;
};
const g = globalThis as unknown as PushGlobal;

// ─── Boot-time schema ensure ──────────────────────────────────────────────────
// Mirrors drizzle/manual_push_devices.sql. Additive + idempotent; a brand-new
// table takes no locks on shared tables, but keep the lock_timeout guard like
// the other boot DDL so a stuck catalog lock can never stall startup.
export function ensurePushSchema(): Promise<void> {
  if (g.__pushSchema) return g.__pushSchema;
  g.__pushSchema = (async () => {
    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        await db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
          await tx.execute(sql`CREATE TABLE IF NOT EXISTS "push_devices" (
            "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
            "user_id" uuid NOT NULL,
            "token" text NOT NULL,
            "platform" text DEFAULT 'android' NOT NULL,
            "created_at" timestamp DEFAULT now(),
            "updated_at" timestamp DEFAULT now()
          )`);
          await tx.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "push_devices_token_unique" ON "push_devices" ("token")`);
          await tx.execute(sql`CREATE INDEX IF NOT EXISTS "push_devices_user_id_idx" ON "push_devices" ("user_id")`);
        });
        return;
      } catch (err) {
        console.error(
          `[push] Ensuring push_devices schema failed (attempt ${attempt}):`,
          (err as Error)?.message ?? err,
        );
        await new Promise((r) => setTimeout(r, Math.min(30_000, 2_000 * attempt)));
      }
    }
    g.__pushSchema = null;
  })();
  return g.__pushSchema;
}

// ─── Configuration / auth ─────────────────────────────────────────────────────

function serviceAccount(): FcmServiceAccount | null {
  const raw = config.FCM_SERVICE_ACCOUNT_JSON || '';
  if (g.__fcmAccount?.raw !== raw) {
    g.__fcmAccount = { raw, account: parseServiceAccount(raw) };
    if (raw && !g.__fcmAccount.account) console.error('[push] FCM_SERVICE_ACCOUNT_JSON is set but could not be parsed');
  }
  return g.__fcmAccount.account;
}

/** Push sending is configured (FCM service account present and valid). */
export function isPushConfigured(): boolean {
  const ok = serviceAccount() !== null;
  if (!ok && !g.__fcmWarned) {
    g.__fcmWarned = true;
    console.warn('[push] FCM_SERVICE_ACCOUNT_JSON not set — mobile push notifications are disabled');
  }
  return ok;
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** OAuth access token for the FCM scope (service-account JWT bearer flow), cached. */
async function accessToken(account: FcmServiceAccount): Promise<string | null> {
  if (g.__fcmToken && g.__fcmToken.expires > Date.now() + 60_000) return g.__fcmToken.token;
  if (g.__fcmTokenInflight) return g.__fcmTokenInflight;
  g.__fcmTokenInflight = (async () => {
    try {
      const now = Math.floor(Date.now() / 1000);
      const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
      const claims = base64url(JSON.stringify({
        iss: account.clientEmail,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      }));
      const signer = createSign('RSA-SHA256');
      signer.update(`${header}.${claims}`);
      const signature = base64url(signer.sign(account.privateKey));
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: `${header}.${claims}.${signature}`,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        console.error('[push] FCM auth failed:', res.status);
        return null;
      }
      const data = (await res.json()) as { access_token?: string; expires_in?: number };
      if (!data.access_token) return null;
      g.__fcmToken = { token: data.access_token, expires: Date.now() + (data.expires_in ?? 3600) * 1000 };
      return data.access_token;
    } catch (err) {
      console.error('[push] FCM auth error:', (err as Error)?.message ?? err);
      return null;
    } finally {
      g.__fcmTokenInflight = null;
    }
  })();
  return g.__fcmTokenInflight;
}

// ─── Devices ──────────────────────────────────────────────────────────────────

/** Store (or move to this user) a device token. Keeps the newest few per user. */
export async function registerPushDevice(userId: string, token: string, platform: string): Promise<void> {
  await ensurePushSchema();
  const uid = normalizeId(userId);
  await db
    .insert(table)
    .values({ userId: uid, token, platform })
    .onConflictDoUpdate({ target: table.token, set: { userId: uid, platform, updatedAt: new Date() } });
  const rows = await db
    .select({ id: table.id, updatedAt: table.updatedAt })
    .from(table)
    .where(eq(table.userId, uid));
  if (rows.length > MAX_DEVICES_PER_USER) {
    const stale = rows
      .sort((a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime())
      .slice(MAX_DEVICES_PER_USER)
      .map((r) => r.id);
    if (stale.length > 0) await db.delete(table).where(and(eq(table.userId, uid), inArray(table.id, stale)));
  }
}

/** Forget a device token (sign-out / notifications turned off on the phone). */
export async function unregisterPushDevice(userId: string, token: string): Promise<void> {
  await ensurePushSchema();
  await db.delete(table).where(and(eq(table.userId, normalizeId(userId)), eq(table.token, token)));
}

async function deleteTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  await db.delete(table).where(inArray(table.token, tokens)).catch(() => {});
}

async function devicesFor(userIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (userIds.length === 0) return out;
  await ensurePushSchema();
  const ids = [...new Set(userIds.map(normalizeId))];
  const rows = await db
    .select({ userId: table.userId, token: table.token })
    .from(table)
    .where(inArray(table.userId, ids));
  for (const r of rows) {
    const list = out.get(r.userId) ?? [];
    list.push(r.token);
    out.set(r.userId, list);
  }
  return out;
}

// ─── Away state (phone app in the background) ─────────────────────────────────

const awayKey = (userId: string) => `push:away:${normalizeId(userId)}`;

/** The phone app went to the background (away) or came back. */
export async function setPushAway(userId: string, away: boolean): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  if (away) await redis.set(awayKey(userId), '1', 'EX', AWAY_TTL_SECONDS);
  else await redis.del(awayKey(userId));
}

/** Of these users (who have devices), the ones not actively using the app. */
async function filterInactive(userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const redis = getRedis();
  let away: Array<string | null> = userIds.map(() => null);
  if (redis) {
    away = await redis.mget(...userIds.map(awayKey)).catch(() => userIds.map(() => null));
  }
  const { hasActivityConnection } = await import('@/lib/api/activity');
  const needHeartbeat = userIds.filter((id, i) => !away[i] && !hasActivityConnection(id));
  const heartbeats = new Map<string, Date | null>();
  if (needHeartbeat.length > 0) {
    const rows = await db
      .select({ id: schema.users.id, at: schema.users.presenceLastHeartbeatAt })
      .from(schema.users)
      .where(inArray(schema.users.id, needHeartbeat));
    for (const r of rows) heartbeats.set(r.id, r.at ?? null);
  }
  const now = Date.now();
  return userIds.filter((id, i) =>
    shouldPushToUser({
      away: Boolean(away[i]),
      connectedHere: hasActivityConnection(id),
      lastHeartbeatAt: heartbeats.get(id) ?? null,
      now,
    }),
  );
}

// ─── Sending ──────────────────────────────────────────────────────────────────

async function sendOne(account: FcmServiceAccount, token: string, payload: PushPayload): Promise<'ok' | 'dead' | 'error'> {
  const bearer = await accessToken(account);
  if (!bearer) return 'error';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.projectId)}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: buildFcmMessage(token, payload) }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = res.ok ? null : await res.json().catch(() => null);
      const outcome = classifyFcmResponse(res.status, body);
      if (outcome === 'ok') return 'ok';
      if (outcome === 'unregistered') return 'dead';
      if (res.status === 401) g.__fcmToken = null;
      if (outcome !== 'retry') return 'error';
    } catch {
      /* network error: retry once */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return 'error';
}

async function sendToTokens(tokens: string[], payload: PushPayload): Promise<void> {
  const account = serviceAccount();
  if (!account || tokens.length === 0) return;
  const dead: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < tokens.length) {
      const token = tokens[next++];
      if ((await sendOne(account, token, payload)) === 'dead') dead.push(token);
    }
  };
  await Promise.all(Array.from({ length: Math.min(SEND_CONCURRENCY, tokens.length) }, worker));
  await deleteTokens(dead);
}

function run(task: () => Promise<void>): void {
  void task().catch((err) => console.error('[push] send failed:', (err as Error)?.message ?? err));
}

// ─── Events ───────────────────────────────────────────────────────────────────

// Push text is built server-side without the recipient's locale, so the few
// fallback phrases stay English; message text is the user's own content.
const FALLBACK_NEW_MESSAGE = 'New message';
const FALLBACK_ATTACHMENT = 'Sent an attachment';
const FALLBACK_STICKER = 'Sent a sticker';

/** A DM (or group DM) message: push the recipients who aren't in the app. */
export function pushDmActivity(recipientIds: string[], event: {
  channelId: string;
  messageId?: string;
  authorId: string;
  authorName?: string;
  preview?: string;
  hasAttachments?: boolean;
  hasSticker?: boolean;
  isCall?: boolean;
  /** "@silent" message: badge only, no push. */
  silent?: boolean;
}): void {
  if (event.isCall || event.silent || !isPushConfigured()) return;
  const others = [...new Set(recipientIds)].filter((id) => id && id !== event.authorId);
  if (others.length === 0) return;
  run(async () => {
    const devices = await devicesFor(others);
    if (devices.size === 0) return;
    const targets = await filterInactive([...devices.keys()]);
    if (targets.length === 0) return;
    const { getNotificationSettings } = await import('@/lib/services/notificationSettings');
    const route = event.messageId
      ? `/dm/${event.authorId}?jump=${encodeURIComponent(event.messageId)}`
      : `/dm/${event.authorId}`;
    const body =
      pushPreview(event.preview) ||
      (event.hasAttachments ? FALLBACK_ATTACHMENT : event.hasSticker ? FALLBACK_STICKER : FALLBACK_NEW_MESSAGE);
    const tokens: string[] = [];
    for (const userId of targets) {
      const doc = await getNotificationSettings(userId).catch(() => null);
      if (doc) {
        const resolved = resolveNotification({ doc, channelId: event.channelId, isDM: true });
        const alert = decideMessageAlert({ resolved, isDM: true, mentionedDirectly: false, mentionedEveryone: false, mentionedRole: false });
        if (!alert.notify) continue;
      }
      tokens.push(...(devices.get(userId) ?? []));
    }
    await sendToTokens(tokens, {
      kind: 'message',
      title: event.authorName || FALLBACK_NEW_MESSAGE,
      body,
      route,
      tag: `message-${event.channelId}`,
    });
  });
}

/** A server channel message: push users it pinged (direct or role mention). */
export function pushChannelActivity(event: {
  serverId: string;
  channelId: string;
  channelName?: string;
  parentId?: string | null;
  messageId: string;
  authorId: string;
  authorName?: string;
  mentionedUserIds: string[];
  roleMentionUserIds?: string[];
  preview?: string;
  /** "@silent" message: no push. */
  silent?: boolean;
}): void {
  if (event.silent || !isPushConfigured()) return;
  const direct = new Set(event.mentionedUserIds ?? []);
  const viaRole = new Set(event.roleMentionUserIds ?? []);
  const candidates = [...new Set([...direct, ...viaRole])]
    .filter((id) => id && id !== event.authorId)
    .slice(0, MAX_MENTION_PUSH_RECIPIENTS);
  if (candidates.length === 0) return;
  run(async () => {
    const devices = await devicesFor(candidates);
    if (devices.size === 0) return;
    const targets = await filterInactive([...devices.keys()]);
    if (targets.length === 0) return;
    const [{ getNotificationSettings, getServerDefaultLevels }, { checkChannelAccess }] = await Promise.all([
      import('@/lib/services/notificationSettings'),
      import('@/lib/api/channels'),
    ]);
    const serverDefaults = await getServerDefaultLevels([event.serverId]).catch(() => ({} as Record<string, never>));
    const [server] = await db
      .select({ name: schema.servers.name })
      .from(schema.servers)
      .where(eq(schema.servers.id, event.serverId))
      .limit(1)
      .catch(() => []);
    const tokens: string[] = [];
    for (const userId of targets) {
      const access = await checkChannelAccess(userId, event.channelId, { lean: true }).catch(() => ({ hasAccess: false }));
      if (!access.hasAccess) continue;
      const doc = await getNotificationSettings(userId).catch(() => null);
      if (doc) {
        const resolved = resolveNotification({
          doc,
          serverId: event.serverId,
          channelId: event.channelId,
          ancestorIds: [event.parentId],
          serverDefault: serverDefaults[event.serverId],
        });
        const alert = decideMessageAlert({
          resolved,
          isDM: false,
          mentionedDirectly: direct.has(userId),
          mentionedEveryone: false,
          mentionedRole: viaRole.has(userId),
        });
        if (!alert.notify) continue;
      }
      tokens.push(...(devices.get(userId) ?? []));
    }
    const where = [event.channelName ? `#${event.channelName}` : '', server?.name ?? ''].filter(Boolean).join(', ');
    await sendToTokens(tokens, {
      kind: 'message',
      title: where ? `${event.authorName || FALLBACK_NEW_MESSAGE} (${where})` : event.authorName || FALLBACK_NEW_MESSAGE,
      body: pushPreview(event.preview) || FALLBACK_NEW_MESSAGE,
      route: `/channels/${event.serverId}/${event.channelId}?jump=${encodeURIComponent(event.messageId)}`,
      tag: `message-${event.channelId}`,
    });
  });
}

/** An incoming DM / group call: full-screen ring on phones not in the app. */
export function pushCallRing(userIds: string[], ring: {
  roomId: string;
  video?: boolean;
  caller?: { id?: string; displayName?: string; username?: string } | null;
  group?: { name?: string } | null;
}): void {
  if (!ring.roomId || !isPushConfigured() || userIds.length === 0) return;
  run(async () => {
    const devices = await devicesFor(userIds);
    if (devices.size === 0) return;
    const targets = await filterInactive([...devices.keys()]);
    const tokens = targets.flatMap((id) => devices.get(id) ?? []);
    const callerId = ring.caller?.id;
    const route = !ring.group && callerId ? `/dm/${callerId}` : '/channels/messages';
    const answerRoute = !ring.group && callerId ? `/dm/${callerId}?call=${ring.video ? 'video' : 'voice'}` : route;
    const callerName = ring.caller?.displayName || ring.caller?.username || '';
    await sendToTokens(tokens, {
      kind: 'call_ring',
      roomId: ring.roomId,
      callerName: ring.group?.name ? `${callerName} (${ring.group.name})` : callerName,
      video: Boolean(ring.video),
      route,
      answerRoute,
    });
  });
}

/** The call stopped ringing (answered elsewhere, declined, ended): drop the ring. */
export function pushCallCancel(userIds: string[], roomId: string): void {
  if (!roomId || !isPushConfigured() || userIds.length === 0) return;
  run(async () => {
    const devices = await devicesFor(userIds);
    const tokens = [...devices.values()].flat();
    await sendToTokens(tokens, { kind: 'call_cancel', roomId });
  });
}
