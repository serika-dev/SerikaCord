/**
 * Discord v10 thread + forum rules for the bot API, pure (no DB): request
 * validation for thread creation and thread / forum PATCH, the permission
 * checks Discord documents for them, archived-thread pagination and the
 * Discord channel flags Serika stores. Used by src/lib/botapi/threads.ts;
 * tested in tests/bot-threads.test.ts.
 */
import { DEFAULT_SLOP, matchThreadName, parseSlop, relevanceScore, searchWords } from './threadSearchMatch';
import { FormErrors, type DiscordFormError } from './formErrors';
import { AUTO_ARCHIVE_DURATIONS, MAX_THREAD_NAME_LENGTH, type AutoArchiveDuration } from '@/lib/chat/threads';

/** Discord channel flags Serika stores (channels.flags). */
export const CHANNEL_FLAGS = {
  PINNED: 1 << 1,
  REQUIRE_TAG: 1 << 4,
} as const;

export const MAX_RATE_LIMIT_PER_USER = 21600;
export const MAX_APPLIED_TAGS = 5;
export const MAX_AVAILABLE_TAGS = 20;
export const MAX_TAG_NAME = 20;
/** Discord's "Thread is archived" / "Cannot execute action on this channel type". */
export const THREAD_ARCHIVED = { code: 50083, message: 'Thread is archived' } as const;
export const WRONG_CHANNEL_TYPE = { code: 50024, message: 'Cannot execute action on this channel type' } as const;
export const THREAD_ALREADY_CREATED = { code: 160004, message: 'A thread has already been created for this message' } as const;
export const TAG_REQUIRED = { code: 40067, message: 'A tag is required to create a forum post in this channel' } as const;
export const THREAD_LOCKED = { code: 160005, message: 'Thread is locked' } as const;

export type SerikaThreadType = 'public_thread' | 'private_thread';

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

function checkName(errors: FormErrors, name: unknown, required: boolean): string | undefined {
  if (name === undefined || name === null) {
    if (required) errors.add(['name'], 'BASE_TYPE_REQUIRED', 'This field is required');
    return undefined;
  }
  if (typeof name !== 'string') { errors.add(['name'], 'BASE_TYPE_STRING', 'Must be a string.'); return undefined; }
  const trimmed = name.trim();
  if (trimmed.length < 1 || name.length > MAX_THREAD_NAME_LENGTH) {
    errors.add(['name'], 'BASE_TYPE_BAD_LENGTH', `Must be between 1 and ${MAX_THREAD_NAME_LENGTH} in length.`);
    return undefined;
  }
  return trimmed;
}

function checkAutoArchive(errors: FormErrors, v: unknown): AutoArchiveDuration | undefined {
  if (v === undefined || v === null) return undefined;
  if (!isInt(v) || !(AUTO_ARCHIVE_DURATIONS as readonly number[]).includes(v)) {
    errors.add(['auto_archive_duration'], 'BASE_TYPE_CHOICES', `Value must be one of {${AUTO_ARCHIVE_DURATIONS.join(', ')}}.`);
    return undefined;
  }
  return v as AutoArchiveDuration;
}

function checkRateLimit(errors: FormErrors, key: string, v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (!isInt(v)) { errors.add([key], 'NUMBER_TYPE_COERCE', `Value "${String(v)}" is not int.`); return undefined; }
  if (v < 0) { errors.add([key], 'NUMBER_TYPE_MIN', 'int value should be greater than or equal to 0.'); return undefined; }
  if (v > MAX_RATE_LIMIT_PER_USER) { errors.add([key], 'NUMBER_TYPE_MAX', `int value should be less than or equal to ${MAX_RATE_LIMIT_PER_USER}.`); return undefined; }
  return v;
}

function checkTagIds(errors: FormErrors, v: unknown, available: ReadonlySet<string>): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) { errors.add(['applied_tags'], 'BASE_TYPE_ARRAY', 'Must be an array.'); return undefined; }
  if (v.length > MAX_APPLIED_TAGS) { errors.add(['applied_tags'], 'BASE_TYPE_MAX_LENGTH', `Must be ${MAX_APPLIED_TAGS} or fewer in length.`); return undefined; }
  const out: string[] = [];
  v.forEach((id, i) => {
    const s = typeof id === 'string' || typeof id === 'number' ? String(id) : '';
    const match = [...available].find((t) => t.toLowerCase() === s.toLowerCase());
    if (!match) errors.add(['applied_tags', i], 'FORUM_TAG_INVALID', 'Unknown tag.');
    else if (!out.includes(match)) out.push(match);
  });
  return out;
}

