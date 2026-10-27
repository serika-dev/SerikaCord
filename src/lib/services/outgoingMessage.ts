/**
 * Message bodies sent by apps outside the bot channel-message routes:
 * interaction responses (callbacks 4/7, followups, @original edits) and
 * channel webhook execute / edit. One parser so they all accept the same
 * Discord fields with the same limits:
 *
 *   content (≤ MAX_MESSAGE_LENGTH), embeds (≤ 10), components (v1 / v2,
 *   lib/botapi/components), flags (SUPPRESS_EMBEDS, EPHEMERAL,
 *   SUPPRESS_NOTIFICATIONS, IS_COMPONENTS_V2), allowed_mentions, and
 *   multipart files[n] + payload_json (stored through the same upload path
 *   users get: type allowlist, size limit, Trust & Safety scanning).
 *
 * Errors come back as Discord 50035 bodies.
 */
import { config } from '@/lib/config';
import { FE, FormErrors, formError, type DiscordFormError } from '@/lib/botapi/formErrors';
import {
  IS_COMPONENTS_V2, componentsV2Conflicts, resolveAttachmentRefs, validateMessageComponents, type MessageComponent,
} from '@/lib/botapi/components';
import {
  effectiveFilename, imageDimensions, isSpoilerFilename, parseBotMessageBody, planAttachments,
  MAX_BOT_FILES, type AttachmentMeta, type FileLike,
} from '@/lib/chat/botMultipart';
import type { IncomingAttachment } from '@/lib/chat/attachmentPolicy';
import { MESSAGE_FLAGS } from '@/lib/chat/messageFlags';
import { validateEmbeds } from '@/lib/chat/embedValidation';

export const FLAG_EPHEMERAL = 1 << 6;
export const FLAG_LOADING = 1 << 7;
const SENDABLE = MESSAGE_FLAGS.SUPPRESS_EMBEDS | FLAG_EPHEMERAL | MESSAGE_FLAGS.SUPPRESS_NOTIFICATIONS | IS_COMPONENTS_V2;
const MAX_EMBEDS = 10;
const MAX_EMBEDS_JSON = 24_000;
/** Total bytes of files one app request may upload. */
export const MAX_REQUEST_UPLOAD_BYTES = 25 * 1024 * 1024;

export type ApiFailure = { ok: false; status: number; body: DiscordFormError | { code: number; message: string } };

export interface OutgoingMessage {
  /** Fields present in the request (an edit only changes these). */
  has: { content: boolean; embeds: boolean; components: boolean; flags: boolean; attachments: boolean };
  content: string;
  /** Embeds validated with placeholder URLs for new files; resolveEmbeds() gives the final ones. */
  embeds: unknown[];
  /** The request's embeds as sent (re-validated once the files' URLs are known). */
  rawEmbeds: unknown;
  components: MessageComponent[] | null;
  flags: number;
  ephemeral: boolean;
  /** User ids the message may ping (allowed_mentions applied). */
  allowedUserIds: string[] | null;
  /** Newly uploaded files (multipart). */
  newAttachments: IncomingAttachment[];
  /** Edit: ids of existing attachments to keep (null = keep all). */
  keepAttachmentIds: string[] | null;
  username?: unknown;
  avatarUrl?: unknown;
  threadName?: unknown;
  /** The request's `poll` as sent (callers that support polls validate it). */
  rawPoll?: unknown;
  tts: boolean;
  /** `attachment://` names to resolve after the existing + new files are known. */
  attachmentRefs: string[];
}

const USER_MENTION = /<@!?([0-9a-fA-F-]{36}|\d{17,20})>/g;

/** User ids mentioned in content, filtered by Discord `allowed_mentions`. */
export function allowedUserMentions(content: string, allowed: unknown): string[] {
  const found = [...new Set([...content.matchAll(USER_MENTION)].map((m) => m[1].toLowerCase()))];
  if (!allowed || typeof allowed !== 'object') return found;
  const a = allowed as { parse?: unknown; users?: unknown };
  const parse = Array.isArray(a.parse) ? a.parse : [];
  if (parse.includes('users')) return found;
  const users = Array.isArray(a.users) ? new Set(a.users.filter((u): u is string => typeof u === 'string').map((u) => u.toLowerCase())) : null;
  return users ? found.filter((id) => users.has(id)) : [];
}

