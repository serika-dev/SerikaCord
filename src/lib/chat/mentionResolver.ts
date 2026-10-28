/**
 * One way to turn `<@id>` / `<@&id>` / `<#id>` into names, shared by full
 * messages, reply previews, thread and pin previews and the composer's reply
 * bar. Sources are tried in order: the open server's members (bots included),
 * users already on screen (message authors, reply authors, and the `mentions`
 * the server embeds in a referenced message), then whatever a lazy lookup has
 * cached (lib/chat/mentionUserLookup). Pure: no React, no fetch.
 */
import { mentionTokens, type MentionNames } from "@/lib/chat/mentionText";

export interface MentionUserInfo {
  id: string;
  username?: string;
  displayName?: string;
  avatar?: string;
}

export interface MentionRoleInfo {
  id: string;
  name: string;
  color?: string;
}

export interface MentionChannelInfo {
  id: string;
  name: string;
}

type AuthorLike = { id?: string; username?: string; displayName?: string; avatar?: string } | null | undefined;

/** The parts of a chat message that carry user objects. */
export interface MessageUsersLike {
  author?: AuthorLike;
  referencedMessage?: {
    author?: AuthorLike;
    mentions?: AuthorLike[] | null;
  } | null;
}

function toInfo(u: AuthorLike): MentionUserInfo | null {
  if (!u || typeof u.id !== "string" || !u.id) return null;
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName || u.username,
    avatar: u.avatar,
  };
}

/** Best label for a user: display name, then username; undefined when neither. */
export function mentionUserLabel(u: Pick<MentionUserInfo, "username" | "displayName"> | null | undefined): string | undefined {
  return u?.displayName || u?.username || undefined;
}

/**
 * Users carried by messages: authors, reply authors and the users mentioned
 * in the replied-to message (`referencedMessage.mentions`).
 */
export function collectMessageUsers(messages: Iterable<MessageUsersLike>): MentionUserInfo[] {
  const out = new Map<string, MentionUserInfo>();
  const add = (u: AuthorLike) => {
    const info = toInfo(u);
    if (info && !out.has(info.id)) out.set(info.id, info);
  };
  for (const m of messages) {
    add(m.author);
    add(m.referencedMessage?.author);
    for (const u of m.referencedMessage?.mentions ?? []) add(u);
  }
  return [...out.values()];
}

/**
 * Merge user lists by id. Earlier lists win (put server members first so
 * nicknames beat the global names embedded in messages); a later entry only
 * fills a name the earlier one lacks.
 */
export function mergeMentionUsers(...lists: Array<ReadonlyArray<MentionUserInfo | null | undefined> | null | undefined>): MentionUserInfo[] {
  const out = new Map<string, MentionUserInfo>();
  for (const list of lists) {
    for (const u of list ?? []) {
      if (!u?.id) continue;
      const prev = out.get(u.id);
      if (!prev) {
        out.set(u.id, u);
      } else if (!mentionUserLabel(prev) && mentionUserLabel(u)) {
        out.set(u.id, { ...prev, username: prev.username ?? u.username, displayName: prev.displayName ?? u.displayName });
      }
    }
  }
  return [...out.values()];
}

/** id → entry map (the first entry for an id wins). */
export function indexById<T extends { id: string }>(list: ReadonlyArray<T | null | undefined> | null | undefined): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of list ?? []) {
    if (item?.id && !map.has(item.id)) map.set(item.id, item);
  }
  return map;
}

export interface MentionSources {
  /** Users, in priority order (members first). Maps are used as-is. */
  users?: Array<ReadonlyMap<string, MentionUserInfo> | ReadonlyArray<MentionUserInfo> | null | undefined>;
  roles?: ReadonlyMap<string, MentionRoleInfo> | ReadonlyArray<MentionRoleInfo> | null;
  channels?: ReadonlyMap<string, MentionChannelInfo> | ReadonlyArray<MentionChannelInfo> | null;
  /** Last resort for users (the lazy lookup cache). */
  lookupUser?: (id: string) => MentionUserInfo | null | undefined;
}

