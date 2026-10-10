// Cascading deletes for servers and accounts. The schema has no foreign keys,
// so every table that references a server (or a deleted user) must be cleaned
// up explicitly — otherwise orphaned server_members rows keep granting channel
// access and keep counting toward MAX_SERVERS_PER_USER.
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { normalizeId } from '@/lib/db/normalizeId';

/**
 * Delete a server and everything scoped to it in one transaction (set-based
 * deletes, not per-row). Read markers live in a hand-applied table, so they
 * are cleared best-effort after the commit.
 */
export async function deleteServerCascade(serverId: string): Promise<void> {
  const id = normalizeId(serverId);

  const channelIds = await db.transaction(async (tx) => {
    const ids = (await tx.select({ id: schema.channels.id }).from(schema.channels).where(eq(schema.channels.serverId, id)))
      .map((r) => r.id);

    if (ids.length > 0) {
      await tx.delete(schema.messages).where(inArray(schema.messages.channelId, ids));
      await tx.delete(schema.channelWebhooks).where(inArray(schema.channelWebhooks.channelId, ids));
    }
    await tx.delete(schema.messages).where(eq(schema.messages.serverId, id));
    await tx.delete(schema.channelWebhooks).where(eq(schema.channelWebhooks.serverId, id));
    await tx.delete(schema.invites).where(eq(schema.invites.serverId, id));
    await tx.delete(schema.serverBans).where(eq(schema.serverBans.serverId, id));
    await tx.delete(schema.serverEmojis).where(eq(schema.serverEmojis.serverId, id));
    await tx.delete(schema.serverStickers).where(eq(schema.serverStickers.serverId, id));
    await tx.delete(schema.serverMemberApplications).where(eq(schema.serverMemberApplications.serverId, id));
    await tx.delete(schema.serverMembers).where(eq(schema.serverMembers.serverId, id));
    await tx.delete(schema.roles).where(eq(schema.roles.serverId, id));
    await tx.delete(schema.channels).where(eq(schema.channels.serverId, id));
    await tx.delete(schema.servers).where(eq(schema.servers.id, id));
    return ids;
  });

  if (channelIds.length > 0) {
    await db.delete(schema.channelReadStates)
      .where(inArray(schema.channelReadStates.channelId, channelIds))
      .catch(() => { /* table may not be applied yet; markers are harmless */ });
    // Search index rows of the deleted messages (hashes only; best-effort).
    await import('@/lib/services/messageSearch')
      .then((s) => s.removeChannelsFromSearchIndex(channelIds))
      .catch(() => { /* orphaned rows never match: search joins live messages */ });
  }
}

/**
 * Remove a user's footprint before their row is deleted: memberships (with
 * member counts kept in step), owned servers (handed to the longest-standing
 * other member, or deleted when nobody is left) and references in other
 * users' friend / pending-request lists. Returns the server ids it deleted.
 */
export async function cleanupDeletedUser(userId: string): Promise<{ deletedServerIds: string[] }> {
  const id = normalizeId(userId);

  const owned = await db.select({ id: schema.servers.id }).from(schema.servers).where(eq(schema.servers.ownerId, id));
  const toDelete: string[] = [];
  for (const { id: serverId } of owned) {
    const [heir] = await db.select({ userId: schema.serverMembers.userId })
      .from(schema.serverMembers)
      .where(and(eq(schema.serverMembers.serverId, serverId), ne(schema.serverMembers.userId, id)))
      .orderBy(asc(schema.serverMembers.joinedAt))
      .limit(1);
    if (heir) {
      await db.update(schema.servers).set({ ownerId: heir.userId }).where(eq(schema.servers.id, serverId));
    } else {
      toDelete.push(serverId);
    }
  }
  for (const serverId of toDelete) await deleteServerCascade(serverId);

  await db.transaction(async (tx) => {
    const memberships = await tx.delete(schema.serverMembers)
      .where(eq(schema.serverMembers.userId, id))
      .returning({ serverId: schema.serverMembers.serverId });
    const serverIds = [...new Set(memberships.map((m) => m.serverId))];
    if (serverIds.length > 0) {
      await tx.update(schema.servers)
        .set({ memberCount: sql`GREATEST(COALESCE(${schema.servers.memberCount}, 1) - 1, 0)` })
        .where(inArray(schema.servers.id, serverIds));
    }

    await tx.execute(sql`
      UPDATE users
         SET friends = array_remove(friends, ${id}::uuid),
             blocked_users = array_remove(blocked_users, ${id}::uuid)
       WHERE friends @> ARRAY[${id}]::uuid[] OR blocked_users @> ARRAY[${id}]::uuid[]`);
    await tx.execute(sql`
      UPDATE users
         SET pending_friend_requests = COALESCE(pending_friend_requests, '{}'::jsonb) || jsonb_build_object(
               'incoming', COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(COALESCE(pending_friend_requests->'incoming', '[]'::jsonb)) e WHERE lower(e #>> '{}') <> ${id.toLowerCase()}), '[]'::jsonb),
               'outgoing', COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(COALESCE(pending_friend_requests->'outgoing', '[]'::jsonb)) e WHERE lower(e #>> '{}') <> ${id.toLowerCase()}), '[]'::jsonb))
       WHERE pending_friend_requests::text ILIKE ${`%${id.toLowerCase()}%`}`);
  });

  return { deletedServerIds: toDelete };
}