/**
 * Parse an app-sent message body. `mode: 'edit'` keeps absent fields;
 * `existingAttachmentIds` lets an edit keep attachments by id.
 */
export interface OutgoingOptions {
  mode: 'create' | 'edit';
  existingAttachmentIds?: string[];
  /** Edit: file names of the message's attachments (attachment:// in embeds). */
  existingAttachmentNames?: string[];
  existingFlags?: number;
  /** Edit: whether the stored message has text / embeds (they block turning IS_COMPONENTS_V2 on). */
  existingContent?: boolean;
  existingEmbeds?: boolean;
  allowEphemeral?: boolean;
}
export type OutgoingParse = ({ ok: true; message: OutgoingMessage; files: Array<{ index: number; file: FileLike }>; fileMeta: Map<number, AttachmentMeta> }) | ApiFailure;

export function parseOutgoingMessage(body: unknown, opts: OutgoingOptions): OutgoingParse {
  const parsed = parseBotMessageBody(body);
  if (!parsed.ok) return { ok: false, status: 400, body: { code: parsed.code, message: parsed.error } };
  return parseOutgoingPayload(parsed.payload, parsed.files, opts);
}

/** Same as parseOutgoingMessage for an already split body (e.g. a callback's `data` + files). */
export function parseOutgoingPayload(
  payload: unknown,
  files: Array<{ index: number; file: FileLike }>,
  opts: OutgoingOptions,
): OutgoingParse {
  const p = (payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}) as Record<string, unknown>;
  const parsed = { files };
  const errors = new FormErrors();
  const has = {
    content: p.content !== undefined,
    embeds: p.embeds !== undefined,
    components: p.components !== undefined,
    flags: p.flags !== undefined,
    attachments: p.attachments !== undefined || parsed.files.length > 0,
  };

  let content = '';
  if (p.content !== undefined && p.content !== null) {
    if (typeof p.content !== 'string') errors.add(['content'], FE.BAD_TYPE, 'Must be a string.');
    else if (p.content.length > config.MAX_MESSAGE_LENGTH) errors.add(['content'], FE.MAX_LENGTH, `Must be ${config.MAX_MESSAGE_LENGTH} or fewer in length.`);
    else content = p.content;
  }

  // Same embed rules as bot messages (lib/chat/embedValidation: http(s) URLs
  // only, known fields only, Discord's limits). attachment:// may name a file
  // of this request; resolveEmbeds() swaps in the real URL after upload.
  let embeds: unknown[] = [];
  let embedErrors: unknown = null;
  if (p.embeds !== undefined && p.embeds !== null) {
    if (Array.isArray(p.embeds) && JSON.stringify(p.embeds).length > MAX_EMBEDS_JSON) errors.add(['embeds'], FE.MAX_LENGTH, 'Embed size exceeds maximum size of 6000');
    else {
      const placeholders = new Map<string, string>();
      for (const f of files) placeholders.set(f.file.name || `file${f.index}`, 'https://attachment.invalid/');
      for (const name of opts.existingAttachmentNames ?? []) placeholders.set(name, 'https://attachment.invalid/');
      const checked = validateEmbeds(p.embeds, { attachments: placeholders });
      if (checked.ok) embeds = checked.embeds;
      else embedErrors = checked.errors;
    }
  }
  void MAX_EMBEDS;

  let flags = opts.mode === 'edit' ? (opts.existingFlags ?? 0) : 0;
  if (p.flags !== undefined && p.flags !== null) {
    if (typeof p.flags !== 'number' || !Number.isInteger(p.flags) || p.flags < 0) errors.add(['flags'], FE.COERCE, 'Value is not int.');
    else {
      const requested = p.flags & SENDABLE;
      if (opts.mode === 'edit') {
        // Ephemeral can't change on edit; components v2 can only be turned on.
        flags = (flags & (FLAG_EPHEMERAL | IS_COMPONENTS_V2)) | (requested & ~FLAG_EPHEMERAL);
        if ((opts.existingFlags ?? 0) & IS_COMPONENTS_V2 && !(requested & IS_COMPONENTS_V2)) flags |= IS_COMPONENTS_V2;
      } else flags = requested;
    }
  }
  if (!opts.allowEphemeral) flags &= ~FLAG_EPHEMERAL;
  const v2 = (flags & IS_COMPONENTS_V2) !== 0;

  let components: MessageComponent[] | null = null;
  let attachmentRefs: string[] = [];
  if (p.components !== undefined && p.components !== null) {
    const v = validateMessageComponents(p.components, { flags, errors });
    if (v) { components = v.components; attachmentRefs = v.attachmentRefs; }
    else if (Array.isArray(p.components) && p.components.length === 0) components = [];
  }
  if (v2) {
    // content / embeds / poll / sticker_ids must be absent (an edit can't leave old text behind either).
    componentsV2Conflicts(
      errors,
      { content: p.content, embeds: p.embeds, poll: p.poll, sticker_ids: p.sticker_ids },
      opts.mode === 'edit' ? { content: Boolean(opts.existingContent), embeds: Boolean(opts.existingEmbeds) } : undefined,
    );
  }

  let fileMeta = new Map<number, AttachmentMeta>();
  let keepAttachmentIds: string[] | null = null;
  if (has.attachments) {
    const plan = planAttachments({
      payloadAttachments: p.attachments,
      fileIndexes: parsed.files.map((f) => f.index),
      existingIds: opts.existingAttachmentIds ?? [],
      mode: opts.mode,
    });
    if (!plan.ok) errors.add(['attachments'], FE.INVALID, plan.error);
    else { fileMeta = plan.meta; keepAttachmentIds = plan.keepExistingIds; }
  }
  if (parsed.files.length > MAX_BOT_FILES) errors.add(['files'], FE.MAX_LENGTH, `Must be ${MAX_BOT_FILES} or fewer in length.`);

  if (embedErrors) {
    const body = errors.toBody();
    return { ok: false, status: 400, body: { ...body, errors: { ...(body.errors as object), ...(embedErrors as object) } } as DiscordFormError };
  }
  if (!errors.ok) return { ok: false, status: 400, body: errors.toBody() };
  return {
    ok: true,
    files: parsed.files,
    fileMeta,
    message: {
      has,
      content,
      embeds,
      rawEmbeds: p.embeds,
      components,
      flags,
      ephemeral: (flags & FLAG_EPHEMERAL) !== 0,
      allowedUserIds: allowedUserMentions(content, p.allowed_mentions),
      newAttachments: [],
      keepAttachmentIds,
      username: p.username,
      avatarUrl: p.avatar_url,
      threadName: p.thread_name,
      rawPoll: p.poll,
      tts: p.tts === true,
      attachmentRefs,
    },
  };
}

