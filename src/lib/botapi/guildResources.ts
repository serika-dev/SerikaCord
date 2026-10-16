/**
 * Pure request parsing for the Discord v10 guild resource routes (WP4a):
 * guild settings, guild channels, permission overwrites, roles, positions,
 * member / ban list queries, prune and bulk ban. Discord's field names and
 * limits in, Serika's column values out, with 50035 error trees (FormErrors)
 * for anything invalid. No DB, no I/O: the routes in src/lib/api/botApi.ts
 * do the lookups (parents in the guild, role ids, hierarchy) themselves.
 */
import { FE, FormErrors } from './formErrors';
import type { EditableOverwrite } from '@/lib/permissions/overwriteEditor';

export type GuildChannelType = 'text' | 'voice' | 'category' | 'announcement' | 'stage' | 'forum';

/** Discord channel type numbers a bot may create, mapped to Serika channel types. */
export const CHANNEL_TYPE_FROM_DISCORD: Readonly<Record<number, GuildChannelType>> = {
  0: 'text', 2: 'voice', 4: 'category', 5: 'announcement', 13: 'stage', 15: 'forum',
};

const VERIFICATION_LEVELS = ['none', 'low', 'medium', 'high', 'very_high'] as const;
const EXPLICIT_FILTERS = ['disabled', 'members_without_roles', 'all_members'] as const;
const DEFAULT_NOTIFICATIONS = ['all_messages', 'only_mentions'] as const;
export const AFK_TIMEOUTS = [60, 300, 900, 1800, 3600] as const;
export const AUTO_ARCHIVE_DURATIONS = [60, 1440, 4320, 10080] as const;

export const MAX_OVERWRITES = 100;
export const MAX_BULK_BAN = 200;
export const MAX_DELETE_MESSAGE_SECONDS = 604800;

type Clean = (s: string) => string;
const identity: Clean = (s) => s;

function has(body: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined;
}

function asInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  if (typeof v === 'string' && /^-?\d{1,16}$/.test(v.trim())) return Number(v.trim());
  return null;
}

function intField(errors: FormErrors, key: string, v: unknown, min: number, max: number): number | undefined {
  const n = asInt(v);
  if (n === null) { errors.add([key], FE.COERCE, 'Value is not int.'); return undefined; }
  if (n < min) { errors.add([key], FE.MIN, `int value should be greater than or equal to ${min}.`); return undefined; }
  if (n > max) { errors.add([key], FE.MAX, `int value should be less than or equal to ${max}.`); return undefined; }
  return n;
}

function boolField(errors: FormErrors, key: string, v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  errors.add([key], FE.BAD_TYPE, 'Must be either true or false.');
  return undefined;
}

function stringField(
  errors: FormErrors, key: string, v: unknown, min: number, max: number, opts: { nullable?: boolean; clean?: Clean } = {},
): string | null | undefined {
  if (v === null) {
    if (opts.nullable) return null;
    errors.add([key], FE.BAD_TYPE, 'This field is required');
    return undefined;
  }
  if (typeof v !== 'string') { errors.add([key], FE.BAD_TYPE, 'Could not interpret value as string.'); return undefined; }
  const s = (opts.clean ?? identity)(v);
  if (s.length < min || s.length > max) {
    errors.add([key], FE.BAD_LENGTH, `Must be between ${min} and ${max} in length.`);
    return undefined;
  }
  return s;
}

/** An id in a body (string, or a JSON number discord.py may send). */
export function idValue(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return String(v);
  if (typeof v === 'bigint' && v >= 0n) return v.toString();
  return null;
}

function bitsValue(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return '0';
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return String(v);
  if (typeof v === 'bigint' && v >= 0n) return v.toString();
  if (typeof v === 'string' && /^\d{1,40}$/.test(v.trim())) {
    try { return BigInt(v.trim()).toString(); } catch { return null; }
  }
  return null;
}

/** Discord overwrite type (0 role, 1 member; strings accepted) -> Serika's. */
export function overwriteType(v: unknown): 'role' | 'member' | null {
  if (v === 0 || v === '0' || v === 'role') return 'role';
  if (v === 1 || v === '1' || v === 'member') return 'member';
  return null;
}

