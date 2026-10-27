/**
 * Discord's CHANNEL_PINNED_MESSAGE (type 6) system message: "<actor> pinned
 * a message to this channel.", posted when a message is pinned, with
 * message_reference pointing at the pinned message. Stored as type
 * 'channel_pinned_message' (referencedMessageId = the pinned message), drawn
 * by the web client as a one-line row (src/components/chat/PinSystemRow.tsx),
 * MESSAGE_CREATE for bots. Unread badge only, never a notification.
 */
import { Channel, Message, type IChannel } from '@/lib/models';

export interface PinActor {
  id: string;
  username: string;
  displayName?: string | null;
  avatar?: string | null;
  isBot?: boolean | null;
}

export async function postPinNotice(channel: IChannel, actor: PinActor, pinnedMessageId: string): Promise<string | null> {
  try {
    const row = await Message.create({
      channelId: channel.id,
      serverId: channel.serverId ?? null,
      authorId: actor.id,
      content: '',
      type: 'channel_pinned_message',
      referencedMessageId: pinnedMessageId,
      embeds: [],
      attachments: [],
      reactions: [],
      pinned: false,
      edited: false,
    });
    void Channel.updateById(channel.id, { lastMessageId: row.id, updatedAt: new Date() }).catch(() => {});
    const author = {
      id: actor.id,
      username: actor.username,
      displayName: actor.displayName || actor.username,
      avatar: actor.avatar ?? null,
      isBot: Boolean(actor.isBot),
    };
    const { publishToConversation } = await import('@/lib/services/messageExtras');
    await publishToConversation(channel, {
      type: 'message',
      message: {
        id: row.id,
        content: '',
        authorId: actor.id,
        author,
        channelId: channel.id,
        serverId: channel.serverId ?? null,
        createdAt: row.createdAt ?? new Date(),
        type: 'channel_pinned_message',
        referencedMessageId: pinnedMessageId,
        attachments: [],
        embeds: [],
        reactions: [],
        mentionedUserIds: [],
        mentionedRoleIds: [],
        mentionedChannelIds: [],
      },
    }).catch(() => {});

    const { signalChannelMessage, signalDmMessage } = await import('@/lib/services/messageSignals');
    const name = actor.displayName || actor.username;
    if (channel.serverId) {
      void signalChannelMessage({
        channel: { id: channel.id, serverId: channel.serverId, name: channel.name, parentId: channel.parentId ?? null },
        messageId: row.id,
        authorId: actor.id,
        authorName: name,
        authorAvatar: actor.avatar ?? null,
        createdAt: row.createdAt,
        silent: true,
      });
    } else {
      void signalDmMessage({
        channelId: channel.id,
        recipientIds: (channel.recipientIds || []) as string[],
        messageId: row.id,
        authorId: actor.id,
        authorName: name,
        authorAvatar: actor.avatar ?? null,
        createdAt: row.createdAt,
        isSystem: true,
        silent: true,
      });
    }
    void import('@/lib/services/gatewayEvents')
      .then(({ emitMessageCreate }) => emitMessageCreate({ id: row.id, channelId: channel.id, serverId: channel.serverId ?? null }))
      .catch(() => {});
    if (channel.type === 'public_thread' || channel.type === 'private_thread') {
      void import('@/lib/services/threads').then((m) => m.refreshThreadAfterMessage(channel.id)).catch(() => {});
    }
    return row.id;
  } catch (err) {
    console.error('[pins] pin notice failed:', (err as Error)?.message ?? err);
    return null;
  }
}
