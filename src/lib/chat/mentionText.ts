/**
 * Plain-text rendering of mention markup for previews (Inbox, toasts, desktop
 * notifications, the DM list): `<@id>` → `@Display Name`, `<@&id>` →
 * `@Role`, `<#id>` → `#channel`, custom emoji → `:name:`. Unknown ids fall
 * back to generic labels so raw ids never show.
 */

export interface MentionNames {
  users?: Record<string, string>;
  roles?: Record<string, string>;
  channels?: Record<string, string>;
}

export interface MentionTokens {
  userIds: string[];
  roleIds: string[];
  channelIds: string[];
}

const USER_RE = /<@!?([\w-]+)>/g;
const ROLE_RE = /<@&([\w-]+)>/g;
const CHANNEL_RE = /<#([\w-]+)>/g;
const EMOJI_RE = /<a?:(\w+):[\w-]+>/g;
const MAX_IDS = 50;

function collect(text: string, re: RegExp): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(re)) {
    out.add(m[1]);
    if (out.size >= MAX_IDS) break;
  }
  return [...out];
}

/** Ids referenced by mention markup in `text` (deduplicated, capped). */
export function mentionTokens(text: string | null | undefined): MentionTokens {
  if (!text) return { userIds: [], roleIds: [], channelIds: [] };
  return {
    userIds: collect(text, USER_RE),
    roleIds: collect(text, ROLE_RE),
    channelIds: collect(text, CHANNEL_RE),
  };
}

export function hasMentionTokens(t: MentionTokens): boolean {
  return t.userIds.length + t.roleIds.length + t.channelIds.length > 0;
}

/** Merge name maps (later maps win). */
export function mergeMentionNames(...maps: Array<MentionNames | null | undefined>): MentionNames {
  const out: Required<MentionNames> = { users: {}, roles: {}, channels: {} };
  for (const m of maps) {
    if (!m) continue;
    Object.assign(out.users, m.users ?? {});
    Object.assign(out.roles, m.roles ?? {});
    Object.assign(out.channels, m.channels ?? {});
  }
  return out;
}

/** Replace mention / emoji markup with readable names. */
export function renderMentionText(text: string, names?: MentionNames | null): string {
  return text
    .replace(ROLE_RE, (_, id: string) => `@${names?.roles?.[id] ?? "role"}`)
    .replace(USER_RE, (_, id: string) => `@${names?.users?.[id] ?? "user"}`)
    .replace(CHANNEL_RE, (_, id: string) => `#${names?.channels?.[id] ?? "channel"}`)
    .replace(EMOJI_RE, ":$1:");
}
