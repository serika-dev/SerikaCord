/**
 * Linked roles (Discord "application role connection metadata" and a user's
 * "application role connection"): validation and serialization. Pure, no I/O;
 * storage is src/lib/services/applicationApiSettings.ts, routes are
 * src/lib/api/botApi/applications.ts. Tested in tests/appapi-role-connections.test.ts.
 */
import { DISCORD_LOCALES } from './commands';
import { FE, FormErrors, type FormErrorPath } from './formErrors';

/** Discord's metadata types (1-8). */
export const RoleConnectionMetadataType = {
  INTEGER_LESS_THAN_OR_EQUAL: 1,
  INTEGER_GREATER_THAN_OR_EQUAL: 2,
  INTEGER_EQUAL: 3,
  INTEGER_NOT_EQUAL: 4,
  DATETIME_LESS_THAN_OR_EQUAL: 5,
  DATETIME_GREATER_THAN_OR_EQUAL: 6,
  BOOLEAN_EQUAL: 7,
  BOOLEAN_NOT_EQUAL: 8,
} as const;

export const ROLE_CONNECTION_LIMITS = {
  MAX_RECORDS: 5,
  KEY: 50,
  NAME: 100,
  DESCRIPTION: 200,
  PLATFORM_NAME: 50,
  PLATFORM_USERNAME: 100,
  METADATA_VALUE: 100,
} as const;

export interface RoleConnectionMetadataRecord {
  type: number;
  key: string;
  name: string;
  name_localizations?: Record<string, string>;
  description: string;
  description_localizations?: Record<string, string>;
}

export interface UserRoleConnection {
  platform_name: string | null;
  platform_username: string | null;
  metadata: Record<string, string>;
}

const KEY_RE = /^[a-z0-9_]{1,50}$/;

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function boundedString(e: FormErrors, path: FormErrorPath, v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') { e.add(path, FE.REQUIRED, 'This field is required'); return undefined; }
  const s = v.trim();
  if (s.length < 1 || s.length > max) { e.add(path, FE.BAD_LENGTH, `Must be between 1 and ${max} in length.`); return undefined; }
  return s;
}

