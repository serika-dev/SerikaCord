// Polls and message forwarding routes, mounted at /api.
//
//   POST /channels/:channelId/polls          create a poll in a server channel,
//   POST /dms/:recipientId/polls             a 1:1 DM (by the other person's id)
//   POST /group-dms/:channelId/polls         or a group DM (by channel id)
//   PUT  /polls/:messageId/votes             set my votes { answerIds } ([] removes)
//   POST /polls/:messageId/expire            end the poll now (its author)
//   GET  /polls/:messageId/answers/:answerId/voters   who voted for an answer
//   POST /messages/:messageId/forward        forward { targets: channelId[], note? }
//   GET  /messages/:messageId/forward-origin the jump link of a forward's original
//   GET  /users/@me/forward-targets          DMs, group DMs and channels you can post in
//
// Everything that posts goes through postConversationMessage(), which handles
// realtime, unread signals and the bot gateway the same way for every kind of
// conversation. Pure rules: lib/chat/polls.ts, lib/chat/forward.ts. Server
// logic: lib/services/messageExtras.ts.
import { Elysia, t } from 'elysia';
import { Channel, Message, Role, Server, ServerMember, User, type IChannel } from '@/lib/models';
import { authenticateRequest } from '@/lib/services/auth';
import { checkRateLimit, encryptForStorage, isValidObjectId, rejectInvalidObjectIdParams } from '@/lib/security';
import { normalizeEmojiFormat } from '@/lib/services/emoji';
import { isSystemUser } from '@/lib/services/systemUsers';
import { dmSendDenyReason } from '@/lib/chat/dmPolicy';
import { canStartDm } from '@/lib/chat/dmAccess';
import { getRolePermissions } from '@/lib/permissions/serverPermissions';
import { computeChannelPermissions, hasBit, type ChannelOverwrite } from '@/lib/permissions/channelOverwrites';
import { PERMISSION_BITS } from '@/lib/permissions/bits';
import {
  buildPollView,
  isPollClosed,
  normalizePollInput,
  parseStoredPoll,
  pollPreviewText,
  validateVote,
  type PollUpdateEvent,
  type StoredPoll,
} from '@/lib/chat/polls';
import {
  isForwardable,
  normalizeForwardNote,
  normalizeForwardTargets,
  parseStoredForward,
  type ForwardTarget,
  type StoredForward,
} from '@/lib/chat/forward';
import {
  finalizePoll,
  forwardViewFor,
  loadPollTallies,
  loadPollVoters,
  publishToConversation,
  replacePollVotes,
  resolveForwardOrigin,
  scheduleOpenPoll,
} from '@/lib/services/messageExtras';

type Cookie = Record<string, { value?: unknown }>;
type AuthUser = NonNullable<Awaited<ReturnType<typeof authenticateRequest>>['user']>;
type Membership = { roles?: string[] | null; nickname?: string | null; communicationDisabledUntil?: Date | null } | null;
type Fail = { status: number; error: string };

async function getAuth(headers: Record<string, string | undefined>, cookie: Cookie) {
  const authHeader = headers.authorization ?? null;
  const authToken = cookie.auth_token?.value;
  const cookies: Record<string, string> = {};
  if (typeof authToken === 'string') cookies.auth_token = authToken;
  return authenticateRequest(authHeader, cookies);
}

const POSTABLE_TYPES = new Set(['text', 'announcement', 'public_thread', 'private_thread', 'dm', 'group_dm']);
const sameId = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** A conversation the user may post in, after every send check. */
type Destination = { channel: IChannel; membership: Membership };

/**
 * Resolve a channel id (server channel, DM or group DM) the user wants to post
 * into, applying the same gates as the send routes: visibility, timeout,
 * SEND_MESSAGES (+ ATTACH_FILES when the post carries files) and, for 1:1 DMs,
 * blocks and DM privacy.
 */
