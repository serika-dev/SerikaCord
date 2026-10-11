// Announcement channels: Publish and Follow, mounted at /api.
//
//   POST   /channels/:channelId/messages/:messageId/crosspost  publish to every follower
//   POST   /channels/:channelId/followers                      follow { webhookChannelId }
//   GET    /channels/:channelId/follow-targets                 where you could follow it into
//   DELETE /channel-follows/:followId                          unfollow (MANAGE_WEBHOOKS on the target)
//
// A follow is a webhook in the target channel named "Server #channel" with
// the source server's icon; a published message is copied into each target
// by its webhook (flag IS_CROSSPOST) and the original gets CROSSPOSTED.
// Pure rules: lib/chat/announcements.ts.
import { Elysia, t } from 'elysia';
import { randomUUID } from 'crypto';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { config } from '@/lib/config';
import { Channel, ChannelWebhook, Message, Server, ServerMember, type IChannel } from '@/lib/models';
import { authenticateRequest } from '@/lib/services/auth';
import { checkRateLimit, decryptFromStorage, encryptForStorage, isValidObjectId, rejectInvalidObjectIdParams } from '@/lib/security';
import { PERMISSION_BITS, hasPermission } from '@/lib/permissions/bits';
import { audit } from '@/lib/services/auditLog';
import { AuditLogEvent } from '@/lib/audit/auditLog';
import { buildWebhookAuthor } from '@/lib/chat/webhook';
import {
  CROSSPOST_FLAGS,
  MAX_FOLLOWERS_PER_CHANNEL,
  MAX_FOLLOWS_PER_TARGET,
  canPublishMessage,
  canReceiveFollow,
  copyableAttachments,
  copyableEmbeds,
  followWebhookName,
} from '@/lib/chat/announcements';
import { ensureScheduledEventSchema } from '@/lib/services/scheduledEvents';

type Cookie = Record<string, { value?: unknown }>;

async function getAuth(headers: Record<string, string | undefined>, cookie: Cookie) {
  const authHeader = headers.authorization ?? null;
  const authToken = cookie.auth_token?.value;
  const cookies: Record<string, string> = {};
  if (typeof authToken === 'string') cookies.auth_token = authToken;
  return authenticateRequest(authHeader, cookies);
}

const sameId = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const cf = schema.channelFollows;
const MAX_TARGET_SERVERS = 100;

type Membership = { roles?: string[] | null } | null | undefined;

async function permsIn(userId: string, channel: IChannel, membership: Membership): Promise<bigint> {
  if (!channel.serverId) return 0n;
  const { getMemberChannelPermissions } = await import('@/lib/api/channels');
  return getMemberChannelPermissions(userId, channel as IChannel & { serverId: string }, membership ?? null);
}

// ─── Crossposting ─────────────────────────────────────────────────────────────

/** Post a published copy of `source` into one follower channel. Drops dead follows. */
async function deliverToFollow(
  follow: typeof cf.$inferSelect,
  copy: { content: string; attachments: unknown[]; embeds: unknown[] },
  identity: { name: string; avatar: string | null },
): Promise<void> {
  const [webhook, target] = await Promise.all([
    ChannelWebhook.findById(follow.webhookId),
    Channel.findById(follow.targetChannelId),
  ]);
  if (!webhook || !target || !sameId(webhook.channelId, target.id)) {
    // The webhook or channel was deleted: the follow is gone too.
    await db.delete(cf).where(eq(cf.id, follow.id)).catch(() => {});
    return;
  }
  // Keep the follow's name / icon in step with the source server.
  if (webhook.name !== identity.name || (webhook.avatar ?? null) !== identity.avatar) {
    await ChannelWebhook.updateById(webhook.id, { name: identity.name, avatar: identity.avatar, updatedAt: new Date() }).catch(() => null);
  }
  const author = buildWebhookAuthor({ id: webhook.id, name: identity.name, avatar: identity.avatar }, {}, 'online');
  const message = await Message.create({
    channelId: target.id,
    serverId: target.serverId ?? null,
    authorId: webhook.id,
    content: copy.content ? await encryptForStorage(copy.content) : '',
    type: 'default',
    attachments: copy.attachments,
    embeds: copy.embeds,
    flags: CROSSPOST_FLAGS.IS_CROSSPOST,
  });
  await Channel.updateById(target.id, { lastMessageId: message.id, updatedAt: new Date() });
  const payload = {
    id: message.id,
    content: copy.content,
    authorId: author.id,
    author,
    webhookId: webhook.id,
    channelId: target.id,
    serverId: target.serverId ?? null,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    attachments: copy.attachments,
    embeds: copy.embeds,
    edited: false,
    type: 'default',
    pinned: false,
    reactions: [],
    flags: CROSSPOST_FLAGS.IS_CROSSPOST,
  };
  const { publishToChannel } = await import('@/lib/api/channels');
  publishToChannel(target.id, { type: 'message', message: payload });
  const { signalChannelMessage } = await import('@/lib/services/messageSignals');
  void signalChannelMessage({
    channel: { id: target.id, serverId: target.serverId, name: target.name },
    messageId: message.id,
    authorId: `webhook:${webhook.id}`,
    authorName: author.username,
    content: copy.content || '',
    // Published copies never ping anyone in the follower server.
    mentionedUserIds: [],
    createdAt: message.createdAt,
  });
  void import('@/lib/services/gatewayEvents')
    .then(({ emitMessageCreate }) => emitMessageCreate(payload as never))
    .catch(() => {});
}

