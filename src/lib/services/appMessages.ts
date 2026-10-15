/**
 * Messages apps create outside the bot channel-message routes: interaction
 * responses (callback 4/5/7, followups, @original edits) and channel webhook
 * posts. One place that persists, publishes to the web clients' streams,
 * fires unread / notification signals and emits the gateway events, so every
 * path behaves the same.
 *
 * Ephemeral messages are never stored in the messages table. They live in the
 * interaction store (Redis, 15 min, so the bot can still edit them by id) and
 * are delivered only to the invoker's own activity stream (fanoutToUsers),
 * never to the channel stream other viewers listen on.
 */
import { randomUUID } from 'crypto';
import { Channel, Message, User, type IChannel, type IMessage } from '@/lib/models';
import { encryptForStorage } from '@/lib/security';
import type { IncomingAttachment } from '@/lib/chat/attachmentPolicy';
import type { MessageComponent } from '@/lib/botapi/components';
import { componentsPlainText } from '@/lib/botapi/components';
import { isSilentMessage } from '@/lib/chat/messageFlags';
import { toDiscordMessage } from '@/lib/services/gatewayEvents';
import { FLAG_EPHEMERAL, FLAG_LOADING } from '@/lib/services/outgoingMessage';
import type { InteractionStore } from '@/lib/botapi/interactionState';

/** The "used /cmd" reference stored on messages (Discord message.interaction). */
export interface InteractionRef {
  id: string;
  type: number;
  name: string;
  user: { id: string; username: string };
  /** The app that answered (serialized as message.application_id). */
  applicationId?: string;
}

export type AppAuthor =
  | { kind: 'bot'; botId: string; applicationId?: string | null }
  | { kind: 'webhook'; webhook: { id: string; name: string; avatar?: string | null; applicationId?: string | null }; overrides?: { username?: unknown; avatarUrl?: unknown } };

export interface AppMessageContent {
  content: string;
  embeds: unknown[];
  components: MessageComponent[] | null;
  attachments: IncomingAttachment[];
  flags: number;
  mentionedUserIds: string[];
}

/** An ephemeral message as kept in the interaction store. */
export interface EphemeralRecord {
  id: string;
  interactionId: string;
  applicationId: string;
  botId: string;
  channelId: string;
  guildId: string | null;
  invokerId: string;
  content: string;
  embeds: unknown[];
  components: MessageComponent[] | null;
  attachments: IncomingAttachment[];
  flags: number;
  interaction: InteractionRef | null;
  createdAt: string;
  editedAt: string | null;
}

export type ClientAuthor = {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  isBot: boolean;
  isSystem?: boolean;
  isWebhook?: boolean;
  status?: string;
};

const authorCache = new Map<string, { at: number; author: ClientAuthor }>();

async function botAuthor(botId: string): Promise<ClientAuthor> {
  const hit = authorCache.get(botId);
  if (hit && Date.now() - hit.at < 30_000) return hit.author;
  const u = await User.findById(botId);
  const author: ClientAuthor = {
    id: botId,
    username: u?.username ?? 'bot',
    displayName: u?.displayName || u?.username || 'bot',
    avatar: u?.avatar ?? null,
    isBot: true,
  };
  if (authorCache.size > 500) authorCache.clear();
  authorCache.set(botId, { at: Date.now(), author });
  return author;
}

async function authorFor(a: AppAuthor): Promise<{ author: ClientAuthor; authorId: string; webhookAuthor: { username: string; avatar: string | null } | null }> {
  if (a.kind === 'bot') return { author: await botAuthor(a.botId), authorId: a.botId, webhookAuthor: null };
  const { buildWebhookAuthor, cleanWebhookAvatarUrl, cleanWebhookUsername } = await import('@/lib/chat/webhook');
  const built = buildWebhookAuthor(a.webhook, { username: a.overrides?.username, avatarUrl: a.overrides?.avatarUrl }, 'online');
  const username = cleanWebhookUsername(a.overrides?.username);
  const avatar = cleanWebhookAvatarUrl(a.overrides?.avatarUrl);
  return {
    author: { ...built, avatar: built.avatar ?? null },
    authorId: a.webhook.id,
    webhookAuthor: username || avatar ? { username: username ?? a.webhook.name, avatar: avatar ?? a.webhook.avatar ?? null } : null,
  };
}

