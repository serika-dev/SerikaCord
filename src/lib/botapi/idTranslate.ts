/**
 * Pure id rewriting for the bot API boundary (no DB): which strings in a
 * Discord-shaped payload are ids, and how to swap them between internal UUIDs
 * and public snowflakes. The resolver (snowflakeStore.ts) supplies the maps;
 * the Elysia hooks and the gateway (boundary.ts) call these.
 *
 * Outbound (UUID -> snowflake) is liberal: any string that is exactly a UUID is
 * an id unless its key holds free text (TEXT_KEYS), plus UUID object keys
 * (interaction `resolved` maps) and mention / emoji / command tokens inside
 * strings. Internal ids are random UUIDs, so a UUID-looking value is an id.
 *
 * Inbound (snowflake -> UUID) is strict: digit strings are everywhere in
 * Discord bodies (permission bitfields, nonces, colors), so only values under
 * id-shaped keys (ID_KEY / ID_ARRAY_KEYS) and tokens in strings are touched.
 */
import { isSnowflake } from './snowflake';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_SRC = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && v.length === 36 && UUID_RE.test(v);
}

/** Keys whose string values are free text or opaque tokens: never ids. */
const TEXT_KEYS = new Set([
  'content', 'name', 'description', 'title', 'topic', 'label', 'placeholder', 'nonce', 'custom_id',
  'session_id', 'token', 'text', 'bio', 'nick', 'username', 'global_name', 'display_name', 'url',
  'proxy_url', 'icon_url', 'filename', 'question', 'reason', 'slug', 'summary', 'tags', 'code',
  'verify_key', 'value', 'resume_gateway_url', 'avatar', 'banner', 'icon', 'splash', 'hash',
  'unicode_emoji', 'locale', 'preferred_locale', 'emoji_name', 'state', 'details', 'large_text',
  'small_text', 'large_image', 'small_image', 'party_id', 'match', 'join', 'spectate', 'image',
]);

/** Option types whose `value` is an id (USER, CHANNEL, ROLE, MENTIONABLE). */
const ID_OPTION_TYPES = new Set([6, 7, 8, 9]);

/** `<@u>`, `<@!u>`, `<@&r>`, `<#c>`, `<:n:e>`, `<a:n:e>`, `</cmd sub:id>`. */
function tokenRegex(idSrc: string) {
  return new RegExp(`<(@!?|@&|#|a?:[^:<>\\s]{1,64}:|\\/[^:<>]{1,100}:)(${idSrc})>`, 'g');
}
const OUT_TOKEN_RE = tokenRegex(UUID_SRC);
const IN_TOKEN_RE = tokenRegex('\\d{1,20}');

function isRoleToken(prefix: string) {
  return prefix === '@&';
}

// ─── Outbound ─────────────────────────────────────────────────────────────────

export interface OutboundScan {
  /** Lower-cased UUIDs found in the payload. */
  uuids: Set<string>;
  /** Creation time hints (ms) for UUIDs, from `timestamp` next to `id` (messages) etc. */
  hints: Map<string, { ts: number; kind?: number }>;
}

/** Collect every UUID the outbound rewrite would replace (one resolver round trip per payload). */
export function scanOutbound(payload: unknown, scan: OutboundScan = { uuids: new Set(), hints: new Map() }): OutboundScan {
  walkOut(payload, null, null, scan);
  return scan;
}

