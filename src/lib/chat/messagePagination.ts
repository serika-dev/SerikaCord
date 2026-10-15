/**
 * Cursor rules for the bot API's `GET /channels/{id}/messages` (pure).
 *
 * Discord semantics:
 * - `limit` 1..100, default 50 (anything else is a 50035 error)
 * - `around`, `before`, `after` are mutually exclusive; when several are sent
 *   the first of around > before > after wins (as Discord does)
 * - `before` = the `limit` newest messages older than the cursor,
 *   `after` = the `limit` OLDEST messages newer than the cursor (so a loop
 *   that keeps passing the newest id it saw walks forward without gaps),
 *   `around` = the cursor message itself plus messages on both sides
 * - the response is always newest first
 *
 * A cursor is a message id (rows are paged by (created_at, id), so messages
 * created in the same millisecond are neither skipped nor repeated) or a raw
 * Discord snowflake whose timestamp is used directly (date-based cursors such
 * as `SnowflakeUtil.generate(date)` from discord.js). A message id that no
 * longer exists simply yields an empty page instead of an error.
 */
import { addFormError, type FormErrorTree } from './discordFormErrors';

export const DISCORD_EPOCH_MS = 1420070400000n;
export const DEFAULT_MESSAGE_PAGE = 50;
export const MAX_MESSAGE_PAGE = 100;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SNOWFLAKE_RE = /^\d{1,20}$/;

export type PageCursor =
  | { kind: 'message'; id: string }
  | { kind: 'time'; at: Date };

export type PageMode = 'latest' | 'before' | 'after' | 'around';

export interface MessagePageQuery {
  mode: PageMode;
  cursor: PageCursor | null;
  limit: number;
}

/** Milliseconds encoded in a Discord snowflake, or null when it isn't one. */
export function snowflakeTimestamp(value: string): number | null {
  if (!SNOWFLAKE_RE.test(value)) return null;
  try {
    const n = BigInt(value);
    if (n >= 1n << 64n) return null;
    return Number((n >> 22n) + DISCORD_EPOCH_MS);
  } catch {
    return null;
  }
}

export function parsePageCursor(value: string): PageCursor | null {
  const v = value.trim();
  if (UUID_RE.test(v)) return { kind: 'message', id: v.toLowerCase() };
  const ms = snowflakeTimestamp(v);
  if (ms !== null) return { kind: 'time', at: new Date(ms) };
  return null;
}

/** Parse an integer query `limit` the Discord way (strings of digits only). */
export function parseLimit(
  raw: unknown,
  opts: { def: number; min: number; max: number; field?: string },
  errors: FormErrorTree,
): number {
  const field = opts.field ?? 'limit';
  if (raw === undefined || raw === null || raw === '') return opts.def;
  const s = String(raw).trim();
  if (!/^-?\d+$/.test(s)) {
    addFormError(errors, [field], 'NUMBER_TYPE_COERCE', `Value "${s}" is not int.`);
    return opts.def;
  }
  const n = Number(s);
  if (n < opts.min) {
    addFormError(errors, [field], 'NUMBER_TYPE_MIN', `int value should be greater than or equal to ${opts.min}.`);
    return opts.def;
  }
  if (n > opts.max) {
    addFormError(errors, [field], 'NUMBER_TYPE_MAX', `int value should be less than or equal to ${opts.max}.`);
    return opts.def;
  }
  return n;
}

export function parseMessagePageQuery(query: Record<string, unknown>):
  | { ok: true; query: MessagePageQuery }
  | { ok: false; errors: FormErrorTree } {
  const errors: FormErrorTree = {};
  const limit = parseLimit(query.limit, { def: DEFAULT_MESSAGE_PAGE, min: 1, max: MAX_MESSAGE_PAGE }, errors);
  let mode: PageMode = 'latest';
  let cursor: PageCursor | null = null;
  for (const key of ['around', 'before', 'after'] as const) {
    const raw = query[key];
    if (raw === undefined || raw === null || raw === '') continue;
    const parsed = parsePageCursor(String(raw));
    if (!parsed) {
      addFormError(errors, [key], 'SNOWFLAKE_TYPE_INVALID', `Value "${String(raw)}" is not snowflake.`);
      break;
    }
    mode = key;
    cursor = parsed;
    break;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, query: { mode, cursor, limit } };
}

/** How many messages `around` takes on each side: newer, and older including the cursor itself. */
export function aroundSplit(limit: number): { newer: number; olderInclusive: number } {
  const newer = Math.floor(limit / 2);
  return { newer, olderInclusive: limit - newer };
}

export interface PageRow {
  id: string;
  createdAt: Date | string | null;
}

function ts(r: PageRow): number {
  if (!r.createdAt) return 0;
  return r.createdAt instanceof Date ? r.createdAt.getTime() : Date.parse(String(r.createdAt));
}

/** Newest first by (createdAt, id), duplicates removed. */
export function sortNewestFirst<T extends PageRow>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    const k = r.id.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out.sort((a, b) => ts(b) - ts(a) || (a.id.toLowerCase() < b.id.toLowerCase() ? 1 : a.id.toLowerCase() > b.id.toLowerCase() ? -1 : 0));
}

// ─── Reaction users (GET …/reactions/{emoji}) ─────────────

/**
 * One page of reactors: ordered by user id ascending, strictly after `after`
 * (the last id of the previous page), at most `limit`. Burst reactions
 * (`type=1`) don't exist on Serika, so that type is always empty.
 */
export function pageReactionUsers(userIds: string[], opts: { after?: string | null; limit: number; type?: number }): string[] {
  if (opts.type === 1) return [];
  const sorted = [...new Set(userIds.map((id) => id.toLowerCase()))].sort();
  const after = opts.after ? opts.after.toLowerCase() : null;
  const start = after ? sorted.findIndex((id) => id > after) : 0;
  if (start === -1) return [];
  return sorted.slice(start, start + opts.limit);
}
