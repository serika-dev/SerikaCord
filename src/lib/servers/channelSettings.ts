/**
 * Pure rules behind the Channel Settings dialog: which settings a channel
 * type has, the slowmode / user-limit steps, the editable draft and the
 * "only what changed" PATCH body for `PATCH /api/channels/:id`. No DOM, no
 * DB. Tested in tests/channel-settings.test.ts.
 */
import { normalizeChannelName } from './channelRules';
import { normalizeOverwrites, type EditableOverwrite } from '@/lib/permissions/overwriteEditor';
import { AUTO_ARCHIVE_DURATIONS, DEFAULT_AUTO_ARCHIVE_DURATION, normalizeAutoArchiveDuration } from '@/lib/chat/threads';
import { decodeHtmlEntities } from '@/lib/chat/messages';

export type ChannelSettingsKind = 'text' | 'announcement' | 'voice' | 'stage' | 'forum' | 'category' | 'thread';

export function channelSettingsKind(type: unknown): ChannelSettingsKind {
  switch (type) {
    case 'announcement':
    case 'voice':
    case 'stage':
    case 'forum':
    case 'category':
      return type;
    case 'public_thread':
    case 'private_thread':
      return 'thread';
    default:
      return 'text';
  }
}

/** What the channel PATCH route stores (and the app honours) per channel kind. */
export interface ChannelCapabilities {
  topic: boolean;
  slowmode: boolean;
  nsfw: boolean;
  /** text ⇄ announcement conversion. */
  announcementToggle: boolean;
  /** Can be moved into a category. */
  parent: boolean;
  userLimit: boolean;
  /** Default "hide after inactivity" for new threads started in the channel. */
  defaultThreadArchive: boolean;
  /** The thread's own "hide after inactivity". */
  threadArchive: boolean;
  forum: boolean;
  permissions: boolean;
  invites: boolean;
  integrations: boolean;
}

export function channelCapabilities(type: unknown): ChannelCapabilities {
  const kind = channelSettingsKind(type);
  const textLike = kind === 'text' || kind === 'announcement';
  const voiceLike = kind === 'voice' || kind === 'stage';
  return {
    topic: textLike || kind === 'forum',
    slowmode: textLike || kind === 'forum' || kind === 'thread',
    nsfw: kind !== 'thread',
    announcementToggle: textLike,
    parent: kind !== 'category' && kind !== 'thread',
    userLimit: voiceLike,
    defaultThreadArchive: textLike,
    threadArchive: kind === 'thread',
    forum: kind === 'forum',
    // Threads use their parent's overwrites.
    permissions: kind !== 'thread',
    invites: kind !== 'category' && kind !== 'thread',
    integrations: textLike || kind === 'forum',
  };
}

// ─── Slowmode / user limit ───────────────────────────────────────────────────

/** Discord's slowmode stops, in seconds (Off … 6h). */
export const SLOWMODE_STEPS = [0, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600] as const;

/** Index of the stop closest to `seconds` (a bot may have set an in-between value). */
export function slowmodeStepIndex(seconds: number): number {
  const value = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  let best = 0;
  for (let i = 1; i < SLOWMODE_STEPS.length; i++) {
    if (Math.abs(SLOWMODE_STEPS[i] - value) < Math.abs(SLOWMODE_STEPS[best] - value)) best = i;
  }
  return best;
}

/** 90 → { amount: 1.5, unit: "m" }; whole units where they fit. */
export function splitDuration(seconds: number): { amount: number; unit: 's' | 'm' | 'h' } {
  const s = Math.max(0, Math.round(seconds));
  if (s >= 3600 && s % 3600 === 0) return { amount: s / 3600, unit: 'h' };
  if (s >= 60 && s % 60 === 0) return { amount: s / 60, unit: 'm' };
  return { amount: s, unit: 's' };
}

export const USER_LIMIT_MAX = 99;

export function clampUserLimit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(USER_LIMIT_MAX, Math.max(0, Math.round(value)));
}

export const THREAD_ARCHIVE_OPTIONS = AUTO_ARCHIVE_DURATIONS;

// ─── Forum ───────────────────────────────────────────────────────────────────

export const MAX_FORUM_TAGS = 20;
export const MAX_FORUM_TAG_NAME = 20;
/** channels.flags bit: posts need at least one tag (Discord REQUIRE_TAG). */
export const REQUIRE_TAG_FLAG = 1 << 4;
export const MAX_TOPIC_LENGTH = 1024;

export type ForumSortOrder = 'latest_activity' | 'creation_date';
export type ForumLayout = 'list_view' | 'gallery_view';

export interface ForumTagDraft {
  id?: string;
  name: string;
  moderated: boolean;
  emojiName?: string;
}

export type ForumTagNameError = 'empty' | 'too_long' | 'duplicate' | null;

