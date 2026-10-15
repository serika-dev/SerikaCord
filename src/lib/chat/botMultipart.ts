/**
 * Discord-compatible multipart bodies for the bot API (POST/PATCH
 * /api/v10/channels/:id/messages): `files[n]` file fields, a `payload_json`
 * field with the JSON body, and `attachments: [{ id, filename?, description? }]`
 * in that payload where `id` is the `n` of `files[n]` (or, on edit, the id of
 * an attachment to keep).
 *
 * Pure: parsing, validation and attachment planning only. Storing the files
 * goes through the same upload path users get (storeChatAttachment in
 * src/lib/api/uploads.ts: type whitelist, size limit, image sniffing and
 * Trust & Safety scanning). Elysia hands multipart bodies over as an object
 * of field name -> string | File (an array when a field repeats).
 */

/** Discord allows 10 files per message. */
export const MAX_BOT_FILES = 10;
const MAX_DESCRIPTION = 1024;
const MAX_FILENAME = 255;

export interface FileLike {
  name: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  slice(start?: number, end?: number): { arrayBuffer(): Promise<ArrayBuffer> };
}

export function isFileLike(v: unknown): v is FileLike {
  return !!v && typeof v === 'object'
    && typeof (v as FileLike).arrayBuffer === 'function'
    && typeof (v as FileLike).size === 'number'
    && typeof (v as FileLike).slice === 'function';
}

export interface ParsedBotBody<F extends FileLike = FileLike> {
  /** The JSON payload (payload_json, or the plain form fields, or the JSON body). */
  payload: Record<string, unknown>;
  /** Uploaded files by their `files[n]` index, ascending. */
  files: Array<{ index: number; file: F }>;
  multipart: boolean;
}

export type BotBodyResult<F extends FileLike = FileLike> =
  | ({ ok: true } & ParsedBotBody<F>)
  | { ok: false; code: number; error: string };

const FILE_KEY = /^files\[(\d{1,2})\]$/;
// Form fields Discord accepts outside payload_json that carry JSON.
const JSON_FORM_FIELDS = new Set(['embeds', 'allowed_mentions', 'message_reference', 'components', 'sticker_ids', 'attachments', 'poll']);

/** Split a request body into its JSON payload and uploaded files. */
export function parseBotMessageBody(body: unknown): BotBodyResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: true, payload: {}, files: [], multipart: false };
  }
  const raw = body as Record<string, unknown>;
  const fileEntries = Object.entries(raw).filter(([k, v]) => FILE_KEY.test(k) || k === 'file' || isFileLike(v) || (Array.isArray(v) && v.some(isFileLike)));
  const multipart = fileEntries.length > 0 || 'payload_json' in raw;
  if (!multipart) return { ok: true, payload: raw, files: [], multipart: false };

  const files: Array<{ index: number; file: FileLike }> = [];
  const used = new Set<number>();
  for (const [key, value] of fileEntries) {
    const m = FILE_KEY.exec(key);
    let index: number;
    if (m) index = Number(m[1]);
    else if (key === 'file') index = 0; // legacy single-file field
    else return { ok: false, code: 50035, error: `Invalid Form Body: unexpected file field "${key}" (use files[n])` };
    if (Array.isArray(value)) return { ok: false, code: 50035, error: `Invalid Form Body: ${key} was sent more than once` };
    if (!isFileLike(value)) return { ok: false, code: 50035, error: `Invalid Form Body: ${key} must be a file` };
    if (used.has(index)) return { ok: false, code: 50035, error: `Invalid Form Body: files[${index}] was sent more than once` };
    used.add(index);
    files.push({ index, file: value });
  }
  if (files.length > MAX_BOT_FILES) return { ok: false, code: 50035, error: `Invalid Form Body: at most ${MAX_BOT_FILES} files per message` };
  files.sort((a, b) => a.index - b.index);

  let payload: Record<string, unknown> = {};
  if ('payload_json' in raw) {
    const pj = raw.payload_json;
    if (typeof pj === 'string') {
      try {
        const parsed = JSON.parse(pj);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return { ok: false, code: 50035, error: 'Invalid Form Body: payload_json must be a JSON object' };
        }
        payload = parsed as Record<string, unknown>;
      } catch {
        return { ok: false, code: 50109, error: 'The request body contains invalid JSON.' };
      }
    } else if (pj && typeof pj === 'object' && !Array.isArray(pj) && !isFileLike(pj)) {
      payload = pj as Record<string, unknown>;
    } else {
      return { ok: false, code: 50035, error: 'Invalid Form Body: payload_json must be a JSON object' };
    }
  } else {
    // Plain form fields (content=..., tts=true, embeds=<json>, ...).
    for (const [k, v] of Object.entries(raw)) {
      if (FILE_KEY.test(k) || k === 'file' || typeof v !== 'string') continue;
      if (JSON_FORM_FIELDS.has(k)) {
        try { payload[k] = JSON.parse(v); } catch { return { ok: false, code: 50109, error: 'The request body contains invalid JSON.' }; }
      } else if (k === 'flags') payload[k] = Number(v);
      else if (k === 'tts') payload[k] = v === 'true';
      else payload[k] = v;
    }
  }
  return { ok: true, payload, files, multipart: true };
}

