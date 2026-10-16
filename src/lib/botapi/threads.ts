/**
 * Threads + forums for the Discord-compatible bot API (WP5). Route wiring is
 * in src/lib/api/botApi.ts; the pure rules (validation, permission rules,
 * pagination) in ./threadRules.ts; storage and the web side effects in
 * src/lib/services/threads.ts (membership changes emit THREAD_MEMBERS_UPDATE
 * there, for the web and the bot API alike).
 *
 * Visibility is the app's: the access guard in botApi.ts runs
 * checkChannelAccess for the path channel (private threads: members, the
 * owner, ticket-access roles and MANAGE_THREADS), and listings filter with
 * the same rules (listViewableServerChannels).
 */
import { randomUUID } from 'crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { getPublisher } from '@/lib/db';
import { Channel, Message, Role, ServerMember, User, type IChannel, type IMessage } from '@/lib/models';
import { PERMISSION_BITS as P, hasPermission } from '@/lib/permissions/bits';
import { applyTimeout } from '@/lib/permissions/botChannel';
import { encryptForStorage, isValidObjectId, sanitizeInput } from '@/lib/security';
import { audit } from '@/lib/services/auditLog';
import { AuditLogEvent, CHANNEL_AUDIT_KEYS, auditReason, diffChanges, snapshotChanges } from '@/lib/audit/auditLog';
import { canHostThreads, cleanThreadName, normalizeAutoArchiveDuration, threadMembersToAdd } from '@/lib/chat/threads';
import { toDiscordChannel, toDiscordGuildMember, toDiscordThreadMember } from '@/lib/services/gatewayEvents';
import {
  CHANNEL_FLAGS, TAG_REQUIRED, THREAD_ALREADY_CREATED, THREAD_ARCHIVED, THREAD_LOCKED, WRONG_CHANNEL_TYPE,
  filterAndSortThreads, pageThreadMemberIds, parseBeforeTimestamp, parseThreadCreate, planForumPatch, planThreadPatch,
  threadListLimit, threadSearchPlan, type ForumTag,
} from './threadRules';

type Result = { status: number; body: unknown };
type Headers = Record<string, string | undefined>;
export interface BotActor { id: string; username: string; displayName?: string | null; avatar?: string | null; isBot?: boolean | null }

const MISSING_PERMISSIONS = { code: 50013, message: 'Missing Permissions' };
const MISSING_ACCESS = { code: 50001, message: 'Missing Access' };
const UNKNOWN_CHANNEL = { code: 10003, message: 'Unknown Channel' };
const UNKNOWN_MESSAGE = { code: 10008, message: 'Unknown Message' };
const UNKNOWN_MEMBER = { code: 10007, message: 'Unknown Member' };
const SYSTEM_MESSAGE = { code: 50021, message: 'Cannot execute action on a system message' };

const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
export const isThread = (c: { type?: string | null } | null | undefined) => c?.type === 'public_thread' || c?.type === 'private_thread';
const isForum = (c: { type?: string | null }) => c.type === 'forum' || c.type === 'media';
const isMemberOf = (t: { threadMemberIds?: string[] | null }, userId: string) => (t.threadMemberIds ?? []).some((m) => same(m, userId));

/** The bot's channel permissions (parent's overwrites for threads), reduced while timed out. */
async function botPerms(botId: string, channel: IChannel): Promise<bigint> {
  if (!channel.serverId) return 0n;
  const membership = await ServerMember.findOne({ serverId: channel.serverId, userId: botId });
  const { getMemberChannelPermissions } = await import('@/lib/api/channels');
  const perms = await getMemberChannelPermissions(botId, channel as IChannel & { serverId: string }, membership ?? null);
  return applyTimeout(perms, membership?.communicationDisabledUntil ?? null);
}

const can = (perms: bigint, bit: bigint) => hasPermission(perms, P.ADMINISTRATOR) || hasPermission(perms, bit);

async function loadThread(channelId: string): Promise<IChannel | null> {
  if (!isValidObjectId(channelId)) return null;
  const c = await Channel.findById(channelId);
  return c && isThread(c) ? c : null;
}

function forumTags(c: { availableTags?: unknown }): ForumTag[] {
  const raw = Array.isArray(c.availableTags) ? (c.availableTags as Array<Record<string, unknown>>) : [];
  return raw
    .filter((t) => t && typeof t.id === 'string')
    .map((t) => ({
      id: t.id as string,
      name: String(t.name ?? ''),
      moderated: Boolean(t.moderated),
      emojiId: (t.emojiId ?? t.emoji_id ?? null) as string | null,
      emojiName: (t.emojiName ?? t.emoji_name ?? null) as string | null,
    }));
}