async function crosspostToFollowers(
  source: IChannel,
  original: typeof schema.messages.$inferSelect,
): Promise<void> {
  const follows = await db.select().from(cf).where(eq(cf.sourceChannelId, source.id)).limit(MAX_FOLLOWERS_PER_CHANNEL);
  if (follows.length === 0) return;
  const server = source.serverId ? await Server.findById(source.serverId) : null;
  const identity = { name: followWebhookName(server?.name, source.name), avatar: server?.icon ?? null };
  const content = original.content ? await decryptFromStorage(original.content) : '';
  const copy = { content, attachments: copyableAttachments(original.attachments), embeds: copyableEmbeds(original.embeds) };
  for (const follow of follows) {
    await deliverToFollow(follow, copy, identity).catch((err) =>
      console.error('[announcements] delivering to a follower failed:', (err as Error)?.message ?? err));
  }
}

// ─── Follow targets ───────────────────────────────────────────────────────────

type FollowTargetServer = {
  id: string;
  name: string;
  icon: string | null;
  channels: Array<{ id: string; name: string; type: string; followId: string | null }>;
};

/** Text channels in your servers where you may add webhooks (MANAGE_WEBHOOKS). */
async function listFollowTargets(userId: string, sourceChannelId: string): Promise<FollowTargetServer[]> {
  const memberships = (await ServerMember.find({ userId })).slice(0, MAX_TARGET_SERVERS);
  if (memberships.length === 0) return [];
  const serverIds = memberships.map((m) => m.serverId);
  const servers = await Server.find({ id: { in: serverIds } });
  const { listViewableServerChannels } = await import('@/lib/api/channels');
  const out: FollowTargetServer[] = [];
  const allIds: string[] = [];
  for (const server of servers) {
    const membership = memberships.find((m) => sameId(m.serverId, server.id)) ?? null;
    const viewable = await listViewableServerChannels(userId, server.id).catch(() => null);
    if (!viewable) continue;
    const channels: FollowTargetServer['channels'] = [];
    for (const c of viewable) {
      if (!canReceiveFollow(c.type) || sameId(c.id, sourceChannelId)) continue;
      const perms = await permsIn(userId, c, membership);
      if (!hasPermission(perms, PERMISSION_BITS.MANAGE_WEBHOOKS)) continue;
      channels.push({ id: c.id, name: c.name ?? '', type: String(c.type), followId: null });
      allIds.push(c.id);
    }
    if (channels.length) out.push({ id: server.id, name: server.name, icon: server.icon ?? null, channels });
  }
  if (allIds.length) {
    const existing = await db.select({ id: cf.id, targetChannelId: cf.targetChannelId }).from(cf)
      .where(and(eq(cf.sourceChannelId, sourceChannelId), inArray(cf.targetChannelId, allIds)));
    const byTarget = new Map(existing.map((e) => [e.targetChannelId.toLowerCase(), e.id]));
    for (const s of out) for (const c of s.channels) c.followId = byTarget.get(c.id.toLowerCase()) ?? null;
  }
  return out;
}