// ─── Thread creation ──────────────────────────────────────────────────────────

export interface ThreadCreateInput {
  name: string;
  type: SerikaThreadType;
  autoArchiveDuration?: AutoArchiveDuration;
  rateLimitPerUser?: number;
  invitable?: boolean;
  appliedTags?: string[];
  /** Forum / media posts: the starter message body (Discord's `message`). */
  message?: Record<string, unknown>;
}

export interface ThreadCreateContext {
  /** Serika type of the channel the thread is created in. */
  parentType: string;
  /** POST /channels/{id}/messages/{mid}/threads. */
  fromMessage?: boolean;
  /** Forum tag ids that exist on the parent. */
  availableTagIds?: ReadonlySet<string>;
}

/**
 * Validate a Discord thread create body. Text channels: `type` 11 (public) or
 * 12 (private, Discord's default without a type). Announcement channels: 10
 * (stored as a public thread). From a message: always public. Forum posts:
 * public (Serika ticket forums turn it private later), `message` required.
 */
export function parseThreadCreate(body: unknown, ctx: ThreadCreateContext): { ok: true; value: ThreadCreateInput } | { ok: false; error: DiscordFormError } {
  const b = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  const errors = new FormErrors();
  const name = checkName(errors, b.name, true);
  const autoArchiveDuration = checkAutoArchive(errors, b.auto_archive_duration);
  const rateLimitPerUser = checkRateLimit(errors, 'rate_limit_per_user', b.rate_limit_per_user);
  const isForum = ctx.parentType === 'forum' || ctx.parentType === 'media';

  let type: SerikaThreadType = 'public_thread';
  let invitable: boolean | undefined;
  let appliedTags: string[] | undefined;
  let message: Record<string, unknown> | undefined;
  if (ctx.fromMessage) {
    type = 'public_thread';
  } else if (isForum) {
    appliedTags = checkTagIds(errors, b.applied_tags, ctx.availableTagIds ?? new Set());
    if (b.message === undefined || b.message === null) errors.add(['message'], 'BASE_TYPE_REQUIRED', 'This field is required');
    else if (typeof b.message !== 'object' || Array.isArray(b.message)) errors.add(['message'], 'MODEL_TYPE_CONVERT', 'Only dictionaries may be used in a ModelType');
    else message = b.message as Record<string, unknown>;
  } else {
    const rawType = b.type === undefined || b.type === null ? (ctx.parentType === 'announcement' ? 10 : 12) : b.type;
    const allowed = ctx.parentType === 'announcement' ? [10] : [11, 12];
    if (!isInt(rawType) || !allowed.includes(rawType)) {
      errors.add(['type'], 'BASE_TYPE_CHOICES', `Value must be one of {${allowed.join(', ')}}.`);
    } else {
      type = rawType === 12 ? 'private_thread' : 'public_thread';
    }
    if (b.invitable !== undefined && b.invitable !== null) {
      if (typeof b.invitable !== 'boolean') errors.add(['invitable'], 'BASE_TYPE_BOOLEAN', 'Must be either true or false.');
      else invitable = b.invitable;
    }
  }
  if (!errors.ok || !name) return { ok: false, error: errors.toBody() };
  return { ok: true, value: { name, type, autoArchiveDuration, rateLimitPerUser, invitable, appliedTags, message } };
}

// ─── PATCH /channels/{thread} ─────────────────────────────────────────────────

export interface ThreadPatchActor {
  /** The bot created the thread. */
  isOwner: boolean;
  manageThreads: boolean;
  /** SEND_MESSAGES_IN_THREADS (unarchiving an unlocked thread needs only this). */
  canSend: boolean;
}

export interface ThreadPatchState {
  type: string;
  archived: boolean;
  locked: boolean;
  parentType: string;
  availableTagIds: ReadonlySet<string>;
  flags: number;
  /** Tags on the post now, and the forum's moderated tags (only moderators add or remove those). */
  appliedTags?: readonly string[];
  moderatedTagIds?: ReadonlySet<string>;
}

export interface ThreadPatchPlan {
  updates: Record<string, unknown>;
  /** Archive state change (goes through setThreadArchived so archive_timestamp moves). */
  archive?: { archived: boolean; locked?: boolean };
}

type PlanResult = { ok: true; plan: ThreadPatchPlan } | { ok: false; status: number; body: { code: number; message: string; errors?: unknown } };

