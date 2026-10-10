// Pure helpers for the server audit log (no DB, no network): Discord's audit
// log event numbers, change diffs, permission-overwrite diffs and the mapping
// of the legacy `admin_logs` rows. Used by src/lib/services/auditLog.ts, the
// API routes that record entries and the audit log UI.

/** Discord audit log event types (same numbers as Discord's API). */
export const AuditLogEvent = {
  GUILD_UPDATE: 1,
  CHANNEL_CREATE: 10,
  CHANNEL_UPDATE: 11,
  CHANNEL_DELETE: 12,
  CHANNEL_OVERWRITE_CREATE: 13,
  CHANNEL_OVERWRITE_UPDATE: 14,
  CHANNEL_OVERWRITE_DELETE: 15,
  MEMBER_KICK: 20,
  MEMBER_PRUNE: 21,
  MEMBER_BAN_ADD: 22,
  MEMBER_BAN_REMOVE: 23,
  MEMBER_UPDATE: 24,
  MEMBER_ROLE_UPDATE: 25,
  MEMBER_MOVE: 26,
  MEMBER_DISCONNECT: 27,
  BOT_ADD: 28,
  ROLE_CREATE: 30,
  ROLE_UPDATE: 31,
  ROLE_DELETE: 32,
  INVITE_CREATE: 40,
  INVITE_UPDATE: 41,
  INVITE_DELETE: 42,
  WEBHOOK_CREATE: 50,
  WEBHOOK_UPDATE: 51,
  WEBHOOK_DELETE: 52,
  EMOJI_CREATE: 60,
  EMOJI_UPDATE: 61,
  EMOJI_DELETE: 62,
  MESSAGE_DELETE: 72,
  MESSAGE_BULK_DELETE: 73,
  MESSAGE_PIN: 74,
  MESSAGE_UNPIN: 75,
  STICKER_CREATE: 90,
  STICKER_UPDATE: 91,
  STICKER_DELETE: 92,
  THREAD_CREATE: 110,
  THREAD_UPDATE: 111,
  THREAD_DELETE: 112,
  SOUNDBOARD_SOUND_CREATE: 130,
  SOUNDBOARD_SOUND_UPDATE: 131,
  SOUNDBOARD_SOUND_DELETE: 132,
} as const;

export type AuditLogEventName = keyof typeof AuditLogEvent;
export type AuditLogEventType = (typeof AuditLogEvent)[AuditLogEventName];

const EVENT_TYPES = new Set<number>(Object.values(AuditLogEvent));

export function isAuditLogEventType(value: unknown): value is AuditLogEventType {
  return typeof value === 'number' && EVENT_TYPES.has(value);
}

/** What kind of object an event's `targetId` refers to. */
export type AuditTargetKind =
  | 'guild' | 'channel' | 'user' | 'role' | 'invite' | 'webhook'
  | 'emoji' | 'sticker' | 'thread' | 'soundboard';

export function auditTargetKind(action: number): AuditTargetKind {
  if (action < 10) return 'guild';
  if (action < 20) return 'channel';
  if (action < 30) return 'user';
  if (action < 40) return 'role';
  if (action < 50) return 'invite';
  if (action < 60) return 'webhook';
  if (action < 70) return 'emoji';
  if (action < 80) return 'user'; // message events target the author
  if (action >= 90 && action < 100) return 'sticker';
  if (action >= 110 && action < 120) return 'thread';
  if (action >= 130 && action < 140) return 'soundboard';
  return 'guild';
}

