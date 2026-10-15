/**
 * Validation + normalization of bot / webhook `embeds` (pure), with Discord's
 * limits and error codes:
 *
 * - at most 10 embeds per message
 * - title 256, description 4096, 25 fields, field name 256 / value 1024,
 *   footer text 2048, author name 256 characters
 * - the title, description, field names and values, footer text and author
 *   names of ALL embeds together at most 6000 characters
 * - URLs must be http(s) (image / thumbnail / author icon / footer icon may
 *   also be `attachment://<filename>`, resolved to the file uploaded with the
 *   same request or kept on the message)
 * - color 0..0xFFFFFF, timestamp ISO8601
 *
 * Unknown keys are dropped, `type` is always "rich" and `video` / `provider`
 * are ignored (bots can't set them on Discord either). The output is what the
 * web client renders (RichEmbed) and what bots read back.
 */
import { addFormError, hasFormErrors, type FormErrorTree } from './discordFormErrors';
import type { MessageEmbed } from './types';

export const EMBED_LIMITS = {
  embeds: 10,
  title: 256,
  description: 4096,
  fields: 25,
  fieldName: 256,
  fieldValue: 1024,
  footerText: 2048,
  authorName: 256,
  url: 2048,
} as const;

/** Total characters across every embed of one message. */
export const EMBED_TOTAL_LIMIT = 6000;

export type EmbedValidationResult =
  | { ok: true; embeds: MessageEmbed[] }
  | { ok: false; errors: FormErrorTree };

type Path = Array<string | number>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Check a URL field. Returns the URL to store, or undefined (field dropped).
 * `attachments` maps `attachment://` filenames to their CDN URLs.
 */
function checkUrl(
  raw: unknown,
  path: Path,
  errors: FormErrorTree,
  opts: { allowAttachment: boolean; attachments: ReadonlyMap<string, string> },
): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string') {
    addFormError(errors, path, 'BASE_TYPE_STRING', 'Must be a string.');
    return undefined;
  }
  const value = raw.trim();
  if (!value) return undefined;
  if (value.length > EMBED_LIMITS.url) {
    addFormError(errors, path, 'BASE_TYPE_MAX_LENGTH', `Must be ${EMBED_LIMITS.url} or fewer in length.`);
    return undefined;
  }
  if (opts.allowAttachment && value.toLowerCase().startsWith('attachment://')) {
    const name = value.slice('attachment://'.length);
    // Discord silently drops a reference to a file that isn't on the message.
    return opts.attachments.get(name);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    addFormError(errors, path, 'URL_TYPE_INVALID_URL', 'Not a well formed URL.');
    return undefined;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    addFormError(errors, path, 'URL_TYPE_INVALID_SCHEME', `Scheme "${parsed.protocol.replace(/:$/, '')}" is not supported. Scheme must be one of ('http', 'https').`);
    return undefined;
  }
  return parsed.toString();
}

function checkString(
  raw: unknown,
  path: Path,
  max: number,
  errors: FormErrorTree,
  opts: { required?: boolean } = {},
): string | undefined {
  if (raw === undefined || raw === null) {
    if (opts.required) addFormError(errors, path, 'BASE_TYPE_REQUIRED', 'This field is required');
    return undefined;
  }
  if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') {
    addFormError(errors, path, 'BASE_TYPE_STRING', 'Must be a string.');
    return undefined;
  }
  const value = String(raw);
  if (opts.required && value.trim().length === 0) {
    addFormError(errors, path, 'BASE_TYPE_REQUIRED', 'This field is required');
    return undefined;
  }
  if (value.length > max) {
    addFormError(errors, path, 'BASE_TYPE_MAX_LENGTH', `Must be ${max} or fewer in length.`);
    return undefined;
  }
  return value;
}

/** Characters an embed counts toward the 6000 total. */
export function embedTextLength(e: MessageEmbed): number {
  let n = (e.title?.length ?? 0) + (e.description?.length ?? 0) + (e.footer?.text?.length ?? 0) + (e.author?.name?.length ?? 0);
  for (const f of e.fields ?? []) n += (f.name?.length ?? 0) + (f.value?.length ?? 0);
  return n;
}

/**
 * Validate a request's `embeds` (undefined / null = none). `attachments` maps
 * the filenames of the message's files to their URLs for `attachment://`.
 * `field` is the body key used in error paths ("embeds", or "embed" for the
 * legacy single-embed field).
 */
