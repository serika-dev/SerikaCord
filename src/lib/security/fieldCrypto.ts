/**
 * Field-level encryption at rest: the pure, synchronous core.
 *
 * Every function here takes its keys explicitly so it can be unit tested
 * without a database. Server code uses the async wrappers in
 * `fieldEncryption.ts`, which load the keyring (platform key, plus an
 * optional FIELD_ENCRYPTION_KEY from the environment).
 *
 * Stored formats (AES-256-GCM, 12-byte IV, 16-byte tag, base64url payload):
 *   enc:<keyId>:<iv|tag|ciphertext>   randomized: the default for private text
 *   encd:<keyId>:<iv|tag|ciphertext>  deterministic (synthetic IV = HMAC of the
 *                                     plaintext): same input → same output, so
 *                                     a column can still be looked up by value.
 *                                     Use only for high-entropy secrets (tokens).
 *   { "enc": "enc:<keyId>:..." }      a whole JSON value (jsonb columns).
 *
 * Rows written before this existed are plaintext. Every reader is
 * legacy-tolerant: a value without the prefix is returned unchanged, and a
 * value that only *looks* sealed but does not authenticate is returned
 * unchanged too (someone may have typed "enc:..." as a note).
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const SEALED_RE = /^(enc|encd):([a-z0-9]{1,8}):([A-Za-z0-9_-]+)$/;

export const FIELD_PREFIX = 'enc:';
export const LOOKUP_PREFIX = 'encd:';

export interface FieldKey {
  /** Short id written into every value, so the right key is picked on read. */
  id: string;
  enc: Buffer;
  siv: Buffer;
}

export interface FieldKeyring {
  /** Key used for new writes. */
  primary: FieldKey;
  /** Every key that can still decrypt (includes `primary`). */
  keys: FieldKey[];
}

/** Derives independent encryption and synthetic-IV subkeys from one secret. */
export function deriveFieldKey(id: string, secret: Buffer | string): FieldKey {
  if (!/^[a-z0-9]{1,8}$/.test(id)) throw new Error(`Invalid field key id "${id}"`);
  const material = typeof secret === 'string' ? Buffer.from(secret, 'utf8') : secret;
  if (material.length < 16) throw new Error('Field key material is too short');
  return {
    id,
    enc: createHmac('sha256', material).update('serika/field-enc/v1').digest(),
    siv: createHmac('sha256', material).update('serika/field-siv/v1').digest(),
  };
}

export function makeKeyring(primary: FieldKey, ...older: FieldKey[]): FieldKeyring {
  const keys = [primary, ...older.filter((k) => k.id !== primary.id)];
  return { primary, keys };
}

function findKey(ring: FieldKeyring, id: string): FieldKey | undefined {
  return ring.keys.find((k) => k.id === id);
}

