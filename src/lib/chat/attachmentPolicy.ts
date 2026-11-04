/**
 * Server-side check for message attachments sent by a user client.
 *
 * Attachments arrive as free-form JSON on the send routes, but the only
 * legitimate source is our own upload endpoint (`POST /api/upload/attachment`),
 * which stores files at `<CDN>/attachments/[<channelId>/]<userId>/<file>`.
 * Anything else (a foreign host, another user's upload path, an odd content
 * type) would render as a first-party file card, so it is rejected.
 *
 * The URL only proves who uploaded the file. Its name, type, size and
 * dimensions in the send body are the client's word, so the send routes then
 * run resolveAttachmentMetadata (src/lib/uploads/attachmentRecords.ts), which
 * swaps them for what the upload route recorded (applyAttachmentTruth below):
 * a modified client can't show `invoice.pdf · 12 KB` over an executable or
 * make a non-image render inline by calling it image/png.
 */

import { MESSAGE_LIMITS } from '@/lib/constants/limits';
import { DOWNLOAD_CONTENT_TYPE, canonicalMime, storedAttachmentType } from '@/lib/chat/uploadPolicy';

export interface IncomingAttachment {
  id: string;
  filename: string;
  contentType: string;
  url: string;
  size?: number;
  width?: number;
  height?: number;
  spoiler?: boolean;
  /** Alt text (bot API `attachments[].description`). */
  description?: string;
  /** Voice messages only (see lib/chat/voiceMessage). */
  durationSecs?: number;
  waveform?: string;
}

// Absolute ceiling (the largest tier). Send routes pass the sender's own cap:
// maxAttachmentsFor (users) or BOT_MAX_ATTACHMENTS (bots / webhooks).
export const MAX_ATTACHMENTS_PER_MESSAGE = Math.max(MESSAGE_LIMITS.FREE.maxAttachments, MESSAGE_LIMITS.SERIKA_PLUS.maxAttachments);
/** Discord allows 10 files per message; bots and webhooks keep that. */
export const BOT_MAX_ATTACHMENTS = 10;

/** Attachments a user may put on one message (Serika+ gets more). */
export function maxAttachmentsFor(user: { isPremium?: boolean | null } | null | undefined): number {
  return user?.isPremium ? MESSAGE_LIMITS.SERIKA_PLUS.maxAttachments : MESSAGE_LIMITS.FREE.maxAttachments;
}
const MAX_FILENAME_LENGTH = 255;
// type/subtype with optional parameters. Browsers send '' for unknown types.
const CONTENT_TYPE_RE = /^(?:[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}(?:\s*;[^\r\n<>]{0,200})?)?$/i;

/** Returns an error string, or null when every attachment is acceptable. */
export function validateMessageAttachments(
  attachments: IncomingAttachment[] | undefined,
  opts: { cdnUrl: string; userId: string; maxAttachments?: number },
): string | null {
  if (!attachments || attachments.length === 0) return null;
  const max = Math.min(opts.maxAttachments ?? MAX_ATTACHMENTS_PER_MESSAGE, MAX_ATTACHMENTS_PER_MESSAGE);
  if (attachments.length > max) return 'Too many attachments';

  let cdn: URL;
  try {
    cdn = new URL(opts.cdnUrl);
  } catch {
    return 'Attachments are not available';
  }
  const basePath = `${cdn.pathname.replace(/\/+$/, '')}/attachments/`;
  const userId = opts.userId.toLowerCase();

  for (const att of attachments) {
    if (!att || typeof att.url !== 'string') return 'Invalid attachment';
    let url: URL;
    try {
      url = new URL(att.url);
    } catch {
      return 'Invalid attachment URL';
    }
    if (
      url.protocol !== cdn.protocol ||
      url.host !== cdn.host ||
      url.username ||
      url.password ||
      !url.pathname.startsWith(basePath)
    ) {
      return 'Attachments must be uploaded to SerikaCord first';
    }
    // The upload key always contains the uploader's id as a path segment.
    const segments = url.pathname.slice(basePath.length).split('/').map((s) => s.toLowerCase());
    if (segments.length < 2 || !segments.slice(0, -1).includes(userId)) {
      return 'Attachments must be uploaded to SerikaCord first';
    }
    if (typeof att.filename !== 'string' || att.filename.length === 0 || att.filename.length > MAX_FILENAME_LENGTH) {
      return 'Invalid attachment filename';
    }
    if (typeof att.contentType !== 'string' || !CONTENT_TYPE_RE.test(att.contentType)) {
      return 'Invalid attachment content type';
    }
    if (att.size !== undefined && (!Number.isFinite(att.size) || att.size < 0)) {
      return 'Invalid attachment size';
    }
  }
  return null;
}

/**
 * Bot API (`POST /api/v10/channels/:id/messages`): turn Discord-shaped
 * `attachments` (`{ url, filename, content_type, size, ... }`) into stored
 * attachments, accepting only files the bot itself uploaded to our CDN — the
 * same ownership rule users get. A bot can no longer make an arbitrary URL
 * render as a native file card; external media belongs in an embed.
 */
