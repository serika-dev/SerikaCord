// Server side of end-to-end encryption (docs/architecture/e2ee.md): the
// feature flag, the boot-time schema ensure, public key lookups, and the checks
// the DM send/edit routes run on encrypted messages. The server only ever sees
// public keys, sealed backups and opaque envelopes.
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db, schema } from '@/lib/db/postgres';
import { normalizeId } from '@/lib/db/normalizeId';
import { cache, getRedis } from '@/lib/db/redis';
import { config } from '@/lib/config';
import {
  CONVERSATION_STATE_MAX_SKEW_MS,
  E2eeVerifyError,
  canonicalKeySet,
  dmPair,
  parseConversationState,
  verifyConversationStateSig,
  type ConversationStateRecord,
  decryptAttachment,
  isFrankingDisclosure,
  isKeysVersion,
  verifyFranking,
  verifyNotifyKey,
  type PublicNotifyKey,
  type Envelope,
  type MessagePayload,
} from '@/lib/e2ee';
import type { ChannelLike, ParsedEncryptedBody } from '@/lib/e2ee/policy';
import {
  E2EE_NOTICE,
  ENCRYPTED_PREVIEW,
  e2eeMismatch,
  e2eeNoticeKind,
  e2eeOffNotice,
  isE2eeChannel,
  isE2eeNotice,
  offNoticeRecord,
  parseEncryptedBody as parseEncryptedBodyFor,
  storedEnvelope,
} from '@/lib/e2ee/policy';

import { isSystemUser } from '@/lib/services/systemUsers';

// ─── Feature flag ─────────────────────────────────────────────────────────────
// Canary and production share one database, and production runs older code
// until a release: E2EE stays off (no key setup, no new encrypted DMs, plaintext
// sends accepted) until E2EE_ENABLED=1. Turn it on only once production runs a
// release with this code. Reading / rendering / replying in conversations that
// are already encrypted keeps working either way.
export function e2eeEnabled(): boolean {
  return process.env.E2EE_ENABLED === '1';
}

export const E2EE_DISABLED_ERROR = 'End-to-end encryption is not available right now';

// ─── Boot-time schema ensure ──────────────────────────────────────────────────
// Mirrors drizzle/manual_e2ee.sql. Additive + idempotent. messages.e2ee is a
// nullable jsonb without a default (metadata-only on the big table); each
// attempt gives up quickly instead of queueing behind a long lock, and retries.
const g = globalThis as unknown as { __e2eeSchema?: Promise<void> | null };