function walkOut(v: unknown, key: string | null, parent: Record<string, unknown> | null, scan: OutboundScan) {
  if (typeof v === 'string') {
    if (isUuid(v) && isIdPosition(key, parent)) scan.uuids.add(v.toLowerCase());
    else if (v.includes('<')) for (const m of v.matchAll(OUT_TOKEN_RE)) scan.uuids.add(m[2].toLowerCase());
    return;
  }
  if (!v || typeof v !== 'object') return;
  if (Array.isArray(v)) {
    for (const item of v) walkOut(item, key, parent, scan);
    return;
  }
  const obj = v as Record<string, unknown>;
  // A message-like object: its own id was created at `timestamp`.
  if (isUuid(obj.id) && typeof obj.timestamp === 'string') {
    const ts = Date.parse(obj.timestamp);
    if (Number.isFinite(ts)) scan.hints.set((obj.id as string).toLowerCase(), { ts, kind: 'channel_id' in obj ? 4 : undefined });
  }
  for (const [k, child] of Object.entries(obj)) {
    if (isUuid(k)) scan.uuids.add(k.toLowerCase());
    walkOut(child, k, obj, scan);
  }
}

function isIdPosition(key: string | null, parent: Record<string, unknown> | null): boolean {
  if (key === null) return true;
  if (key === 'value') return !!parent && ID_OPTION_TYPES.has(Number(parent.type));
  return !TEXT_KEYS.has(key);
}

export interface OutboundLookup {
  /** Snowflake for a lower-cased UUID, or undefined to leave it as is. */
  get(uuid: string): string | undefined;
  /** @everyone role UUIDs: dropped from member `roles` arrays (Discord omits them). */
  everyoneRoles?: ReadonlySet<string>;
}

/** A copy of `payload` with every id UUID replaced by its snowflake. */
export function rewriteOutbound<T>(payload: T, lookup: OutboundLookup): T {
  return outValue(payload, null, null, lookup) as T;
}

function outString(s: string, key: string | null, parent: Record<string, unknown> | null, lookup: OutboundLookup): string {
  if (isUuid(s) && isIdPosition(key, parent)) return lookup.get(s.toLowerCase()) ?? s;
  if (s.includes('<')) {
    return s.replace(OUT_TOKEN_RE, (all, prefix: string, id: string) => {
      const sf = lookup.get(id.toLowerCase());
      return sf ? `<${prefix}${sf}>` : all;
    });
  }
  return s;
}

function outValue(v: unknown, key: string | null, parent: Record<string, unknown> | null, lookup: OutboundLookup): unknown {
  if (typeof v === 'string') return outString(v, key, parent, lookup);
  if (!v || typeof v !== 'object') return v;
  if (Array.isArray(v)) {
    let arr = v as unknown[];
    // Member role lists never contain @everyone on Discord.
    if (key === 'roles' && lookup.everyoneRoles?.size && parent && 'joined_at' in parent) {
      arr = arr.filter((r) => !(typeof r === 'string' && lookup.everyoneRoles!.has(r.toLowerCase())));
    }
    return arr.map((item) => outValue(item, key, parent, lookup));
  }
  if (v instanceof Date) return v;
  const obj = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, child] of Object.entries(obj)) {
    const nk = isUuid(k) ? (lookup.get(k.toLowerCase()) ?? k) : k;
    out[nk] = outValue(child, k, obj, lookup);
  }
  return out;
}

// ─── Inbound ──────────────────────────────────────────────────────────────────

/** Body keys holding a single id. */
function isIdKey(key: string): boolean {
  return key === 'id' || key.endsWith('_id');
}

/** Body keys holding a list of ids. */
const ID_ARRAY_KEYS = new Set([
  'roles', 'users', 'applied_tags', 'exempt_roles', 'exempt_channels', 'include_roles', 'sticker_ids',
]);
/** Id keys / arrays that hold role ids (the guild id means @everyone). */
const ROLE_KEYS = new Set(['roles', 'exempt_roles', 'include_roles', 'role_id', 'role_ids']);

function isIdArrayKey(key: string): boolean {
  return key.endsWith('_ids') || ID_ARRAY_KEYS.has(key);
}

/** Inbound id context: role ids may name the guild (= @everyone). */
export type InboundContext = 'role' | 'any';

export interface InboundScan {
  snowflakes: Set<string>;
  /** Snowflakes seen in a role position. */
  roleSnowflakes: Set<string>;
}