function isDmChannel(channel: Pick<IChannel, 'type' | 'serverId'>): boolean {
  return !channel.serverId && (channel.type === 'dm' || channel.type === 'group_dm');
}

async function publishConversation(channel: IChannel, data: object): Promise<void> {
  try {
    if (isDmChannel(channel)) (await import('@/lib/api/dms')).publishToDm(channel.id, data);
    else (await import('@/lib/api/channels')).publishToChannel(channel.id, data);
  } catch { /* best-effort */ }
}

async function toInvoker(userId: string, payload: Record<string, unknown>): Promise<void> {
  try {
    const { fanoutToUsers } = await import('@/lib/api/activity');
    await fanoutToUsers({ userIds: [userId] }, { type: 'interaction', ...payload });
  } catch { /* best-effort */ }
}

/** Notify the invoker's clients about an interaction (ack, failure, modal, ephemeral...). */
export function notifyInvoker(userId: string, payload: Record<string, unknown>): Promise<void> {
  return toInvoker(userId, payload);
}

/** The client message payload (internal shape the chat engine renders). */
function clientMessage(opts: {
  id: string;
  channel: IChannel;
  author: ClientAuthor;
  authorId: string;
  body: AppMessageContent;
  interaction: InteractionRef | null;
  createdAt: Date | string;
  ephemeral?: boolean;
  webhookId?: string | null;
  edited?: boolean;
}) {
  return {
    id: opts.id,
    content: opts.body.content,
    authorId: opts.authorId,
    author: opts.author,
    channelId: opts.channel.id,
    serverId: opts.channel.serverId ?? null,
    createdAt: opts.createdAt instanceof Date ? opts.createdAt.toISOString() : opts.createdAt,
    attachments: opts.body.attachments,
    embeds: opts.body.embeds,
    components: opts.body.components ?? undefined,
    flags: opts.body.flags,
    edited: Boolean(opts.edited),
    pinned: false,
    reactions: [],
    mentionedUserIds: opts.body.mentionedUserIds,
    type: 'default',
    ...(opts.interaction ? { interaction: { id: opts.interaction.id, name: opts.interaction.name, user: opts.interaction.user } } : {}),
    ...(opts.ephemeral ? { ephemeral: true } : {}),
    ...(opts.webhookId ? { webhookId: opts.webhookId } : {}),
  };
}

function discordFromClient(m: ReturnType<typeof clientMessage>, extra: { applicationId?: string | null; webhookId?: string | null; interaction?: InteractionRef | null }) {
  return toDiscordMessage({
    id: m.id,
    content: m.content,
    channelId: m.channelId,
    serverId: m.serverId,
    createdAt: m.createdAt,
    edited: m.edited,
    author: m.author,
    attachments: m.attachments as unknown as Array<Record<string, unknown>>,
    flags: m.flags,
    mentionedUserIds: m.mentionedUserIds,
    embeds: m.embeds,
    components: m.components ?? [],
    webhookId: extra.webhookId ?? null,
    applicationId: extra.applicationId ?? null,
    interaction: extra.interaction ?? null,
  });
}

export interface CreatedAppMessage {
  id: string;
  ephemeral: boolean;
  /** Discord message object (for wait=true / with_response / followup replies). */
  discord: Record<string, unknown>;
}

/**
 * Create an app message. With `ephemeralFor`, it's stored only in the
 * interaction store and delivered to that user; otherwise persisted and
 * delivered like any message (stream, unread/notification signals,
 * MESSAGE_CREATE). `loading` marks a deferred "thinking…" placeholder: no
 * notification until it gets real content.
 */
