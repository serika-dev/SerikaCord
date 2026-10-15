// 6-digit PIN key backup (docs/architecture/e2ee.md "PIN backup"). The
// identity + backup private keys (what a passphrase restore or a device link
// yields) are sealed under a key that needs BOTH the PIN and a random 32-byte
// server secret S. The server hands S out only after the client proved the
// PIN (a verifier derived from it) and counts wrong attempts: after
// PIN_MAX_ATTEMPTS the server destroys S and the sealed bundle. The server
// stores only HMAC(pepper, verifier) and S encrypted under the pepper (an
// environment secret, never in the database), so a database dump alone allows
// no offline PIN guessing (pinVault.ts).
//
//   master   = PBKDF2-SHA-256(utf8(PIN ‖ ":" ‖ userId), salt 16 B, ≥ 600 000) → 32 B
//   verifier = HKDF-SHA-256(master, salt 0^32, frame("serika-e2ee-pin-verifier-v1", userId)) → 32 B
//   wrap     = HKDF-SHA-256(master, salt 0^32, frame("serika-e2ee-pin-wrap-v1", userId))     → 32 B
//   K        = HKDF-SHA-256(wrap ‖ S, salt 0^32, frame("serika-e2ee-pin-v1", userId))      → AES-256-GCM
//   bundle   = base64(iv ‖ AES-GCM(K, iv, {v, identity JWK, backup JWK},
//                aad = frame("serika-e2ee-pin-bundle-v1", userId, identityPub)))
//
// Isomorphic (WebCrypto only); unit-tested in tests/e2ee-pin.test.ts.
import { E2EE_VERSION, GCM_IV_BYTES, LIMITS, PBKDF2_SALT_BYTES, SIGNATURE_BYTES, UUID_RE } from "./constants";
import {
  E2eeFormatError,
  E2eeVerifyError,
  b64ByteLength,
  concat,
  frame,
  fromB64,
  fromUtf8,
  isBase64,
  randomBytes,
  toB64,
  utf8,
  type Bytes,
} from "./encoding";
import { publicKeyBytes, publicKeyFromJwk, signBytes, verifyBytes } from "./keys";
import type { BackupSecrets } from "./backup";

export const PIN_LABELS = {
  verifier: "serika-e2ee-pin-verifier-v1",
  wrap: "serika-e2ee-pin-wrap-v1",
  key: "serika-e2ee-pin-v1",
  bundle: "serika-e2ee-pin-bundle-v1",
  /** Identity-key signature authorising a new / changed PIN backup. */
  commit: "serika-e2ee-pin-commit-v1",
  /** Identity-key signature authorising removing a backup (PIN or passphrase). */
  remove: "serika-e2ee-pin-remove-v1",
  /** Binds a commit to the server secret it was sealed with. */
  secretCheck: "serika-e2ee-pin-secret-check-v1",
} as const;

export const PIN_LENGTH = 6;
export const PIN_PBKDF2_ITERATIONS = 600_000;
export const PIN_MAX_ITERATIONS = 5_000_000;
/** Wrong PIN attempts (in total, reset by a correct one) before the server destroys the PIN backup. */
export const PIN_MAX_ATTEMPTS = 10;
export const PIN_SECRET_BYTES = 32;
export const PIN_VERIFIER_BYTES = 32;
/** Clock skew accepted on signed removal requests. */
export const PIN_SIGNATURE_MAX_SKEW_MS = 10 * 60_000;

const ZERO_SALT = new Uint8Array(32) as Bytes;

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error("WebCrypto is not available");
  return s;
}

function checkUser(userId: string): string {
  if (typeof userId !== "string" || !UUID_RE.test(userId)) throw new E2eeFormatError("Bad user id");
  return userId.toLowerCase();
}

/** Exactly six ASCII digits. */
export function isValidPin(pin: unknown): pin is string {
  return typeof pin === "string" && /^[0-9]{6}$/.test(pin);
}

/**
 * PINs an attacker tries first (all one digit, straight runs, repeated
 * pairs / triples, mirrored halves, a few very common ones). With only
 * PIN_MAX_ATTEMPTS online guesses, refusing these is what matters most.
 */
export function isEasyPin(pin: string): boolean {
  if (!isValidPin(pin)) return true;
  const d = [...pin].map(Number);
  if (d.every((x) => x === d[0])) return true;
  const step = d[1] - d[0];
  if ((step === 1 || step === -1) && d.every((x, i) => i === 0 || x - d[i - 1] === step)) return true;
  if (pin.slice(0, 2).repeat(3) === pin) return true; // 121212
  if (pin.slice(0, 3).repeat(2) === pin) return true; // 123123
  if (pin[0] === pin[1] && pin[2] === pin[3] && pin[4] === pin[5]) return true; // 112233
  if (pin.slice(0, 3) === [...pin.slice(3)].reverse().join("")) return true; // 123321
  return ["111222", "159753", "147258", "258369", "741852", "963852", "696969", "007007", "101010", "202020", "199999", "131313"].includes(pin);
}