/** Web clients + sidebars after a thread appeared (same events the web routes send). */
async function announceNewThread(parent: IChannel, row: IChannel, botId: string) {
  const { publishToChannel } = await import('@/lib/api/channels');
  const { broadcastThreadUpdate, notifyThreadMembership } = await import('@/lib/services/threads');
  publishToChannel(parent.id, { type: 'thread_create', threadId: row.id });
  await broadcastThreadUpdate(row).catch(() => null);
  notifyThreadMembership(parent.serverId, row.id, [botId]);
}

/** AutoMod on a thread title (keyword / link rules), like the web routes. */
async function threadTitleBlocked(parent: IChannel, bot: BotActor, name: string): Promise<boolean> {
  if (!parent.serverId) return false;
  const membership = await ServerMember.findOne({ serverId: parent.serverId, userId: bot.id });
  const { enforceAutoMod } = await import('@/lib/services/automod');
  const blocked = await enforceAutoMod({ serverId: parent.serverId, channel: parent, user: bot, membership, content: '', title: name, source: 'thread' });
  return Boolean(blocked);
}

const AUTOMOD_BLOCKED = { code: 200000, message: 'Message was blocked by automatic moderation' };

// ─── Create ───────────────────────────────────────────────────────────────────

export interface CreateThreadOptions {
  bot: BotActor;
  channelId: string;
  body: unknown;
  headers: Headers;
  /** POST /channels/{id}/messages/{mid}/threads. */
  messageId?: string;
  /**
   * Forum posts: send the starter message through the bot message route
   * (validation, files, mentions, events). Returns the route's status + body.
   */
  sendStarter?: (threadId: string, message: Record<string, unknown>) => Promise<Result>;
}

/**
 * POST /channels/{id}/threads and POST /channels/{id}/messages/{mid}/threads.
 * Text / announcement channels: a thread with or without a starter message
 * (a public one without a message posts Discord's "started a thread" row).
 * Forum / media channels: a post with its first message (`message`), tags,
 * the REQUIRE_TAG flag and forum slowmode; ticket forums make it private.
 */
