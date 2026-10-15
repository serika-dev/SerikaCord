// End-to-end encryption routes, mounted at /api/e2ee (docs/architecture/e2ee.md).
// The server only stores and hands out public keys and the passphrase-sealed
// key backup; it never sees private keys or message plaintext.
//
//   GET    /e2ee/status                        { enabled, identity } (?device=<id> touches last-seen)
//   PUT    /e2ee/identity                      { identityPub, backupPub, reset?, password? } publish own keys
//                                              (a reset needs the account password: step-up check)
//   GET    /e2ee/devices                       own devices (active + recently revoked)
//   POST   /e2ee/devices                       { id, ecdhPub, signPub, sig, name? } register (sig checked)
//   DELETE /e2ee/devices/:deviceId             revoke own device
//   GET    /e2ee/backup                        own sealed backup
//   PUT    /e2ee/backup                        { blob, salt, iters } (size-limited)
//   GET    /e2ee/users/:userId/keys            one user's public key bundle (calls; friends, shared
//                                              conversations or servers only)
//   GET    /e2ee/channels/:channelId/keys      bundles of a DM / group DM's members (members only)
//   POST   /e2ee/channels/:channelId/enable    turn encryption on (member; all members have keys; one-way)
//   GET    /e2ee/blob?url=                     same-origin relay of an encrypted attachment blob
//                                              from our CDN (for browsers where the CDN lacks CORS)
//   POST   /e2ee/link                          { commit } new device opens a link session (5 min)
//   GET    /e2ee/link/:code                    session state (both devices poll it)
//   POST   /e2ee/link/:code/join               { pub, commit } existing device's ephemeral key
//   POST   /e2ee/link/:code/reveal             { pub } new device opens its commitment
//   POST   /e2ee/link/:code/payload            { iv, ct } existing device's sealed key material
//   POST   /e2ee/link/:code/done               new device stored the keys (the sealed copy is dropped)
//   DELETE /e2ee/link/:code                    cancel
//   POST   /e2ee/notify-keys                   { id, deviceId, ecdhPub, sig, pushToken? } register this
//                                              phone's notification key (signed by the device; Android
//                                              push previews) and link it to its push token
//   DELETE /e2ee/notify-keys/:notifyId         revoke own notification key (sign-out)
//   GET    /e2ee/pin                           own PIN backup parameters (salt, iterations, attempts left)
//   POST   /e2ee/pin/begin                     fresh server secret S for a new / changed PIN (10 min)
//   POST   /e2ee/pin/commit                    { identityPub, salt, iterations, verifier, bundle, secretCheck, sig }
//                                              store the PIN backup (identity-key signed)
//   POST   /e2ee/pin/unlock                    { verifier } → S + bundle on the right PIN; 10 wrong in total
//                                              destroy the PIN backup
//   POST   /e2ee/pin/remove                    { identityPub, ts, sig } drop the PIN backup (identity-key signed)
//   POST   /e2ee/backup/remove                 { identityPub, ts, sig } drop the passphrase backup (identity-key signed)
//   POST   /e2ee/reauth                        { password } account password step-up (forgotten passphrase → PIN)
//   POST   /e2ee/channels/:channelId/disable   { record } turn encryption off (member device-signed record)
//   GET    /e2ee/channels/:channelId/state     { e2ee, state, record } the signed "turned off" record
//
// Writes that create keys or encrypted conversations are refused while the
// E2EE_ENABLED flag is off; reads and device revocation always work.
import { Elysia, t } from 'elysia';
import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { normalizeId } from '@/lib/db/normalizeId';
import { authenticateRequest } from '@/lib/services/auth';
import { checkRateLimit, getClientIP, isValidObjectId, rejectInvalidObjectIdParams } from '@/lib/security';
import { accountsLogin, accountsLogout } from '@/lib/services/accountsClient';
import { Channel, Message, User } from '@/lib/models';
import {
  E2EE_DISABLED_ERROR,
  E2EE_NOTICE,
  checkOffRecordFrom,
  e2eeOffNotice,
  getConversationState,
  canJoinEncrypted,
  canLookUpKeys,
  devicesOf,
  e2eeEnabled,
  ensureE2eeSchema,
  getIdentity,
  keyBundles,
  keysVersionOf,
  notifyE2eeKeysChanged,
  publicDevice,
  registerNotifyKey,
  revokeNotifyKeys,
  usersHaveKeys,
} from '@/lib/services/e2ee';
import {
  E2eeFormatError,
  LIMITS,
  LINK_TTL_SECONDS,
  isDeviceId,
  isLinkCommitment,
  isLinkPublicKey,
  isPublicKeyB64,
  isPublicNotifyKey,
  linkCommitment,
  newLinkCode,
  normalizeLinkCode,
  validateBackupRecord,
  validateLinkPayload,
  verifyBackupKey,
  verifyDevice,
} from '@/lib/e2ee';
import { config } from '@/lib/config';
import { getRedis } from '@/lib/db/redis';
import { PIN_PBKDF2_ITERATIONS, verifyRecoveryRemoval } from '@/lib/e2ee/pin';
import { beginPin, clearPinBackup, commitPin, getPinRow, pinParams, pinSummary, unlockPin } from '@/lib/services/e2eePin';

type Cookie = Record<string, { value?: unknown }>;

async function getAuth(headers: Record<string, string | undefined>, cookie: Cookie) {
  const authHeader = headers.authorization ?? null;
  const authToken = cookie.auth_token?.value;
  const cookies: Record<string, string> = {};
  if (typeof authToken === 'string') cookies.auth_token = authToken;
  return authenticateRequest(authHeader, cookies);
}

type Setter = { status?: number | string };

async function limited(kind: 'e2eeRead' | 'e2eeWrite' | 'e2eeEnable' | 'e2eeLink' | 'e2eePin', userId: string, set: Setter) {
  const rl = await checkRateLimit(kind, userId);
  if (rl.success) return null;
  set.status = 429;
  return { error: 'Too many requests', retryAfter: rl.retryAfter };
}

function disabled(set: Setter) {
  set.status = 503;
  return { error: E2EE_DISABLED_ERROR, enabled: false };
}