export function ensureE2eeSchema(): Promise<void> {
  if (g.__e2eeSchema) return g.__e2eeSchema;
  g.__e2eeSchema = (async () => {
    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        await db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
          await tx.execute(sql`ALTER TABLE channels ADD COLUMN IF NOT EXISTS e2ee boolean DEFAULT false`);
          await tx.execute(sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS e2ee jsonb`);
          await tx.execute(sql`CREATE TABLE IF NOT EXISTS e2ee_identities (
            user_id uuid PRIMARY KEY,
            identity_pub text NOT NULL,
            backup_pub text NOT NULL,
            backup_sig text NOT NULL,
            backup_blob text,
            backup_salt text,
            backup_iters integer,
            created_at timestamp DEFAULT now(),
            updated_at timestamp DEFAULT now()
          )`);
          await tx.execute(sql`CREATE TABLE IF NOT EXISTS e2ee_devices (
            id text PRIMARY KEY,
            user_id uuid NOT NULL,
            ecdh_pub text NOT NULL,
            sign_pub text NOT NULL,
            device_sig text NOT NULL,
            identity_pub text NOT NULL,
            name text,
            created_at timestamp DEFAULT now(),
            last_seen_at timestamp DEFAULT now(),
            revoked_at timestamp
          )`);
          await tx.execute(sql`CREATE INDEX IF NOT EXISTS e2ee_devices_user_id_idx ON e2ee_devices (user_id)`);
          // Earlier envelopes of edited encrypted messages (reports can name the version they saw).
          await tx.execute(sql`CREATE TABLE IF NOT EXISTS e2ee_envelope_history (
            message_id uuid NOT NULL,
            sig text NOT NULL,
            envelope jsonb NOT NULL,
            replaced_at timestamp DEFAULT now(),
            PRIMARY KEY (message_id, sig)
          )`);
          // Notification keys (Android push previews; drizzle/manual_e2ee_notify.sql).
          await tx.execute(sql`CREATE TABLE IF NOT EXISTS e2ee_notify_keys (
            id text PRIMARY KEY,
            user_id uuid NOT NULL,
            device_id text NOT NULL,
            ecdh_pub text NOT NULL,
            sig text NOT NULL,
            created_at timestamp DEFAULT now(),
            revoked_at timestamp
          )`);
          await tx.execute(sql`CREATE INDEX IF NOT EXISTS e2ee_notify_keys_user_id_idx ON e2ee_notify_keys (user_id)`);
          // PIN backups and "turned off" records (drizzle/manual_e2ee_pin.sql).
          await tx.execute(sql`CREATE TABLE IF NOT EXISTS e2ee_pin_backups (
            user_id uuid PRIMARY KEY,
            identity_pub text,
            salt text,
            iterations integer,
            bundle text,
            verifier_hash text,
            secret_enc text,
            pending_secret_enc text,
            pending_expires_at timestamp,
            attempts integer NOT NULL DEFAULT 0,
            locked_at timestamp,
            created_at timestamp DEFAULT now(),
            updated_at timestamp DEFAULT now()
          )`);
          await tx.execute(sql`CREATE TABLE IF NOT EXISTS e2ee_conversation_states (
            channel_id uuid PRIMARY KEY,
            state text NOT NULL,
            record jsonb,
            updated_by uuid,
            updated_at timestamp DEFAULT now()
          )`);
        });
        return;
      } catch (err) {
        console.error(`[e2ee] Ensuring E2EE schema failed (attempt ${attempt}):`, (err as Error)?.message ?? err);
        await new Promise((r) => setTimeout(r, Math.min(30_000, 2_000 * attempt)));
      }
    }
    g.__e2eeSchema = null;
  })();
  return g.__e2eeSchema;
}

// ─── Key lookups ──────────────────────────────────────────────────────────────

export type IdentityRow = typeof schema.e2eeIdentities.$inferSelect;
export type DeviceRow = typeof schema.e2eeDevices.$inferSelect;

export async function getIdentity(userId: string): Promise<IdentityRow | null> {
  const [row] = await db
    .select()
    .from(schema.e2eeIdentities)
    .where(eq(schema.e2eeIdentities.userId, normalizeId(userId)))
    .limit(1);
  return row ?? null;
}

/** Devices of these users (active only, unless `includeRevoked`). */
export async function devicesOf(userIds: string[], opts: { includeRevoked?: boolean } = {}): Promise<DeviceRow[]> {
  if (userIds.length === 0) return [];
  const ids = [...new Set(userIds.map((u) => normalizeId(u)))];
  return db
    .select()
    .from(schema.e2eeDevices)
    .where(and(
      inArray(schema.e2eeDevices.userId, ids),
      opts.includeRevoked ? undefined : isNull(schema.e2eeDevices.revokedAt),
    ));
}

/** One device of `userId` (revoked ones included: needed to verify old signatures). */
export async function findUserDevice(userId: string, deviceId: string): Promise<DeviceRow | null> {
  const [row] = await db
    .select()
    .from(schema.e2eeDevices)
    .where(and(eq(schema.e2eeDevices.id, deviceId), eq(schema.e2eeDevices.userId, normalizeId(userId))))
    .limit(1);
  return row ?? null;
}

export function publicDevice(d: DeviceRow) {
  return {
    id: d.id,
    userId: d.userId,
    ecdhPub: d.ecdhPub,
    signPub: d.signPub,
    sig: d.deviceSig,
    identityPub: d.identityPub,
    name: d.name ?? null,
    createdAt: d.createdAt,
    lastSeenAt: d.lastSeenAt,
    revokedAt: d.revokedAt ?? null,
  };
}

/** A device as other people see it: keys and revocation only (no name, no activity times). */
export function contactDevice(d: DeviceRow) {
  return {
    id: d.id,
    userId: d.userId,
    ecdhPub: d.ecdhPub,
    signPub: d.signPub,
    sig: d.deviceSig,
    identityPub: d.identityPub,
    revokedAt: d.revokedAt ?? null,
  };
}

/**
 * Whether `viewerId` may look up `targetId`'s key bundle: themselves, a
 * friend, someone they share a DM / group DM or a server with.
 */
export async function canLookUpKeys(viewerId: string, targetId: string): Promise<boolean> {
  const viewer = normalizeId(viewerId);
  const target = normalizeId(targetId);
  if (viewer === target) return true;
  const [friend] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(eq(schema.users.id, viewer), sql`${target}::uuid = ANY(${schema.users.friends})`))
    .limit(1);
  if (friend) return true;
  const [conversation] = await db
    .select({ id: schema.channels.id })
    .from(schema.channels)
    .where(and(
      inArray(schema.channels.type, ['dm', 'group_dm']),
      sql`${schema.channels.recipientIds} @> ARRAY[${viewer}, ${target}]::uuid[]`,
    ))
    .limit(1);
  if (conversation) return true;
  const mine = alias(schema.serverMembers, 'viewer_members');
  const theirs = alias(schema.serverMembers, 'target_members');
  const [server] = await db
    .select({ id: mine.serverId })
    .from(mine)
    .innerJoin(theirs, eq(mine.serverId, theirs.serverId))
    .where(and(eq(mine.userId, viewer), eq(theirs.userId, target)))
    .limit(1);
  return Boolean(server);
}

// ─── Notification keys (Android push previews, lib/e2ee/notifyKeys.ts) ───────

export type NotifyKeyRow = typeof schema.e2eeNotifyKeys.$inferSelect;

/** Active notification keys of these users. Never throws (no table yet → none). */
async function activeNotifyKeysOf(userIds: string[]): Promise<NotifyKeyRow[]> {
  if (userIds.length === 0) return [];
  return db
    .select()
    .from(schema.e2eeNotifyKeys)
    .where(and(inArray(schema.e2eeNotifyKeys.userId, userIds), isNull(schema.e2eeNotifyKeys.revokedAt)))
    .catch(() => [] as NotifyKeyRow[]);
}

/**
 * The notification keys a bundle lists: only ones whose owning device is
 * active, the newest per device (clients check the device signature anyway).
 */
function bundleNotifyKeys(rows: NotifyKeyRow[], activeDeviceIds: Set<string>) {
  const perDevice = new Map<string, NotifyKeyRow>();
  for (const k of rows) {
    if (!activeDeviceIds.has(k.deviceId)) continue;
    const prev = perDevice.get(k.deviceId);
    if (!prev || new Date(k.createdAt ?? 0).getTime() > new Date(prev.createdAt ?? 0).getTime()) perDevice.set(k.deviceId, k);
  }
  return [...perDevice.values()].map((k) => ({ id: k.id, deviceId: k.deviceId, ecdhPub: k.ecdhPub, sig: k.sig }));
}

/** Whether `notifyId` is an active notification key of `userId` on one of their active devices. */
export async function isActiveNotifyKeyOf(userId: string, notifyId: string): Promise<boolean> {
  const [row] = await db
    .select({ deviceId: schema.e2eeNotifyKeys.deviceId })
    .from(schema.e2eeNotifyKeys)
    .where(and(
      eq(schema.e2eeNotifyKeys.id, notifyId),
      eq(schema.e2eeNotifyKeys.userId, normalizeId(userId)),
      isNull(schema.e2eeNotifyKeys.revokedAt),
    ))
    .limit(1)
    .catch(() => []);
  if (!row) return false;
  const device = await findUserDevice(userId, row.deviceId).catch(() => null);
  return Boolean(device && !device.revokedAt);
}

export type NotifyKeyResult =
  | { ok: true; key: PublicNotifyKey; changed: boolean }
  | { ok: false; status: number; error: string };

/**
 * Register a notification key for one of the caller's active devices. The
 * owning device's signing key must vouch for it (the server can't add one).
 * A device keeps one: registering a new key revokes its previous ones.
 * Registering the same key again is a no-op (the stored signature is kept, so
 * the key-set version doesn't move).
 */
export async function registerNotifyKey(userId: string, key: PublicNotifyKey): Promise<NotifyKeyResult> {
  const uid = normalizeId(userId);
  const device = await findUserDevice(uid, key.deviceId);
  if (!device || device.revokedAt) return { ok: false, status: 409, error: 'This device is not registered for end-to-end encryption' };
  if (!(await verifyNotifyKey(device.signPub, uid, key))) {
    return { ok: false, status: 400, error: 'The notification key signature does not match this device' };
  }
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`e2ee:${uid}`}))`);
    const [existing] = await tx.select().from(schema.e2eeNotifyKeys).where(eq(schema.e2eeNotifyKeys.id, key.id)).limit(1);
    if (existing) {
      const same = normalizeId(existing.userId) === uid && existing.deviceId === key.deviceId && existing.ecdhPub === key.ecdhPub;
      if (!same) return { ok: false, status: 409, error: 'Notification key id already in use' } as const;
      if (existing.revokedAt) return { ok: false, status: 409, error: 'This notification key was removed. Create a new one.' } as const;
      return { ok: true, key: { id: existing.id, deviceId: existing.deviceId, ecdhPub: existing.ecdhPub, sig: existing.sig }, changed: false } as const;
    }
    // Ids share the wrap-recipient namespace with device ids.
    const [clash] = await tx.select({ id: schema.e2eeDevices.id }).from(schema.e2eeDevices).where(eq(schema.e2eeDevices.id, key.id)).limit(1);
    if (clash) return { ok: false, status: 409, error: 'Notification key id already in use' } as const;
    const now = new Date();
    await tx.update(schema.e2eeNotifyKeys)
      .set({ revokedAt: now })
      .where(and(eq(schema.e2eeNotifyKeys.userId, uid), eq(schema.e2eeNotifyKeys.deviceId, key.deviceId), isNull(schema.e2eeNotifyKeys.revokedAt)));
    await tx.insert(schema.e2eeNotifyKeys).values({ id: key.id, userId: uid, deviceId: key.deviceId, ecdhPub: key.ecdhPub, sig: key.sig, createdAt: now });
    return { ok: true, key, changed: true } as const;
  });
  if (result.ok && result.changed) notifyE2eeKeysChanged(uid);
  return result;
}

