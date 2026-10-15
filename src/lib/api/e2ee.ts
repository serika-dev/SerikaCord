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
//
// Writes that create keys or encrypted conversations are refused while the
// E2EE_ENABLED flag is off; reads and device revocation always work.
import { Elysia, t } from 'elysia';
import { and, count, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { normalizeId } from '@/lib/db/normalizeId';
import { authenticateRequest } from '@/lib/services/auth';
import { checkRateLimit, getClientIP, isValidObjectId, rejectInvalidObjectIdParams } from '@/lib/security';
import { accountsLogin, accountsLogout } from '@/lib/services/accountsClient';
import { Channel, Message, User } from '@/lib/models';
import {
  E2EE_DISABLED_ERROR,
  E2EE_NOTICE,
  canJoinEncrypted,
  canLookUpKeys,
  devicesOf,
  e2eeEnabled,
  ensureE2eeSchema,
  getIdentity,
  keyBundles,
  publicDevice,
  usersHaveKeys,
} from '@/lib/services/e2ee';
import {
  E2eeFormatError,
  LIMITS,
  isDeviceId,
  isPublicKeyB64,
  validateBackupRecord,
  verifyBackupKey,
  verifyDevice,
} from '@/lib/e2ee';
import { config } from '@/lib/config';

type Cookie = Record<string, { value?: unknown }>;

async function getAuth(headers: Record<string, string | undefined>, cookie: Cookie) {
  const authHeader = headers.authorization ?? null;
  const authToken = cookie.auth_token?.value;
  const cookies: Record<string, string> = {};
  if (typeof authToken === 'string') cookies.auth_token = authToken;
  return authenticateRequest(authHeader, cookies);
}

type Setter = { status?: number | string };

async function limited(kind: 'e2eeRead' | 'e2eeWrite' | 'e2eeEnable', userId: string, set: Setter) {
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
    return { enabled: e2eeEnabled(), identity: identitySummary(identity), device };
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
        return { device: touched } as const;
      }
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
      return { device: created } as const;
    });
    if ('error' in result) {
      set.status = result.status;
      return { error: result.error };
    }
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
    return { success: true };
  }, { params: t.Object({ deviceId: t.String({ maxLength: 32 }) }) })

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

  .get('/channels/:channelId/keys', async ({ headers, cookie, params, set }) => {
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
    return {
      channelId: channel.id,
      e2ee: channel.e2ee === true,
      members: await keyBundles(memberIds, user.id),
    };
  }, { params: t.Object({ channelId: t.String() }) })

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
    return { success: true, e2ee: true, changed: true, message: messageData };
  }, { params: t.Object({ channelId: t.String() }) })

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