export interface PinKeys {
  /** Sent to the server to prove the PIN (it only stores an HMAC of it). */
  verifier: Bytes;
  /** Combined with the server secret to seal / open the bundle. Never leaves the device. */
  wrap: Bytes;
}

/** The PIN's two derived values (PBKDF2 then HKDF). Slow on purpose (≥ 600 000 iterations). */
export async function derivePinKeys(pin: string, userId: string, salt: Uint8Array, iterations: number): Promise<PinKeys> {
  if (!isValidPin(pin)) throw new E2eeFormatError("A PIN is 6 digits");
  const uid = checkUser(userId);
  if (salt.byteLength !== PBKDF2_SALT_BYTES) throw new E2eeFormatError("Bad PIN salt");
  if (!Number.isSafeInteger(iterations) || iterations < PIN_PBKDF2_ITERATIONS || iterations > PIN_MAX_ITERATIONS) {
    throw new E2eeFormatError("Bad PIN iteration count");
  }
  const s = new Uint8Array(salt.byteLength);
  s.set(salt);
  const base = await subtle().importKey("raw", utf8(`${pin}:${uid}`), "PBKDF2", false, ["deriveBits"]);
  const master = new Uint8Array(await subtle().deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: s, iterations }, base, 256));
  try {
    const hk = await subtle().importKey("raw", master, "HKDF", false, ["deriveBits"]);
    const [verifier, wrap] = await Promise.all([
      subtle().deriveBits({ name: "HKDF", hash: "SHA-256", salt: ZERO_SALT, info: frame(PIN_LABELS.verifier, uid) }, hk, 256),
      subtle().deriveBits({ name: "HKDF", hash: "SHA-256", salt: ZERO_SALT, info: frame(PIN_LABELS.wrap, uid) }, hk, 256),
    ]);
    return { verifier: new Uint8Array(verifier), wrap: new Uint8Array(wrap) };
  } finally {
    master.fill(0);
  }
}

async function bundleKey(wrap: Uint8Array, secret: Uint8Array, userId: string): Promise<CryptoKey> {
  if (wrap.byteLength !== 32) throw new E2eeFormatError("Bad PIN key");
  if (secret.byteLength !== PIN_SECRET_BYTES) throw new E2eeFormatError("Bad server secret");
  const ikm = concat(wrap, secret);
  try {
    const hk = await subtle().importKey("raw", ikm, "HKDF", false, ["deriveKey"]);
    return await subtle().deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: ZERO_SALT, info: frame(PIN_LABELS.key, checkUser(userId)) },
      hk,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  } finally {
    ikm.fill(0);
  }
}

function bundleAad(userId: string, identityPub: string): Bytes {
  return frame(PIN_LABELS.bundle, checkUser(userId), publicKeyBytes(identityPub));
}

/** Seal the identity + backup private keys under the PIN's wrap key and the server secret. */
export async function sealPinBundle(
  keys: PinKeys,
  secret: Uint8Array,
  userId: string,
  identityPub: string,
  secrets: BackupSecrets,
): Promise<string> {
  if (publicKeyFromJwk(secrets.identity) !== identityPub) throw new E2eeFormatError("The keys don't belong to this identity");
  publicKeyFromJwk(secrets.backup);
  const key = await bundleKey(keys.wrap, secret, userId);
  const iv = randomBytes(GCM_IV_BYTES);
  const body = utf8(JSON.stringify({ v: E2EE_VERSION, identity: secrets.identity, backup: secrets.backup }));
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv, additionalData: bundleAad(userId, identityPub) }, key, body));
  body.fill(0);
  return toB64(concat(iv, ct));
}

/** Open a PIN bundle. Throws E2eeVerifyError("pin") when anything doesn't match. */
export async function openPinBundle(
  keys: PinKeys,
  secret: Uint8Array,
  userId: string,
  identityPub: string,
  bundle: string,
): Promise<BackupSecrets> {
  if (!isPinBundle(bundle)) throw new E2eeFormatError("Bad PIN bundle");
  const raw = fromB64(bundle);
  const key = await bundleKey(keys.wrap, secret, userId);
  let plain: Uint8Array;
  try {
    plain = new Uint8Array(await subtle().decrypt(
      { name: "AES-GCM", iv: raw.slice(0, GCM_IV_BYTES), additionalData: bundleAad(userId, identityPub) },
      key,
      raw.slice(GCM_IV_BYTES),
    ));
  } catch {
    throw new E2eeVerifyError("pin", "The PIN backup couldn't be opened");
  }
  let parsed: { v?: unknown; identity?: unknown; backup?: unknown };
  try {
    parsed = JSON.parse(fromUtf8(plain));
  } catch {
    throw new E2eeFormatError("PIN backup is malformed");
  } finally {
    plain.fill(0);
  }
  if (parsed.v !== E2EE_VERSION) throw new E2eeFormatError("Unsupported PIN backup version");
  if (publicKeyFromJwk(parsed.identity) !== identityPub) throw new E2eeVerifyError("pin", "The PIN backup belongs to other keys");
  publicKeyFromJwk(parsed.backup);
  return { identity: parsed.identity as JsonWebKey, backup: parsed.backup as JsonWebKey };
}

