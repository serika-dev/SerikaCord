/**
 * Discord "image data" (data:image/png;base64,...) for bot API image fields
 * (guild icon / banner / splash, role icons). Decoded and checked here (pure),
 * then stored through the normal upload pipeline (storage.upload, which runs
 * the Trust & Safety image scan before anything is written) by uploadBotImage.
 * Arbitrary URLs are never accepted, so a bot can't point a guild icon at an
 * off-CDN address.
 */

export const BOT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export type BotImageType = (typeof BOT_IMAGE_TYPES)[number];

export type DecodedImage =
  | { ok: true; contentType: BotImageType; data: Buffer }
  | { ok: false; message: string };

/** Content type from the first bytes (the declared type must match it). */
export function sniffImage(buf: Uint8Array): BotImageType | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif';
  if (
    buf.length >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
    && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return 'image/webp';
  return null;
}

/** Decode a base64 image data URI no larger than `maxBytes` (decoded). */
export function decodeImageDataUri(value: unknown, maxBytes: number): DecodedImage {
  if (typeof value !== 'string') return { ok: false, message: 'Invalid image data' };
  const m = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(value);
  if (!m) return { ok: false, message: 'Invalid image data' };
  const declared = m[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : m[1].toLowerCase();
  if (!(BOT_IMAGE_TYPES as readonly string[]).includes(declared)) return { ok: false, message: 'Unsupported image type' };
  const b64 = m[2].replace(/\s+/g, '');
  // Reject before decoding when the payload is clearly too large.
  if (Math.floor((b64.length * 3) / 4) > maxBytes + 3) return { ok: false, message: `Image must be ${Math.floor(maxBytes / 1024)} KB or smaller` };
  const data = Buffer.from(b64, 'base64');
  if (data.length === 0) return { ok: false, message: 'Invalid image data' };
  if (data.length > maxBytes) return { ok: false, message: `Image must be ${Math.floor(maxBytes / 1024)} KB or smaller` };
  const sniffed = sniffImage(data);
  if (!sniffed || sniffed !== declared) return { ok: false, message: 'Invalid image data' };
  return { ok: true, contentType: sniffed, data };
}

const EXT: Record<BotImageType, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

/** "File too large. Maximum size is 5MB." (or "0.3MB" for limits under a megabyte). */
export function imageTooLargeMessage(maxBytes: number): string {
  const mb = maxBytes / 1024 / 1024;
  return `File too large. Maximum size is ${Number.isInteger(mb) ? mb : mb.toFixed(1)}MB.`;
}

export type CheckedImageUpload =
  | { ok: true; contentType: BotImageType; ext: string }
  | { ok: false; message: string };

/**
 * Check an uploaded image file's bytes (multipart uploads in the Developer
 * Portal): the real type comes from the bytes, never the declared type or
 * file name, and must be PNG / JPEG / GIF / WebP; at most `maxBytes`. The
 * caller stores it with the returned content type through storage.upload
 * (which runs the Trust & Safety scan).
 */
export function checkImageUpload(bytes: Uint8Array, maxBytes: number): CheckedImageUpload {
  if (bytes.length === 0) return { ok: false, message: 'No file provided' };
  if (bytes.length > maxBytes) return { ok: false, message: imageTooLargeMessage(maxBytes) };
  const sniffed = sniffImage(bytes);
  if (!sniffed) return { ok: false, message: 'Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.' };
  return { ok: true, contentType: sniffed, ext: EXT[sniffed] };
}

/**
 * Store a decoded image through storage.upload (type/size checks and the
 * Trust & Safety scan, attributed to the bot). Returns the CDN URL, or an
 * error message (blocked or failed uploads).
 */
export async function uploadBotImage(opts: {
  image: Extract<DecodedImage, { ok: true }>;
  category: 'server-icons' | 'server-banners' | 'emojis' | 'avatars' | 'banners';
  serverId: string;
  botId: string;
  name: string;
  /** Per-member images (server avatar / banner) are keyed by user too, like the web upload. */
  userId?: string;
}): Promise<{ ok: true; url: string } | { ok: false; message: string; blocked?: boolean }> {
  try {
    const { storage, ContentBlockedError } = await import('@/lib/services/storage');
    try {
      const result = await storage.upload({
        category: opts.category,
        contentType: opts.image.contentType,
        data: opts.image.data,
        size: opts.image.data.length,
        filename: `${opts.name}.${EXT[opts.image.contentType]}`,
        serverId: opts.serverId,
        ...(opts.userId ? { userId: opts.userId } : {}),
        scanUserId: opts.botId,
      });
      return { ok: true, url: result.url };
    } catch (err) {
      if (err instanceof ContentBlockedError) return { ok: false, message: 'This image cannot be used', blocked: true };
      throw err;
    }
  } catch (err) {
    console.error('bot image upload failed:', (err as Error)?.message);
    return { ok: false, message: 'Image upload failed' };
  }
}