/** Why a tag name can't be used (`ignoreIndex` = the tag being edited). */
export function forumTagNameError(name: string, tags: readonly ForumTagDraft[], ignoreIndex = -1): ForumTagNameError {
  const trimmed = name.trim();
  if (!trimmed) return 'empty';
  if (trimmed.length > MAX_FORUM_TAG_NAME) return 'too_long';
  const key = trimmed.toLowerCase();
  if (tags.some((t, i) => i !== ignoreIndex && t.name.trim().toLowerCase() === key)) return 'duplicate';
  return null;
}

function normalizeTags(raw: unknown): ForumTagDraft[] {
  if (!Array.isArray(raw)) return [];
  const out: ForumTagDraft[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const t = entry as Record<string, unknown>;
    if (typeof t.name !== 'string' || !t.name.trim()) continue;
    const tag: ForumTagDraft = { name: decodeHtmlEntities(t.name), moderated: Boolean(t.moderated) };
    if (typeof t.id === 'string' && t.id) tag.id = t.id;
    const emoji = typeof t.emojiName === 'string' ? t.emojiName : typeof t.emoji_name === 'string' ? t.emoji_name : '';
    if (emoji) tag.emojiName = emoji;
    out.push(tag);
  }
  return out;
}

// ─── Draft ───────────────────────────────────────────────────────────────────

export interface ChannelDraft {
  name: string;
  topic: string;
  nsfw: boolean;
  announcement: boolean;
  parentId: string | null;
  rateLimitPerUser: number;
  userLimit: number;
  defaultAutoArchiveDuration: number;
  autoArchiveDuration: number;
  forumMode: 'posts' | 'tickets';
  ticketAccessRoleIds: string[];
  availableTags: ForumTagDraft[];
  defaultSortOrder: ForumSortOrder;
  defaultForumLayout: ForumLayout;
  requireTag: boolean;
  permissionOverwrites: EditableOverwrite[];
}

export type ChannelDraftKey = keyof ChannelDraft;

const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/**
 * The editable fields of a channel. Accepts the ServerContext channel
 * (`isNsfw`), the raw API row (`nsfw`, `flags`, forum columns) or both merged.
 */
export function channelDraftFrom(channel: Record<string, unknown>): ChannelDraft {
  const nsfw = channel.nsfw ?? channel.isNsfw;
  return {
    // Names and topics are stored HTML-escaped (sanitizeInput): edit the text.
    name: typeof channel.name === 'string' ? decodeHtmlEntities(channel.name) : '',
    topic: typeof channel.topic === 'string' ? decodeHtmlEntities(channel.topic) : '',
    nsfw: Boolean(nsfw),
    announcement: channel.type === 'announcement',
    parentId: typeof channel.parentId === 'string' && channel.parentId ? channel.parentId : null,
    rateLimitPerUser: num(channel.rateLimitPerUser),
    userLimit: clampUserLimit(num(channel.userLimit)),
    defaultAutoArchiveDuration: normalizeAutoArchiveDuration(channel.defaultAutoArchiveDuration, DEFAULT_AUTO_ARCHIVE_DURATION),
    autoArchiveDuration: normalizeAutoArchiveDuration(channel.autoArchiveDuration, DEFAULT_AUTO_ARCHIVE_DURATION),
    forumMode: channel.forumMode === 'tickets' ? 'tickets' : 'posts',
    ticketAccessRoleIds: Array.isArray(channel.ticketAccessRoleIds)
      ? channel.ticketAccessRoleIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : [],
    availableTags: normalizeTags(channel.availableTags),
    defaultSortOrder: channel.defaultSortOrder === 'creation_date' ? 'creation_date' : 'latest_activity',
    defaultForumLayout: channel.defaultForumLayout === 'gallery_view' ? 'gallery_view' : 'list_view',
    requireTag: (num(channel.flags) & REQUIRE_TAG_FLAG) !== 0,
    permissionOverwrites: normalizeOverwrites(channel.permissionOverwrites),
  };
}

const lowerSorted = (ids: readonly string[]) => [...new Set(ids.map((id) => id.toLowerCase()))].sort().join(',');

/** Order-insensitive overwrite identity (empty overwrites count: they show in the list). */
export function overwritesSignature(list: readonly EditableOverwrite[]): string {
  return normalizeOverwrites(list)
    .map((o) => `${o.type}:${o.id.toLowerCase()}:${o.allow}:${o.deny}`)
    .sort()
    .join('|');
}

const tagsSignature = (tags: readonly ForumTagDraft[]) =>
  JSON.stringify(tags.map((t) => [t.id ?? '', t.name.trim(), Boolean(t.moderated), t.emojiName ?? '']));

/**
 * The PATCH body for `PATCH /api/channels/:id`: only the fields that differ
 * from `baseline` and that this channel kind supports.
 */
