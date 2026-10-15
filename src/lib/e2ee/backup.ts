// Passphrase key backup: the identity + backup private keys sealed under
// PBKDF2-SHA-256(passphrase, salt, 600 000) → AES-256-GCM, bound to the user
// id. The server stores the sealed blob; it can only attack it by guessing the
// passphrase offline (≥ 10 chars enforced by clients, 600k iterations).
import {
  E2EE_VERSION,
  GCM_IV_BYTES,
  LABELS,
  LIMITS,
  MIN_PASSPHRASE_LENGTH,
  PBKDF2_ITERATIONS,
  PBKDF2_MAX_ITERATIONS,
  PBKDF2_SALT_BYTES,
  UUID_RE,
} from "./constants";
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
} from "./encoding";
import { publicKeyFromJwk } from "./keys";

export interface BackupRecord {
  /** base64(iv ‖ AES-GCM ciphertext). */
  blob: string;
  salt: string;
  iters: number;
}

export interface BackupSecrets {
  identity: JsonWebKey;
  backup: JsonWebKey;
}

/** Shape check for a stored backup record (used by the server before storing). */
export function validateBackupRecord(input: unknown): BackupRecord {
  const r = input as Record<string, unknown> | null;
  if (!r || typeof r !== "object") throw new E2eeFormatError("Bad backup");
  if (!isBase64(r.blob) || r.blob.length > LIMITS.maxBackupBlobB64 || b64ByteLength(r.blob) < GCM_IV_BYTES + 16 + 2) {
    throw new E2eeFormatError("Bad backup blob");
  }
  if (!isBase64(r.salt) || b64ByteLength(r.salt) !== PBKDF2_SALT_BYTES) throw new E2eeFormatError("Bad backup salt");
  const iters = r.iters;
  if (typeof iters !== "number" || !Number.isSafeInteger(iters) || iters < PBKDF2_ITERATIONS || iters > PBKDF2_MAX_ITERATIONS) {
    throw new E2eeFormatError("Bad backup iteration count");
  }
  return { blob: r.blob, salt: r.salt, iters };
}

export function isAcceptablePassphrase(passphrase: string): boolean {
  return typeof passphrase === "string" && passphrase.normalize("NFKC").trim().length >= MIN_PASSPHRASE_LENGTH;
}

async function passphraseKey(passphrase: string, salt: Uint8Array, iters: number): Promise<CryptoKey> {
  const subtle = globalThis.crypto.subtle;
  const base = await subtle.importKey("raw", utf8(passphrase.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  const s = new Uint8Array(salt.byteLength);
  s.set(salt);
  return subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: s, iterations: iters },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function aadFor(userId: string) {
  if (!UUID_RE.test(userId)) throw new E2eeFormatError("Bad user id");
  return frame(LABELS.backup, userId.toLowerCase());
}

export async function sealBackup(
  passphrase: string,
  userId: string,
  secrets: BackupSecrets,
  iters: number = PBKDF2_ITERATIONS,
): Promise<BackupRecord> {
  if (!isAcceptablePassphrase(passphrase)) throw new E2eeFormatError("Passphrase is too short");
  // Both keys must be real private keys (throws otherwise).
  publicKeyFromJwk(secrets.identity);
  publicKeyFromJwk(secrets.backup);
  const salt = randomBytes(PBKDF2_SALT_BYTES);
  const iv = randomBytes(GCM_IV_BYTES);
  const key = await passphraseKey(passphrase, salt, iters);
  const body = utf8(JSON.stringify({ v: E2EE_VERSION, identity: secrets.identity, backup: secrets.backup }));
  const ct = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aadFor(userId) }, key, body));
  return validateBackupRecord({ blob: toB64(concat(iv, ct)), salt: toB64(salt), iters });
}

/** Open a backup. Throws E2eeVerifyError("passphrase") on a wrong passphrase. */
export async function openBackup(passphrase: string, userId: string, record: BackupRecord): Promise<BackupSecrets> {
  const r = validateBackupRecord(record);
  const raw = fromB64(r.blob);
  const key = await passphraseKey(passphrase, fromB64(r.salt), r.iters);
  let plain: Uint8Array;
  try {
    plain = new Uint8Array(
      await globalThis.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: raw.slice(0, GCM_IV_BYTES), additionalData: aadFor(userId) },
        key,
        raw.slice(GCM_IV_BYTES),
      ),
    );
  } catch {
    throw new E2eeVerifyError("passphrase", "Wrong recovery passphrase");
  }
  let parsed: { v?: unknown; identity?: unknown; backup?: unknown };
  try {
    parsed = JSON.parse(fromUtf8(plain));
  } catch {
    throw new E2eeFormatError("Backup is malformed");
  }
  if (parsed.v !== E2EE_VERSION) throw new E2eeFormatError("Unsupported backup version");
  publicKeyFromJwk(parsed.identity);
  publicKeyFromJwk(parsed.backup);
  return { identity: parsed.identity as JsonWebKey, backup: parsed.backup as JsonWebKey };
}