/** Parse one Discord overwrite ({ id, type, allow, deny }); errors go under `path`. */
export function parseOverwrite(raw: unknown, errors: FormErrors, path: Array<string | number>): EditableOverwrite | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.add(path, FE.BAD_TYPE, 'Only dictionaries may be used in a ModelType');
    return null;
  }
  const o = raw as Record<string, unknown>;
  const id = idValue(o.id);
  const type = overwriteType(o.type);
  const allow = bitsValue(o.allow);
  const deny = bitsValue(o.deny);
  let ok = true;
  if (!id) { errors.add([...path, 'id'], FE.REQUIRED, 'This field is required'); ok = false; }
  if (!type) { errors.add([...path, 'type'], FE.CHOICES, 'Value must be one of (0, 1).'); ok = false; }
  if (allow === null) { errors.add([...path, 'allow'], FE.COERCE, 'Value is not a valid permission bitfield.'); ok = false; }
  if (deny === null) { errors.add([...path, 'deny'], FE.COERCE, 'Value is not a valid permission bitfield.'); ok = false; }
  if (!ok) return null;
  return { id: id!, type: type!, allow: allow!, deny: deny! };
}

/** Parse `permission_overwrites` (at most 100, one per target). */
export function parseOverwrites(raw: unknown, errors: FormErrors, key = 'permission_overwrites'): EditableOverwrite[] | null {
  if (raw === null) return [];
  if (!Array.isArray(raw)) { errors.add([key], FE.BAD_TYPE, 'Must be an array.'); return null; }
  if (raw.length > MAX_OVERWRITES) { errors.add([key], FE.MAX_LENGTH, `Must be ${MAX_OVERWRITES} or fewer in length.`); return null; }
  const out: EditableOverwrite[] = [];
  const seen = new Set<string>();
  raw.forEach((item, i) => {
    const o = parseOverwrite(item, errors, [key, i]);
    if (!o) return;
    const k = `${o.type}:${o.id.toLowerCase()}`;
    if (seen.has(k)) return; // Discord keeps the last; duplicates are harmless to drop
    seen.add(k);
    out.push(o);
  });
  return errors.ok ? out : null;
}

/** OR of every allow and deny bit: what a bot must itself hold to set these overwrites. */
export function overwriteBits(list: ReadonlyArray<Pick<EditableOverwrite, 'allow' | 'deny'>>): bigint {
  let bits = 0n;
  for (const o of list) {
    try { bits |= BigInt(o.allow || '0') | BigInt(o.deny || '0'); } catch { /* validated already */ }
  }
  return bits;
}

/**
 * Bits that change between two overwrite lists (per target, allow and deny),
 * so editing one overwrite only needs the bits it touches.
 */
export function changedOverwriteBits(
  before: ReadonlyArray<EditableOverwrite>,
  after: ReadonlyArray<EditableOverwrite>,
): bigint {
  const key = (o: EditableOverwrite) => `${o.type}:${o.id.toLowerCase()}`;
  const big = (v: string | undefined) => { try { return BigInt(v || '0'); } catch { return 0n; } };
  const prev = new Map(before.map((o) => [key(o), o]));
  const next = new Map(after.map((o) => [key(o), o]));
  let bits = 0n;
  for (const k of new Set([...prev.keys(), ...next.keys()])) {
    const a = prev.get(k);
    const b = next.get(k);
    bits |= big(a?.allow) ^ big(b?.allow);
    bits |= big(a?.deny) ^ big(b?.deny);
  }
  return bits;
}

/** Fields of POST /guilds/{id}/channels and PATCH /channels/{id} that Serika stores. */
export interface ChannelFields {
  name?: string;
  type?: GuildChannelType;
  topic?: string | null;
  position?: number;
  nsfw?: boolean;
  rateLimitPerUser?: number;
  bitrate?: number;
  userLimit?: number;
  rtcRegion?: string | null;
  defaultAutoArchiveDuration?: number;
  /** undefined = untouched, null = no category, string = category id (route validates it). */
  parentId?: string | null;
  permissionOverwrites?: EditableOverwrite[];
  /** PATCH only: sync overwrites with the new parent (`lock_permissions`). */
  lockPermissions?: boolean;
}

