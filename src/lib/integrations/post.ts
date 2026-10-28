/**
 * Posting YouTube / Twitch notifications into a server channel, and checking
 * the ping setting. Real (poller) and test posts share this path: the message
 * is created through createAppMessage, so it is stored, published to open
 * channel streams, badges / notifies members (messageSignals, including the
 * chosen @everyone / @here / role ping) and reaches bots (MESSAGE_CREATE).
 */
import { Channel, Role, User, type IChannel } from '@/lib/models';
import { isValidObjectId } from '@/lib/security';
import {
  buildNotificationContent,
  buildNotificationEmbed,
  type IntegrationItem,
  type IntegrationKind,
  type MentionSetting,
} from './notifications';

/** Channel types a notification may go to. */
const POSTABLE_TYPES = new Set(['text', 'announcement']);

const INTEGRATION_USERS: Record<IntegrationKind, { username: string; displayName: string; avatar: string }> = {
  youtube: { username: 'youtube-integration-user', displayName: 'YouTube', avatar: '/integrations/youtube.svg' },
  twitch: { username: 'twitch-integration-user', displayName: 'Twitch', avatar: '/integrations/twitch.svg' },
};

const integrationUserIds = new Map<IntegrationKind, string>();

/**
 * The bot account notifications are posted as (one per service). Never a real
 * person: an existing non-bot account with the reserved name is refused.
 */
export async function ensureIntegrationUser(kind: IntegrationKind): Promise<string> {
  const known = integrationUserIds.get(kind);
  if (known) return known;
  const spec = INTEGRATION_USERS[kind];
  let user = await User.findOne({ username: spec.username });
  if (user && !user.isBot) throw new Error(`Integration account ${spec.username} is not a bot account`);
  if (!user) {
    user = await User.create({
      username: spec.username,
      displayName: spec.displayName,
      avatar: spec.avatar,
      isBot: true,
      isSystem: false,
    });
  } else if (user.displayName !== spec.displayName || user.avatar !== spec.avatar) {
    // Older test posts named this account after one server's channel.
    await User.updateById(user.id, { displayName: spec.displayName, avatar: spec.avatar }).catch(() => null);
  }
  integrationUserIds.set(kind, user.id);
  return user.id;
}

export type MentionCheck = { ok: true; mention: MentionSetting } | { ok: false; error: string };

/**
 * Validate a ping setting for `userId` (the person saving it or sending a
 * test): the role must belong to the server (and not be @everyone itself);
 * @everyone, @here and roles that aren't mentionable need "Mention @everyone,
 * @here and All Roles" in the notification channel, like a normal message.
 */
export async function checkMentionSetting(opts: {
  server: { id: string; ownerId: string };
  userId: string;
  mention: MentionSetting;
  channel: Pick<IChannel, 'serverId' | 'permissionOverwrites'> | null;
}): Promise<MentionCheck> {
  const { mention, server } = opts;
  if (mention.type === 'none') return { ok: true, mention: { type: 'none' } };
  let needsEveryonePermission = mention.type === 'everyone' || mention.type === 'here';
  if (mention.type === 'role') {
    if (!mention.roleId || !isValidObjectId(mention.roleId)) return { ok: false, error: 'Choose a role to ping' };
    const role = await Role.findOne({ id: mention.roleId, serverId: server.id });
    if (!role || role.serverId !== server.id) return { ok: false, error: 'That role is not in this server' };
    if (role.isDefault) return { ok: false, error: 'Use @everyone instead of the everyone role' };
    if (!role.mentionable) needsEveryonePermission = true;
  }
  if (needsEveryonePermission) {
    const { canMentionEveryoneInChannel } = await import('@/lib/api/channels');
    const channel = opts.channel
      ? { serverId: opts.channel.serverId, permissionOverwrites: Array.isArray(opts.channel.permissionOverwrites) ? opts.channel.permissionOverwrites : [] }
      : { serverId: server.id, permissionOverwrites: [] };
    if (!(await canMentionEveryoneInChannel(channel, opts.userId))) {
      return {
        ok: false,
        error: mention.type === 'role'
          ? 'You need permission to mention @everyone, @here and all roles to ping a role that is not mentionable'
          : 'You need permission to mention @everyone, @here and all roles',
      };
    }
  }
  return { ok: true, mention: mention.type === 'role' ? { type: 'role', roleId: mention.roleId } : { type: mention.type } };
}

/** A server channel a notification may be posted in, or null. */
export async function loadNotificationChannel(serverId: string, channelId: string | null | undefined): Promise<IChannel | null> {
  if (!channelId || !isValidObjectId(channelId)) return null;
  const channel = await Channel.findById(channelId).catch(() => null);
  if (!channel || channel.serverId !== serverId || !POSTABLE_TYPES.has(String(channel.type))) return null;
  return channel;
}

/** Post one notification. Returns the new message id. */
export async function postIntegrationNotification(opts: {
  channel: IChannel;
  item: IntegrationItem;
  mention: MentionSetting;
  template?: string | null;
  test?: boolean;
  sampleNote?: string;
}): Promise<{ id: string; content: string }> {
  const { channel, item } = opts;
  const authorId = await ensureIntegrationUser(item.kind);
  const built = buildNotificationContent({ item, mention: opts.mention, template: opts.template });
  const { embed, components } = buildNotificationEmbed(item, { test: opts.test, sampleNote: opts.sampleNote });
  const [{ sanitizeMessageContent }, { validateEmbeds }, { createAppMessage }] = await Promise.all([
    import('@/lib/api/channels'),
    import('@/lib/chat/embedValidation'),
    import('@/lib/services/appMessages'),
  ]);
  const content = sanitizeMessageContent(built.content);
  const checked = validateEmbeds([embed]);
  const created = await createAppMessage({
    author: { kind: 'bot', botId: authorId },
    channel,
    body: {
      content,
      embeds: checked.ok ? checked.embeds : [],
      components,
      attachments: [],
      flags: 0,
      mentionedUserIds: [],
      mentionEveryone: built.mentionEveryone,
      mentionedRoleIds: built.mentionedRoleIds,
    },
  });
  return { id: created.id, content };
}