async function resolveDestination(user: AuthUser, channelId: string, opts: { attach?: boolean } = {}): Promise<{ dest: Destination } | Fail> {
  if (!isValidObjectId(channelId)) return { status: 400, error: 'Invalid channel' };
  const { checkChannelAccess, checkCanSpeak, checkCanPostInChannel } = await import('@/lib/api/channels');
  const access = await checkChannelAccess(user.id, channelId);
  if (!access.hasAccess || !access.channel) return { status: 403, error: access.error || 'Access denied' };
  const channel = access.channel as IChannel;
  if (!POSTABLE_TYPES.has(String(channel.type))) return { status: 400, error: 'You cannot send messages here' };
  const membership = (access.membership ?? null) as Membership;
  if (channel.serverId) {
    const denial = await checkCanSpeak(channel as never, membership as never, user.id, opts.attach ? ['send', 'attach'] : ['send']);
    if (denial) return { status: denial.status, error: String(denial.body.error ?? 'Forbidden') };
  }
  // SEND_MESSAGES was checked just above; this adds the DM block/privacy rules.
  const postDenied = await checkCanPostInChannel(channel, user, membership as never, { checkSendPermission: false });
  if (postDenied) return { status: postDenied.status, error: String(postDenied.body.error ?? 'Forbidden') };
  return { dest: { channel, membership } };
}

/** The 1:1 DM with `recipientId`, created if the DM may be started. */
async function resolveDmDestination(user: AuthUser, recipientId: string): Promise<{ dest: Destination } | Fail> {
  if (!isValidObjectId(recipientId)) return { status: 400, error: 'Invalid recipient ID' };
  const recipient = await User.findById(recipientId);
  if (!recipient) return { status: 404, error: 'User not found' };
  const denied = dmSendDenyReason(user, recipient, { recipientIsSystem: isSystemUser(recipient.id) });
  if (denied) return { status: 403, error: denied };
  const { findDMChannel, getOrCreateDMChannel } = await import('@/lib/api/dms');
  let channel = await findDMChannel(user.id, recipientId);
  if (!channel) {
    const recipientIsSystem = Boolean(recipient.isSystem) || isSystemUser(recipient.id);
    if (!canStartDm(user, recipient, recipientIsSystem)) return { status: 403, error: 'You cannot message this user' };
    channel = await getOrCreateDMChannel(user.id, recipientId);
  }
  return { dest: { channel: channel as IChannel, membership: null } };
}

async function messageRateLimit(user: AuthUser, channelId: string): Promise<Fail | null> {
  const [perChannel, global] = await Promise.all([
    checkRateLimit('message', `${user.id}:${channelId}`),
    checkRateLimit('messageGlobal', user.id),
  ]);
  if (!perChannel.success || !global.success) return { status: 429, error: 'You are sending messages too quickly' };
  return null;
}

/**
 * Store a message from `user` in `dest` and deliver it: stream event, read
 * marker for the sender, unread badges / notifications for everyone else and
 * the bot gateway. `extras` is merged into the client payload (poll view,
 * forward view) and `preview` is the notification text.
 */
async function postConversationMessage(
  user: AuthUser,
  dest: Destination,
  row: { content?: string; poll?: StoredPoll; messageSnapshot?: StoredForward },
  extras: Record<string, unknown>,
  preview: string,
) {
  const { channel, membership } = dest;
  const content = row.content ?? '';
  const message = await Message.create({
    channelId: channel.id,
    serverId: channel.serverId ?? null,
    authorId: user.id,
    content: content ? await encryptForStorage(content) : '',
    type: 'default',
    attachments: [],
    ...(row.poll ? { poll: row.poll } : {}),
    ...(row.messageSnapshot ? { messageSnapshot: row.messageSnapshot } : {}),
  });
  void Channel.updateById(channel.id, { lastMessageId: message.id }).catch(() => {});

  let isOwner = false;
  if (channel.serverId) {
    const { getServerOwnerIdCached } = await import('@/lib/api/channels');
    isOwner = sameId(await getServerOwnerIdCached(channel.serverId).catch(() => null), user.id);
  }
  const authorName = membership?.nickname || user.displayName || user.username;
  const payload = {
    id: message.id,
    content,
    authorId: user.id,
    author: {
      id: user.id,
      username: user.username,
      displayName: authorName,
      avatar: user.avatar,
      status: user.status,
      badges: user.badges || [],
      isOwner,
      isPremium: user.isPremium,
      isSystem: user.isSystem || false,
      isBot: Boolean(user.isBot),
      isVerified: Boolean(user.isVerified),
      customization: user.customization || null,
    },
    channelId: channel.id,
    serverId: channel.serverId ?? null,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    type: 'default',
    attachments: [],
    embeds: [],
    reactions: [],
    pinned: false,
    mentionEveryone: false,
    mentionedUserIds: [],
    mentionedRoleIds: [],
    mentionedChannelIds: [],
    ...extras,
  };

  await publishToConversation(channel, { type: 'message', message: payload });

  void import('@/lib/api/activity')
    .then(({ ackOwnMessage }) => ackOwnMessage(user.id, channel.id, message.id, message.createdAt))
    .catch(() => {});

  void (async () => {
    const { signalChannelMessage, signalDmMessage } = await import('@/lib/services/messageSignals');
    if (channel.serverId) {
      await signalChannelMessage({
        channel,
        messageId: message.id,
        authorId: user.id,
        authorName,
        authorAvatar: user.avatar ?? null,
        content: preview,
        createdAt: message.createdAt,
      });
    } else {
      let group = null;
      if (channel.type === 'group_dm') {
        const { groupNotifyInfo } = await import('@/lib/services/groupDms');
        group = await groupNotifyInfo(channel).catch(() => null);
      }
      await signalDmMessage({
        channelId: channel.id,
        recipientIds: (channel.recipientIds || []) as string[],
        messageId: message.id,
        authorId: user.id,
        authorName,
        authorAvatar: user.avatar ?? null,
        content: preview,
        createdAt: message.createdAt,
        group,
      });
    }
  })().catch(() => {});

  void import('@/lib/services/gatewayEvents')
    .then(({ emitMessageCreate }) => emitMessageCreate(payload as never))
    .catch(() => {});

  return { message, payload };
}