/**
 * Parse a guild channel body. `current` is the channel being edited (null on
 * create). Thread / forum-only fields are left to the thread routes.
 */
export function parseChannelFields(
  body: unknown,
  current: { type: string } | null,
  opts: { clean?: Clean } = {},
): { fields: ChannelFields; errors: FormErrors } {
  const errors = new FormErrors();
  const fields: ChannelFields = {};
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    errors.add([], FE.BAD_TYPE, 'Only dictionaries may be used in a ModelType');
    return { fields, errors };
  }
  const b = body as Record<string, unknown>;
  const creating = current === null;

  if (has(b, 'name')) {
    const name = stringField(errors, 'name', b.name, 1, 100, { clean: opts.clean });
    if (name) fields.name = name;
  } else if (creating) {
    errors.add(['name'], FE.REQUIRED, 'This field is required');
  }

  let type: GuildChannelType | undefined;
  if (has(b, 'type')) {
    const n = asInt(b.type);
    const mapped = n === null ? undefined : CHANNEL_TYPE_FROM_DISCORD[n];
    if (!mapped) {
      errors.add(['type'], FE.CHOICES, 'Value must be one of (0, 2, 4, 5, 13, 15).');
    } else if (creating) {
      type = mapped;
    } else if (mapped !== current!.type) {
      // Only text <-> announcement conversions, like the web app (and Discord).
      const convertible = (t: string) => t === 'text' || t === 'announcement';
      if (convertible(current!.type) && convertible(mapped)) type = mapped;
      else errors.add(['type'], FE.CHOICES, 'Only text and announcement channels can be converted.');
    }
  }
  if (type) fields.type = type;
  const effectiveType = type ?? (current?.type as GuildChannelType | undefined) ?? 'text';
  const isVoice = effectiveType === 'voice' || effectiveType === 'stage';
  const isCategory = effectiveType === 'category';

  if (has(b, 'topic')) {
    if (!isVoice && !isCategory) {
      const topic = stringField(errors, 'topic', b.topic, 0, effectiveType === 'forum' ? 4096 : 1024, { nullable: true, clean: opts.clean });
      if (topic !== undefined) fields.topic = topic;
    }
  }
  if (has(b, 'position') && b.position !== null) {
    const p = intField(errors, 'position', b.position, 0, 1_000_000);
    if (p !== undefined) fields.position = p;
  }
  if (has(b, 'nsfw') && b.nsfw !== null && !isCategory) {
    const v = boolField(errors, 'nsfw', b.nsfw);
    if (v !== undefined) fields.nsfw = v;
  }
  if (has(b, 'rate_limit_per_user') && b.rate_limit_per_user !== null && !isCategory) {
    const v = intField(errors, 'rate_limit_per_user', b.rate_limit_per_user, 0, 21600);
    if (v !== undefined) fields.rateLimitPerUser = v;
  }
  if (isVoice) {
    if (has(b, 'bitrate') && b.bitrate !== null) {
      const v = intField(errors, 'bitrate', b.bitrate, 8000, 384000);
      if (v !== undefined) fields.bitrate = v;
    }
    if (has(b, 'user_limit') && b.user_limit !== null) {
      const v = intField(errors, 'user_limit', b.user_limit, 0, effectiveType === 'stage' ? 10000 : 99);
      if (v !== undefined) fields.userLimit = v;
    }
    if (has(b, 'rtc_region')) {
      const v = stringField(errors, 'rtc_region', b.rtc_region, 1, 32, { nullable: true });
      if (v !== undefined) fields.rtcRegion = v;
    }
  }
  if (has(b, 'default_auto_archive_duration') && b.default_auto_archive_duration !== null && !isVoice && !isCategory) {
    const v = asInt(b.default_auto_archive_duration);
    if (v === null || !(AUTO_ARCHIVE_DURATIONS as readonly number[]).includes(v)) {
      errors.add(['default_auto_archive_duration'], FE.CHOICES, 'Value must be one of (60, 1440, 4320, 10080).');
    } else {
      fields.defaultAutoArchiveDuration = v;
    }
  }
  if (has(b, 'parent_id')) {
    if (b.parent_id === null) fields.parentId = null;
    else {
      const id = idValue(b.parent_id);
      if (!id) errors.add(['parent_id'], FE.BAD_TYPE, 'Value "' + String(b.parent_id) + '" is not snowflake.');
      else if (isCategory) errors.add(['parent_id'], 'CHANNEL_PARENT_INVALID', 'A category cannot have a parent category.');
      else fields.parentId = id;
    }
  }
  if (has(b, 'permission_overwrites')) {
    const list = parseOverwrites(b.permission_overwrites, errors);
    if (list) fields.permissionOverwrites = list;
  }
  if (!creating && has(b, 'lock_permissions') && b.lock_permissions !== null) {
    const v = boolField(errors, 'lock_permissions', b.lock_permissions);
    if (v !== undefined) fields.lockPermissions = v;
  }
  return { fields, errors };
}