// ─── Shapes the server checks ─────────────────────────────────────────────────

export function isPinBundle(value: unknown): value is string {
  return isBase64(value) && value.length <= LIMITS.maxBackupBlobB64 && b64ByteLength(value) >= GCM_IV_BYTES + 16 + 2;
}

export function isPinSalt(value: unknown): value is string {
  return isBase64(value) && b64ByteLength(value) === PBKDF2_SALT_BYTES;
}

export function isPinVerifier(value: unknown): value is string {
  return isBase64(value) && b64ByteLength(value) === PIN_VERIFIER_BYTES;
}

export function isPinSecret(value: unknown): value is string {
  return isBase64(value) && b64ByteLength(value) === PIN_SECRET_BYTES;
}

export function isPinIterations(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= PIN_PBKDF2_ITERATIONS && value <= PIN_MAX_ITERATIONS;
}

// ─── Commitments and signatures ───────────────────────────────────────────────

async function sha256(data: Uint8Array): Promise<Bytes> {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return new Uint8Array(await subtle().digest("SHA-256", copy));
}

/** Binds a commit to the server secret the bundle was sealed with (a second "begin" invalidates the first). */
export async function pinSecretCheck(secret: Uint8Array): Promise<string> {
  return toB64(await sha256(frame(PIN_LABELS.secretCheck, secret)));
}

export interface PinCommit {
  identityPub: string;
  salt: string;
  iterations: number;
  bundle: string;
  /** pinSecretCheck(S) of the secret the bundle was sealed with. */
  secretCheck: string;
}

/**
 * What the identity key signs to set or replace the PIN backup: only a device
 * holding the account's identity key can do it (a stolen session can't swap
 * the backup for one it knows the PIN of). The verifier is not signed (a
 * signature over it would be an offline oracle for PIN guesses).
 */
export async function pinCommitPayload(userId: string, c: PinCommit): Promise<Bytes> {
  if (!isPinSalt(c.salt) || !isPinIterations(c.iterations) || !isPinBundle(c.bundle) || !isBase64(c.secretCheck)) {
    throw new E2eeFormatError("Bad PIN commit");
  }
  return frame(
    PIN_LABELS.commit,
    checkUser(userId),
    publicKeyBytes(c.identityPub),
    fromB64(c.salt),
    String(c.iterations),
    await sha256(fromB64(c.bundle)),
    fromB64(c.secretCheck),
  );
}

export async function signPinCommit(identityPrivate: CryptoKey, userId: string, c: PinCommit): Promise<string> {
  return toB64(await signBytes(identityPrivate, await pinCommitPayload(userId, c)));
}

export async function verifyPinCommit(identityPub: string, userId: string, c: PinCommit, sig: unknown): Promise<boolean> {
  try {
    if (!isBase64(sig) || b64ByteLength(sig) !== SIGNATURE_BYTES) return false;
    return await verifyBytes(identityPub, fromB64(sig), await pinCommitPayload(userId, c));
  } catch {
    return false;
  }
}

/** Which recovery method a signed removal names. */
export type RecoveryMethod = "pin" | "passphrase";

export function recoveryRemovalPayload(userId: string, identityPub: string, method: RecoveryMethod, ts: number): Bytes {
  if (method !== "pin" && method !== "passphrase") throw new E2eeFormatError("Bad recovery method");
  if (!Number.isSafeInteger(ts) || ts <= 0) throw new E2eeFormatError("Bad time");
  return frame(PIN_LABELS.remove, checkUser(userId), publicKeyBytes(identityPub), method, String(ts));
}

export async function signRecoveryRemoval(identityPrivate: CryptoKey, userId: string, identityPub: string, method: RecoveryMethod, ts: number): Promise<string> {
  return toB64(await signBytes(identityPrivate, recoveryRemovalPayload(userId, identityPub, method, ts)));
}

/** A removal request signed by the identity key, made within PIN_SIGNATURE_MAX_SKEW_MS of `now`. */
export async function verifyRecoveryRemoval(
  identityPub: string,
  userId: string,
  method: RecoveryMethod,
  ts: unknown,
  sig: unknown,
  now: number = Date.now(),
): Promise<boolean> {
  if (typeof ts !== "number" || !Number.isSafeInteger(ts) || Math.abs(now - ts) > PIN_SIGNATURE_MAX_SKEW_MS) return false;
  try {
    if (!isBase64(sig) || b64ByteLength(sig) !== SIGNATURE_BYTES) return false;
    return await verifyBytes(identityPub, fromB64(sig), recoveryRemovalPayload(userId, identityPub, method, ts));
  } catch {
    return false;
  }
}

/** Remaining tries after `attempts` wrong ones (never negative). */
export function pinAttemptsLeft(attempts: number): number {
  return Math.max(0, PIN_MAX_ATTEMPTS - Math.max(0, Math.floor(attempts)));
}
