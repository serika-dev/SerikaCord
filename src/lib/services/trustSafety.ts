// Trust & Safety: automated image scanning, account strikes, temporary
// restrictions, account standing and appeals.
//
//   Upload scanning (StorageService.upload → scanUploadedImage):
//     PhotoDNA match (CSAM)  → upload blocked, incident logged, account banned
//                              (staff accounts: logged as a test, never banned)
//     scam-image hash match  → upload blocked, 24h chat restriction + 1 strike
//   MAX_STRIKES active strikes suspend the account. A suspended account can
//   still sign in, sees only its Account Standing, and can appeal.
//
// Pure rules: src/lib/safety/*. Storage: drizzle/manual_trust_safety.sql
// (also ensured at boot). Routes: src/lib/api/trustSafety.ts.
//
// CSAM images are never stored: the upload is rejected before it reaches B2.
// Incidents keep only metadata (sha256, PhotoDNA tracking id, match details,
// uploader + IP) for the staff review queue and an NCMEC report.
import { createHash } from 'node:crypto';
import { and, desc, eq, gt, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import sharp from 'sharp';
import { db, schema } from '@/lib/db/postgres';
import { cache } from '@/lib/db';
import { normalizeId } from '@/lib/db/normalizeId';
import { User } from '@/lib/models';
import { decryptRow, decryptRows, encryptField, encryptRow, type FieldSpec } from '@/lib/security/fieldEncryption';
import { MAX_SCAN_PIXELS, photoDnaConfigured, photoDnaMatch } from '@/lib/services/photoDnaClient';
import {
  DEFAULT_MATCH_DISTANCE,
  DHASH_HEIGHT,
  DHASH_WIDTH,
  dHashFromGrayscale,
  findClosestHash,
  isScannableImage,
} from '@/lib/safety/imageHash';
import {
  MAX_STRIKES,
  SCAM_CHAT_RESTRICTION_HOURS,
  STRIKE_EXPIRY_DAYS,
  computeStandingLevel,
  isRestrictionActive,
  isStrikeActive,
  strikeExpiry,
  type RestrictionType,
  type StandingLevel,
  type StrikeCategory,
} from '@/lib/safety/standing';

// ─── Boot-time schema ensure ──────────────────────────────────────────────────

const g = globalThis as unknown as { __trustSafetySchema?: Promise<void> | null };

/** Mirrors drizzle/manual_trust_safety.sql. Additive + idempotent, short lock timeout, retried. */
export function ensureTrustSafetySchema(): Promise<void> {
  if (g.__trustSafetySchema) return g.__trustSafetySchema;
  g.__trustSafetySchema = (async () => {
    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        await db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
          await tx.execute(sql`CREATE TABLE IF NOT EXISTS account_strikes (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, category text NOT NULL DEFAULT 'other',
            reason text NOT NULL, source text NOT NULL DEFAULT 'staff', issued_by uuid, incident_id uuid,
            created_at timestamp NOT NULL DEFAULT now(), expires_at timestamp, revoked_at timestamp, revoked_by uuid, revoke_reason text)`);
          await tx.execute(sql`CREATE INDEX IF NOT EXISTS account_strikes_user_id_idx ON account_strikes (user_id)`);
          await tx.execute(sql`CREATE TABLE IF NOT EXISTS account_restrictions (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, type text NOT NULL DEFAULT 'chat',
            reason text NOT NULL, source text NOT NULL DEFAULT 'staff', issued_by uuid, incident_id uuid,
            created_at timestamp NOT NULL DEFAULT now(), until timestamp NOT NULL, lifted_at timestamp, lifted_by uuid)`);
          await tx.execute(sql`CREATE INDEX IF NOT EXISTS account_restrictions_user_id_idx ON account_restrictions (user_id)`);
          await tx.execute(sql`CREATE TABLE IF NOT EXISTS safety_incidents (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, kind text NOT NULL, status text NOT NULL DEFAULT 'open',
            is_test boolean NOT NULL DEFAULT false, details jsonb NOT NULL DEFAULT '{}'::jsonb, file_name text, content_type text,
            file_size integer, sha256 text, upload_category text, channel_id uuid, ip text, hash_id uuid, action_taken text, notes text,
            reviewed_by uuid, reviewed_at timestamp, ncmec_reported_at timestamp, ncmec_report_id text, created_at timestamp NOT NULL DEFAULT now())`);
          await tx.execute(sql`CREATE INDEX IF NOT EXISTS safety_incidents_user_id_idx ON safety_incidents (user_id)`);
          await tx.execute(sql`CREATE INDEX IF NOT EXISTS safety_incidents_status_idx ON safety_incidents (status, created_at)`);
          await tx.execute(sql`CREATE TABLE IF NOT EXISTS account_appeals (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, target_type text NOT NULL, target_id uuid,
            message text NOT NULL, status text NOT NULL DEFAULT 'open', staff_note text, reviewed_by uuid, reviewed_at timestamp,
            created_at timestamp NOT NULL DEFAULT now())`);
          await tx.execute(sql`CREATE INDEX IF NOT EXISTS account_appeals_user_id_idx ON account_appeals (user_id)`);
          await tx.execute(sql`CREATE INDEX IF NOT EXISTS account_appeals_status_idx ON account_appeals (status, created_at)`);
          await tx.execute(sql`CREATE TABLE IF NOT EXISTS scam_image_hashes (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(), hash text NOT NULL, label text NOT NULL, max_distance integer NOT NULL DEFAULT 6,
            added_by uuid, match_count integer NOT NULL DEFAULT 0, last_matched_at timestamp, created_at timestamp NOT NULL DEFAULT now())`);
          await tx.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS scam_image_hashes_hash_unique ON scam_image_hashes (hash)`);
        });
        // The message report queue's table (its own ensure; never throws).
        void import('@/lib/services/messageReports').then((m) => m.ensureMessageReportsSchema()).catch(() => {});
        return;
      } catch (err) {
        console.error(`[trust-safety] Ensuring schema failed (attempt ${attempt}):`, (err as Error)?.message ?? err);
        await new Promise((r) => setTimeout(r, Math.min(30_000, 2_000 * attempt)));
      }
    }
    g.__trustSafetySchema = null;
  })();
  return g.__trustSafetySchema;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Strike = typeof schema.accountStrikes.$inferSelect;
type Restriction = typeof schema.accountRestrictions.$inferSelect;
type Incident = typeof schema.safetyIncidents.$inferSelect;
type Appeal = typeof schema.accountAppeals.$inferSelect;

// Encrypted at rest (fieldEncryption): the uploader IP and staff notes on
// incidents, the appeal text and the staff reply on appeals. Every reader
// below decrypts; rows written before this are plaintext and pass through.
const INCIDENT_FIELDS: FieldSpec = { text: ['ip', 'notes'] };
const APPEAL_FIELDS: FieldSpec = { text: ['message', 'staffNote'] };
type ScamHash = typeof schema.scamImageHashes.$inferSelect;

const restrictionKey = (userId: string) => `safety:restrict:${normalizeId(userId)}`;
const HASHES_KEY = 'safety:scam-hashes';

/**
 * Staff accounts are never auto-banned or auto-struck by the scanners: their
 * matches are logged as tests so the team can verify the pipeline safely.
 */
export async function isStaffAccount(userId: string): Promise<boolean> {
  const user = await User.findById(userId).catch(() => null);
  if (!user) return false;
  if (user.isStaff) return true;
  const { getUserStaffAccess } = await import('@/lib/services/staffAuth');
  const access = await getUserStaffAccess({ ...user, isBanned: false }).catch(() => null);
  return Boolean(access && (access.isSuperAdmin || access.permissions.length > 0 || access.roles.length > 0));
}

/** Only a super admin may put strikes / restrictions on another staff account. */
export async function canActOnStaffTarget(actorId: string, targetId: string): Promise<boolean> {
  if (!(await isStaffAccount(targetId))) return true;
  const actor = await User.findById(actorId).catch(() => null);
  if (!actor) return false;
  const { getUserStaffAccess } = await import('@/lib/services/staffAuth');
  return Boolean((await getUserStaffAccess(actor).catch(() => null))?.isSuperAdmin);
}

async function dropUserCache(userId: string) {
  await cache.del(`user:${userId}`).catch(() => {});
  await cache.del(`user:${normalizeId(userId)}`).catch(() => {});
}

// ─── Strikes, restrictions, suspension ────────────────────────────────────────

export async function listStrikes(userId: string): Promise<Strike[]> {
  return db.select().from(schema.accountStrikes)
    .where(eq(schema.accountStrikes.userId, normalizeId(userId)))
    .orderBy(desc(schema.accountStrikes.createdAt));
}

export async function listRestrictions(userId: string): Promise<Restriction[]> {
  return db.select().from(schema.accountRestrictions)
    .where(eq(schema.accountRestrictions.userId, normalizeId(userId)))
    .orderBy(desc(schema.accountRestrictions.createdAt));
}

/** Bans the account (keeps memberships and data), signs it out everywhere and tells the user. */
export async function suspendAccount(userId: string, reason: string, opts: { notify?: boolean } = {}): Promise<void> {
  await User.updateById(userId, { isBanned: true, banReason: reason });
  await dropUserCache(userId);
  if (opts.notify !== false) {
    const { notifySuspension } = await import('@/lib/services/systemNotify');
    await notifySuspension(userId, reason).catch(() => {});
  }
  const { revokeAllUserSessions } = await import('@/lib/services/auth');
  await revokeAllUserSessions(userId).catch(() => 0);
}

export async function unsuspendAccount(userId: string): Promise<void> {
  await User.updateById(userId, { isBanned: false, banReason: null });
  await dropUserCache(userId);
}

export interface IssueStrikeInput {
  userId: string;
  category: StrikeCategory;
  reason: string;
  source: 'automatic' | 'staff';
  issuedBy?: string | null;
  incidentId?: string | null;
  /** Days until it stops counting; null = never expires. */
  expiresInDays?: number | null;
}

/** Adds a strike; suspends the account when it reaches MAX_STRIKES active strikes. */
export async function issueStrike(input: IssueStrikeInput): Promise<{ strike: Strike; activeStrikes: number; suspended: boolean }> {
  const now = new Date();
  const days = input.expiresInDays === undefined ? STRIKE_EXPIRY_DAYS : input.expiresInDays;
  const [strike] = await db.insert(schema.accountStrikes).values({
    userId: normalizeId(input.userId),
    category: input.category,
    reason: input.reason.slice(0, 500),
    source: input.source,
    issuedBy: input.issuedBy ? normalizeId(input.issuedBy) : null,
    incidentId: input.incidentId ?? null,
    createdAt: now,
    expiresAt: days === null ? null : strikeExpiry(now, days),
  }).returning();
  const activeStrikes = (await listStrikes(input.userId)).filter((s) => isStrikeActive(s)).length;
  let suspended = false;
  if (activeStrikes >= MAX_STRIKES && !(await isStaffAccount(input.userId))) {
    const user = await User.findById(input.userId).catch(() => null);
    if (user && !user.isBanned) {
      await suspendAccount(input.userId, `Reached ${MAX_STRIKES} account strikes`);
      suspended = true;
    }
  }
  return { strike, activeStrikes, suspended };
}

export async function revokeStrike(strikeId: string, by: string, reason: string | null): Promise<Strike | null> {
  const [row] = await db.update(schema.accountStrikes)
    .set({ revokedAt: new Date(), revokedBy: normalizeId(by), revokeReason: reason?.slice(0, 500) ?? null })
    .where(and(eq(schema.accountStrikes.id, normalizeId(strikeId)), isNull(schema.accountStrikes.revokedAt)))
    .returning();
  return row ?? null;
}

export async function addRestriction(input: {
  userId: string;
  type: RestrictionType;
  reason: string;
  hours: number;
  source: 'automatic' | 'staff';
  issuedBy?: string | null;
  incidentId?: string | null;
}): Promise<Restriction> {
  const now = new Date();
  const [row] = await db.insert(schema.accountRestrictions).values({
    userId: normalizeId(input.userId),
    type: input.type,
    reason: input.reason.slice(0, 500),
    source: input.source,
    issuedBy: input.issuedBy ? normalizeId(input.issuedBy) : null,
    incidentId: input.incidentId ?? null,
    createdAt: now,
    until: new Date(now.getTime() + Math.max(1, input.hours) * 3600_000),
  }).returning();
  await cache.del(restrictionKey(input.userId)).catch(() => {});
  return row;
}

export async function liftRestriction(restrictionId: string, by: string): Promise<Restriction | null> {
  const [row] = await db.update(schema.accountRestrictions)
    .set({ liftedAt: new Date(), liftedBy: normalizeId(by) })
    .where(and(eq(schema.accountRestrictions.id, normalizeId(restrictionId)), isNull(schema.accountRestrictions.liftedAt)))
    .returning();
  if (row) await cache.del(restrictionKey(row.userId)).catch(() => {});
  return row ?? null;
}

export interface ChatRestriction {
  until: string;
  reason: string;
}

/** The user's active chat restriction (cached 30s), or null. Never throws. */
export async function getActiveChatRestriction(userId: string): Promise<ChatRestriction | null> {
  const key = restrictionKey(userId);
  const cached = await cache.get<{ r: ChatRestriction | null }>(key).catch(() => null);
  if (cached) return cached.r && new Date(cached.r.until).getTime() > Date.now() ? cached.r : null;
  let r: ChatRestriction | null = null;
  try {
    const [row] = await db.select().from(schema.accountRestrictions)
      .where(and(
        eq(schema.accountRestrictions.userId, normalizeId(userId)),
        eq(schema.accountRestrictions.type, 'chat'),
        isNull(schema.accountRestrictions.liftedAt),
        gt(schema.accountRestrictions.until, new Date()),
      ))
      .orderBy(desc(schema.accountRestrictions.until))
      .limit(1);
    if (row) r = { until: row.until.toISOString(), reason: row.reason };
  } catch {
    return null; // table not there yet
  }
  await cache.set(key, { r }, 30).catch(() => {});
  return r;
}

/** 403 body when the user is under a platform chat restriction, else null. */
export async function chatRestrictionDenial(userId: string): Promise<{ status: number; body: Record<string, unknown> } | null> {
  const r = await getActiveChatRestriction(userId);
  if (!r) return null;
  return {
    status: 403,
    body: {
      error: 'Your account is temporarily restricted from chatting. Check your Account Standing for details.',
      code: 'account_restricted',
      restrictedUntil: r.until,
    },
  };
}

// ─── Scam image hash list ─────────────────────────────────────────────────────

/** 64-bit dHash of an image (16 hex chars), or null when it can't be decoded. */
export async function computeImageHash(buffer: Buffer, page = 0): Promise<string | null> {
  try {
    const pixels = await sharp(buffer, { page, pages: 1, failOn: 'none', limitInputPixels: MAX_SCAN_PIXELS, sequentialRead: true })
      .flatten({ background: '#ffffff' })
      .grayscale()
      .resize(DHASH_WIDTH, DHASH_HEIGHT, { fit: 'fill', kernel: 'lanczos3' })
      .raw()
      .toBuffer();
    return dHashFromGrayscale(pixels);
  } catch {
    return null;
  }
}

export async function listScamHashes(): Promise<ScamHash[]> {
  const cached = await cache.get<ScamHash[]>(HASHES_KEY).catch(() => null);
  if (cached) return cached;
  try {
    const rows = await db.select().from(schema.scamImageHashes).orderBy(desc(schema.scamImageHashes.createdAt));
    await cache.set(HASHES_KEY, rows, 60).catch(() => {});
    return rows;
  } catch {
    return [];
  }
}

export async function addScamHash(input: { hash: string; label: string; maxDistance?: number; addedBy: string }): Promise<ScamHash | null> {
  const [row] = await db.insert(schema.scamImageHashes).values({
    hash: input.hash,
    label: input.label.slice(0, 200),
    maxDistance: Math.max(0, Math.min(16, Math.round(input.maxDistance ?? DEFAULT_MATCH_DISTANCE))),
    addedBy: normalizeId(input.addedBy),
  }).onConflictDoNothing().returning();
  await cache.del(HASHES_KEY).catch(() => {});
  return row ?? null;
}

export async function updateScamHash(id: string, patch: { label?: string; maxDistance?: number }): Promise<ScamHash | null> {
  const set: Partial<typeof schema.scamImageHashes.$inferInsert> = {};
  if (patch.label !== undefined) set.label = patch.label.slice(0, 200);
  if (patch.maxDistance !== undefined) set.maxDistance = Math.max(0, Math.min(16, Math.round(patch.maxDistance)));
  if (Object.keys(set).length === 0) {
    const [row] = await db.select().from(schema.scamImageHashes).where(eq(schema.scamImageHashes.id, normalizeId(id))).limit(1);
    return row ?? null;
  }
  const [row] = await db.update(schema.scamImageHashes).set(set).where(eq(schema.scamImageHashes.id, normalizeId(id))).returning();
  await cache.del(HASHES_KEY).catch(() => {});
  return row ?? null;
}

export async function deleteScamHash(id: string): Promise<boolean> {
  const rows = await db.delete(schema.scamImageHashes).where(eq(schema.scamImageHashes.id, normalizeId(id))).returning({ id: schema.scamImageHashes.id });
  await cache.del(HASHES_KEY).catch(() => {});
  return rows.length > 0;
}

// ─── Upload scanning ──────────────────────────────────────────────────────────

export interface ScanContext {
  userId?: string | null;
  fileName?: string | null;
  category?: string | null;
  channelId?: string | null;
  ip?: string | null;
}

export type BlockKind = 'csam' | 'scam' | 'unreadable';

export type ScanVerdict =
  | { blocked: false }
  | { blocked: true; kind: BlockKind; message: string; incidentId: string | null };

/** Thrown by StorageService.upload when the scanners reject an image. */
export class ContentBlockedError extends Error {
  readonly kind: BlockKind;
  readonly status = 403;
  constructor(kind: BlockKind, message: string) {
    super(message);
    this.name = 'ContentBlockedError';
    this.kind = kind;
  }
}

async function recordIncident(values: typeof schema.safetyIncidents.$inferInsert): Promise<Incident | null> {
  try {
    const [row] = await db.insert(schema.safetyIncidents).values(await encryptRow(INCIDENT_FIELDS, values)).returning();
    return decryptRow(INCIDENT_FIELDS, row ?? null);
  } catch (err) {
    console.error('[trust-safety] Could not record incident:', (err as Error)?.message ?? err);
    return null;
  }
}

/**
 * Scans an image upload before it is stored. Fails open when a scanner is
 * unavailable (logged), so an outage never blocks every upload.
 */
export async function scanUploadedImage(buffer: Buffer, contentType: string, ctx: ScanContext): Promise<ScanVerdict> {
  if (!ctx.userId || !isScannableImage(contentType)) return { blocked: false };
  const userId = ctx.userId;
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const base = {
    userId: normalizeId(userId),
    fileName: ctx.fileName?.slice(0, 255) ?? null,
    contentType: contentType.slice(0, 100),
    fileSize: buffer.byteLength,
    sha256,
    uploadCategory: ctx.category ?? null,
    channelId: ctx.channelId && /^[0-9a-f-]{36}$/i.test(ctx.channelId) ? ctx.channelId : null,
    ip: ctx.ip?.slice(0, 64) ?? null,
  };

  // Which frames to look at: animated GIF/WebP/APNG hide content past frame 1.
  let pages = 1;
  try {
    const meta = await sharp(buffer, { failOn: 'none', limitInputPixels: false }).metadata();
    const w = meta.width ?? 0;
    const h = meta.pageHeight ?? meta.height ?? 0;
    pages = Math.max(1, meta.pages ?? 1);
    // Too big to decode safely (memory) → never stored unscanned.
    if (!w || !h || w * h > MAX_SCAN_PIXELS) {
      return { blocked: true, kind: 'unreadable', message: 'This image is too large to upload. Try a smaller one.', incidentId: null };
    }
  } catch {
    return { blocked: true, kind: 'unreadable', message: "This image couldn't be processed, so it wasn't uploaded. Try PNG or JPEG.", incidentId: null };
  }
  const frames = [...new Set([0, Math.floor(pages / 2), pages - 1])].slice(0, 3);

  const [frameResults, hashes] = await Promise.all([
    withScanSlot(() => Promise.all(frames.map(async (page) => ({
      pdna: photoDnaConfigured() ? await photoDnaMatch(buffer, contentType, page) : null,
      dhash: await computeImageHash(buffer, page),
    })))),
    listScamHashes(),
  ]);
  const pdnaMatch = frameResults.map((f) => f.pdna).find((r) => r?.status === 'match') ?? null;
  const dhashes = frameResults.map((f) => f.dhash).filter((h): h is string => Boolean(h));

  // Neither scanner could read it: don't store what nobody checked. (PhotoDNA
  // being down or out of quota still fails open below.)
  const pdnaUnreadable = frameResults.every((f) => !f.pdna || (f.pdna.status === 'error' && f.pdna.code === 3206));
  if (dhashes.length === 0 && pdnaUnreadable) {
    return { blocked: true, kind: 'unreadable', message: "This image couldn't be processed, so it wasn't uploaded. Try PNG or JPEG.", incidentId: null };
  }

  // CSAM first: it outranks everything else.
  if (pdnaMatch && pdnaMatch.status === 'match') {
    const staff = await isStaffAccount(userId);
    // Microsoft's sample images match the "Test" source: logged as tests, not
    // reported. A real match is always queued for review / NCMEC, even from
    // staff; staff accounts are just never auto-banned (so the team can test).
    const test = pdnaMatch.isTestSource;
    const punish = !staff;
    const incident = await recordIncident({
      ...base,
      kind: 'csam',
      status: test ? 'test' : 'open',
      isTest: test,
      details: { trackingId: pdnaMatch.trackingId, flags: pdnaMatch.flags, testSource: test, staffAccount: staff, frames: pages },
      actionTaken: punish ? 'blocked_upload_banned' : 'blocked_upload_staff_exempt',
    });
    if (punish) {
      await issueStrike({ userId, category: 'csam', reason: 'Child safety policy violation', source: 'automatic', incidentId: incident?.id ?? null, expiresInDays: null }).catch(() => null);
      const user = await User.findById(userId).catch(() => null);
      if (user && !user.isBanned) await suspendAccount(userId, 'Child safety policy violation');
    }
    console.warn(`[trust-safety] PhotoDNA match on upload by ${userId} (incident ${incident?.id ?? 'unrecorded'}${test ? ', test source' : ''}${staff ? ', staff account' : ''})`);
    return { blocked: true, kind: 'csam', message: 'This image violates our policies and was not uploaded.', incidentId: incident?.id ?? null };
  }
  const pdnaError = frameResults.map((f) => f.pdna).find((r) => r?.status === 'error');
  if (pdnaError && pdnaError.status === 'error' && !/not configured/.test(pdnaError.description) && pdnaError.code !== 3206) {
    console.warn(`[trust-safety] PhotoDNA unavailable (${pdnaError.code ?? '-'}: ${pdnaError.description}); upload allowed`);
  }

  if (dhashes.length > 0 && hashes.length > 0) {
    let match: { entry: ScamHash; distance: number; hash: string } | null = null;
    for (const h of dhashes) {
      for (const entry of hashes) {
        const m = findClosestHash(h, [entry], entry.maxDistance ?? DEFAULT_MATCH_DISTANCE);
        if (m && (!match || m.distance < match.distance)) match = { ...m, hash: h };
      }
    }
    if (match) {
      const staff = await isStaffAccount(userId);
      const incident = await recordIncident({
        ...base,
        kind: 'scam_image',
        status: staff ? 'test' : 'actioned',
        isTest: staff,
        hashId: match.entry.id,
        details: { hash: match.hash, matchedHash: match.entry.hash, label: match.entry.label, distance: match.distance },
        actionTaken: staff ? 'blocked_upload_staff_test' : 'blocked_upload_restricted_strike',
      });
      void db.update(schema.scamImageHashes)
        .set({ matchCount: sql`${schema.scamImageHashes.matchCount} + 1`, lastMatchedAt: new Date() })
        .where(eq(schema.scamImageHashes.id, match.entry.id))
        .catch(() => {});
      if (!staff) await penalizeScam(userId, incident?.id ?? null, match.entry.label);
      return { blocked: true, kind: 'scam', message: 'This image matches known scam content and was not uploaded.', incidentId: incident?.id ?? null };
    }
  }
  return { blocked: false };
}

// At most a few image scans decode at once (each can take tens of MB).
const SCAN_SLOTS = 3;
let scansRunning = 0;
const scanQueue: Array<() => void> = [];

async function withScanSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (scansRunning >= SCAN_SLOTS) await new Promise<void>((resolve) => scanQueue.push(resolve));
  scansRunning++;
  try {
    return await fn();
  } finally {
    scansRunning--;
    scanQueue.shift()?.();
  }
}

const SCAM_STRIKE_WINDOW_MS = 60 * 60 * 1000;

/** Scam image: 24h chat restriction + a strike, and tell the user why. */
async function penalizeScam(userId: string, incidentId: string | null, label: string) {
  const reason = 'Posting a known scam image';
  await addRestriction({ userId, type: 'chat', reason, hours: SCAM_CHAT_RESTRICTION_HOURS, source: 'automatic', incidentId }).catch(() => null);
  // One burst (several scam images in one message, re-uploads) is one strike,
  // not a fast track to suspension.
  const recent = await listStrikes(userId).catch(() => [] as Strike[]);
  if (recent.some((s) => s.category === 'scam' && s.source === 'automatic' && Date.now() - new Date(s.createdAt).getTime() < SCAM_STRIKE_WINDOW_MS)) return;
  const result = await issueStrike({ userId, category: 'scam', reason, source: 'automatic', incidentId }).catch(() => null);
  if (result && !result.suspended) {
    const { sendSystemDM } = await import('@/lib/services/systemNotify');
    void sendSystemDM(userId, [
      '**⚠️ Your account received a strike**',
      '',
      `An image you tried to upload matches known scam content${label ? ` (${label})` : ''}, so it was blocked.`,
      `You can't send messages for the next ${SCAM_CHAT_RESTRICTION_HOURS} hours.`,
      '',
      `**Active strikes:** ${result.activeStrikes} of ${MAX_STRIKES}. Reaching ${MAX_STRIKES} suspends your account.`,
      'You can review this and appeal in **User Settings → Account Standing**.',
    ].join('\n'), { kind: 'safety' }).catch(() => {});
  }
}