/** The final embeds once the message's attachments (and their URLs) are known. */
export function resolveEmbeds(m: OutgoingMessage, attachments: IncomingAttachment[]): { ok: true; embeds: unknown[] } | ApiFailure {
  if (m.rawEmbeds === undefined || m.rawEmbeds === null) return { ok: true, embeds: m.embeds };
  const urls = new Map<string, string>();
  for (const a of attachments) if (typeof a.filename === 'string' && typeof a.url === 'string') urls.set(a.filename, a.url);
  const checked = validateEmbeds(m.rawEmbeds, { attachments: urls });
  if (!checked.ok) return { ok: false, status: 400, body: { code: 50035, message: 'Invalid Form Body', errors: checked.errors } as unknown as DiscordFormError };
  return { ok: true, embeds: checked.embeds };
}

/**
 * Message text from an app, prepared like bot messages (HTML-escaped the way
 * user text is stored, custom emoji normalized).
 */
export async function prepareAppContent(content: string): Promise<string> {
  if (!content) return '';
  const { sanitizeMessageContent } = await import('@/lib/api/channels');
  const { normalizeEmojiFormat } = await import('@/lib/services/emoji');
  return normalizeEmojiFormat(sanitizeMessageContent(content));
}

/**
 * A create must have something to show. With IS_COMPONENTS_V2 only components
 * are shown (attachments appear through file / gallery / thumbnail components),
 * so a v2 message without components is empty.
 */
