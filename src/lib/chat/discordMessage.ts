/**
 * One Discord v10 message serializer for the bot REST API and the gateway
 * (pure: every lookup is done by the caller and passed in `SerializeContext`;
 * see src/lib/services/botMessages.ts, which loads authors, mentions, reply
 * targets, webhooks, poll tallies and forwards in batches).
 *
 * Shape: https://discord.com/developers/docs/resources/message#message-object
 * - `type`: 0 default, 19 reply, 3 call, 6 pin notice, 7 join, 18 thread
 *   created, 46 poll result, 1/2/4/5 group DM notices, 20 interaction reply
 * - replies carry `message_reference` (type 0) and `referenced_message`
 *   (null when the target is gone); forwards carry `message_reference`
 *   (type 1) and `message_snapshots`
 * - reactions are computed for the viewing bot (`me`), with the
 *   `count_details` / burst fields Discord sends (Serika has no burst reactions)
 * - end-to-end encrypted DM messages never expose ciphertext: they are
 *   serialized without content, attachments or embeds
 */
import { parsePollResult, parseStoredPoll, toDiscordPoll, type StoredPoll } from './polls';
import { toDiscordVoiceFields, type VoiceAttachmentMeta } from './voiceMessage';
import { discordEmoji } from './reactionEmoji';

export interface MessageRowLike {
  id: string;
  channelId: string;
  serverId?: string | null;
  authorId: string;
  /** Plain (decrypted) content. */
  content?: string | null;
  type?: string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
  edited?: boolean | null;
  editedTimestamp?: Date | string | null;
  attachments?: unknown;
  embeds?: unknown;
  sticker?: unknown;
  mentionEveryone?: boolean | null;
  mentionedUserIds?: string[] | null;
  mentionedRoleIds?: string[] | null;
  reactions?: unknown;
  pinned?: boolean | null;
  flags?: number | null;
  tts?: boolean | null;
  referencedMessageId?: string | null;
  threadId?: string | null;
  poll?: unknown;
  messageSnapshot?: unknown;
  interaction?: unknown;
  e2ee?: unknown;
  suppressEmbeds?: boolean | null;
  components?: unknown;
  call?: unknown;
}

export interface UserLike {
  id: string;
  username?: string | null;
  displayName?: string | null;
  avatar?: string | null;
  banner?: string | null;
  isBot?: boolean | null;
  isSystem?: boolean | null;
}

export interface MemberLike {
  roles?: string[] | null;
  nickname?: string | null;
  avatar?: string | null;
  banner?: string | null;
  joinedAt?: Date | string | null;
  premiumSince?: Date | string | null;
  deaf?: boolean | null;
  mute?: boolean | null;
  pending?: boolean | null;
  communicationDisabledUntil?: Date | string | null;
}

export interface WebhookLike { id: string; name?: string | null; avatar?: string | null }

/** The forwarded copy, content already decrypted. */
export interface ForwardSnapshotLike {
  messageId: string;
  channelId: string;
  serverId?: string | null;
  content: string;
  attachments?: unknown[];
  embeds?: unknown[];
  sticker?: unknown;
  createdAt?: string | null;
  edited?: boolean;
}

export interface SerializeContext {
  /** The bot reading the message: `reactions[].me`, `poll.results.me_voted`. */
  viewerId?: string | null;
  /** Users by lower-cased id (authors and mentioned users). */
  users?: ReadonlyMap<string, UserLike>;
  /** Webhooks by lower-cased id (messages authored by a channel webhook). */
  webhooks?: ReadonlyMap<string, WebhookLike>;
  /** Guild member of the author (gateway MESSAGE_CREATE / UPDATE in guilds). */
  authorMember?: MemberLike | null;
  /** The reply target, already serialized (null = deleted / unknown). */
  referenced?: Record<string, unknown> | null;
  /** Poll tallies for the viewer. */
  pollTally?: { counts: Record<number, number>; myVotes: number[] } | null;
  forward?: ForwardSnapshotLike | null;
  /** Position in a thread. */
  position?: number | null;
  nonce?: string | number | null;
  /** Gateway payloads carry guild_id; REST messages don't. */
  includeGuildId?: boolean;
}

