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
import { decryptField, encryptLookupField, fieldLookupCandidates } from '@/lib/security/fieldEncryption';
import {
  attachmentPreview,
  buildFcmMessage,
  classifyFcmResponse,
  parseServiceAccount,
  pushImageUrl,
  pushPreview,
  pushProtocolOf,
  shouldPushToUser,
  type FcmServiceAccount,
  type PushAttachment,
  type PushPayload,
} from '@/lib/push/fcm';
import type { MentionNames } from '@/lib/chat/mentionText';
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
          // The E2EE notification key the phone holds (drizzle/manual_e2ee_notify.sql).
          await tx.execute(sql`ALTER TABLE "push_devices" ADD COLUMN IF NOT EXISTS "e2ee_notify_id" text`);
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

// Device tokens are encrypted at rest, deterministically, so the unique index
// and the lookups below still work on the stored value. Rows registered
// before that hold the plaintext token; every query matches both forms.

/**
 * Store (or move to this user) a device token. Keeps the newest few per user.
 * `notifyId` links the phone's E2EE notification key (checked by the caller);
 * without it an existing link of the same user is kept, and a token that
 * moves to another account loses it.
 */
export async function registerPushDevice(userId: string, token: string, platform: string, notifyId?: string | null): Promise<void> {
  await ensurePushSchema();
  const uid = normalizeId(userId);
  const stored = await encryptLookupField(token);
  // A legacy plaintext row for this device would otherwise stay next to the
  // encrypted one and get every push twice.
  if (stored !== token) await db.delete(table).where(eq(table.token, token));
  await db
    .insert(table)
    .values({ userId: uid, token: stored, platform, e2eeNotifyId: notifyId ?? null })
    .onConflictDoUpdate({
      target: table.token,
      set: {
        userId: uid,
        platform,
        updatedAt: new Date(),
        e2eeNotifyId: notifyId
          ? notifyId
          : sql`CASE WHEN ${table.userId} = ${uid}::uuid THEN ${table.e2eeNotifyId} ELSE NULL END`,
      },
    });
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

/** Link a registered phone (by push token) to its E2EE notification key. True when a row was updated. */
export async function linkPushNotifyKey(userId: string, token: string, notifyId: string): Promise<boolean> {
  await ensurePushSchema();
  const rows = await db
    .update(table)
    .set({ e2eeNotifyId: notifyId, updatedAt: new Date() })
    .where(and(eq(table.userId, normalizeId(userId)), inArray(table.token, await fieldLookupCandidates(token))))
    .returning({ id: table.id });
  return rows.length > 0;
}

/** Forget a device token (sign-out / notifications turned off on the phone). */
export async function unregisterPushDevice(userId: string, token: string): Promise<void> {
  await ensurePushSchema();
  await db.delete(table).where(and(eq(table.userId, normalizeId(userId)), inArray(table.token, await fieldLookupCandidates(token))));
}

async function deleteTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  try {
    const stored = (await Promise.all(tokens.map((t) => fieldLookupCandidates(t)))).flat();
    await db.delete(table).where(inArray(table.token, stored));
  } catch {
    // Best effort: a dead token is retried (and dropped) on the next push.
  }
}

/** A registered phone: its FCM token, the push protocol its app speaks, its E2EE notification key and whether it's the iOS app. */
type PushDevice = { token: string; protocol: number; notifyId: string | null; ios: boolean };