// ─── Standing (what the user sees) ────────────────────────────────────────────

export interface StandingView {
  level: StandingLevel;
  banned: boolean;
  banReason: string | null;
  maxStrikes: number;
  activeStrikes: number;
  strikes: Array<{
    id: string;
    category: string;
    reason: string;
    source: string;
    createdAt: string;
    expiresAt: string | null;
    active: boolean;
    revoked: boolean;
    appeal: { id: string; status: string; staffNote: string | null } | null;
  }>;
  restrictions: Array<{ id: string; type: string; reason: string; until: string; active: boolean; createdAt: string }>;
  appeals: Array<{ id: string; targetType: string; targetId: string | null; status: string; staffNote: string | null; createdAt: string; message: string }>;
  banAppeal: { id: string; status: string; staffNote: string | null } | null;
}

export async function getStanding(userId: string): Promise<StandingView> {
  const [user, strikes, restrictions, appeals] = await Promise.all([
    User.findById(userId),
    listStrikes(userId).catch(() => [] as Strike[]),
    listRestrictions(userId).catch(() => [] as Restriction[]),
    listAppealsForUser(userId).catch(() => [] as Appeal[]),
  ]);
  const now = Date.now();
  const appealFor = (type: string, id: string | null) => {
    const a = appeals.find((x) => x.targetType === type && (id === null ? !x.targetId : x.targetId === id));
    return a ? { id: a.id, status: a.status, staffNote: a.staffNote } : null;
  };
  const activeStrikes = strikes.filter((s) => isStrikeActive(s, now)).length;
  const activeRestrictions = restrictions.filter((r) => isRestrictionActive(r, now)).length;
  const banned = Boolean(user?.isBanned);
  return {
    level: computeStandingLevel({ banned, activeStrikes, activeRestrictions }),
    banned,
    banReason: banned ? user?.banReason ?? null : null,
    maxStrikes: MAX_STRIKES,
    activeStrikes,
    strikes: strikes.map((s) => ({
      id: s.id,
      category: s.category,
      reason: s.reason,
      source: s.source,
      createdAt: s.createdAt.toISOString(),
      expiresAt: s.expiresAt ? s.expiresAt.toISOString() : null,
      active: isStrikeActive(s, now),
      revoked: Boolean(s.revokedAt),
      appeal: appealFor('strike', s.id),
    })),
    restrictions: restrictions.slice(0, 20).map((r) => ({
      id: r.id,
      type: r.type,
      reason: r.reason,
      until: r.until.toISOString(),
      active: isRestrictionActive(r, now),
      createdAt: r.createdAt.toISOString(),
    })),
    appeals: appeals.map((a) => ({ id: a.id, targetType: a.targetType, targetId: a.targetId, status: a.status, staffNote: a.staffNote, createdAt: a.createdAt.toISOString(), message: a.message })),
    banAppeal: banned ? appealFor('ban', null) : null,
  };
}