/** Discord message types for our stored string types. */
export const MESSAGE_TYPE_NUMBERS: Readonly<Record<string, number>> = {
  default: 0,
  recipient_add: 1,
  recipient_remove: 2,
  call: 3,
  channel_name_change: 4,
  channel_icon_change: 5,
  channel_pinned_message: 6,
  member_join: 7,
  user_premium_guild_subscription: 8,
  thread_created: 18,
  reply: 19,
  poll_result: 46,
};

const ATTACHMENT_IS_SPOILER = 1 << 3;

const lower = (s: string) => s.toLowerCase();

function iso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const t = d instanceof Date ? d.getTime() : Date.parse(String(d));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** A Discord user object (partial, as embedded in messages). */
export function discordUser(u: UserLike) {
  return {
    id: u.id,
    username: u.username || 'unknown',
    discriminator: '0',
    global_name: u.displayName || u.username || null,
    avatar: u.avatar ?? null,
    avatar_decoration_data: null,
    banner: u.banner ?? null,
    bot: Boolean(u.isBot),
    system: Boolean(u.isSystem),
    public_flags: 0,
    flags: 0,
  };
}

/** Discord's placeholder for an author that no longer exists. */
export function deletedUser(id: string) {
  return { ...discordUser({ id, username: 'Deleted User' }), global_name: null };
}

/** A partial guild member object (MESSAGE_CREATE `member`, reaction events). */
export function discordPartialMember(m: MemberLike) {
  return {
    roles: (m.roles ?? []).map(String),
    nick: m.nickname ?? null,
    avatar: m.avatar ?? null,
    banner: m.banner ?? null,
    joined_at: iso(m.joinedAt),
    premium_since: iso(m.premiumSince),
    deaf: Boolean(m.deaf),
    mute: Boolean(m.mute),
    flags: 0,
    pending: Boolean(m.pending),
    communication_disabled_until: iso(m.communicationDisabledUntil),
  };
}

type StoredAttachment = Record<string, unknown> & { id?: unknown; filename?: unknown; url?: unknown };

export function discordAttachment(a: StoredAttachment) {
  const filename = typeof a.filename === 'string' ? a.filename : 'file';
  const spoiler = a.spoiler === true || filename.startsWith('SPOILER_');
  return {
    id: String(a.id ?? '0'),
    filename,
    ...(typeof a.title === 'string' ? { title: a.title } : {}),
    ...(typeof a.description === 'string' ? { description: a.description } : {}),
    content_type: typeof a.contentType === 'string' ? a.contentType : (typeof a.content_type === 'string' ? a.content_type : undefined),
    size: Number(a.size) || 0,
    url: String(a.url ?? ''),
    proxy_url: String(a.proxyUrl ?? a.proxy_url ?? a.url ?? ''),
    ...(typeof a.width === 'number' ? { width: a.width, height: typeof a.height === 'number' ? a.height : null } : {}),
    ephemeral: false,
    ...(spoiler ? { flags: ATTACHMENT_IS_SPOILER } : {}),
    ...toDiscordVoiceFields(a as VoiceAttachmentMeta),
  };
}

interface StoredReactionLike { emoji?: { name?: string; id?: string | null; animated?: boolean }; count?: number; userIds?: string[] }

export function discordReactions(raw: unknown, viewerId?: string | null) {
  const list = Array.isArray(raw) ? (raw as StoredReactionLike[]) : [];
  const viewer = viewerId ? lower(viewerId) : null;
  return list
    .filter((r) => r && r.emoji && ((r.userIds?.length ?? 0) > 0 || (r.count ?? 0) > 0))
    .map((r) => {
      const count = r.userIds?.length ?? r.count ?? 0;
      return {
        count,
        count_details: { burst: 0, normal: count },
        me: viewer ? (r.userIds ?? []).some((id) => lower(String(id)) === viewer) : false,
        me_burst: false,
        burst_colors: [] as string[],
        emoji: discordEmoji({ name: r.emoji?.name ?? '', id: r.emoji?.id ?? null, animated: r.emoji?.animated }),
      };
    });
}