export interface AttachmentMeta {
  filename?: string;
  description?: string;
  durationSecs?: number;
  waveform?: string;
}

export type AttachmentPlan =
  | { ok: true; keepExistingIds: string[] | null; meta: Map<number, AttachmentMeta> }
  | { ok: false; error: string };

/**
 * Read `attachments` from the payload. Entries whose `id` is the index of an
 * uploaded file carry its filename / description (and voice-message fields);
 * on edit, the other entries name existing attachments to keep.
 * `keepExistingIds` is null when the payload has no `attachments` (keep all).
 */
export function planAttachments(opts: {
  payloadAttachments: unknown;
  fileIndexes: readonly number[];
  existingIds?: readonly string[];
  mode: 'create' | 'edit';
}): AttachmentPlan {
  const meta = new Map<number, AttachmentMeta>();
  if (opts.payloadAttachments === undefined || opts.payloadAttachments === null) {
    return { ok: true, keepExistingIds: null, meta };
  }
  if (!Array.isArray(opts.payloadAttachments)) return { ok: false, error: 'attachments must be an array' };
  const fileIdx = new Set(opts.fileIndexes);
  const existing = new Set((opts.existingIds ?? []).map(String));
  const keep: string[] = [];
  for (let i = 0; i < opts.payloadAttachments.length; i++) {
    const a = opts.payloadAttachments[i];
    if (!a || typeof a !== 'object') return { ok: false, error: `attachments[${i}] must be an object` };
    const entry = a as Record<string, unknown>;
    const rawId = entry.id;
    const idStr = typeof rawId === 'number' || typeof rawId === 'string' ? String(rawId) : '';
    if (!idStr) return { ok: false, error: `attachments[${i}].id is required` };
    const asIndex = /^\d{1,2}$/.test(idStr) ? Number(idStr) : NaN;
    if (Number.isInteger(asIndex) && fileIdx.has(asIndex)) {
      const m: AttachmentMeta = {};
      if (entry.filename !== undefined) {
        if (typeof entry.filename !== 'string' || !entry.filename.trim() || entry.filename.length > MAX_FILENAME) {
          return { ok: false, error: `attachments[${i}].filename is invalid` };
        }
        m.filename = entry.filename.trim();
      }
      if (entry.description !== undefined && entry.description !== null) {
        if (typeof entry.description !== 'string' || entry.description.length > MAX_DESCRIPTION) {
          return { ok: false, error: `attachments[${i}].description must be at most ${MAX_DESCRIPTION} characters` };
        }
        m.description = entry.description;
      }
      if (typeof entry.duration_secs === 'number' && Number.isFinite(entry.duration_secs)) m.durationSecs = entry.duration_secs;
      if (typeof entry.waveform === 'string') m.waveform = entry.waveform;
      meta.set(asIndex, m);
      continue;
    }
    if (opts.mode === 'edit' && existing.has(idStr)) {
      keep.push(idStr);
      continue;
    }
    return {
      ok: false,
      error: opts.mode === 'edit'
        ? `attachments[${i}].id is neither an uploaded file index nor an attachment of this message`
        : `attachments[${i}].id does not reference an uploaded files[n]`,
    };
  }
  return { ok: true, keepExistingIds: opts.mode === 'edit' ? keep : null, meta };
}

/** Width/height of a PNG, GIF, JPEG or WebP from its leading bytes, or null. */
export function imageDimensions(b: Uint8Array): { width: number; height: number } | null {
  const u16be = (o: number) => (b[o] << 8) | b[o + 1];
  const u16le = (o: number) => b[o] | (b[o + 1] << 8);
  const u32be = (o: number) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
  const ok = (width: number, height: number) => (width > 0 && height > 0 ? { width, height } : null);
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return ok(u32be(16), u32be(20));
  }
  if (b.length >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return ok(u16le(6), u16le(8));
  }
  if (b.length >= 30 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (chunk === 'VP8X') return ok(1 + (b[24] | (b[25] << 8) | (b[26] << 16)), 1 + (b[27] | (b[28] << 8) | (b[29] << 16)));
    if (chunk === 'VP8 ') return ok(u16le(26) & 0x3fff, u16le(28) & 0x3fff);
    if (chunk === 'VP8L') {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return ok((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
    }
    return null;
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) { o++; continue; }
      const marker = b[o + 1];
      if (marker === 0xff) { o++; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { o += 2; continue; }
      const len = u16be(o + 2);
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return ok(u16be(o + 7), u16be(o + 5));
      if (len < 2) return null;
      o += 2 + len;
    }
  }
  return null;
}

/** Discord: a filename starting with SPOILER_ marks the file as a spoiler. */
export function isSpoilerFilename(name: string): boolean {
  return name.startsWith('SPOILER_');
}

const extOf = (name: string) => {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
};

/**
 * The display filename for an upload: `attachments[].filename` may rename the
 * file but not change its extension (the type whitelist was checked against
 * the uploaded name). Returns null when the override is not allowed.
 */
export function effectiveFilename(uploaded: string, override?: string): string | null {
  if (!override) return uploaded;
  return extOf(override) === extOf(uploaded) ? override : null;
}
