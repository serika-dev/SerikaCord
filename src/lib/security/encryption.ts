import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'crypto';
import { promisify } from 'util';
import { getEncryptionKey } from '@/lib/models/PlatformSettings';
import { connectDB } from '@/lib/db';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;

const scryptAsync = promisify(scrypt);

// Derive a key from the platform encryption key (async so batches can use the worker pool)
async function deriveKey(platformKey: string, salt: Buffer): Promise<Buffer> {
  return scryptAsync(platformKey, salt, 32) as Promise<Buffer>;
}

/**
 * Encrypt a message with the platform encryption key
 * Returns a base64 encoded string containing salt:iv:authTag:ciphertext
 */
export async function encryptMessage(plaintext: string): Promise<string> {
  if (!plaintext) return '';
  
  try {
    // Ensure DB is connected before fetching encryption key
    await connectDB();
    const platformKey = await getEncryptionKey();
    
    // Generate salt and IV
    const salt = randomBytes(SALT_LENGTH);
    const iv = randomBytes(IV_LENGTH);
    
    // Derive key from platform key
    const key = await deriveKey(platformKey, salt);
    
    // Create cipher
    const cipher = createCipheriv(ALGORITHM, key, iv);
    
    // Encrypt
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final()
    ]);
    
    // Get auth tag
    const authTag = cipher.getAuthTag();
    
    // Combine: salt + iv + authTag + ciphertext
    const combined = Buffer.concat([salt, iv, authTag, encrypted]);
    
    return combined.toString('base64');
  } catch (error) {
    console.error('Failed to encrypt message:', error);
    // Return original if encryption fails (e.g., DB not ready)
    return plaintext;
  }
}

/**
 * Decrypt a message with the platform encryption key
 * Expects a base64 encoded string containing salt:iv:authTag:ciphertext
 */
export async function decryptMessage(encryptedBase64: string): Promise<string> {
  if (!encryptedBase64) return '';
  
  try {
    // Ensure DB is connected before fetching encryption key
    await connectDB();
    const platformKey = await getEncryptionKey();
    
    // Decode from base64
    const combined = Buffer.from(encryptedBase64, 'base64');
    
    // Extract components
    const salt = combined.subarray(0, SALT_LENGTH);
    const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const authTag = combined.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = combined.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
    
    // Derive key
    const key = await deriveKey(platformKey, salt);
    
    // Create decipher
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    // Decrypt
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]);
    
    return decrypted.toString('utf8');
  } catch (error) {
    console.error('Failed to decrypt message:', error);
    // Return original if decryption fails (for backward compatibility with unencrypted messages)
    return encryptedBase64;
  }
}

/**
 * Check if a string looks like an encrypted message
 */
export function isEncrypted(text: string): boolean {
  if (!text) return false;
  
  try {
    const decoded = Buffer.from(text, 'base64');
    // Check if it has the expected minimum length
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
