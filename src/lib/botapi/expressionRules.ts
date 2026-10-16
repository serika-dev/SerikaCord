/**
 * Discord v10 rules for emojis and stickers in the bot API, pure: image data
 * URIs (`data:image/png;base64,...`) with a content sniff, Discord's name /
 * description / tag limits and file size caps. Used by ./expressions.ts;
 * tested in tests/bot-expressions.test.ts.
 */
import { FormErrors, type DiscordFormError } from './formErrors';

/** Discord: emoji images up to 256 KiB, stickers up to 512 KiB. */
export const MAX_EMOJI_BYTES = 256 * 1024;
export const MAX_STICKER_BYTES = 512 * 1024;
export const MAX_GUILD_EMOJIS = 500;
export const MAX_GUILD_STICKERS = 500;
export const MAX_APP_EMOJIS = 2000;

export type ImageKind = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/apng' | 'application/json';

const EXT: Record<ImageKind, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/apng': 'png', 'application/json': 'json',
};
export const extensionFor = (kind: ImageKind) => EXT[kind];

/** What the bytes actually are (magic numbers), or null. */
export function sniffImage(bytes: Uint8Array): ImageKind | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    // An acTL chunk before IDAT makes it an animated PNG.
    const head = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 4096))).toString('latin1');
    const actl = head.indexOf('acTL');
    const idat = head.indexOf('IDAT');
    return actl > 0 && (idat < 0 || actl < idat) ? 'image/apng' : 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif';
  if (bytes.length >= 12 && Buffer.from(bytes.subarray(0, 4)).toString('latin1') === 'RIFF' && Buffer.from(bytes.subarray(8, 12)).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/** Whether a GIF / WebP / APNG has more than one frame (the emoji `animated` flag). */
export function isAnimatedImage(kind: ImageKind, bytes: Uint8Array): boolean {
  if (kind === 'image/apng') return true;
  if (kind === 'image/gif') {
    // More than one image descriptor (0x2C after a graphic control block) means animation.
    let frames = 0;
    for (let i = 0; i + 1 < bytes.length && frames < 2; i++) {
      if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9) frames++;
    }
    return frames > 1;
  }
  if (kind === 'image/webp') {
    const head = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 64))).toString('latin1');
    return head.includes('ANIM');
  }
  return false;
}

export type ParsedImage = { ok: true; kind: ImageKind; bytes: Buffer; animated: boolean } | { ok: false; code: string; message: string };

/**
 * A Discord image data URI (`data:image/png;base64,...`). The declared type
 * must be png / jpeg / gif / webp and match the bytes; size capped at `maxBytes`.
 */
export function parseImageDataUri(value: unknown, maxBytes: number): ParsedImage {
  if (typeof value !== 'string' || !value.startsWith('data:')) return { ok: false, code: 'IMAGE_INVALID', message: 'Invalid image data' };
  const tooBig = { ok: false as const, code: 'BINARY_TYPE_MAX_SIZE', message: `File cannot be larger than ${Math.floor(maxBytes / 1024)}.0 kb.` };
  // base64 length bounds the decoded size: refuse before scanning / decoding a huge string.
  if (value.length > Math.ceil(maxBytes / 3) * 4 + 4096) return tooBig;
  const m = /^data:(image\/(?:png|jpeg|jpg|gif|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(value);
  if (!m) return { ok: false, code: 'IMAGE_INVALID', message: 'Invalid image data' };
  const b64 = m[2].replace(/\s+/g, '');
  if (Math.floor((b64.length * 3) / 4) > maxBytes + 3) return tooBig;
  const bytes = Buffer.from(b64, 'base64');
  if (bytes.length === 0) return { ok: false, code: 'IMAGE_INVALID', message: 'Invalid image data' };
  if (bytes.length > maxBytes) return { ok: false, code: 'BINARY_TYPE_MAX_SIZE', message: `File cannot be larger than ${Math.floor(maxBytes / 1024)}.0 kb.` };
  const kind = sniffImage(bytes);
  if (!kind) return { ok: false, code: 'IMAGE_INVALID', message: 'Invalid image data' };
  return { ok: true, kind, bytes, animated: isAnimatedImage(kind, bytes) };
}

const EMOJI_NAME_RE = /^[A-Za-z0-9_]{2,32}$/;

/** Discord emoji names: 2-32 characters, letters, digits and underscores. */
export function emojiNameError(name: unknown): { code: string; message: string } | null {
  if (typeof name !== 'string') return { code: 'BASE_TYPE_REQUIRED', message: 'This field is required' };
  if (name.length < 2 || name.length > 32) return { code: 'BASE_TYPE_BAD_LENGTH', message: 'Must be between 2 and 32 in length.' };
  if (!EMOJI_NAME_RE.test(name)) return { code: 'STRING_TYPE_REGEX', message: 'String value did not match validation regex.' };
  return null;
}

export interface StickerFields { name?: string; description?: string | null; tags?: string }

/**
 * Discord sticker fields: name 2-30, description empty or 2-100, tags (the
 * autocomplete / suggestion emoji names) up to 200 characters. With
 * `required`, name and tags must be present (create).
 */
export function parseStickerFields(body: Record<string, unknown>, required: boolean): { ok: true; value: StickerFields } | { ok: false; error: DiscordFormError } {
  const errors = new FormErrors();
  const out: StickerFields = {};
  if (body.name !== undefined || required) {
    if (typeof body.name !== 'string') errors.add(['name'], 'BASE_TYPE_REQUIRED', 'This field is required');
    else if (body.name.trim().length < 2 || body.name.length > 30) errors.add(['name'], 'BASE_TYPE_BAD_LENGTH', 'Must be between 2 and 30 in length.');
    else out.name = body.name.trim();
  }
  if (body.description !== undefined && body.description !== null) {
    if (typeof body.description !== 'string') errors.add(['description'], 'BASE_TYPE_STRING', 'Must be a string.');
    else if (body.description.length > 0 && (body.description.length < 2 || body.description.length > 100)) errors.add(['description'], 'BASE_TYPE_BAD_LENGTH', 'Must be between 2 and 100 in length.');
    else out.description = body.description || null;
  } else if (body.description === null) {
    out.description = null;
  }
  if (body.tags !== undefined || required) {
    if (typeof body.tags !== 'string' || !body.tags.trim()) errors.add(['tags'], 'BASE_TYPE_REQUIRED', 'This field is required');
    else if (body.tags.length > 200) errors.add(['tags'], 'BASE_TYPE_MAX_LENGTH', 'Must be 200 or fewer in length.');
    else out.tags = body.tags.trim();
  }
  if (!errors.ok) return { ok: false, error: errors.toBody() };
  return { ok: true, value: out };
}

/** Stored sticker tags (text[]) from Discord's comma-separated string. */
export function stickerTagList(tags: string): string[] {
  return tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 10).map((t) => t.slice(0, 30));
}

/** Sticker upload kinds Discord takes: PNG, APNG, GIF, Lottie JSON. */
export function stickerKind(bytes: Uint8Array, declaredType: string | null | undefined): ImageKind | null {
  const sniffed = sniffImage(bytes);
  if (sniffed === 'image/png' || sniffed === 'image/apng' || sniffed === 'image/gif') return sniffed;
  if (!sniffed && (declaredType === 'application/json' || declaredType === 'text/plain' || !declaredType)) {
    const text = Buffer.from(bytes.subarray(0, 64)).toString('utf8').trimStart();
    if (text.startsWith('{')) return 'application/json';
  }
  return null;
}