/** One entry of PATCH /guilds/{id}/channels. */
export interface ChannelPositionUpdate {
  id: string;
  position?: number;
  /** undefined = untouched, null = out of its category. */
  parentId?: string | null;
  lockPermissions?: boolean;
}

export function parseChannelPositions(body: unknown): { updates: ChannelPositionUpdate[]; errors: FormErrors } {
  const errors = new FormErrors();
  const updates: ChannelPositionUpdate[] = [];
  if (!Array.isArray(body)) {
    errors.add([], FE.BAD_TYPE, 'Must be an array.');
    return { updates, errors };
  }
  if (body.length === 0) errors.add([], FE.MIN_LENGTH, 'Must be 1 or more in length.');
  if (body.length > 500) errors.add([], FE.MAX_LENGTH, 'Must be 500 or fewer in length.');
  const seen = new Set<string>();
  body.forEach((raw, i) => {
    if (!raw || typeof raw !== 'object') { errors.add([i], FE.BAD_TYPE, 'Only dictionaries may be used in a ModelType'); return; }
    const o = raw as Record<string, unknown>;
    const id = idValue(o.id);
    if (!id) { errors.add([i, 'id'], FE.REQUIRED, 'This field is required'); return; }
    if (seen.has(id.toLowerCase())) { errors.add([i, 'id'], 'DUPLICATE_ID', 'Duplicate channel id.'); return; }
    seen.add(id.toLowerCase());
    const u: ChannelPositionUpdate = { id };
    if (o.position !== undefined && o.position !== null) {
      const p = asInt(o.position);
      if (p === null || p < 0) { errors.add([i, 'position'], FE.COERCE, 'Value is not int.'); return; }
      u.position = p;
    }
    if (o.parent_id !== undefined) {
      if (o.parent_id === null) u.parentId = null;
      else {
        const pid = idValue(o.parent_id);
        if (!pid) { errors.add([i, 'parent_id'], FE.BAD_TYPE, 'Value is not snowflake.'); return; }
        u.parentId = pid;
      }
    }
    if (o.lock_permissions !== undefined && o.lock_permissions !== null) {
      if (typeof o.lock_permissions !== 'boolean') { errors.add([i, 'lock_permissions'], FE.BAD_TYPE, 'Must be either true or false.'); return; }
      u.lockPermissions = o.lock_permissions;
    }
    updates.push(u);
  });
  return { updates, errors };
}

/** One entry of PATCH /guilds/{id}/roles. */
export interface RolePositionUpdate { id: string; position?: number }

export function parseRolePositions(body: unknown): { updates: RolePositionUpdate[]; errors: FormErrors } {
  const errors = new FormErrors();
  const updates: RolePositionUpdate[] = [];
  if (!Array.isArray(body)) {
    errors.add([], FE.BAD_TYPE, 'Must be an array.');
    return { updates, errors };
  }
  if (body.length > 250) errors.add([], FE.MAX_LENGTH, 'Must be 250 or fewer in length.');
  const seen = new Set<string>();
  body.forEach((raw, i) => {
    if (!raw || typeof raw !== 'object') { errors.add([i], FE.BAD_TYPE, 'Only dictionaries may be used in a ModelType'); return; }
    const o = raw as Record<string, unknown>;
    const id = idValue(o.id);
    if (!id) { errors.add([i, 'id'], FE.REQUIRED, 'This field is required'); return; }
    if (seen.has(id.toLowerCase())) { errors.add([i, 'id'], 'DUPLICATE_ID', 'Duplicate role id.'); return; }
    seen.add(id.toLowerCase());
    const u: RolePositionUpdate = { id };
    if (o.position !== undefined && o.position !== null) {
      const p = asInt(o.position);
      if (p === null || p < 0) { errors.add([i, 'position'], FE.COERCE, 'Value is not int.'); return; }
      u.position = p;
    }
    updates.push(u);
  });
  return { updates, errors };
}