/** The broad colour/icon family the UI uses for an event: created, updated or removed. */
export function auditVerb(action: number): 'create' | 'update' | 'delete' {
  switch (action) {
    case AuditLogEvent.CHANNEL_CREATE:
    case AuditLogEvent.CHANNEL_OVERWRITE_CREATE:
    case AuditLogEvent.ROLE_CREATE:
    case AuditLogEvent.INVITE_CREATE:
    case AuditLogEvent.WEBHOOK_CREATE:
    case AuditLogEvent.EMOJI_CREATE:
    case AuditLogEvent.STICKER_CREATE:
    case AuditLogEvent.THREAD_CREATE:
    case AuditLogEvent.SOUNDBOARD_SOUND_CREATE:
    case AuditLogEvent.MESSAGE_PIN:
    case AuditLogEvent.BOT_ADD:
    case AuditLogEvent.MEMBER_BAN_REMOVE:
      return 'create';
    case AuditLogEvent.CHANNEL_DELETE:
    case AuditLogEvent.CHANNEL_OVERWRITE_DELETE:
    case AuditLogEvent.MEMBER_KICK:
    case AuditLogEvent.MEMBER_PRUNE:
    case AuditLogEvent.MEMBER_BAN_ADD:
    case AuditLogEvent.MEMBER_DISCONNECT:
    case AuditLogEvent.ROLE_DELETE:
    case AuditLogEvent.INVITE_DELETE:
    case AuditLogEvent.WEBHOOK_DELETE:
    case AuditLogEvent.EMOJI_DELETE:
    case AuditLogEvent.STICKER_DELETE:
    case AuditLogEvent.THREAD_DELETE:
    case AuditLogEvent.SOUNDBOARD_SOUND_DELETE:
    case AuditLogEvent.MESSAGE_DELETE:
    case AuditLogEvent.MESSAGE_BULK_DELETE:
    case AuditLogEvent.MESSAGE_UNPIN:
      return 'delete';
    default:
      return 'update';
  }
}

/** One changed field, Discord-shaped (`old_value` / `new_value` in the API). */
export interface AuditChange {
  key: string;
  old?: unknown;
  new?: unknown;
}

function normalizeForCompare(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value === undefined || value === '') return null;
  if (typeof value === 'bigint') return value.toString();
  return value;
}

function sameValue(a: unknown, b: unknown): boolean {
  const na = normalizeForCompare(a);
  const nb = normalizeForCompare(b);
  if (na === nb) return true;
  if (na && nb && typeof na === 'object' && typeof nb === 'object') {
    return JSON.stringify(na) === JSON.stringify(nb);
  }
  return false;
}

/**
 * The fields that differ between `before` and `after`. `keys` maps the
 * object key to the audit key (Discord's snake_case names); only those keys
 * are compared, and a key missing from `after` counts as unchanged (partial
 * updates).
 */
export function diffChanges(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  keys: Record<string, string>,
): AuditChange[] {
  const out: AuditChange[] = [];
  const prev = before || {};
  const next = after || {};
  for (const [field, auditKey] of Object.entries(keys)) {
    if (!(field in next)) continue;
    const oldValue = normalizeForCompare(prev[field]);
    const newValue = normalizeForCompare(next[field]);
    if (sameValue(oldValue, newValue)) continue;
    const change: AuditChange = { key: auditKey };
    if (oldValue !== null) change.old = oldValue;
    if (newValue !== null) change.new = newValue;
    out.push(change);
  }
  return out;
}

/** The fields of a freshly created (or deleted) object, as a create/delete diff. */
export function snapshotChanges(
  obj: Record<string, unknown> | null | undefined,
  keys: Record<string, string>,
  side: 'new' | 'old' = 'new',
): AuditChange[] {
  const out: AuditChange[] = [];
  if (!obj) return out;
  for (const [field, auditKey] of Object.entries(keys)) {
    const value = normalizeForCompare(obj[field]);
    if (value === null || value === false || (Array.isArray(value) && value.length === 0)) continue;
    out.push(side === 'new' ? { key: auditKey, new: value } : { key: auditKey, old: value });
  }
  return out;
}

export interface OverwriteLike {
  id: string;
  type: 'role' | 'member' | string;
  allow?: string | null;
  deny?: string | null;
}