export async function createBotThread(opts: CreateThreadOptions): Promise<Result> {
  const { bot } = opts;
  const parent = isValidObjectId(opts.channelId) ? await Channel.findById(opts.channelId) : null;
  if (!parent || !parent.serverId) return { status: 404, body: UNKNOWN_CHANNEL };
  if (isThread(parent)) return { status: 400, body: WRONG_CHANNEL_TYPE };
  const fromMessage = Boolean(opts.messageId);
  const forum = isForum(parent);
  if (!forum && !canHostThreads(parent.type)) return { status: 400, body: WRONG_CHANNEL_TYPE };
  if (forum && fromMessage) return { status: 400, body: WRONG_CHANNEL_TYPE };

  const tags = forumTags(parent);
  const parsed = parseThreadCreate(opts.body, {
    parentType: String(parent.type),
    fromMessage,
    availableTagIds: new Set(tags.map((t) => t.id)),
  });
  if (!parsed.ok) return { status: 400, body: parsed.error };
  const input = parsed.value;

  const perms = await botPerms(bot.id, parent);
  if (!can(perms, P.VIEW_CHANNEL)) return { status: 403, body: MISSING_ACCESS };
  if (forum) {
    if (!can(perms, P.SEND_MESSAGES)) return { status: 403, body: MISSING_PERMISSIONS };
  } else if (!can(perms, input.type === 'private_thread' ? P.CREATE_PRIVATE_THREADS : P.CREATE_PUBLIC_THREADS)) {
    return { status: 403, body: MISSING_PERMISSIONS };
  }

  const name = cleanThreadName(sanitizeInput(input.name));
  if (!name) return { status: 400, body: { code: 50035, message: 'Invalid Form Body', errors: { name: { _errors: [{ code: 'BASE_TYPE_BAD_LENGTH', message: 'Must be between 1 and 100 in length.' }] } } } };

  let appliedTags: string[] = [];
  if (forum) {
    appliedTags = input.appliedTags ?? [];
    // Moderated tags: only thread moderators may apply them.
    const moderated = new Set(tags.filter((t) => t.moderated).map((t) => t.id));
    if (appliedTags.some((id) => moderated.has(id)) && !can(perms, P.MANAGE_THREADS)) return { status: 403, body: MISSING_PERMISSIONS };
    if ((Number(parent.flags) & CHANNEL_FLAGS.REQUIRE_TAG) !== 0 && appliedTags.length === 0) return { status: 400, body: TAG_REQUIRED };
    // Forum slowmode applies to new posts (moderators are exempt, like Discord).
    const slow = parent.rateLimitPerUser ?? 0;
    if (slow > 0 && !can(perms, P.MANAGE_MESSAGES) && !can(perms, P.MANAGE_CHANNELS) && !can(perms, P.MANAGE_THREADS)) {
      const [last] = await db.select({ createdAt: schema.channels.createdAt }).from(schema.channels)
        .where(and(eq(schema.channels.parentId, parent.id), eq(schema.channels.ownerId, bot.id)))
        .orderBy(desc(schema.channels.createdAt)).limit(1);
      const elapsed = last?.createdAt ? Date.now() - new Date(last.createdAt).getTime() : Infinity;
      if (elapsed < slow * 1000) {
        const retry = Math.ceil((slow * 1000 - elapsed) / 1000);
        return { status: 429, body: { code: 20016, message: 'This action cannot be performed due to slowmode rate limit.', retry_after: retry, global: false } };
      }
    }
  }
  if (await threadTitleBlocked(parent, bot, name)) return { status: 400, body: AUTOMOD_BLOCKED };

  let starter: IMessage | null = null;
  if (opts.messageId) {
    starter = isValidObjectId(opts.messageId) ? await Message.findById(opts.messageId) : null;
    if (!starter || starter.isDeleted || !same(starter.channelId, parent.id)) return { status: 404, body: UNKNOWN_MESSAGE };
    if (starter.threadId) return { status: 400, body: THREAD_ALREADY_CREATED };
    if (starter.type !== 'default' && starter.type !== 'reply') return { status: 400, body: SYSTEM_MESSAGE };
  }

  const isTicket = forum && parent.forumMode === 'tickets';
  const type = forum ? (isTicket ? 'private_thread' : 'public_thread') : input.type;
  const autoArchiveDuration = input.autoArchiveDuration !== undefined
    ? input.autoArchiveDuration
    : forum ? null : normalizeAutoArchiveDuration(parent.defaultAutoArchiveDuration);
  const created = await Channel.create({
    serverId: parent.serverId,
    name,
    type,
    parentId: parent.id,
    ownerId: bot.id,
    position: 0,
    threadMemberIds: [bot.id],
    messageCount: 0,
    archived: false,
    locked: false,
    autoArchiveDuration,
    starterMessageId: starter?.id ?? null,
    rateLimitPerUser: input.rateLimitPerUser ?? (forum ? parent.defaultThreadRateLimitPerUser ?? 0 : 0),
    ...(forum ? { appliedTags } : {}),
    ...(type === 'private_thread' && input.invitable === false ? { threadInvitable: false } : {}),
  });
  if (starter) {
    const { claimStarterMessage } = await import('@/lib/services/threads');
    if (!(await claimStarterMessage(starter.id, created.id))) {
      await Channel.deleteById(created.id);
      return { status: 400, body: THREAD_ALREADY_CREATED };
    }
  }

  // THREAD_CREATE first, so bots know the channel before its first MESSAGE_CREATE.
  const { emitThreadCreate, emitMessageCreate, emitThreadDelete } = await import('@/lib/services/gatewayEvents');
  await emitThreadCreate(created);

  let starterMessage: unknown;
  if (forum) {
    if (!opts.sendStarter) return { status: 500, body: { code: 0, message: '500: Internal Server Error' } };
    const sent = await opts.sendStarter(created.id, input.message ?? {});
    if (sent.status < 200 || sent.status >= 300) {
      // The post never existed for anyone but the bots told a moment ago.
      await Channel.deleteById(created.id).catch(() => {});
      void emitThreadDelete(created);
      return sent;
    }
    starterMessage = sent.body;
  } else if (!starter && type === 'public_thread') {
    // Discord's THREAD_CREATED (type 18) row in the parent: the web's "started a thread".
    const notice = await Message.create({
      channelId: parent.id,
      serverId: parent.serverId,
      authorId: bot.id,
      content: await encryptForStorage(name),
      type: 'thread_created',
      threadId: created.id,
    });
    void emitMessageCreate({ id: notice.id, channelId: parent.id, serverId: parent.serverId });
    const { loadThreadSummaries } = await import('@/lib/services/threads');
    const summary = (await loadThreadSummaries([created])).get(created.id) ?? null;
    const { publishToChannel } = await import('@/lib/api/channels');
    publishToChannel(parent.id, {
      type: 'message',
      message: {
        id: notice.id, content: name, authorId: bot.id,
        author: { id: bot.id, username: bot.username, displayName: bot.displayName || bot.username, avatar: bot.avatar ?? null, badges: [], isBot: true, isSystem: false, isVerified: false },
        channelId: parent.id, serverId: parent.serverId, createdAt: notice.createdAt, updatedAt: notice.updatedAt,
        type: 'thread_created', threadId: created.id, thread: summary,
        attachments: [], embeds: [], reactions: [], mentionedUserIds: [], mentionedRoleIds: [], mentionedChannelIds: [],
      },
    });
  }

  const row = (await Channel.findById(created.id)) ?? created;
  await announceNewThread(parent, row, bot.id);
  audit({
    serverId: parent.serverId,
    userId: bot.id,
    actionType: AuditLogEvent.THREAD_CREATE,
    targetId: row.id,
    changes: [{ key: 'name', new: row.name }, { key: 'type', new: row.type }],
    options: { channel_name: row.name, channel_type: row.type },
    reason: auditReason(opts.headers['x-audit-log-reason']),
  });
  const out: Record<string, unknown> = { ...toDiscordChannel(row), member: toDiscordThreadMember(row, bot.id) };
  if (forum) out.message = starterMessage;
  return { status: 201, body: out };
}

