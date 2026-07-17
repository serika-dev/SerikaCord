import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { config } from '../config';
import { nanoid } from 'nanoid';
import crypto from 'crypto';
import { sanitizeSvgBuffer } from '../security/svgSanitizer';

// Initialize S3 client for Backblaze B2
const s3Client = new S3Client({
  endpoint: `https://${config.B2_ENDPOINT}`,
  region: config.B2_REGION,
  credentials: {
    accessKeyId: config.B2_KEY_ID,
    secretAccessKey: config.B2_APPLICATION_KEY,
  },
  forcePathStyle: true,
});

export type UploadCategory = 
  | 'avatars' 
  | 'banners' 
  | 'attachments' 
  | 'server-icons' 
  | 'server-banners' 
  | 'emojis'
  | 'stickers'
  | 'audio'
  | 'app-icons';

interface UploadResult {
  url: string;
  key: string;
  size: number;
  contentType: string;
  hash: string;
}

interface UploadOptions {
  category: UploadCategory;
  userId?: string;
  serverId?: string;
  channelId?: string;
  filename?: string;
  contentType: string;
  data: Buffer | Uint8Array | ReadableStream<Uint8Array>;
  size: number;
}

// Validate file type based on category
// Note: 'attachments' is intentionally excluded — the upload route (uploads.ts)
// validates attachment types against the DB whitelist (platform_settings.allowedFileTypes)
// before calling storage. Hardcoding here would reject newly-added DB types.
function validateFileType(category: UploadCategory, contentType: string): boolean {
  const categoryAllowedTypes: Partial<Record<UploadCategory, readonly string[]>> = {
    avatars: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    banners: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    'server-icons': ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    'server-banners': ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    emojis: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    stickers: ['image/png', 'image/apng', 'application/json'], // JSON for Lottie
    audio: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm'],
  };

  const allowed = categoryAllowedTypes[category];
  if (!allowed) return true; // Unknown or DB-managed categories (e.g. attachments) — skip
  return allowed.includes(contentType);
}

// Get max file size for category
function getMaxSize(category: UploadCategory): number {
  const categorySizes: Record<UploadCategory, number> = {
    avatars: config.MAX_AVATAR_SIZE,
    banners: config.MAX_BANNER_SIZE,
    'server-icons': config.MAX_AVATAR_SIZE,
    'server-banners': config.MAX_BANNER_SIZE,
    attachments: config.MAX_FILE_SIZE,
    emojis: 20 * 1024 * 1024, // 20MB
    stickers: 20 * 1024 * 1024, // 20MB
    audio: 20 * 1024 * 1024, // 20MB
    'app-icons': config.MAX_AVATAR_SIZE,
  };

  return categorySizes[category] ?? config.MAX_FILE_SIZE;
}

// Generate a secure filename
function generateSecureFilename(originalFilename: string, category: UploadCategory): string {
  const id = nanoid(16);
  const ext = originalFilename.split('.').pop()?.toLowerCase() || 'bin';
  const sanitizedExt = ext.replace(/[^a-z0-9]/g, '');
  return `${id}.${sanitizedExt}`;
}

// Generate storage key
function generateKey(options: UploadOptions, filename: string): string {
  const { category, userId, serverId, channelId } = options;
  
  const parts: string[] = [category];
  
  if (serverId) parts.push(serverId);
  if (channelId) parts.push(channelId);
  if (userId) parts.push(userId);
  
  parts.push(filename);
  
  return parts.join('/');
}