export interface OverwriteAuditOp {
  action: 13 | 14 | 15;
  overwriteId: string;
  overwriteType: 'role' | 'member';
  changes: AuditChange[];
}

function bits(v: string | null | undefined): string {
  if (!v) return '0';
  try {
    return BigInt(v).toString();
  } catch {
    return '0';
  }
}

/**
 * Which permission overwrites were added, edited or removed between two
 * overwrite lists, as CHANNEL_OVERWRITE_CREATE / _UPDATE / _DELETE entries.
 */
export function diffOverwrites(
  before: OverwriteLike[] | null | undefined,
  after: OverwriteLike[] | null | undefined,
): OverwriteAuditOp[] {
  const key = (o: OverwriteLike) => String(o.id).toLowerCase();
  const prev = new Map((before || []).map((o) => [key(o), o] as const));
  const next = new Map((after || []).map((o) => [key(o), o] as const));
  const ops: OverwriteAuditOp[] = [];
  for (const [id, o] of next) {
    const type = o.type === 'member' ? 'member' : 'role';
    const old = prev.get(id);
    if (!old) {
      ops.push({
        action: AuditLogEvent.CHANNEL_OVERWRITE_CREATE,
        overwriteId: o.id,
        overwriteType: type,
        changes: [
          { key: 'id', new: o.id },
          { key: 'type', new: type === 'member' ? 1 : 0 },
          { key: 'allow', new: bits(o.allow) },
          { key: 'deny', new: bits(o.deny) },
        ],
      });
      continue;
    }
    const changes: AuditChange[] = [];
    if (bits(old.allow) !== bits(o.allow)) changes.push({ key: 'allow', old: bits(old.allow), new: bits(o.allow) });
    if (bits(old.deny) !== bits(o.deny)) changes.push({ key: 'deny', old: bits(old.deny), new: bits(o.deny) });
    if (changes.length) {
      ops.push({ action: AuditLogEvent.CHANNEL_OVERWRITE_UPDATE, overwriteId: o.id, overwriteType: type, changes });
    }
  }
  for (const [id, o] of prev) {
    if (next.has(id)) continue;
    const type = o.type === 'member' ? 'member' : 'role';
    ops.push({
      action: AuditLogEvent.CHANNEL_OVERWRITE_DELETE,
      overwriteId: o.id,
      overwriteType: type,
      changes: [
        { key: 'id', old: o.id },
        { key: 'type', old: type === 'member' ? 1 : 0 },
        { key: 'allow', old: bits(o.allow) },
        { key: 'deny', old: bits(o.deny) },
      ],
    });
  }
  return ops;
}

/** Role id lists → MEMBER_ROLE_UPDATE `$add` / `$remove` changes (role objects with id + name). */
export function diffMemberRoles(
  before: string[],
  after: string[],
  names: Map<string, string> | Record<string, string>,
): AuditChange[] {
  const lookup = (id: string) => (names instanceof Map ? names.get(id) : names[id]) ?? '';
  const prev = new Set(before.map((r) => r.toLowerCase()));
  const next = new Set(after.map((r) => r.toLowerCase()));
  const added = after.filter((r) => !prev.has(r.toLowerCase()));
  const removed = before.filter((r) => !next.has(r.toLowerCase()));
  const out: AuditChange[] = [];
  if (added.length) out.push({ key: '$add', new: added.map((id) => ({ id, name: lookup(id) })) });
  if (removed.length) out.push({ key: '$remove', new: removed.map((id) => ({ id, name: lookup(id) })) });
  return out;
}

/** A row of the legacy `admin_logs` table that described a server action. */
export interface LegacyAdminLog {
  id: string;
  adminId: string;
  action: string;
  reason?: string | null;
  details?: Record<string, unknown> | null;
  createdAt?: Date | string | null;
}

export interface AuditEntryShape {
  id: string;
  actionType: number;
  userId: string | null;
  targetId: string | null;
  changes: AuditChange[];
  options: Record<string, unknown> | null;
  reason: string | null;
  createdAt: string;
}