// ─── Sending into threads (POST /channels/{thread}/messages) ─────────────────

/**
 * Before a bot message lands in a thread: a locked thread only takes
 * moderators' messages; an archived one reopens (Discord unarchives on send).
 */
export async function prepareThreadSend(thread: IChannel, perms: bigint): Promise<Result | null> {
  if (!isThread(thread)) return null;
  const mod = can(perms, P.MANAGE_THREADS);
  if (thread.locked && !mod) return { status: 403, body: thread.archived ? THREAD_ARCHIVED : THREAD_LOCKED };
  if (thread.archived) {
    const { setThreadArchived, broadcastThreadUpdate, notifyThreadMembership } = await import('@/lib/services/threads');
    const row = await setThreadArchived(thread.id, false);
    if (row) {
      thread.archived = false;
      void broadcastThreadUpdate(row).catch(() => null);
      notifyThreadMembership(row.serverId, row.id, row.threadMemberIds ?? []);
      const { emitThreadUpdate } = await import('@/lib/services/gatewayEvents');
      void emitThreadUpdate(row);
    }
  }
  return null;
}

/**
 * After a bot message landed in a thread: the bot (and whoever it mentioned)
 * joins, the chip refreshes. A non-invitable private thread only takes the
 * mentioned users when the bot moderates threads (mentions are an invite).
 */
export function afterThreadSend(thread: IChannel, botId: string, mentionedUserIds: string[], perms: bigint): void {
  if (!isThread(thread)) return;
  void (async () => {
    const { addThreadMembers, notifyThreadMembership, refreshThreadAfterMessage } = await import('@/lib/services/threads');
    const mayInvite = !(thread.type === 'private_thread' && thread.threadInvitable === false) || can(perms, P.MANAGE_THREADS);
    const toAdd = threadMembersToAdd(thread.threadMemberIds ?? [], botId, mayInvite ? mentionedUserIds : []);
    const joined = toAdd.length ? await addThreadMembers(thread.id, toAdd).catch(() => []) : [];
    if (joined.length) notifyThreadMembership(thread.serverId, thread.id, joined);
    refreshThreadAfterMessage(thread.id);
  })().catch(() => {});
}

// ─── PATCH / DELETE /channels/{thread} ────────────────────────────────────────

/**
 * Thread branch of PATCH /channels/{id}: Discord's thread fields with their
 * own permission rules (thread owner, MANAGE_THREADS, SEND_MESSAGES_IN_THREADS
 * to unarchive). Returns null when the channel isn't a thread.
 */