function asMap<T extends { id: string }>(src: ReadonlyMap<string, T> | ReadonlyArray<T> | null | undefined): ReadonlyMap<string, T> {
  if (!src) return new Map();
  return src instanceof Map ? src : indexById(src as ReadonlyArray<T>);
}

/** Resolve one user id through the sources, in order. */
export function resolveMentionUser(id: string, sources: Pick<MentionSources, "users" | "lookupUser">): MentionUserInfo | undefined {
  for (const src of sources.users ?? []) {
    const hit = asMap(src).get(id);
    if (hit && mentionUserLabel(hit)) return hit;
  }
  const looked = sources.lookupUser?.(id);
  return looked && mentionUserLabel(looked) ? looked : undefined;
}

/**
 * Names for the mentions in `text` only (so a big member list isn't copied
 * per preview), ready for `renderMentionText`. Unresolved ids are left out
 * and render with the generic labels.
 */
export function resolveMentionNames(text: string | null | undefined, sources: MentionSources): MentionNames {
  const tokens = mentionTokens(text);
  const names: Required<MentionNames> = { users: {}, roles: {}, channels: {} };
  if (tokens.userIds.length) {
    const userMaps = (sources.users ?? []).map(asMap);
    const resolveSources = { users: userMaps, lookupUser: sources.lookupUser };
    for (const id of tokens.userIds) {
      const label = mentionUserLabel(resolveMentionUser(id, resolveSources));
      if (label) names.users[id] = label;
    }
  }
  if (tokens.roleIds.length) {
    const roles = asMap(sources.roles);
    for (const id of tokens.roleIds) {
      const r = roles.get(id);
      if (r?.name) names.roles[id] = r.name;
    }
  }
  if (tokens.channelIds.length) {
    const channels = asMap(sources.channels);
    for (const id of tokens.channelIds) {
      const c = channels.get(id);
      if (c?.name) names.channels[id] = c.name;
    }
  }
  return names;
}

/** User ids mentioned in `text` that none of the sources can name (candidates for a lazy lookup). */
export function unresolvedMentionUserIds(text: string | null | undefined, sources: Pick<MentionSources, "users" | "lookupUser">): string[] {
  const { userIds } = mentionTokens(text);
  if (userIds.length === 0) return [];
  const userMaps = (sources.users ?? []).map(asMap);
  return userIds.filter((id) => !resolveMentionUser(id, { users: userMaps, lookupUser: sources.lookupUser }));
}

type UserRowLike = {
  id: string;
  username: string;
  displayName?: string | null;
  avatar?: string | null;
  isBot?: boolean | null;
};

export interface ReferenceMentionUser {
  id: string;
  username: string;
  displayName: string;
  avatar?: string;
  isBot?: boolean;
}

const MAX_REFERENCE_MENTIONS = 25;

/**
 * Server side: the users a replied-to message mentions as `<@id>` in its
 * text, from already-loaded user rows, for `referencedMessage.mentions`.
 * `nameFor` can supply a server nickname. Undefined when there are none.
 */
export function referenceMentions(
  content: string | null | undefined,
  lookup: (id: string) => UserRowLike | null | undefined,
  nameFor?: (id: string) => string | null | undefined,
): ReferenceMentionUser[] | undefined {
  if (!content) return undefined;
  // Stored content is HTML-escaped: mention markup arrives as &lt;@id&gt;.
  const text = content.includes("&lt;") ? content.replace(/&lt;/g, "<").replace(/&gt;/g, ">") : content;
  const out: ReferenceMentionUser[] = [];
  for (const raw of mentionTokens(text).userIds) {
    const u = lookup(raw.toLowerCase()) ?? lookup(raw);
    if (!u) continue;
    out.push({
      id: u.id,
      username: u.username,
      displayName: nameFor?.(u.id) || u.displayName || u.username,
      avatar: u.avatar ?? undefined,
      isBot: Boolean(u.isBot),
    });
    if (out.length >= MAX_REFERENCE_MENTIONS) break;
  }
  return out.length > 0 ? out : undefined;
}