async function devicesFor(userIds: string[]): Promise<Map<string, PushDevice[]>> {
  const out = new Map<string, PushDevice[]>();
  if (userIds.length === 0) return out;
  await ensurePushSchema();
  const ids = [...new Set(userIds.map(normalizeId))];
  // e2ee_notify_id comes from boot DDL: if that never ran, push without it.
  const rows = await db
    .select({ userId: table.userId, token: table.token, platform: table.platform, notifyId: table.e2eeNotifyId })
    .from(table)
    .where(inArray(table.userId, ids))
    .catch(async () => (await db
      .select({ userId: table.userId, token: table.token, platform: table.platform })
      .from(table)
      .where(inArray(table.userId, ids))).map((r) => ({ ...r, notifyId: null as string | null })));
  const tokens = await Promise.all(rows.map((r) => decryptField(r.token)));
  for (const [i, r] of rows.entries()) {
    const list = out.get(r.userId) ?? [];
    list.push({ token: tokens[i], protocol: pushProtocolOf(r.platform), notifyId: r.notifyId ?? null, ios: r.platform === 'ios' });
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

// An active (not idle) desktop or browser session: message pushes to the phone
// wait, like Discord. Refreshed by every presence heartbeat (30s).
const attendingKey = (userId: string) => `push:attending:${normalizeId(userId)}`;
const ATTENDING_TTL_SECONDS = 75;

/** A desktop / browser heartbeat: the user is (or stopped) actively using it. */
export async function setDesktopAttending(userId: string, attending: boolean): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  if (attending) await redis.set(attendingKey(userId), '1', 'EX', ATTENDING_TTL_SECONDS);
  else await redis.del(attendingKey(userId));
}

// A message notification is (probably) showing on the user's phone for this
// conversation, so reading it elsewhere should remove it.
const shownKey = (userId: string, channelId: string) => `push:shown:${normalizeId(userId)}:${normalizeId(channelId)}`;
const SHOWN_TTL_SECONDS = 2 * 24 * 60 * 60;

async function markShown(userIds: string[], channelId: string): Promise<void> {
  const redis = getRedis();
  if (!redis || userIds.length === 0) return;
  const multi = redis.multi();
  for (const id of userIds) multi.set(shownKey(id, channelId), '1', 'EX', SHOWN_TTL_SECONDS);
  await multi.exec().catch(() => null);
}

/** The user read `channelId` somewhere: clear its notification from their phones. */
export function dismissReadPush(userId: string, channelId: string): void {
  if (!isPushConfigured()) return;
  run(async () => {
    const redis = getRedis();
    if (!redis) return;
    const removed = await redis.del(shownKey(userId, channelId)).catch(() => 0);
    if (!removed) return;
    const devices = await devicesFor([userId]);
    await sendToDevices(devices.get(userId) ?? [], { kind: 'message_read', tag: `message-${channelId}` });
  });
}

/** Of these users (who have devices), the ones not actively using the app. */
async function filterInactive(userIds: string[], opts: { messages?: boolean } = {}): Promise<string[]> {
  if (userIds.length === 0) return [];
  const redis = getRedis();
  let away: Array<string | null> = userIds.map(() => null);
  if (redis) {
    away = await redis.mget(...userIds.map(awayKey)).catch(() => userIds.map(() => null));
    if (opts.messages) {
      // Busy on a computer: no message pushes to the phone (calls still ring).
      const attending = await redis.mget(...userIds.map(attendingKey)).catch(() => userIds.map(() => null));
      const keep = userIds.filter((_, i) => !attending[i]);
      if (keep.length !== userIds.length) {
        const keepSet = new Set(keep);
        away = away.filter((_, i) => keepSet.has(userIds[i]));
        userIds = keep;
        if (userIds.length === 0) return [];
      }
    }
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

async function sendOne(account: FcmServiceAccount, device: PushDevice, payload: PushPayload): Promise<'ok' | 'dead' | 'error'> {
  const bearer = await accessToken(account);
  if (!bearer) return 'error';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.projectId)}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: buildFcmMessage(device.token, payload, { protocol: device.protocol, notifyId: device.notifyId, ios: device.ios }) }),
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

async function sendToDevices(devices: PushDevice[], payload: PushPayload): Promise<void> {
  const account = serviceAccount();
  if (!account || devices.length === 0) return;
  const dead: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < devices.length) {
      const device = devices[next++];
      if ((await sendOne(account, device, payload)) === 'dead') dead.push(device.token);
    }
  };
  await Promise.all(Array.from({ length: Math.min(SEND_CONCURRENCY, devices.length) }, worker));
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