/**
 * Revoke notification keys of `userId`: one by id, those of some devices
 * (device removed), or all (encryption reset). Phones linked to them stop
 * getting encrypted previews. Returns how many were revoked.
 */
export async function revokeNotifyKeys(userId: string, which: { id?: string; deviceIds?: string[]; all?: boolean }): Promise<number> {
  const uid = normalizeId(userId);
  if (!which.id && !which.all && !(which.deviceIds && which.deviceIds.length > 0)) return 0;
  const rows = await db.update(schema.e2eeNotifyKeys)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(schema.e2eeNotifyKeys.userId, uid),
      isNull(schema.e2eeNotifyKeys.revokedAt),
      which.id ? eq(schema.e2eeNotifyKeys.id, which.id) : undefined,
      !which.id && !which.all && which.deviceIds ? inArray(schema.e2eeNotifyKeys.deviceId, which.deviceIds) : undefined,
    ))
    .returning({ id: schema.e2eeNotifyKeys.id })
    .catch(() => [] as Array<{ id: string }>);
  if (rows.length > 0) {
    await db.update(schema.pushDevices)
      .set({ e2eeNotifyId: null })
      .where(and(eq(schema.pushDevices.userId, uid), inArray(schema.pushDevices.e2eeNotifyId, rows.map((r) => r.id))))
      .catch(() => {});
  }
  return rows.length;
}