/** A plain text message (the note under a forward). Content is sanitized here. */
async function postNote(user: AuthUser, dest: Destination, note: string) {
  const { sanitizeMessageContent } = await import('@/lib/api/channels');
  const content = normalizeEmojiFormat(sanitizeMessageContent(note));
  if (!content.trim()) return null;
  return postConversationMessage(user, dest, { content }, {}, content.slice(0, 200));
}

async function createPoll(user: AuthUser, destResult: { dest: Destination } | Fail, body: Record<string, unknown>) {
  if ('error' in destResult) return destResult;
  const { dest } = destResult;
  const limited = await messageRateLimit(user, dest.channel.id);
  if (limited) return limited;
  const parsed = normalizePollInput(body);
  if ('error' in parsed) return { status: 400, error: parsed.error };
  const { poll } = parsed;
  const view = buildPollView(poll, {}, 0, []);
  const { payload, message } = await postConversationMessage(user, dest, { poll }, { poll: view }, pollPreviewText(poll.question));
  void scheduleOpenPoll(message.id, poll.expiresAt);
  return { body: payload };
}

const POLL_BODY = t.Object({
  question: t.String({ maxLength: 1000 }),
  answers: t.Array(t.Object({
    text: t.String({ maxLength: 300 }),
    emoji: t.Optional(t.Union([t.Null(), t.Object({
      id: t.Optional(t.String({ maxLength: 64 })),
      name: t.String({ maxLength: 64 }),
      animated: t.Optional(t.Boolean()),
      url: t.Optional(t.String({ maxLength: 512 })),
    })])),
  }), { maxItems: 20 }),
  durationHours: t.Optional(t.Number()),
  allowMultiselect: t.Optional(t.Boolean()),
});

/** Load a poll message the user can see. */
async function loadPollForViewer(user: AuthUser, messageId: string) {
  const row = await Message.findById(messageId);
  if (!row || row.isDeleted) return { status: 404, error: 'Poll not found' } as Fail;
  const poll = parseStoredPoll(row.poll);
  if (!poll || row.type === 'poll_result') return { status: 404, error: 'Poll not found' } as Fail;
  const { checkChannelAccess } = await import('@/lib/api/channels');
  const access = await checkChannelAccess(user.id, row.channelId);
  if (!access.hasAccess || !access.channel) return { status: 403, error: access.error || 'Access denied' } as Fail;
  return { row, poll, channel: access.channel as IChannel, membership: (access.membership ?? null) as Membership };
}

// ─── Forward targets ──────────────────────────────────────────────────────────
const MAX_DM_TARGETS = 40;
const MAX_CHANNEL_TARGETS = 300;