function localizationMap(e: FormErrors, path: FormErrorPath, v: unknown, max: number): Record<string, string> | undefined {
  if (v === undefined || v === null) return undefined;
  if (!isObj(v)) { e.add(path, FE.BAD_TYPE, 'Must be an object.'); return undefined; }
  const out: Record<string, string> = {};
  for (const [locale, value] of Object.entries(v)) {
    if (!DISCORD_LOCALES.has(locale)) { e.add([...path, locale], 'LOCALE_INVALID', 'Invalid locale'); continue; }
    if (value === null) continue;
    if (typeof value !== 'string' || value.trim().length < 1 || value.length > max) {
      e.add([...path, locale], FE.BAD_LENGTH, `Must be between 1 and ${max} in length.`);
      continue;
    }
    out[locale] = value.trim();
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * PUT /applications/{id}/role-connections/metadata body: an array of at most
 * 5 records with unique keys (a-z, 0-9, _; 1-50), name 1-100, description
 * 1-200 and type 1-8. Returns the normalized records or a 50035 body.
 */
export function validateRoleConnectionMetadata(
  input: unknown,
): { ok: true; records: RoleConnectionMetadataRecord[] } | { ok: false; error: ReturnType<FormErrors['toBody']> } {
  const e = new FormErrors();
  if (!Array.isArray(input)) {
    e.add([], FE.BAD_TYPE, 'Must be an array.');
    return { ok: false, error: e.toBody() };
  }
  if (input.length > ROLE_CONNECTION_LIMITS.MAX_RECORDS) {
    e.add([], FE.MAX_LENGTH, `Must be ${ROLE_CONNECTION_LIMITS.MAX_RECORDS} or fewer in length.`);
    return { ok: false, error: e.toBody() };
  }
  const records: RoleConnectionMetadataRecord[] = [];
  const seen = new Set<string>();
  input.forEach((raw, i) => {
    if (!isObj(raw)) { e.add([i], FE.BAD_TYPE, 'Must be an object.'); return; }
    const before = e.count;
    const type = raw.type;
    if (typeof type !== 'number' || !Number.isInteger(type) || type < 1 || type > 8) {
      e.add([i, 'type'], FE.CHOICES, 'Value must be one of (1, 2, 3, 4, 5, 6, 7, 8).');
    }
    let key: string | undefined;
    if (typeof raw.key !== 'string' || !KEY_RE.test(raw.key)) {
      e.add([i, 'key'], 'APPLICATION_ROLE_CONNECTION_METADATA_KEY_INVALID', 'Key must be 1-50 characters of a-z, 0-9 or _.');
    } else if (seen.has(raw.key)) {
      e.add([i, 'key'], 'APPLICATION_ROLE_CONNECTION_METADATA_KEY_DUPLICATE', 'Keys must be unique.');
    } else {
      key = raw.key;
      seen.add(key);
    }
    const name = boundedString(e, [i, 'name'], raw.name, ROLE_CONNECTION_LIMITS.NAME);
    const description = boundedString(e, [i, 'description'], raw.description, ROLE_CONNECTION_LIMITS.DESCRIPTION);
    const nameLocalizations = localizationMap(e, [i, 'name_localizations'], raw.name_localizations, ROLE_CONNECTION_LIMITS.NAME);
    const descriptionLocalizations = localizationMap(e, [i, 'description_localizations'], raw.description_localizations, ROLE_CONNECTION_LIMITS.DESCRIPTION);
    if (e.count > before || !key || name === undefined || description === undefined) return;
    records.push({
      type: type as number,
      key,
      name,
      ...(nameLocalizations ? { name_localizations: nameLocalizations } : {}),
      description,
      ...(descriptionLocalizations ? { description_localizations: descriptionLocalizations } : {}),
    });
  });
  if (!e.ok) return { ok: false, error: e.toBody() };
  return { ok: true, records };
}

/** Stored metadata (jsonb) back to records; anything malformed is dropped. */
export function parseStoredMetadata(raw: unknown): RoleConnectionMetadataRecord[] {
  if (!Array.isArray(raw)) return [];
  const r = validateRoleConnectionMetadata(raw.slice(0, ROLE_CONNECTION_LIMITS.MAX_RECORDS));
  if (r.ok) return r.records;
  // Keep whichever records still validate on their own.
  const out: RoleConnectionMetadataRecord[] = [];
  for (const item of raw.slice(0, ROLE_CONNECTION_LIMITS.MAX_RECORDS)) {
    const one = validateRoleConnectionMetadata([item]);
    if (one.ok && !out.some((x) => x.key === one.records[0].key)) out.push(one.records[0]);
  }
  return out;
}

const isIntegerType = (t: number) => t >= 1 && t <= 4;
const isDatetimeType = (t: number) => t === 5 || t === 6;
const isBooleanType = (t: number) => t === 7 || t === 8;

/**
 * One metadata value as Discord stores it (a string): integers for types 1-4
 * (Discord: 64-bit), ISO8601 dates for 5-6, booleans as "1"/"0" for 7-8.
 * Numbers and booleans are accepted and stringified.
 */
export function normalizeMetadataValue(type: number, v: unknown): string | null {
  if (isIntegerType(type)) {
    const s = typeof v === 'number' && Number.isSafeInteger(v) ? String(v) : typeof v === 'string' ? v.trim() : null;
    if (s === null || !/^-?\d{1,19}$/.test(s)) return null;
    try {
      const n = BigInt(s);
      if (n > 9223372036854775807n || n < -9223372036854775808n) return null;
      return n.toString();
    } catch { return null; }
  }
  if (isDatetimeType(type)) {
    if (typeof v !== 'string' || v.length > ROLE_CONNECTION_LIMITS.METADATA_VALUE) return null;
    if (!/^\d{4}-\d{2}-\d{2}/.test(v.trim())) return null;
    const t = Date.parse(v.trim());
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  if (isBooleanType(type)) {
    if (v === true || v === 1 || v === '1' || v === 'true') return '1';
    if (v === false || v === 0 || v === '0' || v === 'false') return '0';
    return null;
  }
  return null;
}

/**
 * PUT /users/@me/applications/{id}/role-connection body against the app's
 * metadata records: platform_name (max 50), platform_username (max 100) and
 * metadata values keyed by the app's metadata keys. Fields that are absent
 * keep their stored value (`current`), like Discord.
 */
export function validateUserRoleConnection(
  input: unknown,
  records: RoleConnectionMetadataRecord[],
  current: UserRoleConnection | null,
): { ok: true; connection: UserRoleConnection } | { ok: false; error: ReturnType<FormErrors['toBody']> } {
  const e = new FormErrors();
  if (!isObj(input)) {
    e.add([], FE.BAD_TYPE, 'Must be an object.');
    return { ok: false, error: e.toBody() };
  }
  const out: UserRoleConnection = {
    platform_name: current?.platform_name ?? null,
    platform_username: current?.platform_username ?? null,
    metadata: { ...(current?.metadata ?? {}) },
  };
  const optionalText = (key: 'platform_name' | 'platform_username', max: number) => {
    const v = input[key];
    if (v === undefined) return;
    if (v === null || v === '') { out[key] = null; return; }
    if (typeof v !== 'string') { e.add([key], FE.BAD_TYPE, 'Must be a string.'); return; }
    if (v.length > max) { e.add([key], FE.MAX_LENGTH, `Must be ${max} or fewer in length.`); return; }
    out[key] = v;
  };
  optionalText('platform_name', ROLE_CONNECTION_LIMITS.PLATFORM_NAME);
  optionalText('platform_username', ROLE_CONNECTION_LIMITS.PLATFORM_USERNAME);
  if (input.metadata !== undefined) {
    const m = input.metadata;
    if (m === null) out.metadata = {};
    else if (!isObj(m)) e.add(['metadata'], FE.BAD_TYPE, 'Must be an object.');
    else {
      const byKey = new Map(records.map((r) => [r.key, r]));
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(m)) {
        const rec = byKey.get(k);
        if (!rec) { e.add(['metadata', k], 'APPLICATION_ROLE_CONNECTION_METADATA_KEY_UNKNOWN', 'Unknown metadata key.'); continue; }
        if (v === null) continue;
        if (typeof v === 'string' && v.length > ROLE_CONNECTION_LIMITS.METADATA_VALUE) {
          e.add(['metadata', k], FE.MAX_LENGTH, `Must be ${ROLE_CONNECTION_LIMITS.METADATA_VALUE} or fewer in length.`);
          continue;
        }
        const value = normalizeMetadataValue(rec.type, v);
        if (value === null) { e.add(['metadata', k], FE.BAD_TYPE, 'Value does not match the metadata type.'); continue; }
        next[k] = value;
      }
      out.metadata = next;
    }
  }
  if (!e.ok) return { ok: false, error: e.toBody() };
  return { ok: true, connection: out };
}

/** The stored connection as Discord returns it (metadata limited to the app's current keys). */
export function serializeUserRoleConnection(
  row: { platformName?: string | null; platformUsername?: string | null; metadata?: unknown } | null,
  records: RoleConnectionMetadataRecord[],
): UserRoleConnection {
  const keys = new Set(records.map((r) => r.key));
  const metadata: Record<string, string> = {};
  if (row && isObj(row.metadata)) {
    for (const [k, v] of Object.entries(row.metadata)) if (keys.has(k) && typeof v === 'string') metadata[k] = v;
  }
  return { platform_name: row?.platformName ?? null, platform_username: row?.platformUsername ?? null, metadata };
}