/**
 * Public key bundles for `userIds` (identity, backup, devices incl. recently
 * revoked, active notification keys). Device names and activity times are
 * only included for the viewer's own bundle.
 */
export async function keyBundles(userIds: string[], viewerId?: string) {
  const viewer = viewerId ? normalizeId(viewerId) : null;
  const ids = [...new Set(userIds.map((u) => normalizeId(u)))];
  if (ids.length === 0) return [];
  const [identities, devices, notifyKeys] = await Promise.all([
    db.select().from(schema.e2eeIdentities).where(inArray(schema.e2eeIdentities.userId, ids)),
    devicesOf(ids, { includeRevoked: true }),
    activeNotifyKeysOf(ids),
  ]);
  const byUser = new Map(identities.map((i) => [normalizeId(i.userId), i]));
  return ids.map((userId) => {
    const identity = byUser.get(userId) ?? null;
    const mine = devices.filter((d) => normalizeId(d.userId) === userId);
    const active = mine.filter((d) => !d.revokedAt);
    // Revoked devices: only the most recent few (old-message signature checks).
    const revoked = mine
      .filter((d) => d.revokedAt)
      .sort((a, b) => new Date(b.revokedAt!).getTime() - new Date(a.revokedAt!).getTime())
      .slice(0, 20);
    return {
      userId,
      identityPub: identity?.identityPub ?? null,
      backupPub: identity?.backupPub ?? null,
      backupSig: identity?.backupSig ?? null,
      devices: active.map(userId === viewer ? publicDevice : contactDevice),
      revokedDevices: revoked.map(userId === viewer ? publicDevice : contactDevice),
      notifyKeys: bundleNotifyKeys(
        notifyKeys.filter((k) => normalizeId(k.userId) === userId),
        new Set(active.map((d) => d.id)),
      ),
    };
  });
}

/** Version of a key set (see lib/e2ee/keysVersion): 32 hex chars of SHA-256. */
export function keysVersionOf(bundles: Awaited<ReturnType<typeof keyBundles>>): string {
  return createHash('sha256').update(canonicalKeySet(bundles)).digest('hex').slice(0, 32);
}

/**
 * Encrypted sends name the key-set version they were encrypted for
 * (`e2eeKeys`). A stale one means a member added or removed a device or reset
 * their keys since the sender cached them: refuse (409 e2ee_keys_changed) so
 * the client refetches and re-encrypts. Older clients that don't send a
 * version are let through (transition).
 */
export async function checkE2eeKeysFresh(
  channel: { recipientIds?: string[] | null },
  keysVersion: unknown,
): Promise<{ status: number; error: string; code: string } | null> {
  if (keysVersion === undefined || keysVersion === null) return null;
  if (!isKeysVersion(keysVersion)) return { status: 400, error: 'Invalid key version', code: 'e2ee_keys_invalid' };
  const members = channel.recipientIds ?? [];
  if (members.length === 0) return null;
  const current = await memberKeysVersion(members);
  if (current === keysVersion) return null;
  return {
    status: 409,
    error: 'Encryption keys in this conversation changed. Your app will update them and try again.',
    code: 'e2ee_keys_changed',
  };
}

// ─── Key-set version cache (per-send freshness check) ─────────────────────────
// Every encrypted send compares the version the client encrypted for with the
// members' current key set, which loaded every member's identity, devices and
// notification keys. The version is cached in Redis per member set, tagged with
// each member's key epoch; notifyE2eeKeysChanged bumps the epoch of the user
// whose keys changed (every key mutation calls it), so a changed member is a
// miss on every instance. Without Redis it is computed from the database.

const KEY_EPOCH_PREFIX = 'e2ee:keyepoch:';
const KEYSET_VERSION_PREFIX = 'e2ee:keysetv:';
const KEYSET_VERSION_TTL = 600;

/** Current key-set version of these members (cached; see above). */
export async function memberKeysVersion(memberIds: string[]): Promise<string> {
  const ids = [...new Set(memberIds.map((u) => normalizeId(u)))].sort();
  const redis = getRedis();
  const cacheKey = KEYSET_VERSION_PREFIX + createHash('sha256').update(ids.join(',')).digest('hex').slice(0, 32);
  let epochs: string | null = null;
  if (redis) {
    try {
      const [cached, ...epochValues] = await redis.mget(cacheKey, ...ids.map((id) => KEY_EPOCH_PREFIX + id));
      epochs = epochValues.map((e) => e ?? '0').join(',');
      if (cached) {
        const sep = cached.indexOf('|');
        if (sep > 0 && cached.slice(sep + 1) === epochs) return cached.slice(0, sep);
      }
    } catch {
      epochs = null;
    }
  }
  const version = keysVersionOf(await keyBundles(ids));
  if (redis && epochs !== null) void redis.set(cacheKey, `${version}|${epochs}`, 'EX', KEYSET_VERSION_TTL).catch(() => {});
  return version;
}