export function validateEmbeds(
  raw: unknown,
  opts: { attachments?: ReadonlyMap<string, string>; field?: string } = {},
): EmbedValidationResult {
  const field = opts.field ?? 'embeds';
  const attachments = opts.attachments ?? new Map<string, string>();
  if (raw === undefined || raw === null) return { ok: true, embeds: [] };
  const errors: FormErrorTree = {};
  if (!Array.isArray(raw)) {
    addFormError(errors, [field], 'BASE_TYPE_ARRAY', 'Must be an array.');
    return { ok: false, errors };
  }
  if (raw.length > EMBED_LIMITS.embeds) {
    addFormError(errors, [field], 'BASE_TYPE_MAX_LENGTH', `Must be ${EMBED_LIMITS.embeds} or fewer in length.`);
    return { ok: false, errors };
  }
  const out: MessageEmbed[] = [];
  raw.forEach((item, i) => {
    const base: Path = [field, i];
    if (!isPlainObject(item)) {
      addFormError(errors, base, 'MODEL_TYPE_CONVERT', 'Only dictionaries may be used in a ModelType');
      return;
    }
    const e: MessageEmbed = { type: 'rich' };
    const title = checkString(item.title, [...base, 'title'], EMBED_LIMITS.title, errors);
    if (title) e.title = title;
    const description = checkString(item.description, [...base, 'description'], EMBED_LIMITS.description, errors);
    if (description) e.description = description;
    const url = checkUrl(item.url, [...base, 'url'], errors, { allowAttachment: false, attachments });
    if (url) e.url = url;

    if (item.timestamp !== undefined && item.timestamp !== null) {
      const t = typeof item.timestamp === 'string' ? Date.parse(item.timestamp) : NaN;
      if (!Number.isFinite(t)) addFormError(errors, [...base, 'timestamp'], 'DATE_TYPE_PARSE', `Could not parse ${String(item.timestamp)}. Should be ISO8601.`);
      else e.timestamp = new Date(t).toISOString();
    }
    if (item.color !== undefined && item.color !== null) {
      const c = Number(item.color);
      if (!Number.isInteger(c)) addFormError(errors, [...base, 'color'], 'NUMBER_TYPE_COERCE', `Value "${String(item.color)}" is not int.`);
      else if (c < 0) addFormError(errors, [...base, 'color'], 'NUMBER_TYPE_MIN', 'int value should be greater than or equal to 0.');
      else if (c > 0xffffff) addFormError(errors, [...base, 'color'], 'NUMBER_TYPE_MAX', 'int value should be less than or equal to 16777215.');
      else e.color = c;
    }

    if (item.footer !== undefined && item.footer !== null) {
      if (!isPlainObject(item.footer)) addFormError(errors, [...base, 'footer'], 'MODEL_TYPE_CONVERT', 'Only dictionaries may be used in a ModelType');
      else {
        const text = checkString(item.footer.text, [...base, 'footer', 'text'], EMBED_LIMITS.footerText, errors, { required: true });
        const icon = checkUrl(item.footer.icon_url, [...base, 'footer', 'icon_url'], errors, { allowAttachment: true, attachments });
        if (text) e.footer = { text, ...(icon ? { icon_url: icon } : {}) };
      }
    }
    for (const key of ['image', 'thumbnail'] as const) {
      const media = item[key];
      if (media === undefined || media === null) continue;
      if (!isPlainObject(media)) {
        addFormError(errors, [...base, key], 'MODEL_TYPE_CONVERT', 'Only dictionaries may be used in a ModelType');
        continue;
      }
      const mediaUrl = checkUrl(media.url, [...base, key, 'url'], errors, { allowAttachment: true, attachments });
      if (mediaUrl) e[key] = { url: mediaUrl };
    }
    if (item.author !== undefined && item.author !== null) {
      if (!isPlainObject(item.author)) addFormError(errors, [...base, 'author'], 'MODEL_TYPE_CONVERT', 'Only dictionaries may be used in a ModelType');
      else {
        const name = checkString(item.author.name, [...base, 'author', 'name'], EMBED_LIMITS.authorName, errors, { required: true });
        const authorUrl = checkUrl(item.author.url, [...base, 'author', 'url'], errors, { allowAttachment: false, attachments });
        const icon = checkUrl(item.author.icon_url, [...base, 'author', 'icon_url'], errors, { allowAttachment: true, attachments });
        if (name) e.author = { name, ...(authorUrl ? { url: authorUrl } : {}), ...(icon ? { icon_url: icon } : {}) };
      }
    }
    if (item.fields !== undefined && item.fields !== null) {
      if (!Array.isArray(item.fields)) addFormError(errors, [...base, 'fields'], 'BASE_TYPE_ARRAY', 'Must be an array.');
      else if (item.fields.length > EMBED_LIMITS.fields) addFormError(errors, [...base, 'fields'], 'BASE_TYPE_MAX_LENGTH', `Must be ${EMBED_LIMITS.fields} or fewer in length.`);
      else {
        const fields: NonNullable<MessageEmbed['fields']> = [];
        item.fields.forEach((f, j) => {
          const fp: Path = [...base, 'fields', j];
          if (!isPlainObject(f)) {
            addFormError(errors, fp, 'MODEL_TYPE_CONVERT', 'Only dictionaries may be used in a ModelType');
            return;
          }
          const name = checkString(f.name, [...fp, 'name'], EMBED_LIMITS.fieldName, errors, { required: true });
          const value = checkString(f.value, [...fp, 'value'], EMBED_LIMITS.fieldValue, errors, { required: true });
          if (name !== undefined && value !== undefined) fields.push({ name, value, inline: f.inline === true });
        });
        if (fields.length) e.fields = fields;
      }
    }
    out.push(e);
  });
  if (!hasFormErrors(errors)) {
    const total = out.reduce((n, e) => n + embedTextLength(e), 0);
    if (total > EMBED_TOTAL_LIMIT) {
      addFormError(errors, [field], 'MAX_EMBED_SIZE_EXCEEDED', `Embed size exceeds maximum size of ${EMBED_TOTAL_LIMIT}`);
    }
  }
  if (hasFormErrors(errors)) return { ok: false, errors };
  return { ok: true, embeds: out };
}