const MISSING_PERMISSIONS = { code: 50013, message: 'Missing Permissions' };

/**
 * Discord's thread PATCH rules: the owner may rename, (un)archive and change
 * auto_archive_duration / applied_tags of an unlocked thread; locked,
 * invitable, rate_limit_per_user and flags need MANAGE_THREADS. Unarchiving
 * an unlocked thread only needs SEND_MESSAGES_IN_THREADS. An archived thread
 * only takes edits that also unarchive it (or come from a moderator).
 */
export function planThreadPatch(body: unknown, state: ThreadPatchState, actor: ThreadPatchActor): PlanResult {
  const b = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  const errors = new FormErrors();
  const has = (k: string) => b[k] !== undefined;
  const updates: Record<string, unknown> = {};
  const isForumPost = state.parentType === 'forum' || state.parentType === 'media';

  const name = has('name') ? checkName(errors, b.name, true) : undefined;
  const autoArchive = has('auto_archive_duration') ? checkAutoArchive(errors, b.auto_archive_duration) : undefined;
  const rateLimit = has('rate_limit_per_user') ? checkRateLimit(errors, 'rate_limit_per_user', b.rate_limit_per_user) : undefined;
  let archived: boolean | undefined;
  let locked: boolean | undefined;
  let invitable: boolean | undefined;
  for (const [key, set] of [['archived', (v: boolean) => { archived = v; }], ['locked', (v: boolean) => { locked = v; }], ['invitable', (v: boolean) => { invitable = v; }]] as const) {
    if (!has(key) || b[key] === null) continue;
    if (typeof b[key] !== 'boolean') errors.add([key], 'BASE_TYPE_BOOLEAN', 'Must be either true or false.');
    else set(b[key] as boolean);
  }
  const tags = has('applied_tags') ? checkTagIds(errors, b.applied_tags, state.availableTagIds) : undefined;
  let flags: number | undefined;
  if (has('flags') && b.flags !== null) {
    if (!isInt(b.flags)) errors.add(['flags'], 'NUMBER_TYPE_COERCE', `Value "${String(b.flags)}" is not int.`);
    else flags = b.flags;
  }
  if (!errors.ok) return { ok: false, status: 400, body: errors.toBody() };

  const mod = actor.manageThreads;
  // An archived thread takes field edits only together with archived: false
  // (Discord); archive / lock toggles alone are checked below.
  const stillArchived = archived === undefined ? state.archived : archived;
  const editsFields = [name, autoArchive, rateLimit, invitable, tags, flags].some((v) => v !== undefined);
  if (state.archived && stillArchived && editsFields) {
    return { ok: false, status: 400, body: THREAD_ARCHIVED };
  }
  // Locked threads: moderators only.
  if (state.locked && !mod) return { ok: false, status: 403, body: MISSING_PERMISSIONS };

  if (name !== undefined) {
    if (!actor.isOwner && !mod) return { ok: false, status: 403, body: MISSING_PERMISSIONS };
    updates.name = name;
  }
  if (autoArchive !== undefined) {
    if (!actor.isOwner && !mod) return { ok: false, status: 403, body: MISSING_PERMISSIONS };
    updates.autoArchiveDuration = autoArchive;
  }
  if (tags !== undefined) {
    if (!isForumPost) return { ok: false, status: 400, body: WRONG_CHANNEL_TYPE };
    if (!actor.isOwner && !mod) return { ok: false, status: 403, body: MISSING_PERMISSIONS };
    if (!mod && state.moderatedTagIds?.size) {
      const before = new Set((state.appliedTags ?? []).map((t) => t.toLowerCase()));
      const after = new Set(tags.map((t) => t.toLowerCase()));
      const changed = [...before].filter((t) => !after.has(t)).concat([...after].filter((t) => !before.has(t)));
      const moderated = new Set([...state.moderatedTagIds].map((t) => t.toLowerCase()));
      if (changed.some((t) => moderated.has(t))) return { ok: false, status: 403, body: MISSING_PERMISSIONS };
    }
    updates.appliedTags = tags;
  }
  if (rateLimit !== undefined) {
    if (!mod) return { ok: false, status: 403, body: MISSING_PERMISSIONS };
    updates.rateLimitPerUser = rateLimit;
  }
  if (invitable !== undefined) {
    if (state.type !== 'private_thread') return { ok: false, status: 400, body: WRONG_CHANNEL_TYPE };
    if (!mod) return { ok: false, status: 403, body: MISSING_PERMISSIONS };
    updates.threadInvitable = invitable;
  }
  if (flags !== undefined) {
    // Only PINNED, and only on forum posts.
    if ((flags & ~CHANNEL_FLAGS.PINNED) !== 0 || ((flags & CHANNEL_FLAGS.PINNED) !== 0 && !isForumPost)) {
      return { ok: false, status: 400, body: { code: 50035, message: 'Invalid Form Body', errors: { flags: { _errors: [{ code: 'CHANNEL_FLAGS_INVALID', message: 'Only the PINNED flag can be set, and only on forum posts.' }] } } } };
    }
    if (!mod) return { ok: false, status: 403, body: MISSING_PERMISSIONS };
    updates.flags = (state.flags & ~CHANNEL_FLAGS.PINNED) | (flags & CHANNEL_FLAGS.PINNED);
  }

  let archive: ThreadPatchPlan['archive'];
  if (locked !== undefined && locked !== state.locked && !mod) return { ok: false, status: 403, body: MISSING_PERMISSIONS };
  if (archived !== undefined && archived !== state.archived) {
    // Archiving: owner or moderator. Unarchiving an unlocked thread: anyone who can send there.
    const nextLocked = locked ?? state.locked;
    const allowed = mod || (archived ? actor.isOwner : (!nextLocked && (actor.canSend || actor.isOwner)));
    if (!allowed) return { ok: false, status: 403, body: MISSING_PERMISSIONS };
    archive = { archived, ...(locked !== undefined ? { locked } : {}) };
  } else if (locked !== undefined && locked !== state.locked) {
    // Discord: locking leaves the archive state alone (only moderators can post).
    updates.locked = locked;
  }
  return { ok: true, plan: { updates, archive } };
}

