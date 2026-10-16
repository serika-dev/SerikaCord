/**
 * Permission bit numbering at the bot API boundary (pure, no DB).
 *
 * Serika's canonical bits (src/lib/permissions/bits.ts) match Discord API v10
 * everywhere except five flags that Serika numbered before Discord published
 * theirs:
 *
 *   flag                       Serika   Discord v10
 *   USE_EXTERNAL_SOUNDS         1<<42    1<<45
 *   SEND_VOICE_MESSAGES         1<<43    1<<46
 *   USE_SOUNDBOARD              1<<44    1<<42
 *   CREATE_EXPRESSIONS          1<<45    1<<43  (CREATE_GUILD_EXPRESSIONS)
 *   CREATE_EVENTS               1<<46    1<<44
 *
 * Stored role / overwrite / command / install bitfields keep Serika numbering
 * (production data is never rewritten). Snowflake-format applications see
 * Discord numbering: every permission bitfield is permuted on the way out
 * (`permissionsToDiscord`) and back on the way in (`permissionsToSerika`).
 * The permutation only swaps bits 42-46 among themselves, so it is lossless
 * and every other bit (including ones Serika doesn't know, e.g. Discord's
 * 41 VIEW_CREATOR_MONETIZATION_ANALYTICS and 52 BYPASS_SLOWMODE) passes
 * through unchanged. Legacy UUID-format apps keep Serika numbering.
 */
import { PERMISSION_BITS, type PermissionName } from '@/lib/permissions/bits';

/** Discord API v10 bit of every Serika permission (by Serika name). */
export const DISCORD_BIT_OF: Readonly<Record<PermissionName, bigint>> = {
  CREATE_INVITE: 1n << 0n, // CREATE_INSTANT_INVITE
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_SERVER: 1n << 5n, // MANAGE_GUILD
  ADD_REACTIONS: 1n << 6n,
  VIEW_AUDIT_LOG: 1n << 7n,
  PRIORITY_SPEAKER: 1n << 8n,
  VIDEO: 1n << 9n, // STREAM
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  SEND_TTS_MESSAGES: 1n << 12n,
  MANAGE_MESSAGES: 1n << 13n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  MENTION_EVERYONE: 1n << 17n,
  USE_EXTERNAL_EMOJIS: 1n << 18n,
  VIEW_SERVER_INSIGHTS: 1n << 19n, // VIEW_GUILD_INSIGHTS
  CONNECT: 1n << 20n,
  SPEAK: 1n << 21n,
  MUTE_MEMBERS: 1n << 22n,
  DEAFEN_MEMBERS: 1n << 23n,
  MOVE_MEMBERS: 1n << 24n,
  USE_VOICE_ACTIVITY: 1n << 25n, // USE_VAD
  CHANGE_NICKNAME: 1n << 26n,
  MANAGE_NICKNAMES: 1n << 27n,
  MANAGE_ROLES: 1n << 28n,
  MANAGE_WEBHOOKS: 1n << 29n,
  MANAGE_EMOJIS_AND_STICKERS: 1n << 30n, // MANAGE_GUILD_EXPRESSIONS
  USE_APPLICATION_COMMANDS: 1n << 31n,
  REQUEST_TO_SPEAK: 1n << 32n,
  MANAGE_EVENTS: 1n << 33n,
  MANAGE_THREADS: 1n << 34n,
  CREATE_PUBLIC_THREADS: 1n << 35n,
  CREATE_PRIVATE_THREADS: 1n << 36n,
  USE_EXTERNAL_STICKERS: 1n << 37n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
  USE_EMBEDDED_ACTIVITIES: 1n << 39n,
  MODERATE_MEMBERS: 1n << 40n,
  // 41 VIEW_CREATOR_MONETIZATION_ANALYTICS: Discord only (passes through).
  USE_SOUNDBOARD: 1n << 42n,
  CREATE_EXPRESSIONS: 1n << 43n, // CREATE_GUILD_EXPRESSIONS
  CREATE_EVENTS: 1n << 44n,
  USE_EXTERNAL_SOUNDS: 1n << 45n,
  SEND_VOICE_MESSAGES: 1n << 46n,
  SET_VOICE_CHANNEL_STATUS: 1n << 48n,
  SEND_POLLS: 1n << 49n,
  USE_EXTERNAL_APPS: 1n << 50n,
  PIN_MESSAGES: 1n << 51n,
  // 52 BYPASS_SLOWMODE: Discord only (passes through).
};

/** [serika bit, discord bit] for every flag whose numbers differ. */
const MOVED: ReadonlyArray<readonly [bigint, bigint]> = (Object.keys(PERMISSION_BITS) as PermissionName[])
  .map((name) => [PERMISSION_BITS[name], DISCORD_BIT_OF[name]] as const)
  .filter(([s, d]) => s !== d);

/** Bits the permutation moves (the same set on both sides). */
const MOVED_MASK = MOVED.reduce((m, [s]) => m | s, 0n);