export function normalizeBotAttachments(
  raw: unknown,
  opts: { cdnUrl: string; botId: string },
): { attachments: IncomingAttachment[] } | { error: string } {
  if (raw === undefined || raw === null) return { attachments: [] };
  if (!Array.isArray(raw)) return { error: 'attachments must be an array' };
  const attachments: IncomingAttachment[] = raw.map((item, i) => {
    const a = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
    const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
    const durationSecs = num(a.durationSecs) ?? num(a.duration_secs);
    const waveform = str(a.waveform);
    return {
      id: str(a.id) ?? String(i),
      filename: str(a.filename) ?? '',
      contentType: str(a.contentType) ?? str(a.content_type) ?? '',
      url: str(a.url) as string,
      ...(num(a.size) !== undefined ? { size: num(a.size) } : {}),
      ...(num(a.width) !== undefined ? { width: num(a.width) } : {}),
      ...(num(a.height) !== undefined ? { height: num(a.height) } : {}),
      ...(a.spoiler === true ? { spoiler: true } : {}),
      ...(durationSecs !== undefined ? { durationSecs } : {}),
      ...(waveform !== undefined ? { waveform } : {}),
    };
  });
  const error = validateMessageAttachments(attachments, { cdnUrl: opts.cdnUrl, userId: opts.botId, maxAttachments: BOT_MAX_ATTACHMENTS });
  if (error) {
    return {
      error: error === 'Attachments must be uploaded to SerikaCord first'
        ? 'attachments must be files this bot uploaded to SerikaCord; link external media with an embed instead'
        : error,
    };
  }
  return { attachments };
}

// ─── Server-recorded attachment metadata ─────────────────────────────────────

/** What the upload route actually stored, recorded per storage key. */
export interface AttachmentRecord {
  uploaderId: string;
  /** Sanitized upload file name; its extension is the stored key's. */
  filename: string;
  /** The type the object was stored under (sniffed / checked at upload). */
  contentType: string;
  /** Real byte count. */
  size: number;
  /** Measured from the image bytes, when it is an image. */
  width?: number;
  height?: number;
}