export async function patchBotThread(botId: string, channelId: string, body: unknown, headers: Headers): Promise<Result | null> {
  const thread = await loadThread(channelId);
  if (!thread) return null;
  const parent = thread.parentId ? await Channel.findById(thread.parentId) : null;
  if (!parent) return { status: 404, body: UNKNOWN_CHANNEL };
  const perms = await botPerms(botId, thread);
  if (!can(perms, P.VIEW_CHANNEL)) return { status: 403, body: MISSING_ACCESS };
  const plan = planThreadPatch(body, {
    type: String(thread.type),
    archived: Boolean(thread.archived),
    locked: Boolean(thread.locked),
    parentType: String(parent.type),
    availableTagIds: new Set(forumTags(parent).map((t) => t.id)),
    flags: Number(thread.flags) || 0,
    appliedTags: thread.appliedTags ?? [],
    moderatedTagIds: new Set(forumTags(parent).filter((t) => t.moderated).map((t) => t.id)),
  }, {
    isOwner: same(thread.ownerId, botId),
    manageThreads: can(perms, P.MANAGE_THREADS),
    canSend: can(perms, P.SEND_MESSAGES_IN_THREADS),
  });
  if (!plan.ok) return { status: plan.status, body: plan.body };
  const { updates, archive } = plan.plan;
  if (typeof updates.name === 'string') updates.name = cleanThreadName(sanitizeInput(updates.name)) || thread.name;
  if (Object.keys(updates).length === 0 && !archive) return { status: 200, body: toDiscordChannel(thread) };

  const { setThreadArchived, broadcastThreadUpdate, notifyThreadMembership } = await import('@/lib/services/threads');
  if (Object.keys(updates).length) await Channel.updateById(thread.id, updates);
  if (archive) await setThreadArchived(thread.id, archive.archived, archive.locked);
  const updated = (await Channel.findById(thread.id)) ?? thread;

  void broadcastThreadUpdate(updated).catch(() => null);
  if (archive || updates.name !== undefined) notifyThreadMembership(updated.serverId, updated.id, updated.threadMemberIds ?? []);
  const { emitThreadUpdate } = await import('@/lib/services/gatewayEvents');
  void emitThreadUpdate(updated);
  if (thread.serverId) {
    const changes = diffChanges(thread as Record<string, unknown>, { ...updates, ...(archive ? { archived: archive.archived, ...(archive.locked !== undefined ? { locked: archive.locked } : {}) } : {}) }, { ...CHANNEL_AUDIT_KEYS, archived: 'archived', locked: 'locked', autoArchiveDuration: 'auto_archive_duration', appliedTags: 'applied_tags', threadInvitable: 'invitable', flags: 'flags' });
    if (changes.length) {
      audit({
        serverId: thread.serverId,
        userId: botId,
        actionType: AuditLogEvent.THREAD_UPDATE,
        targetId: thread.id,
        changes,
        options: { channel_name: updated.name, channel_type: updated.type },
        reason: auditReason(headers['x-audit-log-reason']),
      });
    }
  }
  return { status: 200, body: toDiscordChannel(updated) };
}

/**
 * Forum branch of PATCH /channels/{id}: the forum-only fields as stored
 * updates for the shared channel PATCH to merge (it already required
 * MANAGE_CHANNELS). null when the channel isn't a forum or none are present.
 */
export function forumPatchUpdates(channel: IChannel, body: unknown): { ok: true; updates: Record<string, unknown> } | { ok: false; status: number; body: unknown } | null {
  if (!isForum(channel)) return null;
  const planned = planForumPatch(body, { type: String(channel.type), flags: Number(channel.flags) || 0, availableTags: forumTags(channel) }, randomUUID);
  if (!planned) return null;
  if (!planned.ok) return { ok: false, status: 400, body: planned.error };
  return { ok: true, updates: planned.updates };
}