export function isEmptyOutgoing(m: OutgoingMessage, attachmentCount: number): boolean {
  const hasComponents = Boolean(m.components && m.components.length);
  if ((m.flags & IS_COMPONENTS_V2) !== 0) return !hasComponents;
  return !m.content && m.embeds.length === 0 && !hasComponents && attachmentCount === 0;
}

/**
 * Store multipart files for an app message (uploader = the bot or webhook id)
 * through storeChatAttachment, with `attachments[n]` filename / description and
 * image dimensions.
 */
export async function uploadOutgoingFiles(opts: {
  files: Array<{ index: number; file: FileLike }>;
  meta: Map<number, AttachmentMeta>;
  uploaderId: string;
  channelId: string;
  ip?: string;
}): Promise<{ ok: true; attachments: IncomingAttachment[] } | ApiFailure> {
  if (opts.files.length === 0) return { ok: true, attachments: [] };
  // Byte budget per request (Discord answers 40005), checked before anything is stored.
  const total = opts.files.reduce((n, f) => n + (Number(f.file.size) || 0), 0);
  if (total > MAX_REQUEST_UPLOAD_BYTES) {
    return { ok: false, status: 413, body: { code: 40005, message: 'Request entity too large' } };
  }
  const { storeChatAttachment } = await import('@/lib/api/uploads');
  const { checkRateLimit } = await import('@/lib/security');
  const out: IncomingAttachment[] = [];
  for (const { index, file } of opts.files) {
    // Same upload budget users get, per app / webhook (each file counts).
    const limit = await checkRateLimit('upload', `app:${opts.uploaderId}`);
    if (!limit.success) {
      const retry = limit.retryAfter ?? 1;
      return { ok: false, status: 429, body: { code: 0, message: 'You are being rate limited.', retry_after: retry, global: false } as unknown as { code: number; message: string } };
    }
    const m = opts.meta.get(index) ?? {};
    const filename = effectiveFilename(file.name || `file${index}`, m.filename);
    if (!filename) return { ok: false, status: 400, body: formError(['attachments', index, 'filename'], FE.INVALID, 'The filename may not change the file extension') };
    const stored = await storeChatAttachment(file as unknown as File, {
      uploaderId: opts.uploaderId,
      channelId: opts.channelId,
      ip: opts.ip,
      spoiler: isSpoilerFilename(filename),
    });
    if (!stored.ok) {
      const code = stored.status === 413 ? 40005 : stored.status === 403 ? 20009 : 50035;
      return { ok: false, status: stored.status, body: { code, message: `files[${index}]: ${stored.error}` } };
    }
    let dims: { width: number; height: number } | null = null;
    if (stored.attachment.contentType.startsWith('image/')) {
      dims = imageDimensions(new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer()));
    }
    out.push({
      ...stored.attachment,
      filename,
      ...(dims ?? {}),
      ...(m.description !== undefined ? { description: m.description } : {}),
    });
  }
  return { ok: true, attachments: out };
}

/** Resolve `attachment://` media against the message's final attachments. */
export function finalizeComponents(
  components: MessageComponent[] | null,
  attachments: IncomingAttachment[],
): { ok: true; components: MessageComponent[] | null } | ApiFailure {
  if (!components) return { ok: true, components };
  const r = resolveAttachmentRefs(components, attachments.map((a) => ({
    id: String(a.id), filename: a.filename, url: a.url, contentType: a.contentType, width: a.width, height: a.height, size: a.size,
  })));
  if (!r.ok) return { ok: false, status: 400, body: formError(['components'], FE.INVALID, `Unknown attachment reference attachment://${r.missing}`) };
  return { ok: true, components: r.components };
}