async function listForwardTargets(user: AuthUser): Promise<ForwardTarget[]> {
  const out: ForwardTarget[] = [];

  // Recent DMs and group DMs, newest first.
  const dmChannels = (await Channel.find({ recipientId: user.id, type: { in: ['dm', 'group_dm'] } }))
    .sort((a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime())
    .slice(0, MAX_DM_TARGETS);
  const otherIds = new Set<string>();
  for (const c of dmChannels) for (const id of c.recipientIds || []) if (!sameId(id, user.id)) otherIds.add(id);
  const people = otherIds.size ? await User.find({ id: { in: [...otherIds] } }) : [];
  const personById = new Map(people.map((u) => [u.id.toLowerCase(), u]));
  for (const c of dmChannels) {
    const others = (c.recipientIds || []).filter((id) => !sameId(id, user.id));
    if (c.type === 'dm') {
      const other = others[0] ? personById.get(others[0].toLowerCase()) : null;
      if (!other) continue;
      // Skip DMs you can no longer post in (blocked / privacy).
      if (dmSendDenyReason(user, other, { recipientIsSystem: isSystemUser(other.id) })) continue;
      out.push({ id: c.id, kind: 'dm', name: other.displayName || other.username, username: other.username, icon: other.avatar ?? null, recipientId: other.id });
    } else {
      const names = others.map((id) => personById.get(id.toLowerCase())).filter(Boolean).map((u) => u!.displayName || u!.username);
      out.push({ id: c.id, kind: 'group_dm', name: c.name || names.join(', ') || 'Group', icon: (c as { icon?: string | null }).icon ?? null });
    }
  }

  // Server text channels where you can view and send.
  const memberships = await ServerMember.find({ userId: user.id });
  if (memberships.length === 0) return out;
  const serverIds = memberships.map((m) => m.serverId);
  const [servers, channels, defaultRoles] = await Promise.all([
    Server.find({ id: { in: serverIds } }),
    Channel.find({ serverId: { in: serverIds }, type: { in: ['text', 'announcement'] } }),
    Role.find({ serverId: { in: serverIds }, isDefault: true }),
  ]);
  const serverById = new Map(servers.map((s) => [s.id, s]));
  const everyoneByServer = new Map(defaultRoles.map((r) => [r.serverId, r.id]));
  const memberByServer = new Map(memberships.map((m) => [m.serverId, m]));
  const permsByServer = new Map<string, { everyone: bigint | null; others: bigint[] } | 'owner'>();
  const now = Date.now();
  for (const serverId of serverIds) {
    const server = serverById.get(serverId);
    if (!server) continue;
    if (sameId(server.ownerId, user.id)) { permsByServer.set(serverId, 'owner'); continue; }
    const m = memberByServer.get(serverId);
    if (m?.communicationDisabledUntil && new Date(m.communicationDisabledUntil).getTime() > now) continue;
    const everyoneId = everyoneByServer.get(serverId) ?? null;
    const roleIds = [...new Set([...(everyoneId ? [everyoneId] : []), ...((m?.roles || []) as string[])])];
    const rolePerms = roleIds.length ? await getRolePermissions(roleIds, serverId) : new Map<string, bigint>();
    const others: bigint[] = [];
    for (const [id, p] of rolePerms) if (id !== everyoneId) others.push(p);
    permsByServer.set(serverId, { everyone: everyoneId ? (rolePerms.get(everyoneId) ?? null) : null, others });
  }
  const sorted = [...channels].sort((a, b) =>
    serverIds.indexOf(a.serverId!) - serverIds.indexOf(b.serverId!) || (a.position ?? 0) - (b.position ?? 0));
  let added = 0;
  for (const c of sorted) {
    if (added >= MAX_CHANNEL_TARGETS) break;
    const serverId = c.serverId!;
    const base = permsByServer.get(serverId);
    if (!base) continue;
    if (base !== 'owner') {
      const m = memberByServer.get(serverId);
      const perms = computeChannelPermissions({
        everyonePermissions: base.everyone,
        rolePermissions: base.others,
        overwrites: (c.permissionOverwrites || []) as ChannelOverwrite[],
        ctx: { serverId, everyoneRoleId: everyoneByServer.get(serverId) ?? null, memberRoleIds: (m?.roles || []) as string[], userId: user.id },
      });
      if (!hasBit(perms, PERMISSION_BITS.VIEW_CHANNEL) || !hasBit(perms, PERMISSION_BITS.SEND_MESSAGES)) continue;
    }
    const server = serverById.get(serverId);
    out.push({ id: c.id, kind: 'channel', name: c.name, serverId, serverName: server?.name ?? null, icon: server?.icon ?? null });
    added++;
  }
  return out;
}

export const messageExtrasRoutes = new Elysia()
  .onBeforeHandle(rejectInvalidObjectIdParams)
  // ─── Polls ─────────────────────────────────────────────────────────────────
  .post('/channels/:channelId/polls', async ({ headers, cookie, params, body, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const result = await createPoll(user, await resolveDestination(user, params.channelId), body);
    if ('error' in result) { set.status = result.status; return { error: result.error }; }
    return result.body;
  }, { params: t.Object({ channelId: t.String() }), body: POLL_BODY })
  .post('/dms/:recipientId/polls', async ({ headers, cookie, params, body, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const result = await createPoll(user, await resolveDmDestination(user, params.recipientId), body);
    if ('error' in result) { set.status = result.status; return { error: result.error }; }
    return result.body;
  }, { params: t.Object({ recipientId: t.String() }), body: POLL_BODY })
  .post('/group-dms/:channelId/polls', async ({ headers, cookie, params, body, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const resolved = await resolveDestination(user, params.channelId);
    const dest = 'dest' in resolved && resolved.dest.channel.type !== 'group_dm'
      ? ({ status: 404, error: 'Group DM not found' } as Fail)
      : resolved;
    const result = await createPoll(user, dest, body);
    if ('error' in result) { set.status = result.status; return { error: result.error }; }
    return result.body;
  }, { params: t.Object({ channelId: t.String() }), body: POLL_BODY })
  .put('/polls/:messageId/votes', async ({ headers, cookie, params, body, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const limit = await checkRateLimit('typing', `poll:${user.id}`);
    if (!limit.success) { set.status = 429; return { error: 'Slow down', retryAfter: limit.retryAfter }; }
    const loaded = await loadPollForViewer(user, params.messageId);
    if ('error' in loaded) { set.status = loaded.status; return { error: loaded.error }; }
    const { row, poll, channel, membership } = loaded;
    if (isPollClosed(poll)) {
      if (!poll.finalizedAt) void finalizePoll(row.id).catch(() => {});
      set.status = 400;
      return { error: 'This poll has ended' };
    }
    // Timed-out members can't vote (Discord treats a vote like speaking).
    const until = membership?.communicationDisabledUntil;
    if (channel.serverId && until && new Date(until).getTime() > Date.now()) {
      set.status = 403;
      return { error: 'You are timed out from this server' };
    }
    const vote = validateVote(poll, body.answerIds);
    if ('error' in vote) { set.status = 400; return { error: vote.error }; }
    const previous = await replacePollVotes(row.id, user.id, vote.answerIds);
    const tally = (await loadPollTallies([row.id], user.id)).get(row.id) ?? { counts: {}, totalVoters: 0, myVotes: [] };
    const update: PollUpdateEvent = {
      type: 'poll_update',
      messageId: row.id,
      counts: tally.counts,
      totalVoters: tally.totalVoters,
      userId: user.id,
      answerIds: vote.answerIds,
    };
    await publishToConversation(channel, update);
    void import('@/lib/services/gatewayEvents')
      .then(({ emitPollVoteChanges }) => emitPollVoteChanges({
        userId: user.id,
        channelId: channel.id,
        guildId: channel.serverId ?? null,
        messageId: row.id,
        previous,
        next: vote.answerIds,
      }))
      .catch(() => {});
    return { poll: buildPollView(poll, tally.counts, tally.totalVoters, tally.myVotes) };
  }, {
    params: t.Object({ messageId: t.String() }),
    body: t.Object({ answerIds: t.Array(t.Number(), { maxItems: 10 }) }),
  })
  .post('/polls/:messageId/expire', async ({ headers, cookie, params, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const loaded = await loadPollForViewer(user, params.messageId);
    if ('error' in loaded) { set.status = loaded.status; return { error: loaded.error }; }
    if (!sameId(loaded.row.authorId, user.id)) {
      set.status = 403;
      return { error: 'Only the poll author can end it early' };
    }
    if (loaded.poll.finalizedAt) return { success: true };
    await finalizePoll(loaded.row.id, { early: !isPollClosed(loaded.poll) });
    return { success: true };
  }, { params: t.Object({ messageId: t.String() }) })
  .get('/polls/:messageId/answers/:answerId/voters', async ({ headers, cookie, params, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const loaded = await loadPollForViewer(user, params.messageId);
    if ('error' in loaded) { set.status = loaded.status; return { error: loaded.error }; }
    const answerId = Number(params.answerId);
    if (!loaded.poll.answers.some((a) => a.id === answerId)) { set.status = 404; return { error: 'Answer not found' }; }
    return { users: await loadPollVoters(loaded.row.id, answerId) };
  }, { params: t.Object({ messageId: t.String(), answerId: t.String() }) })
  // ─── Forwarding ────────────────────────────────────────────────────────────
  .post('/messages/:messageId/forward', async ({ headers, cookie, params, body, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const targets = normalizeForwardTargets(body.targets);
    if ('error' in targets) { set.status = 400; return { error: targets.error }; }
    const note = normalizeForwardNote(body.note);

    const source = await Message.findById(params.messageId);
    if (!source || source.isDeleted) { set.status = 404; return { error: 'Message not found' }; }
    const { checkChannelAccess } = await import('@/lib/api/channels');
    const sourceAccess = await checkChannelAccess(user.id, source.channelId);
    if (!sourceAccess.hasAccess) { set.status = 403; return { error: 'You cannot see that message' }; }

    // Forwarding a forward passes the original along, like Discord.
    const inner = source.messageSnapshot ? parseStoredForward(source.messageSnapshot) : null;
    const forwardable = isForwardable({
      id: source.id,
      type: source.type as never,
      content: source.content ? 'x' : '',
      attachments: (source.attachments || []) as never,
      embeds: (source.embeds || []) as never,
      sticker: (source.sticker || undefined) as never,
      poll: source.poll ? ({} as never) : null,
      forward: inner ? ({} as never) : null,
    });
    if (!forwardable) { set.status = 400; return { error: 'This message cannot be forwarded' }; }

    let snapshot: StoredForward;
    if (inner) {
      snapshot = inner;
    } else {
      const author = await User.findById(source.authorId).catch(() => null);
      snapshot = {
        messageId: source.id,
        channelId: source.channelId,
        serverId: source.serverId ?? null,
        authorId: source.authorId,
        author: author ? { id: author.id, username: author.username, displayName: author.displayName || author.username, avatar: author.avatar ?? null } : null,
        // Copied still encrypted: same key, never decrypted on this path.
        content: source.content || '',
        attachments: (Array.isArray(source.attachments) ? source.attachments : []) as StoredForward['attachments'],
        embeds: (Array.isArray(source.embeds) && !source.suppressEmbeds ? source.embeds : []) as StoredForward['embeds'],
        sticker: (source.sticker || null) as StoredForward['sticker'],
        createdAt: new Date(source.createdAt ?? Date.now()).toISOString(),
        edited: Boolean(source.edited),
      };
    }

    const global = await checkRateLimit('messageGlobal', user.id);
    if (!global.success) { set.status = 429; return { error: 'You are sending messages too quickly', retryAfter: global.retryAfter }; }

    // Resolve every destination first so one bad pick doesn't half-send.
    const resolved = await Promise.all(targets.targets.map((id) =>
      resolveDestination(user, id, { attach: snapshot.attachments.length > 0 })));
    const failed = resolved
      .map((r, i) => ('error' in r ? { channelId: targets.targets[i], error: r.error } : null))
      .filter(Boolean);
    if (failed.length === resolved.length) {
      set.status = (resolved[0] as Fail).status;
      return { error: (resolved[0] as Fail).error, failed };
    }

    // Same view for every destination; the origin is resolved per viewer later.
    const view = await forwardViewFor(snapshot, null);
    const forwarded: Array<{ channelId: string; messageId: string }> = [];
    for (const r of resolved) {
      if ('error' in r) continue;
      const { message } = await postConversationMessage(
        user,
        r.dest,
        { messageSnapshot: snapshot },
        { forward: view },
        view.content ? view.content.slice(0, 200) : '↪',
      );
      forwarded.push({ channelId: r.dest.channel.id, messageId: message.id });
      if (note) await postNote(user, r.dest, note).catch(() => null);
    }
    return { forwarded, failed };
  }, {
    params: t.Object({ messageId: t.String() }),
    body: t.Object({
      targets: t.Array(t.String({ maxLength: 64 }), { maxItems: 10 }),
      note: t.Optional(t.String({ maxLength: 4000 })),
    }),
  })
  .get('/messages/:messageId/forward-origin', async ({ headers, cookie, params, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const row = await Message.findById(params.messageId);
    const stored = row && !row.isDeleted ? parseStoredForward(row.messageSnapshot) : null;
    if (!row || !stored) { set.status = 404; return { error: 'Message not found' }; }
    const { checkChannelAccess } = await import('@/lib/api/channels');
    const access = await checkChannelAccess(user.id, row.channelId);
    if (!access.hasAccess) { set.status = 403; return { error: 'Access denied' }; }
    return { origin: await resolveForwardOrigin(user.id, stored) };
  }, { params: t.Object({ messageId: t.String() }) })
  .get('/users/@me/forward-targets', async ({ headers, cookie, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    return { targets: await listForwardTargets(user) };
  });
