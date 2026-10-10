/**
 * Unread / notification signals for messages created outside the normal user
 * send routes (bots, webhooks, interaction replies, system DMs). The user
 * routes in channels.ts and dms.ts send these inline; everything else should
 * call these so recipients get the same badge, sound and notification.
 */

const USER_MENTION_RE = /<@!?([0-9a-fA-F-]{8,})>/g;

/** User ids mentioned as <@id> in raw content. */
export function extractUserMentionIds(content: string | null | undefined): string[] {
  if (!content) return [];
  const ids = new Set<string>();
  for (const match of content.matchAll(USER_MENTION_RE)) ids.add(match[1]);
  return [...ids];
}

/** A message landed in a server channel. */
export async function signalChannelMessage(opts: {
  channel: { id: string; serverId?: string | null; name?: string | null };
  messageId: string;
  authorId: string;
  authorName?: string | null;
  mentionedUserIds?: string[];
  mentionEveryone?: boolean;
  authorAvatar?: string | null;
  /** Message text, for the desktop notification preview. */
  content?: string | null;
  createdAt?: Date | string | null;
}): Promise<void> {
  if (!opts.channel.serverId) return;
  try {
    const { notifyChannelActivity } = await import('@/lib/api/activity');
    const preview = opts.content ? opts.content.slice(0, 200) : undefined;
    const { lookupMentionNames } = await import('@/lib/services/mentionNames');
    const mentionNames = preview ? await lookupMentionNames([preview], { serverId: opts.channel.serverId }) : undefined;
    await notifyChannelActivity({
      type: 'channel_activity',
      serverId: opts.channel.serverId,
      channelId: opts.channel.id,
      channelName: opts.channel.name ?? undefined,
      messageId: opts.messageId,
      authorId: opts.authorId,
      authorName: opts.authorName ?? undefined,
      mentionedUserIds: opts.mentionedUserIds ?? [],
      mentionEveryone: Boolean(opts.mentionEveryone),
      authorAvatar: opts.authorAvatar ?? null,
      preview,
      mentionNames,
      createdAt: new Date(opts.createdAt ?? Date.now()).toISOString(),
    });
  } catch {
    /* best-effort */
  }
}

/** A message landed in a DM: bump everyone's DM list and badge/notify the others. */
export async function signalDmMessage(opts: {
  channelId: string;
  recipientIds: string[];
  messageId: string;
  authorId: string;
  authorName?: string | null;
  authorAvatar?: string | null;
  content?: string | null;
  hasAttachments?: boolean;
  createdAt?: Date | string | null;
  /** A call log message: badges the DM, but the ring itself is the notification. */
  isCall?: boolean;
}): Promise<void> {
  try {
    const createdAt = new Date(opts.createdAt ?? Date.now()).toISOString();
    const text = opts.content ?? '';
    const others = opts.recipientIds.filter((id) => id !== opts.authorId);
    const { emitDmListUpdate } = await import('@/lib/api/dms');
    const everyone = [...new Set([...opts.recipientIds, opts.authorId])];
    for (const userId of everyone) {
      const counterpart = userId === opts.authorId ? others[0] : opts.authorId;
      emitDmListUpdate([userId], {
        type: 'dm:list:update',
        channelId: opts.channelId,
        recipientId: counterpart,
        message: { id: opts.messageId, content: text.slice(0, 180), authorId: opts.authorId, createdAt },
      });
    }
    if (others.length === 0) return;
    const { fanoutToUsers } = await import('@/lib/api/activity');
    const { lookupMentionNames } = await import('@/lib/services/mentionNames');
    const mentionNames = text ? await lookupMentionNames([text.slice(0, 120)]) : undefined;
    await fanoutToUsers({ userIds: others }, {
      type: 'dm_activity',
      channelId: opts.channelId,
      messageId: opts.messageId,
      authorId: opts.authorId,
      authorName: opts.authorName ?? undefined,
      authorAvatar: opts.authorAvatar ?? null,
      preview: text.slice(0, 120),
      mentionNames,
      hasAttachments: Boolean(opts.hasAttachments),
      createdAt,
      ...(opts.isCall ? { isCall: true } : {}),
    });
  } catch {
    /* best-effort */
  }
}