/**
 * Converts a legacy `admin_logs` server row (bans, unbans, kicks and timeouts
 * written before the audit log table existed) into an audit entry. Kicks were
 * stored as `ban_user` with `details.kick`. Unknown actions return null.
 */
export function legacyAdminLogToAudit(row: LegacyAdminLog): AuditEntryShape | null {
  const details = row.details || {};
  const targetUser = typeof details.userId === 'string' ? details.userId : null;
  const createdAt = row.createdAt ? new Date(row.createdAt).toISOString() : new Date(0).toISOString();
  const base = { id: row.id, userId: row.adminId, targetId: targetUser, options: null, reason: row.reason ?? null, createdAt };
  switch (row.action) {
    case 'ban_user':
      return { ...base, actionType: details.kick ? AuditLogEvent.MEMBER_KICK : AuditLogEvent.MEMBER_BAN_ADD, changes: [] };
    case 'unban_user':
      return { ...base, actionType: AuditLogEvent.MEMBER_BAN_REMOVE, changes: [] };
    case 'timeout_member': {
      const until = typeof details.until === 'string' ? details.until : null;
      return {
        ...base,
        actionType: AuditLogEvent.MEMBER_UPDATE,
        changes: [until ? { key: 'communication_disabled_until', new: until } : { key: 'communication_disabled_until' }],
      };
    }
    default:
      return null;
  }
}

/** Merges two newest-first lists into one newest-first list of at most `limit`. */
export function mergeAuditEntries(a: AuditEntryShape[], b: AuditEntryShape[], limit: number): AuditEntryShape[] {
  return [...a, ...b]
    .sort((x, y) => (x.createdAt < y.createdAt ? 1 : x.createdAt > y.createdAt ? -1 : 0))
    .slice(0, Math.max(0, limit));
}

/** Reads Discord's `X-Audit-Log-Reason` header (URL-encoded), falling back to a body reason. */
export function auditReason(headerValue: string | undefined | null, bodyReason?: string | null): string | null {
  const fromBody = typeof bodyReason === 'string' ? bodyReason.trim() : '';
  if (fromBody) return fromBody.slice(0, 512);
  if (!headerValue) return null;
  let decoded = headerValue;
  try {
    decoded = decodeURIComponent(headerValue);
  } catch {
    /* keep raw */
  }
  decoded = decoded.trim();
  return decoded ? decoded.slice(0, 512) : null;
}

/** Common key maps (object field → Discord audit key). */
export const CHANNEL_AUDIT_KEYS: Record<string, string> = {
  name: 'name',
  type: 'type',
  topic: 'topic',
  nsfw: 'nsfw',
  rateLimitPerUser: 'rate_limit_per_user',
  bitrate: 'bitrate',
  userLimit: 'user_limit',
  parentId: 'parent_id',
  archived: 'archived',
  locked: 'locked',
  forumMode: 'forum_mode',
};

export const ROLE_AUDIT_KEYS: Record<string, string> = {
  name: 'name',
  color: 'color',
  hoist: 'hoist',
  mentionable: 'mentionable',
  permissions: 'permissions',
  icon: 'icon_hash',
  unicodeEmoji: 'unicode_emoji',
};

export const GUILD_AUDIT_KEYS: Record<string, string> = {
  name: 'name',
  description: 'description',
  icon: 'icon_hash',
  banner: 'banner_hash',
  systemChannelId: 'system_channel_id',
  rulesChannelId: 'rules_channel_id',
  afkChannelId: 'afk_channel_id',
  afkTimeout: 'afk_timeout',
  verificationLevel: 'verification_level',
  explicitContentFilter: 'explicit_content_filter',
  isAgeGated: 'nsfw',
  joinMode: 'join_mode',
  vanityUrlCode: 'vanity_url_code',
  discoveryDescription: 'discovery_description',
};