/** Sort key: a moved item wins the tie with the item already at its target, on the side it came from. */
function moveKey(key: number, old: number, moved: boolean): number {
  if (!moved || key === old) return key;
  return key > old ? key + 0.5 : key - 0.5;
}

/**
 * Apply Discord-style position updates to a guild's non-default roles.
 * Requested positions are absolute; roles without one keep theirs; ties keep
 * the previous order (a role moved up lands above the one already at its new
 * position, a role moved down below it, so it ends exactly where it was sent,
 * like Discord). Returns every role id, highest first, and
 * the final 1..N position of each (the @everyone role stays at 0).
 */
export function applyRolePositions(
  roles: ReadonlyArray<{ id: string; position?: number | null; isDefault?: boolean | null }>,
  updates: readonly RolePositionUpdate[],
): { orderedHighestFirst: string[]; positions: Map<string, number> } {
  const want = new Map(updates.filter((u) => u.position !== undefined).map((u) => [u.id.toLowerCase(), u.position as number]));
  const list = roles
    .filter((r) => !r.isDefault)
    .map((r, i) => ({
      id: r.id,
      old: r.position ?? 0,
      idx: i,
      key: want.get(r.id.toLowerCase()) ?? (r.position ?? 0),
      moved: want.has(r.id.toLowerCase()),
    }))
    .sort((a, b) => a.old - b.old || a.idx - b.idx);
  const sorted = [...list].sort((a, b) => moveKey(a.key, a.old, a.moved) - moveKey(b.key, b.old, b.moved) || a.old - b.old || a.idx - b.idx);
  const positions = new Map<string, number>();
  sorted.forEach((r, i) => positions.set(r.id, i + 1));
  return { orderedHighestFirst: [...sorted].reverse().map((r) => r.id), positions };
}

/**
 * Same for channels: one sibling list per parent, sorted by requested (or
 * current) position, renumbered 0..N-1. Returns the final position and parent
 * of every channel that changed.
 */
export function applyChannelPositions(
  channels: ReadonlyArray<{ id: string; position?: number | null; parentId?: string | null; type?: string | null }>,
  updates: readonly ChannelPositionUpdate[],
): Map<string, { position: number; parentId: string | null }> {
  const byId = new Map(updates.map((u) => [u.id.toLowerCase(), u]));
  const rows = channels.map((c, i) => {
    const u = byId.get(c.id.toLowerCase());
    const parentId = u && u.parentId !== undefined ? u.parentId : (c.parentId ?? null);
    return {
      id: c.id,
      type: c.type,
      idx: i,
      oldPos: c.position ?? 0,
      oldParent: c.parentId ?? null,
      parentId,
      key: u?.position ?? (c.position ?? 0),
      moved: !!u && u.position !== undefined,
    };
  });
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const g = `${r.type === 'category' ? 'cat' : 'ch'}:${(r.parentId ?? '').toLowerCase()}`;
    const arr = groups.get(g) ?? [];
    arr.push(r);
    groups.set(g, arr);
  }
  const out = new Map<string, { position: number; parentId: string | null }>();
  for (const arr of groups.values()) {
    arr.sort((a, b) => moveKey(a.key, a.oldPos, a.moved) - moveKey(b.key, b.oldPos, b.moved) || a.oldPos - b.oldPos || a.idx - b.idx);
    arr.forEach((r, i) => {
      if (r.oldPos !== i || (r.oldParent ?? null) !== (r.parentId ?? null)) out.set(r.id, { position: i, parentId: r.parentId ?? null });
    });
  }
  return out;
}