// ─── Appeals ──────────────────────────────────────────────────────────────────

export async function listAppealsForUser(userId: string): Promise<Appeal[]> {
  const rows = await db.select().from(schema.accountAppeals)
    .where(eq(schema.accountAppeals.userId, normalizeId(userId)))
    .orderBy(desc(schema.accountAppeals.createdAt));
  return decryptRows(APPEAL_FIELDS, rows);
}

/**
 * Files an appeal for one of the user's own strikes / restrictions, or their
 * ban. One appeal per target; a denied one can't be re-filed.
 */
export async function createAppeal(userId: string, targetType: 'strike' | 'restriction' | 'ban', targetId: string | null, message: string): Promise<{ appeal: Appeal } | { error: string; status: number }> {
  const uid = normalizeId(userId);
  if (targetType === 'ban') {
    const user = await User.findById(userId);
    if (!user?.isBanned) return { error: 'Your account is not suspended', status: 400 };
    targetId = null;
  } else {
    if (!targetId) return { error: 'Pick what you are appealing', status: 400 };
    const table = targetType === 'strike' ? schema.accountStrikes : schema.accountRestrictions;
    const [row] = await db.select({ id: table.id, userId: table.userId }).from(table).where(eq(table.id, normalizeId(targetId))).limit(1);
    if (!row || normalizeId(row.userId) !== uid) return { error: 'Not found', status: 404 };
  }
  const existing = (await listAppealsForUser(userId)).find((a) => a.targetType === targetType && (targetId ? a.targetId === normalizeId(targetId) : !a.targetId));
  if (existing && existing.status === 'open') return { error: 'You already have an open appeal for this', status: 409 };
  if (existing && existing.status === 'denied') return { error: 'This appeal was already reviewed', status: 409 };
  const [appeal] = await db.insert(schema.accountAppeals).values({
    userId: uid,
    targetType,
    targetId: targetId ? normalizeId(targetId) : null,
    message: await encryptField(message),
  }).returning();
  return { appeal: await decryptRow(APPEAL_FIELDS, appeal) };
}