/**
 * A user's keys changed (device added / removed, identity published or
 * reset): tell everyone who shares a DM / group DM with them (and their own
 * other sessions) to refresh cached key bundles. Best effort, fire-and-forget.
 * Also invalidates the cached key-set versions that include them.
 */
export function notifyE2eeKeysChanged(userId: string): void {
  const uid = normalizeId(userId);
  void getRedis()?.incr(KEY_EPOCH_PREFIX + uid).catch(() => {});
  void (async () => {
    const rows = await db
      .select({ recipientIds: schema.channels.recipientIds })
      .from(schema.channels)
      .where(and(
        inArray(schema.channels.type, ['dm', 'group_dm']),
        sql`${schema.channels.recipientIds} @> ARRAY[${uid}]::uuid[]`,
      ));
    const userIds = new Set<string>([uid]);
    for (const row of rows) for (const id of row.recipientIds ?? []) userIds.add(normalizeId(id));
    const { fanoutToUsers } = await import('@/lib/api/activity');
    await fanoutToUsers({ userIds: [...userIds] }, { type: 'e2ee_keys', userId: uid });
  })().catch((err) => console.warn('[e2ee] Key change notification failed:', (err as Error)?.message ?? err));
}

/** Whether every one of `userIds` has published an identity and at least one active device. */
export async function usersHaveKeys(userIds: string[]): Promise<boolean> {
  const ids = [...new Set(userIds.map((u) => normalizeId(u)))];
  if (ids.length === 0) return false;
  const [identities, devices] = await Promise.all([
    db.select({ userId: schema.e2eeIdentities.userId }).from(schema.e2eeIdentities).where(inArray(schema.e2eeIdentities.userId, ids)),
    db.selectDistinct({ userId: schema.e2eeDevices.userId })
      .from(schema.e2eeDevices)
      .where(and(inArray(schema.e2eeDevices.userId, ids), isNull(schema.e2eeDevices.revokedAt))),
  ]);
  const withIdentity = new Set(identities.map((r) => normalizeId(r.userId)));
  const withDevice = new Set(devices.map((r) => normalizeId(r.userId)));
  return ids.every((id) => withIdentity.has(id) && withDevice.has(id));
}

type MemberLike = { id: string; isBot?: boolean | null; isSystem?: boolean | null };

/** Bots and system accounts can't take part in an encrypted conversation. */
export function canJoinEncrypted(user: MemberLike): boolean {
  return !user.isBot && !user.isSystem && !isSystemUser(user.id);
}

/**
 * Whether a new DM / group DM with these members should start encrypted: the
 * flag is on, nobody is a bot or system account, and everyone has keys.
 * Never throws (falls back to unencrypted).
 */
export async function shouldStartEncrypted(members: MemberLike[]): Promise<boolean> {
  if (!e2eeEnabled() || members.length < 2) return false;
  if (!members.every(canJoinEncrypted)) return false;
  try {
    return await usersHaveKeys(members.map((m) => m.id));
  } catch {
    return false;
  }
}

/**
 * channels.e2ee for a new DM / group DM: true (encrypted from the start), null
 * (starts plain; clients turn it on once everyone has keys), false (never:
 * bots / system accounts, or the feature flag is off). Legacy rows are false.
 */
export async function initialConversationE2ee(members: MemberLike[]): Promise<boolean | null> {
  if (!e2eeEnabled() || !members.every(canJoinEncrypted)) return false;
  return (await shouldStartEncrypted(members)) ? true : null;
}

/** Client-facing flags of a conversation row. */
export function conversationE2eeFlags(channel: { e2ee?: boolean | null }) {
  return {
    e2ee: channel.e2ee === true,
    // Created while some member had no keys: clients enable it automatically later.
    e2eeAuto: channel.e2ee === null && e2eeEnabled(),
  };
}

/**
 * The member key set sent with the latest page of an encrypted DM / group DM
 * (same shape as GET /api/e2ee/channels/:id/keys), so opening the
 * conversation decrypts without a second round trip for the keys. Null for
 * conversations that aren't encrypted, older pages, or when the lookup fails
 * (the client then asks /keys itself, as before).
 */
export async function pageKeySet(
  channel: { id: string; e2ee?: boolean | null; recipientIds?: string[] | null },
  viewerId: string,
  query: { before?: unknown; after?: unknown; around?: unknown },
) {
  if (channel.e2ee !== true || query.before || query.after || query.around) return null;
  try {
    await ensureE2eeSchema();
    const members = await keyBundles(channel.recipientIds || [], viewerId);
    return { channelId: channel.id, e2ee: true, version: keysVersionOf(members), members };
  } catch {
    return null;
  }
}

