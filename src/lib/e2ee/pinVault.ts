// Server half of the PIN backup (pin.ts), pure: everything that needs the
// pepper (E2EE_PIN_PEPPER, an environment secret that is never stored in the
// database) and the attempt-counting rules. The database keeps only
//   verifier_hash = HMAC-SHA-256(macKey, frame("serika-e2ee-pin-verifier-hash-v1", userId, verifier))
//   secret_enc    = base64(iv ‖ AES-256-GCM(encKey, iv, S, aad = frame("serika-e2ee-pin-secret-v1", userId)))
// with macKey / encKey derived from the pepper (HKDF, separate labels). A dump
// of the database without the pepper can neither test PIN guesses nor open S
// (and without S the bundle can't be opened even with the right PIN).
//
// Isomorphic (WebCrypto only, no env access); wrapped by
// src/lib/services/e2eePin.ts and unit-tested in tests/e2ee-pin.test.ts.
import { GCM_IV_BYTES, UUID_RE } from "./constants";
import { E2eeFormatError, b64ByteLength, concat, equalBytes, frame, fromB64, isBase64, randomBytes, toB64, type Bytes } from "./encoding";
import { PIN_MAX_ATTEMPTS, PIN_SECRET_BYTES, PIN_VERIFIER_BYTES } from "./pin";

export const PIN_VAULT_LABELS = {
  mac: "serika-e2ee-pin-pepper-mac-v1",
  enc: "serika-e2ee-pin-pepper-enc-v1",
  verifierHash: "serika-e2ee-pin-verifier-hash-v1",
  secret: "serika-e2ee-pin-secret-v1",
} as const;

/** The pepper must carry at least this much entropy. */
export const PIN_PEPPER_MIN_BYTES = 32;

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error("WebCrypto is not available");
  return s;
}

function uid(userId: string): string {
  if (typeof userId !== "string" || !UUID_RE.test(userId)) throw new E2eeFormatError("Bad user id");
  return userId.toLowerCase();
}

/** The pepper bytes from the environment value (standard or url-safe base64, ≥ 32 bytes); null when unusable. */
export function parsePinPepper(value: string | undefined | null): Bytes | null {
  if (typeof value !== "string") return null;
  const std = value.trim().replace(/-/g, "+").replace(/_/g, "/");
  const padded = std + "=".repeat((4 - (std.length % 4)) % 4);
  if (!isBase64(padded)) return null;
  const bytes = fromB64(padded);
  return bytes.byteLength >= PIN_PEPPER_MIN_BYTES ? bytes : null;
}

export interface PinVaultKeys {
  mac: CryptoKey;
  enc: CryptoKey;
}

/** HMAC and AES keys derived from the pepper (derive once per process). */
export async function pinVaultKeys(pepper: Uint8Array): Promise<PinVaultKeys> {
  if (pepper.byteLength < PIN_PEPPER_MIN_BYTES) throw new E2eeFormatError("The PIN pepper is too short");
  const copy = new Uint8Array(pepper.byteLength);
  copy.set(pepper);
  const hk = await subtle().importKey("raw", copy, "HKDF", false, ["deriveKey"]);
  copy.fill(0);
  const salt = new Uint8Array(32);
  const [mac, enc] = await Promise.all([
    subtle().deriveKey(
      { name: "HKDF", hash: "SHA-256", salt, info: frame(PIN_VAULT_LABELS.mac) },
      hk,
      { name: "HMAC", hash: "SHA-256", length: 256 },
      false,
      ["sign"],
    ),
    subtle().deriveKey(
      { name: "HKDF", hash: "SHA-256", salt, info: frame(PIN_VAULT_LABELS.enc) },
      hk,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    ),
  ]);
  return { mac, enc };
}

/** What the database stores instead of the verifier (base64). */
export async function pinVerifierHash(keys: PinVaultKeys, userId: string, verifierB64: string): Promise<string> {
  if (!isBase64(verifierB64) || b64ByteLength(verifierB64) !== PIN_VERIFIER_BYTES) throw new E2eeFormatError("Bad verifier");
  const mac = await subtle().sign("HMAC", keys.mac, frame(PIN_VAULT_LABELS.verifierHash, uid(userId), fromB64(verifierB64)));
  return toB64(new Uint8Array(mac));
}

/** Constant-time check of a presented verifier against the stored hash. */
export async function pinVerifierMatches(keys: PinVaultKeys, userId: string, verifierB64: string, storedHash: string | null | undefined): Promise<boolean> {
  if (!storedHash || !isBase64(storedHash)) return false;
  let presented: string;
  try {
    presented = await pinVerifierHash(keys, userId, verifierB64);
  } catch {
    return false;
  }
  return equalBytes(fromB64(presented), fromB64(storedHash));
}

/** A fresh 32-byte server secret S. */
export function newPinSecret(): Bytes {
  return randomBytes(PIN_SECRET_BYTES);
}

/** S encrypted under the pepper for the database (AAD binds the user). */
export async function sealPinSecret(keys: PinVaultKeys, userId: string, secret: Uint8Array): Promise<string> {
  if (secret.byteLength !== PIN_SECRET_BYTES) throw new E2eeFormatError("Bad server secret");
  const iv = randomBytes(GCM_IV_BYTES);
  const copy = new Uint8Array(secret.byteLength);
  copy.set(secret);
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv, additionalData: frame(PIN_VAULT_LABELS.secret, uid(userId)) }, keys.enc, copy));
  copy.fill(0);
  return toB64(concat(iv, ct));
}

/** S back from the database; null when it doesn't open (other user, other pepper, tampered). */
export async function openPinSecret(keys: PinVaultKeys, userId: string, sealed: string | null | undefined): Promise<Bytes | null> {
  if (!sealed || !isBase64(sealed) || b64ByteLength(sealed) !== GCM_IV_BYTES + PIN_SECRET_BYTES + 16) return null;
  const raw = fromB64(sealed);
  try {
    const plain = new Uint8Array(await subtle().decrypt(
      { name: "AES-GCM", iv: raw.slice(0, GCM_IV_BYTES), additionalData: frame(PIN_VAULT_LABELS.secret, uid(userId)) },
      keys.enc,
      raw.slice(GCM_IV_BYTES),
    ));
    return plain.byteLength === PIN_SECRET_BYTES ? plain : null;
  } catch {
    return null;
  }
}

/**
 * What a wrong / right PIN attempt leads to. `attemptsAfter` is the counter
 * after this attempt was reserved (the route increments it atomically
 * BEFORE checking, so parallel requests can never evaluate more than
 * PIN_MAX_ATTEMPTS guesses in total).
 */
export function pinAttemptOutcome(attemptsAfter: number, correct: boolean): { result: "ok" | "wrong" | "wiped"; attemptsLeft: number } {
  if (correct) return { result: "ok", attemptsLeft: PIN_MAX_ATTEMPTS };
  const left = Math.max(0, PIN_MAX_ATTEMPTS - attemptsAfter);
  return left === 0 ? { result: "wiped", attemptsLeft: 0 } : { result: "wrong", attemptsLeft: left };
}
