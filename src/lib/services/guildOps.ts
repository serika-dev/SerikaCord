/**
 * Guild channel and moderation writes for the Discord v10 bot routes
 * (src/lib/api/botApi.ts), doing what the matching web routes do
 * (src/lib/api/channels.ts PATCH/DELETE /channels/:id, servers.ts bans)
 * plus the bot gateway events: audit log entries, the same Redis
 * `channel:*` notifications, category permission re-sync, and
 * CHANNEL_* / MESSAGE_DELETE_BULK dispatches.
 */
import { and, eq, gte, inArray } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { getPublisher } from '@/lib/db';
import { normalizeId } from '@/lib/db/normalizeId';
import { audit } from '@/lib/services/auditLog';
import { AuditLogEvent, CHANNEL_AUDIT_KEYS, diffChanges, diffOverwrites, snapshotChanges } from '@/lib/audit/auditLog';
import { childrenToResync, normalizeOverwrites, overwritesInSync, type EditableOverwrite } from '@/lib/permissions/overwriteEditor';
import { captureChannelViewers, emitChannelDelete, emitChannelUpdates } from '@/lib/services/guildGatewayEvents';

type ChannelRow = typeof schema.channels.$inferSelect;

async function publishTopic(topic: string, data: object) {
  try {
    const pub = getPublisher();
    if (pub) await pub.publish(topic, JSON.stringify(data));
  } catch { /* best-effort */ }
}

/**
 * Apply `updates` to a guild channel as `actorId`: category edits re-sync the
 * channels that were synced with it, `lock_permissions` copies the new
 * parent's overwrites, and every visibility change reaches bots as
 * CHANNEL_CREATE / CHANNEL_DELETE. Returns the stored channel.
 */
export async function updateGuildChannel(opts: {
  channel: ChannelRow;
  updates: Partial<typeof schema.channels.$inferInsert>;
  actorId: string;
  reason: string | null;
  lockPermissions?: boolean;
}): Promise<ChannelRow | null> {
  const { channel, actorId, reason } = opts;
  const updates: Partial<typeof schema.channels.$inferInsert> = { ...opts.updates };
  const serverId = channel.serverId as string;

  if (opts.lockPermissions && updates.parentId && updates.permissionOverwrites === undefined) {
    const [parent] = await db.select().from(schema.channels).where(eq(schema.channels.id, normalizeId(updates.parentId))).limit(1);
    if (parent) updates.permissionOverwrites = normalizeOverwrites(parent.permissionOverwrites);
  }

  // A channel inside an age-restricted category stays age-restricted (CORD-60).
  const isThreadRow = channel.type === 'public_thread' || channel.type === 'private_thread';
  if (channel.type !== 'category' && !isThreadRow) {
    const finalParentId = updates.parentId !== undefined ? updates.parentId : channel.parentId;
    const mayLoseNsfw = updates.nsfw === false || (updates.parentId !== undefined && !channel.nsfw && updates.nsfw !== true);
    if (finalParentId && mayLoseNsfw) {
      const [parent] = await db.select().from(schema.channels).where(eq(schema.channels.id, normalizeId(finalParentId))).limit(1);
      if (parent?.type === 'category' && parent.nsfw) updates.nsfw = true;
    }
  }

  // Category edits re-sync children that were in sync with the old overwrites.
  let resync: string[] = [];
  if (channel.type === 'category' && updates.permissionOverwrites !== undefined) {
    const previous = normalizeOverwrites(channel.permissionOverwrites);
    if (!overwritesInSync(previous, updates.permissionOverwrites as EditableOverwrite[])) {
      const children = await db.select().from(schema.channels)
        .where(and(eq(schema.channels.serverId, normalizeId(serverId)), eq(schema.channels.parentId, channel.id)));
      resync = childrenToResync(previous, children as Array<{ id: string; permissionOverwrites?: unknown }>);
    }
  }

  const touchesView = updates.permissionOverwrites !== undefined || updates.parentId !== undefined;
  const before = touchesView ? await captureChannelViewers(serverId, [channel.id, ...resync]) : undefined;

  const [updated] = await db.update(schema.channels)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(schema.channels.id, channel.id))
    .returning();
  if (resync.length > 0) {
    await db.update(schema.channels)
      .set({ permissionOverwrites: updates.permissionOverwrites, updatedAt: new Date() })
      .where(inArray(schema.channels.id, resync));
  }

  await publishTopic('channel:update', { channelId: channel.id, serverId, updates });
  for (const id of resync) await publishTopic('channel:update', { channelId: id, serverId, updates: { permissionOverwrites: updates.permissionOverwrites } });

  const changes = diffChanges(channel as Record<string, unknown>, updates as Record<string, unknown>, CHANNEL_AUDIT_KEYS);
  if (changes.length > 0) {
    audit({
      serverId, userId: actorId, actionType: AuditLogEvent.CHANNEL_UPDATE, targetId: channel.id, changes,
      options: { channel_name: updated?.name ?? channel.name, channel_type: channel.type }, reason,
    });
  }
  if (updates.permissionOverwrites !== undefined) {
    for (const op of diffOverwrites(normalizeOverwrites(channel.permissionOverwrites), updates.permissionOverwrites as EditableOverwrite[])) {
      audit({
        serverId, userId: actorId, actionType: op.action, targetId: channel.id, changes: op.changes,
        options: { id: op.overwriteId, type: op.overwriteType === 'member' ? '1' : '0', channel_name: updated?.name ?? channel.name },
        reason,
      });
    }
  }

  void emitChannelUpdates(serverId, [channel.id, ...resync], before);
  return updated ?? null;
}