function stickerItems(raw: unknown) {
  if (!raw || typeof raw !== 'object') return undefined;
  const s = raw as { id?: string; name?: string; imageUrl?: string };
  if (!s.id) return undefined;
  const url = String(s.imageUrl ?? '').toLowerCase();
  // 1 PNG, 2 APNG, 3 LOTTIE, 4 GIF
  const format = url.includes('.gif') ? 4 : url.endsWith('.json') ? 3 : 1;
  return [{ id: s.id, name: s.name ?? '', format_type: format }];
}

/** True for an end-to-end encrypted message envelope (not the "encryption on/off" notice rows). */
export function isEncryptedEnvelope(e2ee: unknown): boolean {
  if (!e2ee || typeof e2ee !== 'object') return false;
  return !('notice' in (e2ee as Record<string, unknown>));
}

function pollResultEmbeds(raw: unknown) {
  const r = parsePollResult(raw);
  if (!r) return [];
  const winner = r.winnerIds.length === 1 ? r.answers.find((a) => a.id === r.winnerIds[0]) : undefined;
  return [{
    type: 'poll_result',
    fields: [
      { name: 'poll_question_text', value: r.question, inline: false },
      { name: 'victor_answer_votes', value: String(winner?.votes ?? 0), inline: false },
      { name: 'total_votes', value: String(r.totalVotes), inline: false },
      ...(winner ? [
        { name: 'victor_answer_id', value: String(winner.id), inline: false },
        { name: 'victor_answer_text', value: winner.text, inline: false },
      ] : []),
    ],
  }];
}

function interactionInfo(raw: unknown, applicationId?: string | null) {
  if (!raw || typeof raw !== 'object') return null;
  const i = raw as { id?: string; type?: number; name?: string; user?: { id?: string; username?: string }; applicationId?: string; application_id?: string };
  const user = i.user?.id ? discordUser({ id: i.user.id, username: i.user.username ?? null }) : null;
  return {
    id: i.id ?? null,
    type: typeof i.type === 'number' ? i.type : 2,
    name: i.name ?? '',
    user,
    applicationId: i.applicationId ?? i.application_id ?? applicationId ?? null,
  };
}

/** The Discord message type number of a stored row. */
export function discordMessageType(m: Pick<MessageRowLike, 'type' | 'interaction' | 'referencedMessageId'>): number {
  const t = String(m.type ?? 'default');
  if (t === 'default' && m.interaction && typeof m.interaction === 'object') return 20;
  return MESSAGE_TYPE_NUMBERS[t] ?? 0;
}

