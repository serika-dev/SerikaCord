/**
 * GET /guilds/{guild.id}/messages/search: Discord's query string -> a
 * validated, normalized search (pure; tested in tests/guildparity-search.test.ts).
 * The service (./guildSearch.ts) maps it onto Serika's message search
 * (src/lib/services/messageSearch.ts).
 *
 * Array params are Discord "array query strings" (the key repeated); a single
 * value or a comma-separated id list is accepted too. Id lists keep their raw
 * values (UUIDs or snowflakes); the service resolves them.
 */
import type { SearchAuthorType, SearchHas, SearchSort } from '@/lib/chat/searchQuery';

export const SEARCH_HAS_OPTIONS = ['link', 'embed', 'file', 'image', 'video', 'sound', 'sticker', 'poll', 'snapshot'] as const;
export type DiscordSearchHas = (typeof SEARCH_HAS_OPTIONS)[number];
export const SEARCH_AUTHOR_TYPES = ['user', 'bot', 'webhook'] as const;
export const SEARCH_EMBED_TYPES = ['image', 'video', 'gif', 'sound', 'article'] as const;
export type DiscordSearchEmbedType = (typeof SEARCH_EMBED_TYPES)[number];

export const SEARCH_LIMIT_MAX = 25;
export const SEARCH_OFFSET_MAX = 9975;
export const SEARCH_CONTENT_MAX = 1024;

export interface GuildSearchQuery {
  content: string;
  slop: number;
  authorIds: string[];
  /** Author types to keep: null = no author-type filter, [] = nothing can match. */
  authorTypes: SearchAuthorType[] | null;
  mentions: string[];
  mentionRoleIds: string[];
  repliedToUserIds: string[];
  repliedToMessageIds: string[];
  mentionEveryone: boolean | null;
  pinned: boolean | null;
  includeNsfw: boolean;
  minId: string | null;
  maxId: string | null;
  limit: number;
  offset: number;
  hasInclude: DiscordSearchHas[];
  hasExclude: DiscordSearchHas[];
  linkHostnames: string[];
  embedProviders: string[];
  embedTypes: DiscordSearchEmbedType[];
  attachmentExtensions: string[];
  attachmentFilenames: string[];
  channelIds: string[];
  sortBy: 'timestamp' | 'relevance';
  sortOrder: 'asc' | 'desc';
}

export interface FieldError { path: string; code: string; message: string }

