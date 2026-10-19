/**
 * Server tags (CORD-53): resolves the tag a user chose to display
 * (`users.customization.serverTag = { serverId }`) into the tag the server
 * currently has, for user payloads (message authors, member lists, profiles).
 *
 * A tag only resolves when the server still has an enabled tag AND the user
 * is still a member. Both lookups are batched per payload and cached in
 * process (short TTL, shared by Bun's and Next's module copies), so building
 * a page of messages costs at most one servers query and one memberships
 * query, and usually none.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { normalizeId } from '@/lib/db/normalizeId';
import { BoundedMap } from '@/lib/utils/boundedMap';
import { processShared } from '@/lib/realtime/processShared';
import {
  readServerTagConfig,
  serverTagPointer,
  withServerTag,
  type ResolvedServerTag,
} from '@/lib/servers/serverProfile';

const TAG_TTL_MS = 60_000;
const MEMBER_TTL_MS = 120_000;

type Entry<V> = { value: V; expiresAt: number };

const tagCache = processShared('serverTags:config', () => new BoundedMap<string, Entry<ResolvedServerTag | null>>(5000));
const memberCache = processShared('serverTags:member', () => new BoundedMap<string, Entry<boolean>>(20000));

function fresh<V>(e: Entry<V> | undefined): e is Entry<V> {
  return Boolean(e && e.expiresAt > Date.now());
}

/** Drop a server's cached tag (after its settings change). */
export function invalidateServerTag(serverId: string): void {
  tagCache.delete(normalizeId(serverId));
}

/** Drop a cached membership (after a leave/kick/ban). */
export function invalidateServerTagMembership(serverId: string, userId: string): void {
  memberCache.delete(`${normalizeId(serverId)}:${normalizeId(userId)}`);
}

async function loadServerTags(serverIds: string[]): Promise<Map<string, ResolvedServerTag | null>> {
  const out = new Map<string, ResolvedServerTag | null>();
  const missing: string[] = [];
  for (const id of serverIds) {
    const hit = tagCache.get(id);
    if (fresh(hit)) out.set(id, hit.value);
    else missing.push(id);
  }
  if (missing.length > 0) {
    const rows = await db
      .select({ id: schema.servers.id, name: schema.servers.name, settings: schema.servers.settings })
      .from(schema.servers)
      .where(inArray(schema.servers.id, missing));
    const byId = new Map(rows.map((r) => [normalizeId(r.id), r]));
    for (const id of missing) {
      const row = byId.get(id);
      const cfg = row ? readServerTagConfig((row.settings as Record<string, unknown> | null)?.serverTag) : null;
      const value: ResolvedServerTag | null = row && cfg
        ? {
            serverId: id,
            serverName: row.name,
            tag: cfg.tag,
            icon: cfg.icon,
            color: cfg.color,
            emoji: cfg.emoji ?? null,
            emojiUrl: cfg.emojiUrl ?? null,
          }
        : null;
      tagCache.set(id, { value, expiresAt: Date.now() + TAG_TTL_MS });
      out.set(id, value);
    }
  }
  return out;
}

async function loadMemberships(pairs: Array<[string, string]>): Promise<Set<string>> {
  const yes = new Set<string>();
  const missing: Array<[string, string]> = [];
  for (const [serverId, userId] of pairs) {
    const key = `${serverId}:${userId}`;
    const hit = memberCache.get(key);
    if (fresh(hit)) {
      if (hit.value) yes.add(key);
    } else {
      missing.push([serverId, userId]);
    }
  }
  if (missing.length > 0) {
    const serverIds = [...new Set(missing.map(([s]) => s))];
    const userIds = [...new Set(missing.map(([, u]) => u))];
    const rows = await db
      .select({ serverId: schema.serverMembers.serverId, userId: schema.serverMembers.userId })
      .from(schema.serverMembers)
      .where(and(inArray(schema.serverMembers.serverId, serverIds), inArray(schema.serverMembers.userId, userIds)));
    const found = new Set(rows.map((r) => `${normalizeId(r.serverId)}:${normalizeId(r.userId)}`));
    for (const [serverId, userId] of missing) {
      const key = `${serverId}:${userId}`;
      const isMember = found.has(key);
      memberCache.set(key, { value: isMember, expiresAt: Date.now() + MEMBER_TTL_MS });
      if (isMember) yes.add(key);
    }
  }
  return yes;
}

/**
 * Resolve the displayed server tag for each user that chose one.
 * Never throws: on any failure, users simply show no tag.
 */
export async function resolveServerTags(
  users: ReadonlyArray<{ id?: string | null; customization?: unknown } | null | undefined>,
): Promise<Map<string, ResolvedServerTag>> {
  const result = new Map<string, ResolvedServerTag>();
  const pairs: Array<[string, string]> = [];
  for (const u of users) {
    if (!u?.id) continue;
    const serverId = serverTagPointer(u.customization);
    if (serverId) pairs.push([normalizeId(serverId), normalizeId(u.id)]);
  }
  if (pairs.length === 0) return result;
  try {
    const [tags, members] = await Promise.all([
      loadServerTags([...new Set(pairs.map(([s]) => s))]),
      loadMemberships(pairs),
    ]);
    for (const [serverId, userId] of pairs) {
      const tag = tags.get(serverId);
      if (tag && members.has(`${serverId}:${userId}`)) result.set(userId, tag);
    }
  } catch {
    // Tags are decorative; never fail a payload over them.
  }
  return result;
}

/** Customization for a payload with the user's tag resolved (or removed). */
export function customizationWithTag<T>(
  tags: Map<string, ResolvedServerTag>,
  userId: string | null | undefined,
  customization: T,
): T {
  return withServerTag(customization, userId ? tags.get(normalizeId(userId)) : null);
}

/** One user's customization with the tag resolved (single-user payloads). */
export async function resolveCustomization<T>(user: { id?: string | null; customization?: T } | null | undefined): Promise<T | undefined> {
  if (!user) return undefined;
  if (!serverTagPointer(user.customization)) return withServerTag(user.customization as T, null);
  const tags = await resolveServerTags([user]);
  return customizationWithTag(tags, user.id, user.customization as T);
}

/**
 * After a user leaves / is removed from a server: forget the cached
 * membership and clear their chosen tag if it pointed at that server.
 */
export async function clearServerTagOnLeave(serverId: string, userId: string): Promise<void> {
  invalidateServerTagMembership(serverId, userId);
  await db
    .update(schema.users)
    .set({ customization: sql`COALESCE(${schema.users.customization}, '{}'::jsonb) - 'serverTag'` })
    .where(and(
      eq(schema.users.id, normalizeId(userId)),
      sql`${schema.users.customization}->'serverTag'->>'serverId' = ${normalizeId(serverId)}`,
    ));
}

/** Whether `userId` may adopt `serverId`'s tag (member + enabled tag). */
export async function canAdoptServerTag(serverId: string, userId: string): Promise<ResolvedServerTag | null> {
  const sid = normalizeId(serverId);
  const uid = normalizeId(userId);
  invalidateServerTagMembership(sid, uid);
  const [tags, members] = await Promise.all([loadServerTags([sid]), loadMemberships([[sid, uid]])]);
  const tag = tags.get(sid) ?? null;
  return tag && members.has(`${sid}:${uid}`) ? tag : null;
}