// ─── Encrypted sends / edits ──────────────────────────────────────────────────

export { E2EE_NOTICE, ENCRYPTED_PREVIEW, e2eeMismatch, e2eeNoticeKind, e2eeOffNotice, isE2eeChannel, isE2eeNotice, offNoticeRecord, storedEnvelope };

/** parseEncryptedBody against our CDN (attachments must be this user's uploads there). */
export function parseEncryptedBody(userId: string, body: Parameters<typeof parseEncryptedBodyFor>[2]): ParsedEncryptedBody {
  return parseEncryptedBodyFor(userId, config.CDN_URL, body);
}

/**
 * The sender-device lookup of checkE2eeChannelSend, startable before the
 * channel is known (send routes run it alongside their other reads). Never
 * rejects: a failed lookup counts as no device.
 */
export function senderDeviceLookup(userId: string, envelope: Envelope | null | undefined): Promise<DeviceRow | null> {
  return envelope ? findUserDevice(userId, envelope.sd).catch(() => null) : Promise.resolve(null);
}

/**
 * Gate for a send/edit into `channel`: plaintext into an encrypted
 * conversation (or an envelope into a plain one) is refused, and an envelope
 * must come from one of the sender's active devices. `senderDevice` is an
 * already started senderDeviceLookup(userId, envelope) for this envelope.
 */
export async function checkE2eeChannelSend(
  userId: string,
  channel: ChannelLike,
  envelope: Envelope | null | undefined,
  senderDevice?: Promise<DeviceRow | null>,
): Promise<{ status: number; error: string; code?: string } | null> {
  const mismatch = e2eeMismatch(channel, Boolean(envelope));
  if (mismatch) return { ...mismatch, code: isE2eeChannel(channel) ? 'e2ee_required' : 'e2ee_not_encrypted' };
  if (!envelope) return null;
  const device = await (senderDevice ?? senderDeviceLookup(userId, envelope));
  if (!device || device.revokedAt) {
    return { status: 403, error: 'This device is not registered for end-to-end encryption', code: 'e2ee_device_inactive' };
  }
  return null;
}



// ─── Turning encryption off (lib/e2ee/conversationState.ts) ──────────────────

export type ConversationStateRow = typeof schema.e2eeConversationStates.$inferSelect;

/** The stored on / off state of a conversation (null: never turned off). Never throws. */
export async function getConversationState(channelId: string): Promise<ConversationStateRow | null> {
  const [row] = await db
    .select()
    .from(schema.e2eeConversationStates)
    .where(eq(schema.e2eeConversationStates.channelId, normalizeId(channelId)))
    .limit(1)
    .catch(() => [] as ConversationStateRow[]);
  return row ?? null;
}

/**
 * Check a member's signed "turn encryption off" record before acting on it:
 * the shape, that it names this conversation and this user, that it was made
 * just now (signer clock within the skew), and that one of the user's active
 * devices signed it. Clients verify it again against the devices they trust.
 */
export async function checkOffRecordFrom(
  userId: string,
  channel: { id: string; type?: string | null; recipientIds?: string[] | null },
  input: unknown,
): Promise<{ ok: true; record: ConversationStateRecord } | { ok: false; status: number; error: string }> {
  const record = parseConversationState(input);
  if (!record) return { ok: false, status: 400, error: 'Invalid record' };
  if (record.channelId !== normalizeId(channel.id) || record.userId !== normalizeId(userId)) {
    return { ok: false, status: 400, error: 'The record names another conversation or person' };
  }
  // Bound to the kind of conversation (and a 1:1 DM's two people).
  const kind = channel.type === 'dm' ? 'dm' : channel.type === 'group_dm' ? 'group_dm' : null;
  const ids = (channel.recipientIds ?? []).map((id) => normalizeId(id));
  if (record.kind !== kind) return { ok: false, status: 400, error: 'The record names another kind of conversation' };
  if (kind === 'dm') {
    const pair = ids.length === 2 ? dmPair(ids[0], ids[1]) : null;
    if (!pair || !record.members || record.members[0] !== pair[0] || record.members[1] !== pair[1]) {
      return { ok: false, status: 400, error: 'The record names other people' };
    }
  }
  if (Math.abs(Date.now() - record.ts) > CONVERSATION_STATE_MAX_SKEW_MS) {
    return { ok: false, status: 400, error: "Your device's clock is off. Fix the date and time, then try again." };
  }
  const device = await findUserDevice(userId, record.deviceId).catch(() => null);
  if (!device || device.revokedAt) return { ok: false, status: 403, error: 'This device is not registered for end-to-end encryption' };
  if (!(await verifyConversationStateSig(device.signPub, record))) return { ok: false, status: 400, error: 'The record signature does not match this device' };
  return { ok: true, record };
}

// ─── Trust & Safety: franking reports ─────────────────────────────────────────

const REPORT_FETCH_TIMEOUT_MS = 15_000;
const REPORT_MAX_BLOB_BYTES = 50 * 1024 * 1024;

