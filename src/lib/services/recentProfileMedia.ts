/**
 * Recent avatars / banners: storage side (pure rules in
 * src/lib/profiles/recentMedia.ts).
 *
 * Table `user_recent_media` (one row per user and kind, created on first use,
 * mirrors drizzle/manual_user_recent_media.sql). Every successful avatar /
 * banner change, main or per-server, is recorded with
 * recordProfileMediaChange: the new image goes to the front and the image it
 * replaced is kept behind it.
 *
 * Storage lifetime: a profile image file is kept while it is in use (the
 * user's main avatar / banner, or any of their server profiles) OR listed in
 * their recents. Replacing an image no longer deletes the old file at once;
 * it is deleted when it drops off the list (or is removed with the "x") and
 * nothing uses it (releaseProfileMedia). The other cleanup jobs ask
 * protectedProfileMediaKeys / filterUnprotectedProfileKeys first:
 * - per-server draft sweep, member removal, server deletion
 *   (src/lib/services/memberProfileMedia.ts) skip listed / in-use files;
 * - account deletion drops the list first (forgetRecentProfileMedia), so the
 *   member cleanup that follows removes the files as before.
 * The retention purge only touches `attachments/`, never profile images.
 *
 * Every check fails closed: if the recents or in-use rows can't be read,
 * nothing is deleted.
 */