// ─── PATCH /channels/{forum} ──────────────────────────────────────────────────

export interface ForumTag { id: string; name: string; moderated: boolean; emojiId: string | null; emojiName: string | null }

const SORT_ORDER_NAMES: Record<number, string> = { 0: 'latest_activity', 1: 'creation_date' };
const LAYOUT_NAMES: Record<number, string> = { 0: 'not_set', 1: 'list_view', 2: 'gallery_view' };

/**
 * Discord forum / media channel fields as stored updates: available_tags (ids
 * kept for existing tags, `newId()` for new ones), default_reaction_emoji,
 * default_sort_order, default_forum_layout, default_thread_rate_limit_per_user
 * and the REQUIRE_TAG flag. Returns null when the body has none of them.
 */
export function planForumPatch(
  body: unknown,
  state: { type: string; flags: number; availableTags: ForumTag[] },
  newId: () => string,
): { ok: true; updates: Record<string, unknown> } | { ok: false; error: DiscordFormError } | null {
  const b = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  const keys = ['available_tags', 'default_reaction_emoji', 'default_sort_order', 'default_forum_layout', 'default_thread_rate_limit_per_user', 'flags'];
  if (!keys.some((k) => b[k] !== undefined)) return null;
  const errors = new FormErrors();
  const updates: Record<string, unknown> = {};
  const isMedia = state.type === 'media';

  if (b.available_tags !== undefined) {
    if (!Array.isArray(b.available_tags)) errors.add(['available_tags'], 'BASE_TYPE_ARRAY', 'Must be an array.');
    else if (b.available_tags.length > MAX_AVAILABLE_TAGS) errors.add(['available_tags'], 'BASE_TYPE_MAX_LENGTH', `Must be ${MAX_AVAILABLE_TAGS} or fewer in length.`);
    else {
      const existing = new Map(state.availableTags.map((t) => [t.id.toLowerCase(), t]));
      const tags: ForumTag[] = [];
      b.available_tags.forEach((raw, i) => {
        const t = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
        const name = typeof t.name === 'string' ? t.name.trim() : '';
        if (!name || name.length > MAX_TAG_NAME) {
          errors.add(['available_tags', i, 'name'], 'BASE_TYPE_BAD_LENGTH', `Must be between 1 and ${MAX_TAG_NAME} in length.`);
          return;
        }
        const id = typeof t.id === 'string' && existing.has(t.id.toLowerCase()) ? existing.get(t.id.toLowerCase())!.id : newId();
        const emojiId = typeof t.emoji_id === 'string' && t.emoji_id ? t.emoji_id : null;
        const emojiName = typeof t.emoji_name === 'string' && t.emoji_name ? t.emoji_name.slice(0, 32) : null;
        tags.push({ id, name, moderated: t.moderated === true, emojiId, emojiName });
      });
      updates.availableTags = tags;
    }
  }
  if (b.default_reaction_emoji !== undefined) {
    const r = b.default_reaction_emoji;
    if (r === null) updates.defaultReactionEmoji = null;
    else if (typeof r !== 'object' || Array.isArray(r)) errors.add(['default_reaction_emoji'], 'MODEL_TYPE_CONVERT', 'Only dictionaries may be used in a ModelType');
    else {
      const o = r as Record<string, unknown>;
      const emojiId = typeof o.emoji_id === 'string' && o.emoji_id ? o.emoji_id : null;
      const emojiName = typeof o.emoji_name === 'string' && o.emoji_name ? o.emoji_name.slice(0, 32) : null;
      updates.defaultReactionEmoji = emojiId || emojiName ? { emojiId, emojiName } : null;
    }
  }
  if (b.default_sort_order !== undefined) {
    if (b.default_sort_order === null) updates.defaultSortOrder = null;
    else if (!isInt(b.default_sort_order) || !(b.default_sort_order in SORT_ORDER_NAMES)) errors.add(['default_sort_order'], 'BASE_TYPE_CHOICES', 'Value must be one of {0, 1}.');
    else updates.defaultSortOrder = SORT_ORDER_NAMES[b.default_sort_order];
  }
  if (b.default_forum_layout !== undefined) {
    if (isMedia) errors.add(['default_forum_layout'], 'CHANNEL_TYPE_INVALID', 'Media channels have no layout.');
    else if (!isInt(b.default_forum_layout) || !(b.default_forum_layout in LAYOUT_NAMES)) errors.add(['default_forum_layout'], 'BASE_TYPE_CHOICES', 'Value must be one of {0, 1, 2}.');
    else updates.defaultForumLayout = LAYOUT_NAMES[b.default_forum_layout];
  }
  if (b.default_thread_rate_limit_per_user !== undefined && b.default_thread_rate_limit_per_user !== null) {
    const v = checkRateLimit(errors, 'default_thread_rate_limit_per_user', b.default_thread_rate_limit_per_user);
    if (v !== undefined) updates.defaultThreadRateLimitPerUser = v;
  }
  if (b.flags !== undefined && b.flags !== null) {
    if (!isInt(b.flags)) errors.add(['flags'], 'NUMBER_TYPE_COERCE', `Value "${String(b.flags)}" is not int.`);
    else if ((b.flags & ~CHANNEL_FLAGS.REQUIRE_TAG) !== 0) errors.add(['flags'], 'CHANNEL_FLAGS_INVALID', 'Only the REQUIRE_TAG flag can be set on a forum channel.');
    else updates.flags = (state.flags & ~CHANNEL_FLAGS.REQUIRE_TAG) | (b.flags & CHANNEL_FLAGS.REQUIRE_TAG);
  }
  if (!errors.ok) return { ok: false, error: errors.toBody() };
  return { ok: true, updates };
}