export function serializeMessage(m: MessageRowLike, ctx: SerializeContext = {}) {
  const users = ctx.users ?? new Map<string, UserLike>();
  const authorUser = users.get(lower(m.authorId));
  const webhook = !authorUser ? ctx.webhooks?.get(lower(m.authorId)) : undefined;
  const author = authorUser
    ? discordUser(authorUser)
    : webhook
      ? { ...discordUser({ id: webhook.id, username: webhook.name || 'Webhook', avatar: webhook.avatar ?? null, isBot: true }), discriminator: '0000' }
      : deletedUser(m.authorId);
  const encrypted = isEncryptedEnvelope(m.e2ee);
  const type = discordMessageType(m);
  const isPollResult = m.type === 'poll_result';
  const poll = !isPollResult && !encrypted ? parseStoredPoll(m.poll) : null;
  const interaction = interactionInfo(m.interaction);
  const forward = ctx.forward ?? null;
  const flags = typeof m.flags === 'number' ? m.flags : 0;
  const suppressed = Boolean(m.suppressEmbeds) || (flags & (1 << 2)) !== 0;
  const embeds = encrypted
    ? []
    : isPollResult
      ? pollResultEmbeds(m.poll)
      : suppressed ? [] : (Array.isArray(m.embeds) ? m.embeds : []);
  const attachments = encrypted || !Array.isArray(m.attachments) ? [] : (m.attachments as StoredAttachment[]).map(discordAttachment);
  const mentions = (m.mentionedUserIds ?? [])
    .map((id) => users.get(lower(String(id))))
    .filter((u): u is UserLike => Boolean(u))
    .map(discordUser);
  const reactions = discordReactions(m.reactions, ctx.viewerId);
  const reference = forward
    ? { type: 1, message_id: forward.messageId, channel_id: forward.channelId, ...(forward.serverId ? { guild_id: forward.serverId } : {}) }
    : m.referencedMessageId
      ? { type: 0, message_id: m.referencedMessageId, channel_id: m.channelId, ...(m.serverId ? { guild_id: m.serverId } : {}) }
      : undefined;
  const snapshots = forward
    ? [{
        message: {
          type: 0,
          content: forward.content ?? '',
          embeds: Array.isArray(forward.embeds) ? forward.embeds : [],
          attachments: (Array.isArray(forward.attachments) ? forward.attachments as StoredAttachment[] : []).map(discordAttachment),
          timestamp: iso(forward.createdAt),
          edited_timestamp: null,
          flags: 0,
          mentions: [],
          mention_roles: [],
          sticker_items: stickerItems(forward.sticker),
          components: [],
        },
      }]
    : undefined;
  const storedPoll = poll as (StoredPoll | null);
  const isReply = type === 19;

  return {
    id: m.id,
    channel_id: m.channelId,
    guild_id: ctx.includeGuildId && m.serverId ? m.serverId : undefined,
    author,
    member: ctx.authorMember ? discordPartialMember(ctx.authorMember) : undefined,
    content: encrypted ? '' : (m.content ?? ''),
    timestamp: iso(m.createdAt),
    edited_timestamp: m.edited ? iso(m.editedTimestamp ?? m.updatedAt) : null,
    tts: Boolean(m.tts),
    mention_everyone: Boolean(m.mentionEveryone),
    mentions,
    mention_roles: (m.mentionedRoleIds ?? []).map(String),
    mention_channels: undefined,
    attachments,
    embeds,
    reactions: reactions.length ? reactions : undefined,
    nonce: ctx.nonce ?? undefined,
    pinned: Boolean(m.pinned),
    webhook_id: webhook ? webhook.id : undefined,
    type,
    application_id: interaction?.applicationId ?? undefined,
    flags,
    message_reference: reference,
    message_snapshots: snapshots,
    referenced_message: isReply ? (ctx.referenced ?? null) : undefined,
    interaction_metadata: interaction
      ? { id: interaction.id, type: interaction.type, name: interaction.name, user: interaction.user, authorizing_integration_owners: {} }
      : undefined,
    interaction: interaction
      ? { id: interaction.id, type: interaction.type, name: interaction.name, user: interaction.user }
      : undefined,
    components: Array.isArray(m.components) && !encrypted ? m.components : [],
    sticker_items: encrypted ? undefined : stickerItems(m.sticker),
    position: typeof ctx.position === 'number' ? ctx.position : undefined,
    poll: storedPoll
      ? toDiscordPoll({ ...storedPoll, counts: ctx.pollTally?.counts, myVotes: ctx.pollTally?.myVotes })
      : undefined,
    call: type === 3 && m.call && typeof m.call === 'object'
      ? {
          participants: ((m.call as { participantIds?: string[] }).participantIds ?? []).map(String),
          ended_timestamp: iso((m.call as { endedAt?: string | null }).endedAt ?? null),
        }
      : undefined,
  };
}

export type DiscordMessage = ReturnType<typeof serializeMessage>;
