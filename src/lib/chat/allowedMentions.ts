/**
 * Discord `allowed_mentions` for bot / webhook messages (pure).
 *
 * The mentions found in the content (and already reduced to what the author
 * may ping: MENTION_EVERYONE for @everyone/@here and unmentionable roles) are
 * filtered through allowed_mentions BEFORE they are stored and before any
 * badge, Inbox entry or notification is produced, so a bot echoing user text
 * can't mass-ping.
 *
 * Semantics (https://discord.com/developers/docs/resources/message#allowed-mentions-object):
 * - allowed_mentions absent: every mention in the content pings, and a reply
 *   pings the replied-to author.
 * - present: only the types in `parse` ping, plus the ids listed in `users` /
 *   `roles` that also appear in the content. `replied_user` (default false)
 *   controls the reply ping. `parse: ["users"]` together with a `users` list
 *   (same for roles) is an error, as are more than 100 ids or unknown types.
 */
import { addFormError, hasFormErrors, type FormErrorTree } from './discordFormErrors';

export type AllowedMentionType = 'users' | 'roles' | 'everyone';
const TYPES: readonly AllowedMentionType[] = ['users', 'roles', 'everyone'];
export const MAX_ALLOWED_MENTION_IDS = 100;

export interface NormalizedAllowedMentions {
  parse: ReadonlySet<AllowedMentionType>;
  /** Explicit whitelist, or null when not given. */
  users: string[] | null;
  roles: string[] | null;
  repliedUser: boolean;
}

export type AllowedMentionsResult =
  | { ok: true; value: NormalizedAllowedMentions | null }
  | { ok: false; errors: FormErrorTree };

const lower = (s: string) => s.toLowerCase();

function idList(raw: unknown, key: 'users' | 'roles', errors: FormErrorTree): string[] | null {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) {
    addFormError(errors, ['allowed_mentions', key], 'BASE_TYPE_ARRAY', 'Must be an array.');
    return null;
  }
  if (raw.length > MAX_ALLOWED_MENTION_IDS) {
    addFormError(errors, ['allowed_mentions', key], 'BASE_TYPE_MAX_LENGTH', `Must be ${MAX_ALLOWED_MENTION_IDS} or fewer in length.`);
    return null;
  }
  const out: string[] = [];
  raw.forEach((v, i) => {
    if ((typeof v !== 'string' && typeof v !== 'number') || String(v).trim() === '') {
      addFormError(errors, ['allowed_mentions', key, i], 'SNOWFLAKE_TYPE_INVALID', `Value "${String(v)}" is not snowflake.`);
      return;
    }
    out.push(String(v));
  });
  return [...new Set(out.map(lower))];
}

/** Validate and normalize a request's `allowed_mentions` (null = not given). */
export function normalizeAllowedMentions(raw: unknown): AllowedMentionsResult {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  const errors: FormErrorTree = {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    addFormError(errors, ['allowed_mentions'], 'MODEL_TYPE_CONVERT', 'Only dictionaries may be used in a ModelType');
    return { ok: false, errors };
  }
  const o = raw as { parse?: unknown; users?: unknown; roles?: unknown; replied_user?: unknown };
  const parse = new Set<AllowedMentionType>();
  if (o.parse !== undefined && o.parse !== null) {
    if (!Array.isArray(o.parse)) {
      addFormError(errors, ['allowed_mentions', 'parse'], 'BASE_TYPE_ARRAY', 'Must be an array.');
    } else {
      o.parse.forEach((p, i) => {
        if (typeof p === 'string' && (TYPES as readonly string[]).includes(p)) parse.add(p as AllowedMentionType);
        else addFormError(errors, ['allowed_mentions', 'parse', i], 'ENUM_TYPE_COERCE', `Value "${String(p)}" is not a valid enum value.`);
      });
    }
  }
  const users = idList(o.users, 'users', errors);
  const roles = idList(o.roles, 'roles', errors);
  if (parse.has('users') && users && users.length > 0) {
    addFormError(errors, ['allowed_mentions'], 'MESSAGE_ALLOWED_MENTIONS_PARSE_EXCLUSIVE', 'parse:["users"] and users: [ids] are mutually exclusive.');
  }
  if (parse.has('roles') && roles && roles.length > 0) {
    addFormError(errors, ['allowed_mentions'], 'MESSAGE_ALLOWED_MENTIONS_PARSE_EXCLUSIVE', 'parse:["roles"] and roles: [ids] are mutually exclusive.');
  }
  if (o.replied_user !== undefined && o.replied_user !== null && typeof o.replied_user !== 'boolean') {
    addFormError(errors, ['allowed_mentions', 'replied_user'], 'BASE_TYPE_BOOLEAN', 'Must be either true or false.');
  }
  if (hasFormErrors(errors)) return { ok: false, errors };
  return { ok: true, value: { parse, users, roles, repliedUser: o.replied_user === true } };
}

/** Mentions found in the content, after the author's permission limits. */
export interface ContentMentions {
  userIds: string[];
  roleIds: string[];
  everyone: boolean;
}

export interface EffectiveMentions {
  /** Users that are mentioned (stored, badged, notified). Includes the reply ping. */
  userIds: string[];
  roleIds: string[];
  everyone: boolean;
  /** True when the replied-to author was added because of the reply. */
  repliedUserPinged: boolean;
}

/**
 * The mentions that actually ping, given the content's mentions and the
 * request's (normalized) allowed_mentions. `repliedAuthorId` is the author of
 * the message being replied to, if any; the sender never pings themself.
 */
export function applyAllowedMentions(
  content: ContentMentions,
  allowed: NormalizedAllowedMentions | null,
  ctx: { authorId: string; repliedAuthorId?: string | null } = { authorId: '' },
): EffectiveMentions {
  const dedupe = (ids: string[]) => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of ids) {
      const k = lower(id);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(id);
    }
    return out;
  };
  let userIds: string[];
  let roleIds: string[];
  let everyone: boolean;
  let replied: boolean;
  if (!allowed) {
    userIds = dedupe(content.userIds);
    roleIds = dedupe(content.roleIds);
    everyone = content.everyone;
    replied = true;
  } else {
    const userAllow = allowed.users ? new Set(allowed.users.map(lower)) : null;
    const roleAllow = allowed.roles ? new Set(allowed.roles.map(lower)) : null;
    userIds = allowed.parse.has('users')
      ? dedupe(content.userIds)
      : dedupe(content.userIds).filter((id) => userAllow?.has(lower(id)) ?? false);
    roleIds = allowed.parse.has('roles')
      ? dedupe(content.roleIds)
      : dedupe(content.roleIds).filter((id) => roleAllow?.has(lower(id)) ?? false);
    everyone = allowed.parse.has('everyone') && content.everyone;
    replied = allowed.repliedUser;
  }
  let repliedUserPinged = false;
  const author = ctx.authorId ? lower(ctx.authorId) : '';
  if (replied && ctx.repliedAuthorId && lower(ctx.repliedAuthorId) !== author) {
    if (!userIds.some((id) => lower(id) === lower(ctx.repliedAuthorId!))) {
      userIds = [...userIds, ctx.repliedAuthorId];
      repliedUserPinged = true;
    }
  }
  return { userIds, roleIds, everyone, repliedUserPinged };
}
