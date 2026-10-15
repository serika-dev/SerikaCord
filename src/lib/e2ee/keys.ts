// Key generation, import/export and device signing (WebCrypto, P-256).
//
//   identity key  ECDSA P-256   one per user, signs that user's device keys
//   backup key    ECDH  P-256   one per user, every message key is also wrapped to it
//   device keys   ECDH  P-256 (encryption) + ECDSA P-256 (signing), one per device
//
// Public keys travel as raw uncompressed points (65 bytes) in base64; private
// keys that must be backed up (identity, backup) are exported as JWK.
import {
  DEVICE_ID_RE,
  LABELS,
  PUBLIC_KEY_BYTES,
  SIGNATURE_BYTES,
  UUID_RE,
} from "./constants";
import {
  E2eeFormatError,
  frame,
  fromB64,
  isBase64,
  randomBytes,
  toB64,
  toB64Url,
  type Bytes,
} from "./encoding";

const ECDSA = { name: "ECDSA", namedCurve: "P-256" } as const;
const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;
const SIGN_PARAMS = { name: "ECDSA", hash: "SHA-256" } as const;

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error("WebCrypto is not available");
  return s;
}

/** Whether this runtime can run the E2EE core at all. */
export function isE2eeCryptoAvailable(): boolean {
  return Boolean(globalThis.crypto?.subtle && globalThis.crypto.getRandomValues);
}

export function generateIdentityKeyPair(extractable = true): Promise<CryptoKeyPair> {
  return subtle().generateKey(ECDSA, extractable, ["sign", "verify"]) as Promise<CryptoKeyPair>;
}

export function generateBackupKeyPair(extractable = true): Promise<CryptoKeyPair> {
  return subtle().generateKey(ECDH, extractable, ["deriveBits"]) as Promise<CryptoKeyPair>;
}

export function generateEphemeralKeyPair(): Promise<CryptoKeyPair> {
  return subtle().generateKey(ECDH, false, ["deriveBits"]) as Promise<CryptoKeyPair>;
}

export interface DeviceKeys {
  id: string;
  ecdh: CryptoKeyPair;
  sign: CryptoKeyPair;
}

/** A new random device id (16 bytes, base64url). */
export function newDeviceId(): string {
  return toB64Url(randomBytes(16));
}

/** Fresh device keys. Private halves are non-extractable: they never leave this device. */
export async function generateDeviceKeys(extractable = false): Promise<DeviceKeys> {
  const [ecdh, sign] = await Promise.all([
    subtle().generateKey(ECDH, extractable, ["deriveBits"]) as Promise<CryptoKeyPair>,
    subtle().generateKey(ECDSA, extractable, ["sign", "verify"]) as Promise<CryptoKeyPair>,
  ]);
  return { id: newDeviceId(), ecdh, sign };
}

// ─── Public keys ──────────────────────────────────────────────────────────────

export async function exportPublicKey(key: CryptoKey): Promise<string> {
  return toB64(new Uint8Array(await subtle().exportKey("raw", key)));
}

/** Validate a base64 raw P-256 point (size + uncompressed prefix) and return its bytes. */
export function publicKeyBytes(b64: unknown): Bytes {
  if (!isBase64(b64)) throw new E2eeFormatError("Public key is not base64");
  const raw = fromB64(b64);
  if (raw.byteLength !== PUBLIC_KEY_BYTES || raw[0] !== 0x04) throw new E2eeFormatError("Public key has the wrong size");
  return raw;
}

/** Whether `b64` looks like a raw P-256 public key (format only, not curve membership). */
export function isPublicKeyB64(b64: unknown): b64 is string {
  try {
    publicKeyBytes(b64);
    return true;
  } catch {
    return false;
  }
}

export async function importEcdhPublicKey(b64: string): Promise<CryptoKey> {
  // importKey rejects points that aren't on the curve.
  return subtle().importKey("raw", publicKeyBytes(b64), ECDH, true, []);
}

export async function importEcdsaPublicKey(b64: string): Promise<CryptoKey> {
  return subtle().importKey("raw", publicKeyBytes(b64), ECDSA, true, ["verify"]);
}

// ─── Private keys (backup only) ───────────────────────────────────────────────

export async function exportPrivateJwk(key: CryptoKey): Promise<JsonWebKey> {
  return subtle().exportKey("jwk", key);
}

function checkPrivateJwk(jwk: unknown): JsonWebKey {
  const j = jwk as JsonWebKey | null;
  if (!j || typeof j !== "object" || j.kty !== "EC" || j.crv !== "P-256" || typeof j.d !== "string" || typeof j.x !== "string" || typeof j.y !== "string") {
    throw new E2eeFormatError("Not a P-256 private key");
  }
  return { kty: "EC", crv: "P-256", d: j.d, x: j.x, y: j.y, ext: true };
}

export async function importIdentityPrivateJwk(jwk: unknown, extractable = true): Promise<CryptoKey> {
  return subtle().importKey("jwk", { ...checkPrivateJwk(jwk), key_ops: ["sign"] }, ECDSA, extractable, ["sign"]);
}