function asIdString(v: unknown): string | null {
  if (typeof v === 'string') return isSnowflake(v) ? v : null;
  if (typeof v === 'number' && Number.isSafeInteger(v) && v > 0) return String(v);
  return null;
}

/** Collect the snowflakes an inbound body carries in id positions and tokens. */
export function scanInbound(body: unknown, scan: InboundScan = { snowflakes: new Set(), roleSnowflakes: new Set() }): InboundScan {
  walkIn(body, null, scan);
  return scan;
}

function addIn(scan: InboundScan, sf: string, role: boolean) {
  scan.snowflakes.add(sf);
  if (role) scan.roleSnowflakes.add(sf);
}

function walkIn(v: unknown, key: string | null, scan: InboundScan) {
  if (typeof v === 'string') {
    if (v.includes('<')) {
      for (const m of v.matchAll(IN_TOKEN_RE)) if (isSnowflake(m[2])) addIn(scan, m[2], isRoleToken(m[1]));
    }
  }
  if (!v || typeof v !== 'object') return;
  if (Array.isArray(v)) {
    for (const item of v) walkIn(item, key, scan);
    return;
  }
  const obj = v as Record<string, unknown>;
  for (const [k, child] of Object.entries(obj)) {
    if (isIdKey(k)) {
      const sf = asIdString(child);
      if (sf) { addIn(scan, sf, ROLE_KEYS.has(k) || isRoleOverwrite(k, obj)); continue; }
    } else if (isIdArrayKey(k) && Array.isArray(child)) {
      for (const item of child) {
        const sf = asIdString(item);
        if (sf) addIn(scan, sf, ROLE_KEYS.has(k));
        else walkIn(item, k, scan);
      }
      continue;
    }
    walkIn(child, k, scan);
  }
}

/** `{ id, type: 0 }` inside permission_overwrites: a role overwrite. */
function isRoleOverwrite(key: string, obj: Record<string, unknown>) {
  return key === 'id' && 'allow' in obj && (obj.type === 0 || obj.type === '0' || obj.type === 'role');
}

export interface InboundLookup {
  /** Internal UUID for a snowflake (role context: @everyone for the guild id), or undefined. */
  get(snowflake: string, ctx: InboundContext): string | undefined;
}

/** A copy of an inbound body with known snowflakes in id positions replaced by UUIDs. */
export function rewriteInbound<T>(body: T, lookup: InboundLookup): T {
  return inValue(body, null, lookup) as T;
}

function inString(s: string, lookup: InboundLookup): string {
  if (!s.includes('<')) return s;
  return s.replace(IN_TOKEN_RE, (all, prefix: string, id: string) => {
    const uuid = lookup.get(id, isRoleToken(prefix) ? 'role' : 'any');
    return uuid ? `<${prefix}${uuid}>` : all;
  });
}

function inValue(v: unknown, key: string | null, lookup: InboundLookup): unknown {
  if (typeof v === 'string') return inString(v, lookup);
  if (!v || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((item) => inValue(item, key, lookup));
  if (v instanceof Blob || v instanceof Date) return v;
  const obj = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, child] of Object.entries(obj)) {
    if (isIdKey(k)) {
      const sf = asIdString(child);
      if (sf) {
        out[k] = lookup.get(sf, ROLE_KEYS.has(k) || isRoleOverwrite(k, obj) ? 'role' : 'any') ?? child;
        continue;
      }
    } else if (isIdArrayKey(k) && Array.isArray(child)) {
      const ctx: InboundContext = ROLE_KEYS.has(k) ? 'role' : 'any';
      out[k] = child.map((item) => {
        const sf = asIdString(item);
        return sf ? (lookup.get(sf, ctx) ?? item) : inValue(item, k, lookup);
      });
      continue;
    }
    out[k] = inValue(child, k, lookup);
  }
  return out;
}

// ─── Paths and queries ────────────────────────────────────────────────────────

