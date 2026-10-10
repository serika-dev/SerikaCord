// Server side of group DMs: the boot-time schema ensure, the shape clients get
// for a group, the system rows ("X added Y to the group.") and the live
// updates that keep every member's DM list, open conversation and call panel
// in step. Routes live in src/lib/api/groupDms.ts.
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/postgres';
import { Channel, Message, User } from '@/lib/models';
import { encryptForStorage } from '@/lib/security';
import { groupDisplayName } from '@/lib/chat/dmCall';
import { groupEventPreview, isGroupOwner, type GroupDmEventType } from '@/lib/chat/groupDm';

// ─── Boot-time schema ensure ──────────────────────────────────────────────────
// Mirrors drizzle/manual_group_dms.sql. Additive + idempotent. ADD VALUE can't
// share a transaction with its first use, so each statement runs alone; the
// column add never waits long behind a lock on the shared channels table.
const g = globalThis as unknown as { __groupDmSchema?: Promise<void> | null };

export function ensureGroupDmSchema(): Promise<void> {
  if (g.__groupDmSchema) return g.__groupDmSchema;
  g.__groupDmSchema = (async () => {
    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        await db.execute(sql`ALTER TYPE message_type ADD VALUE IF NOT EXISTS 'recipient_add'`);
        await db.execute(sql`ALTER TYPE message_type ADD VALUE IF NOT EXISTS 'recipient_remove'`);
        await db.execute(sql`ALTER TYPE message_type ADD VALUE IF NOT EXISTS 'channel_name_change'`);
        await db.execute(sql`ALTER TYPE message_type ADD VALUE IF NOT EXISTS 'channel_icon_change'`);
        await db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
          await tx.execute(sql`ALTER TABLE channels ADD COLUMN IF NOT EXISTS icon text`);
        });
        return;
      } catch (err) {
        console.error(`[group-dm] Ensuring group DM schema failed (attempt ${attempt}):`, (err as Error)?.message ?? err);
        await new Promise((r) => setTimeout(r, Math.min(30_000, 2_000 * attempt)));
      }
    }
    g.__groupDmSchema = null;
  })();
  return g.__groupDmSchema;
}

// ─── Loading + shaping ────────────────────────────────────────────────────────
export type GroupChannel = NonNullable<Awaited<ReturnType<typeof Channel.findById>>>;

const sameId = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** The group DM `channelId` if `userId` is one of its members, else null. */
export async function loadGroupForMember(channelId: string, userId: string): Promise<GroupChannel | null> {
  const channel = await Channel.findById(channelId);
  if (!channel || channel.type !== 'group_dm') return null;
  if (!(channel.recipientIds || []).some((id) => sameId(id, userId))) return null;
  return channel;
}

type PublicUser = Awaited<ReturnType<typeof User.find>>[number];

function publicMember(u: PublicUser) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    avatar: u.avatar,
    status: (u.status === 'invisible' ? 'offline' : u.status) ?? 'offline',
    customStatus: u.customStatus,
    isPremium: u.isPremium,
    isSystem: u.isSystem || false,
    isBot: Boolean(u.isBot),
    isVerified: Boolean(u.isVerified),
    badges: u.badges || [],
    customization: u.customization || null,
  };
}

/** The group as clients see it: every member (you included), owner, name, icon. */
export async function serializeGroup(channel: GroupChannel) {
  const ids = channel.recipientIds || [];
  const users = ids.length ? await User.find({ id: { in: ids } }) : [];
  const byId = new Map(users.map((u) => [u.id.toLowerCase(), u]));
  const { resolveEffectiveStatus } = await import('@/lib/services/presence');
  const members = ids
    .map((id) => byId.get(id.toLowerCase()))
    .filter((u): u is PublicUser => Boolean(u))
    .map((u) => ({
      ...publicMember(u),
      status: resolveEffectiveStatus({ status: u.status, presenceLastHeartbeatAt: u.presenceLastHeartbeatAt ?? null, isSystem: u.isSystem }),
    }));
  const ownerId = channel.ownerId || ids[0] || null;
  return {
    id: channel.id,
    type: 'group_dm' as const,
    name: channel.name || null,
    icon: (channel as { icon?: string | null }).icon ?? null,
    ownerId,
    members,
    memberCount: ids.length,
    lastMessageId: channel.lastMessageId,
    updatedAt: channel.updatedAt,
  };
}

export type SerializedGroup = Awaited<ReturnType<typeof serializeGroup>>;