/** Thread branch of DELETE /channels/{id} (MANAGE_THREADS). null when not a thread. */
export async function deleteBotThread(botId: string, channelId: string, headers: Headers): Promise<Result | null> {
  const thread = await loadThread(channelId);
  if (!thread) return null;
  const perms = await botPerms(botId, thread);
  if (!can(perms, P.MANAGE_THREADS)) return { status: 403, body: MISSING_PERMISSIONS };
  // Who could see it, for THREAD_DELETE once the row is gone.
  const { captureChannelViewers } = await import('@/lib/services/guildGatewayEvents');
  const viewersBefore = thread.serverId ? await captureChannelViewers(thread.serverId, [thread.id]) : undefined;
  await db.update(schema.messages).set({ isDeleted: true, deletedAt: new Date() }).where(eq(schema.messages.channelId, thread.id));
  await Channel.deleteById(thread.id);
  const { releaseThreadMessages, broadcastThreadUpdate, notifyThreadMembership } = await import('@/lib/services/threads');
  if (thread.parentId) {
    await releaseThreadMessages(thread.id, thread.parentId).catch(() => {});
    void broadcastThreadUpdate(thread, { deleted: true }).catch(() => null);
  }
  notifyThreadMembership(thread.serverId, thread.id, thread.threadMemberIds ?? []);
  const publisher = getPublisher();
  if (publisher) await publisher.publish('channel:delete', JSON.stringify({ channelId: thread.id, serverId: thread.serverId })).catch(() => {});
  const { emitThreadDelete } = await import('@/lib/services/gatewayEvents');
  void emitThreadDelete(thread, viewersBefore);
  if (thread.serverId) {
    audit({
      serverId: thread.serverId,
      userId: botId,
      actionType: AuditLogEvent.THREAD_DELETE,
      targetId: thread.id,
      changes: snapshotChanges(thread as Record<string, unknown>, { name: 'name', type: 'type', rateLimitPerUser: 'rate_limit_per_user' }, 'old'),
      options: { channel_name: thread.name, channel_type: thread.type },
      reason: auditReason(headers['x-audit-log-reason']),
    });
  }
  return { status: 200, body: toDiscordChannel(thread) };
}

// ─── Thread members ───────────────────────────────────────────────────────────

async function everyoneRoleId(serverId: string): Promise<string | null> {
  const roles = await Role.find({ serverId }).catch(() => []);
  return (roles as Array<{ id: string; isDefault?: boolean | null }>).find((r) => r.isDefault)?.id ?? null;
}

async function memberObjects(serverId: string, userIds: string[]): Promise<Map<string, unknown>> {
  if (userIds.length === 0) return new Map();
  const [members, users, everyone] = await Promise.all([
    ServerMember.find({ serverId, userId: { in: userIds } }).catch(() => []),
    User.find({ id: { in: userIds } }).catch(() => []),
    everyoneRoleId(serverId),
  ]);
  const userBy = new Map(users.map((u) => [u.id.toLowerCase(), u]));
  return new Map(members.map((m) => [m.userId.toLowerCase(), toDiscordGuildMember(m, userBy.get(m.userId.toLowerCase()) ?? { id: m.userId }, everyone)]));
}

/** GET /channels/{thread}/thread-members (needs the GUILD_MEMBERS intent, checked by the route). */
export async function listBotThreadMembers(channelId: string, q: { withMember: boolean; after?: string | null; limit?: unknown }): Promise<Result> {
  const thread = await loadThread(channelId);
  if (!thread) return { status: 400, body: WRONG_CHANNEL_TYPE };
  const limit = threadListLimit(q.limit, 100, 100);
  const ids = pageThreadMemberIds(thread.threadMemberIds ?? [], { after: q.after ?? null, limit });
  const members = q.withMember && thread.serverId ? await memberObjects(thread.serverId, ids) : new Map();
  return { status: 200, body: ids.map((id) => toDiscordThreadMember(thread, id, members.get(id))) };
}

/** GET /channels/{thread}/thread-members/{user}. */
export async function getBotThreadMember(channelId: string, userId: string, withMember: boolean): Promise<Result> {
  const thread = await loadThread(channelId);
  if (!thread) return { status: 400, body: WRONG_CHANNEL_TYPE };
  const id = (thread.threadMemberIds ?? []).find((m) => same(m, userId));
  if (!id) return { status: 404, body: UNKNOWN_MEMBER };
  const members = withMember && thread.serverId ? await memberObjects(thread.serverId, [id]) : new Map();
  return { status: 200, body: toDiscordThreadMember(thread, id, members.get(id.toLowerCase())) };
}