export class AppealDecisionError extends Error {
  constructor(message: string, readonly status = 403) {
    super(message);
  }
}

export async function getAppeal(appealId: string): Promise<Appeal | null> {
  const [appeal] = await db.select().from(schema.accountAppeals).where(eq(schema.accountAppeals.id, normalizeId(appealId))).limit(1);
  return decryptRow(APPEAL_FIELDS, appeal ?? null);
}

/** Staff decision. Approving lifts what was appealed (revokes the strike, lifts the restriction, unbans). */
export async function decideAppeal(appealId: string, approve: boolean, staffId: string, note: string | null): Promise<Appeal | null> {
  const appeal = await getAppeal(appealId);
  if (!appeal || appeal.status !== 'open') return null;
  // Claim it first so two reviewers can't both act on it.
  const [claimed] = await db.update(schema.accountAppeals)
    .set({ status: 'deciding', reviewedBy: normalizeId(staffId) })
    .where(and(eq(schema.accountAppeals.id, appeal.id), eq(schema.accountAppeals.status, 'open')))
    .returning();
  if (!claimed) return null;
  if (approve) {
    if (appeal.targetType === 'strike' && appeal.targetId) await revokeStrike(appeal.targetId, staffId, 'Appeal approved');
    if (appeal.targetType === 'restriction' && appeal.targetId) await liftRestriction(appeal.targetId, staffId);
    if (appeal.targetType === 'ban') {
      // Same rules as any unban (StaffRole.unban): e.g. only a super admin may
      // restore a staff account.
      try {
        const { StaffRole } = await import('@/lib/models/StaffRole');
        await StaffRole.unban(staffId, appeal.userId);
      } catch (err) {
        await db.update(schema.accountAppeals).set({ status: 'open', reviewedBy: null }).where(eq(schema.accountAppeals.id, appeal.id));
        throw new AppealDecisionError((err as Error)?.message || 'You cannot restore this account', (err as { status?: number }).status ?? 403);
      }
      await dropUserCache(appeal.userId);
      // Strikes that led to an automatic suspension stop counting too, or the
      // next strike would suspend again immediately.
      const active = (await listStrikes(appeal.userId)).filter((s) => isStrikeActive(s));
      for (const s of active) await revokeStrike(s.id, staffId, 'Suspension appeal approved');
    }
  }
  const [row] = await db.update(schema.accountAppeals)
    .set({ status: approve ? 'approved' : 'denied', staffNote: await encryptField(note?.slice(0, 1000) ?? null), reviewedBy: normalizeId(staffId), reviewedAt: new Date() })
    .where(eq(schema.accountAppeals.id, appeal.id))
    .returning();
  const { sendSystemDM } = await import('@/lib/services/systemNotify');
  void sendSystemDM(appeal.userId, [
    approve ? '**✅ Your appeal was approved**' : '**Your appeal was reviewed**',
    '',
    approve
      ? (appeal.targetType === 'ban' ? 'Your account has been restored. Welcome back!' : 'The action on your account has been removed.')
      : 'After review, the action on your account stays in place.',
    ...(note ? ['', `**Note from the Trust & Safety team:** ${note}`] : []),
  ].join('\n'), { kind: 'safety' }).catch(() => {});
  return decryptRow(APPEAL_FIELDS, row ?? null);
}