/** Discord "Unknown X" error for an unknown id in a path parameter. */
export function unknownIdError(param: string): { status: number; body: { code: number; message: string } } {
  const map: Record<string, [number, string]> = {
    channelId: [10003, 'Unknown Channel'],
    threadId: [10003, 'Unknown Channel'],
    parentId: [10003, 'Unknown Channel'],
    guildId: [10004, 'Unknown Guild'],
    serverId: [10004, 'Unknown Guild'],
    messageId: [10008, 'Unknown Message'],
    userId: [10013, 'Unknown User'],
    memberId: [10007, 'Unknown Member'],
    roleId: [10011, 'Unknown Role'],
    emojiId: [10014, 'Unknown Emoji'],
    webhookId: [10015, 'Unknown Webhook'],
    appId: [10002, 'Unknown Application'],
    applicationId: [10002, 'Unknown Application'],
    commandId: [10063, 'Unknown application command'],
    stickerId: [10060, 'Unknown Sticker'],
    interactionId: [10062, 'Unknown interaction'],
    eventId: [10070, 'Unknown Guild Scheduled Event'],
    ruleId: [10066, 'Unknown auto moderation rule'],
    overwriteId: [10009, 'Unknown Overwrite'],
    integrationId: [10005, 'Unknown Integration'],
    entitlementId: [10049, 'Unknown entitlement'],
    skuId: [10029, 'Unknown SKU'],
  };
  const [code, message] = map[param] ?? [0, '404: Not Found'];
  return { status: 404, body: { code, message } };
}

/** Path params that carry an id (snowflake in, UUID out). */
export function isIdParam(name: string): boolean {
  return name.endsWith('Id');
}

/** Path params in a role position (guild id = @everyone). */
export function isRoleParam(name: string): boolean {
  return name === 'roleId';
}

/** Query keys whose values are ids (comma-separated lists allowed). */
export const ID_QUERY_KEYS = new Set([
  'before', 'after', 'around', 'user_ids', 'user_id', 'guild_id', 'channel_id', 'thread_id',
  'application_id', 'role_ids', 'target_id', 'message_id', 'sku_ids',
]);

/** `name:id` custom-emoji path segment (reactions): the id part, if a snowflake. */
export function emojiParamId(emoji: string): { name: string; id: string } | null {
  let raw = emoji;
  try { raw = decodeURIComponent(emoji); } catch { /* keep raw */ }
  const m = /^(?:a:)?([^:]+):(\d{1,20})$/.exec(raw);
  return m && isSnowflake(m[2]) ? { name: m[1], id: m[2] } : null;
}

// ─── JSON with 64-bit integers ───────────────────────────────────────────────

/**
 * Quote integer literals of 16+ digits in JSON text so JSON.parse keeps them
 * exact (some libraries, e.g. discord.py, send ids as JSON numbers, and
 * snowflakes exceed 2^53). Strings are left untouched.
 */
export function quoteBigInts(json: string): string {
  let out = '';
  let i = 0;
  let last = 0;
  const n = json.length;
  while (i < n) {
    const c = json.charCodeAt(i);
    if (c === 34 /* " */) {
      i++;
      while (i < n) {
        const d = json.charCodeAt(i);
        if (d === 92 /* \ */) { i += 2; continue; }
        i++;
        if (d === 34) break;
      }
      continue;
    }
    if ((c >= 48 && c <= 57) || c === 45 /* - */) {
      const start = i;
      i++;
      while (i < n) {
        const d = json.charCodeAt(i);
        if ((d >= 48 && d <= 57) || d === 46 || d === 101 || d === 69 || d === 43 || d === 45) i++;
        else break;
      }
      const lit = json.slice(start, i);
      if (/^\d{16,20}$/.test(lit)) {
        out += json.slice(last, start) + '"' + lit + '"';
        last = i;
      }
      continue;
    }
    i++;
  }
  return last === 0 ? json : out + json.slice(last);
}

/** JSON.parse that keeps 64-bit integer ids exact (as strings). */
export function parseJsonBig(text: string): unknown {
  return JSON.parse(quoteBigInts(text));
}