const ID_RE = /^(?:\d{1,20}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function list(v: unknown, splitCommas: boolean): string[] {
  const raw = Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' && typeof item !== 'number') continue;
    const s = String(item);
    for (const part of splitCommas ? s.split(',') : [s]) {
      const t = part.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

function bool(v: unknown, path: string, errors: FieldError[]): boolean | null {
  if (v === undefined || v === null || v === '') return null;
  const s = String(Array.isArray(v) ? v[v.length - 1] : v).toLowerCase();
  if (s === 'true' || s === '1') return true;
  if (s === 'false' || s === '0') return false;
  errors.push({ path, code: 'BOOLEAN_TYPE_COERCE', message: `Value "${String(v)}" is not a boolean.` });
  return null;
}

function int(v: unknown, path: string, min: number, max: number, fallback: number, errors: FieldError[]): number {
  if (v === undefined || v === null || v === '') return fallback;
  const s = String(Array.isArray(v) ? v[v.length - 1] : v);
  if (!/^-?\d+$/.test(s)) {
    errors.push({ path, code: 'NUMBER_TYPE_COERCE', message: `Value "${s}" is not int.` });
    return fallback;
  }
  const n = Number(s);
  if (n < min) { errors.push({ path, code: 'NUMBER_TYPE_MIN', message: `int value should be greater than or equal to ${min}.` }); return fallback; }
  if (n > max) { errors.push({ path, code: 'NUMBER_TYPE_MAX', message: `int value should be less than or equal to ${max}.` }); return fallback; }
  return n;
}

function ids(v: unknown, path: string, max: number, errors: FieldError[]): string[] {
  const values = [...new Set(list(v, true))];
  if (values.length > max) { errors.push({ path, code: 'BASE_TYPE_MAX_LENGTH', message: `Must be ${max} or fewer in length.` }); return []; }
  values.forEach((id, i) => {
    if (!ID_RE.test(id)) errors.push({ path: `${path}.${i}`, code: 'NUMBER_TYPE_COERCE', message: `Value "${id}" is not snowflake.` });
  });
  return values.filter((id) => ID_RE.test(id));
}

function strings(v: unknown, path: string, max: number, maxLen: number, errors: FieldError[]): string[] {
  const values = [...new Set(list(v, false))];
  if (values.length > max) { errors.push({ path, code: 'BASE_TYPE_MAX_LENGTH', message: `Must be ${max} or fewer in length.` }); return []; }
  values.forEach((s, i) => {
    if (s.length > maxLen) errors.push({ path: `${path}.${i}`, code: 'BASE_TYPE_MAX_LENGTH', message: `Must be ${maxLen} or fewer in length.` });
  });
  return values.filter((s) => s.length <= maxLen);
}

function choices<T extends string>(v: unknown, path: string, allowed: readonly T[], negatable: boolean, max: number, errors: FieldError[]): { include: T[]; exclude: T[] } {
  const values = [...new Set(list(v, false).map((s) => s.toLowerCase()))];
  const include: T[] = [];
  const exclude: T[] = [];
  if (values.length > max) { errors.push({ path, code: 'BASE_TYPE_MAX_LENGTH', message: `Must be ${max} or fewer in length.` }); return { include, exclude }; }
  values.forEach((s, i) => {
    const neg = negatable && s.startsWith('-');
    const name = (neg ? s.slice(1) : s) as T;
    if (!allowed.includes(name)) {
      const all = negatable ? [...allowed, ...allowed.map((a) => `-${a}`)] : [...allowed];
      errors.push({ path: `${path}.${i}`, code: 'BASE_TYPE_CHOICES', message: `Value must be one of {${all.map((a) => `'${a}'`).join(', ')}}.` });
      return;
    }
    (neg ? exclude : include).push(name);
  });
  return { include, exclude };
}

function single(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  return String(Array.isArray(v) ? v[v.length - 1] : v);
}

/**
 * Author types left after Discord's include / `-exclude` lists: null when
 * nothing narrows the authors, an empty list when nothing can match.
 */
export function resolveAuthorTypes(include: readonly SearchAuthorType[], exclude: readonly SearchAuthorType[]): SearchAuthorType[] | null {
  if (include.length === 0 && exclude.length === 0) return null;
  const base: SearchAuthorType[] = include.length > 0 ? [...new Set(include)] : [...SEARCH_AUTHOR_TYPES];
  const left = base.filter((t) => !exclude.includes(t));
  return left.length === SEARCH_AUTHOR_TYPES.length ? null : left;
}

/** Validate and normalize Discord's query string. */
export function parseGuildSearchQuery(q: Record<string, unknown>): { ok: true; query: GuildSearchQuery } | { ok: false; errors: FieldError[] } {
  const errors: FieldError[] = [];
  const content = single(q.content) ?? '';
  if (content.length > SEARCH_CONTENT_MAX) errors.push({ path: 'content', code: 'BASE_TYPE_MAX_LENGTH', message: `Must be ${SEARCH_CONTENT_MAX} or fewer in length.` });

  const sortByRaw = (single(q.sort_by) ?? 'timestamp').toLowerCase();
  if (sortByRaw !== 'timestamp' && sortByRaw !== 'relevance') errors.push({ path: 'sort_by', code: 'BASE_TYPE_CHOICES', message: "Value must be one of {'timestamp', 'relevance'}." });
  const sortOrderRaw = (single(q.sort_order) ?? 'desc').toLowerCase();
  if (sortOrderRaw !== 'asc' && sortOrderRaw !== 'desc') errors.push({ path: 'sort_order', code: 'BASE_TYPE_CHOICES', message: "Value must be one of {'asc', 'desc'}." });

  const authorTypes = choices(q.author_type, 'author_type', SEARCH_AUTHOR_TYPES, true, 6, errors);
  const has = choices(q.has, 'has', SEARCH_HAS_OPTIONS, true, 18, errors);
  const embedTypes = choices(q.embed_type, 'embed_type', SEARCH_EMBED_TYPES, false, 5, errors);

  const minId = single(q.min_id);
  const maxId = single(q.max_id);
  if (minId !== null && !ID_RE.test(minId)) errors.push({ path: 'min_id', code: 'NUMBER_TYPE_COERCE', message: `Value "${minId}" is not snowflake.` });
  if (maxId !== null && !ID_RE.test(maxId)) errors.push({ path: 'max_id', code: 'NUMBER_TYPE_COERCE', message: `Value "${maxId}" is not snowflake.` });

  const query: GuildSearchQuery = {
    content: content.trim(),
    slop: int(q.slop, 'slop', 0, 100, 2, errors),
    authorIds: ids(q.author_id, 'author_id', 100, errors),
    authorTypes: resolveAuthorTypes(authorTypes.include, authorTypes.exclude),
    mentions: ids(q.mentions, 'mentions', 100, errors),
    mentionRoleIds: ids(q.mentions_role_id, 'mentions_role_id', 100, errors),
    repliedToUserIds: ids(q.replied_to_user_id, 'replied_to_user_id', 100, errors),
    repliedToMessageIds: ids(q.replied_to_message_id, 'replied_to_message_id', 100, errors),
    mentionEveryone: bool(q.mention_everyone, 'mention_everyone', errors),
    pinned: bool(q.pinned, 'pinned', errors),
    includeNsfw: bool(q.include_nsfw, 'include_nsfw', errors) ?? false,
    minId: minId !== null && ID_RE.test(minId) ? minId : null,
    maxId: maxId !== null && ID_RE.test(maxId) ? maxId : null,
    limit: int(q.limit, 'limit', 1, SEARCH_LIMIT_MAX, SEARCH_LIMIT_MAX, errors),
    offset: int(q.offset, 'offset', 0, SEARCH_OFFSET_MAX, 0, errors),
    hasInclude: has.include,
    hasExclude: has.exclude,
    linkHostnames: strings(q.link_hostname, 'link_hostname', 100, 256, errors).map((h) => h.toLowerCase().replace(/^\*\./, '')),
    embedProviders: strings(q.embed_provider, 'embed_provider', 100, 256, errors),
    embedTypes: embedTypes.include,
    attachmentExtensions: strings(q.attachment_extension, 'attachment_extension', 100, 256, errors).map((e) => e.toLowerCase().replace(/^\./, '')),
    attachmentFilenames: strings(q.attachment_filename, 'attachment_filename', 100, 1024, errors),
    channelIds: ids(q.channel_id, 'channel_id', 500, errors),
    sortBy: sortByRaw === 'relevance' ? 'relevance' : 'timestamp',
    sortOrder: sortOrderRaw === 'asc' ? 'asc' : 'desc',
  };
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, query };
}

/** Filters that read message content, embeds or attachments (need the MESSAGE_CONTENT intent). */
export function usesContentFilters(q: GuildSearchQuery): boolean {
  return Boolean(
    q.content
    || q.linkHostnames.length || q.embedProviders.length || q.embedTypes.length
    || q.attachmentExtensions.length || q.attachmentFilenames.length
    || q.hasInclude.length || q.hasExclude.length,
  );
}

/** Serika's sort for Discord's sort_by / sort_order (order is ignored for relevance, like Discord). */
export function searchSortFor(q: Pick<GuildSearchQuery, 'sortBy' | 'sortOrder' | 'content'>): SearchSort {
  if (q.sortBy === 'relevance' && q.content) return 'relevant';
  return q.sortOrder === 'asc' ? 'oldest' : 'newest';
}

/** Discord `has` values Serika's search understands natively (snapshot is handled separately). */
export function serikaHas(list: readonly DiscordSearchHas[]): SearchHas[] {
  return list.filter((h): h is SearchHas => h !== 'snapshot');
}

const URL_RE = /\bhttps?:\/\/[^\s<>()"']+/gi;

/** Lower-cased host names of the http(s) links in `text`. */
export function linkHostnames(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(URL_RE)) {
    try {
      out.add(new URL(m[0]).hostname.toLowerCase());
    } catch { /* not a URL */ }
  }
  return [...out];
}

/** Whether `host` is one of `wanted` or a subdomain of one. */
export function hostMatches(host: string, wanted: readonly string[]): boolean {
  const h = host.toLowerCase();
  return wanted.some((w) => h === w || h.endsWith(`.${w}`));
}

/** Whether a message links to one of `wanted` (content links or embed URLs). */
export function messageLinksTo(content: string, embeds: unknown, wanted: readonly string[]): boolean {
  if (wanted.length === 0) return true;
  const hosts = linkHostnames(content);
  for (const e of Array.isArray(embeds) ? embeds : []) {
    const url = e && typeof e === 'object' ? (e as { url?: unknown }).url : null;
    if (typeof url === 'string') hosts.push(...linkHostnames(url));
  }
  return hosts.some((h) => hostMatches(h, wanted));
}

/** A SQL LIKE pattern matching a literal string (escapes %, _ and \). */
export function likeLiteral(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * The request's query with Discord "array query strings" kept: Elysia keeps
 * only the last value of a repeated key, so repeated keys are read from the
 * URL (as arrays); single values come from `parsed` (already translated by
 * the snowflake boundary where it applies).
 */
export function arrayQuery(url: string, parsed: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...parsed };
  let params: URLSearchParams;
  try {
    params = new URL(url, 'http://localhost').searchParams;
  } catch {
    return out;
  }
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    if (values.length > 1) out[key] = values;
    else if (out[key] === undefined) out[key] = values[0];
  }
  return out;
}