// ─── Staff queries ────────────────────────────────────────────────────────────

export async function listIncidents(filter: { status?: string; kind?: string; userId?: string; limit?: number }): Promise<Incident[]> {
  const conds: SQL[] = [];
  if (filter.status && filter.status !== 'all') conds.push(eq(schema.safetyIncidents.status, filter.status));
  if (filter.kind && filter.kind !== 'all') conds.push(eq(schema.safetyIncidents.kind, filter.kind));
  if (filter.userId) conds.push(eq(schema.safetyIncidents.userId, normalizeId(filter.userId)));
  let q = db.select().from(schema.safetyIncidents).$dynamic();
  if (conds.length) q = q.where(and(...conds));
  return decryptRows(INCIDENT_FIELDS, await q.orderBy(desc(schema.safetyIncidents.createdAt)).limit(Math.min(200, filter.limit ?? 100)));
}

export async function updateIncident(id: string, staffId: string, patch: { status?: string; notes?: string | null; ncmecReportId?: string | null }): Promise<Incident | null> {
  const set: Partial<typeof schema.safetyIncidents.$inferInsert> = { reviewedBy: normalizeId(staffId), reviewedAt: new Date() };
  if (patch.status) set.status = patch.status;
  if (patch.notes !== undefined) set.notes = await encryptField(patch.notes?.slice(0, 2000) ?? null);
  if (patch.ncmecReportId !== undefined) {
    set.ncmecReportId = patch.ncmecReportId?.slice(0, 100) ?? null;
    set.ncmecReportedAt = patch.ncmecReportId ? new Date() : null;
  }
  const [row] = await db.update(schema.safetyIncidents).set(set).where(eq(schema.safetyIncidents.id, normalizeId(id))).returning();
  return decryptRow(INCIDENT_FIELDS, row ?? null);
}

