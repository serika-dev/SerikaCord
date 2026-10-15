// Server side of end-to-end encryption (docs/architecture/e2ee.md): the
// feature flag, the boot-time schema ensure, public key lookups, and the checks
// the DM send/edit routes run on encrypted messages. The server only ever sees
// public keys, sealed backups and opaque envelopes.
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { normalizeId } from '@/lib/db/normalizeId';
import { config } from '@/lib/config';
import {
  E2eeVerifyError,
  decryptAttachment,
  isFrankingDisclosure,
  verifyFranking,
  type Envelope,
  type MessagePayload,
} from '@/lib/e2ee';
import type { ChannelLike, ParsedEncryptedBody } from '@/lib/e2ee/policy';
import {
  E2EE_NOTICE,
  ENCRYPTED_PREVIEW,
  e2eeMismatch,
  isE2eeChannel,
  isE2eeNotice,
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

/** Public key bundles for `userIds` (identity, backup, devices incl. recently revoked). */
export async function keyBundles(userIds: string[]) {
  const ids = [...new Set(userIds.map((u) => normalizeId(u)))];
  if (ids.length === 0) return [];
  const [identities, devices] = await Promise.all([
    db.select().from(schema.e2eeIdentities).where(inArray(schema.e2eeIdentities.userId, ids)),
    devicesOf(ids, { includeRevoked: true }),
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
      devices: active.map(publicDevice),
      revokedDevices: revoked.map(publicDevice),
    };
  });
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

// ─── Encrypted sends / edits ──────────────────────────────────────────────────

export { E2EE_NOTICE, ENCRYPTED_PREVIEW, e2eeMismatch, isE2eeChannel, isE2eeNotice, storedEnvelope };

/** parseEncryptedBody against our CDN (attachments must be this user's uploads there). */
export function parseEncryptedBody(userId: string, body: Parameters<typeof parseEncryptedBodyFor>[2]): ParsedEncryptedBody {
  return parseEncryptedBodyFor(userId, config.CDN_URL, body);
}

/**
 * Gate for a send/edit into `channel`: plaintext into an encrypted
 * conversation (or an envelope into a plain one) is refused, and an envelope
 * must come from one of the sender's active devices.
 */
export async function checkE2eeChannelSend(
  userId: string,
  channel: ChannelLike,
  envelope: Envelope | null | undefined,
): Promise<{ status: number; error: string } | null> {
  const mismatch = e2eeMismatch(channel, Boolean(envelope));
  if (mismatch) return mismatch;
  if (!envelope) return null;
  const device = await findUserDevice(userId, envelope.sd).catch(() => null);
  if (!device || device.revokedAt) {
    return { status: 403, error: 'This device is not registered for end-to-end encryption' };
  }
  return null;
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
  if (!res || !res.ok) return null;
  const declared = Number(res.headers.get('content-length') || '0');
  if (declared > REPORT_MAX_BLOB_BYTES) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  return bytes.byteLength > REPORT_MAX_BLOB_BYTES ? null : bytes;
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
  const envelope = storedEnvelope(message.e2ee);
  if (!envelope) return { ok: false, status: 400, error: 'This message is not end-to-end encrypted' };
  if (!isFrankingDisclosure(disclosure)) {
    return { ok: false, status: 400, error: 'Reporting an encrypted message needs the message key. Update the app and try again.' };
  }
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
  const { scanUploadedImage } = await import('@/lib/services/trustSafety');
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
      const verdict = await scanUploadedImage(Buffer.from(plain), imageType, {
        userId: message.authorId,
        fileName: att.name,
        category: 'e2ee-report',
        channelId: message.channelId,
      });
      notes.push(verdict.blocked
        ? `${label}: MATCHED ${verdict.kind}${verdict.incidentId ? ` (incident ${verdict.incidentId})` : ''}`
        : `${label}: scanned, no match`);
    } catch (err) {
      notes.push(`${label}: ${err instanceof E2eeVerifyError ? 'failed to decrypt with the disclosed key' : 'scan failed'}`);
    }
  }
  return { ok: true, payload: result.payload, attachmentNotes: notes };
}
