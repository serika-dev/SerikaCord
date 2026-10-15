// Encrypted attachment blobs. Each file gets its own random AES-256-GCM key;
// the blob uploaded to the CDN is ATTACHMENT_MAGIC ‖ AES-GCM(key, iv, file,
// aad = frame(LABELS.attachment)). Key, iv, the plaintext SHA-256, the real
// name, type and size travel inside the encrypted message payload.
import {
  AES_KEY_BYTES,
  ATTACHMENT_MAGIC,
  GCM_IV_BYTES,
  GCM_TAG_BYTES,
  LABELS,
  SHA256_BYTES,
} from "./constants";
import {
  E2eeFormatError,
  E2eeVerifyError,
  concat,
  equalBytes,
  frame,
  fromB64,
  randomBytes,
  toB64,
  toB64Url,
  toBytes,
  type Bytes,
} from "./encoding";

export interface AttachmentSecret {
  key: string;
  iv: string;
  /** SHA-256 of the plaintext file. */
  sha256: string;
}

export interface EncryptedAttachment extends AttachmentSecret {
  blob: Bytes;
  /** Upload name: `e2ee-<random>.bin` (reveals nothing about the file). */
  blobName: string;
}

const AAD = frame(LABELS.attachment);

/** Whether `bytes` starts with the encrypted-attachment magic header. */
export function hasAttachmentMagic(bytes: Uint8Array): boolean {
  if (bytes.byteLength < ATTACHMENT_MAGIC.byteLength) return false;
  return equalBytes(bytes.subarray(0, ATTACHMENT_MAGIC.byteLength), ATTACHMENT_MAGIC);
}

export async function encryptAttachment(data: Uint8Array | ArrayBuffer): Promise<EncryptedAttachment> {
  const plain = toBytes(data);
  const key = randomBytes(AES_KEY_BYTES);
  const iv = randomBytes(GCM_IV_BYTES);
  const subtle = globalThis.crypto.subtle;
  const [hash, aes] = await Promise.all([
    subtle.digest("SHA-256", plain),
    subtle.importKey("raw", key, { name: "AES-GCM" }, false, ["encrypt"]),
  ]);
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv, additionalData: AAD }, aes, plain));
  return {
    blob: concat(ATTACHMENT_MAGIC, ct),
    blobName: `e2ee-${toB64Url(randomBytes(16))}.bin`,
    key: toB64(key),
    iv: toB64(iv),
    sha256: toB64(new Uint8Array(hash)),
  };
}

/** Decrypt a downloaded blob and check the plaintext hash. */
export async function decryptAttachment(blob: Uint8Array | ArrayBuffer, secret: AttachmentSecret): Promise<Bytes> {
  const bytes = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
  if (!hasAttachmentMagic(bytes) || bytes.byteLength < ATTACHMENT_MAGIC.byteLength + GCM_TAG_BYTES) {
    throw new E2eeFormatError("Not an encrypted attachment");
  }
  const key = fromB64(secret.key);
  const iv = fromB64(secret.iv);
  const expected = fromB64(secret.sha256);
  if (key.byteLength !== AES_KEY_BYTES || iv.byteLength !== GCM_IV_BYTES || expected.byteLength !== SHA256_BYTES) {
    throw new E2eeFormatError("Bad attachment key");
  }
  const subtle = globalThis.crypto.subtle;
  let plain: Bytes;
  try {
    const aes = await subtle.importKey("raw", key, { name: "AES-GCM" }, false, ["decrypt"]);
    plain = new Uint8Array(
      await subtle.decrypt({ name: "AES-GCM", iv, additionalData: AAD }, aes, toBytes(bytes.subarray(ATTACHMENT_MAGIC.byteLength))),
    );
  } catch {
    throw new E2eeVerifyError("attachment", "The file couldn't be decrypted");
  }
  const hash = new Uint8Array(await subtle.digest("SHA-256", plain));
  if (!equalBytes(hash, expected)) throw new E2eeVerifyError("attachment_hash", "The file doesn't match its fingerprint");
  return plain;
}