// Strip a stored media URL down to its bucket key.
// Tolerates the current CDN (cdn.serika.chat) as well as legacy Backblaze
// hosts still present in older DB rows:
//   https://cdn.serika.chat/<key>
//   https://serikacord-media.s3.eu-central-003.backblazeb2.com/<key>   (virtual-host style)
//   https://s3.eu-central-003.backblazeb2.com/serikacord-media/<key>   (path style)
//   https://f003.backblazeb2.com/file/serikacord-media/<key>           (B2 friendly URL)
export function keyFromUrl(url: string): string {
  let key = url;
  try {
    const { pathname } = new URL(url);
    key = pathname.replace(/^\/+/, '');
    // Drop the B2 friendly-URL prefix and any leading "<bucket>/"
    key = key.replace(/^file\//, '');
    const bucketPrefix = `${config.B2_BUCKET_NAME}/`;
    if (key.startsWith(bucketPrefix)) key = key.slice(bucketPrefix.length);
  } catch {
    // Not an absolute URL — fall back to trimming the configured CDN base.
    key = url.replace(`${config.CDN_URL}/`, '');
  }
  return key;
}

/**
 * Normalize a stored media URL to the current CDN format.
 * Legacy URLs (direct Backblaze B2 hosts) are rewritten to `https://cdn.serika.chat/<key>`.
 * URLs already on the CDN are returned unchanged.
 */
export function normalizeUrl(url: string): string {
  if (!url) return url;
  if (url.includes(config.CDN_URL)) return url;
  const key = keyFromUrl(url);
  return `${config.CDN_URL}/${key}`;
}

// Calculate file hash for integrity
async function calculateHash(data: Buffer | Uint8Array): Promise<string> {
  const buffer = data instanceof Buffer ? data : Buffer.from(data);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export class StorageService {
  // Upload a file
  async upload(options: UploadOptions): Promise<UploadResult> {
    const { category, contentType, data, size, filename = 'file' } = options;

    // Validate file type
    if (!validateFileType(category, contentType)) {
      throw new Error(`Invalid file type: ${contentType} is not allowed for ${category}`);
    }

    // Validate file size
    const maxSize = getMaxSize(category);
    if (size > maxSize) {
      throw new Error(`File too large: ${size} bytes exceeds maximum of ${maxSize} bytes for ${category}`);
    }

    const secureFilename = generateSecureFilename(filename, category);
    const key = generateKey(options, secureFilename);

    // Convert data to buffer for hashing
    let buffer: Buffer;
    if (data instanceof Buffer) {
      buffer = data;
    } else if (data instanceof Uint8Array) {
      buffer = Buffer.from(data);
    } else {
      // It's a ReadableStream
      const chunks: Uint8Array[] = [];
      const reader = data.getReader();
      let done = false;
      while (!done) {
        const result = await reader.read();
        done = result.done;
        if (result.value) chunks.push(result.value);
      }
      buffer = Buffer.concat(chunks);
    }

    const hash = await calculateHash(buffer);

    // Sanitize SVGs server-side to strip <script>, event handlers, etc.
    // This makes SVG uploads safe even if opened directly in a browser tab.
    if (contentType === 'image/svg+xml') {
      buffer = sanitizeSvgBuffer(buffer);
    }

    // S3 metadata values must be ASCII — encode non-ASCII filenames
    const safeFilename = encodeURIComponent(filename || 'unknown');

    // Upload using multipart for larger files
    if (size > 5 * 1024 * 1024) { // 5MB threshold
      const upload = new Upload({
        client: s3Client,
        params: {
          Bucket: config.B2_BUCKET_NAME,
          Key: key,
          Body: buffer,
          ContentType: contentType,
          CacheControl: 'public, max-age=31536000', // 1 year cache
          Metadata: {
            'original-filename': safeFilename,
            'upload-hash': hash,
          },
        },
      });

      await upload.done();
    } else {
      await s3Client.send(new PutObjectCommand({
        Bucket: config.B2_BUCKET_NAME,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000',
        Metadata: {
          'original-filename': safeFilename,
          'upload-hash': hash,
        },
      }));
    }

    return {
      url: `${config.CDN_URL}/${key}`,
      key,
      size,
      contentType,
      hash,
    };
  }

  // Delete a file
  async delete(key: string): Promise<void> {
    await s3Client.send(new DeleteObjectCommand({
      Bucket: config.B2_BUCKET_NAME,
      Key: key,
    }));
  }

  // Delete by URL
  async deleteByUrl(url: string): Promise<void> {
    await this.delete(keyFromUrl(url));
  }

  // Check if file exists
  async exists(key: string): Promise<boolean> {
    try {
      await s3Client.send(new HeadObjectCommand({
        Bucket: config.B2_BUCKET_NAME,
        Key: key,
      }));
      return true;
    } catch {
      return false;
    }
  }

  // Get file metadata
  async getMetadata(key: string): Promise<{
    size: number;
    contentType: string;
    lastModified: Date | undefined;
  } | null> {
    try {
      const response = await s3Client.send(new HeadObjectCommand({
        Bucket: config.B2_BUCKET_NAME,
        Key: key,
      }));

      return {
        size: response.ContentLength ?? 0,
        contentType: response.ContentType ?? 'application/octet-stream',
        lastModified: response.LastModified,
      };
    } catch {
      return null;
    }
  }

  // Generate a signed URL for temporary access (useful for private files)
  getPublicUrl(key: string): string {
    return `${config.CDN_URL}/${key}`;
  }

  // Parse attachment from form data
  async uploadFromFormData(
    file: File,
    category: UploadCategory,
    options: { userId?: string; serverId?: string; channelId?: string } = {}
  ): Promise<UploadResult> {
    const buffer = Buffer.from(await file.arrayBuffer());
    
    return this.upload({
      category,
      contentType: file.type,
      data: buffer,
      size: file.size,
      filename: file.name,
      ...options,
    });
  }
}

export const storage = new StorageService();