export function buildChannelPatch(type: unknown, baseline: ChannelDraft, draft: ChannelDraft): Record<string, unknown> {
  const caps = channelCapabilities(type);
  const patch: Record<string, unknown> = {};
  const name = normalizeChannelName(draft.name);
  if (name !== baseline.name) patch.name = name;
  if (caps.topic && draft.topic !== baseline.topic) patch.topic = draft.topic;
  if (caps.nsfw && draft.nsfw !== baseline.nsfw) patch.nsfw = draft.nsfw;
  if (caps.announcementToggle && draft.announcement !== baseline.announcement) {
    patch.type = draft.announcement ? 'announcement' : 'text';
  }
  if (caps.parent && (draft.parentId ?? null) !== (baseline.parentId ?? null)) patch.parentId = draft.parentId ?? null;
  if (caps.slowmode && draft.rateLimitPerUser !== baseline.rateLimitPerUser) patch.rateLimitPerUser = draft.rateLimitPerUser;
  if (caps.userLimit && draft.userLimit !== baseline.userLimit) patch.userLimit = clampUserLimit(draft.userLimit);
  if (caps.defaultThreadArchive && draft.defaultAutoArchiveDuration !== baseline.defaultAutoArchiveDuration) {
    patch.defaultAutoArchiveDuration = draft.defaultAutoArchiveDuration;
  }
  if (caps.threadArchive && draft.autoArchiveDuration !== baseline.autoArchiveDuration) {
    patch.autoArchiveDuration = draft.autoArchiveDuration;
  }
  if (caps.forum) {
    if (draft.forumMode !== baseline.forumMode) patch.forumMode = draft.forumMode;
    if (lowerSorted(draft.ticketAccessRoleIds) !== lowerSorted(baseline.ticketAccessRoleIds)) {
      patch.ticketAccessRoleIds = [...draft.ticketAccessRoleIds];
    }
    if (tagsSignature(draft.availableTags) !== tagsSignature(baseline.availableTags)) {
      patch.availableTags = draft.availableTags.map((t) => ({
        ...(t.id ? { id: t.id } : {}),
        name: t.name.trim(),
        moderated: Boolean(t.moderated),
        ...(t.emojiName ? { emojiName: t.emojiName } : {}),
      }));
    }
    if (draft.defaultSortOrder !== baseline.defaultSortOrder) patch.defaultSortOrder = draft.defaultSortOrder;
    if (draft.defaultForumLayout !== baseline.defaultForumLayout) patch.defaultForumLayout = draft.defaultForumLayout;
    if (draft.requireTag !== baseline.requireTag) patch.requireTag = draft.requireTag;
  }
  if (caps.permissions && overwritesSignature(draft.permissionOverwrites) !== overwritesSignature(baseline.permissionOverwrites)) {
    patch.permissionOverwrites = normalizeOverwrites(draft.permissionOverwrites);
  }
  return patch;
}

/** Client-side checks before saving; field → error code. */
export function validateChannelDraft(type: unknown, draft: ChannelDraft): Partial<Record<ChannelDraftKey, 'required' | 'too_long'>> {
  const errors: Partial<Record<ChannelDraftKey, 'required' | 'too_long'>> = {};
  if (!normalizeChannelName(draft.name)) errors.name = 'required';
  if (channelCapabilities(type).topic && draft.topic.length > MAX_TOPIC_LENGTH) errors.topic = 'too_long';
  return errors;
}

const PATCH_KEY_TO_FIELD: Record<string, ChannelDraftKey> = {
  name: 'name',
  topic: 'topic',
  nsfw: 'nsfw',
  type: 'announcement',
  parentId: 'parentId',
  rateLimitPerUser: 'rateLimitPerUser',
  userLimit: 'userLimit',
  defaultAutoArchiveDuration: 'defaultAutoArchiveDuration',
  autoArchiveDuration: 'autoArchiveDuration',
  forumMode: 'forumMode',
  ticketAccessRoleIds: 'ticketAccessRoleIds',
  availableTags: 'availableTags',
  defaultSortOrder: 'defaultSortOrder',
  defaultForumLayout: 'defaultForumLayout',
  requireTag: 'requireTag',
  permissionOverwrites: 'permissionOverwrites',
};

/**
 * Which field a failed save should be pinned to: the route's own error
 * strings, or the property named in a body-validation error (`details`).
 */
export function channelErrorField(message: string | null | undefined, details?: unknown): ChannelDraftKey | null {
  const text = String(message ?? '');
  if (/channel name/i.test(text)) return 'name';
  if (/parent category/i.test(text)) return 'parentId';
  if (/age-restricted/i.test(text)) return 'nsfw';
  if (/permission overwrites|manage roles/i.test(text)) return 'permissionOverwrites';
  const detail = typeof details === 'string' ? details : details ? JSON.stringify(details) : '';
  const match = /"?(?:property|path)"?\s*:\s*"\/([A-Za-z]+)/.exec(detail);
  if (match && PATCH_KEY_TO_FIELD[match[1]]) return PATCH_KEY_TO_FIELD[match[1]];
  return null;
}