function seal(key: FieldKey, plaintext: string, deterministic: boolean): string {
  const prefix = deterministic ? LOOKUP_PREFIX : FIELD_PREFIX;
  const data = Buffer.from(plaintext, 'utf8');
  const iv = deterministic
    ? createHmac('sha256', key.siv).update(data).digest().subarray(0, IV_LENGTH)
    : randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key.enc, iv);
  // Bind the mode and key id, so a value can't be relabelled.
  cipher.setAAD(Buffer.from(`${prefix}${key.id}`, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${prefix}${key.id}:${Buffer.concat([iv, tag, ciphertext]).toString('base64url')}`;
}

/** True when the value has the sealed shape (it may still fail to decrypt). */
export function looksSealed(value: unknown): value is string {
  return typeof value === 'string' && SEALED_RE.test(value);
}

/** Decrypts a sealed value; null when it is not sealed or does not authenticate. */
export function openSealed(ring: FieldKeyring, value: string): string | null {
  const m = SEALED_RE.exec(value);
  if (!m) return null;
  const [, mode, keyId, payload] = m;
  const key = findKey(ring, keyId);
  if (!key) return null;
  try {
    const raw = Buffer.from(payload, 'base64url');
    if (raw.length < IV_LENGTH + TAG_LENGTH) return null;
    const iv = raw.subarray(0, IV_LENGTH);
    const tag = raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const ciphertext = raw.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, key.enc, iv);
    decipher.setAAD(Buffer.from(`${mode}:${keyId}`, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** True when the value is sealed and decrypts with this keyring. */
export function isSealedField(ring: FieldKeyring, value: unknown): value is string {
  return looksSealed(value) && openSealed(ring, value) !== null;
}

/** Randomized encryption. Idempotent: an already-sealed value is kept as is. */
export function sealField(ring: FieldKeyring, plaintext: string): string {
  if (!plaintext) return plaintext;
  if (isSealedField(ring, plaintext)) return plaintext;
  return seal(ring.primary, plaintext, false);
}

/**
 * Deterministic encryption for values that are looked up by equality
 * (tokens). Idempotent like `sealField`.
 */
export function sealLookupField(ring: FieldKeyring, plaintext: string): string {
  if (!plaintext) return plaintext;
  if (isSealedField(ring, plaintext)) return plaintext;
  return seal(ring.primary, plaintext, true);
}

/**
 * Every stored form a lookup value may have: its deterministic ciphertext
 * under each key, plus the legacy plaintext. Query with `inArray(column, …)`.
 *
 * An input that itself looks sealed never matches as "legacy plaintext":
 * otherwise someone who can read the column could present the stored
 * ciphertext as the token.
 */
export function lookupCandidates(ring: FieldKeyring, plaintext: string): string[] {
  if (!plaintext) return [plaintext];
  const out = ring.keys.map((k) => seal(k, plaintext, true));
  if (!looksSealed(plaintext)) out.push(plaintext);
  return [...new Set(out)];
}

/** Legacy-tolerant read: sealed → plaintext, anything else unchanged. */
export function revealField<T>(ring: FieldKeyring, value: T): T {
  if (!looksSealed(value)) return value;
  const plain = openSealed(ring, value);
  return (plain ?? value) as T;
}

// ─── JSON values (jsonb columns) ─────────────────────────────────────────────

export type SealedJson = { enc: string };

/** A wrapped JSON value: exactly `{ enc: "enc:..." }`. Legacy objects never match. */
export function isSealedJson(value: unknown): value is SealedJson {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 1 && keys[0] === 'enc' && looksSealed((value as SealedJson).enc);
}

export function sealJson(ring: FieldKeyring, value: unknown): unknown {
  if (value === undefined || value === null) return value;
  if (isSealedJson(value) && openSealed(ring, value.enc) !== null) return value;
  return { enc: seal(ring.primary, JSON.stringify(value), false) } satisfies SealedJson;
}

/**
 * Unwraps a sealed JSON value; legacy (plain) JSON is returned unchanged.
 * A wrapper that can't be decrypted yields `fallback`.
 */
export function openJson<T = unknown>(ring: FieldKeyring, value: unknown, fallback: T | null = null): T | null {
  if (!isSealedJson(value)) return value as T;
  const plain = openSealed(ring, value.enc);
  if (plain === null) return fallback;
  try {
    return JSON.parse(plain) as T;
  } catch {
    return fallback;
  }
}

// ─── Secret keys inside a JSON object ────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Seals only the listed keys of an object (e.g. OAuth tokens in connection
 * metadata) and leaves the rest readable, so flags like `oauthVerified` keep
 * working in SQL and in code that never decrypts.
 */
export function sealKeys<T>(ring: FieldKeyring, obj: T, keys: readonly string[]): T {
  if (!isPlainObject(obj)) return obj;
  let out: Record<string, unknown> | null = null;
  for (const key of keys) {
    const v = obj[key];
    if (v === undefined || v === null || v === '') continue;
    const sealed = typeof v === 'string' ? sealField(ring, v) : sealJson(ring, v);
    if (sealed !== v) {
      out ??= { ...obj };
      out[key] = sealed;
    }
  }
  return (out ?? obj) as T;
}

export function openKeys<T>(ring: FieldKeyring, obj: T, keys: readonly string[]): T {
  if (!isPlainObject(obj)) return obj;
  let out: Record<string, unknown> | null = null;
  for (const key of keys) {
    const v = obj[key];
    let opened: unknown = v;
    if (looksSealed(v)) opened = revealField(ring, v);
    else if (isSealedJson(v)) opened = openJson(ring, v);
    if (opened !== v) {
      out ??= { ...obj };
      out[key] = opened;
    }
  }
  return (out ?? obj) as T;
}

// ─── Whole rows (used by the models) ─────────────────────────────────────────

/**
 * Which columns of a table are encrypted, by camelCase property name.
 *  - text:       randomized string encryption
 *  - lookup:     deterministic string encryption (queried by equality)
 *  - json:       whole jsonb value wrapped as { enc }
 *  - secretKeys: jsonb object whose listed keys are sealed
 */
export interface FieldSpec {
  text?: readonly string[];
  lookup?: readonly string[];
  json?: readonly string[];
  secretKeys?: Readonly<Record<string, readonly string[]>>;
}

/** Encrypts the spec's columns present in `data` (partial updates are fine). */
export function sealRow<T>(ring: FieldKeyring, spec: FieldSpec, data: T): T {
  if (!isPlainObject(data)) return data;
  const out: Record<string, unknown> = { ...data };
  for (const col of spec.text ?? []) {
    if (typeof out[col] === 'string') out[col] = sealField(ring, out[col] as string);
  }
  for (const col of spec.lookup ?? []) {
    if (typeof out[col] === 'string') out[col] = sealLookupField(ring, out[col] as string);
  }
  for (const col of spec.json ?? []) {
    if (col in out) out[col] = sealJson(ring, out[col]);
  }
  for (const [col, keys] of Object.entries(spec.secretKeys ?? {})) {
    if (col in out) out[col] = sealKeys(ring, out[col], keys);
  }
  return out as T;
}

/** True when any spec column of the row holds sealed data (skip the keyring otherwise). */
export function rowHasSealed(spec: FieldSpec, row: unknown): boolean {
  if (!isPlainObject(row)) return false;
  for (const col of [...(spec.text ?? []), ...(spec.lookup ?? [])]) {
    if (looksSealed(row[col])) return true;
  }
  for (const col of spec.json ?? []) {
    if (isSealedJson(row[col])) return true;
  }
  for (const [col, keys] of Object.entries(spec.secretKeys ?? {})) {
    const obj = row[col];
    if (isPlainObject(obj) && keys.some((k) => looksSealed(obj[k]) || isSealedJson(obj[k]))) return true;
  }
  return false;
}

/** Decrypts the spec's columns; legacy plaintext passes through. */
export function openRow<T>(ring: FieldKeyring, spec: FieldSpec, row: T): T {
  if (!rowHasSealed(spec, row)) return row;
  const out: Record<string, unknown> = { ...(row as Record<string, unknown>) };
  for (const col of [...(spec.text ?? []), ...(spec.lookup ?? [])]) {
    out[col] = revealField(ring, out[col]);
  }
  for (const col of spec.json ?? []) {
    out[col] = openJson(ring, out[col]);
  }
  for (const [col, keys] of Object.entries(spec.secretKeys ?? {})) {
    out[col] = openKeys(ring, out[col], keys);
  }
  return out as T;
}