// ─── Listing ──────────────────────────────────────────────────────────────────

export interface ThreadListRow {
  id: string;
  archived?: boolean | null;
  archiveTimestamp?: Date | string | null;
  createdAt?: Date | string | null;
}

const ms = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() || 0 : 0);

/** Discord's `limit` for thread lists: 1..100, default 50 (archived lists), out-of-range clamps. */
export function threadListLimit(raw: unknown, def = 50, max = 100): number {
  const n = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN;
  if (!Number.isFinite(n)) return def;
  return Math.max(1, Math.min(max, Math.floor(n)));
}

/**
 * One page of archived threads, newest archive first, strictly before
 * `before` (an ISO timestamp, or a time a thread-id cursor resolved to).
 * `has_more` says whether another page exists.
 */
export function pageArchivedThreads<T extends ThreadListRow>(rows: T[], opts: { beforeMs?: number | null; limit: number; by?: 'archive' | 'created' }): { threads: T[]; hasMore: boolean } {
  const key = (r: T) => (opts.by === 'created' ? ms(r.createdAt) : ms(r.archiveTimestamp) || ms(r.createdAt));
  const sorted = rows
    .filter((r) => r.archived)
    .filter((r) => opts.beforeMs === undefined || opts.beforeMs === null || key(r) < opts.beforeMs)
    .sort((a, b) => key(b) - key(a) || (a.id < b.id ? 1 : -1));
  return { threads: sorted.slice(0, opts.limit), hasMore: sorted.length > opts.limit };
}

