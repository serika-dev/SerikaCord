// Server side of the 6-digit PIN key backup (docs/architecture/e2ee.md "PIN
// backup"; crypto in lib/e2ee/pin.ts + pinVault.ts). Needs E2EE_PIN_PEPPER
// (32+ random bytes, base64): without it every PIN route answers 503 and
// clients fall back to the recovery passphrase / device linking. Never change
// the pepper once set: every stored PIN backup becomes unusable.
import { and, eq, isNotNull, lt, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { normalizeId } from '@/lib/db/normalizeId';
import { equalBytes, fromB64, toB64 } from '@/lib/e2ee/encoding';
import {
  PIN_MAX_ATTEMPTS,
  isPinBundle,
  isPinIterations,
  isPinSalt,
  isPinVerifier,
  pinAttemptsLeft,
  pinSecretCheck,
  verifyPinCommit,
  type PinCommit,
} from '@/lib/e2ee/pin';
import {
  newPinSecret,
  openPinSecret,
  parsePinPepper,
  pinAttemptOutcome,
  pinVaultKeys,
  pinVerifierHash,
  pinVerifierMatches,
  sealPinSecret,
  type PinVaultKeys,
} from '@/lib/e2ee/pinVault';
import { e2eeEnabled, ensureE2eeSchema, getIdentity } from '@/lib/services/e2ee';

/** How long a secret from /pin/begin waits for /pin/commit. */
const PENDING_TTL_MS = 10 * 60_000;

export const PIN_UNAVAILABLE_ERROR = 'PIN backups are not available right now. Use your recovery passphrase or another device.';

const g = globalThis as unknown as { __e2eePinVault?: { pepper: string; keys: Promise<PinVaultKeys> } | null };

/** The pepper-derived keys, or null when E2EE_PIN_PEPPER is missing / too short (never a weaker fallback). */
function vault(): Promise<PinVaultKeys> | null {
  const raw = process.env.E2EE_PIN_PEPPER;
  if (g.__e2eePinVault && g.__e2eePinVault.pepper === raw) return g.__e2eePinVault.keys;
  const pepper = parsePinPepper(raw);
  if (!pepper) {
    g.__e2eePinVault = null;
    return null;
  }
  const keys = pinVaultKeys(pepper);
  pepper.fill(0);
  g.__e2eePinVault = { pepper: raw!, keys };
  return keys;
}

/** PIN backups can be used: E2EE is on and the pepper is configured. */
export function pinAvailable(): boolean {
  return e2eeEnabled() && vault() !== null;
}

export type PinRow = typeof schema.e2eePinBackups.$inferSelect;

export async function getPinRow(userId: string): Promise<PinRow | null> {
  const [row] = await db
    .select()
    .from(schema.e2eePinBackups)
    .where(eq(schema.e2eePinBackups.userId, normalizeId(userId)))
    .limit(1)
    .catch(() => [] as PinRow[]);
  return row ?? null;
}

/** A usable PIN backup for the account's current identity key. */
export function pinIsSet(row: PinRow | null, identityPub: string | null | undefined): boolean {
  return Boolean(row && identityPub && row.identityPub === identityPub && row.bundle && row.secretEnc && row.verifierHash && row.salt && row.iterations);
}

/** What /status tells the client about the PIN. */
export function pinSummary(row: PinRow | null, identityPub: string | null | undefined) {
  const set = pinIsSet(row, identityPub);
  return {
    available: pinAvailable(),
    set,
    attemptsLeft: set ? pinAttemptsLeft(row!.attempts) : null,
    // The backup was destroyed after too many wrong PINs (until a new one is set).
    lockedAt: !set && row?.lockedAt ? row.lockedAt : null,
  };
}

export type PinResult<T> = ({ ok: true } & T) | { ok: false; status: number; error: string; code?: string; attemptsLeft?: number };

/** Step 1 of setting / changing the PIN: a fresh server secret S (kept pending, encrypted, 10 minutes). */
export async function beginPin(userId: string): Promise<PinResult<{ secret: string; expiresAt: number }>> {
  const keys = vault();
  if (!keys || !e2eeEnabled()) return { ok: false, status: 503, error: PIN_UNAVAILABLE_ERROR, code: 'e2ee_pin_unavailable' };
  await ensureE2eeSchema();
  const uid = normalizeId(userId);
  const identity = await getIdentity(uid);
  if (!identity) return { ok: false, status: 409, error: 'Set up encryption first', code: 'e2ee_no_identity' };
  const secret = newPinSecret();
  const sealed = await sealPinSecret(await keys, uid, secret);
  const expiresAt = Date.now() + PENDING_TTL_MS;
  const now = new Date();
  await db.insert(schema.e2eePinBackups)
    .values({ userId: uid, pendingSecretEnc: sealed, pendingExpiresAt: new Date(expiresAt), createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.e2eePinBackups.userId,
      set: { pendingSecretEnc: sealed, pendingExpiresAt: new Date(expiresAt), updatedAt: now },
    });
  const out = toB64(secret);
  secret.fill(0);
  return { ok: true, secret: out, expiresAt };
}

export interface PinCommitBody extends PinCommit {
  verifier: string;
  sig: string;
}

/**
 * Step 2: store the bundle the client sealed with S. Authorised by the
 * account's identity key (a signature over the commit), bound to the current
 * identity and to the pending secret (a second begin invalidates the first).
 */
export async function commitPin(userId: string, body: PinCommitBody): Promise<PinResult<{ attemptsLeft: number }>> {
  const keys = vault();
  if (!keys || !e2eeEnabled()) return { ok: false, status: 503, error: PIN_UNAVAILABLE_ERROR, code: 'e2ee_pin_unavailable' };
  if (!isPinSalt(body.salt) || !isPinIterations(body.iterations) || !isPinBundle(body.bundle) || !isPinVerifier(body.verifier) || typeof body.secretCheck !== 'string') {
    return { ok: false, status: 400, error: 'Invalid PIN backup' };
  }
  await ensureE2eeSchema();
  const uid = normalizeId(userId);
  const identity = await getIdentity(uid);
  if (!identity || identity.identityPub !== body.identityPub) {
    return { ok: false, status: 409, error: 'Your encryption keys changed. Reload and try again.', code: 'e2ee_identity_changed' };
  }
  const commit: PinCommit = { identityPub: body.identityPub, salt: body.salt, iterations: body.iterations, bundle: body.bundle, secretCheck: body.secretCheck };
  if (!(await verifyPinCommit(identity.identityPub, uid, commit, body.sig))) {
    return { ok: false, status: 403, error: 'This PIN backup was not signed by your encryption keys' };
  }
  const row = await getPinRow(uid);
  const vk = await keys;
  const pending = row?.pendingSecretEnc && row.pendingExpiresAt && row.pendingExpiresAt.getTime() > Date.now()
    ? await openPinSecret(vk, uid, row.pendingSecretEnc)
    : null;
  if (!row || !pending) return { ok: false, status: 409, error: 'This PIN setup expired. Try again.', code: 'e2ee_pin_expired' };
  const check = await pinSecretCheck(pending);
  pending.fill(0);
  if (!equalBytes(fromB64(check), fromB64(body.secretCheck))) {
    return { ok: false, status: 409, error: 'This PIN setup was replaced by another one. Try again.', code: 'e2ee_pin_expired' };
  }
  const verifierHash = await pinVerifierHash(vk, uid, body.verifier);
  const now = new Date();
  // Compare-and-set on the pending secret: two tabs committing at once can't mix their halves.
  const [saved] = await db.update(schema.e2eePinBackups)
    .set({
      identityPub: body.identityPub,
      salt: body.salt,
      iterations: body.iterations,
      bundle: body.bundle,
      verifierHash,
      secretEnc: row.pendingSecretEnc,
      pendingSecretEnc: null,
      pendingExpiresAt: null,
      attempts: 0,
      lockedAt: null,
      updatedAt: now,
    })
    .where(and(eq(schema.e2eePinBackups.userId, uid), eq(schema.e2eePinBackups.pendingSecretEnc, row.pendingSecretEnc!)))
    .returning({ userId: schema.e2eePinBackups.userId });
  if (!saved) return { ok: false, status: 409, error: 'This PIN setup was replaced by another one. Try again.', code: 'e2ee_pin_expired' };
  return { ok: true, attemptsLeft: PIN_MAX_ATTEMPTS };
}

/** The PIN backup's public parameters (salt, iterations) for deriving the verifier. */
export async function pinParams(userId: string): Promise<PinResult<{ salt: string; iterations: number; attemptsLeft: number; identityPub: string }>> {
  if (!vault() || !e2eeEnabled()) return { ok: false, status: 503, error: PIN_UNAVAILABLE_ERROR, code: 'e2ee_pin_unavailable' };
  await ensureE2eeSchema();
  const uid = normalizeId(userId);
  const [identity, row] = await Promise.all([getIdentity(uid), getPinRow(uid)]);
  if (!identity || !pinIsSet(row, identity.identityPub)) {
    return row?.lockedAt
      ? { ok: false, status: 410, error: 'Your PIN backup was reset after too many wrong attempts.', code: 'e2ee_pin_locked' }
      : { ok: false, status: 404, error: 'No PIN backup', code: 'e2ee_no_pin' };
  }
  return { ok: true, salt: row!.salt!, iterations: row!.iterations!, attemptsLeft: pinAttemptsLeft(row!.attempts), identityPub: identity.identityPub };
}

/** Too many wrong PINs: destroy the bundle and S (once), and tell the user. */
async function wipeAfterLockout(uid: string): Promise<void> {
  const t = schema.e2eePinBackups;
  const [wiped] = await db.update(t)
    .set({ bundle: null, secretEnc: null, verifierHash: null, salt: null, iterations: null, lockedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(t.userId, uid), isNotNull(t.bundle)))
    .returning({ userId: t.userId });
  if (!wiped) return;
  void (async () => {
    const { sendSystemDM } = await import('@/lib/services/systemNotify');
    await sendSystemDM(
      uid,
      '**Too many wrong PIN attempts: your encrypted-message PIN backup was reset.**\n\n' +
        'Your devices that are already set up keep working, and so does your recovery passphrase if you set one. ' +
        'Set a new PIN in **User Settings → Encryption**.\n\nIf this wasn\'t you, change your account password.',
      { kind: 'safety' },
    );
    const { fanoutToUsers } = await import('@/lib/api/activity');
    await fanoutToUsers({ userIds: [uid] }, { type: 'e2ee_keys', userId: uid });
  })().catch((err) => console.warn('[e2ee] PIN lockout notice failed:', (err as Error)?.message ?? err));
}

/**
 * Check a PIN verifier. An attempt is reserved atomically BEFORE the check
 * (attempts + 1 where attempts < max), so parallel requests can never test
 * more than PIN_MAX_ATTEMPTS guesses in total; a correct PIN resets the
 * counter and returns S + the bundle; the attempt that reaches the limit
 * wipes the backup.
 */
export async function unlockPin(userId: string, verifier: string): Promise<PinResult<{ secret: string; bundle: string; salt: string; iterations: number; identityPub: string }>> {
  const keys = vault();
  if (!keys || !e2eeEnabled()) return { ok: false, status: 503, error: PIN_UNAVAILABLE_ERROR, code: 'e2ee_pin_unavailable' };
  if (!isPinVerifier(verifier)) return { ok: false, status: 400, error: 'Invalid PIN' };
  await ensureE2eeSchema();
  const uid = normalizeId(userId);
  const identity = await getIdentity(uid);
  if (!identity) return { ok: false, status: 404, error: 'No PIN backup', code: 'e2ee_no_pin' };
  const t = schema.e2eePinBackups;
  const [reserved] = await db.update(t)
    .set({ attempts: sql`${t.attempts} + 1`, updatedAt: new Date() })
    .where(and(
      eq(t.userId, uid),
      eq(t.identityPub, identity.identityPub),
      isNotNull(t.bundle),
      isNotNull(t.secretEnc),
      isNotNull(t.verifierHash),
      lt(t.attempts, PIN_MAX_ATTEMPTS),
    ))
    .returning({ attempts: t.attempts, verifierHash: t.verifierHash, secretEnc: t.secretEnc, bundle: t.bundle, salt: t.salt, iterations: t.iterations });
  if (!reserved) {
    const row = await getPinRow(uid);
    if (row && pinIsSet(row, identity.identityPub) && row.attempts >= PIN_MAX_ATTEMPTS) {
      // Reached the limit without being wiped (crash in between): wipe now.
      await wipeAfterLockout(uid);
      return { ok: false, status: 410, error: 'Your PIN backup was reset after too many wrong attempts.', code: 'e2ee_pin_locked', attemptsLeft: 0 };
    }
    return row?.lockedAt
      ? { ok: false, status: 410, error: 'Your PIN backup was reset after too many wrong attempts.', code: 'e2ee_pin_locked', attemptsLeft: 0 }
      : { ok: false, status: 404, error: 'No PIN backup', code: 'e2ee_no_pin' };
  }
  const vk = await keys;
  const correct = await pinVerifierMatches(vk, uid, verifier, reserved.verifierHash);
  const outcome = pinAttemptOutcome(reserved.attempts, correct);
  if (outcome.result === 'ok') {
    const secret = await openPinSecret(vk, uid, reserved.secretEnc);
    if (!secret) return { ok: false, status: 500, error: 'The PIN backup could not be opened. Use another device or your recovery passphrase.' };
    await db.update(t).set({ attempts: 0, updatedAt: new Date() }).where(eq(t.userId, uid));
    const out = toB64(secret);
    secret.fill(0);
    return { ok: true, secret: out, bundle: reserved.bundle!, salt: reserved.salt!, iterations: reserved.iterations!, identityPub: identity.identityPub };
  }
  if (outcome.result === 'wiped') {
    await wipeAfterLockout(uid);
    return { ok: false, status: 410, error: 'Too many wrong PINs. Your PIN backup was reset.', code: 'e2ee_pin_locked', attemptsLeft: 0 };
  }
  return { ok: false, status: 403, error: 'Wrong PIN', code: 'e2ee_pin_wrong', attemptsLeft: outcome.attemptsLeft };
}

/** Drop the PIN backup (removed by the user, or encryption reset). The row stays, emptied. */
export async function clearPinBackup(userId: string): Promise<void> {
  const t = schema.e2eePinBackups;
  await db.update(t)
    .set({
      identityPub: null, salt: null, iterations: null, bundle: null, verifierHash: null, secretEnc: null,
      pendingSecretEnc: null, pendingExpiresAt: null, attempts: 0, lockedAt: null, updatedAt: new Date(),
    })
    .where(eq(t.userId, normalizeId(userId)))
    .catch((err) => console.warn('[e2ee] Clearing a PIN backup failed:', (err as Error)?.message ?? err));
}