/** PUT /channels/{thread}/thread-members/@me and /{user}. */
export async function addBotThreadMember(botId: string, channelId: string, userId: string): Promise<Result> {
  const thread = await loadThread(channelId);
  if (!thread || !thread.serverId) return { status: 400, body: WRONG_CHANNEL_TYPE };
  if (thread.archived) return { status: 400, body: THREAD_ARCHIVED };
  const self = same(userId, botId);
  if (!self) {
    const perms = await botPerms(botId, thread);
    const mod = can(perms, P.MANAGE_THREADS);
    if (!can(perms, P.SEND_MESSAGES_IN_THREADS)) return { status: 403, body: MISSING_PERMISSIONS };
    if (thread.locked && !mod) return { status: 403, body: MISSING_PERMISSIONS };
    if (thread.type === 'private_thread' && !mod) {
      // Private threads: only someone inside may invite, and only when the thread allows it.
      if (!isMemberOf(thread, botId) && !same(thread.ownerId, botId)) return { status: 403, body: MISSING_ACCESS };
      if (thread.threadInvitable === false) return { status: 403, body: MISSING_PERMISSIONS };
    }
    if (!isValidObjectId(userId)) return { status: 404, body: UNKNOWN_MEMBER };
    const member = await ServerMember.findOne({ serverId: thread.serverId, userId });
    if (!member) return { status: 404, body: UNKNOWN_MEMBER };
    // They must be able to open the parent channel at all.
    if (thread.parentId) {
      const { checkChannelAccess } = await import('@/lib/api/channels');
      const access = await checkChannelAccess(userId, thread.parentId, { lean: true }).catch(() => ({ hasAccess: false }));
      if (!access.hasAccess) return { status: 403, body: MISSING_ACCESS };
    }
  }
  const { addThreadMembers, broadcastThreadUpdate, notifyThreadMembership } = await import('@/lib/services/threads');
  const joined = await addThreadMembers(thread.id, [userId]);
  if (joined.length) {
    notifyThreadMembership(thread.serverId, thread.id, joined);
    const updated = await Channel.findById(thread.id);
    if (updated) void broadcastThreadUpdate(updated).catch(() => null);
  }
  return { status: 204, body: '' };
}

/** DELETE /channels/{thread}/thread-members/@me and /{user}. */
export async function removeBotThreadMember(botId: string, channelId: string, userId: string): Promise<Result> {
  const thread = await loadThread(channelId);
  if (!thread || !thread.serverId) return { status: 400, body: WRONG_CHANNEL_TYPE };
  if (thread.archived) return { status: 400, body: THREAD_ARCHIVED };
  if (!same(userId, botId)) {
    const perms = await botPerms(botId, thread);
    const allowed = can(perms, P.MANAGE_THREADS) || (thread.type === 'private_thread' && same(thread.ownerId, botId));
    if (!allowed) return { status: 403, body: MISSING_PERMISSIONS };
    if (!isMemberOf(thread, userId)) return { status: 404, body: UNKNOWN_MEMBER };
  }
  const { removeThreadMember, broadcastThreadUpdate, notifyThreadMembership } = await import('@/lib/services/threads');
  if (await removeThreadMember(thread.id, userId)) {
    notifyThreadMembership(thread.serverId, thread.id, [userId]);
    const updated = await Channel.findById(thread.id);
    if (updated) void broadcastThreadUpdate(updated).catch(() => null);
  }
  return { status: 204, body: '' };
}

// ─── Listings ─────────────────────────────────────────────────────────────────

const ownMembers = (threads: IChannel[], botId: string) =>
  threads.filter((t) => isMemberOf(t, botId)).map((t) => toDiscordThreadMember(t, botId));

export type ArchivedKind = 'public' | 'private' | 'joined';

/**
 * GET /channels/{id}/threads/archived/public|private and
 * /channels/{id}/users/@me/threads/archived/private. READ_MESSAGE_HISTORY;
 * all private ones also need MANAGE_THREADS. Newest archive first (joined
 * private: newest thread first), `before` = ISO timestamp (joined: a thread id).
 */