export async function createAppMessage(opts: {
  author: AppAuthor;
  channel: IChannel;
  body: AppMessageContent;
  interaction?: InteractionRef | null;
  ephemeralFor?: { userId: string; store: InteractionStore; interactionId: string; applicationId: string; botId: string } | null;
  loading?: boolean;
}): Promise<CreatedAppMessage> {
  const { author, authorId, webhookAuthor } = await authorFor(opts.author);
  const interaction = opts.interaction ?? null;
  const applicationId = opts.author.kind === 'bot' ? opts.author.applicationId ?? null : opts.author.webhook.applicationId ?? null;
  const webhookId = opts.author.kind === 'webhook' ? opts.author.webhook.id : null;
  const flags = (opts.body.flags & ~FLAG_EPHEMERAL) | (opts.ephemeralFor ? FLAG_EPHEMERAL : 0) | (opts.loading ? FLAG_LOADING : 0);
  const body = { ...opts.body, flags };

  if (opts.ephemeralFor) {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const record: EphemeralRecord = {
      id,
      interactionId: opts.ephemeralFor.interactionId,
      applicationId: opts.ephemeralFor.applicationId,
      botId: opts.ephemeralFor.botId,
      channelId: opts.channel.id,
      guildId: opts.channel.serverId ?? null,
      invokerId: opts.ephemeralFor.userId,
      content: body.content,
      embeds: body.embeds,
      components: body.components,
      attachments: body.attachments,
      flags,
      interaction,
      createdAt,
      editedAt: null,
    };
    await opts.ephemeralFor.store.putRecord('eph', id, record);
    const message = clientMessage({ id, channel: opts.channel, author, authorId, body, interaction, createdAt, ephemeral: true });
    await toInvoker(opts.ephemeralFor.userId, { event: 'ephemeral', channelId: opts.channel.id, message });
    return { id, ephemeral: true, discord: discordFromClient(message, { applicationId, interaction }) };
  }

  const row = await Message.create({
    channelId: opts.channel.id,
    serverId: opts.channel.serverId ?? null,
    authorId,
    content: body.content ? await encryptForStorage(body.content) : '',
    embeds: body.embeds,
    attachments: body.attachments,
    components: body.components && body.components.length ? body.components : null,
    flags,
    type: 'default',
    mentionedUserIds: body.mentionedUserIds,
    interaction: interaction ?? null,
    ...(webhookAuthor ? { webhookAuthor } : {}),
    ...((flags & 4) !== 0 ? { suppressEmbeds: true } : {}),
  });
  void Channel.updateById(opts.channel.id, { lastMessageId: row.id, updatedAt: new Date() }).catch(() => {});
  const message = clientMessage({ id: row.id, channel: opts.channel, author, authorId, body, interaction, createdAt: row.createdAt ?? new Date(), webhookId });
  await publishConversation(opts.channel, { type: 'message', message });
  if (!opts.loading) void signalAppMessage(opts.channel, row, author, body);
  // MESSAGE_CREATE re-reads the stored row (same object as the REST API).
  void import('@/lib/services/gatewayEvents')
    .then(({ emitMessageCreate }) => emitMessageCreate({ id: row.id, channelId: opts.channel.id, serverId: opts.channel.serverId ?? null }))
    .catch(() => {});
  const { discordMessageFromRow } = await import('@/lib/services/interactionPayload');
  const discord = await discordMessageFromRow(row).catch(() => discordFromClient(message, { applicationId, webhookId, interaction }));
  return { id: row.id, ephemeral: false, discord };
}

