/**
 * Discord-shaped JSON errors for the bot API (section 4.3 of
 * docs/architecture/discord-parity.md). Pure, unit tested.
 *
 *   { "code": 50035, "message": "Invalid Form Body",
 *     "errors": { "content": { "_errors": [{ "code": "BASE_TYPE_MAX_LENGTH", "message": "..." }] } } }
 */

/** JSON error codes the bot API returns (Discord's numbering). */
export const API_ERROR = {
  GENERAL: 0,
  UNKNOWN_ACCOUNT: 10001,
  UNKNOWN_APPLICATION: 10002,
  UNKNOWN_CHANNEL: 10003,
  UNKNOWN_GUILD: 10004,
  UNKNOWN_INTEGRATION: 10005,
  UNKNOWN_INVITE: 10006,
  UNKNOWN_MEMBER: 10007,
  UNKNOWN_MESSAGE: 10008,
  UNKNOWN_OVERWRITE: 10009,
  UNKNOWN_ROLE: 10011,
  UNKNOWN_TOKEN: 10012,
  UNKNOWN_USER: 10013,
  UNKNOWN_EMOJI: 10014,
  UNKNOWN_WEBHOOK: 10015,
  UNKNOWN_BAN: 10026,
  UNKNOWN_STICKER: 10060,
  UNKNOWN_INTERACTION: 10062,
  UNKNOWN_APPLICATION_COMMAND: 10063,
  BOTS_CANNOT_USE_ENDPOINT: 20001,
  ONLY_BOTS_CAN_USE_ENDPOINT: 20002,
  UNAUTHORIZED: 40001,
  INTERACTION_ALREADY_ACKNOWLEDGED: 40060,
  MISSING_ACCESS: 50001,
  CANNOT_SEND_EMPTY_MESSAGE: 50006,
  CANNOT_SEND_TO_USER: 50007,
  MISSING_PERMISSIONS: 50013,
  INVALID_AUTH_TOKEN: 50014,
  MESSAGE_TOO_OLD_TO_BULK_DELETE: 50034,
  INVALID_FORM_BODY: 50035,
  INVALID_JSON: 50109,
} as const;

export interface FieldError { code: string; message: string }
/** Nested `errors` object: path segments as keys, `_errors` at the leaves. */
export type ErrorTree = { _errors?: FieldError[]; [key: string]: ErrorTree | FieldError[] | undefined };

export interface DiscordError { code: number; message: string; errors?: ErrorTree }

/** A Discord JSON error body. */
export function apiError(code: number, message: string, errors?: ErrorTree): DiscordError {
  return errors && Object.keys(errors).length > 0 ? { code, message, errors } : { code, message };
}

/** Field path -> nested errors tree. `path` is "a.b.0.c", "/a/b/0/c" or a segment list. */
export function errorsTree(entries: Array<{ path: string | Array<string | number>; code: string; message: string }>): ErrorTree {
  // Null-prototype nodes: paths come from request bodies, so a segment like
  // "__proto__" must stay a plain key, never reach Object.prototype.
  const root: ErrorTree = Object.create(null);
  for (const e of entries) {
    const segs = Array.isArray(e.path)
      ? e.path.map(String)
      : e.path.split(/[./]/).filter((s) => s.length > 0);
    let node = root;
    for (const s of segs) {
      const next = Object.prototype.hasOwnProperty.call(node, s) ? node[s] : undefined;
      if (!next || Array.isArray(next)) node[s] = Object.create(null);
      node = node[s] as ErrorTree;
    }
    if (!Object.prototype.hasOwnProperty.call(node, '_errors')) node._errors = [];
    node._errors!.push({ code: e.code, message: e.message });
  }
  return root;
}

/** `Invalid Form Body` (50035) with one or more field errors. */
export function invalidFormBody(entries: Array<{ path: string | Array<string | number>; code: string; message: string }>): DiscordError {
  return apiError(API_ERROR.INVALID_FORM_BODY, 'Invalid Form Body', errorsTree(entries));
}

interface ValueErrorLike {
  path?: string;
  message?: string;
  summary?: string;
  schema?: { maxLength?: number; minLength?: number; maximum?: number; minimum?: number; maxItems?: number; minItems?: number; enum?: unknown[]; anyOf?: unknown[] };
  value?: unknown;
}

/** Discord validation code for one TypeBox/Elysia value error. */
export function discordCodeFor(e: ValueErrorLike): FieldError {
  const msg = String(e.message ?? '');
  const s = e.schema ?? {};
  if (e.value === undefined && /required|expected/i.test(msg)) return { code: 'BASE_TYPE_REQUIRED', message: 'This field is required' };
  if (/greater or equal|minLength|at least/i.test(msg) && typeof s.minLength === 'number') {
    return { code: 'BASE_TYPE_MIN_LENGTH', message: `Must be ${s.minLength} or more in length.` };
  }
  if (/less or equal|maxLength|at most/i.test(msg) && typeof s.maxLength === 'number') {
    return { code: 'BASE_TYPE_MAX_LENGTH', message: `Must be ${s.maxLength} or fewer in length.` };
  }
  if (typeof s.maxItems === 'number' && Array.isArray(e.value) && e.value.length > s.maxItems) {
    return { code: 'BASE_TYPE_MAX_LENGTH', message: `Must be ${s.maxItems} or fewer in length.` };
  }
  if (typeof s.minItems === 'number' && Array.isArray(e.value) && e.value.length < s.minItems) {
    return { code: 'BASE_TYPE_MIN_LENGTH', message: `Must be ${s.minItems} or more in length.` };
  }
  if (typeof s.maximum === 'number' && typeof e.value === 'number' && e.value > s.maximum) {
    return { code: 'NUMBER_TYPE_MAX', message: `int value should be less than or equal to ${s.maximum}.` };
  }
  if (typeof s.minimum === 'number' && typeof e.value === 'number' && e.value < s.minimum) {
    return { code: 'NUMBER_TYPE_MIN', message: `int value should be greater than or equal to ${s.minimum}.` };
  }
  if (Array.isArray(s.enum) || Array.isArray(s.anyOf)) return { code: 'BASE_TYPE_CHOICES', message: msg || 'Value must be one of the allowed choices.' };
  return { code: 'BASE_TYPE_BAD_TYPE', message: msg || 'Invalid value.' };
}

/** 50035 body for an Elysia `VALIDATION` error (uses `error.all` when present). */
export function validationErrorBody(error: unknown): DiscordError {
  let list: ValueErrorLike[] = [];
  try {
    const all = (error as { all?: ValueErrorLike[] })?.all;
    if (Array.isArray(all)) list = all;
  } catch { /* `all` may throw on non-TypeBox validators */ }
  if (list.length === 0) return apiError(API_ERROR.INVALID_FORM_BODY, 'Invalid Form Body');
  const seen = new Set<string>();
  const entries: Array<{ path: string; code: string; message: string }> = [];
  for (const e of list) {
    const path = String(e.path ?? '').replace(/^\//, '') || '_root';
    if (seen.has(path)) continue; // first error per field, like Discord
    seen.add(path);
    entries.push({ path, ...discordCodeFor(e) });
  }
  return invalidFormBody(entries);
}