/** Fields of PATCH /guilds/{id} that Serika stores (image fields stay raw for the route to upload). */
export interface GuildFields {
  name?: string;
  description?: string | null;
  verificationLevel?: string;
  defaultNotifications?: string;
  explicitContentFilter?: string;
  afkChannelId?: string | null;
  afkTimeout?: number;
  systemChannelId?: string | null;
  rulesChannelId?: string | null;
  publicUpdatesChannelId?: string | null;
  ownerId?: string;
  icon?: string | null;
  banner?: string | null;
  splash?: string | null;
  discoverySplash?: string | null;
}

export function parseGuildFields(body: unknown, opts: { clean?: Clean } = {}): { fields: GuildFields; errors: FormErrors } {
  const errors = new FormErrors();
  const fields: GuildFields = {};
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    errors.add([], FE.BAD_TYPE, 'Only dictionaries may be used in a ModelType');
    return { fields, errors };
  }
  const b = body as Record<string, unknown>;
  if (has(b, 'name')) {
    const v = stringField(errors, 'name', b.name, 2, 100, { clean: opts.clean });
    if (v) fields.name = v;
  }
  if (has(b, 'description')) {
    const v = stringField(errors, 'description', b.description, 0, 1024, { nullable: true, clean: opts.clean });
    if (v !== undefined) fields.description = v;
  }
  const choice = (key: string, values: readonly string[], set: (v: string) => void) => {
    if (!has(b, key) || b[key] === null) return;
    const n = asInt(b[key]);
    if (n === null || n < 0 || n >= values.length) errors.add([key], FE.CHOICES, `Value must be one of (${values.map((_, i) => i).join(', ')}).`);
    else set(values[n]);
  };
  choice('verification_level', VERIFICATION_LEVELS, (v) => { fields.verificationLevel = v; });
  choice('default_message_notifications', DEFAULT_NOTIFICATIONS, (v) => { fields.defaultNotifications = v; });
  choice('explicit_content_filter', EXPLICIT_FILTERS, (v) => { fields.explicitContentFilter = v; });
  if (has(b, 'afk_timeout') && b.afk_timeout !== null) {
    const n = asInt(b.afk_timeout);
    if (n === null || !(AFK_TIMEOUTS as readonly number[]).includes(n)) errors.add(['afk_timeout'], FE.CHOICES, 'Value must be one of (60, 300, 900, 1800, 3600).');
    else fields.afkTimeout = n;
  }
  const channelRef = (key: string, set: (v: string | null) => void) => {
    if (!has(b, key)) return;
    if (b[key] === null) { set(null); return; }
    const id = idValue(b[key]);
    if (!id) errors.add([key], FE.BAD_TYPE, 'Value is not snowflake.');
    else set(id);
  };
  channelRef('afk_channel_id', (v) => { fields.afkChannelId = v; });
  channelRef('system_channel_id', (v) => { fields.systemChannelId = v; });
  channelRef('rules_channel_id', (v) => { fields.rulesChannelId = v; });
  channelRef('public_updates_channel_id', (v) => { fields.publicUpdatesChannelId = v; });
  if (has(b, 'owner_id') && b.owner_id !== null) {
    const id = idValue(b.owner_id);
    if (!id) errors.add(['owner_id'], FE.BAD_TYPE, 'Value is not snowflake.');
    else fields.ownerId = id;
  }
  const image = (key: string, set: (v: string | null) => void) => {
    if (!has(b, key)) return;
    if (b[key] === null) { set(null); return; }
    if (typeof b[key] !== 'string' || !(b[key] as string).startsWith('data:')) {
      errors.add([key], 'IMAGE_INVALID', 'Invalid image data');
      return;
    }
    set(b[key] as string);
  };
  image('icon', (v) => { fields.icon = v; });
  image('banner', (v) => { fields.banner = v; });
  image('splash', (v) => { fields.splash = v; });
  image('discovery_splash', (v) => { fields.discoverySplash = v; });
  return { fields, errors };
}