/** Device display names: printable, trimmed, short. */
function cleanDeviceName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const cleaned = name.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, LIMITS.maxDeviceName);
  return cleaned || null;
}

type AuthUser = NonNullable<Awaited<ReturnType<typeof getAuth>>['user']>;

/**
 * Step-up check before "Reset encryption" (it revokes every device and drops
 * the backup): the account password, verified by the accounts service. The
 * throwaway session that check creates is revoked right away.
 */
async function verifyAccountPassword(user: AuthUser, password: unknown, request: Request): Promise<{ status: number; error: string } | null> {
  if (typeof password !== 'string' || password.length === 0) {
    return { status: 403, error: 'Enter your account password to reset encryption' };
  }
  const ip = getClientIP(request);
  const rl = await checkRateLimit('login', `e2ee-reset:${normalizeId(user.id)}`);
  if (!rl.success) return { status: 429, error: 'Too many attempts. Please wait a moment and try again.' };
  const email = (user as { email?: string | null }).email || `${user.username}@serika.dev`;
  const result = await accountsLogin({ email, password }, { userAgent: 'SerikaCord (encryption reset check)', ip });
  if (result.ok && result.data.token) {
    void accountsLogout(result.data.token).catch(() => {});
    return null;
  }
  // The accounts service answers these only after the password matched (it
  // then wants a second factor / passkey for a full sign-in): the password
  // step-up itself passed.
  const code = (result.data as { code?: unknown } | null)?.code;
  if (result.status === 403 && (code === 'TWO_FACTOR_REQUIRED' || code === 'PASSKEY_REQUIRED')) return null;
  if (result.status === 503) return { status: 503, error: 'The accounts service is unavailable. Try again in a moment.' };
  if (result.status === 429) return { status: 429, error: 'Too many attempts. Please wait a moment and try again.' };
  return { status: 403, error: 'Incorrect password' };
}

function identitySummary(row: Awaited<ReturnType<typeof getIdentity>>) {
  return row
    ? { identityPub: row.identityPub, backupPub: row.backupPub, hasBackup: Boolean(row.backupBlob), updatedAt: row.updatedAt }
    : null;
}

/** Of these users, the ones whose identity has no passphrase backup yet. */
async function membersWithoutRecovery(userIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(userIds.map((u) => normalizeId(u)))];
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ userId: schema.e2eeIdentities.userId, blob: schema.e2eeIdentities.backupBlob })
    .from(schema.e2eeIdentities)
    .where(inArray(schema.e2eeIdentities.userId, ids))
    .catch(() => [] as Array<{ userId: string; blob: string | null }>);
  const withBackup = new Set(rows.filter((r) => r.blob).map((r) => normalizeId(r.userId)));
  return new Set(ids.filter((id) => !withBackup.has(id)));
}

// ─── Device linking relay (lib/e2ee/link.ts) ──────────────────────────────────
// One Redis hash per session, bound to the account that opened it and gone
// after LINK_TTL_SECONDS. Each step is HSETNX, so it happens once: a second
// device can't join, and nothing can be swapped after the fact. The server
// only ever sees public keys, a commitment and AES-GCM ciphertext; the 6-digit
// code both devices show is what stops it from sitting in the middle.

type LinkRecord = { user?: string; commit?: string; created?: string; name?: string; oldPub?: string; newPub?: string; payload?: string; done?: string };

const linkKey = (code: string) => `e2ee:link:${code}`;

function linkStatus(r: LinkRecord): 'waiting' | 'joined' | 'revealed' | 'sent' | 'done' {
  return r.done ? 'done' : r.payload ? 'sent' : r.newPub ? 'revealed' : r.oldPub ? 'joined' : 'waiting';
}

/** The caller's own live session `code`, or an error reply. */
async function loadLinkSession(userId: string, rawCode: string, set: Setter): Promise<{ code: string; record: LinkRecord } | { error: string }> {
  const redis = getRedis();
  if (!redis) {
    set.status = 503;
    return { error: 'Linking devices is unavailable right now. Use your recovery passphrase instead.' };
  }
  const code = normalizeLinkCode(rawCode);
  if (!code) {
    set.status = 404;
    return { error: 'That code is not valid or has expired' };
  }
  const record = (await redis.hgetall(linkKey(code)).catch(() => ({}))) as LinkRecord;
  // Someone else's session looks exactly like a missing one.
  if (!record.user || record.user !== normalizeId(userId)) {
    set.status = 404;
    return { error: 'That code is not valid or has expired' };
  }
  return { code, record };
}

/** Wake the account's other sessions (link dialogs refetch instead of waiting for the next poll). */
function pingLink(userId: string, code: string, status: string) {
  void import('@/lib/api/activity')
    .then((m) => m.fanoutToUsers({ userIds: [normalizeId(userId)] }, { type: 'e2ee_link', code, status }))
    .catch(() => {});
}

/** HSETNX one step; false when it already happened (or the session expired meanwhile). */
async function setLinkStep(code: string, field: keyof LinkRecord, value: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  const key = linkKey(code);
  const [[, exists], [, stored]] = (await redis.multi().exists(key).hsetnx(key, field, value).exec()) as [[unknown, number], [unknown, number]];
  if (!exists) {
    // HSETNX on an expired key just created a lone field: drop it again.
    await redis.del(key).catch(() => 0);
    return false;
  }
  return stored === 1;
}