export async function listAppeals(status: string, limit = 100): Promise<Appeal[]> {
  let q = db.select().from(schema.accountAppeals).$dynamic();
  if (status && status !== 'all') q = q.where(eq(schema.accountAppeals.status, status));
  return decryptRows(APPEAL_FIELDS, await q.orderBy(desc(schema.accountAppeals.createdAt)).limit(Math.min(200, limit)));
}

export async function trustSafetyStats(): Promise<Record<string, number>> {
  const since = new Date(Date.now() - 30 * 24 * 3600_000);
  const count = async (q: Promise<Array<{ n: number }>>) => Number((await q.catch(() => [{ n: 0 }]))[0]?.n ?? 0);
  const [openIncidents, csam30d, scam30d, openAppeals, activeRestrictions, activeStrikes, hashes, suspended] = await Promise.all([
    count(db.select({ n: sql<number>`count(*)::int` }).from(schema.safetyIncidents).where(eq(schema.safetyIncidents.status, 'open'))),
    count(db.select({ n: sql<number>`count(*)::int` }).from(schema.safetyIncidents).where(and(eq(schema.safetyIncidents.kind, 'csam'), gt(schema.safetyIncidents.createdAt, since)))),
    count(db.select({ n: sql<number>`count(*)::int` }).from(schema.safetyIncidents).where(and(eq(schema.safetyIncidents.kind, 'scam_image'), gt(schema.safetyIncidents.createdAt, since)))),
    count(db.select({ n: sql<number>`count(*)::int` }).from(schema.accountAppeals).where(eq(schema.accountAppeals.status, 'open'))),
    count(db.select({ n: sql<number>`count(*)::int` }).from(schema.accountRestrictions).where(and(isNull(schema.accountRestrictions.liftedAt), gt(schema.accountRestrictions.until, new Date())))),
    count(db.select({ n: sql<number>`count(*)::int` }).from(schema.accountStrikes).where(and(isNull(schema.accountStrikes.revokedAt), or(isNull(schema.accountStrikes.expiresAt), gt(schema.accountStrikes.expiresAt, new Date()))!))),
    count(db.select({ n: sql<number>`count(*)::int` }).from(schema.scamImageHashes)),
    count(db.select({ n: sql<number>`count(*)::int` }).from(schema.users).where(eq(schema.users.isBanned, true))),
  ]);
  return { openIncidents, csam30d, scam30d, openAppeals, activeRestrictions, activeStrikes, hashes, suspended, photoDnaEnabled: photoDnaConfigured() ? 1 : 0 };
}