/** Fields of POST / PATCH /guilds/{id}/roles[/{rid}] that Serika stores. */
export interface RoleFields {
  name?: string;
  permissions?: bigint;
  color?: number;
  hoist?: boolean;
  mentionable?: boolean;
  /** Image data URI (route uploads it) or null to remove. */
  icon?: string | null;
  unicodeEmoji?: string | null;
  position?: number;
}

export function parseRoleFields(body: unknown, opts: { clean?: Clean } = {}): { fields: RoleFields; errors: FormErrors } {
  const errors = new FormErrors();
  const fields: RoleFields = {};
  if (body === null || body === undefined) return { fields, errors };
  if (typeof body !== 'object' || Array.isArray(body)) {
    errors.add([], FE.BAD_TYPE, 'Only dictionaries may be used in a ModelType');
    return { fields, errors };
  }
  const b = body as Record<string, unknown>;
  if (has(b, 'name') && b.name !== null) {
    const v = stringField(errors, 'name', b.name, 1, 100, { clean: opts.clean });
    if (v) fields.name = v;
  }
  if (has(b, 'permissions') && b.permissions !== null) {
    const raw = bitsValue(b.permissions);
    if (raw === null) errors.add(['permissions'], FE.COERCE, 'Value is not a valid permission bitfield.');
    else fields.permissions = BigInt(raw);
  }
  // `colors.primary_color` (role gradients) wins over the legacy `color`.
  const colors = b.colors && typeof b.colors === 'object' ? (b.colors as Record<string, unknown>) : null;
  const colorRaw = colors && colors.primary_color !== undefined && colors.primary_color !== null ? colors.primary_color : b.color;
  if (colorRaw !== undefined && colorRaw !== null) {
    const n = asInt(colorRaw);
    if (n === null || n < 0 || n > 0xffffff) errors.add([colors?.primary_color !== undefined ? 'colors' : 'color'], FE.MAX, 'int value should be less than or equal to 16777215.');
    else fields.color = n;
  }
  if (has(b, 'hoist') && b.hoist !== null) {
    const v = boolField(errors, 'hoist', b.hoist);
    if (v !== undefined) fields.hoist = v;
  }
  if (has(b, 'mentionable') && b.mentionable !== null) {
    const v = boolField(errors, 'mentionable', b.mentionable);
    if (v !== undefined) fields.mentionable = v;
  }
  if (has(b, 'icon')) {
    if (b.icon === null) fields.icon = null;
    else if (typeof b.icon === 'string' && b.icon.startsWith('data:')) fields.icon = b.icon;
    else errors.add(['icon'], 'IMAGE_INVALID', 'Invalid image data');
  }
  if (has(b, 'unicode_emoji')) {
    const v = stringField(errors, 'unicode_emoji', b.unicode_emoji, 1, 32, { nullable: true });
    if (v !== undefined) fields.unicodeEmoji = v;
  }
  if (has(b, 'position') && b.position !== null) {
    const v = intField(errors, 'position', b.position, 0, 1_000_000);
    if (v !== undefined) fields.position = v;
  }
  return { fields, errors };
}

/** `limit` query: 1..max, default `def` (members: 1, like Discord). */
export function parseLimit(raw: unknown, def: number, max: number): number | null {
  if (raw === undefined || raw === null || raw === '') return def;
  const n = asInt(raw);
  if (n === null || n < 1 || n > max) return null;
  return n;
}

/** GET/POST /guilds/{id}/prune options. */
export interface PruneOptions {
  days: number;
  includeRoles: string[];
  computeCount: boolean;
}

export function parsePruneOptions(src: Record<string, unknown> | null | undefined, method: 'GET' | 'POST'): { options: PruneOptions; errors: FormErrors } {
  const errors = new FormErrors();
  const s = src ?? {};
  let days = 7;
  if (s.days !== undefined && s.days !== null && s.days !== '') {
    const n = asInt(s.days);
    if (n === null || n < 1 || n > 30) errors.add(['days'], FE.MAX, 'int value should be between 1 and 30.');
    else days = n;
  }
  let includeRoles: string[] = [];
  const rawRoles = s.include_roles;
  if (Array.isArray(rawRoles)) includeRoles = rawRoles.map(idValue).filter((v): v is string => !!v);
  else if (typeof rawRoles === 'string' && rawRoles.trim()) includeRoles = rawRoles.split(',').map((x) => x.trim()).filter(Boolean);
  if (includeRoles.length > 100) errors.add(['include_roles'], FE.MAX_LENGTH, 'Must be 100 or fewer in length.');
  let computeCount = true;
  if (method === 'POST' && s.compute_prune_count !== undefined && s.compute_prune_count !== null) {
    if (typeof s.compute_prune_count === 'boolean') computeCount = s.compute_prune_count;
    else errors.add(['compute_prune_count'], FE.BAD_TYPE, 'Must be either true or false.');
  }
  return { options: { days, includeRoles, computeCount }, errors };
}

