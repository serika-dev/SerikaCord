// Group DM routes, mounted at /api/group-dms. A group conversation is addressed
// by its channel id (1:1 DMs are addressed by the other person's id under
// /api/dms); once the channel is resolved and membership checked, messages,
// reactions, pins and the stream go through the same helpers as 1:1 DMs.
//
//   POST   /group-dms                              create (friends only, max 10)
//   GET    /group-dms/:channelId                   the group (members, owner, name, icon)
//   PATCH  /group-dms/:channelId                   rename (any member, like Discord)
//   POST   /group-dms/:channelId/icon              set icon (multipart `file`)
//   DELETE /group-dms/:channelId/icon              remove icon
//   PUT    /group-dms/:channelId/recipients        add friends { userIds }
//   DELETE /group-dms/:channelId/recipients/:userId remove a member (owner) / leave (self)
//   DELETE /group-dms/:channelId                   leave
//   …/messages, /stream, /typing, /pins           the conversation itself
import { Elysia, t } from 'elysia';
import { and, eq, sql } from 'drizzle-orm';
import { Message, ServerMember, User } from '@/lib/models';
import { db, schema } from '@/lib/db/postgres';
import { cache } from '@/lib/db';
import { config } from '@/lib/config';
import { authenticateRequest } from '@/lib/services/auth';
import { storage, keyFromUrl } from '@/lib/services/storage';
import { isOwnedMediaKey } from '@/lib/utils/ownedMedia';
import { checkRateLimit, getClientIP, encryptForStorage, rejectInvalidObjectIdParams, isValidObjectId } from '@/lib/security';
import {
  addDmReaction,
  checkDmDuplicateSpam,
  deleteDmMessage,
  DM_SEND_BODY,
  dmStreamError,
  dmStreamResponse,
  editDmMessage,
  emitDmListUpdate,
  listDmPins,
  loadDmMessagesPage,
  persistDmMessage,
  prepareDmSend,
  publishToDm,
  removeDmReaction,
  setDmPinned,
  suppressDmEmbeds,
} from '@/lib/api/dms';
import {
  isGroupOwner,
  membersWithout,
  nextGroupOwner,
  normalizeGroupName,
  planGroupAdd,
  planGroupCreate,
} from '@/lib/chat/groupDm';
import {
  broadcastGroupUpdate,
  groupNotifyInfo,
  loadGroupForMember,
  postGroupEvent,
  serializeGroup,
  type GroupChannel,
} from '@/lib/services/groupDms';

async function getAuth(headers: Record<string, string | undefined>, cookie: Record<string, { value?: unknown }>) {
  const authHeader = headers.authorization ?? null;
  const authToken = cookie.auth_token?.value;
  const cookies: Record<string, string> = {};
  if (typeof authToken === 'string') cookies.auth_token = authToken;
  return authenticateRequest(authHeader, cookies);
}

type Cookie = Record<string, { value?: unknown }>;

const NOT_FOUND = { error: 'Group DM not found' };

/** The user's friends, read fresh (the authenticated user is a cached copy). */
async function freshFriendIds(userId: string): Promise<string[]> {
  const fresh = await User.findById(userId).catch(() => null);
  return (fresh?.friends || []) as string[];
}

/**
 * Change a group's row under a per-group lock, so two people adding/removing
 * members at once can't overwrite each other's recipient list. `fn` gets the
 * current row (null when the group is gone) and returns the columns to set,
 * or null to leave it alone.
 */