/** Basic user cards for staff lists. */
export async function userCards(ids: string[]): Promise<Map<string, { id: string; username: string; displayName: string | null; avatar: string | null; isBanned: boolean }>> {
  const unique = [...new Set(ids.filter(Boolean).map((i) => normalizeId(i)))];
  if (unique.length === 0) return new Map();
  const rows = await db.select({ id: schema.users.id, username: schema.users.username, displayName: schema.users.displayName, avatar: schema.users.avatar, isBanned: schema.users.isBanned })
    .from(schema.users).where(inArray(schema.users.id, unique));
  return new Map(rows.map((r) => [normalizeId(r.id), { ...r, displayName: r.displayName ?? null, avatar: r.avatar ?? null, isBanned: Boolean(r.isBanned) }]));
}

/** Owner of a strike / restriction (for the "not on your own record" checks). */
export async function recordOwner(kind: 'strike' | 'restriction', id: string): Promise<string | null> {
  const table = kind === 'strike' ? schema.accountStrikes : schema.accountRestrictions;
  const [row] = await db.select({ userId: table.userId }).from(table).where(eq(table.id, normalizeId(id))).limit(1);
  return row?.userId ?? null;
}

/** Staff search by username / display name prefix; minimal columns. */
export async function searchUsersForStaff(q: string) {
  const like = `${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  return db.select({ id: schema.users.id, username: schema.users.username, displayName: schema.users.displayName, avatar: schema.users.avatar, isBanned: schema.users.isBanned })
    .from(schema.users)
    .where(or(ilike(schema.users.username, like), ilike(schema.users.displayName, like)))
    .limit(20);
}