function permute(bits: bigint, pairs: ReadonlyArray<readonly [bigint, bigint]>): bigint {
  if ((bits & MOVED_MASK) === 0n) return bits;
  let out = bits & ~MOVED_MASK;
  for (const [from, to] of pairs) if ((bits & from) !== 0n) out |= to;
  return out;
}

const TO_DISCORD = MOVED;
const TO_SERIKA = MOVED.map(([s, d]) => [d, s] as const);

/** A non-negative decimal bitfield string (what Discord sends and expects). */
const BITFIELD_RE = /^\d{1,40}$/;

function convert<T extends string | bigint>(bits: T, pairs: ReadonlyArray<readonly [bigint, bigint]>): T {
  if (typeof bits === 'bigint') return (bits < 0n ? bits : permute(bits, pairs)) as T;
  if (typeof bits !== 'string' || !BITFIELD_RE.test(bits)) return bits;
  const n = BigInt(bits);
  const out = permute(n, pairs);
  return (out === n ? bits : out.toString()) as T;
}

/** Serika-numbered bitfield -> Discord v10 numbering (same type; non-bitfield strings unchanged). */
export function serikaToDiscord<T extends string | bigint>(bits: T): T {
  return convert(bits, TO_DISCORD);
}

/** Discord v10-numbered bitfield -> Serika numbering (same type; non-bitfield strings unchanged). */
export function discordToSerika<T extends string | bigint>(bits: T): T {
  return convert(bits, TO_SERIKA);
}

// ─── Payload transforms ───────────────────────────────────────────────────────

/** Keys whose value is a permission bitfield in Discord payloads (requests and responses). */
const PERMISSION_KEYS = new Set(['permissions', 'allow', 'deny', 'app_permissions', 'default_member_permissions']);

/**
 * Subtrees that never hold permission bitfields but may hold arbitrary
 * developer or user data under any key (role connection metadata, embeds,
 * components, command / audit log options, polls, presences...).
 */
const SKIP_KEYS = new Set([
  'embeds', 'components', 'metadata', 'attachments', 'poll', 'activities', 'activity', 'options',
  'choices', 'sticker_items', 'content', 'name_localizations', 'description_localizations',
]);

function convertValue(v: unknown, pairs: ReadonlyArray<readonly [bigint, bigint]>): unknown {
  if (typeof v === 'string') return convert(v, pairs);
  // JSON numbers (some clients send integer bitfields; Discord accepts both).
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) {
    const n = BigInt(v);
    const out = permute(n, pairs);
    if (out === n) return v;
    return out <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(out) : out.toString();
  }
  return v;
}

function setOwn(obj: Record<string, unknown>, key: string, value: unknown) {
  if (key === '__proto__') Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
  else obj[key] = value;
}

/** Copy-on-write walk: returns `v` itself when nothing changed. */
function walk(v: unknown, pairs: ReadonlyArray<readonly [bigint, bigint]>, depth: number): unknown {
  if (!v || typeof v !== 'object' || depth > 64) return v;
  if (v instanceof Date || (typeof Blob !== 'undefined' && v instanceof Blob)) return v;
  if (Array.isArray(v)) {
    let out: unknown[] | null = null;
    for (let i = 0; i < v.length; i++) {
      const nv = walk(v[i], pairs, depth + 1);
      if (nv !== v[i]) { out ??= v.slice(); out[i] = nv; }
    }
    return out ?? v;
  }
  const obj = v as Record<string, unknown>;
  // Audit log change: { key: 'permissions', old_value, new_value }.
  const auditKey = typeof obj.key === 'string' && PERMISSION_KEYS.has(obj.key) && ('new_value' in obj || 'old_value' in obj);
  let out: Record<string, unknown> | null = null;
  for (const [k, child] of Object.entries(obj)) {
    let nv: unknown;
    if (PERMISSION_KEYS.has(k) && (typeof child === 'string' || typeof child === 'number')) nv = convertValue(child, pairs);
    else if (auditKey && (k === 'new_value' || k === 'old_value')) nv = convertValue(child, pairs);
    else if (SKIP_KEYS.has(k)) nv = child;
    else nv = walk(child, pairs, depth + 1);
    if (nv !== child) {
      if (!out) {
        out = {};
        for (const [k2, c2] of Object.entries(obj)) setOwn(out, k2, c2);
      }
      setOwn(out, k, nv);
    }
  }
  return out ?? obj;
}

/** `payload` with every permission bitfield in Discord numbering (outbound, snowflake-format apps). */
export function permissionsToDiscord<T>(payload: T): T {
  return walk(payload, TO_DISCORD, 0) as T;
}

/** `body` with every permission bitfield in Serika numbering (inbound, snowflake-format apps). */
export function permissionsToSerika<T>(body: T): T {
  return walk(body, TO_SERIKA, 0) as T;
}
