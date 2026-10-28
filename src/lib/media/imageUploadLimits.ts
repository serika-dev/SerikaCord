/**
 * Size and type rules for profile / server image uploads (pure, tested in
 * tests/image-upload-limits.test.ts). One source of truth shared by the
 * upload routes (src/lib/api/uploads.ts, the Developer Portal bot banner) and
 * StorageService.upload, so a file the route accepts is never refused by
 * storage afterwards (that used to turn 10-50 MB GIF banners into a 500).
 *
 * The real type always comes from the bytes (checkImageUpload): the declared
 * MIME type and the file name are never trusted.
 */
import { BOT_IMAGE_TYPES, checkImageUpload, imageTooLargeMessage, type BotImageType } from '@/lib/botapi/imageData';

/**
 * Animated (GIF) banners may be larger than still banners so long animations
 * survive uncropped. The settings dialogs and the profile editor check the
 * same 50 MB on the client.
 */
export const ANIMATED_BANNER_MAX_BYTES = 50 * 1024 * 1024;

/** Emoji and sticker uploads (unchanged from the routes' previous limit). */
export const EXPRESSION_IMAGE_MAX_BYTES = 20 * 1024 * 1024;

/**
 * avatar: user avatar, per-server avatar, server icon, group DM icon, webhook avatar.
 * banner: user banner, per-server banner, server banner.
 * appearance: app background and nameplate images.
 * cover: scheduled event cover (the banner size for every type, like storage's event-covers).
 */
export type ImageUploadKind = 'avatar' | 'banner' | 'appearance' | 'cover' | 'emoji' | 'sticker';

/** The configured limits (config.MAX_AVATAR_SIZE / config.MAX_BANNER_SIZE). */
export interface ImageSizeConfig {
  avatarMax: number;
  bannerMax: number;
}

/** Banner limit for a (sniffed) content type: GIFs get the animated cap. */
export function bannerMaxBytes(contentType: string, bannerMax: number): number {
  return contentType === 'image/gif' ? Math.max(ANIMATED_BANNER_MAX_BYTES, bannerMax) : bannerMax;
}

/** Maximum size for an upload of `kind` whose bytes are `contentType`. */
export function imageUploadMaxBytes(kind: ImageUploadKind, contentType: string, cfg: ImageSizeConfig): number {
  switch (kind) {
    case 'avatar': return cfg.avatarMax;
    case 'banner': return bannerMaxBytes(contentType, cfg.bannerMax);
    case 'appearance':
    case 'cover': return cfg.bannerMax;
    case 'emoji':
    case 'sticker': return EXPRESSION_IMAGE_MAX_BYTES;
  }
}

/** Types accepted per kind (stickers have never taken JPEG). */
export function allowedImageTypes(kind: ImageUploadKind): readonly BotImageType[] {
  return kind === 'sticker' ? BOT_IMAGE_TYPES.filter((t) => t !== 'image/jpeg') : BOT_IMAGE_TYPES;
}

/** The largest size any accepted type may have: files above it are refused before reading. */
export function imageUploadCeiling(kind: ImageUploadKind, cfg: ImageSizeConfig): number {
  return Math.max(...allowedImageTypes(kind).map((t) => imageUploadMaxBytes(kind, t, cfg)));
}

function formatMb(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)}MB`;
}

/**
 * "File too large. Maximum size is 10MB." and, for banners where GIFs may be
 * bigger, "... 10MB (50MB for animated GIFs)."
 */
export function imageTooLargeMessageFor(kind: ImageUploadKind, cfg: ImageSizeConfig, contentType?: string): string {
  if (kind === 'banner') {
    const still = cfg.bannerMax;
    const animated = bannerMaxBytes('image/gif', still);
    if (contentType === 'image/gif' || animated === still) return imageTooLargeMessage(animated);
    return `File too large. Maximum size is ${formatMb(still)} (${formatMb(animated)} for animated GIFs).`;
  }
  return imageTooLargeMessage(imageUploadMaxBytes(kind, contentType ?? 'image/png', cfg));
}

export type ImageUploadVerdict =
  | { ok: true; contentType: BotImageType; ext: string }
  | { ok: false; status: 400 | 413; message: string };

/**
 * Check an uploaded image's bytes for `kind`: PNG / JPEG / GIF / WebP by
 * their magic bytes (stickers: no JPEG), then the size limit for the type the
 * bytes really are. Too large is a 413, anything else a 400.
 */
export function checkImageUploadFor(bytes: Uint8Array, kind: ImageUploadKind, cfg: ImageSizeConfig): ImageUploadVerdict {
  const ceiling = imageUploadCeiling(kind, cfg);
  if (bytes.length > ceiling) return { ok: false, status: 413, message: imageTooLargeMessageFor(kind, cfg) };
  const checked = checkImageUpload(bytes, ceiling);
  if (!checked.ok) return { ok: false, status: 400, message: checked.message };
  if (!allowedImageTypes(kind).includes(checked.contentType)) {
    return { ok: false, status: 400, message: 'Invalid file type. Stickers must be PNG/APNG/GIF/WebP.' };
  }
  if (bytes.length > imageUploadMaxBytes(kind, checked.contentType, cfg)) {
    return { ok: false, status: 413, message: imageTooLargeMessageFor(kind, cfg, checked.contentType) };
  }
  return checked;
}

export type ReadImageUpload =
  | { ok: true; data: Buffer; contentType: BotImageType; ext: string }
  | { ok: false; status: 400 | 413; message: string };

/**
 * Read a multipart image upload (File / Blob) and check it with
 * checkImageUploadFor. Files over the ceiling are refused before their bytes
 * are read. The caller stores `data` with the returned content type under a
 * generated name ending in `ext` (storage.upload, which runs the Trust &
 * Safety scan); the declared type and file name are never used.
 */
export async function readImageUploadFor(
  file: { size: number; arrayBuffer(): Promise<ArrayBuffer> },
  kind: ImageUploadKind,
  cfg: ImageSizeConfig,
): Promise<ReadImageUpload> {
  if (file.size > imageUploadCeiling(kind, cfg)) return { ok: false, status: 413, message: imageTooLargeMessageFor(kind, cfg) };
  const data = Buffer.from(await file.arrayBuffer());
  const checked = checkImageUploadFor(data, kind, cfg);
  if (!checked.ok) return checked;
  return { ok: true, data, contentType: checked.contentType, ext: checked.ext };
}