export const e2eeRoutes = new Elysia({ prefix: '/e2ee' })
  .onBeforeHandle(rejectInvalidObjectIdParams)
  .get('/status', async ({ headers, cookie, query, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
    await ensureE2eeSchema();
    const identity = await getIdentity(user.id).catch(() => null);
    const deviceId = typeof query.device === 'string' && isDeviceId(query.device) ? query.device : null;
    let device: { id: string; active: boolean } | null = null;
    if (deviceId) {
      const [row] = await db
        .select({ id: schema.e2eeDevices.id, revokedAt: schema.e2eeDevices.revokedAt })
        .from(schema.e2eeDevices)
        .where(and(eq(schema.e2eeDevices.id, deviceId), eq(schema.e2eeDevices.userId, normalizeId(user.id))))
        .limit(1)
        .catch(() => []);
      device = row ? { id: row.id, active: !row.revokedAt } : null;
      if (row && !row.revokedAt) {
        void db.update(schema.e2eeDevices)
          .set({ lastSeenAt: new Date() })
          .where(eq(schema.e2eeDevices.id, deviceId))
          .catch(() => {});
      }
    }
    const pinRow = identity ? await getPinRow(user.id) : null;
    return { enabled: e2eeEnabled(), identity: identitySummary(identity), device, pin: pinSummary(pinRow, identity?.identityPub) };
  }, { query: t.Object({ device: t.Optional(t.String({ maxLength: 64 })) }) })

  .put('/identity', async ({ headers, cookie, body, set, request }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
    if (!e2eeEnabled()) return disabled(set);
    const rl = await limited('e2eeWrite', user.id, set);
    if (rl) return rl;
    if (!isPublicKeyB64(body.identityPub) || !isPublicKeyB64(body.backupPub)) {
      set.status = 400;
      return { error: 'Invalid public key' };
    }
    const userId = normalizeId(user.id);
    // The identity key must vouch for the backup key (clients refuse to wrap
    // message keys to an unsigned one).
    if (!(await verifyBackupKey(body.identityPub, userId, body.backupPub, body.backupSig))) {
      set.status = 400;
      return { error: 'The backup key signature does not match the identity key' };
    }
    await ensureE2eeSchema();
    const existing = await getIdentity(userId);
    if (existing && existing.identityPub === body.identityPub && existing.backupPub === body.backupPub) {
      return { identity: identitySummary(existing), reset: false };
    }
    if (existing && body.reset !== true) {
      set.status = 409;
      return { error: 'You already have encryption keys. Restore them with your recovery passphrase, or reset encryption.' };
    }
    if (existing) {
      // Replacing keys revokes every device and drops the backup: re-authenticate.
      const denied = await verifyAccountPassword(user, body.password, request);
      if (denied) {
        set.status = denied.status;
        return { error: denied.error };
      }
    }
    const now = new Date();
    const row = await db.transaction(async (tx) => {
      // Serialize concurrent publishes / resets of one account.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`e2ee:${userId}`}))`);
      const [saved] = await tx.insert(schema.e2eeIdentities)
        .values({ userId, identityPub: body.identityPub, backupPub: body.backupPub, backupSig: body.backupSig, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: schema.e2eeIdentities.userId,
          // A reset makes the old backup useless: drop it with the old keys.
          set: { identityPub: body.identityPub, backupPub: body.backupPub, backupSig: body.backupSig, backupBlob: null, backupSalt: null, backupIters: null, updatedAt: now },
        })
        .returning();
      if (existing) {
        // Devices vouched for by the old identity key can't be trusted any more.
        // Kept (revoked) so signatures on old messages still verify.
        await tx.update(schema.e2eeDevices)
          .set({ revokedAt: now })
          .where(and(eq(schema.e2eeDevices.userId, userId), isNull(schema.e2eeDevices.revokedAt)));
      }
      return saved;
    });
    // Their notification keys go with the devices (bundles only list keys of
    // active devices anyway; this also unlinks the phones' push tokens).
    if (existing) await revokeNotifyKeys(userId, { all: true });
    // A PIN backup holds the old keys: useless now (and bound to the old identity anyway).
    if (existing) await clearPinBackup(userId);
    notifyE2eeKeysChanged(userId);
    return { identity: identitySummary(row), reset: Boolean(existing) };
  }, {
    body: t.Object({
      identityPub: t.String({ maxLength: 120 }),
      backupPub: t.String({ maxLength: 120 }),
      backupSig: t.String({ maxLength: 120 }),
      reset: t.Optional(t.Boolean()),
      password: t.Optional(t.String({ maxLength: 256 })),
    }),
  })

  .get('/devices', async ({ headers, cookie, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
    await ensureE2eeSchema();
    const rows = await devicesOf([user.id], { includeRevoked: true });
    const active = rows.filter((d) => !d.revokedAt).map(publicDevice);
    const revoked = rows
      .filter((d) => d.revokedAt)
      .sort((a, b) => new Date(b.revokedAt!).getTime() - new Date(a.revokedAt!).getTime())
      .slice(0, 20)
      .map(publicDevice);
    return { devices: active, revokedDevices: revoked };
  })

  .post('/devices', async ({ headers, cookie, body, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
    if (!e2eeEnabled()) return disabled(set);
    const rl = await limited('e2eeWrite', user.id, set);
    if (rl) return rl;
    const device = { id: body.id, ecdhPub: body.ecdhPub, signPub: body.signPub, sig: body.sig };
    if (!isDeviceId(device.id) || !isPublicKeyB64(device.ecdhPub) || !isPublicKeyB64(device.signPub)) {
      set.status = 400;
      return { error: 'Invalid device keys' };
    }
    await ensureE2eeSchema();
    const userId = normalizeId(user.id);
    const identity = await getIdentity(userId);
    if (!identity) {
      set.status = 409;
      return { error: 'Publish your identity key first' };
    }
    // The identity key must vouch for the device: the server can't add devices.
    if (!(await verifyDevice(identity.identityPub, userId, device))) {
      set.status = 400;
      return { error: 'The device signature does not match your identity key' };
    }
    const name = cleanDeviceName(body.name);
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`e2ee:${userId}`}))`);
      const [existing] = await tx.select().from(schema.e2eeDevices).where(eq(schema.e2eeDevices.id, device.id)).limit(1);
      if (existing) {
        const same = normalizeId(existing.userId) === userId
          && existing.ecdhPub === device.ecdhPub
          && existing.signPub === device.signPub;
        if (!same) return { status: 409, error: 'Device id already in use' } as const;
        if (existing.revokedAt) return { status: 409, error: 'This device was removed. Set it up again.' } as const;
        const [touched] = await tx.update(schema.e2eeDevices)
          .set({ lastSeenAt: new Date(), deviceSig: device.sig, identityPub: identity.identityPub, ...(name ? { name } : {}) })
          .where(eq(schema.e2eeDevices.id, device.id))
          .returning();
        return { device: touched, changed: existing.deviceSig !== device.sig } as const;
      }
      // Device and notification-key ids share the wrap-recipient namespace: a
      // device can't take a notification key's id (and crowd it out of envelopes).
      const [clash] = await tx.select({ id: schema.e2eeNotifyKeys.id }).from(schema.e2eeNotifyKeys).where(eq(schema.e2eeNotifyKeys.id, device.id)).limit(1);
      if (clash) return { status: 409, error: 'Device id already in use' } as const;
      const [{ value: activeCount }] = await tx
        .select({ value: count() })
        .from(schema.e2eeDevices)
        .where(and(eq(schema.e2eeDevices.userId, userId), isNull(schema.e2eeDevices.revokedAt)));
      if (Number(activeCount) >= LIMITS.maxDevicesPerUser) {
        return { status: 409, error: `You can have up to ${LIMITS.maxDevicesPerUser} encrypted devices. Remove one in Settings first.` } as const;
      }
      const [created] = await tx.insert(schema.e2eeDevices).values({
        id: device.id,
        userId,
        ecdhPub: device.ecdhPub,
        signPub: device.signPub,
        deviceSig: device.sig,
        identityPub: identity.identityPub,
        name,
      }).returning();
      return { device: created, changed: true } as const;
    });
    if ('error' in result) {
      set.status = result.status;
      return { error: result.error };
    }
    if (result.changed) notifyE2eeKeysChanged(userId);
    return { device: publicDevice(result.device) };
  }, {
    body: t.Object({
      id: t.String({ maxLength: 32 }),
      ecdhPub: t.String({ maxLength: 120 }),
      signPub: t.String({ maxLength: 120 }),
      sig: t.String({ maxLength: 120 }),
      name: t.Optional(t.String({ maxLength: 200 })),
    }),
  })

  .delete('/devices/:deviceId', async ({ headers, cookie, params, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
    const rl = await limited('e2eeWrite', user.id, set);
    if (rl) return rl;
    if (!isDeviceId(params.deviceId)) {
      set.status = 400;
      return { error: 'Invalid device id' };
    }
    await ensureE2eeSchema();
    // Soft revoke: the row stays so its signatures on old messages verify.
    const [row] = await db.update(schema.e2eeDevices)
      .set({ revokedAt: new Date() })
      .where(and(
        eq(schema.e2eeDevices.id, params.deviceId),
        eq(schema.e2eeDevices.userId, normalizeId(user.id)),
        isNull(schema.e2eeDevices.revokedAt),
      ))
      .returning({ id: schema.e2eeDevices.id });
    if (!row) {
      set.status = 404;
      return { error: 'Device not found' };
    }
    await revokeNotifyKeys(user.id, { deviceIds: [row.id] });
    notifyE2eeKeysChanged(user.id);
    return { success: true };
  }, { params: t.Object({ deviceId: t.String({ maxLength: 32 }) }) })

  // ─── Notification keys (Android push previews, lib/e2ee/notifyKeys.ts) ──────
  .post('/notify-keys', async ({ headers, cookie, body, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
    if (!e2eeEnabled()) return disabled(set);
    const rl = await limited('e2eeWrite', user.id, set);
    if (rl) return rl;
    const key = { id: body.id, deviceId: body.deviceId, ecdhPub: body.ecdhPub, sig: body.sig };
    if (!isPublicNotifyKey(key)) {
      set.status = 400;
      return { error: 'Invalid notification key' };
    }
    await ensureE2eeSchema();
    const result = await registerNotifyKey(user.id, key);
    if (!result.ok) {
      set.status = result.status;
      return { error: result.error };
    }
    // Pushes to this phone's token carry this key's wrap entry from now on.
    let linked = false;
    if (typeof body.pushToken === 'string' && body.pushToken) {
      const { isPlausibleDeviceToken } = await import('@/lib/push/fcm');
      if (isPlausibleDeviceToken(body.pushToken)) {
        const { linkPushNotifyKey } = await import('@/lib/services/pushNotifications');
        linked = await linkPushNotifyKey(user.id, body.pushToken, result.key.id).catch(() => false);
      }
    }
    return { key: result.key, changed: result.changed, linked };
  }, {
    body: t.Object({
      id: t.String({ maxLength: 32 }),
      deviceId: t.String({ maxLength: 32 }),
      ecdhPub: t.String({ maxLength: 120 }),
      sig: t.String({ maxLength: 120 }),
      pushToken: t.Optional(t.String({ maxLength: 4096 })),
    }),
  })

  .delete('/notify-keys/:notifyId', async ({ headers, cookie, params, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
    const rl = await limited('e2eeWrite', user.id, set);
    if (rl) return rl;
    if (!isDeviceId(params.notifyId)) {
      set.status = 400;
      return { error: 'Invalid notification key id' };
    }
    await ensureE2eeSchema();
    const revoked = await revokeNotifyKeys(user.id, { id: params.notifyId });
    if (revoked > 0) notifyE2eeKeysChanged(user.id);
    return { success: true, revoked: revoked > 0 };
  }, { params: t.Object({ notifyId: t.String({ maxLength: 32 }) }) })

  .get('/backup', async ({ headers, cookie, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
    const rl = await limited('e2eeRead', user.id, set);
    if (rl) return rl;
    await ensureE2eeSchema();
    const identity = await getIdentity(user.id);
    if (!identity?.backupBlob || !identity.backupSalt || !identity.backupIters) {
      set.status = 404;
      return { error: 'No key backup' };
    }
    return {
      backup: { blob: identity.backupBlob, salt: identity.backupSalt, iters: identity.backupIters },
      identityPub: identity.identityPub,
      backupPub: identity.backupPub,
    };
  })

  .put('/backup', async ({ headers, cookie, body, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
    if (!e2eeEnabled()) return disabled(set);
    const rl = await limited('e2eeWrite', user.id, set);
    if (rl) return rl;
    let record;
    try {
      record = validateBackupRecord(body);
    } catch (err) {
      set.status = 400;
      return { error: err instanceof E2eeFormatError ? err.message : 'Invalid backup' };
    }
    await ensureE2eeSchema();
    // Bound to the identity the client sealed: a stale tab can't overwrite the
    // backup after a reset on another device.
    const [row] = await db.update(schema.e2eeIdentities)
      .set({ backupBlob: record.blob, backupSalt: record.salt, backupIters: record.iters, updatedAt: new Date() })
      .where(and(
        eq(schema.e2eeIdentities.userId, normalizeId(user.id)),
        eq(schema.e2eeIdentities.identityPub, body.identityPub),
      ))
      .returning({ userId: schema.e2eeIdentities.userId });
    if (!row) {
      set.status = 409;
      return { error: 'Your encryption keys changed. Reload and try again.' };
    }
    return { success: true };
  }, {
    body: t.Object({
      blob: t.String({ maxLength: LIMITS.maxBackupBlobB64 }),
      salt: t.String({ maxLength: 64 }),
      iters: t.Number(),
      identityPub: t.String({ maxLength: 120 }),
    }),
  })

  // Remove the passphrase backup (keeping the PIN, or none): identity-key signed.
  .post('/backup/remove', async ({ headers, cookie, body, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
    const rl = await limited('e2eeWrite', user.id, set);
    if (rl) return rl;
    await ensureE2eeSchema();
    const userId = normalizeId(user.id);
    const identity = await getIdentity(userId);
    if (!identity || identity.identityPub !== body.identityPub) {
      set.status = 409;
      return { error: 'Your encryption keys changed. Reload and try again.' };
    }
    if (!(await verifyRecoveryRemoval(identity.identityPub, userId, 'passphrase', body.ts, body.sig))) {
      set.status = 403;
      return { error: 'This request was not signed by your encryption keys' };
    }
    await db.update(schema.e2eeIdentities)
      .set({ backupBlob: null, backupSalt: null, backupIters: null, updatedAt: new Date() })
      .where(and(eq(schema.e2eeIdentities.userId, userId), eq(schema.e2eeIdentities.identityPub, body.identityPub)));
    return { success: true };
  }, { body: t.Object({ identityPub: t.String({ maxLength: 120 }), ts: t.Number(), sig: t.String({ maxLength: 120 }) }) })

  // Account password check (the same step-up as "Reset encryption"): stands in
  // for a forgotten recovery passphrase when upgrading to a PIN on a device
  // that still holds the keys. Nothing changes on the server.
  .post('/reauth', async ({ headers, cookie, body, set, request }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
    const rl = await limited('e2eeWrite', user.id, set);
    if (rl) return rl;
    const denied = await verifyAccountPassword(user, body.password, request);
    if (denied) {
      set.status = denied.status;
      return { error: denied.error };
    }
    return { success: true };
  }, { body: t.Object({ password: t.String({ maxLength: 256 }) }) })

  // ── 6-digit PIN backup (lib/e2ee/pin.ts, services/e2eePin.ts) ──────────────
  .get('/pin', async ({ headers, cookie, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
    const rl = await limited('e2eeRead', user.id, set);
    if (rl) return rl;
    const result = await pinParams(user.id);
    if (!result.ok) {
      set.status = result.status;
      return { error: result.error, code: result.code };
    }
    return { salt: result.salt, iterations: result.iterations, attemptsLeft: result.attemptsLeft, identityPub: result.identityPub };
  })

  .post('/pin/begin', async ({ headers, cookie, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
    const rl = await limited('e2eeWrite', user.id, set);
    if (rl) return rl;
    const result = await beginPin(user.id);
    if (!result.ok) {
      set.status = result.status;
      return { error: result.error, code: result.code };
    }
    // The client seals its bundle with this; it's useless without the PIN.
    set.headers['Cache-Control'] = 'no-store';
    return { secret: result.secret, expiresAt: result.expiresAt, iterations: PIN_PBKDF2_ITERATIONS };
  })

  .post('/pin/commit', async ({ headers, cookie, body, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
    const rl = await limited('e2eeWrite', user.id, set);
    if (rl) return rl;
    const result = await commitPin(user.id, body);
    if (!result.ok) {
      set.status = result.status;
      return { error: result.error, code: result.code };
    }
    return { success: true, attemptsLeft: result.attemptsLeft };
  }, {
    body: t.Object({
      identityPub: t.String({ maxLength: 120 }),
      salt: t.String({ maxLength: 64 }),
      iterations: t.Number(),
      verifier: t.String({ maxLength: 64 }),
      bundle: t.String({ maxLength: LIMITS.maxBackupBlobB64 }),
      secretCheck: t.String({ maxLength: 64 }),
      sig: t.String({ maxLength: 120 }),
    }),
  })

  .post('/pin/unlock', async ({ headers, cookie, body, set, request }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
    // Per user and per IP, on top of the 10-attempt limit of the backup itself.
    const rl = await limited('e2eePin', user.id, set);
    if (rl) return rl;
    const ipLimit = await checkRateLimit('e2eePin', `ip:${getClientIP(request)}`);
    if (!ipLimit.success) {
      set.status = 429;
      return { error: 'Too many requests', retryAfter: ipLimit.retryAfter };
    }
    const result = await unlockPin(user.id, body.verifier);
    set.headers['Cache-Control'] = 'no-store';
    if (!result.ok) {
      set.status = result.status;
      return { error: result.error, code: result.code, ...(typeof result.attemptsLeft === 'number' ? { attemptsLeft: result.attemptsLeft } : {}) };
    }
    return { secret: result.secret, bundle: result.bundle, salt: result.salt, iterations: result.iterations, identityPub: result.identityPub };
  }, { body: t.Object({ verifier: t.String({ maxLength: 64 }) }) })

  .post('/pin/remove', async ({ headers, cookie, body, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
    const rl = await limited('e2eeWrite', user.id, set);
    if (rl) return rl;
    await ensureE2eeSchema();
    const userId = normalizeId(user.id);
    const identity = await getIdentity(userId);
    if (!identity || identity.identityPub !== body.identityPub) {
      set.status = 409;
      return { error: 'Your encryption keys changed. Reload and try again.' };
    }
    if (!(await verifyRecoveryRemoval(identity.identityPub, userId, 'pin', body.ts, body.sig))) {
      set.status = 403;
      return { error: 'This request was not signed by your encryption keys' };
    }
    await clearPinBackup(userId);
    return { success: true };
  }, { body: t.Object({ identityPub: t.String({ maxLength: 120 }), ts: t.Number(), sig: t.String({ maxLength: 120 }) }) })

  .get('/users/:userId/keys', async ({ headers, cookie, params, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
    const rl = await limited('e2eeRead', user.id, set);
    if (rl) return rl;
    if (!isValidObjectId(params.userId)) {
      set.status = 400;
      return { error: 'Invalid user id' };
    }
    // Only people you have something to do with (no key / device enumeration).
    if (!(await canLookUpKeys(user.id, params.userId).catch(() => false))) {
      set.status = 404;
      return { error: 'User not found' };
    }
    await ensureE2eeSchema();
    const [bundle] = await keyBundles([params.userId], user.id);
    return { keys: bundle };
  }, { params: t.Object({ userId: t.String() }) })

  .get('/channels/:channelId/keys', async ({ headers, cookie, params, query, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
    const rl = await limited('e2eeRead', user.id, set);
    if (rl) return rl;
    const channel = await Channel.findById(params.channelId);
    const isMember = Boolean(channel?.recipientIds?.some((id) => normalizeId(id) === normalizeId(user.id)));
    if (!channel || (channel.type !== 'dm' && channel.type !== 'group_dm') || !isMember) {
      set.status = 404;
      return { error: 'Conversation not found' };
    }
    await ensureE2eeSchema();
    const memberIds = channel.recipientIds || [];
    const members = await keyBundles(memberIds, user.id);
    // Clients cache bundles and revalidate with ?v=<version>: an unchanged set
    // answers without the bundles.
    const version = keysVersionOf(members);
    if (typeof query.v === 'string' && query.v === version) {
      return { channelId: channel.id, e2ee: channel.e2ee === true, version, unchanged: true };
    }
    return {
      channelId: channel.id,
      e2ee: channel.e2ee === true,
      version,
      members,
    };
  }, { params: t.Object({ channelId: t.String() }), query: t.Object({ v: t.Optional(t.String({ maxLength: 64 })) }) })

  .post('/channels/:channelId/enable', async ({ headers, cookie, params, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
    if (!e2eeEnabled()) return disabled(set);
    const rl = await limited('e2eeEnable', user.id, set);
    if (rl) return rl;
    if (!isValidObjectId(params.channelId)) {
      set.status = 400;
      return { error: 'Invalid channel id' };
    }
    const channel = await Channel.findById(params.channelId);
    const memberIds = channel?.recipientIds || [];
    const isMember = memberIds.some((id) => normalizeId(id) === normalizeId(user.id));
    if (!channel || (channel.type !== 'dm' && channel.type !== 'group_dm') || !isMember) {
      set.status = 404;
      return { error: 'Conversation not found' };
    }
    if (channel.e2ee === true) return { success: true, e2ee: true, changed: false };
    await ensureE2eeSchema();
    const members = await User.find({ id: { in: memberIds } });
    if (members.length < 2 || members.length !== memberIds.length || !members.every(canJoinEncrypted)) {
      set.status = 400;
      return { error: "Conversations with bots or system accounts can't be encrypted" };
    }
    if (!(await usersHaveKeys(memberIds))) {
      set.status = 409;
      return { error: "Everyone in this conversation needs to open SerikaCord on an updated app before encryption can be turned on" };
    }
    // One-way switch; only the first request posts the notice.
    const [flipped] = await db.update(schema.channels)
      .set({ e2ee: true })
      .where(and(eq(schema.channels.id, channel.id), sql`${schema.channels.e2ee} IS DISTINCT FROM true`))
      .returning({ id: schema.channels.id });
    if (!flipped) return { success: true, e2ee: true, changed: false };
    // A conversation turned off earlier is on again (the off record stays for history).
    await db.update(schema.e2eeConversationStates)
      .set({ state: 'on', updatedBy: normalizeId(user.id), updatedAt: new Date() })
      .where(eq(schema.e2eeConversationStates.channelId, normalizeId(channel.id)))
      .catch(() => {});

    const notice = await Message.create({
      channelId: channel.id,
      authorId: user.id,
      content: '',
      type: 'system',
      e2ee: E2EE_NOTICE,
    });
    await Channel.updateById(channel.id, { lastMessageId: notice.id, updatedAt: new Date() }).catch(() => {});
    const messageData = {
      id: notice.id,
      type: 'e2ee_enabled',
      content: '',
      authorId: user.id,
      author: {
        id: user.id,
        username: user.username,
        displayName: user.displayName || user.username,
        avatar: user.avatar ?? undefined,
        badges: user.badges || [],
        customization: user.customization || null,
      },
      channelId: channel.id,
      createdAt: notice.createdAt,
      attachments: [],
    };
    const { publishToDm, emitDmListUpdate } = await import('@/lib/api/dms');
    publishToDm(channel.id, { type: 'e2ee_enabled', channelId: channel.id });
    publishToDm(channel.id, { type: 'message', message: messageData });
    emitDmListUpdate(memberIds, { type: 'dm:e2ee', channelId: channel.id, e2ee: true });
    // Others who haven't set a recovery passphrase yet: encryption works, but
    // they can't restore this history on a new device until they do.
    const withoutRecovery = await membersWithoutRecovery(memberIds.filter((id) => normalizeId(id) !== normalizeId(user.id)));
    const names = members
      .filter((m) => withoutRecovery.has(normalizeId(m.id)))
      .map((m) => m.displayName || m.username)
      .slice(0, 5);
    return { success: true, e2ee: true, changed: true, message: messageData, withoutRecovery: names };
  }, { params: t.Object({ channelId: t.String() }) })

  // Turn encryption off for one conversation. Only with a member device's
  // signed record (lib/e2ee/conversationState.ts): other members' devices keep
  // treating the conversation as encrypted until that signature verifies.
  .post('/channels/:channelId/disable', async ({ headers, cookie, params, body, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
    const rl = await limited('e2eeEnable', user.id, set);
    if (rl) return rl;
    if (!isValidObjectId(params.channelId)) {
      set.status = 400;
      return { error: 'Invalid channel id' };
    }
    const channel = await Channel.findById(params.channelId);
    const memberIds = channel?.recipientIds || [];
    const isMember = memberIds.some((id) => normalizeId(id) === normalizeId(user.id));
    if (!channel || (channel.type !== 'dm' && channel.type !== 'group_dm') || !isMember) {
      set.status = 404;
      return { error: 'Conversation not found' };
    }
    if (channel.e2ee !== true) return { success: true, e2ee: false, changed: false };
    await ensureE2eeSchema();
    const checked = await checkOffRecordFrom(user.id, channel, body.record);
    if (!checked.ok) {
      set.status = checked.status;
      return { error: checked.error };
    }
    const record = checked.record;
    const [flipped] = await db.update(schema.channels)
      .set({ e2ee: false })
      .where(and(eq(schema.channels.id, channel.id), eq(schema.channels.e2ee, true)))
      .returning({ id: schema.channels.id });
    if (!flipped) return { success: true, e2ee: false, changed: false };
    const now = new Date();
    await db.insert(schema.e2eeConversationStates)
      .values({ channelId: normalizeId(channel.id), state: 'off', record, updatedBy: normalizeId(user.id), updatedAt: now })
      .onConflictDoUpdate({
        target: schema.e2eeConversationStates.channelId,
        set: { state: 'off', record, updatedBy: normalizeId(user.id), updatedAt: now },
      });

    const notice = await Message.create({
      channelId: channel.id,
      authorId: user.id,
      content: '',
      type: 'system',
      e2ee: e2eeOffNotice(record),
    });
    await Channel.updateById(channel.id, { lastMessageId: notice.id, updatedAt: now }).catch(() => {});
    const messageData = {
      id: notice.id,
      type: 'e2ee_disabled',
      content: '',
      e2eeRecord: record,
      authorId: user.id,
      author: {
        id: user.id,
        username: user.username,
        displayName: user.displayName || user.username,
        avatar: user.avatar ?? undefined,
        badges: user.badges || [],
        customization: user.customization || null,
      },
      channelId: channel.id,
      createdAt: notice.createdAt,
      attachments: [],
    };
    const { publishToDm, emitDmListUpdate } = await import('@/lib/api/dms');
    publishToDm(channel.id, { type: 'e2ee_disabled', channelId: channel.id, record });
    publishToDm(channel.id, { type: 'message', message: messageData });
    emitDmListUpdate(memberIds, { type: 'dm:e2ee', channelId: channel.id, e2ee: false });
    return { success: true, e2ee: false, changed: true, message: messageData };
  }, { params: t.Object({ channelId: t.String() }), body: t.Object({ record: t.Unknown() }) })

  // The signed "turned off" record of a conversation (clients that remember it
  // encrypted verify it before accepting plaintext there).
  .get('/channels/:channelId/state', async ({ headers, cookie, params, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
    const rl = await limited('e2eeRead', user.id, set);
    if (rl) return rl;
    if (!isValidObjectId(params.channelId)) {
      set.status = 400;
      return { error: 'Invalid channel id' };
    }
    const channel = await Channel.findById(params.channelId);
    const isMember = Boolean(channel?.recipientIds?.some((id) => normalizeId(id) === normalizeId(user.id)));
    if (!channel || (channel.type !== 'dm' && channel.type !== 'group_dm') || !isMember) {
      set.status = 404;
      return { error: 'Conversation not found' };
    }
    await ensureE2eeSchema();
    const state = await getConversationState(channel.id);
    return {
      channelId: channel.id,
      e2ee: channel.e2ee === true,
      state: state?.state === 'off' && channel.e2ee !== true ? 'off' : channel.e2ee === true ? 'on' : 'plain',
      record: state?.state === 'off' && channel.e2ee !== true ? state.record ?? null : null,
    };
  }, { params: t.Object({ channelId: t.String() }) })

  // ── Device linking (lib/e2ee/link.ts) ──────────────────────────────────────
  .post('/link', async ({ headers, cookie, body, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
    if (!e2eeEnabled()) return disabled(set);
    const rl = await limited('e2eeLink', user.id, set);
    if (rl) return rl;
    if (!isLinkCommitment(body.commit)) {
      set.status = 400;
      return { error: 'Invalid commitment' };
    }
    const redis = getRedis();
    if (!redis) {
      set.status = 503;
      return { error: 'Linking devices is unavailable right now. Use your recovery passphrase instead.' };
    }
    const now = Date.now();
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = newLinkCode();
      const key = linkKey(code);
      const created = await redis.hsetnx(key, 'user', normalizeId(user.id)).catch(() => 0);
      if (created !== 1) continue;
      const name = cleanDeviceName(body.name);
      await redis.multi()
        .hset(key, 'commit', body.commit, 'created', String(now), ...(name ? ['name', name] : []))
        .expire(key, LINK_TTL_SECONDS)
        .exec();
      set.status = 201;
      return { code, expiresAt: now + LINK_TTL_SECONDS * 1000 };
    }
    set.status = 503;
    return { error: 'Could not start linking. Try again.' };
  }, { body: t.Object({ commit: t.String({ maxLength: 64 }), name: t.Optional(t.String({ maxLength: 200 })) }) })

  .get('/link/:code', async ({ headers, cookie, params, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
    const rl = await limited('e2eeRead', user.id, set);
    if (rl) return rl;
    const session = await loadLinkSession(user.id, params.code, set);
    if ('error' in session) return session;
    const r = session.record;
    let payload: unknown = null;
    try {
      payload = r.payload ? JSON.parse(r.payload) : null;
    } catch {
      payload = null;
    }
    return {
      code: session.code,
      status: linkStatus(r),
      commit: r.commit ?? null,
      // How the requesting device described itself (shown before approving; informational).
      name: r.name ?? null,
      oldPub: r.oldPub ?? null,
      newPub: r.newPub ?? null,
      payload,
      expiresAt: Number(r.created || 0) + LINK_TTL_SECONDS * 1000,
    };
  }, { params: t.Object({ code: t.String({ maxLength: 32 }) }) })

  .post('/link/:code/join', async ({ headers, cookie, params, body, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
    const rl = await limited('e2eeLink', user.id, set);
    if (rl) return rl;
    if (!isLinkPublicKey(body.pub)) {
      set.status = 400;
      return { error: 'Invalid key' };
    }
    const session = await loadLinkSession(user.id, params.code, set);
    if ('error' in session) return session;
    if (session.record.done) {
      set.status = 409;
      return { error: 'This request is finished. Start again.' };
    }
    // The joining device must have seen the commitment first (it echoes it).
    if (session.record.commit !== body.commit) {
      set.status = 409;
      return { error: 'This link request changed. Start again.' };
    }
    if (!(await setLinkStep(session.code, 'oldPub', body.pub))) {
      set.status = 409;
      return { error: 'Another device already answered this request. Start again.' };
    }
    pingLink(user.id, session.code, 'joined');
    return { success: true };
  }, { params: t.Object({ code: t.String({ maxLength: 32 }) }), body: t.Object({ pub: t.String({ maxLength: 120 }), commit: t.String({ maxLength: 64 }) }) })

  .post('/link/:code/reveal', async ({ headers, cookie, params, body, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
    const rl = await limited('e2eeLink', user.id, set);
    if (rl) return rl;
    if (!isLinkPublicKey(body.pub)) {
      set.status = 400;
      return { error: 'Invalid key' };
    }
    const session = await loadLinkSession(user.id, params.code, set);
    if ('error' in session) return session;
    if (session.record.done) {
      set.status = 409;
      return { error: 'This request is finished. Start again.' };
    }
    if (!session.record.oldPub) {
      set.status = 409;
      return { error: 'Waiting for your other device' };
    }
    // Sanity only (clients check this themselves): the key opens the commitment.
    if ((await linkCommitment(body.pub).catch(() => null)) !== session.record.commit) {
      set.status = 400;
      return { error: 'The key does not match this request' };
    }
    if (!(await setLinkStep(session.code, 'newPub', body.pub))) {
      set.status = 409;
      return { error: 'This request was already answered. Start again.' };
    }
    pingLink(user.id, session.code, 'revealed');
    return { success: true };
  }, { params: t.Object({ code: t.String({ maxLength: 32 }) }), body: t.Object({ pub: t.String({ maxLength: 120 }) }) })

  .post('/link/:code/payload', async ({ headers, cookie, params, body, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
    const rl = await limited('e2eeLink', user.id, set);
    if (rl) return rl;
    let payload;
    try {
      payload = validateLinkPayload(body);
    } catch {
      set.status = 400;
      return { error: 'Invalid payload' };
    }
    const session = await loadLinkSession(user.id, params.code, set);
    if ('error' in session) return session;
    if (session.record.done) {
      set.status = 409;
      return { error: 'This request is finished. Start again.' };
    }
    if (!session.record.newPub) {
      set.status = 409;
      return { error: 'Waiting for your new device' };
    }
    if (!(await setLinkStep(session.code, 'payload', JSON.stringify(payload)))) {
      set.status = 409;
      return { error: 'This request was already answered. Start again.' };
    }
    pingLink(user.id, session.code, 'sent');
    return { success: true };
  }, { params: t.Object({ code: t.String({ maxLength: 32 }) }), body: t.Object({ iv: t.String({ maxLength: 32 }), ct: t.String({ maxLength: 4096 }) }) })

  .post('/link/:code/done', async ({ headers, cookie, params, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
    const rl = await limited('e2eeLink', user.id, set);
    if (rl) return rl;
    const session = await loadLinkSession(user.id, params.code, set);
    if ('error' in session) return session;
    if (!session.record.payload) {
      set.status = 409;
      return { error: 'Nothing was sent yet' };
    }
    // Keep the (expiring) session so the other device sees it finished; the sealed keys go now.
    await getRedis()?.multi().hset(linkKey(session.code), 'done', '1').hdel(linkKey(session.code), 'payload').exec().catch(() => null);
    pingLink(user.id, session.code, 'done');
    return { success: true };
  }, { params: t.Object({ code: t.String({ maxLength: 32 }) }) })

  .delete('/link/:code', async ({ headers, cookie, params, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
    const rl = await limited('e2eeLink', user.id, set);
    if (rl) return rl;
    const session = await loadLinkSession(user.id, params.code, set);
    if ('error' in session) return { success: true };
    await getRedis()?.del(linkKey(session.code)).catch(() => 0);
    pingLink(user.id, session.code, 'closed');
    return { success: true };
  }, { params: t.Object({ code: t.String({ maxLength: 32 }) }) })

  // Ciphertext relay: only `e2ee-*.bin` attachment blobs on our own CDN, so it
  // can't be used as a general proxy. Reveals nothing (the bytes are opaque).
  .get('/blob', async ({ headers, cookie, query, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
    const rl = await checkRateLimit('e2eeBlob', user.id);
    if (!rl.success) {
      set.status = 429;
      return { error: 'Too many requests', retryAfter: rl.retryAfter };
    }
    let target: URL;
    let cdn: URL;
    try {
      target = new URL(String(query.url));
      cdn = new URL(config.CDN_URL);
    } catch {
      set.status = 400;
      return { error: 'Invalid url' };
    }
    const fileName = target.pathname.split('/').pop() ?? '';
    if (
      target.protocol !== cdn.protocol || target.host !== cdn.host || target.username || target.password || target.search ||
      !target.pathname.startsWith(`${cdn.pathname.replace(/\/+$/, '')}/attachments/`) || !/^[A-Za-z0-9_-]+\.bin$/.test(fileName)
    ) {
      set.status = 400;
      return { error: 'Not an encrypted attachment' };
    }
    const upstream = await fetch(target.toString(), { redirect: 'error', signal: AbortSignal.timeout(60_000) }).catch(() => null);
    if (!upstream || !upstream.ok || !upstream.body) {
      set.status = 502;
      return { error: 'Could not load the file' };
    }
    return new Response(upstream.body, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
        ...(upstream.headers.get('content-length') ? { 'Content-Length': upstream.headers.get('content-length')! } : {}),
      },
    });
  }, { query: t.Object({ url: t.String({ maxLength: 2048 }) }) });