async function updateGroupLocked(
  channelId: string,
  fn: (channel: GroupChannel) => Partial<typeof schema.channels.$inferInsert> | null | { error: string; status: number },
): Promise<{ before: GroupChannel; after: GroupChannel } | { error: string; status: number }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`gdm:${channelId.toLowerCase()}`}))`);
    const [row] = await tx.select().from(schema.channels).where(eq(schema.channels.id, channelId)).limit(1);
    if (!row || row.type !== 'group_dm') return { error: NOT_FOUND.error, status: 404 };
    const change = fn(row);
    if (!change) return { before: row, after: row };
    if ('error' in change && typeof change.error === 'string') return change as { error: string; status: number };
    const [after] = await tx.update(schema.channels)
      .set({ ...(change as Partial<typeof schema.channels.$inferInsert>), updatedAt: new Date() })
      .where(and(eq(schema.channels.id, channelId), eq(schema.channels.type, 'group_dm')))
      .returning();
    return { before: row, after };
  });
}

function isMember(channel: { recipientIds?: string[] | null }, userId: string) {
  return (channel.recipientIds || []).some((id) => id.toLowerCase() === userId.toLowerCase());
}

/** Remove `targetId` from the group as `actor` (themselves = leaving). */
async function removeMember(
  channelId: string,
  actor: NonNullable<Awaited<ReturnType<typeof getAuth>>['user']>,
  targetId: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const leaving = targetId.toLowerCase() === actor.id.toLowerCase();
  const result = await updateGroupLocked(channelId, (channel) => {
    if (!isMember(channel, actor.id)) return { error: NOT_FOUND.error, status: 404 };
    if (!isMember(channel, targetId)) return { error: 'That user is not in this group', status: 404 };
    if (!leaving && !isGroupOwner(channel, actor.id)) {
      return { error: 'Only the group owner can remove members', status: 403 };
    }
    const remaining = membersWithout(channel.recipientIds, targetId);
    return {
      recipientIds: remaining,
      ownerId: nextGroupOwner(channel.recipientIds, targetId, channel.ownerId || (channel.recipientIds || [])[0]),
    };
  });
  if ('error' in result) return { status: result.status, body: { error: result.error } };

  const target = leaving ? actor : await User.findById(targetId);
  void (async () => {
    if ((result.after.recipientIds || []).length > 0 && target) {
      await postGroupEvent(result.after, actor, 'recipient_remove', {
        target: { id: target.id, username: target.username, displayName: target.displayName, avatar: target.avatar },
      });
    }
    await broadcastGroupUpdate(result.after, [targetId]);
  })().catch((err) => console.error('[group-dm] remove member fan-out failed:', err));
  return { status: 200, body: { success: true } };
}

export const groupDmRoutes = new Elysia({ prefix: '/group-dms' })
  .onBeforeHandle(rejectInvalidObjectIdParams)
  // Create a group DM with some friends.
  .post('/', async ({ headers, cookie, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    const limit = await checkRateLimit('groupDmCreate', user.id);
    if (!limit.success) {
      set.status = 429;
      return { error: 'You are creating groups too quickly', retryAfter: limit.retryAfter };
    }
    if (body.recipientIds.some((id) => !isValidObjectId(id))) {
      set.status = 400;
      return { error: 'Invalid user id' };
    }

    const plan = planGroupCreate(user.id, body.recipientIds, await freshFriendIds(user.id));
    if (!plan.ok) {
      set.status = 400;
      return { error: plan.error };
    }
    const users = await User.find({ id: { in: plan.memberIds } });
    if (users.length !== plan.memberIds.length) {
      set.status = 400;
      return { error: 'Some of those users no longer exist' };
    }

    const [channel] = await db.insert(schema.channels).values({
      type: 'group_dm',
      name: normalizeGroupName(body.name),
      recipientIds: plan.memberIds,
      ownerId: user.id,
      position: 0,
    }).returning();

    // Shows up in everyone's DM list right away.
    const group = await broadcastGroupUpdate(channel);
    return { group };
  }, {
    body: t.Object({
      recipientIds: t.Array(t.String(), { maxItems: 20 }),
      name: t.Optional(t.String({ maxLength: 200 })),
    }),
  })
  // The group: members, owner, name, icon.
  .get('/:channelId', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    const channel = await loadGroupForMember(params.channelId, user.id);
    if (!channel) {
      set.status = 404;
      return NOT_FOUND;
    }
    return { group: await serializeGroup(channel) };
  }, { params: t.Object({ channelId: t.String() }) })
  // Rename (any member can, like Discord). An empty name goes back to the member list.
  .patch('/:channelId', async ({ headers, cookie, params, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    const limit = await checkRateLimit('groupDmManage', user.id);
    if (!limit.success) {
      set.status = 429;
      return { error: 'Slow down', retryAfter: limit.retryAfter };
    }
    const name = normalizeGroupName(body.name);
    const result = await updateGroupLocked(params.channelId, (channel) => {
      if (!isMember(channel, user.id)) return { error: NOT_FOUND.error, status: 404 };
      if ((channel.name || '') === name) return null;
      return { name };
    });
    if ('error' in result) {
      set.status = result.status;
      return { error: result.error };
    }
    if (result.before !== result.after) {
      await postGroupEvent(result.after, user, 'channel_name_change', { name });
      return { group: await broadcastGroupUpdate(result.after) };
    }
    return { group: await serializeGroup(result.after) };
  }, {
    params: t.Object({ channelId: t.String() }),
    body: t.Object({ name: t.Union([t.String({ maxLength: 200 }), t.Null()]) }),
  })
  // Set the group icon.
  .post('/:channelId/icon', async ({ headers, cookie, params, body, request, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    const channel = await loadGroupForMember(params.channelId, user.id);
    if (!channel) {
      set.status = 404;
      return NOT_FOUND;
    }
    const limit = await checkRateLimit('upload', `${user.id}:${getClientIP(request)}`);
    if (!limit.success) {
      set.status = 429;
      return { error: 'Upload rate limited', retryAfter: limit.retryAfter };
    }
    const { file } = body;
    if (!config.ALLOWED_IMAGE_TYPES.includes(file.type as typeof config.ALLOWED_IMAGE_TYPES[number])) {
      set.status = 400;
      return { error: 'Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.' };
    }
    if (file.size > config.MAX_AVATAR_SIZE) {
      set.status = 400;
      return { error: `File too large. Maximum size is ${config.MAX_AVATAR_SIZE / 1024 / 1024}MB.` };
    }
    const uploaded = await storage.uploadFromFormData(file, 'group-icons', { channelId: channel.id });
    const result = await updateGroupLocked(channel.id, (row) => (isMember(row, user.id) ? { icon: uploaded.url } : { error: NOT_FOUND.error, status: 404 }));
    if ('error' in result) {
      set.status = result.status;
      return { error: result.error };
    }
    cleanupOldIcon(result.before, uploaded.url);
    await postGroupEvent(result.after, user, 'channel_icon_change');
    return { group: await broadcastGroupUpdate(result.after) };
  }, {
    params: t.Object({ channelId: t.String() }),
    body: t.Object({ file: t.File() }),
  })
  // Remove the group icon.
  .delete('/:channelId/icon', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    const result = await updateGroupLocked(params.channelId, (row) => {
      if (!isMember(row, user.id)) return { error: NOT_FOUND.error, status: 404 };
      return row.icon ? { icon: null } : null;
    });
    if ('error' in result) {
      set.status = result.status;
      return { error: result.error };
    }
    if (result.before !== result.after) {
      cleanupOldIcon(result.before, '');
      await postGroupEvent(result.after, user, 'channel_icon_change');
      return { group: await broadcastGroupUpdate(result.after) };
    }
    return { group: await serializeGroup(result.after) };
  }, { params: t.Object({ channelId: t.String() }) })
  // Add friends to the group.
  .put('/:channelId/recipients', async ({ headers, cookie, params, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    const limit = await checkRateLimit('groupDmManage', user.id);
    if (!limit.success) {
      set.status = 429;
      return { error: 'Slow down', retryAfter: limit.retryAfter };
    }
    if (body.userIds.some((id) => !isValidObjectId(id))) {
      set.status = 400;
      return { error: 'Invalid user id' };
    }
    const friends = await freshFriendIds(user.id);
    let added: string[] = [];
    const result = await updateGroupLocked(params.channelId, (channel) => {
      if (!isMember(channel, user.id)) return { error: NOT_FOUND.error, status: 404 };
      const plan = planGroupAdd(channel.recipientIds, user.id, body.userIds, friends);
      if (!plan.ok) return { error: plan.error, status: 400 };
      added = plan.added;
      return { recipientIds: plan.memberIds };
    });
    if ('error' in result) {
      set.status = result.status;
      return { error: result.error };
    }
    const addedUsers = added.length ? await User.find({ id: { in: added } }) : [];
    for (const target of addedUsers) {
      await postGroupEvent(result.after, user, 'recipient_add', {
        target: { id: target.id, username: target.username, displayName: target.displayName, avatar: target.avatar },
      });
    }
    return { group: await broadcastGroupUpdate(result.after) };
  }, {
    params: t.Object({ channelId: t.String() }),
    body: t.Object({ userIds: t.Array(t.String(), { minItems: 1, maxItems: 20 }) }),
  })
  // Remove a member (owner only) — or yourself, which is leaving.
  .delete('/:channelId/recipients/:userId', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    const limit = await checkRateLimit('groupDmManage', user.id);
    if (!limit.success) {
      set.status = 429;
      return { error: 'Slow down', retryAfter: limit.retryAfter };
    }
    const reply = await removeMember(params.channelId, user, params.userId);
    set.status = reply.status;
    return reply.body;
  }, { params: t.Object({ channelId: t.String(), userId: t.String() }) })
  // Leave the group (ownership passes to the next member).
  .delete('/:channelId', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    const reply = await removeMember(params.channelId, user, user.id);
    set.status = reply.status;
    return reply.body;
  }, { params: t.Object({ channelId: t.String() }) })

  // ─── The conversation ──────────────────────────────────────────────────────
  .get('/:channelId/messages', async ({ headers, cookie, params, query, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    const cursorId = (query.before || query.after || query.around) as string | undefined;
    const [channel, cursorMsg] = await Promise.all([
      loadGroupForMember(params.channelId, user.id),
      cursorId && isValidObjectId(cursorId) ? Message.findById(cursorId) : Promise.resolve(null),
    ]);
    if (!channel) {
      set.status = 404;
      return NOT_FOUND;
    }
    return { messages: await loadDmMessagesPage(channel.id, query, cursorMsg, user.id), channelId: channel.id };
  }, { params: t.Object({ channelId: t.String() }) })
  .post('/:channelId/messages', async ({ headers, cookie, params, body, request, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    const rateLimit = await checkRateLimit('message', `${user.id}:${getClientIP(request)}`);
    if (!rateLimit.success) {
      set.status = 429;
      return { error: 'Too many messages', retryAfter: rateLimit.retryAfter };
    }
    const channel = await loadGroupForMember(params.channelId, user.id);
    if (!channel) {
      set.status = 404;
      return NOT_FOUND;
    }

    const preparedResult = await prepareDmSend(user, body);
    if ('error' in preparedResult) {
      set.status = preparedResult.error.status;
      return preparedResult.error.body;
    }
    const prepared = preparedResult.prepared;
    const [memberships, encryptedContent, spam] = await Promise.all([
      ServerMember.find({ userId: user.id }),
      encryptForStorage(prepared.sanitizedContent),
      checkDmDuplicateSpam(channel.id, user.id, prepared),
    ]);
    if (spam) {
      set.status = spam.status;
      return spam.body;
    }

    const { message, messageData } = await persistDmMessage(
      user,
      channel,
      prepared,
      encryptedContent,
      memberships.map((m) => m.serverId),
    );
    publishToDm(channel.id, { type: 'message', message: messageData });

    // Everyone's DM list moves the group up; the others get the badge and
    // notification (named after the group, opening the group page).
    void (async () => {
      const { signalDmMessage } = await import('@/lib/services/messageSignals');
      await signalDmMessage({
        channelId: channel.id,
        recipientIds: channel.recipientIds || [],
        messageId: message.id,
        authorId: user.id,
        authorName: user.displayName || user.username,
        authorAvatar: user.avatar ?? null,
        content: prepared.sanitizedContent,
        hasAttachments: prepared.attachments.length > 0,
        createdAt: message.createdAt,
        group: await groupNotifyInfo(channel),
        silent: prepared.silent,
      });
    })().catch(() => { /* best-effort */ });

    return messageData;
  }, {
    params: t.Object({ channelId: t.String() }),
    body: DM_SEND_BODY,
  })
  // Elysia fallback for the message stream (server.ts serves the raw fast path).
  .get('/:channelId/stream', async ({ headers, cookie, params }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Cookie);
    if (!user) return dmStreamError(authError || 'Unauthorized');
    const channel = await loadGroupForMember(params.channelId, user.id);
    if (!channel) return dmStreamError(NOT_FOUND.error);
    return dmStreamResponse(channel.id, { userId: user.id });
  }, { params: t.Object({ channelId: t.String() }) })
  .post('/:channelId/typing', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    const typingLimit = await checkRateLimit('typing', user.id);
    if (!typingLimit.success) return { success: true };
    const channel = await loadGroupForMember(params.channelId, user.id);
    if (!channel) return { success: true };
    await cache.setTyping(channel.id, user.id);
    publishToDm(channel.id, { type: 'typing', userId: user.id, username: user.username });
    emitDmListUpdate(channel.recipientIds || [], { type: 'typing', channelId: channel.id, userId: user.id, username: user.username });
    return { success: true };
  }, { params: t.Object({ channelId: t.String() }) })
  .patch('/:channelId/messages/:messageId', async ({ headers, cookie, params, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    const channel = await loadGroupForMember(params.channelId, user.id);
    if (!channel) {
      set.status = 404;
      return { error: 'Message not found' };
    }
    const reply = await editDmMessage(channel, user, params.messageId, body.content);
    set.status = reply.status;
    return reply.body;
  }, {
    params: t.Object({ channelId: t.String(), messageId: t.String() }),
    body: t.Object({ content: t.String({ maxLength: 4000 }) }),
  })
  .post('/:channelId/messages/:messageId/suppress-embeds', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    const channel = await loadGroupForMember(params.channelId, user.id);
    if (!channel) {
      set.status = 404;
      return { error: 'Message not found' };
    }
    const reply = await suppressDmEmbeds(channel, user, params.messageId);
    set.status = reply.status;
    return reply.body;
  }, { params: t.Object({ channelId: t.String(), messageId: t.String() }) })
  .delete('/:channelId/messages/:messageId', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    const channel = await loadGroupForMember(params.channelId, user.id);
    if (!channel) {
      set.status = 404;
      return { error: 'Message not found' };
    }
    const reply = await deleteDmMessage(channel, user, params.messageId);
    set.status = reply.status;
    return reply.body;
  }, { params: t.Object({ channelId: t.String(), messageId: t.String() }) })
  .put('/:channelId/messages/:messageId/reactions', async ({ headers, cookie, params, query, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    const channel = await loadGroupForMember(params.channelId, user.id);
    if (!channel) {
      set.status = 404;
      return { error: 'Message not found' };
    }
    const reply = await addDmReaction(channel, user, params.messageId, query.emoji);
    set.status = reply.status;
    return reply.body;
  }, {
    params: t.Object({ channelId: t.String(), messageId: t.String() }),
    query: t.Object({ emoji: t.String() }),
  })
  .delete('/:channelId/messages/:messageId/reactions', async ({ headers, cookie, params, query, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    const channel = await loadGroupForMember(params.channelId, user.id);
    if (!channel) {
      set.status = 404;
      return { error: 'Message not found' };
    }
    const reply = await removeDmReaction(channel, user, params.messageId, query.emoji);
    set.status = reply.status;
    return reply.body;
  }, {
    params: t.Object({ channelId: t.String(), messageId: t.String() }),
    query: t.Object({ emoji: t.String() }),
  })
  .get('/:channelId/pins', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    const channel = await loadGroupForMember(params.channelId, user.id);
    if (!channel) return { messages: [] };
    return { messages: await listDmPins(channel.id) };
  }, { params: t.Object({ channelId: t.String() }) })
  .put('/:channelId/messages/:messageId/pin', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    const channel = await loadGroupForMember(params.channelId, user.id);
    if (!channel) {
      set.status = 404;
      return { error: 'Message not found' };
    }
    const reply = await setDmPinned(channel, params.messageId, true);
    set.status = reply.status;
    return reply.body;
  }, { params: t.Object({ channelId: t.String(), messageId: t.String() }) })
  .delete('/:channelId/messages/:messageId/pin', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Cookie);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    const channel = await loadGroupForMember(params.channelId, user.id);
    if (!channel) {
      set.status = 404;
      return { error: 'Message not found' };
    }
    const reply = await setDmPinned(channel, params.messageId, false);
    set.status = reply.status;
    return reply.body;
  }, { params: t.Object({ channelId: t.String(), messageId: t.String() }) });

/** Best-effort delete of a replaced group icon (only our own group-icons/<id>/ objects). */
function cleanupOldIcon(channel: GroupChannel, newUrl: string) {
  const oldUrl = channel.icon;
  if (!oldUrl || oldUrl === newUrl) return;
  const key = keyFromUrl(oldUrl);
  if (!isOwnedMediaKey(key, `group-icons/${channel.id}/`)) return;
  void storage.delete(key).catch((e) => console.error('Failed to delete replaced group icon:', e));
}