/** Unread badges + notifications for a persisted app message. */
async function signalAppMessage(channel: IChannel, row: IMessage, author: ClientAuthor, body: AppMessageContent): Promise<void> {
  try {
    const { signalChannelMessage, signalDmMessage } = await import('@/lib/services/messageSignals');
    const preview = body.content || componentsPlainText(body.components, 200);
    const silent = isSilentMessage(body.flags);
    if (isDmChannel(channel)) {
      await signalDmMessage({
        channelId: channel.id,
        recipientIds: ((channel.recipientIds || []) as string[]),
        messageId: row.id,
        authorId: author.isWebhook ? `webhook:${author.id}` : author.id,
        authorName: author.displayName,
        authorAvatar: author.avatar,
        content: preview,
        hasAttachments: body.attachments.length > 0,
        createdAt: row.createdAt,
        silent,
      });
    } else {
      await signalChannelMessage({
        channel: { id: channel.id, serverId: channel.serverId, name: channel.name, parentId: channel.parentId },
        messageId: row.id,
        // Webhooks: not the creator's id, so they get unread for their webhook's posts too.
        authorId: author.isWebhook ? `webhook:${author.id}` : author.id,
        authorName: author.displayName,
        authorAvatar: author.avatar,
        content: preview,
        mentionedUserIds: body.mentionedUserIds,
        createdAt: row.createdAt,
        silent,
      });
    }
  } catch { /* best-effort */ }
}

/** Fields an edit may change (absent = keep). */
export interface AppMessagePatch {
  content?: string;
  embeds?: unknown[];
  components?: MessageComponent[] | null;
  attachments?: IncomingAttachment[];
  flags?: number;
  mentionedUserIds?: string[];
}

/**
 * Edit a persisted app message (the caller checked it belongs to the bot /
 * webhook / interaction). Publishes the edit to the stream and MESSAGE_UPDATE.
 * A deferred placeholder that gets content now notifies like a new message.
 */
export async function editAppMessage(opts: {
  channel: IChannel;
  message: IMessage;
  patch: AppMessagePatch;
  author: AppAuthor;
}): Promise<CreatedAppMessage> {
  const { message, patch } = opts;
  const wasLoading = ((message.flags ?? 0) & FLAG_LOADING) !== 0;
  const updates: Partial<IMessage> = { edited: !wasLoading, editedTimestamp: wasLoading ? null : new Date() };
  let content: string | undefined;
  if (patch.content !== undefined) {
    content = patch.content;
    updates.content = patch.content ? await encryptForStorage(patch.content) : '';
  }
  if (patch.embeds !== undefined) updates.embeds = patch.embeds;
  if (patch.components !== undefined) updates.components = patch.components && patch.components.length ? patch.components : null;
  if (patch.attachments !== undefined) updates.attachments = patch.attachments;
  const flags = ((patch.flags ?? message.flags ?? 0) & ~FLAG_LOADING);
  updates.flags = flags;
  if (patch.mentionedUserIds !== undefined) updates.mentionedUserIds = patch.mentionedUserIds;
  const updated = (await Message.updateById(message.id, updates as never)) ?? message;

  if (content === undefined) {
    const { decryptFromStorage } = await import('@/lib/security');
    content = updated.content ? await decryptFromStorage(updated.content).catch(() => '') : '';
  }
  const body: AppMessageContent = {
    content,
    embeds: (Array.isArray(updated.embeds) ? updated.embeds : []) as unknown[],
    components: (updated.components as MessageComponent[] | null) ?? null,
    attachments: (Array.isArray(updated.attachments) ? updated.attachments : []) as IncomingAttachment[],
    flags,
    mentionedUserIds: (updated.mentionedUserIds ?? []) as string[],
  };
  await publishConversation(opts.channel, {
    type: 'edit',
    messageId: message.id,
    content: body.content,
    embeds: body.embeds,
    attachments: body.attachments,
    components: body.components ?? [],
    flags,
    ...(wasLoading ? { loadingDone: true } : {}),
  });
  const { author, authorId } = await authorFor(opts.author);
  const interaction = (updated.interaction as InteractionRef | null) ?? null;
  const applicationId = opts.author.kind === 'bot' ? opts.author.applicationId ?? null : opts.author.webhook.applicationId ?? null;
  const webhookId = opts.author.kind === 'webhook' ? opts.author.webhook.id : null;
  const client = clientMessage({ id: message.id, channel: opts.channel, author, authorId, body, interaction, createdAt: updated.createdAt ?? new Date(), edited: !wasLoading, webhookId });
  if (wasLoading) void signalAppMessage(opts.channel, updated, author, body);
  void import('@/lib/services/gatewayEvents')
    .then(({ emitMessageUpdate }) => emitMessageUpdate({ id: message.id, channelId: opts.channel.id, serverId: opts.channel.serverId ?? null }))
    .catch(() => {});
  const { discordMessageFromRow } = await import('@/lib/services/interactionPayload');
  const discord = await discordMessageFromRow(updated).catch(() => discordFromClient(client, { applicationId, webhookId, interaction }));
  return { id: message.id, ephemeral: false, discord };
}