export async function importBackupPrivateJwk(jwk: unknown, extractable = true): Promise<CryptoKey> {
  return subtle().importKey("jwk", { ...checkPrivateJwk(jwk), key_ops: ["deriveBits"] }, ECDH, extractable, ["deriveBits"]);
}

/** The public half of a P-256 private JWK, as base64 raw. */
export function publicKeyFromJwk(jwk: unknown): string {
  const j = checkPrivateJwk(jwk);
  const b64url = (s: string) => {
    const std = s.replace(/-/g, "+").replace(/_/g, "/");
    return fromB64(std + "=".repeat((4 - (std.length % 4)) % 4));
  };
  const x = b64url(j.x!);
  const y = b64url(j.y!);
  if (x.byteLength !== 32 || y.byteLength !== 32) throw new E2eeFormatError("Bad JWK coordinates");
  const raw = new Uint8Array(PUBLIC_KEY_BYTES);
  raw[0] = 0x04;
  raw.set(x, 1);
  raw.set(y, 33);
  return toB64(raw);
}

// ─── Signatures ───────────────────────────────────────────────────────────────

export async function signBytes(privateKey: CryptoKey, data: Bytes): Promise<Bytes> {
  return new Uint8Array(await subtle().sign(SIGN_PARAMS, privateKey, data));
}

/** ECDSA verify; false (never throws) on malformed keys or signatures. */
export async function verifyBytes(publicKeyB64: string, signature: Uint8Array, data: Bytes): Promise<boolean> {
  if (signature.byteLength !== SIGNATURE_BYTES) return false;
  try {
    const key = await importEcdsaPublicKey(publicKeyB64);
    const sig = new Uint8Array(signature.byteLength);
    sig.set(signature);
    return await subtle().verify(SIGN_PARAMS, key, sig, data);
  } catch {
    return false;
  }
}

// ─── Device certificates ──────────────────────────────────────────────────────

export interface PublicDevice {
  id: string;
  ecdhPub: string;
  signPub: string;
  /** Identity-key signature over the device (see deviceSignaturePayload). */
  sig: string;
}

export function isDeviceId(id: unknown): id is string {
  return typeof id === "string" && DEVICE_ID_RE.test(id);
}

/** What a user's identity key signs to vouch for one of their devices. */
export function deviceSignaturePayload(userId: string, device: Pick<PublicDevice, "id" | "ecdhPub" | "signPub">): Bytes {
  if (!UUID_RE.test(userId)) throw new E2eeFormatError("Bad user id");
  if (!isDeviceId(device.id)) throw new E2eeFormatError("Bad device id");
  return frame(LABELS.device, userId.toLowerCase(), device.id, publicKeyBytes(device.ecdhPub), publicKeyBytes(device.signPub));
}

export async function signDevice(identityPrivate: CryptoKey, userId: string, device: Pick<PublicDevice, "id" | "ecdhPub" | "signPub">): Promise<string> {
  return toB64(await signBytes(identityPrivate, deviceSignaturePayload(userId, device)));
}

/** Whether `device` is vouched for by `identityPub` (false on any malformed input). */
export async function verifyDevice(identityPub: string, userId: string, device: PublicDevice): Promise<boolean> {
  try {
    if (!isBase64(device.sig)) return false;
    return await verifyBytes(identityPub, fromB64(device.sig), deviceSignaturePayload(userId, device));
  } catch {
    return false;
  }
}

// ─── Backup key certificate ───────────────────────────────────────────────────
// Every message key is also wrapped to each member's backup key, so the backup
// public key must be vouched for by the identity key too: otherwise the server
// could hand out its own key as someone's "backup key" and read everything.

export function backupKeyPayload(userId: string, backupPub: string): Bytes {
  if (!UUID_RE.test(userId)) throw new E2eeFormatError("Bad user id");
  return frame(LABELS.backupKey, userId.toLowerCase(), publicKeyBytes(backupPub));
}

export async function signBackupKey(identityPrivate: CryptoKey, userId: string, backupPub: string): Promise<string> {
  return toB64(await signBytes(identityPrivate, backupKeyPayload(userId, backupPub)));
}

export async function verifyBackupKey(identityPub: string, userId: string, backupPub: string, sig: unknown): Promise<boolean> {
  try {
    if (!isBase64(sig)) return false;
    return await verifyBytes(identityPub, fromB64(sig), backupKeyPayload(userId, backupPub));
  } catch {
    return false;
  }
}

/** Public halves of fresh device keys, ready to be signed and published. */
export async function describeDevice(keys: DeviceKeys): Promise<Omit<PublicDevice, "sig">> {
  const [ecdhPub, signPub] = await Promise.all([exportPublicKey(keys.ecdh.publicKey), exportPublicKey(keys.sign.publicKey)]);
  return { id: keys.id, ecdhPub, signPub };
}
