/**
 * Field-level encryption at rest for sensitive columns (tokens, private notes,
 * appeal text, IPs, ...). Server only. See `fieldCrypto.ts` for the formats
 * and docs/architecture/security.md for what is encrypted where.
 *
 * Keys:
 *  - "p": derived from the platform key (platform_settings.encryption_key,
 *    the same key message content uses). Always available.
 *  - "e1": derived from FIELD_ENCRYPTION_KEY when that env var is set (32+
 *    chars). It then becomes the key for new writes, so a database dump alone
 *    no longer decrypts new values. Once set it must never be removed or
 *    changed, or every value written with it becomes unreadable.
 *
 * Reads are legacy-tolerant: plaintext rows written before encryption pass
 * through unchanged. Reads that find no sealed value never load the keyring.
 */
import {
  deriveFieldKey,
  lookupCandidates,
  makeKeyring,
  openJson,
  openKeys,
  openRow,
  revealField,
  rowHasSealed,
  sealField,
  sealJson,
  sealKeys,
  sealLookupField,
  sealRow,
  looksSealed,
  isSealedJson,
  type FieldKey,
  type FieldKeyring,
  type FieldSpec,
} from './fieldCrypto';

export type { FieldSpec } from './fieldCrypto';

const ENV_KEY_ID = 'e1';
const PLATFORM_KEY_ID = 'p';

let ringPromise: Promise<FieldKeyring> | null = null;

function envKey(): FieldKey | null {
  const raw = process.env.FIELD_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  if (raw.length < 32) {
    console.error('[field-encryption] FIELD_ENCRYPTION_KEY is shorter than 32 characters; ignoring it.');
    return null;
  }
  return deriveFieldKey(ENV_KEY_ID, raw);
}

async function loadKeyring(): Promise<FieldKeyring> {
  const { getStorageKeyMaterial } = await import('./encryption');
  const platform = deriveFieldKey(PLATFORM_KEY_ID, await getStorageKeyMaterial());
  const env = envKey();
  return env ? makeKeyring(env, platform) : makeKeyring(platform);
}

/** The process keyring; a failed load is retried on the next call. */
export function getFieldKeyring(): Promise<FieldKeyring> {
  if (!ringPromise) {
    ringPromise = loadKeyring().catch((err) => {
      ringPromise = null;
      throw err;
    });
  }
  return ringPromise;
}

// ─── Rollout switch ──────────────────────────────────────────────────────────
// Canary and production share one database. Reads always understand both
// plaintext and ciphertext, but WRITES only encrypt once
// FIELD_ENCRYPTION_WRITES=1 is set — turn it on after production runs a
// release with this code, otherwise production can't read what canary wrote
// (bot/webhook tokens, push tokens, notes, ...).
export function fieldEncryptionWritesEnabled(): boolean {
  return process.env.FIELD_ENCRYPTION_WRITES === '1';
}

// ─── Strings ─────────────────────────────────────────────────────────────────

/** Randomized encryption of a private string; null/undefined/'' pass through. */
export async function encryptField<T extends string | null | undefined>(value: T): Promise<T> {
  if (typeof value !== 'string' || !value || !fieldEncryptionWritesEnabled()) return value;
  return sealField(await getFieldKeyring(), value) as T;
}

/** Deterministic encryption for a secret that is looked up by value. */
export async function encryptLookupField<T extends string | null | undefined>(value: T): Promise<T> {
  if (typeof value !== 'string' || !value || !fieldEncryptionWritesEnabled()) return value;
  return sealLookupField(await getFieldKeyring(), value) as T;
}

/** Stored forms to match when looking a lookup field up: ciphertexts + legacy plaintext. */
export async function fieldLookupCandidates(value: string): Promise<string[]> {
  return lookupCandidates(await getFieldKeyring(), value);
}

/** Legacy-tolerant decrypt: sealed → plaintext, anything else unchanged. */
export async function decryptField<T>(value: T): Promise<T> {
  if (!looksSealed(value)) return value;
  return revealField(await getFieldKeyring(), value);
}

// ─── JSON ────────────────────────────────────────────────────────────────────

/** Wraps a whole JSON value as { enc: "<ciphertext>" } for a jsonb column. */
export async function encryptJsonForStorage(value: unknown): Promise<unknown> {
  if (value === undefined || value === null || !fieldEncryptionWritesEnabled()) return value;
  return sealJson(await getFieldKeyring(), value);
}

/** Unwraps { enc } values; legacy plain JSON is returned unchanged. */
export async function decryptJsonFromStorage<T = unknown>(value: unknown, fallback: T | null = null): Promise<T | null> {
  if (!isSealedJson(value)) return value as T;
  return openJson<T>(await getFieldKeyring(), value, fallback);
}

/** Seals only `keys` of a JSON object, leaving the other keys readable. */
export async function encryptSecretKeys<T>(obj: T, keys: readonly string[]): Promise<T> {
  if (!fieldEncryptionWritesEnabled() || !obj || typeof obj !== 'object' || !keys.some((k) => (obj as Record<string, unknown>)[k] != null)) return obj;
  return sealKeys(await getFieldKeyring(), obj, keys);
}

export async function decryptSecretKeys<T>(obj: T, keys: readonly string[]): Promise<T> {
  if (!rowHasSealed({ secretKeys: { v: keys } }, { v: obj })) return obj;
  return openKeys(await getFieldKeyring(), obj, keys);
}

// ─── Rows (models) ───────────────────────────────────────────────────────────

function touchesSpec(spec: FieldSpec, data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const cols = [...(spec.text ?? []), ...(spec.lookup ?? []), ...(spec.json ?? []), ...Object.keys(spec.secretKeys ?? {})];
  return cols.some((c) => (data as Record<string, unknown>)[c] != null);
}

/** Encrypts the spec's columns present in `data` (insert values or a partial update). */
export async function encryptRow<T>(spec: FieldSpec, data: T): Promise<T> {
  if (!fieldEncryptionWritesEnabled() || !touchesSpec(spec, data)) return data;
  return sealRow(await getFieldKeyring(), spec, data);
}

export async function decryptRow<T>(spec: FieldSpec, row: T): Promise<T> {
  if (!row || !rowHasSealed(spec, row)) return row;
  return openRow(await getFieldKeyring(), spec, row);
}

export async function decryptRows<T>(spec: FieldSpec, rows: T[]): Promise<T[]> {
  if (!rows.some((r) => rowHasSealed(spec, r))) return rows;
  const ring = await getFieldKeyring();
  return rows.map((r) => openRow(ring, spec, r));
}