/** Delete a persisted app message (soft delete + live delete + MESSAGE_DELETE). */
export async function deleteAppMessage(channel: IChannel, message: IMessage): Promise<void> {
  if (isDmChannel(channel)) {
    await Message.updateById(message.id, { isDeleted: true, deletedAt: new Date() });
    await publishConversation(channel, { type: 'delete', messageId: message.id });
  } else {
    const { softDeleteChannelMessage } = await import('@/lib/api/channels');
    await softDeleteChannelMessage(channel, message);
  }
  void import('@/lib/services/gatewayEvents')
    .then(({ emitMessageDelete }) => emitMessageDelete({ id: message.id, channelId: channel.id, guildId: channel.serverId ?? null }))
    .catch(() => {});
}

/** Apply a patch to an ephemeral record and deliver the new version to its invoker. */
export async function editEphemeral(store: InteractionStore, record: EphemeralRecord, patch: AppMessagePatch): Promise<CreatedAppMessage> {
  const wasLoading = (record.flags & FLAG_LOADING) !== 0;
  const next: EphemeralRecord = {
    ...record,
    content: patch.content ?? record.content,
    embeds: patch.embeds ?? record.embeds,
    components: patch.components !== undefined ? patch.components : record.components,
    attachments: patch.attachments ?? record.attachments,
    flags: ((patch.flags ?? record.flags) | FLAG_EPHEMERAL) & ~FLAG_LOADING,
    editedAt: wasLoading ? null : new Date().toISOString(),
  };
  await store.putRecord('eph', record.id, next);
  const channel = { id: record.channelId, serverId: record.guildId } as IChannel;
  const author = await botAuthor(record.botId);
  const body: AppMessageContent = { content: next.content, embeds: next.embeds, components: next.components, attachments: next.attachments, flags: next.flags, mentionedUserIds: [] };
  const message = clientMessage({ id: record.id, channel, author, authorId: record.botId, body, interaction: record.interaction, createdAt: record.createdAt, ephemeral: true, edited: !wasLoading });
  await toInvoker(record.invokerId, { event: 'ephemeral_update', channelId: record.channelId, message });
  return { id: record.id, ephemeral: true, discord: discordFromClient(message, { applicationId: record.applicationId, interaction: record.interaction }) };
}

export async function deleteEphemeral(store: InteractionStore, record: EphemeralRecord): Promise<void> {
  await store.deleteRecord('eph', record.id);
  await toInvoker(record.invokerId, { event: 'ephemeral_delete', channelId: record.channelId, messageId: record.id });
}

/** Discord message object for an ephemeral record. */
export async function ephemeralToDiscord(record: EphemeralRecord) {
  const author = await botAuthor(record.botId);
  const channel = { id: record.channelId, serverId: record.guildId } as IChannel;
  const body: AppMessageContent = { content: record.content, embeds: record.embeds, components: record.components, attachments: record.attachments, flags: record.flags, mentionedUserIds: [] };
  const message = clientMessage({ id: record.id, channel, author, authorId: record.botId, body, interaction: record.interaction, createdAt: record.createdAt, ephemeral: true, edited: Boolean(record.editedAt) });
  return discordFromClient(message, { applicationId: record.applicationId, interaction: record.interaction });
}