/** Parse a stored record, or null when it is missing or malformed. */
export function parseAttachmentRecord(raw: string | null | undefined): AttachmentRecord | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as Partial<AttachmentRecord> | null;
    if (
      !r || typeof r !== 'object' ||
      typeof r.uploaderId !== 'string' ||
      typeof r.filename !== 'string' ||
      typeof r.contentType !== 'string' ||
      typeof r.size !== 'number' || !Number.isFinite(r.size) || r.size < 0
    ) return null;
    return {
      uploaderId: r.uploaderId,
      filename: r.filename,
      contentType: r.contentType,
      size: r.size,
      ...(typeof r.width === 'number' && typeof r.height === 'number' ? { width: r.width, height: r.height } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Where the trusted facts for one attachment came from:
 * - `record`: the upload route's record (src/lib/uploads/attachmentRecords.ts),
 * - `storage`: the object's own metadata in the bucket (HEAD), for uploads
 *   with no record (made before records existed, or Redis was down),
 * - `none`: nothing could be looked up; the client's values are clamped.
 */
export type AttachmentTruth =
  | { source: 'record'; record: AttachmentRecord }
  | { source: 'storage'; contentType: string; size: number; filename?: string }
  | { source: 'none' };

const MAX_DIMENSION = 65535;

/**
 * The extension StorageService gives a stored key for an upload named `name`
 * (generateSecureFilename in src/lib/services/storage.ts: last dot segment,
 * lowercased, non-alphanumerics dropped, `bin` without one).
 */
export function storedKeyExtension(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || 'bin';
  return ext.replace(/[^a-z0-9]/g, '');
}

/** The extension of the stored object a CDN attachment URL points at. */
export function urlKeyExtension(url: string): string {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url.split(/[?#]/)[0];
  }
  const file = path.split('/').pop() ?? '';
  const dot = file.lastIndexOf('.');
  return dot >= 0 ? file.slice(dot + 1).toLowerCase() : '';
}

// Bidi overrides / isolates and zero-width characters can make a name read
// differently from how it ends ("invoice\u202Eexe.pdf" shows as
// "invoicefdp.exe"), plus C0 / C1 control characters.
const UNSAFE_NAME_CHARS = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;

/**
 * A file name safe to show: no control, bidi or zero-width characters, no
 * path separators, collapsed whitespace, at most 255 characters (the end,
 * with the extension, is kept). '' when nothing is left.
 */
export function sanitizeAttachmentFilename(name: unknown): string {
  if (typeof name !== 'string') return '';
  let out = name.normalize('NFC').replace(UNSAFE_NAME_CHARS, '').replace(/[\\/]/g, '_').replace(/\s+/g, ' ').trim();
  if (out.length > MAX_FILENAME_LENGTH) {
    const dot = out.lastIndexOf('.');
    const ext = dot > 0 && out.length - dot <= 32 ? out.slice(dot) : '';
    out = out.slice(0, MAX_FILENAME_LENGTH - ext.length) + ext;
  }
  return out;
}

/**
 * The name to show for an attachment whose stored key ends in `.keyExt`.
 * A requested name (the send body) is kept when it has that same extension,
 * so renames stay possible (Discord lets bots rename with the same
 * extension). Otherwise the recorded upload name is used, or, with nothing
 * recorded, the real extension is appended (`invoice.pdf` over an `.exe`
 * shows as `invoice.pdf.exe`): the shown name always ends in what the file is.
 */
export function displayFilename(requested: unknown, keyExt: string, recordedName?: string): string {
  const wanted = sanitizeAttachmentFilename(requested);
  if (wanted && storedKeyExtension(wanted) === keyExt) return wanted;
  const recorded = sanitizeAttachmentFilename(recordedName);
  if (recorded && storedKeyExtension(recorded) === keyExt) return recorded;
  const base = wanted || recorded || 'file';
  if (!keyExt) return base;
  return sanitizeAttachmentFilename(`${base.slice(0, MAX_FILENAME_LENGTH - keyExt.length - 1)}.${keyExt}`);
}

// File endings that may carry an inline-rendered type. Families, not exact
// pairs: browsers sniff raster images whatever the label, and audio / video
// containers overlap (.ogg, .webm, .mp4 / .m4a hold either), so a mislabeled
// but real media file still plays. What this stops is a page, script,
// document or executable labeled as media.
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'jpe', 'jfif', 'pjpeg', 'pjp', 'png', 'apng', 'gif', 'webp', 'avif', 'bmp']);
const AV_EXTENSIONS = new Set([
  'mp3', 'mpga', 'mp2', 'm2a', 'ogg', 'oga', 'ogv', 'opus', 'spx', 'wav', 'wave', 'flac', 'aac', 'adts',
  'm4a', 'm4b', 'mp4', 'm4v', 'webm', 'weba', 'mov', 'qt', 'mkv', 'mka', 'mk3d',
]);

/**
 * Whether `contentType` is believable for a stored key ending in `.ext`.
 * Only types the client renders inline (image/*, audio/*, video/*) are
 * checked; documents and downloads always match.
 */
export function mediaTypeMatchesExtension(contentType: string | null | undefined, ext: string): boolean {
  const c = canonicalMime(contentType);
  const family = c.split('/')[0];
  if (family === 'image') return c !== 'image/svg+xml' && IMAGE_EXTENSIONS.has(ext);
  if (family === 'audio' || family === 'video') return AV_EXTENSIONS.has(ext);
  return true;
}

/**
 * The content type to keep for an unverified claim: what the upload route
 * would store for it (active / unknown types become downloads), and a
 * download when it is media but the stored key's extension isn't.
 */
export function clampAttachmentContentType(claimed: string | null | undefined, keyExt: string, knownTypes: readonly string[]): string {
  const t = storedAttachmentType(claimed, knownTypes);
  return mediaTypeMatchesExtension(t, keyExt) ? t : DOWNLOAD_CONTENT_TYPE;
}

const dimension = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= MAX_DIMENSION ? v : undefined;

/**
 * Replace an attachment's client-supplied name, type, size and dimensions
 * with trusted values (see AttachmentTruth). Everything else (id, url,
 * spoiler, description, voice fields) is kept as sent.
 */
export function applyAttachmentTruth<A extends IncomingAttachment>(att: A, truth: AttachmentTruth, knownTypes: readonly string[]): A {
  const keyExt = urlKeyExtension(att.url);
  const out: A = { ...att };
  delete out.width;
  delete out.height;
  delete out.size;

  if (truth.source === 'record') {
    const { record } = truth;
    out.filename = displayFilename(att.filename, keyExt, record.filename);
    out.contentType = record.contentType;
    out.size = record.size;
    const w = dimension(record.width);
    const h = dimension(record.height);
    if (w && h) {
      out.width = w;
      out.height = h;
    }
    return out;
  }

  const claimedType = truth.source === 'storage' ? truth.contentType : att.contentType;
  out.contentType = clampAttachmentContentType(claimedType, keyExt, knownTypes);
  out.filename = displayFilename(att.filename, keyExt, truth.source === 'storage' ? truth.filename : undefined);
  const size = truth.source === 'storage' ? truth.size : att.size;
  if (typeof size === 'number' && Number.isFinite(size) && size >= 0) out.size = Math.floor(size);
  // Unverifiable but harmless layout hints; only meaningful for images / video.
  const w = dimension(att.width);
  const h = dimension(att.height);
  if (w && h && /^(image|video)\//.test(out.contentType)) {
    out.width = w;
    out.height = h;
  }
  return out;
}