import { and, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { ensureSchema, withLockTimeout } from '@/lib/db/schemaGuard';
import { config } from '@/lib/config';
import { normalizeId } from '@/lib/db/normalizeId';
import {
  isUserProfileMediaKey,
  normalizeRecentList,
  parseProfileMediaKey,
  profileMediaKeyFromUrl,
  profileMediaUrlForKey,
  recordRecentMedia,
  removeRecentMedia,
  type RecentMediaEntry,
  type RecentMediaKind,
} from '@/lib/profiles/recentMedia';

const g = globalThis as unknown as { __recentMediaSchema?: Promise<void> | null };

export function ensureRecentMediaSchema(): Promise<void> {
  if (g.__recentMediaSchema) return g.__recentMediaSchema;
  g.__recentMediaSchema = ensureSchema(
    'recent-media',
    { tables: { user_recent_media: ['user_id', 'kind', 'items', 'updated_at'] } },
    () => withLockTimeout([
      sql`CREATE TABLE IF NOT EXISTS user_recent_media (
        user_id uuid NOT NULL,
        kind text NOT NULL,
        items jsonb NOT NULL DEFAULT '[]'::jsonb,
        updated_at timestamp DEFAULT now(),
        PRIMARY KEY (user_id, kind)
      )`,
    ]),
    { attempts: 3 },
  ).catch((err) => {
    g.__recentMediaSchema = null; // retry on the next call
    throw err;
  });
  return g.__recentMediaSchema;
}

const KINDS: readonly RecentMediaKind[] = ['avatar', 'banner'];
const keyOpts = () => ({ cdnUrl: config.CDN_URL, bucket: config.B2_BUCKET_NAME });

/** The canonical CDN URL of one of this user's own profile images (of `kind`), or null. */
export function ownedProfileMediaUrl(url: unknown, userId: string, kind?: RecentMediaKind): string | null {
  const key = profileMediaKeyFromUrl(url, keyOpts());
  if (!key || !isUserProfileMediaKey(key, userId, kind)) return null;
  return profileMediaUrlForKey(key, config.CDN_URL);
}

/** Entries that are (still) this user's own images of `kind`. */
function ownedEntries(items: unknown, userId: string, kind: RecentMediaKind): RecentMediaEntry[] {
  return normalizeRecentList(items).filter((e) => ownedProfileMediaUrl(e.url, userId, kind) === e.url);
}

/**
 * Read-modify-write one list under a row lock (concurrent uploads can't lose
 * each other's entries). Returns the new list and what fell off it.
 */
async function mutateList(
  userId: string,
  kind: RecentMediaKind,
  fn: (list: RecentMediaEntry[]) => { list: RecentMediaEntry[]; evicted?: string[] },
): Promise<{ list: RecentMediaEntry[]; evicted: string[] }> {
  await ensureRecentMediaSchema();
  const uid = normalizeId(userId);
  const t = schema.userRecentMedia;
  return db.transaction(async (tx) => {
    await tx.insert(t).values({ userId: uid, kind, items: [] }).onConflictDoNothing();
    const [row] = await tx.select({ items: t.items }).from(t)
      .where(and(eq(t.userId, uid), eq(t.kind, kind)))
      .for('update');
    const result = fn(ownedEntries(row?.items, uid, kind));
    await tx.update(t).set({ items: result.list, updatedAt: new Date() })
      .where(and(eq(t.userId, uid), eq(t.kind, kind)));
    return { list: result.list, evicted: result.evicted ?? [] };
  });
}

/**
 * Both lists for the dialog. The first time a user opens it, each list is
 * seeded with their current main avatar / banner (when it is one of their
 * uploads), so the image they have now shows up straight away.
 */
export async function getRecentProfileMedia(userId: string): Promise<Record<RecentMediaKind, RecentMediaEntry[]>> {
  await ensureRecentMediaSchema();
  const uid = normalizeId(userId);
  const t = schema.userRecentMedia;
  const rows = await db.select({ kind: t.kind, items: t.items }).from(t).where(eq(t.userId, uid));
  const out: Record<RecentMediaKind, RecentMediaEntry[]> = { avatar: [], banner: [] };
  const missing: RecentMediaKind[] = [];
  for (const kind of KINDS) {
    const row = rows.find((r) => r.kind === kind);
    if (row) out[kind] = ownedEntries(row.items, uid, kind);
    else missing.push(kind);
  }
  if (missing.length > 0) {
    const [user] = await db.select({ avatar: schema.users.avatar, banner: schema.users.banner })
      .from(schema.users).where(eq(schema.users.id, uid)).limit(1);
    for (const kind of missing) {
      const current = ownedProfileMediaUrl(kind === 'avatar' ? user?.avatar : user?.banner, uid, kind);
      const items: RecentMediaEntry[] = current ? [{ url: current, at: Date.now() }] : [];
      await db.insert(t).values({ userId: uid, kind, items }).onConflictDoNothing();
      out[kind] = items;
    }
  }
  return out;
}

/** The URLs in both lists (for validating a reuse); empty on any failure. */
export async function recentProfileMediaUrls(userId: string): Promise<Record<RecentMediaKind, string[]>> {
  try {
    const lists = await getRecentProfileMedia(userId);
    return { avatar: lists.avatar.map((e) => e.url), banner: lists.banner.map((e) => e.url) };
  } catch (err) {
    console.error('[recent-media] Could not read recents:', (err as Error)?.message ?? err);
    return { avatar: [], banner: [] };
  }
}

/** The listed URL when `url` is in this user's recent `kind` list, else null. */
export async function findRecentProfileMedia(userId: string, kind: RecentMediaKind, url: string): Promise<string | null> {
  const lists = await getRecentProfileMedia(userId);
  return lists[kind].find((e) => e.url === url)?.url ?? null;
}

/**
 * Record an avatar / banner change (main or per-server): `url` is the new
 * image (null when it was cleared), `previous` the one it replaced. Only the
 * user's own uploads are listed; anything that falls off the list is
 * released. Never throws (logged): a lost entry must not fail the change.
 */
export async function recordProfileMediaChange(
  userId: string,
  kind: RecentMediaKind,
  change: { url?: string | null; previous?: string | null },
): Promise<void> {
  try {
    const url = ownedProfileMediaUrl(change.url, userId, kind);
    const previous = ownedProfileMediaUrl(change.previous, userId, kind);
    if (!url && !previous) return;
    const { evicted } = await mutateList(userId, kind, (list) => recordRecentMedia(list, { url, previous }, Date.now()));
    if (evicted.length > 0) await releaseProfileMedia(userId, evicted);
  } catch (err) {
    console.error('[recent-media] Could not record change:', (err as Error)?.message ?? err);
  }
}

/** Remove one entry (the "x"); its file is deleted when nothing uses it. Returns the new list. */
export async function removeRecentProfileMedia(userId: string, kind: RecentMediaKind, url: string): Promise<RecentMediaEntry[]> {
  let removed = false;
  const { list } = await mutateList(userId, kind, (current) => {
    const r = removeRecentMedia(current, url);
    removed = r.removed;
    return { list: r.list };
  });
  if (removed) await releaseProfileMedia(userId, [url]);
  return list;
}

/**
 * Lower-cased storage keys each user's files must keep: their recents, their
 * main avatar / banner and every server profile avatar / banner. Throws when
 * any of it can't be read, so callers delete nothing (fail closed).
 */
export async function protectedProfileMediaKeys(userIds: readonly string[]): Promise<Map<string, Set<string>>> {
  const ids = [...new Set(userIds.map((id) => normalizeId(id).toLowerCase()))];
  const out = new Map<string, Set<string>>();
  for (const id of ids) out.set(id, new Set());
  if (ids.length === 0) return out;
  await ensureRecentMediaSchema();
  const { keyFromUrl } = await import('@/lib/services/storage');
  const add = (userId: string, url: unknown) => {
    if (typeof url !== 'string' || !url) return;
    out.get(userId.toLowerCase())?.add(keyFromUrl(url).toLowerCase());
  };
  const t = schema.userRecentMedia;
  const sm = schema.serverMembers;
  const [recents, users, members] = await Promise.all([
    db.select({ userId: t.userId, items: t.items }).from(t).where(inArray(t.userId, ids)),
    db.select({ id: schema.users.id, avatar: schema.users.avatar, banner: schema.users.banner })
      .from(schema.users).where(inArray(schema.users.id, ids)),
    db.select({ userId: sm.userId, avatar: sm.avatar, banner: sm.banner })
      .from(sm).where(and(inArray(sm.userId, ids), or(isNotNull(sm.avatar), isNotNull(sm.banner)))),
  ]);
  for (const r of recents) for (const e of normalizeRecentList(r.items)) add(r.userId, e.url);
  for (const u of users) { add(u.id, u.avatar); add(u.id, u.banner); }
  for (const m of members) { add(m.userId, m.avatar); add(m.userId, m.banner); }
  return out;
}

/**
 * The profile image keys from `keys` that may be deleted: each one's owner
 * (parsed from the key) neither lists it as recent nor uses it anywhere.
 * Keys that aren't profile images are returned unchanged (not ours to judge).
 * Throws when the protection can't be read.
 */
export async function filterUnprotectedProfileKeys(keys: readonly string[]): Promise<string[]> {
  const owners = new Set<string>();
  for (const key of keys) {
    const parsed = parseProfileMediaKey(key);
    if (parsed) owners.add(parsed.userId);
  }
  if (owners.size === 0) return [...keys];
  const keep = await protectedProfileMediaKeys([...owners]);
  return keys.filter((key) => {
    const parsed = parseProfileMediaKey(key);
    return !parsed || !keep.get(parsed.userId)?.has(key.toLowerCase());
  });
}

/**
 * Delete these images of the user when nothing keeps them (not recent, not in
 * use as a main or server profile image). Only the user's own profile image
 * keys are ever deleted. Never throws.
 */
export async function releaseProfileMedia(userId: string, urls: readonly string[]): Promise<void> {
  try {
    const keys = [...new Set(urls
      .map((u) => profileMediaKeyFromUrl(u, keyOpts()))
      .filter((k): k is string => !!k && isUserProfileMediaKey(k, userId)))];
    if (keys.length === 0) return;
    const deletable = await filterUnprotectedProfileKeys(keys);
    if (deletable.length === 0) return;
    const { storage } = await import('@/lib/services/storage');
    const deleted: string[] = [];
    for (const key of deletable) {
      await storage.delete(key).then(() => deleted.push(key)).catch((e) => {
        console.error('[recent-media] Failed to delete released image:', (e as Error)?.message ?? e);
      });
    }
    const memberKeys = deleted.filter((k) => parseProfileMediaKey(k)?.serverId);
    if (memberKeys.length > 0) {
      await import('@/lib/services/memberProfileMedia').then((m) => m.untrackMemberMediaDrafts(memberKeys)).catch(() => {});
    }
  } catch (err) {
    console.error('[recent-media] Release skipped:', (err as Error)?.message ?? err);
  }
}

/** Fire-and-forget releaseProfileMedia. */
export function releaseProfileMediaInBackground(userId: string, urls: readonly (string | null | undefined)[]): void {
  const list = urls.filter((u): u is string => typeof u === 'string' && u.length > 0);
  if (list.length > 0) void releaseProfileMedia(userId, list);
}

/**
 * Account deletion: drop the user's lists and release what they held (their
 * memberships are already gone; the main avatar / banner stay protected while
 * the user row exists, as before). Best-effort.
 */
export async function forgetRecentProfileMedia(userId: string): Promise<void> {
  try {
    await ensureRecentMediaSchema();
    const uid = normalizeId(userId);
    const t = schema.userRecentMedia;
    const rows = await db.delete(t).where(eq(t.userId, uid)).returning({ items: t.items });
    const urls = rows.flatMap((r) => normalizeRecentList(r.items).map((e) => e.url));
    if (urls.length > 0) await releaseProfileMedia(uid, urls);
  } catch (err) {
    console.error('[recent-media] Could not forget recents:', (err as Error)?.message ?? err);
  }
}