/**
 * Whether a member is pruned: no roles besides @everyone (or only roles in
 * `includeRoles`), not a bot, not the owner, and not seen for `days`.
 */
export function isPrunable(
  m: { roles: readonly string[]; isBot: boolean; isOwner: boolean; lastSeenAt: Date | null },
  opts: { days: number; includeRoles: readonly string[]; everyoneRoleId: string | null; now?: number },
): boolean {
  if (m.isBot || m.isOwner) return false;
  const everyone = (opts.everyoneRoleId ?? '').toLowerCase();
  const include = new Set(opts.includeRoles.map((r) => r.toLowerCase()));
  const roles = m.roles.map((r) => r.toLowerCase()).filter((r) => r !== everyone);
  if (roles.some((r) => !include.has(r))) return false;
  const cutoff = (opts.now ?? Date.now()) - opts.days * 86_400_000;
  return !m.lastSeenAt || m.lastSeenAt.getTime() < cutoff;
}

/** `delete_message_seconds` (0..604800); the deprecated `delete_message_days` (0..7) still works. */
export function parseDeleteMessageSeconds(b: Record<string, unknown> | null | undefined, errors: FormErrors): number {
  const s = b ?? {};
  if (s.delete_message_seconds !== undefined && s.delete_message_seconds !== null) {
    const n = asInt(s.delete_message_seconds);
    if (n === null || n < 0 || n > MAX_DELETE_MESSAGE_SECONDS) {
      errors.add(['delete_message_seconds'], FE.MAX, `int value should be less than or equal to ${MAX_DELETE_MESSAGE_SECONDS}.`);
      return 0;
    }
    return n;
  }
  if (s.delete_message_days !== undefined && s.delete_message_days !== null) {
    const n = asInt(s.delete_message_days);
    if (n === null || n < 0 || n > 7) {
      errors.add(['delete_message_days'], FE.MAX, 'int value should be less than or equal to 7.');
      return 0;
    }
    return n * 86400;
  }
  return 0;
}

/** POST /guilds/{id}/bulk-ban body. */
export function parseBulkBan(body: unknown): { userIds: string[]; deleteMessageSeconds: number; errors: FormErrors } {
  const errors = new FormErrors();
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  if (!b) {
    errors.add([], FE.BAD_TYPE, 'Only dictionaries may be used in a ModelType');
    return { userIds: [], deleteMessageSeconds: 0, errors };
  }
  let userIds: string[] = [];
  if (!Array.isArray(b.user_ids)) errors.add(['user_ids'], FE.REQUIRED, 'This field is required');
  else if (b.user_ids.length === 0) errors.add(['user_ids'], FE.MIN_LENGTH, 'Must be 1 or more in length.');
  else if (b.user_ids.length > MAX_BULK_BAN) errors.add(['user_ids'], FE.MAX_LENGTH, `Must be ${MAX_BULK_BAN} or fewer in length.`);
  else {
    const ids = b.user_ids.map(idValue);
    ids.forEach((id, i) => { if (!id) errors.add(['user_ids', i], FE.BAD_TYPE, 'Value is not snowflake.'); });
    userIds = [...new Set(ids.filter((v): v is string => !!v).map((v) => v.toLowerCase()))];
  }
  const deleteMessageSeconds = parseDeleteMessageSeconds(b, errors);
  return { userIds, deleteMessageSeconds, errors };
}

/** Escape LIKE wildcards for a prefix search. */
export function likePrefix(q: string): string {
  return `${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
