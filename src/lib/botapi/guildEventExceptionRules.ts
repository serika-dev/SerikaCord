/**
 * Scheduled event exceptions (overrides of one occurrence of a recurring
 * event) and user counts for the Discord-compatible bot API. Pure; tested in
 * tests/guildparity-events.test.ts.
 *
 * Serika's scheduled events don't recur (recurrence_rule is always null), so
 * no event can have exceptions: creating one answers 50035 on
 * original_scheduled_start_time after the body validated, and every exception
 * id is unknown.
 */
import type { FieldError } from './guildSearchRules';

const ID_RE = /^(?:\d{1,20}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
export const MAX_EXCEPTION_IDS = 10;

export interface ExceptionFields {
  originalScheduledStartTime?: string;
  scheduledStartTime?: string | null;
  scheduledEndTime?: string | null;
  isCanceled?: boolean | null;
}

const isDate = (v: unknown) => typeof v === 'string' && Number.isFinite(new Date(v).getTime());

/** POST (create) / PATCH exception body. */
export function parseExceptionBody(body: unknown, opts: { create: boolean }): { ok: true; fields: ExceptionFields } | { ok: false; errors: FieldError[] } {
  const b = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  const errors: FieldError[] = [];
  const fields: ExceptionFields = {};
  if (opts.create) {
    if (b.original_scheduled_start_time === undefined || b.original_scheduled_start_time === null) errors.push({ path: 'original_scheduled_start_time', code: 'BASE_TYPE_REQUIRED', message: 'This field is required' });
    else if (!isDate(b.original_scheduled_start_time)) errors.push({ path: 'original_scheduled_start_time', code: 'DATE_TYPE_PARSE', message: 'Could not parse date.' });
    else fields.originalScheduledStartTime = b.original_scheduled_start_time as string;
  }
  for (const [key, prop] of [['scheduled_start_time', 'scheduledStartTime'], ['scheduled_end_time', 'scheduledEndTime']] as const) {
    const v = b[key];
    if (v === undefined) continue;
    if (v !== null && !isDate(v)) errors.push({ path: key, code: 'DATE_TYPE_PARSE', message: 'Could not parse date.' });
    else fields[prop] = v as string | null;
  }
  if (b.is_canceled !== undefined) {
    if (b.is_canceled !== null && typeof b.is_canceled !== 'boolean') errors.push({ path: 'is_canceled', code: 'BASE_TYPE_BAD_TYPE', message: 'Must be either true or false.' });
    else fields.isCanceled = b.is_canceled as boolean | null;
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, fields };
}

/** `guild_scheduled_event_exception_ids` (array query string, at most 10 ids). */
export function parseExceptionIds(v: unknown): { ok: true; ids: string[] } | { ok: false; errors: FieldError[] } {
  const raw = Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v];
  const ids = [...new Set(raw.flatMap((x) => String(x).split(',')).map((s) => s.trim()).filter(Boolean))];
  if (ids.length > MAX_EXCEPTION_IDS) return { ok: false, errors: [{ path: 'guild_scheduled_event_exception_ids', code: 'BASE_TYPE_MAX_LENGTH', message: `Must be ${MAX_EXCEPTION_IDS} or fewer in length.` }] };
  const bad = ids.findIndex((id) => !ID_RE.test(id));
  if (bad >= 0) return { ok: false, errors: [{ path: `guild_scheduled_event_exception_ids.${bad}`, code: 'NUMBER_TYPE_COERCE', message: `Value "${ids[bad]}" is not snowflake.` }] };
  return { ok: true, ids };
}

/** The error for an exception on a non-recurring event. */
export const NOT_RECURRING_ERROR: FieldError = {
  path: 'original_scheduled_start_time',
  code: 'GUILD_SCHEDULED_EVENT_NOT_RECURRING',
  message: 'Exceptions can only be created for recurring events.',
};

/** GET .../{exception_id}/users query: with_member (bool), limit (1-100), before / after (user ids). */
export function parseExceptionUsersQuery(q: Record<string, unknown>): { ok: true } | { ok: false; errors: FieldError[] } {
  const errors: FieldError[] = [];
  const one = (v: unknown) => (v === undefined || v === null || v === '' ? null : String(Array.isArray(v) ? v[v.length - 1] : v));
  const wm = one(q.with_member);
  if (wm !== null && !['true', 'false', '1', '0'].includes(wm.toLowerCase())) errors.push({ path: 'with_member', code: 'BOOLEAN_TYPE_COERCE', message: `Value "${wm}" is not a boolean.` });
  const limit = one(q.limit);
  if (limit !== null && (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 100)) errors.push({ path: 'limit', code: 'NUMBER_TYPE_MAX', message: 'int value should be between 1 and 100.' });
  for (const key of ['before', 'after'] as const) {
    const v = one(q[key]);
    if (v !== null && !ID_RE.test(v)) errors.push({ path: key, code: 'NUMBER_TYPE_COERCE', message: `Value "${v}" is not snowflake.` });
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}