/** Download an encrypted blob from our own CDN (never any other host). */
async function fetchCdnBlob(url: string, allowedUrls: Set<string>): Promise<Uint8Array | null> {
  let parsed: URL;
  let cdn: URL;
  try {
    parsed = new URL(url);
    cdn = new URL(config.CDN_URL);
  } catch {
    return null;
  }
  // Only the blobs stored on this very message, only on our CDN.
  if (!allowedUrls.has(url) || parsed.protocol !== cdn.protocol || parsed.host !== cdn.host || parsed.username || parsed.password) return null;
  const res = await fetch(parsed.toString(), { redirect: 'error', signal: AbortSignal.timeout(REPORT_FETCH_TIMEOUT_MS) }).catch(() => null);
  if (!res || !res.ok || !res.body) return null;
  const declared = Number(res.headers.get('content-length') || '0');
  if (declared > REPORT_MAX_BLOB_BYTES) return null;
  return readCapped(res.body, REPORT_MAX_BLOB_BYTES);
}

/** Read a stream into memory, giving up (null) as soon as it passes `max` bytes. */
async function readCapped(body: ReadableStream<Uint8Array>, max: number): Promise<Uint8Array | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

// ─── Edited messages: earlier envelopes ───────────────────────────────────────

const MAX_ENVELOPE_HISTORY = 20;

/**
 * Keep the envelope an edit replaces, so a report can still name (and prove)
 * the version the reporter saw. At most MAX_ENVELOPE_HISTORY per message: the
 * oldest is dropped beyond that. Best effort (never blocks the edit).
 */
export async function archiveReplacedEnvelope(messageId: string, previous: unknown): Promise<void> {
  const envelope = storedEnvelope(previous);
  if (!envelope) return;
  try {
    await ensureE2eeSchema();
    const id = normalizeId(messageId);
    await db.insert(schema.e2eeEnvelopeHistory)
      .values({ messageId: id, sig: envelope.sig, envelope })
      .onConflictDoNothing();
    const rows = await db
      .select({ sig: schema.e2eeEnvelopeHistory.sig })
      .from(schema.e2eeEnvelopeHistory)
      .where(eq(schema.e2eeEnvelopeHistory.messageId, id))
      .orderBy(desc(schema.e2eeEnvelopeHistory.replacedAt));
    for (const old of rows.slice(MAX_ENVELOPE_HISTORY)) {
      await db.delete(schema.e2eeEnvelopeHistory)
        .where(and(eq(schema.e2eeEnvelopeHistory.messageId, id), eq(schema.e2eeEnvelopeHistory.sig, old.sig)));
    }
  } catch (err) {
    console.warn(`[e2ee] Could not keep the previous envelope of ${messageId}:`, (err as Error)?.message ?? err);
  }
}

/** The envelope of `message` with signature `sig`: the current one, or an earlier version. */
async function envelopeBySig(message: { id: string; e2ee?: unknown }, sig: string | undefined): Promise<Envelope | null> {
  const current = storedEnvelope(message.e2ee);
  if (!sig || current?.sig === sig) return current;
  await ensureE2eeSchema();
  const [row] = await db
    .select({ envelope: schema.e2eeEnvelopeHistory.envelope })
    .from(schema.e2eeEnvelopeHistory)
    .where(and(eq(schema.e2eeEnvelopeHistory.messageId, normalizeId(message.id)), eq(schema.e2eeEnvelopeHistory.sig, sig)))
    .orderBy(asc(schema.e2eeEnvelopeHistory.replacedAt))
    .limit(1)
    .catch(() => []);
  const old = storedEnvelope(row?.envelope);
  return old && old.sig === sig ? old : null;
}

// ─── Report scans: once per message + file ────────────────────────────────────

type ReportScanVerdict = { blocked: boolean; kind?: string; incidentId?: string | null; reused?: boolean };

const REPORT_SCAN_TTL_S = 30 * 86_400;
const reportScansInFlight = new Map<string, Promise<ReportScanVerdict>>();

/**
 * Scan a disclosed image of a reported message once: later reports of the
 * same message + file reuse the verdict (Redis), and a file that already
 * produced an incident for this sender reuses that incident (database), so
 * repeated reports never create duplicate incidents or strikes.
 */