/** Display name of a group for notifications / previews ("Alice, Bob, Carol"). */
export function serializedGroupName(group: SerializedGroup, viewerId?: string): string {
  const names = group.members
    .filter((m) => !viewerId || !sameId(m.id, viewerId))
    .map((m) => m.displayName || m.username);
  return groupDisplayName(group.name, names);
}

// ─── Live updates ─────────────────────────────────────────────────────────────

/**
 * Push the group's new state to everyone in it (and to `formerMemberIds`, who
 * drop it from their list): their DM list (`group:update` on the DM-list
 * stream) and the open conversation (`group_update` on the message stream).
 */
export async function broadcastGroupUpdate(channel: GroupChannel, formerMemberIds: string[] = []) {
  const group = await serializeGroup(channel);
  const { emitDmListUpdate, publishToDm, revokeDmStreams } = await import('@/lib/api/dms');
  emitDmListUpdate(channel.recipientIds || [], { type: 'group:update', channelId: channel.id, group });
  publishToDm(channel.id, { type: 'group_update', group });
  if (formerMemberIds.length) {
    emitDmListUpdate(formerMemberIds, { type: 'group:remove', channelId: channel.id });
    const { removeFromGroupCall } = await import('@/lib/api/voice');
    for (const userId of formerMemberIds) {
      // Tell their open conversation first, then cut the stream and the call.
      revokeDmStreams(channel.id, userId);
      removeFromGroupCall(channel.id, userId);
    }
  }
  return group;
}

type Actor = { id: string; username: string; displayName?: string | null; avatar?: string | null; badges?: string[] | null; customization?: unknown };

/**
 * Leave a system row in the group's history ("X added Y to the group.") and
 * deliver it like any other message: the open conversation, every member's
 * DM list, and unread badges for the others.
 */
export async function postGroupEvent(
  channel: GroupChannel,
  actor: Actor,
  type: GroupDmEventType,
  opts: { target?: { id: string; username: string; displayName?: string | null; avatar?: string | null } | null; name?: string | null; notify?: string[] } = {},
) {
  const nameText = type === 'channel_name_change' ? (opts.name ?? '') : '';
  const message = await Message.create({
    channelId: channel.id,
    authorId: actor.id,
    content: nameText ? await encryptForStorage(nameText) : '',
    type,
    mentionedUserIds: opts.target ? [opts.target.id] : [],
  });
  await Channel.updateById(channel.id, { lastMessageId: message.id, updatedAt: new Date() }).catch(() => {});

  const actorName = actor.displayName || actor.username;
  const targetName = opts.target ? (opts.target.displayName || opts.target.username) : null;
  const { groupEventPayload, publishToDm } = await import('@/lib/api/dms');
  const messageData = {
    id: message.id,
    type,
    content: '',
    authorId: actor.id,
    author: {
      id: actor.id,
      username: actor.username,
      displayName: actorName,
      avatar: actor.avatar ?? undefined,
      badges: actor.badges || [],
      customization: actor.customization || null,
    },
    channelId: channel.id,
    createdAt: message.createdAt,
    attachments: [],
    groupEvent: groupEventPayload(type, nameText, opts.target ? { ...opts.target } : null),
  };
  publishToDm(channel.id, { type: 'message', message: messageData });

  const preview = groupEventPreview(type, actorName, targetName, nameText);
  const recipients = [...new Set([...(channel.recipientIds || []), ...(opts.notify || [])])];
  const { signalDmMessage } = await import('@/lib/services/messageSignals');
  await signalDmMessage({
    channelId: channel.id,
    recipientIds: recipients,
    messageId: message.id,
    authorId: actor.id,
    authorName: actorName,
    authorAvatar: actor.avatar ?? null,
    content: preview,
    createdAt: message.createdAt,
    group: await groupNotifyInfo(channel),
    // Membership changes badge the group but don't pop a notification.
    isSystem: true,
  });
  return messageData;
}

/** The group info carried by `dm_activity` so notifications open the group page. */
export async function groupNotifyInfo(channel: GroupChannel) {
  const ids = (channel.recipientIds || []).slice(0, 10);
  const users = ids.length ? await User.find({ id: { in: ids } }).catch(() => []) : [];
  const names = users.map((u) => u.displayName || u.username).filter(Boolean) as string[];
  return {
    channelId: channel.id,
    name: groupDisplayName(channel.name, names),
    icon: (channel as { icon?: string | null }).icon ?? null,
    memberCount: (channel.recipientIds || []).length,
  };
}

export { isGroupOwner };
