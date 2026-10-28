/**
 * Per-server profile images: storage key bookkeeping (pure, tested in
 * tests/member-media-drafts.test.ts).
 *
 * A member's per-server avatar / banner lives at
 * `<avatars|banners>/<serverId>/<userId>/<file>`. The profile editor uploads
 * a draft image there first (POST /servers/:id/members/@me/profile-media/:kind)
 * and only points the member row at it when the profile is saved. Drafts are
 * tracked by storage key (with their upload time) until saved; the sweeper in
 * src/lib/services/memberProfileMedia.ts deletes the ones never saved. When a
 * member leaves / is removed, or the server is deleted, the files under the
 * member's own prefix are deleted.
 *
 * Every helper here only ever names keys inside one member's own prefix, so a
 * bad entry can never delete a user's main avatar, another member's image or
 * a server asset.
 */
import { isOwnedMediaKey } from '@/lib/utils/ownedMedia';

export type MemberMediaKind = 'avatar' | 'banner';

/** Drafts older than this that were never saved are deleted. */
export const MEMBER_MEDIA_DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A generated file name (nanoid + extension), never a further path. */
const FILE_RE = /^[A-Za-z0-9_-]{1,64}\.[a-z0-9]{1,8}$/;

const FOLDER: Record<MemberMediaKind, 'avatars' | 'banners'> = { avatar: 'avatars', banner: 'banners' };

/** `<avatars|banners>/<serverId>/<userId>/` (ids lower-cased), or null for ids that aren't UUIDs. */
export function memberMediaPrefix(kind: MemberMediaKind, serverId: string, userId: string): string | null {
  if (!UUID_RE.test(serverId) || !UUID_RE.test(userId)) return null;
  return `${FOLDER[kind]}/${serverId.toLowerCase()}/${userId.toLowerCase()}/`;
}

/** Both of a member's prefixes (avatar and banner), or [] for invalid ids. */
export function memberMediaPrefixes(serverId: string, userId: string): string[] {
  const out: string[] = [];
  for (const kind of ['avatar', 'banner'] as const) {
    const p = memberMediaPrefix(kind, serverId, userId);
    if (p) out.push(p);
  }
  return out;
}

/** The server-wide folders listed when a server is deleted: `<avatars|banners>/<serverId>/`. */
export function serverMemberMediaFolders(serverId: string): string[] {
  if (!UUID_RE.test(serverId)) return [];
  const id = serverId.toLowerCase();
  return [`avatars/${id}/`, `banners/${id}/`];
}

export interface ParsedMemberMediaKey {
  kind: MemberMediaKind;
  serverId: string;
  userId: string;
  /** The member's own prefix the key sits in. */
  prefix: string;
}

/**
 * Parse `<avatars|banners>/<serverId>/<userId>/<file>`: UUID ids, a plain
 * generated file name, and the key must pass isOwnedMediaKey for that
 * member's prefix. Anything else (main-profile keys `avatars/<userId>/<file>`,
 * server-level files, path tricks, upper-case folders) is null.
 */
export function parseMemberMediaKey(key: unknown): ParsedMemberMediaKey | null {
  if (typeof key !== 'string' || key.length === 0 || key.length > 256) return null;
  const parts = key.split('/');
  if (parts.length !== 4) return null;
  const [folder, serverId, userId, file] = parts;
  const kind: MemberMediaKind | null = folder === 'avatars' ? 'avatar' : folder === 'banners' ? 'banner' : null;
  if (!kind || !FILE_RE.test(file)) return null;
  const prefix = memberMediaPrefix(kind, serverId, userId);
  // The key's own id segments must already be the canonical (lower-case) ones.
  if (!prefix || !key.startsWith(prefix) || !isOwnedMediaKey(key, prefix)) return null;
  return { kind, serverId: serverId.toLowerCase(), userId: userId.toLowerCase(), prefix };
}

/** `<serverId>:<userId>` (lower-case), the map key for a member's saved images. */
export function memberPairKey(serverId: string, userId: string): string {
  return `${serverId.toLowerCase()}:${userId.toLowerCase()}`;
}

/** The distinct members whose images the keys belong to (invalid keys skipped). */
export function memberPairsForKeys(keys: readonly string[]): Array<{ serverId: string; userId: string }> {
  const seen = new Map<string, { serverId: string; userId: string }>();
  for (const key of keys) {
    const parsed = parseMemberMediaKey(key);
    if (!parsed) continue;
    const k = memberPairKey(parsed.serverId, parsed.userId);
    if (!seen.has(k)) seen.set(k, { serverId: parsed.serverId, userId: parsed.userId });
  }
  return [...seen.values()];
}

/**
 * Plan one sweep batch. `keys` are drafts already past the age cutoff;
 * `savedKeys` maps memberPairKey → the storage keys the member row points at
 * now (its avatar / banner), for every member that still exists.
 *
 * - `remove`: deleted from storage and from the draft list (owned by that
 *   member's prefix and not currently saved, whether or not they are still a
 *   member).
 * - `untrack`: only dropped from the draft list: currently saved (the PATCH
 *   normally untracks those itself) or not a member media key at all.
 */
export function planDraftSweep(
  keys: readonly string[],
  savedKeys: ReadonlyMap<string, ReadonlySet<string>>,
): { remove: string[]; untrack: string[] } {
  const remove: string[] = [];
  const untrack: string[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) continue;
    seen.add(key);
    const parsed = parseMemberMediaKey(key);
    if (!parsed) {
      untrack.push(key);
      continue;
    }
    const saved = savedKeys.get(memberPairKey(parsed.serverId, parsed.userId));
    if (saved && saved.has(key.toLowerCase())) {
      untrack.push(key);
      continue;
    }
    remove.push(key);
  }
  return { remove, untrack };
}

/** Lower-cased storage keys of a member's saved avatar / banner (keyFromUrl is passed in). */
export function savedMemberKeys(
  row: { avatar?: string | null; banner?: string | null },
  keyFromUrl: (url: string) => string,
): Set<string> {
  const out = new Set<string>();
  for (const url of [row.avatar, row.banner]) {
    if (typeof url === 'string' && url) out.add(keyFromUrl(url).toLowerCase());
  }
  return out;
}

/**
 * Keys from a server folder listing that are member images of that server
 * (`<folder>/<serverId>/<userId>/<file>`), safe to delete when the server is
 * deleted. Files directly in the server folder or deeper paths are skipped.
 */
export function serverMemberMediaKeys(keys: readonly string[], serverId: string): string[] {
  const sid = serverId.toLowerCase();
  return keys.filter((key) => parseMemberMediaKey(key)?.serverId === sid);
}

/** Keys from a member prefix listing that really sit in that member's own prefixes. */
export function memberOwnedKeys(keys: readonly string[], serverId: string, userId: string): string[] {
  const prefixes = memberMediaPrefixes(serverId, userId);
  return keys.filter((key) => {
    const parsed = parseMemberMediaKey(key);
    return parsed !== null && prefixes.includes(parsed.prefix);
  });
}