/** A `before` query value: ISO8601 timestamp (or epoch ms) -> ms, null when absent, NaN when invalid. */
export function parseBeforeTimestamp(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const s = String(raw);
  const t = /^\d+$/.test(s) && s.length <= 15 ? Number(s) : new Date(s).getTime();
  return Number.isFinite(t) ? t : NaN;
}

// ─── Search (GET /channels/{id}/threads/search) ───────────────────────────────

export interface ThreadSearchPlan {
  words: string[];
  tags: string[];
  matchAll: boolean;
  archived: boolean | null;
  sortBy: 'last_message_time' | 'archive_time' | 'creation_time' | 'relevance';
  ascending: boolean;
  /** Most words allowed between matched title words (Discord `slop`, default 2). */
  slop: number;
  /** Creation-time bounds from `min_id` / `max_id` (ms, inclusive). */
  minMs?: number;
  maxMs?: number;
}

/**
 * Query -> plan: name (words, case-insensitive prefix match within `slop`),
 * tag (comma list), tag_setting, archived, sort_by (incl. relevance),
 * sort_order. `min_id` / `max_id` are resolved by the caller (minMs / maxMs).
 */
export function threadSearchPlan(q: Record<string, string | undefined>, bounds: { minMs?: number; maxMs?: number } = {}): ThreadSearchPlan {
  const words = searchWords((q.name ?? '').slice(0, 100)).slice(0, 10);
  const tags = (q.tag ?? '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 20);
  const sortBy = q.sort_by === 'archive_time' || q.sort_by === 'creation_time' || q.sort_by === 'relevance' ? q.sort_by : 'last_message_time';
  return {
    words,
    tags,
    matchAll: q.tag_setting === 'match_all',
    archived: q.archived === 'true' ? true : q.archived === 'false' ? false : null,
    sortBy,
    ascending: q.sort_order === 'asc',
    slop: parseSlop(q.slop) ?? DEFAULT_SLOP,
    ...(bounds.minMs !== undefined ? { minMs: bounds.minMs } : {}),
    ...(bounds.maxMs !== undefined ? { maxMs: bounds.maxMs } : {}),
  };
}

export interface SearchableThread extends ThreadListRow {
  name?: string | null;
  appliedTags?: string[] | null;
  updatedAt?: Date | string | null;
}

export function filterAndSortThreads<T extends SearchableThread>(rows: T[], plan: ThreadSearchPlan): T[] {
  const activity = (r: T) => ms(r.updatedAt) || ms(r.createdAt);
  const key = (r: T) => (plan.sortBy === 'creation_time' ? ms(r.createdAt) : plan.sortBy === 'archive_time' ? (ms(r.archiveTimestamp) || ms(r.createdAt)) : activity(r));
  const scores = new Map<T, number>();
  const kept = rows.filter((r) => {
    if (plan.archived !== null && Boolean(r.archived) !== plan.archived) return false;
    const created = ms(r.createdAt);
    if (plan.minMs !== undefined && created < plan.minMs) return false;
    if (plan.maxMs !== undefined && created > plan.maxMs) return false;
    const match = matchThreadName(r.name, plan.words, plan.slop);
    if (!match) return false;
    if (plan.tags.length) {
      const own = new Set((r.appliedTags ?? []).map((t) => t.toLowerCase()));
      if (!(plan.matchAll ? plan.tags.every((t) => own.has(t)) : plan.tags.some((t) => own.has(t)))) return false;
    }
    scores.set(r, relevanceScore(match));
    return true;
  });
  if (plan.sortBy === 'relevance') {
    // Best match first (sort_order flips it), then the most recently active.
    return kept.sort((a, b) => (plan.ascending ? scores.get(a)! - scores.get(b)! : scores.get(b)! - scores.get(a)!) || activity(b) - activity(a) || (a.id < b.id ? -1 : 1));
  }
  return kept.sort((a, b) => (plan.ascending ? key(a) - key(b) : key(b) - key(a)) || (a.id < b.id ? -1 : 1));
}

/**
 * Thread member pagination (GET /channels/{id}/thread-members): ids sorted
 * like Discord's snowflakes would be, `after` exclusive, limit 1..100.
 */
export function pageThreadMemberIds(ids: string[], opts: { after?: string | null; limit: number }): string[] {
  const sorted = [...new Set(ids.map((id) => id.toLowerCase()))].sort();
  const after = opts.after?.toLowerCase();
  const start = after ? sorted.findIndex((id) => id > after) : 0;
  if (start < 0) return [];
  return sorted.slice(start, start + opts.limit);
}