/**
 * Delete a guild channel like the web route: soft-delete its messages, move
 * a category's channels out of it, remove the row, notify, audit, and send
 * CHANNEL_DELETE to the bots that could see it (CHANNEL_UPDATE for the
 * channels that left the category). Threads go through the thread routes.
 */
export async function deleteGuildChannel(opts: { channel: ChannelRow; actorId: string; reason: string | null }): Promise<void> {
  const { channel, actorId, reason } = opts;
  const serverId = channel.serverId as string;
  const before = await captureChannelViewers(serverId, [channel.id]);

  await db.update(schema.messages)
    .set({ isDeleted: true, deletedAt: new Date() })
    .where(and(eq(schema.messages.channelId, channel.id), eq(schema.messages.isDeleted, false)));

  const orphaned = channel.type === 'category'
    ? await db.update(schema.channels)
      .set({ parentId: null, updatedAt: new Date() })
      .where(and(eq(schema.channels.serverId, normalizeId(serverId)), eq(schema.channels.parentId, channel.id)))
      .returning({ id: schema.channels.id })
    : [];

  await db.delete(schema.channels).where(eq(schema.channels.id, channel.id));

  for (const child of orphaned) await publishTopic('channel:update', { channelId: child.id, serverId, updates: { parentId: null } });
  await publishTopic('channel:delete', { channelId: channel.id, serverId });

  audit({
    serverId, userId: actorId, actionType: AuditLogEvent.CHANNEL_DELETE, targetId: channel.id,
    changes: snapshotChanges(channel as Record<string, unknown>, { name: 'name', type: 'type', nsfw: 'nsfw', rateLimitPerUser: 'rate_limit_per_user' }, 'old'),
    options: { channel_name: channel.name, channel_type: channel.type },
    reason,
  });

  void emitChannelDelete(channel, before);
  if (orphaned.length > 0) void emitChannelUpdates(serverId, orphaned.map((c) => c.id));
}

/** Most messages a ban's `delete_message_seconds` removes in one go. */
const PURGE_LIMIT = 5000;

/**
 * Soft-delete what `userId` posted in `serverId` during the last `seconds`
 * (ban `delete_message_seconds`): live delete events to open channels and
 * MESSAGE_DELETE_BULK to bots. Returns how many messages were removed.
 */
export async function purgeMemberMessages(serverId: string, userId: string, seconds: number, limit = PURGE_LIMIT): Promise<number> {
  if (!seconds || seconds <= 0 || limit <= 0) return 0;
  const since = new Date(Date.now() - seconds * 1000);
  const rows = await db.select({ id: schema.messages.id, channelId: schema.messages.channelId })
    .from(schema.messages)
    .where(and(
      eq(schema.messages.serverId, normalizeId(serverId)),
      eq(schema.messages.authorId, normalizeId(userId)),
      eq(schema.messages.isDeleted, false),
      gte(schema.messages.createdAt, since),
    ))
    .limit(Math.min(limit, PURGE_LIMIT));
  if (rows.length === 0) return 0;
  const now = new Date();
  for (let i = 0; i < rows.length; i += 500) {
    await db.update(schema.messages)
      .set({ isDeleted: true, deletedAt: now })
      .where(inArray(schema.messages.id, rows.slice(i, i + 500).map((r) => r.id)));
  }
  const byChannel = new Map<string, string[]>();
  for (const r of rows) {
    const list = byChannel.get(r.channelId) ?? [];
    list.push(r.id);
    byChannel.set(r.channelId, list);
  }
  const [{ publishToChannel }, { emitMessageDeleteBulk }] = await Promise.all([
    import('@/lib/api/channels'),
    import('@/lib/services/gatewayEvents'),
  ]);
  for (const [channelId, ids] of byChannel) {
    for (const id of ids) publishToChannel(channelId, { type: 'delete', messageId: id });
    for (let i = 0; i < ids.length; i += 100) {
      void emitMessageDeleteBulk({ ids: ids.slice(i, i + 100), channelId, guildId: normalizeId(serverId) });
    }
  }
  return rows.length;
}