async function scanReportedImage(
  message: { id: string; channelId: string; authorId: string },
  file: { name: string },
  plain: Uint8Array,
  imageType: string,
): Promise<ReportScanVerdict> {
  const sha256 = createHash('sha256').update(plain).digest('hex');
  const key = `e2ee:report-scan:${normalizeId(message.id)}:${sha256}`;
  const inFlight = reportScansInFlight.get(key);
  if (inFlight) return { ...(await inFlight), reused: true };
  const run = (async (): Promise<ReportScanVerdict> => {
    const cached = await cache.get<ReportScanVerdict>(key);
    if (cached) return { ...cached, reused: true };
    const [prior] = await db
      .select({ id: schema.safetyIncidents.id, kind: schema.safetyIncidents.kind })
      .from(schema.safetyIncidents)
      .where(and(
        eq(schema.safetyIncidents.userId, normalizeId(message.authorId)),
        eq(schema.safetyIncidents.sha256, sha256),
        eq(schema.safetyIncidents.uploadCategory, 'e2ee-report'),
      ))
      .orderBy(asc(schema.safetyIncidents.createdAt))
      .limit(1)
      .catch(() => []);
    if (prior) {
      const verdict = { blocked: true, kind: prior.kind === 'csam' ? 'csam' : prior.kind === 'scam_image' ? 'scam' : prior.kind, incidentId: prior.id };
      await cache.set(key, verdict, REPORT_SCAN_TTL_S);
      return { ...verdict, reused: true };
    }
    // Another instance is scanning this exact file right now.
    const redis = getRedis();
    const lockKey = `${key}:lock`;
    const lock = redis ? await redis.set(lockKey, '1', 'EX', 120, 'NX').catch(() => 'OK') : 'OK';
    if (lock !== 'OK') return { blocked: false, kind: 'in-progress', reused: true };
    try {
      const { scanUploadedImage } = await import('@/lib/services/trustSafety');
      const result = await scanUploadedImage(Buffer.from(plain), imageType, {
        userId: message.authorId,
        fileName: file.name,
        category: 'e2ee-report',
        channelId: message.channelId,
      });
      const verdict: ReportScanVerdict = result.blocked
        ? { blocked: true, kind: result.kind, incidentId: result.incidentId ?? null }
        : { blocked: false };
      await cache.set(key, verdict, REPORT_SCAN_TTL_S);
      return verdict;
    } finally {
      if (redis) await redis.del(lockKey).catch(() => 0);
    }
  })();
  reportScansInFlight.set(key, run);
  try {
    return await run;
  } finally {
    reportScansInFlight.delete(key);
  }
}

export type FrankedReport =
  | { ok: true; payload: MessagePayload; attachmentNotes: string[] }
  | { ok: false; status: number; error: string };

/**
 * Verify a reporter's franking disclosure for an encrypted message (commitment,
 * decryption to exactly the disclosed plaintext, sender device signature), then
 * fetch, decrypt and scan its disclosed images with the normal upload scanners,
 * attributed to the SENDER (PhotoDNA / scam hashes, with their consequences).
 */
export async function frankEncryptedReport(
  message: { id: string; channelId: string; authorId: string; e2ee?: unknown; attachments?: unknown },
  disclosure: unknown,
): Promise<FrankedReport> {
  if (!storedEnvelope(message.e2ee)) return { ok: false, status: 400, error: 'This message is not end-to-end encrypted' };
  if (!isFrankingDisclosure(disclosure)) {
    return { ok: false, status: 400, error: 'Reporting an encrypted message needs the message key. Update the app and try again.' };
  }
  // The version the reporter saw (an edit keeps the earlier envelopes).
  const claimedSig = (disclosure as { sig?: unknown }).sig;
  const sig = typeof claimedSig === 'string' ? claimedSig : undefined;
  const envelope = await envelopeBySig(message, sig);
  if (!envelope) return { ok: false, status: 400, error: "This report couldn't be verified" };
  const device = await findUserDevice(message.authorId, envelope.sd);
  if (!device) return { ok: false, status: 400, error: "This report couldn't be verified" };
  const result = await verifyFranking(
    envelope,
    { channelId: message.channelId, senderUserId: message.authorId, senderDeviceId: envelope.sd },
    device.signPub,
    disclosure,
  );
  if (!result.ok) {
    console.warn(`[e2ee] Franking check failed for message ${message.id}: ${result.reason}`);
    return { ok: false, status: 400, error: "This report couldn't be verified" };
  }

  const stored = Array.isArray(message.attachments) ? (message.attachments as Array<{ url?: unknown }>) : [];
  const allowedUrls = new Set(stored.map((a) => (typeof a?.url === 'string' ? a.url : '')).filter(Boolean));
  const notes: string[] = [];
  const { sniffImageType } = await import('@/lib/safety/imageHash');
  for (const att of result.payload.attachments ?? []) {
    const label = `${att.name} (${att.type || 'unknown type'}, ${att.size} bytes)`;
    try {
      const blob = await fetchCdnBlob(att.url, allowedUrls);
      if (!blob) {
        notes.push(`${label}: could not be fetched`);
        continue;
      }
      const plain = await decryptAttachment(blob, att);
      const declared = att.type.toLowerCase().split(';')[0].trim();
      const imageType = declared.startsWith('image/') && declared !== 'image/svg+xml' ? declared : sniffImageType(plain);
      if (!imageType) {
        notes.push(`${label}: decrypted, not an image (not scanned)`);
        continue;
      }
      const verdict = await scanReportedImage(message, att, plain, imageType);
      const again = verdict.reused ? ', already scanned for an earlier report' : '';
      notes.push(verdict.kind === 'in-progress'
        ? `${label}: being scanned for another report right now`
        : verdict.blocked
          ? `${label}: MATCHED ${verdict.kind}${verdict.incidentId ? ` (incident ${verdict.incidentId})` : ''}${again}`
          : `${label}: scanned, no match${again}`);
    } catch (err) {
      notes.push(`${label}: ${err instanceof E2eeVerifyError ? 'failed to decrypt with the disclosed key' : 'scan failed'}`);
    }
  }
  return { ok: true, payload: result.payload, attachmentNotes: notes };
}
