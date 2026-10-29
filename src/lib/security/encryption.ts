import { createCipheriv, createDecipheriv, randomBytes, createHash, scrypt } from 'crypto';
import { promisify } from 'util';
import { getEncryptionKey } from '@/lib/models/PlatformSettings';
import { connectDB } from '@/lib/db';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32; // Legacy format only
const VERSION_BYTE = 0x02; // New format marker

const scryptAsync = promisify(scrypt);

// Cached fast key — SHA-256 of the platform key, computed once and reused.
// This replaces the per-message scrypt derivation that made loading 50 messages
// take 10+ seconds. scrypt is only used now for backward-compatible decryption
// of legacy ciphertext.
let cachedFastKey: Buffer | null = null;

async function getFastKey(): Promise<Buffer> {
  if (cachedFastKey) return cachedFastKey;
  await connectDB();
  const platformKey = await getEncryptionKey();
  cachedFastKey = createHash('sha256').update(platformKey).digest();
  return cachedFastKey;
}

/**
 * The SHA-256 of the platform key, for other at-rest encryption helpers
 * (`fieldEncryption.ts` derives its own subkeys from it). Never log or return it.
 */
export async function getStorageKeyMaterial(): Promise<Buffer> {
  return getFastKey();
}

// ── Decryption cache ────────────────────────────────────────────────────────
// Ciphertext is immutable (an edit produces new ciphertext), so caching
// ciphertext→plaintext is safe and makes re-fetches, pagination, prefetch, and
// revalidation free.
const DECRYPT_CACHE_MAX = 20_000;
const decryptCache = new Map<string, string>();

function cacheGet(cipher: string): string | undefined {
  const hit = decryptCache.get(cipher);
  if (hit === undefined) return undefined;
  // LRU touch
  decryptCache.delete(cipher);
  decryptCache.set(cipher, hit);
  return hit;
}

function cacheSet(cipher: string, plain: string): void {
  decryptCache.set(cipher, plain);
  if (decryptCache.size > DECRYPT_CACHE_MAX) {
    const oldest = decryptCache.keys().next().value;
    if (oldest !== undefined) decryptCache.delete(oldest);
  }
}

/**
 * Encrypt a message with the platform encryption key.
 * New format: version(1) + iv(16) + authTag(16) + ciphertext → base64
 * This uses a pre-derived SHA-256 key (microseconds) instead of scrypt (seconds).
 */
export async function encryptMessage(plaintext: string): Promise<string> {
  if (!plaintext) return '';
  
  try {
    const key = await getFastKey();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final()
    ]);
    const authTag = cipher.getAuthTag();
    // New format: version byte + iv + authTag + ciphertext
    const combined = Buffer.concat([Buffer.from([VERSION_BYTE]), iv, authTag, encrypted]);
    return combined.toString('base64');
  } catch (error) {
    console.error('Failed to encrypt message:', error);
    return plaintext;
  }
}

/**
 * Decrypt a message with the platform encryption key.
 * Supports both new format (version + iv + authTag + ciphertext) and
 * legacy format (salt + iv + authTag + ciphertext) for backward compatibility.
 */
export async function decryptMessage(encryptedBase64: string): Promise<string> {
  if (!encryptedBase64) return '';

  const cached = cacheGet(encryptedBase64);
  if (cached !== undefined) return cached;

  const combined = Buffer.from(encryptedBase64, 'base64');

  // Try new format (version prefix 0x02)
  if (combined[0] === VERSION_BYTE && combined.length >= 1 + IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    let key: Awaited<ReturnType<typeof getFastKey>>;
    try {
      key = await getFastKey();
    } catch {
      return encryptedBase64; // key unavailable: not cached (see below)
    }
    try {
      const iv = combined.subarray(1, 1 + IV_LENGTH);
      const authTag = combined.subarray(1 + IV_LENGTH, 1 + IV_LENGTH + AUTH_TAG_LENGTH);
      const ciphertext = combined.subarray(1 + IV_LENGTH + AUTH_TAG_LENGTH);
      const decipher = createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      const plaintext = decrypted.toString('utf8');
      cacheSet(encryptedBase64, plaintext);
      return plaintext;
    } catch {
      // Fall through to legacy format
    }
  }

  // Try legacy format (salt + iv + authTag + ciphertext)
  if (combined.length >= SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    let platformKey: Awaited<ReturnType<typeof getEncryptionKey>>;
    try {
      await connectDB();
      platformKey = await getEncryptionKey();
    } catch {
      // Key unavailable right now: answer as-is, but don't cache it.
      return encryptedBase64;
    }
    try {
      const salt = combined.subarray(0, SALT_LENGTH);
      const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
      const authTag = combined.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
      const ciphertext = combined.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
      const key = await scryptAsync(platformKey, salt, 32) as Buffer;
      const decipher = createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      const plaintext = decrypted.toString('utf8');
      cacheSet(encryptedBase64, plaintext);
      return plaintext;
    } catch {
      // Fall through to return as-is
    }
  }

  // Not encrypted or decryption failed — return original for backward compat.
  // Cached too: the legacy path costs a scrypt derivation (~16 MB, tens of ms)
  // and the same text would otherwise pay it again on every page load.
  cacheSet(encryptedBase64, encryptedBase64);
  return encryptedBase64;
}

/**
 * Check if a string looks like an encrypted message
 */
// Stored ciphertext is always padded standard base64 (Buffer#toString('base64')).
const STORED_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function isEncrypted(text: string): boolean {
  if (!text) return false;
  // Buffer.from(..., 'base64') decodes anything (it skips invalid characters),
  // so ordinary text of ~90+ characters used to pass the length checks below
  // and pay a failed decrypt — including a scrypt derivation — on every read.
  if (text.length % 4 !== 0 || !STORED_BASE64.test(text)) return false;
  
  try {
    const decoded = Buffer.from(text, 'base64');
    // New format: version byte + iv + authTag + ciphertext (min 34 bytes)
    if (decoded[0] === VERSION_BYTE && decoded.length >= 1 + IV_LENGTH + AUTH_TAG_LENGTH + 1) return true;
    // Legacy format: salt + iv + authTag + ciphertext (min 65 bytes)
    return decoded.length >= SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH + 1;
  } catch {
    return false;
  }
}

/**
 * Encrypt message for storage
 */
export async function encryptForStorage(content: string): Promise<string> {
  return encryptMessage(content);
}

/**
 * Decrypt message from storage
 */
export async function decryptFromStorage(content: string): Promise<string> {
  // Check if message is encrypted
  if (isEncrypted(content)) {
    return decryptMessage(content);
  }
  // Return as-is if not encrypted (backward compatibility)
  return content;
}