const AVATAR_PX = 128;
const IMAGE_PX = 720;

/**
 * A push picture URL on our CDN. Older avatars / icons are stored with the
 * direct Backblaze B2 address; rewrite those to the CDN (same key) instead of
 * dropping them, so notifications show the real avatar.
 */
function pushImage(url: string | null | undefined, size: number): string | null {
  if (!url) return null;
  let candidate = url;
  try {
    const u = new URL(url);
    if (u.hostname.endsWith('.backblazeb2.com')) {
      let key = u.pathname.replace(/^\/+/, '').replace(/^file\//, '');
      const bucketPrefix = `${config.B2_BUCKET_NAME}/`;
      if (config.B2_BUCKET_NAME && key.startsWith(bucketPrefix)) key = key.slice(bucketPrefix.length);
      if (key) candidate = `${config.CDN_URL.replace(/\/+$/, '')}/${key}`;
    }
  } catch {
    // Relative key ("avatars/…"): serve it from the CDN.
    if (/^\/?[\w-]+\/[\w./-]+$/.test(url)) candidate = `${config.CDN_URL.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;
  }
  return pushImageUrl(candidate, size, cdnHost());
}

function cdnHost(): string {
  try {
    return new URL(config.CDN_URL).hostname;
  } catch {
    return 'cdn.serika.chat';
  }
}

/** A message's attachments / sticker, for "📷 Photo" previews and inline pictures. */
async function loadMessageMedia(messageId: string | undefined): Promise<{ label: string; image: string | null }> {
  if (!messageId) return { label: '', image: null };
  try {
    const [row] = await db
      .select({ attachments: schema.messages.attachments, sticker: schema.messages.sticker })
      .from(schema.messages)
      .where(eq(schema.messages.id, messageId))
      .limit(1);
    if (!row) return { label: '', image: null };
    const attachments = Array.isArray(row.attachments) ? (row.attachments as PushAttachment[]) : [];
    const sticker = row.sticker && typeof row.sticker === 'object' ? (row.sticker as { name?: string }) : null;
    const media = attachmentPreview(attachments, sticker);
    return { label: media.label, image: pushImage(media.image, IMAGE_PX) };
  } catch {
    return { label: '', image: null };
  }
}

/** Preview text + media label ("look at this · 📷 Photo"). */
function previewWithMedia(text: string, mediaLabel: string): string {
  if (!mediaLabel) return text;
  return text ? `${text} · ${mediaLabel}` : mediaLabel;
}

function timestampOf(value: string | Date | null | undefined): number {
  const t = value ? new Date(value).getTime() : NaN;
  return Number.isNaN(t) ? Date.now() : t;
}

/** Push body for end-to-end encrypted DMs (the server can't read them). */
const ENCRYPTED_MESSAGE_BODY = 'New encrypted message';

/** Of these users, the ones who turned message previews in notifications off. Never throws. */
async function previewsOffFor(userIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (userIds.length === 0) return out;
  const rows = await db
    .select({ id: schema.users.id, settings: schema.users.settings })
    .from(schema.users)
    .where(inArray(schema.users.id, userIds))
    .catch(() => [] as Array<{ id: string; settings: unknown }>);
  for (const r of rows) {
    const n = (r.settings as { notifications?: { showPreview?: unknown } } | null)?.notifications;
    if (n?.showPreview === false) out.add(normalizeId(r.id));
  }
  return out;
}

/** A DM (or group DM) message: push the recipients who aren't in the app. */
export function pushDmActivity(recipientIds: string[], event: {
  channelId: string;
  messageId?: string;
  authorId: string;
  authorName?: string;
  authorAvatar?: string | null;
  preview?: string;
  mentionNames?: MentionNames;
  hasAttachments?: boolean;
  hasSticker?: boolean;
  isCall?: boolean;
  /** Group DM membership / rename rows: badge only, no notification. */
  isSystem?: boolean;
  /** Set for group DMs: notifications name the group and open its page. */
  group?: { channelId: string; name: string; icon: string | null; memberCount?: number } | null;
  createdAt?: string;
  /** "@silent" message: badge only, no push. */
  silent?: boolean;
  /** End-to-end encrypted: no preview, no picture, no inline reply (it would be plaintext). */
  encrypted?: boolean;
  /**
   * The message's envelope (encrypted only). Phones that hold a notification
   * key get just their own wrap entry with it and decrypt the preview
   * themselves (protocol 3); everyone else gets "New encrypted message".
   */
  e2ee?: unknown;
}): void {
  if (event.isCall || event.isSystem || event.silent || !isPushConfigured()) return;
  const others = [...new Set(recipientIds)].filter((id) => id && id !== event.authorId);
  if (others.length === 0) return;
  run(async () => {
    const devices = await devicesFor(others);
    if (devices.size === 0) return;
    const targets = await filterInactive([...devices.keys()], { messages: true });
    if (targets.length === 0) return;
    const { getNotificationSettings } = await import('@/lib/services/notificationSettings');
    const group = event.group?.channelId ? event.group : null;
    const base = group ? `/dm/group/${group.channelId}` : `/dm/${event.authorId}`;
    const route = event.messageId ? `${base}?jump=${encodeURIComponent(event.messageId)}` : base;
    const media = !event.encrypted && (event.hasAttachments || event.hasSticker) ? await loadMessageMedia(event.messageId) : { label: '', image: null };
    const text = event.encrypted ? '' : pushPreview(event.preview, undefined, event.mentionNames);
    const body = event.encrypted
      ? ENCRYPTED_MESSAGE_BODY
      : previewWithMedia(text, media.label) ||
        (event.hasAttachments ? FALLBACK_ATTACHMENT : event.hasSticker ? FALLBACK_STICKER : FALLBACK_NEW_MESSAGE);
    const authorName = event.authorName || FALLBACK_NEW_MESSAGE;
    const tokens: PushDevice[] = [];
    const pushed: string[] = [];
    for (const userId of targets) {
      const doc = await getNotificationSettings(userId).catch(() => null);
      if (doc) {
        const resolved = resolveNotification({ doc, channelId: event.channelId, isDM: true });
        const alert = decideMessageAlert({ resolved, isDM: true, mentionedDirectly: false, mentionedEveryone: false, mentionedRole: false });
        if (!alert.notify) continue;
      }
      pushed.push(userId);
    }
    // Encrypted previews only for people who show message previews in
    // notifications (Settings → Notifications): the others' phones get no
    // ciphertext to decrypt, just "New encrypted message".
    const previewOff = event.encrypted && event.e2ee ? await previewsOffFor(pushed) : new Set<string>();
    for (const userId of pushed) {
      if (!previewOff.has(normalizeId(userId))) tokens.push(...(devices.get(userId) ?? []));
    }
    const noPreview = pushed.filter((id) => previewOff.has(normalizeId(id))).flatMap((id) => devices.get(id) ?? []);
    const payload: PushPayload = {
      kind: 'message',
      // Old APKs show this title: keep naming the group like before.
      title: group ? `${authorName} (${group.name})` : authorName,
      body,
      route,
      tag: `message-${event.channelId}`,
      rich: {
        kind: group ? 'group_dm' : 'dm',
        channelId: event.channelId,
        conversationTitle: group ? group.name : authorName,
        authorId: event.authorId,
        authorName,
        authorAvatar: pushImage(event.authorAvatar, AVATAR_PX),
        icon: group ? pushImage(group.icon, AVATAR_PX) : null,
        messageId: event.messageId ?? null,
        image: media.image,
        mention: false,
        timestamp: timestampOf(event.createdAt),
        // A reply from the notification would be sent unencrypted.
        canReply: !event.encrypted,
        ...(event.encrypted ? { encrypted: true } : {}),
        ...(event.encrypted && event.e2ee ? { e2ee: event.e2ee } : {}),
      },
    };
    await sendToDevices(tokens, payload);
    if (noPreview.length > 0 && payload.kind === 'message' && payload.rich) {
      await sendToDevices(noPreview, { ...payload, rich: { ...payload.rich, e2ee: undefined } });
    }
    await markShown(pushed, event.channelId);
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
  authorAvatar?: string | null;
  mentionedUserIds: string[];
  roleMentionUserIds?: string[];
  preview?: string;
  mentionNames?: MentionNames;
  createdAt?: string;
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
    const targets = await filterInactive([...devices.keys()], { messages: true });
    if (targets.length === 0) return;
    const [{ getNotificationSettings, getServerDefaultLevels }, { checkChannelAccess }] = await Promise.all([
      import('@/lib/services/notificationSettings'),
      import('@/lib/api/channels'),
    ]);
    const serverDefaults = await getServerDefaultLevels([event.serverId]).catch(() => ({} as Record<string, never>));
    const [server] = await db
      .select({ name: schema.servers.name, icon: schema.servers.icon })
      .from(schema.servers)
      .where(eq(schema.servers.id, event.serverId))
      .limit(1)
      .catch(() => []);
    const tokens: PushDevice[] = [];
    const pushed: string[] = [];
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
      pushed.push(userId);
    }
    if (tokens.length === 0) return;
    const where = [event.channelName ? `#${event.channelName}` : '', server?.name ?? ''].filter(Boolean).join(', ');
    const authorName = event.authorName || FALLBACK_NEW_MESSAGE;
    const media = await loadMessageMedia(event.messageId);
    const conversationTitle =
      [event.channelName ? `#${event.channelName}` : '', server?.name ?? ''].filter(Boolean).join(' · ') || authorName;
    await sendToDevices(tokens, {
      kind: 'message',
      title: where ? `${authorName} (${where})` : authorName,
      body: previewWithMedia(pushPreview(event.preview, undefined, event.mentionNames), media.label) || FALLBACK_NEW_MESSAGE,
      route: `/channels/${event.serverId}/${event.channelId}?jump=${encodeURIComponent(event.messageId)}`,
      tag: `message-${event.channelId}`,
      rich: {
        kind: 'channel',
        channelId: event.channelId,
        serverId: event.serverId,
        conversationTitle,
        authorId: event.authorId,
        authorName,
        authorAvatar: pushImage(event.authorAvatar, AVATAR_PX),
        icon: pushImage(server?.icon, AVATAR_PX),
        messageId: event.messageId,
        image: media.image,
        mention: true,
        timestamp: timestampOf(event.createdAt),
        canReply: true,
      },
    });
    await markShown(pushed, event.channelId);
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
    await sendToDevices(tokens, {
      kind: 'call_ring',
      roomId: ring.roomId,
      callerName: ring.group?.name ? `${callerName} (${ring.group.name})` : callerName,
      video: Boolean(ring.video),
      route,
      answerRoute,
    });
  });
}

/**
 * A server notice for specific users (a scheduled event they're interested in
 * started): push the phones of those not in the app.
 */
export function pushServerNotice(userIds: string[], notice: { title: string; body: string; route: string; tag: string }): void {
  if (!isPushConfigured() || userIds.length === 0) return;
  run(async () => {
    const devices = await devicesFor(userIds);
    if (devices.size === 0) return;
    const targets = await filterInactive([...devices.keys()]);
    const tokens = targets.flatMap((id) => devices.get(id) ?? []);
    // No `rich` block: notices stay system-rendered on every APK.
    await sendToDevices(tokens, { kind: 'message', ...notice });
  });
}

/** The call stopped ringing (answered elsewhere, declined, ended): drop the ring. */
export function pushCallCancel(userIds: string[], roomId: string): void {
  if (!roomId || !isPushConfigured() || userIds.length === 0) return;
  run(async () => {
    const devices = await devicesFor(userIds);
    const tokens = [...devices.values()].flat();
    await sendToDevices(tokens, { kind: 'call_cancel', roomId });
  });
}