export async function listArchivedThreads(botId: string, channelId: string, kind: ArchivedKind, q: { before?: unknown; limit?: unknown }): Promise<Result> {
  const parent = isValidObjectId(channelId) ? await Channel.findById(channelId) : null;
  if (!parent || !parent.serverId) return { status: 404, body: UNKNOWN_CHANNEL };
  if (isThread(parent) || (!isForum(parent) && !canHostThreads(parent.type))) return { status: 400, body: WRONG_CHANNEL_TYPE };
  const perms = await botPerms(botId, parent);
  if (!can(perms, P.READ_MESSAGE_HISTORY)) return { status: 403, body: MISSING_ACCESS };
  if (kind === 'private' && !can(perms, P.MANAGE_THREADS)) return { status: 403, body: MISSING_PERMISSIONS };
  const limit = threadListLimit(q.limit, 50, 100);

  const c = schema.channels;
  const order = kind === 'joined' ? c.createdAt : sql`coalesce(${c.archiveTimestamp}, ${c.createdAt})`;
  const conds = [
    eq(c.parentId, parent.id),
    eq(c.archived, true),
    inArray(c.type, [kind === 'public' ? 'public_thread' : 'private_thread']),
  ];
  if (kind === 'joined') conds.push(sql`${botId}::uuid = ANY(coalesce(${c.threadMemberIds}, '{}'::uuid[]))`);
  let beforeAt: Date | null = null;
  if (q.before !== undefined && q.before !== null && q.before !== '') {
    if (kind === 'joined') {
      const ref = isValidObjectId(String(q.before)) ? await Channel.findById(String(q.before)) : null;
      beforeAt = ref?.createdAt ? new Date(ref.createdAt) : null;
      if (!ref) return { status: 400, body: { code: 50035, message: 'Invalid Form Body', errors: { before: { _errors: [{ code: 'SNOWFLAKE_TYPE_INVALID', message: 'Value is not snowflake.' }] } } } };
    } else {
      const t = parseBeforeTimestamp(q.before);
      if (t !== null && Number.isNaN(t)) return { status: 400, body: { code: 50035, message: 'Invalid Form Body', errors: { before: { _errors: [{ code: 'DATE_TYPE_PARSE', message: 'Could not parse date.' }] } } } };
      beforeAt = t !== null ? new Date(t) : null;
    }
  }
  if (beforeAt) conds.push(sql`${order} < ${beforeAt}`);
  const rows = await db.select().from(c).where(and(...conds)).orderBy(desc(order), desc(c.id)).limit(limit + 1);
  // Same visibility as everywhere else (private threads: member, owner,
  // ticket-access role or server-wide MANAGE_THREADS), on top of the
  // channel-level MANAGE_THREADS Discord asks for.
  const { listViewableServerChannels } = await import('@/lib/api/channels');
  const visible = new Set(((await listViewableServerChannels(botId, parent.serverId)) ?? []).map((t) => t.id.toLowerCase()));
  const page = (rows.slice(0, limit) as IChannel[]).filter((t) => visible.has(t.id.toLowerCase()));
  return { status: 200, body: { threads: page.map((t) => toDiscordChannel(t)), members: ownMembers(page, botId), has_more: rows.length > limit } };
}

/**
 * GET /channels/{id}/threads/search (forum / media / text channels): the
 * threads of the channel the bot can view, filtered by name words, tags and
 * archive state, sorted and paged with limit (1-25) / offset.
 */
export async function searchBotThreads(botId: string, channelId: string, q: Record<string, string | undefined>): Promise<Result> {
  const parent = isValidObjectId(channelId) ? await Channel.findById(channelId) : null;
  if (!parent || !parent.serverId) return { status: 404, body: UNKNOWN_CHANNEL };
  if (isThread(parent) || (!isForum(parent) && !canHostThreads(parent.type))) return { status: 400, body: WRONG_CHANNEL_TYPE };
  const perms = await botPerms(botId, parent);
  if (!can(perms, P.READ_MESSAGE_HISTORY)) return { status: 403, body: MISSING_ACCESS };
  const { listViewableServerChannels } = await import('@/lib/api/channels');
  const visible = (await listViewableServerChannels(botId, parent.serverId)) ?? [];
  const limit = threadListLimit(q.limit, 25, 25);
  const offset = Math.max(0, Math.min(9975, Math.floor(Number(q.offset) || 0)));
  const plan = threadSearchPlan(q);
  const all = visible.filter((t) => isThread(t) && same(t.parentId, parent.id));
  const matched = filterAndSortThreads(all, plan);
  const page = matched.slice(offset, offset + limit);
  return {
    status: 200,
    body: {
      threads: page.map((t) => toDiscordChannel(t)),
      members: ownMembers(page, botId),
      has_more: matched.length > offset + limit,
      total_results: matched.length,
    },
  };
}

/** GET /guilds/{id}/threads/active: every unarchived thread the bot can view, plus its own thread members. */
export async function listActiveGuildThreads(botId: string, guildId: string): Promise<Result> {
  const { listViewableServerChannels } = await import('@/lib/api/channels');
  const visible = await listViewableServerChannels(botId, guildId);
  if (!visible) return { status: 403, body: MISSING_ACCESS };
  const threads = visible.filter((t) => isThread(t) && !t.archived);
  return { status: 200, body: { threads: threads.map((t) => toDiscordChannel(t)), members: ownMembers(threads, botId) } };
}