export const announcementRoutes = new Elysia()
  .onBeforeHandle(rejectInvalidObjectIdParams)
  .post('/channels/:channelId/messages/:messageId/crosspost', async ({ headers, cookie, params, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const { checkChannelAccess, checkCanSpeak, publishToChannel } = await import('@/lib/api/channels');
    const access = await checkChannelAccess(user.id, params.channelId);
    if (!access.hasAccess || !access.channel) { set.status = 403; return { error: access.error || 'Access denied' }; }
    const channel = access.channel as IChannel;
    if (channel.type !== 'announcement') { set.status = 400; return { error: 'Only messages in announcement channels can be published' }; }
    const message = await Message.findById(params.messageId);
    if (!message || !sameId(message.channelId, channel.id) || message.isDeleted) { set.status = 404; return { error: 'Message not found' }; }
    if (!canPublishMessage({ id: message.id, type: message.type, flags: message.flags }, channel.type)) {
      set.status = 400;
      return { error: 'This message has already been published' };
    }
    // Your own message needs SEND_MESSAGES; anyone else's needs MANAGE_MESSAGES.
    if (sameId(message.authorId, user.id)) {
      const denied = await checkCanSpeak(channel as never, access.membership as never, user.id, ['send']);
      if (denied) { set.status = denied.status; return denied.body; }
    } else {
      const perms = await permsIn(user.id, channel, access.membership);
      if (!hasPermission(perms, PERMISSION_BITS.MANAGE_MESSAGES)) { set.status = 403; return { error: 'Missing Permissions' }; }
    }
    const rl = await checkRateLimit('crosspost', channel.id);
    if (!rl.success) {
      set.status = 429;
      set.headers['Retry-After'] = String(rl.retryAfter ?? 60);
      return { error: 'This channel is publishing too often, try again later', retryAfter: rl.retryAfter };
    }
    if (!(await ensureScheduledEventSchema())) { set.status = 503; return { error: 'Publishing is unavailable right now' }; }
    // Exactly once, even with two clicks or two instances.
    const m = schema.messages;
    const [updated] = await db.update(m)
      .set({ flags: sql`${m.flags} | ${CROSSPOST_FLAGS.CROSSPOSTED}` })
      .where(and(eq(m.id, message.id), sql`(${m.flags} & ${CROSSPOST_FLAGS.CROSSPOSTED}) = 0`))
      .returning();
    if (!updated) { set.status = 400; return { error: 'This message has already been published' }; }
    publishToChannel(channel.id, { type: 'message_flags', messageId: updated.id, flags: updated.flags });
    void crosspostToFollowers(channel, updated).catch((err) =>
      console.error('[announcements] crosspost failed:', (err as Error)?.message ?? err));
    return { id: updated.id, channel_id: channel.id, flags: updated.flags };
  })
  .get('/channels/:channelId/follow-targets', async ({ headers, cookie, params, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const { checkChannelAccess } = await import('@/lib/api/channels');
    const access = await checkChannelAccess(user.id, params.channelId, { lean: true });
    if (!access.hasAccess || !access.channel) { set.status = 403; return { error: access.error || 'Access denied' }; }
    if (access.channel.type !== 'announcement') { set.status = 400; return { error: 'Only announcement channels can be followed' }; }
    if (!(await ensureScheduledEventSchema())) return { servers: [] };
    set.headers['cache-control'] = 'no-store';
    return { servers: await listFollowTargets(user.id, params.channelId) };
  })
  .post('/channels/:channelId/followers', async ({ headers, cookie, params, body, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const targetId = body.webhookChannelId;
    if (!isValidObjectId(targetId)) { set.status = 400; return { error: 'Invalid channel' }; }
    if (sameId(targetId, params.channelId)) { set.status = 400; return { error: 'A channel cannot follow itself' }; }
    const rl = await checkRateLimit('channelFollow', user.id);
    if (!rl.success) { set.status = 429; return { error: 'You are doing that too quickly' }; }
    const { checkChannelAccess } = await import('@/lib/api/channels');
    const [src, dst] = await Promise.all([
      checkChannelAccess(user.id, params.channelId),
      checkChannelAccess(user.id, targetId),
    ]);
    if (!src.hasAccess || !src.channel) { set.status = 403; return { error: src.error || 'Access denied' }; }
    const source = src.channel as IChannel;
    if (source.type !== 'announcement' || !source.serverId) { set.status = 400; return { error: 'Only announcement channels can be followed' }; }
    if (!dst.hasAccess || !dst.channel) { set.status = 403; return { error: dst.error || 'Access denied' }; }
    const target = dst.channel as IChannel;
    if (!target.serverId || !canReceiveFollow(target.type)) { set.status = 400; return { error: 'Choose a text channel' }; }
    const perms = await permsIn(user.id, target, dst.membership);
    if (!hasPermission(perms, PERMISSION_BITS.MANAGE_WEBHOOKS)) {
      set.status = 403;
      return { error: 'You need Manage Webhooks in that channel' };
    }
    if (!(await ensureScheduledEventSchema())) { set.status = 503; return { error: 'Following is unavailable right now' }; }
    const [[existing], [targetCount], [sourceCount]] = await Promise.all([
      db.select({ id: cf.id }).from(cf).where(and(eq(cf.sourceChannelId, source.id), eq(cf.targetChannelId, target.id))).limit(1),
      db.select({ n: count() }).from(cf).where(eq(cf.targetChannelId, target.id)),
      db.select({ n: count() }).from(cf).where(eq(cf.sourceChannelId, source.id)),
    ]);
    if (existing) { set.status = 400; return { error: 'That channel already follows this one' }; }
    if (Number(targetCount?.n ?? 0) >= MAX_FOLLOWS_PER_TARGET) { set.status = 400; return { error: 'That channel follows too many channels' }; }
    if (Number(sourceCount?.n ?? 0) >= MAX_FOLLOWERS_PER_CHANNEL) { set.status = 400; return { error: 'This channel has too many followers' }; }

    const sourceServer = await Server.findById(source.serverId);
    const name = followWebhookName(sourceServer?.name, source.name);
    const token = randomUUID().replace(/-/g, '');
    const webhook = await ChannelWebhook.create({
      channelId: target.id,
      serverId: target.serverId,
      name,
      avatar: sourceServer?.icon ?? null,
      token,
      url: `${config.API_BASE_URL}/api/webhooks/${target.id}/${token}`,
      creatorId: user.id,
    });
    const [follow] = await db.insert(cf).values({
      sourceChannelId: source.id,
      sourceServerId: source.serverId,
      targetChannelId: target.id,
      targetServerId: target.serverId,
      webhookId: webhook.id,
      creatorId: user.id,
    }).onConflictDoNothing().returning();
    if (!follow) {
      await ChannelWebhook.deleteById(webhook.id).catch(() => {});
      set.status = 400;
      return { error: 'That channel already follows this one' };
    }
    audit({
      serverId: target.serverId,
      userId: user.id,
      actionType: AuditLogEvent.WEBHOOK_CREATE,
      targetId: webhook.id,
      changes: [{ key: 'name', new: webhook.name }, { key: 'channel_id', new: target.id }, { key: 'type', new: 2 }],
      options: { channel_name: target.name, webhook_name: webhook.name },
    });
    return { id: follow.id, channel_id: source.id, webhook_id: webhook.id, target_channel_id: target.id };
  }, { body: t.Object({ webhookChannelId: t.String() }) })
  .delete('/channel-follows/:followId', async ({ headers, cookie, params, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    if (!isValidObjectId(params.followId)) { set.status = 400; return { error: 'Invalid follow' }; }
    if (!(await ensureScheduledEventSchema())) { set.status = 503; return { error: 'Unavailable right now' }; }
    const [follow] = await db.select().from(cf).where(eq(cf.id, params.followId)).limit(1);
    if (!follow) { set.status = 404; return { error: 'Follow not found' }; }
    const { checkChannelAccess } = await import('@/lib/api/channels');
    const dst = await checkChannelAccess(user.id, follow.targetChannelId);
    if (!dst.hasAccess || !dst.channel) { set.status = 403; return { error: dst.error || 'Access denied' }; }
    const perms = await permsIn(user.id, dst.channel as IChannel, dst.membership);
    if (!hasPermission(perms, PERMISSION_BITS.MANAGE_WEBHOOKS)) { set.status = 403; return { error: 'You need Manage Webhooks in that channel' }; }
    await db.delete(cf).where(eq(cf.id, follow.id));
    const webhook = await ChannelWebhook.findById(follow.webhookId);
    if (webhook) {
      await ChannelWebhook.deleteById(webhook.id).catch(() => {});
      audit({
        serverId: follow.targetServerId,
        userId: user.id,
        actionType: AuditLogEvent.WEBHOOK_DELETE,
        targetId: webhook.id,
        changes: [{ key: 'name', old: webhook.name }, { key: 'channel_id', old: follow.targetChannelId }, { key: 'type', old: 2 }],
        options: { channel_name: dst.channel.name, webhook_name: webhook.name },
      });
    }
    return { success: true };
  });
