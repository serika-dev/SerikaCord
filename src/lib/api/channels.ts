import { Elysia, t } from 'elysia';
import { Channel, Message, Role, Server, ServerMember, ServerSticker, User, type IChannel, type IMessage, type IRole, type IServerMember, type IServerSettings, type IUserSettings } from '@/lib/models';
import { authenticateRequest } from '@/lib/services/auth';
import { parseCustomEmojis, batchParseCustomEmojis, normalizeEmojiFormat, getReactionEmoji } from '@/lib/services/emoji';
import { checkRateLimit, sanitizeInput, validateMessageContent, encryptForStorage, decryptFromStorage, isValidObjectId } from '@/lib/security';
import { decodeHtmlEntities } from '@/lib/chat/messages';
import { cache, getPublisher } from '@/lib/db';
import { processShared, PROCESS_INSTANCE_ID } from '@/lib/realtime/processShared';
import {
  CHANNEL_STREAM_RECHECK_MS,
  CHANNEL_STREAM_REVOKED_EVENT,
  recheckLocalUserChannelStreams,
  setChannelStreamRecheckPublisher,
  trackUserChannelStream,
} from '@/lib/realtime/channelStreams';
import { config } from '@/lib/config';
import { randomUUID } from 'crypto';
import { BoundedMap } from '@/lib/utils/boundedMap';
import { normalizeId } from '@/lib/db/normalizeId';
import { getRolePermissions, hasServerPermission } from '@/lib/permissions/serverPermissions';
import { DEFAULT_SERVER_SAFETY, exceedsMentionLimit, resolveServerSafety, type ServerSafety } from '@/lib/servers/guards';
import { ALL_PERMISSIONS, PERMISSION_BITS } from '@/lib/permissions/bits';
import { computeChannelPermissions, hasBit as hasPermissionBit, type ChannelOverwrite } from '@/lib/permissions/channelOverwrites';
import { isSystemUser } from '@/lib/services/systemUsers';
import { dmSendDenyReason, type DmPolicyUser } from '@/lib/chat/dmPolicy';
import { validateMessageAttachments } from '@/lib/chat/attachmentPolicy';
import { matchReactionEmoji, addReaction, removeReaction, type StoredReaction } from '@/lib/chat/reactionMutations';
import { clampInt } from '@/lib/utils/clampInt';
import { canStartDm } from '@/lib/chat/dmAccess';
import { signalChannelMessage } from '@/lib/services/messageSignals';
import {
  addThreadMembers,
  broadcastThreadUpdate,
  claimStarterMessage,
  loadThreadSummaries,
  loadThreadSummariesByIds,
  notifyThreadMembership,
  releaseThreadMessages,
  refreshThreadAfterMessage,
  removeThreadMember,
  setThreadArchived,
} from '@/lib/services/threads';
import {
  canHostThreads,
  cleanThreadName,
  normalizeAutoArchiveDuration,
  threadMembersToAdd,
} from '@/lib/chat/threads';
import { loadMessageExtras } from '@/lib/services/messageExtras';

// Helper to safely compare IDs (normalizes MongoDB ObjectId format to UUID)
function compareIds(id1: string, id2: string): boolean {
  return normalizeId(id1) === normalizeId(id2);
}

// Permission bits
const PERM_ADMINISTRATOR = 1n << 3n;
const PERM_MANAGE_MESSAGES = 1n << 13n;
const PERM_VIEW_CHANNEL = 1n << 10n;
const PERM_MANAGE_CHANNELS = 1n << 4n;
const PERM_MANAGE_ROLES = 1n << 28n;
const PERM_PIN_MESSAGES = 1n << 51n;
const PERM_SEND_MESSAGES = 1n << 11n;
const PERM_MENTION_EVERYONE = 1n << 17n;
const PERM_MANAGE_WEBHOOKS = 1n << 29n;
const PERM_ATTACH_FILES = PERMISSION_BITS.ATTACH_FILES;
const PERM_ADD_REACTIONS = PERMISSION_BITS.ADD_REACTIONS;
const PERM_SEND_MESSAGES_IN_THREADS = PERMISSION_BITS.SEND_MESSAGES_IN_THREADS;
const PERM_CREATE_PUBLIC_THREADS = PERMISSION_BITS.CREATE_PUBLIC_THREADS;
const PERM_CREATE_PRIVATE_THREADS = PERMISSION_BITS.CREATE_PRIVATE_THREADS;
const PERM_MANAGE_THREADS = PERMISSION_BITS.MANAGE_THREADS;

/**
 * Whether a user can moderate messages in a server — i.e. delete other people's
 * messages / bulk-clear. True for the server owner or anyone whose roles grant
 * MANAGE_MESSAGES or ADMINISTRATOR.
 */
async function canManageMessagesInServer(
  serverId: string | null | undefined,
  userId: string,
  membership?: { roles?: string[] | null } | null,
): Promise<boolean> {
  if (!serverId) return false;
  // Try Redis cache for server owner to avoid a DB round-trip
  const cachedOwner = await cache.get<string>(`server:owner:${serverId}`);
  const [server, member] = await Promise.all([
    cachedOwner ? null : Server.findById(serverId),
    membership ?? ServerMember.findOne({ serverId, userId }),
  ]);
  const serverOwnerId = cachedOwner || server?.ownerId;
  if (serverOwnerId && compareIds(serverOwnerId, userId)) return true;
  const roleIds = (member?.roles || []) as string[];
  if (roleIds.length === 0) return false;
  // Use cached role permissions instead of raw Role.find
  const rolePerms = await getRolePermissions(roleIds, serverId);
  for (const [, perms] of rolePerms) {
    if ((perms & PERM_ADMINISTRATOR) === PERM_ADMINISTRATOR) return true;
    if ((perms & PERM_MANAGE_MESSAGES) === PERM_MANAGE_MESSAGES) return true;
  }
  return false;
}

/**
 * Whether a user can pin/unpin messages in a server — true for the server owner
 * or anyone whose roles grant PIN_MESSAGES, MANAGE_MESSAGES, or ADMINISTRATOR.
 */
async function canPinMessagesInServer(
  serverId: string | null | undefined,
  userId: string,
  membership?: { roles?: string[] | null } | null,
): Promise<boolean> {
  if (!serverId) return false;
  const cachedOwner = await cache.get<string>(`server:owner:${serverId}`);
  const [server, member] = await Promise.all([
    cachedOwner ? null : Server.findById(serverId),
    membership ?? ServerMember.findOne({ serverId, userId }),
  ]);
  const serverOwnerId = cachedOwner || server?.ownerId;
  if (serverOwnerId && compareIds(serverOwnerId, userId)) return true;
  const roleIds = (member?.roles || []) as string[];
  if (roleIds.length === 0) return false;
  const rolePerms = await getRolePermissions(roleIds, serverId);
  for (const [, perms] of rolePerms) {
    if ((perms & PERM_ADMINISTRATOR) === PERM_ADMINISTRATOR) return true;
    if ((perms & PERM_MANAGE_MESSAGES) === PERM_MANAGE_MESSAGES) return true;
    if ((perms & PERM_PIN_MESSAGES) === PERM_PIN_MESSAGES) return true;
  }
  return false;
}

// The @everyone (isDefault) role id per server. It never changes for a server,
// so a short in-memory cache keeps it off the hot path of every channel check.
const everyoneRoleIdCache = new BoundedMap<string, { id: string | null; at: number }>(5000);
const EVERYONE_ROLE_CACHE_TTL_MS = 5 * 60_000;

export async function getEveryoneRoleId(serverId: string): Promise<string | null> {
  const hit = everyoneRoleIdCache.get(serverId);
  if (hit && Date.now() - hit.at < EVERYONE_ROLE_CACHE_TTL_MS) return hit.id;
  const role = await Role.findOne({ serverId, isDefault: true });
  const id = (role?.id as string | undefined) ?? null;
  everyoneRoleIdCache.set(serverId, { id, at: Date.now() });
  return id;
}

export async function getServerOwnerIdCached(serverId: string): Promise<string | null> {
  const cacheKey = `server:owner:${serverId}`;
  const cached = await cache.get<string>(cacheKey);
  if (cached) return cached;
  const server = await Server.findById(serverId);
  const ownerId = server?.ownerId ?? null;
  if (ownerId) await cache.set(cacheKey, ownerId, 3600);
  return ownerId;
}

type PermissionChannel = {
  permissionOverwrites?: unknown;
  serverId?: string | null;
  type?: string | null;
  parentId?: string | null;
};

/**
 * Threads have no overwrites of their own: they inherit the parent channel's.
 * Returns the channel whose overwrites govern `channel`.
 */
async function permissionSourceFor(channel: PermissionChannel): Promise<PermissionChannel> {
  if ((channel.type === 'public_thread' || channel.type === 'private_thread') && channel.parentId) {
    const parent = await Channel.findById(channel.parentId);
    if (parent) return parent;
  }
  return channel;
}

/**
 * A member's full permission bitfield in a channel: base permissions from the
 * @everyone role and their other roles, then the channel overwrites in Discord
 * order (see src/lib/permissions/channelOverwrites.ts). Owner and ADMINISTRATOR
 * get everything; MANAGE_CHANNELS keeps its bypass for view and send. Pass the
 * channel whose overwrites apply (for threads, the parent: permissionSourceFor).
 */
export async function computeMemberChannelPermissions(
  channel: PermissionChannel,
  userId: string,
  membership: { roles?: string[] | null } | null,
  serverOwnerId?: string | null,
): Promise<bigint> {
  const serverId = channel.serverId;
  if (!serverId) return ALL_PERMISSIONS; // DMs / group DMs: no role permissions
  if (serverOwnerId && compareIds(serverOwnerId, userId)) return ALL_PERMISSIONS;

  const everyoneRoleId = await getEveryoneRoleId(serverId);
  const memberRoleIds = ((membership?.roles || []) as string[]);
  const roleIds = Array.from(new Set([...(everyoneRoleId ? [everyoneRoleId] : []), ...memberRoleIds]));
  const rolePerms = roleIds.length ? await getRolePermissions(roleIds, serverId) : new Map<string, bigint>();
  const everyonePermissions = everyoneRoleId ? (rolePerms.get(everyoneRoleId) ?? null) : null;
  const otherRolePerms: bigint[] = [];
  for (const [id, perms] of rolePerms) if (id !== everyoneRoleId) otherRolePerms.push(perms);

  return computeChannelPermissions({
    everyonePermissions,
    rolePermissions: otherRolePerms,
    overwrites: (channel.permissionOverwrites || []) as ChannelOverwrite[],
    ctx: { serverId, everyoneRoleId, memberRoleIds, userId },
  });
}

/**
 * A member's permission bitfield in `channel`, resolved on the channel whose
 * overwrites apply (a thread's parent). DMs: everything.
 */
async function memberPermissionsIn(
  channel: PermissionChannel,
  userId: string,
  membership: { roles?: string[] | null } | null | undefined,
): Promise<bigint> {
  if (!channel.serverId) return ALL_PERMISSIONS;
  const [source, serverOwnerId] = await Promise.all([
    permissionSourceFor(channel),
    getServerOwnerIdCached(channel.serverId),
  ]);
  return computeMemberChannelPermissions(source, userId, membership ?? null, serverOwnerId);
}

/** Whether a user can view a channel (VIEW_CHANNEL after base perms + overwrites). */
async function canViewChannel(
  channel: PermissionChannel,
  userId: string,
  membership: { roles?: string[] | null } | null,
  serverOwnerId?: string | null,
): Promise<boolean> {
  const perms = await computeMemberChannelPermissions(channel, userId, membership, serverOwnerId);
  return hasPermissionBit(perms, PERM_VIEW_CHANNEL);
}

type SpeakAction = 'send' | 'attach' | 'react';
type SpeakDenial = { status: number; body: Record<string, unknown> };

/**
 * Shared "may this member speak here" gate for every write that puts content in
 * a server channel (messages, forum posts, reactions, slash commands): rejects
 * timed-out members, then checks the permission each action needs (SEND_MESSAGES,
 * ATTACH_FILES, ADD_REACTIONS after base perms + overwrites; threads resolve
 * against their parent's overwrites). DMs pass.
 */
export async function checkCanSpeak(
  channel: PermissionChannel,
  membership: { roles?: string[] | null; communicationDisabledUntil?: Date | string | null } | null | undefined,
  userId: string,
  actions: SpeakAction[],
): Promise<SpeakDenial | null> {
  if (!channel.serverId) return null;
  const disabledUntil = membership?.communicationDisabledUntil;
  if (disabledUntil && new Date(disabledUntil).getTime() > Date.now()) {
    return {
      status: 403,
      body: { error: 'You are timed out from this server', communicationDisabledUntil: new Date(disabledUntil).toISOString() },
    };
  }
  if (actions.length === 0) return null;
  const [source, serverOwnerId] = await Promise.all([
    permissionSourceFor(channel),
    getServerOwnerIdCached(channel.serverId),
  ]);
  const perms = await computeMemberChannelPermissions(source, userId, membership ?? null, serverOwnerId);
  // Threads speak with SEND_MESSAGES_IN_THREADS (resolved on the parent), as in Discord.
  const inThread = channel.type === 'public_thread' || channel.type === 'private_thread';
  if (actions.includes('send') && !hasPermissionBit(perms, inThread ? PERM_SEND_MESSAGES_IN_THREADS : PERM_SEND_MESSAGES)) {
    return {
      status: 403,
      body: { error: inThread ? 'You do not have permission to send messages in threads here' : 'You do not have permission to send messages in this channel' },
    };
  }
  if (actions.includes('attach') && !hasPermissionBit(perms, PERM_ATTACH_FILES)) {
    return { status: 403, body: { error: 'You do not have permission to attach files in this channel' } };
  }
  if (actions.includes('react') && !hasPermissionBit(perms, PERM_ADD_REACTIONS)) {
    return { status: 403, body: { error: 'You do not have permission to add reactions in this channel' } };
  }
  return null;
}

/**
 * Whether `user` may post into `channel` (messages, slash commands, reactions).
 * Server channels: timeout + SEND_MESSAGES overwrites. 1:1 DM channels: the
 * same block / DM-privacy rules as POST /dms/:recipientId/messages, so the
 * generic /channels/:dmChannelId routes can't bypass them.
 * Returns null when allowed, or the status + body to reply with.
 */
export async function checkCanPostInChannel(
  channel: IChannel,
  user: DmPolicyUser,
  membership: { roles?: string[] | null } | null | undefined,
  opts: { checkSendPermission?: boolean } = {},
): Promise<{ status: number; body: Record<string, unknown> } | null> {
  if (channel.serverId) {
    const disabledUntil = (membership as { communicationDisabledUntil?: Date | null } | null | undefined)?.communicationDisabledUntil;
    if (disabledUntil && new Date(disabledUntil).getTime() > Date.now()) {
      return {
        status: 403,
        body: { error: 'You are timed out from this server', communicationDisabledUntil: new Date(disabledUntil).toISOString() },
      };
    }
    if (opts.checkSendPermission !== false) {
      const denied = await checkCanSpeak(channel as never, (membership ?? null) as never, user.id, ['send']);
      if (denied) return denied;
    }
    return null;
  }

  if (channel.type === 'dm') {
    const otherId = ((channel.recipientIds || []) as string[]).find((r) => !compareIds(r, user.id));
    if (!otherId) return null;
    const recipient = await User.findById(otherId);
    if (!recipient) return null;
    const reason = dmSendDenyReason(user, recipient, { recipientIsSystem: isSystemUser(recipient.id) });
    if (reason) return { status: 403, body: { error: reason } };
  }
  return null;
}

/**
 * MANAGE_WEBHOOKS in a server: owner, ADMINISTRATOR, or the MANAGE_WEBHOOKS bit.
 */
async function canManageWebhooksInServer(
  serverId: string,
  userId: string,
  membership?: { roles?: string[] | null } | null,
): Promise<boolean> {
  const ownerId = await getServerOwnerIdCached(serverId);
  if (ownerId && compareIds(ownerId, userId)) return true;
  const member = membership ?? await ServerMember.findOne({ serverId, userId });
  const roleIds = (member?.roles || []) as string[];
  if (roleIds.length === 0) return false;
  const rolePerms = await getRolePermissions(roleIds, serverId);
  for (const [, perms] of rolePerms) {
    if ((perms & PERM_ADMINISTRATOR) === PERM_ADMINISTRATOR) return true;
    if ((perms & PERM_MANAGE_WEBHOOKS) === PERM_MANAGE_WEBHOOKS) return true;
  }
  return false;
}

/**
 * Whether a member may use @everyone/@here, and mention roles that aren't mentionable, in a
 * channel. Server-level permissions come from all their roles (always including the
 * server's @everyone role), then the channel's overwrites apply in Discord's order:
 * @everyone, then the member's roles together, then the member. Owners and administrators
 * always may.
 */
async function canMentionEveryoneInChannel(
  channel: { permissionOverwrites?: any[]; serverId?: string | null },
  userId: string,
): Promise<boolean> {
  const serverId = channel.serverId;
  if (!serverId) return true; // DMs and group DMs have no such permission

  const cachedOwner = await cache.get<string>(`server:owner:${serverId}`);
  const [server, member, everyoneRole] = await Promise.all([
    cachedOwner ? null : Server.findById(serverId),
    ServerMember.findOne({ serverId, userId }),
    Role.findOne({ serverId, isDefault: true }),
  ]);
  const ownerId = cachedOwner || server?.ownerId;
  if (ownerId && compareIds(ownerId, userId)) return true;

  const roleIds = Array.from(new Set([
    ...(everyoneRole ? [everyoneRole.id as string] : []),
    ...(((member?.roles || []) as string[])),
  ]));
  let perms = 0n;
  for (const [, rolePerms] of await getRolePermissions(roleIds, serverId)) perms |= rolePerms;
  if ((perms & PERM_ADMINISTRATOR) === PERM_ADMINISTRATOR) return true;

  const overwrites = (channel.permissionOverwrites || []) as Array<{ id: string; type: string; allow?: string; deny?: string }>;
  const apply = (allow: bigint, deny: bigint) => { perms = (perms & ~deny) | allow; };

  // The @everyone overwrite is keyed by the server id in some places and the role id in others.
  const everyoneOverwrite = overwrites.find((o) => o.type === 'role'
    && (o.id === serverId || (everyoneRole && o.id === everyoneRole.id)));
  if (everyoneOverwrite) apply(BigInt(everyoneOverwrite.allow || '0'), BigInt(everyoneOverwrite.deny || '0'));

  let roleAllow = 0n;
  let roleDeny = 0n;
  for (const roleId of (member?.roles || []) as string[]) {
    if (everyoneRole && roleId === everyoneRole.id) continue;
    const overwrite = overwrites.find((o) => o.type === 'role' && o.id === roleId);
    if (overwrite) {
      roleAllow |= BigInt(overwrite.allow || '0');
      roleDeny |= BigInt(overwrite.deny || '0');
    }
  }
  apply(roleAllow, roleDeny);

  const memberOverwrite = overwrites.find((o) => o.type === 'member' && o.id === userId);
  if (memberOverwrite) apply(BigInt(memberOverwrite.allow || '0'), BigInt(memberOverwrite.deny || '0'));

  return (perms & PERM_MENTION_EVERYONE) === PERM_MENTION_EVERYONE;
}

/**
 * Drop the mentions a sender isn't allowed to make. Without MENTION_EVERYONE in the channel,
 * @everyone/@here stay as plain text and only roles marked mentionable ping. The checks were
 * missing entirely, so the "Mention @everyone" setting did nothing (CORD-59).
 */
async function limitMentionsToPermissions<T extends { mentionEveryone: boolean; mentionedRoleIds: string[] }>(
  mentions: T,
  channel: { permissionOverwrites?: any[]; serverId?: string | null },
  userId: string,
): Promise<T> {
  if (!channel.serverId) return mentions;
  if (!mentions.mentionEveryone && mentions.mentionedRoleIds.length === 0) return mentions;
  if (await canMentionEveryoneInChannel(channel, userId)) return mentions;

  const mentionable = mentions.mentionedRoleIds.length
    ? new Set(((await Role.find({ serverId: channel.serverId, id: { in: mentions.mentionedRoleIds } })) as IRole[])
        .filter((role) => role.mentionable)
        .map((role) => role.id))
    : new Set<string>();
  return {
    ...mentions,
    mentionEveryone: false,
    mentionedRoleIds: mentions.mentionedRoleIds.filter((id) => mentionable.has(id)),
  };
}

const PRESERVED_MESSAGE_TOKEN_REGEX = /<@!?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}>|<@&[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}>|<#(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>|<a?:[a-zA-Z0-9_]+:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}>|<t:-?\d{1,13}(?::[tTdDfFRC](?:\[[^\]]*\])?)?>|<t:-?\d{1,13}>/g;
const USER_MENTION_REGEX = /<@!?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>/g;
const ROLE_MENTION_REGEX = /<@&([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>/g;
const CHANNEL_MENTION_REGEX = /<#([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>/g;

export function sanitizeMessageContent(content: string): string {
  const preservedTokens = new Map<string, string>();
  let tokenIndex = 0;
  const placeholderPrefix = '__SERIKACORD_TOKEN__';
  const withPlaceholders = content.replace(PRESERVED_MESSAGE_TOKEN_REGEX, (token) => {
    const key = `${placeholderPrefix}${tokenIndex++}__`;
    preservedTokens.set(key, token);
    return key;
  });

  // Escape stray '<' characters that aren't part of preserved tokens.
  // The xss library (stripIgnoreTag) treats "< CPU" as a malformed tag and
  // strips it entirely. Escaping to &lt; here preserves the literal character;
  // decodeHtmlEntities() at the end restores it back to '<'.
  const escaped = withPlaceholders.replace(/</g, '&lt;');

  let sanitized = sanitizeInput(escaped);
  for (const [placeholder, token] of preservedTokens) {
    sanitized = sanitized.split(placeholder).join(token);
  }
  return decodeHtmlEntities(sanitized);
}

// Normalize message text for duplicate-spam detection. Lowercases, strips
// diacritics, collapses runs of the same character, and removes everything
// that isn't a letter or digit. This makes trivial variations — extra
// whitespace, punctuation, a tacked-on character, or repeated letters —
// collapse to the same fingerprint so "hi", "hi!", "hii" and "hi ." all match.
function normalizeForSpamCheck(content: string): string {
  return content
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .replace(/(.)\1+/g, '$1')
    .trim();
}

// How many identical (post-normalization) messages in a row before a send is
// blocked as spam. A user may send the same thing 4 times; the 5th is rejected.
const DUPLICATE_SPAM_THRESHOLD = 4;

async function extractMentionsFromContent(
  content: string,
  serverId?: string | null
): Promise<{
  mentionEveryone: boolean;
  mentionedUserIds: string[];
  mentionedRoleIds: string[];
  mentionedChannelIds: string[];
}> {
  const mentionedUserIds: string[] = [];
  const mentionedRoleIds: string[] = [];
  const mentionedChannelIds: string[] = [];

  let match: RegExpExecArray | null;

  USER_MENTION_REGEX.lastIndex = 0;
  while ((match = USER_MENTION_REGEX.exec(content)) !== null) {
    mentionedUserIds.push(match[1]);
  }

  ROLE_MENTION_REGEX.lastIndex = 0;
  while ((match = ROLE_MENTION_REGEX.exec(content)) !== null) {
    mentionedRoleIds.push(match[1]);
  }

  CHANNEL_MENTION_REGEX.lastIndex = 0;
  while ((match = CHANNEL_MENTION_REGEX.exec(content)) !== null) {
    mentionedChannelIds.push(match[1]);
  }

  const dedupedUsers = Array.from(new Set(mentionedUserIds));
  const dedupedRoles = Array.from(new Set(mentionedRoleIds));
  const dedupedChannels = Array.from(new Set(mentionedChannelIds));
  const mentionEveryone = /(^|\s)@(everyone|here)\b/i.test(content);

  if (!serverId) {
    return {
      mentionEveryone,
      mentionedUserIds: dedupedUsers,
      mentionedRoleIds: dedupedRoles,
      mentionedChannelIds: dedupedChannels,
    };
  }

  const normalizedServerId = serverId;

  const [memberRows, roleRows, channelRows] = await Promise.all([
    dedupedUsers.length
      ? ServerMember.find({
          serverId: normalizedServerId,
          userId: { in: dedupedUsers },
        })
      : Promise.resolve([]),
    dedupedRoles.length
      ? Role.find({
          serverId: normalizedServerId,
          id: { in: dedupedRoles },
        })
      : Promise.resolve([]),
    dedupedChannels.length
      ? Channel.find({
          serverId: normalizedServerId,
          id: { in: dedupedChannels },
        })
      : Promise.resolve([]),
  ]);

  return {
    mentionEveryone,
    mentionedUserIds: (memberRows as IServerMember[]).map((row) => row.userId),
    mentionedRoleIds: (roleRows as IRole[]).map((row) => row.id),
    mentionedChannelIds: (channelRows as IChannel[]).map((row) => row.id),
  };
}

// Store active SSE connections for server channels
const activeConnections = processShared(
  'channelConnections',
  () => new Map<string, Set<ReadableStreamDefaultController>>(),
);

// Shared codecs for the SSE hot path (avoid per-event allocations).
const sseEncoder = new TextEncoder();
const sseDecoder = new TextDecoder();

// Unique id for THIS process (shared by both module copies), so the Redis→SSE
// bridge can skip re-delivering events this instance already delivered locally.
const INSTANCE_ID = PROCESS_INSTANCE_ID;
// Single Redis channel carrying all channel SSE events (payload names the channel).
const SSE_BUS = 'sse:channel';

// Deliver an event to SSE connections held by THIS process only.
function deliverToLocalChannel(channelId: string, data: object) {
  const connections = activeConnections.get(channelId);
  if (connections) {
    // Encode once, deliver the same bytes to every connection.
    const encoded = sseEncoder.encode(`data: ${JSON.stringify(data)}\n\n`);
    connections.forEach((controller) => {
      try {
        controller.enqueue(encoded);
      } catch {
        // Connection closed, will be cleaned up
      }
    });
  }
}

// Register a raw SSE write callback into the channel's active connection set.
// Used by server.ts to bypass Next.js response buffering — the raw HTTP response
// writes go directly to the socket, so events are flushed immediately.
//
// When `owner` is given, the stream is tied to that user: its access is
// re-checked periodically and whenever a membership change requests it
// (kick/ban/leave), and `owner.close()` is called after a final "removed"
// event once the user can no longer view the channel.
export function registerRawSSEConnection(
  channelId: string,
  write: (data: string) => void,
  owner?: { userId: string; close: () => void },
): () => void {
  const controller = {
    enqueue: (data: Uint8Array) => { try { write(sseDecoder.decode(data)); } catch { /* closed */ } },
  } as unknown as ReadableStreamDefaultController;

  if (!activeConnections.has(channelId)) {
    activeConnections.set(channelId, new Set());
  }
  activeConnections.get(channelId)!.add(controller);

  const detach = () => {
    const set = activeConnections.get(channelId);
    if (!set) return;
    set.delete(controller);
    // Drop the channel's entry entirely once its last stream closes — otherwise
    // the map keeps one empty Set per channel ever streamed, forever.
    if (set.size === 0) activeConnections.delete(channelId);
  };

  const disposeGuard = owner
    ? attachChannelAccessGuard(owner.userId, channelId, () => {
        detach();
        try { write(CHANNEL_STREAM_REVOKED_EVENT); } catch { /* closed */ }
        owner.close();
      })
    : () => {};

  return () => {
    disposeGuard();
    detach();
  };
}

/**
 * Re-check a user's access to a channel while their stream is open: on a
 * timer (backstop for role/overwrite edits) and on demand via
 * requestUserChannelStreamRecheck (kick/ban/leave). Calls `revoke` once when
 * access is gone. Returns a dispose function.
 */
function attachChannelAccessGuard(userId: string, channelId: string, revoke: () => void): () => void {
  let done = false;
  const revalidate = async () => {
    if (done) return;
    let hasAccess = true;
    try {
      ({ hasAccess } = await checkChannelAccess(userId, channelId));
    } catch {
      return; // transient DB error: keep the stream, try again next tick
    }
    if (hasAccess || done) return;
    dispose();
    revoke();
  };
  const timer = setInterval(() => { void revalidate(); }, CHANNEL_STREAM_RECHECK_MS);
  const untrack = trackUserChannelStream(userId, { channelId, revalidate });
  function dispose() {
    if (done) return;
    done = true;
    clearInterval(timer);
    untrack();
  }
  return dispose;
}

// Publish a channel event: deliver locally AND fan out over Redis so every
// other app instance delivers it to its own SSE connections at the same time.
// This is what makes chat realtime for all users regardless of which instance
// they're connected to. Redis (not Postgres) is the right tool here — the
// bottleneck was never the datastore, it was the missing pub/sub fan-out.
// Cross-instance "re-check this user's channel streams" control message,
// carried on the same bus (no channelId, so older instances ignore it).
setChannelStreamRecheckPublisher((userId: string) => {
  const pub = getPublisher();
  if (!pub) return;
  pub
    .publish(SSE_BUS, JSON.stringify({ originId: INSTANCE_ID, control: 'recheck_user', userId }))
    .catch(() => { /* best-effort cross-instance fan-out */ });
});

export function publishToChannel(channelId: string, data: object) {
  deliverToLocalChannel(channelId, data);
  const pub = getPublisher();
  if (pub) {
    pub
      .publish(SSE_BUS, JSON.stringify({ originId: INSTANCE_ID, channelId, data }))
      .catch(() => { /* best-effort cross-instance fan-out */ });
  }
}

// Subscribe this process to the channel SSE bus. Call once at startup with a
// DEDICATED ioredis connection (a subscriber can't issue normal commands).
export async function startChannelSSEBridge(): Promise<() => void> {
  const Redis = (await import('ioredis')).default;
  const sub = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: null });
  sub.on('error', (err: Error) => console.error('SSE bridge Redis error:', err.message));
  await sub.connect().catch((err: Error) => console.error('SSE bridge connect failed:', err.message));
  await sub.subscribe(SSE_BUS);
  sub.on('message', (_ch: string, payload: string) => {
    try {
      const { originId, channelId, data, control, userId } = JSON.parse(payload) as {
        originId: string; channelId?: string; data?: object; control?: string; userId?: string;
      };
      // Skip events this instance already delivered locally.
      if (originId === INSTANCE_ID) return;
      if (control === 'recheck_user') {
        if (userId) void recheckLocalUserChannelStreams(userId);
        return;
      }
      if (!channelId || !data) return;
      deliverToLocalChannel(channelId, data);
    } catch (err) {
      console.error('SSE bridge: bad payload', err);
    }
  });
  console.log(`✅ Channel SSE bridge subscribed to ${SSE_BUS}`);
  return () => { void sub.quit().catch(() => {}); };
}

// Helper function for auth
async function getAuth(headers: Record<string, string | undefined>, cookie: Record<string, { value?: unknown }>) {
  const authHeader = headers.authorization ?? null;
  const authToken = cookie.auth_token?.value;
  const cookies: Record<string, string> = {};
  if (typeof authToken === 'string') {
    cookies.auth_token = authToken;
  }
  return authenticateRequest(authHeader, cookies);
}

// Helper to check channel access.
//
// `opts.lean` is kept for API compat but has no effect with Drizzle — all
// callers get a plain object back. Callers that mutate must use `updateById`.
//
// The resolved `membership` doc is returned so callers don't re-query it.
export async function checkChannelAccess(userId: string, channelId: string, opts: { lean?: boolean } = {}): Promise<{
  hasAccess: boolean;
  channel?: any;
  membership?: { roles?: string[] | null; nickname?: string | null; communicationDisabledUntil?: Date | null } | null;
  error?: string;
}> {
  const channel = await Channel.findById(channelId);

  if (!channel) {
    return { hasAccess: false, error: 'Channel not found' };
  }

  // DM channels
  if (channel.type === 'dm' || channel.type === 'group_dm') {
    if (!channel.recipientIds?.some((r: string) => compareIds(r, userId))) {
      return { hasAccess: false, error: 'You do not have access to this channel' };
    }
    return { hasAccess: true, channel };
  }

  // Server channels
  if (channel.serverId) {
    // Fetch membership and server in parallel — they're independent queries
    // that were previously serial, adding an extra round-trip on every request.
    // Threads inherit the parent's visibility, so load it alongside.
    const isThread = channel.type === 'public_thread' || channel.type === 'private_thread';
    const [membership, server, parent] = await Promise.all([
      ServerMember.findOne({ serverId: channel.serverId, userId }),
      Server.findById(channel.serverId),
      isThread && channel.parentId ? Channel.findById(channel.parentId) : Promise.resolve(null),
    ]);

    if (!membership) {
      return { hasAccess: false, error: 'You are not a member of this server' };
    }

    // Private threads / tickets: only the creator, explicit members, holders of a
    // configured ticket-access role, or server staff (owner) may view.
    if (channel.type === 'private_thread') {
      const isOwner = compareIds(channel.ownerId ?? '', userId);
      const isMember = (channel.threadMemberIds || []).some((m: string) => compareIds(m, userId));
      if (!isOwner && !isMember) {
        const isServerOwner = server ? compareIds(server.ownerId, userId) : false;
        let hasAccessRole = false;
        if (!isServerOwner && parent) {
          const accessRoles = (parent?.ticketAccessRoleIds || []).map((r: string) => r);
          if (accessRoles.length) {
            const memberRoles = (membership.roles || []).map((r: string) => r);
            hasAccessRole = memberRoles.some((r: string) => accessRoles.includes(r));
          }
        }
        // Thread moderators (MANAGE_THREADS) see private threads too.
        const canManageThreads = !isServerOwner && !hasAccessRole && !!server
          && await hasServerPermission({ id: server.id, ownerId: server.ownerId }, userId, PERM_MANAGE_THREADS, membership);
        if (!isServerOwner && !hasAccessRole && !canManageThreads) {
          return { hasAccess: false, error: 'You do not have access to this thread' };
        }
      }
    }

    // VIEW_CHANNEL from base role permissions + overwrites. Threads have no
    // overwrites of their own: a post in a private forum is as private as the forum.
    const serverOwnerId = server?.ownerId ?? null;
    const canView = await canViewChannel(
      { permissionOverwrites: ((parent ?? channel).permissionOverwrites || []) as ChannelOverwrite[], serverId: channel.serverId },
      userId,
      membership,
      serverOwnerId,
    );
    if (!canView) {
      return { hasAccess: false, error: 'You do not have permission to view this channel' };
    }

    return { hasAccess: true, channel, membership };
  }

  return { hasAccess: false, error: 'Invalid channel' };
}

/**
 * Every channel (including threads) of a server the user can view, applying the
 * same rules as checkChannelAccess but in one pass: one membership/owner/role
 * lookup and one permission computation per overwrite source (threads resolve
 * against their parent). Returns null when the user isn't a member. Used by
 * server-wide message search so it can never return messages from a channel
 * the searcher can't open.
 */
export async function listViewableServerChannels(userId: string, serverId: string): Promise<IChannel[] | null> {
  const [membership, serverOwnerId, channels] = await Promise.all([
    ServerMember.findOne({ serverId, userId }),
    getServerOwnerIdCached(serverId),
    Channel.find({ serverId }),
  ]);
  if (!membership) return null;
  const isOwner = Boolean(serverOwnerId && compareIds(serverOwnerId, userId));
  const byId = new Map(channels.map((c) => [c.id, c]));
  const memberRoles = (membership.roles || []) as string[];
  const canViewSource = new Map<string, boolean>();
  const out: IChannel[] = [];
  for (const channel of channels) {
    if (channel.type === 'category' || channel.type === 'dm' || channel.type === 'group_dm') continue;
    const isThread = channel.type === 'public_thread' || channel.type === 'private_thread';
    const parent = isThread && channel.parentId ? byId.get(channel.parentId) ?? null : null;
    if (channel.type === 'private_thread' && !isOwner) {
      const isCreator = compareIds(channel.ownerId ?? '', userId);
      const isMember = (channel.threadMemberIds || []).some((m: string) => compareIds(m, userId));
      const accessRoles = (parent?.ticketAccessRoleIds || []) as string[];
      const hasAccessRole = accessRoles.length > 0 && memberRoles.some((r) => accessRoles.includes(r));
      if (!isCreator && !isMember && !hasAccessRole) continue;
    }
    const source = parent ?? channel;
    let canView = canViewSource.get(source.id);
    if (canView === undefined) {
      canView = await canViewChannel(
        { permissionOverwrites: (source.permissionOverwrites || []) as ChannelOverwrite[], serverId },
        userId,
        membership,
        serverOwnerId,
      );
      canViewSource.set(source.id, canView);
    }
    if (canView) out.push(channel);
  }
  return out;
}

/**
 * Returns true if a member (with the given role ids) can see every ticket in a
 * ticket-mode forum — i.e. server owner or holder of a configured access role.
 */
async function canAccessAllTickets(
  serverId: string,
  userId: string,
  memberRoleIds: string[],
  ticketAccessRoleIds: string[],
): Promise<boolean> {
  const server = await Server.findById(serverId);
  if (server && compareIds(server.ownerId, userId)) return true;
  const access = (ticketAccessRoleIds || []).map((r) => r);
  const mine = (memberRoleIds || []).map((r) => r);
  return mine.some((r) => access.includes(r));
}

// Discord bridge replication helper

/**
 * Convert Serika-formatted content to Discord-friendly text.
 * Serika uses UUID-based mention tokens (<@uuid>, <@&uuid>, <#uuid>) and
 * UUID-based custom emoji tokens (<:name:uuid>). Discord can't resolve these,
 * so we convert them to readable text fallbacks.
 */
function formatSerikaContentForDiscord(content: string): string {
  if (!content) return '';
  let result = content;
  // User mentions: <@uuid> → @username (we don't have the username here, so just @user)
  result = result.replace(/<@!?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}>/g, '@user');
  // Role mentions: <@&uuid> → @rolename
  result = result.replace(/<@&[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}>/g, '@role');
  // Channel mentions: <#uuid> → #channel
  result = result.replace(/<#[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}>/g, '#channel');
  // Custom emoji: <:name:uuid> or <:name:uuid> → :name: (Discord can't resolve Serika emoji IDs)
  result = result.replace(/<a?:([a-zA-Z0-9_]+):[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}>/g, ':$1:');
  // @everyone / @here are already plain text, pass through
  return result;
}

async function replicateToDiscord(action: 'create' | 'edit' | 'delete', channelId: string, message: any) {
  try {
    const channel = await Channel.findById(channelId);
    if (!channel || !channel.serverId) return;
    const server = await Server.findById(channel.serverId);
    if (!server) return;
    const integrations = (server.settings as IServerSettings | undefined)?.integrations || {};
    if (!integrations.discord) return;

    // Avoid feedback loops from Discord-bridged users
    if (message.author?.isDiscord || message.author?.username?.startsWith('discord-')) {
      return;
    }

    // Outbound consent gate: only forward a Serika user's messages to Discord if
    // they have explicitly agreed to their content being processed by Discord.
    // If not agreed, NEVER sync this user. (Deletes are allowed through so a
    // previously-synced message can still be removed from Discord.)
    if (action !== 'delete') {
      const authorId = message.authorId || message.author?.id;
      if (authorId) {
        const author = await User.findById(authorId);
        const consented = Boolean((author?.settings as IUserSettings | undefined)?.dataPrivacy?.discordBridgeOutbound);
        if (!consented) {
          console.log(`[Discord Bridge] Author ${authorId} has not consented to Discord processing — skipping outbound sync.`);
          return;
        }
      }
    }

    const guildId = integrations.discordGuildId;
    const webhookUrl = (integrations.discordWebhooks as Record<string, string> | undefined)?.[channelId];

    if (!webhookUrl) return;

    console.log(`[Discord Bridge] Replicating ${action} on channel #${channel.name} to Discord (Guild: ${guildId})`);

    const username = message.author?.displayName || message.author?.username || 'User';
    const avatarUrl = message.author?.avatar || undefined;
    const webhookUserPart = {
      username: `${username} (Serika)`,
      avatar_url: avatarUrl,
      // Bridged messages may never ping @everyone/@here or any role. Allow only
      // direct user mentions to resolve. This is applied to every webhook body.
      allowed_mentions: { parse: ['users'] as string[] },
    };

    // Build Discord-friendly content from Serika content. Webhooks can't create
    // native replies, so a Serika reply is rendered as a Discord-style quote line
    // referencing the replied-to author + a snippet of their message.
    let replyPrefix = '';
    if (action === 'create' && message.referencedMessageId) {
      try {
        const refMsg = await Message.findById(message.referencedMessageId);
        // Only quote a live message from this same channel.
        if (refMsg && refMsg.channelId === message.channelId && !refMsg.isDeleted) {
          const refAuthor = await User.findById(refMsg.authorId);
          const refName = refAuthor?.displayName || refAuthor?.username || 'someone';
          let refText = '';
          try { refText = refMsg.content ? await decryptFromStorage(refMsg.content) : ''; } catch { /* ignore */ }
          refText = refText.replace(/\n/g, ' ').slice(0, 80);
          replyPrefix = `> **@${refName}**${refText ? `: ${refText}` : ''}\n`;
        }
      } catch { /* best-effort reply quoting */ }
    }
    const discordContent = `${replyPrefix}${formatSerikaContentForDiscord(message.content || '')}`;

    // Build embeds from attachments — handle images, videos, and other files.
    // Spoilered images are returned as URLs to be appended to the content as
    // ||url|| (Discord renders this as a spoilered image), since embeds don't
    // support spoiler tags.
    const spoileredImageUrls: string[] = [];
    const buildAttachmentEmbeds = (attachments: any[]): any[] => {
      if (!attachments || !Array.isArray(attachments)) return [];
      const embeds: any[] = [];
      for (const att of attachments) {
        const url = att.url || att;
        const contentType = att.contentType || '';
        const filename = att.filename || '';
        const isSpoiler = att.spoiler === true;
        if (contentType.startsWith('image/')) {
          if (isSpoiler) {
            spoileredImageUrls.push(url);
          } else {
            embeds.push({ image: { url } });
          }
        } else if (contentType.startsWith('video/')) {
          embeds.push({ video: { url } });
        } else if (contentType.startsWith('audio/')) {
          embeds.push({
            title: filename || 'Audio file',
            description: `[${filename || 'Audio file'}](${url})`,
            color: 0x8B5CF6,
          });
        } else {
          // Other files (PDF, text, etc.) — link in description
          embeds.push({
            title: filename || 'File',
            description: `[${filename || 'Download file'}](${url})`,
            color: 0x5865F2,
          });
        }
      }
      return embeds;
    };

    if (action === 'create') {
      const spoilerSuffix = spoileredImageUrls.length > 0
        ? '\n' + spoileredImageUrls.map(u => `||${u}||`).join('\n')
        : '';
      const body: any = {
        content: discordContent + spoilerSuffix,
        ...webhookUserPart,
      };
      const embeds = buildAttachmentEmbeds(message.attachments);
      if (embeds.length > 0) body.embeds = embeds;

      // Add sticker as embed if present
      if (message.sticker?.imageUrl) {
        body.embeds = [...(body.embeds || []), { image: { url: message.sticker.imageUrl } }];
      }

      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(err => console.error('[Discord Bridge] Failed to post to webhook:', err));

      // Store the Discord message ID for future edit/delete
      if (res && res.ok) {
        const discordMsg = await res.json().catch(() => null);
        if (discordMsg?.id && message.id) {
          await Message.updateById(message.id, { discordMessageId: discordMsg.id }).catch(err => {
            console.error(`[Discord Bridge] Failed to store Discord message ID ${discordMsg.id} for Serika message ${message.id}:`, err);
          });
          console.log(`[Discord Bridge] Stored Discord message ID ${discordMsg.id} for Serika message ${message.id}`);
        }
      }
    }

    if (action === 'edit') {
      // Look up the Discord message ID from the Serika message
      const serikaMsg = message.id ? await Message.findById(message.id) : null;
      const discordMsgId = serikaMsg?.discordMessageId;

      if (discordMsgId) {
        // Edit the existing webhook message via PATCH
        const editUrl = `${webhookUrl}/messages/${discordMsgId}`;
        const editSpoilerSuffix = spoileredImageUrls.length > 0
          ? '\n' + spoileredImageUrls.map(u => `||${u}||`).join('\n')
          : '';
        const body: any = {
          content: discordContent + editSpoilerSuffix,
          allowed_mentions: { parse: ['users'] },
        };
        const embeds = buildAttachmentEmbeds(message.attachments);
        if (embeds.length > 0) body.embeds = embeds;

        const res = await fetch(editUrl, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).catch(err => console.error('[Discord Bridge] Failed to edit webhook message:', err));

        if (res && !res.ok) {
          // If edit fails (message too old, deleted, etc.), fall back to delete + repost
          console.warn(`[Discord Bridge] Edit failed (${res.status}), falling back to delete + repost`);
          await fetch(editUrl, { method: 'DELETE' }).catch(() => {});
          // Post a new message
          const repostBody: any = {
            content: discordContent + editSpoilerSuffix,
            ...webhookUserPart,
          };
          if (embeds.length > 0) repostBody.embeds = embeds;
          const repostRes = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(repostBody),
          }).catch(() => null);
          if (repostRes && repostRes.ok) {
            const newDiscordMsg = await repostRes.json().catch(() => null);
            if (newDiscordMsg?.id && message.id) {
              await Message.updateById(message.id, { discordMessageId: newDiscordMsg.id }).catch(() => {});
            }
          }
        }
      } else {
        // No Discord message ID stored — post as new message with edit indicator
        const editFallbackSpoilerSuffix = spoileredImageUrls.length > 0
          ? '\n' + spoileredImageUrls.map(u => `||${u}||`).join('\n')
          : '';
        const body: any = {
          content: `*(edited)* ${discordContent}${editFallbackSpoilerSuffix}`,
          ...webhookUserPart,
        };
        const embeds = buildAttachmentEmbeds(message.attachments);
        if (embeds.length > 0) body.embeds = embeds;
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).catch(err => console.error('[Discord Bridge] Failed to post edit fallback:', err));
      }
    }

    if (action === 'delete') {
      // Look up the Discord message ID
      const serikaMsg = message.id ? await Message.findById(message.id) : null;
      const discordMsgId = serikaMsg?.discordMessageId;

      if (discordMsgId) {
        const deleteUrl = `${webhookUrl}/messages/${discordMsgId}`;
        const res = await fetch(deleteUrl, {
          method: 'DELETE',
        }).catch(err => console.error('[Discord Bridge] Failed to delete webhook message:', err));
        if (res && !res.ok) {
          console.error(`[Discord Bridge] Delete webhook message returned ${res.status}: ${await res.text().catch(() => '')}`);
        } else {
          console.log(`[Discord Bridge] Deleted Discord message ${discordMsgId} for Serika message ${message.id}`);
        }
      } else {
        console.log(`[Discord Bridge] No Discord message ID stored for Serika message ${message.id} — cannot delete on Discord.`);
      }
    }
  } catch (err) {
    console.error('[Discord Bridge] Error in replicateToDiscord:', err);
  }
}

/**
 * The channel message a thread was started from, shaped like a fetched
 * message (for the top of the thread view). Null when it's gone.
 */
async function loadStarterMessage(messageId: string, parentId: string) {
  if (!isValidObjectId(messageId)) return null;
  const msg = await Message.findOne({ id: messageId, channelId: parentId, isDeleted: false });
  if (!msg) return null;
  const [author, content] = await Promise.all([
    msg.authorId ? User.findById(msg.authorId) : Promise.resolve(null),
    decryptFromStorage(msg.content || ''),
  ]);
  return {
    id: msg.id,
    channelId: msg.channelId,
    content,
    authorId: msg.authorId,
    author: author ? {
      id: author.id,
      username: author.username,
      displayName: author.displayName || author.username,
      avatar: author.avatar,
      isBot: Boolean(author.isBot),
    } : null,
    createdAt: msg.createdAt,
    edited: msg.edited,
    attachments: msg.attachments || [],
    sticker: msg.sticker || undefined,
  };
}

/** Thread owner, server owner, or MANAGE_THREADS (on the parent): rename, archive, lock, delete. */
async function canManageThreadAs(
  thread: { ownerId?: string | null; serverId?: string | null; type?: string | null; parentId?: string | null; permissionOverwrites?: unknown },
  userId: string,
  membership: { roles?: string[] | null } | null | undefined,
): Promise<boolean> {
  if (thread.ownerId && compareIds(thread.ownerId, userId)) return true;
  return hasPermissionBit(await memberPermissionsIn(thread, userId, membership), PERM_MANAGE_THREADS);
}

type ThreadCreateUser = { id: string; username: string; displayName?: string | null; avatar?: string | null; badges?: string[] | null; isBot?: boolean | null; isSystem?: boolean | null; isVerified?: boolean | null; customization?: unknown };

/**
 * Start a thread in a text / announcement channel (Discord "Create Thread"):
 * from a message (the message gets the thread chip) or from the header (a
 * "X started a thread" row is posted). Optional first message in the thread.
 */
async function createChannelThread(
  parent: IChannel,
  user: ThreadCreateUser,
  membership: { roles?: string[] | null; communicationDisabledUntil?: Date | null } | null | undefined,
  body: { name: string; content?: string; messageId?: string; type?: 'public' | 'private'; autoArchiveDuration?: number },
): Promise<{ status: number; body: Record<string, unknown> }> {
  // Timed-out members can't start threads.
  const timedOut = await checkCanSpeak(parent, membership, user.id, []);
  if (timedOut) return timedOut;

  const fromMessage = Boolean(body.messageId);
  const wantsPrivate = body.type === 'private' && !fromMessage;
  const perms = await memberPermissionsIn(parent, user.id, membership);
  if (!hasPermissionBit(perms, wantsPrivate ? PERM_CREATE_PRIVATE_THREADS : PERM_CREATE_PUBLIC_THREADS)) {
    return { status: 403, body: { error: wantsPrivate ? 'You do not have permission to create private threads here' : 'You do not have permission to create threads here' } };
  }
  const content = (body.content ?? '').trim() ? body.content! : '';
  if (content && !hasPermissionBit(perms, PERM_SEND_MESSAGES_IN_THREADS)) {
    return { status: 403, body: { error: 'You do not have permission to send messages in threads here' } };
  }
  if (!fromMessage && !content) {
    return { status: 400, body: { error: 'A thread needs a first message' } };
  }

  const [limit, globalLimit] = await Promise.all([
    checkRateLimit('message', `${user.id}:${parent.id}`),
    checkRateLimit('messageGlobal', user.id),
  ]);
  if (!limit.success || !globalLimit.success) {
    return { status: 429, body: { error: 'You are creating threads too fast', retryAfter: !limit.success ? limit.retryAfter : globalLimit.retryAfter } };
  }

  const name = cleanThreadName(sanitizeInput(body.name));
  if (!name) return { status: 400, body: { error: 'Thread name is required' } };
  if (content) {
    const validation = validateMessageContent(content);
    if (!validation.valid) return { status: 400, body: { error: validation.error } };
  }

  let starter: IMessage | null = null;
  if (body.messageId) {
    starter = isValidObjectId(body.messageId)
      ? await Message.findOne({ id: body.messageId, channelId: parent.id, isDeleted: false })
      : null;
    if (!starter) return { status: 404, body: { error: 'Message not found' } };
    if (starter.threadId) return { status: 409, body: { error: 'A thread already exists for this message', threadId: starter.threadId } };
    if (starter.type !== 'default' && starter.type !== 'reply') {
      return { status: 400, body: { error: 'You cannot start a thread from this message' } };
    }
  }

  const autoArchiveDuration = normalizeAutoArchiveDuration(
    body.autoArchiveDuration,
    normalizeAutoArchiveDuration(parent.defaultAutoArchiveDuration),
  );
  const thread = await Channel.create({
    serverId: parent.serverId,
    name,
    type: wantsPrivate ? 'private_thread' : 'public_thread',
    parentId: parent.id,
    ownerId: user.id,
    position: 0,
    threadMemberIds: [user.id],
    messageCount: 0,
    archived: false,
    locked: false,
    autoArchiveDuration,
    starterMessageId: starter?.id ?? null,
  });

  if (starter && !(await claimStarterMessage(starter.id, thread.id))) {
    // Someone else started a thread on it a moment earlier.
    await Channel.deleteById(thread.id);
    const fresh = await Message.findById(starter.id);
    return { status: 409, body: { error: 'A thread already exists for this message', threadId: fresh?.threadId ?? null } };
  }

  // The first message in the thread.
  let firstMessage: IMessage | null = null;
  let mentionedUserIds: string[] = [];
  if (content) {
    const sanitizedContent = normalizeEmojiFormat(sanitizeMessageContent(content));
    const mentionData = await limitMentionsToPermissions(
      await extractMentionsFromContent(sanitizedContent, parent.serverId || null),
      parent as Parameters<typeof limitMentionsToPermissions>[1],
      user.id,
    );
    mentionedUserIds = mentionData.mentionedUserIds;
    firstMessage = await Message.create({
      channelId: thread.id,
      serverId: parent.serverId,
      authorId: user.id,
      content: await encryptForStorage(sanitizedContent),
      type: 'default',
      mentionEveryone: mentionData.mentionEveryone,
      mentionedUserIds: mentionData.mentionedUserIds,
      mentionedRoleIds: mentionData.mentionedRoleIds,
      mentionedChannelIds: mentionData.mentionedChannelIds,
    });
    await Channel.updateById(thread.id, { lastMessageId: firstMessage.id, messageCount: 1 });
    const joined = await addThreadMembers(thread.id, threadMembersToAdd([user.id], user.id, mentionedUserIds));
    notifyThreadMembership(parent.serverId, thread.id, joined);
    void signalChannelMessage({
      channel: { id: thread.id, serverId: parent.serverId, name, parentId: parent.id },
      messageId: firstMessage.id,
      authorId: user.id,
      authorName: user.displayName || user.username,
      authorAvatar: user.avatar ?? null,
      mentionedUserIds: mentionData.mentionedUserIds,
      mentionEveryone: mentionData.mentionEveryone,
      content: sanitizedContent,
      createdAt: firstMessage.createdAt,
    });
  }

  const row = (await Channel.findById(thread.id)) ?? thread;
  const summary = (await loadThreadSummaries([row])).get(row.id) ?? null;

  // Header thread: Discord's "X started a thread: name" row in the channel
  // (public threads only: a private thread isn't announced).
  if (!starter && !wantsPrivate) {
    const notice = await Message.create({
      channelId: parent.id,
      serverId: parent.serverId,
      authorId: user.id,
      content: await encryptForStorage(name),
      type: 'thread_created',
      threadId: thread.id,
    });
    publishToChannel(parent.id, {
      type: 'message',
      message: {
        id: notice.id,
        content: name,
        authorId: user.id,
        author: {
          id: user.id,
          username: user.username,
          displayName: membership && (membership as { nickname?: string | null }).nickname || user.displayName || user.username,
          avatar: user.avatar,
          badges: user.badges || [],
          isBot: Boolean(user.isBot),
          isSystem: Boolean(user.isSystem),
          isVerified: Boolean(user.isVerified),
        },
        channelId: parent.id,
        serverId: parent.serverId,
        createdAt: notice.createdAt,
        updatedAt: notice.updatedAt,
        type: 'thread_created',
        threadId: thread.id,
        thread: summary,
        attachments: [],
        embeds: [],
        reactions: [],
        mentionedUserIds: [],
        mentionedRoleIds: [],
        mentionedChannelIds: [],
      },
    });
  }

  // Open threads browsers refetch; the starter's chip appears.
  publishToChannel(parent.id, { type: 'thread_create', threadId: thread.id });
  await broadcastThreadUpdate(row);
  notifyThreadMembership(parent.serverId, thread.id, [user.id]);

  return { status: 200, body: { success: true, thread: summary ?? { id: thread.id, name, parentId: parent.id } } };
}

export const channelRoutes = new Elysia({ prefix: '/channels' })
  // Get channel
  .get('/:channelId', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { hasAccess, channel, membership, error } = await checkChannelAccess(
      user.id,
      params.channelId
    );

    if (!hasAccess) {
      set.status = 403;
      return { error };
    }

    // Expose the parent forum name for thread channels so the client can
    // render the forum post list alongside the open thread. Threads also carry
    // their summary, the starter message and what the viewer may do with them
    // (thread panel / full view header).
    if (channel && (channel.type === 'public_thread' || channel.type === 'private_thread') && channel.parentId) {
      const parent = await Channel.findById(channel.parentId);
      const [summaries, starterMessage, canManageThread] = await Promise.all([
        loadThreadSummaries([channel]),
        channel.starterMessageId ? loadStarterMessage(channel.starterMessageId, channel.parentId) : Promise.resolve(null),
        canManageThreadAs(channel, user.id, membership),
      ]);
      const enriched = {
        ...channel,
        parentName: parent?.name,
        parentType: parent?.type ?? null,
        parentId: channel.parentId,
        // Threads have no overwrites of their own: the parent's apply.
        permissionOverwrites: parent?.permissionOverwrites ?? channel.permissionOverwrites,
        thread: summaries.get(channel.id) ?? null,
        starterMessage,
        joined: (channel.threadMemberIds || []).some((m: string) => compareIds(m, user.id)),
        canManageThread,
      };
      return { channel: enriched };
    }

    return { channel };
  }, {
    params: t.Object({
      channelId: t.String(),
    }),
  })
  // List application (bot) slash commands available in this channel, grouped by
  // application, for the composer command palette.
  .get('/:channelId/application-commands', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { hasAccess, channel, error } = await checkChannelAccess(user.id, params.channelId);
    if (!hasAccess || !channel) {
      set.status = 403;
      return { error: error || 'Access denied' };
    }

    const { getChannelAppCommands } = await import('@/lib/services/appCommands');
    const groups = await getChannelAppCommands({
      serverId: channel.serverId ?? null,
      recipientIds: channel.recipientIds ?? null,
    });
    return { groups };
  }, {
    params: t.Object({
      channelId: t.String(),
    }),
  })
  // Invoke a bot slash (application) command. The composer routes app-command
  // sends here instead of posting them as messages, so the raw "/command" text
  // never appears in the channel. The bot's response (or ephemeral reply)
  // arrives over the normal channel SSE stream.
  .post('/:channelId/interactions', async ({ headers, cookie, params, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    const { hasAccess, channel, membership, error } = await checkChannelAccess(user.id, params.channelId);
    if (!hasAccess || !channel) {
      set.status = 403;
      return { error: error || 'Access denied' };
    }
    const speakDenial = await checkCanSpeak(channel, membership, user.id, ['send']);
    if (speakDenial) {
      set.status = speakDenial.status;
      return speakDenial.body;
    }
    // Same gate as sending a message: a timed-out member, or one without
    // SEND_MESSAGES here, can't make a bot post on their behalf either.
    const postDenied = await checkCanPostInChannel(channel, user, membership);
    if (postDenied) {
      set.status = postDenied.status;
      return postDenied.body;
    }
    const content = String((body as { content?: string }).content ?? '').trim();
    if (!content.startsWith('/')) {
      set.status = 400;
      return { error: 'Not a command invocation' };
    }
    const { dispatchSlashCommand } = await import('@/lib/services/interactions');
    const consumed = await dispatchSlashCommand({
      content,
      channelId: params.channelId,
      serverId: channel.serverId ?? null,
      author: { id: user.id, username: user.username ?? undefined, displayName: user.displayName ?? undefined },
    });
    if (!consumed) {
      set.status = 404;
      return { error: 'Unknown command' };
    }
    return { ok: true };
  }, {
    params: t.Object({
      channelId: t.String(),
    }),
    body: t.Object({
      content: t.String({ maxLength: 4000 }),
    }),
  })
  // Update channel
  .patch('/:channelId', async ({ headers, cookie, params, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { hasAccess, channel, membership: editorMembership, error } = await checkChannelAccess(
      user.id,
      params.channelId
    );

    if (!hasAccess || !channel) {
      set.status = 403;
      return { error: error || 'Access denied' };
    }

    const isThread = channel.type === 'public_thread' || channel.type === 'private_thread';

    // Check permissions (owner or manage channels). Thread owners may manage
    // their own thread (rename / archive); MANAGE_THREADS manages any thread,
    // and only it (or Manage Channels) may lock.
    let isServerOwner = false;
    let canManageChannel = false;
    let canModerateThreads = false;
    let editServer: { id: string; ownerId: string } | null = null;
    if (channel.serverId) {
      const server = await Server.findById(channel.serverId);
      editServer = server ? { id: server.id, ownerId: server.ownerId } : null;
      isServerOwner = !!server && compareIds(server.ownerId, user.id);
      canManageChannel = isServerOwner
        || (!!editServer && await hasServerPermission(editServer, user.id, PERM_MANAGE_CHANNELS));
      canModerateThreads = isThread && (canManageChannel
        || hasPermissionBit(await memberPermissionsIn(channel, user.id, editorMembership), PERM_MANAGE_THREADS));
      const isThreadOwner = isThread && compareIds(channel.ownerId, user.id);
      if (isThread && channel.locked && !canModerateThreads) {
        set.status = 403;
        return { error: 'This thread is locked' };
      }
      if (!canManageChannel && !isThreadOwner && !canModerateThreads) {
        set.status = 403;
        return { error: 'You do not have permission to edit this channel' };
      }
    }

    const { name, topic, nsfw, rateLimitPerUser, bitrate, userLimit, parentId, position, permissionOverwrites, type, forumMode, ticketAccessRoleIds, availableTags, archived, locked, autoArchiveDuration } = body;

    // Editing permission overwrites additionally needs Manage Roles (Discord's
    // "Manage Permissions"), so Manage Channels alone cannot grant itself access.
    const overwriteKey = (list: Array<{ id: string; type: string; allow?: string; deny?: string }> | null | undefined) =>
      JSON.stringify((list || []).map((o) => `${o.type}:${o.id}:${o.allow || '0'}:${o.deny || '0'}`).sort());
    const overwritesChanged = permissionOverwrites !== undefined
      && overwriteKey(permissionOverwrites) !== overwriteKey(channel.permissionOverwrites as Array<{ id: string; type: string; allow?: string; deny?: string }> | null | undefined);
    if (overwritesChanged && !isServerOwner) {
      const canManagePerms = !!editServer && await hasServerPermission(editServer, user.id, PERM_MANAGE_ROLES);
      if (!canManagePerms) {
        set.status = 403;
        return { error: 'You need Manage Roles permission to edit channel permissions' };
      }
    }

    const updateData: Record<string, any> = {};
    if (name !== undefined) updateData.name = sanitizeInput(name);
    if (topic !== undefined) updateData.topic = sanitizeInput(topic);
    if (nsfw !== undefined) updateData.nsfw = nsfw;
    // Only text ⇄ announcement conversions are allowed (voice/category are fixed)
    if (type !== undefined && (channel.type === 'text' || channel.type === 'announcement')) {
      if (type === 'text' || type === 'announcement') {
        updateData.type = type;
      }
    }
    if (rateLimitPerUser !== undefined) updateData.rateLimitPerUser = rateLimitPerUser;
    if (bitrate !== undefined) updateData.bitrate = bitrate;
    if (userLimit !== undefined) updateData.userLimit = userLimit;
    if (position !== undefined) updateData.position = position;

    if (permissionOverwrites !== undefined) {
      updateData.permissionOverwrites = permissionOverwrites.map((o: { id: string; type: 'role' | 'member'; allow: string; deny: string }) => ({
        id: o.id,
        type: o.type,
        allow: o.allow,
        deny: o.deny,
      }));
    }

    // A thread's parent is its forum/channel and decides who can read it
    // (ticketAccessRoleIds), so it is never moved through this route.
    if (parentId !== undefined && !isThread && isServerOwner) {
      if (parentId === null) {
        updateData.parentId = null;
      } else {
        if (channel.type === 'category') {
          set.status = 400;
          return { error: 'A category cannot have a parent category' };
        }
        const parentChannel = isValidObjectId(parentId) ? await Channel.findById(parentId) : null;
        if (
          !parentChannel
          || parentChannel.type !== 'category'
          || !parentChannel.serverId
          || !channel.serverId
          || !compareIds(parentChannel.serverId, channel.serverId)
        ) {
          set.status = 400;
          return { error: 'Invalid parent category' };
        }
        updateData.parentId = parentId;
      }
    }

    // Thread self-management. Archive state goes through setThreadArchived
    // (stamps archive_timestamp, which restarts the inactivity clock).
    let threadArchiveChange: { archived: boolean; locked?: boolean } | null = null;
    if (isThread) {
      if (name !== undefined) updateData.name = cleanThreadName(sanitizeInput(name)) || channel.name;
      const nextLocked = locked !== undefined && canModerateThreads ? Boolean(locked) : undefined;
      if (archived !== undefined && Boolean(archived) !== Boolean(channel.archived)) {
        threadArchiveChange = { archived: Boolean(archived), locked: nextLocked };
      } else if (nextLocked !== undefined) {
        updateData.locked = nextLocked;
        // Locking archives too (Discord: a locked thread is closed).
        if (nextLocked && !channel.archived) threadArchiveChange = { archived: true, locked: true };
      }
      if (autoArchiveDuration !== undefined) {
        updateData.autoArchiveDuration = normalizeAutoArchiveDuration(autoArchiveDuration, normalizeAutoArchiveDuration(channel.autoArchiveDuration));
      }
    }

    // Forum configuration (owner or Manage Channels; ticket access also needs Manage Roles)
    if (channel.type === 'forum' && canManageChannel) {
      if (forumMode !== undefined && (forumMode === 'posts' || forumMode === 'tickets')) {
        updateData.forumMode = forumMode;
      }
      if (ticketAccessRoleIds !== undefined && (isServerOwner || (!!editServer && await hasServerPermission(editServer, user.id, PERM_MANAGE_ROLES)))) {
        // Only roles of this server may grant ticket access.
        const requested = [...new Set(ticketAccessRoleIds.filter((id) => typeof id === 'string' && isValidObjectId(id)))];
        const ownRoles = requested.length > 0 && channel.serverId
          ? (await Role.find({ serverId: channel.serverId, id: { in: requested } })) as IRole[]
          : [];
        updateData.ticketAccessRoleIds = ownRoles.map((role) => role.id);
      }
      if (availableTags !== undefined) {
        updateData.availableTags = availableTags.map((tag: { id?: string; name: string; moderated?: boolean; emojiName?: string }) => ({
          id: tag.id || randomUUID(),
          name: tag.name,
          moderated: Boolean(tag.moderated),
          emojiName: tag.emojiName,
        }));
      }
    }

    await Channel.updateById(channel.id, updateData);
    if (threadArchiveChange) {
      await setThreadArchived(channel.id, threadArchiveChange.archived, threadArchiveChange.locked);
    }
    const updated = await Channel.findById(channel.id);

    // Threads: the parent's chip / browser and the thread's own header update
    // live; an archive change adds or removes it from members' sidebars.
    if (isThread && updated) {
      void broadcastThreadUpdate(updated).catch(() => null);
      if (threadArchiveChange || updateData.name !== undefined) {
        notifyThreadMembership(updated.serverId, updated.id, (updated.threadMemberIds || []) as string[]);
      }
    }

    // Publish update event
    const publisher = getPublisher();
    if (publisher) {
      await publisher.publish('channel:update', JSON.stringify({
        channelId: channel.id,
        serverId: channel.serverId,
        updates: body,
      }));
    }

    return { success: true, channel: updated };
  }, {
    params: t.Object({
      channelId: t.String(),
    }),
    body: t.Object({
      name: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
      topic: t.Optional(t.String({ maxLength: 1024 })),
      nsfw: t.Optional(t.Boolean()),
      type: t.Optional(t.Union([t.Literal('text'), t.Literal('announcement')])),
      parentId: t.Optional(t.Union([t.String(), t.Null()])),
      rateLimitPerUser: t.Optional(t.Number({ minimum: 0, maximum: 21600 })),
      bitrate: t.Optional(t.Number({ minimum: 8000, maximum: 384000 })),
      userLimit: t.Optional(t.Number({ minimum: 0, maximum: 99 })),
      position: t.Optional(t.Number({ minimum: 0 })),
      permissionOverwrites: t.Optional(t.Array(t.Object({
        id: t.String(),
        type: t.Union([t.Literal('role'), t.Literal('member')]),
        allow: t.String(),
        deny: t.String(),
      }))),
      forumMode: t.Optional(t.Union([t.Literal('posts'), t.Literal('tickets')])),
      ticketAccessRoleIds: t.Optional(t.Array(t.String())),
      availableTags: t.Optional(t.Array(t.Object({
        id: t.Optional(t.String()),
        name: t.String({ minLength: 1, maxLength: 40 }),
        moderated: t.Optional(t.Boolean()),
        emojiName: t.Optional(t.String()),
      }))),
      archived: t.Optional(t.Boolean()),
      locked: t.Optional(t.Boolean()),
      autoArchiveDuration: t.Optional(t.Number()),
    }),
  })
  // Delete channel
  .delete('/:channelId', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { hasAccess, channel, membership: deleterMembership, error } = await checkChannelAccess(
      user.id,
      params.channelId
    );

    if (!hasAccess || !channel) {
      set.status = 403;
      return { error: error || 'Access denied' };
    }

    // Can't delete DMs this way
    if (channel.type === 'dm' || channel.type === 'group_dm') {
      set.status = 400;
      return { error: 'Cannot delete DM channels' };
    }

    const deletingThread = channel.type === 'public_thread' || channel.type === 'private_thread';

    // Check permissions (threads: MANAGE_THREADS on the parent also deletes)
    if (channel.serverId) {
      const server = await Server.findById(channel.serverId);
      const canDelete = !!server && (
        compareIds(server.ownerId, user.id)
        || await hasServerPermission({ id: server.id, ownerId: server.ownerId }, user.id, PERM_MANAGE_CHANNELS)
        || (deletingThread && hasPermissionBit(await memberPermissionsIn(channel, user.id, deleterMembership), PERM_MANAGE_THREADS))
      );
      if (!canDelete) {
        set.status = 403;
        return { error: 'You do not have permission to delete this channel' };
      }
    }

    // Soft delete messages
    const messages = await Message.find({ channelId: channel.id });
    await Promise.all(messages.map(m => Message.updateById(m.id, { isDeleted: true, deletedAt: new Date() })));

    // A category's channels move out of it rather than being left pointing at a category
    // that no longer exists, which hid them from the channel list entirely.
    const orphaned = channel.type === 'category' && channel.serverId
      ? await Channel.find({ serverId: channel.serverId, parentId: channel.id })
      : [];
    await Promise.all(orphaned.map((child) => Channel.updateById(child.id, { parentId: null })));

    await Channel.deleteById(channel.id);

    // A deleted thread: its starter loses the chip, members' sidebars drop it.
    if (deletingThread && channel.parentId) {
      await releaseThreadMessages(channel.id, channel.parentId).catch(() => {});
      void broadcastThreadUpdate(channel, { deleted: true }).catch(() => null);
      notifyThreadMembership(channel.serverId, channel.id, (channel.threadMemberIds || []) as string[]);
    }

    const publisher = getPublisher();
    if (publisher) {
      for (const child of orphaned) {
        await publisher.publish('channel:update', JSON.stringify({
          channelId: child.id,
          serverId: channel.serverId,
          updates: { parentId: null },
        }));
      }
    }
    if (publisher) {
      await publisher.publish('channel:delete', JSON.stringify({
        channelId: params.channelId,
        serverId: channel.serverId,
      }));
    }

    return { success: true };
  }, {
    params: t.Object({
      channelId: t.String(),
    }),
  })
  // ── Forum threads ─────────────────────────────────────────────────────────
  // List threads (posts / tickets) inside a forum channel.
  .get('/:channelId/threads', async ({ headers, cookie, params, query, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { hasAccess, channel, membership: listerMembership, error } = await checkChannelAccess(user.id, params.channelId);
    if (!hasAccess || !channel) {
      set.status = 403;
      return { error: error || 'Access denied' };
    }

    // Text / announcement channels: the header's threads browser (active and
    // archived threads, joined first on the client).
    if (canHostThreads(channel.type)) {
      const includeArchivedThreads = (query as { archived?: string }).archived === 'true';
      const rows = (await Channel.find({ parentId: channel.id }))
        .filter((t) => t.type === 'public_thread' || t.type === 'private_thread')
        .filter((t) => includeArchivedThreads || !t.archived);
      const isMember = (t: IChannel) => (t.threadMemberIds || []).some((m: string) => compareIds(m, user.id));
      const seesPrivate = rows.some((t) => t.type === 'private_thread' && !isMember(t))
        ? hasPermissionBit(await memberPermissionsIn(channel, user.id, listerMembership), PERM_MANAGE_THREADS)
        : true;
      const visible = rows
        .filter((t) => t.type !== 'private_thread' || isMember(t) || compareIds(t.ownerId ?? '', user.id) || seesPrivate)
        .sort((a, b) => new Date(b.updatedAt ?? b.createdAt ?? 0).getTime() - new Date(a.updatedAt ?? a.createdAt ?? 0).getTime())
        .slice(0, 100);
      const summaries = await loadThreadSummaries(visible);
      return {
        threads: visible
          .map((t) => {
            const summary = summaries.get(t.id);
            return summary ? { ...summary, joined: isMember(t) } : null;
          })
          .filter(Boolean),
      };
    }

    if (channel.type !== 'forum') {
      set.status = 400;
      return { error: 'Channel is not a forum' };
    }

    const includeArchived = (query as { archived?: string }).archived === 'true';
    const allThreads = await Channel.find({ parentId: channel.id });
    // Newest activity first. lastMessageId is a UUID (not a time); updatedAt is
    // bumped whenever a message lands in the thread (Channel.updateById).
    const activityTime = (t: { updatedAt?: Date | string | null; createdAt?: Date | string | null }) => new Date(t.updatedAt ?? t.createdAt ?? 0).getTime() || 0;
    let threads = allThreads
      .filter((t: any) => t.type === 'public_thread' || t.type === 'private_thread')
      .filter((t: any) => includeArchived || !t.archived)
      .sort((a: any, b: any) => activityTime(b) - activityTime(a));

    // Ticket forums: hide tickets the requester isn't a party to (unless staff / access role).
    if (channel.forumMode === 'tickets') {
      const membership = await ServerMember.findOne({ serverId: channel.serverId, userId: user.id });
      const canSeeAll = await canAccessAllTickets(
        channel.serverId,
        user.id,
        (membership?.roles || []) as string[],
        (channel.ticketAccessRoleIds || []) as string[],
      );
      if (!canSeeAll) {
        threads = threads.filter((t: any) =>
          compareIds(t.ownerId, user.id) ||
          (t.threadMemberIds || []).some((m: string) => compareIds(m, user.id)),
        );
      }
    }
    // Limit after the ticket filter so a member's own tickets are never cut.
    threads = threads.slice(0, 100);

    const ownerIds = threads.map((t: any) => t.ownerId).filter(Boolean);
    const owners = ownerIds.length > 0 ? await User.find({ id: { in: ownerIds } }) : [];
    const ownerMap = new Map(owners.map((o: any) => [o.id, o]));

    // Load the first message of each thread for preview / reaction metadata.
    const threadIds = threads.map((t: any) => t.id);
    const firstMessageMap = new Map<string, { content: string; reactionCount: number; createdAt: Date }>();
    if (threadIds.length > 0) {
      // Fetch only the first (oldest) message per thread using _orderAsc + _limit:1
      const firstMsgs = await Promise.all(
        threadIds.map(tid => Message.find({ channelId: tid, isDeleted: false, _limit: 1, _orderAsc: true }))
      );
      for (let i = 0; i < threadIds.length; i++) {
        const threadMsgs = firstMsgs[i];
        if (threadMsgs.length > 0) {
          const first = threadMsgs[0];
          const rawContent = first.content || '';
          const content = rawContent ? await decryptFromStorage(rawContent) : '';
          const reactions = (first.reactions as Array<{ emoji: { name: string; id?: string }; count: number; userIds: string[] }> | undefined) || [];
          const reactionCount = reactions.reduce((sum: number, r: { count?: number }) => sum + (r.count || 0), 0);
          firstMessageMap.set(threadIds[i], { content, reactionCount, createdAt: first.createdAt ?? new Date() });
        }
      }
    }

    return {
      forumMode: channel.forumMode,
      availableTags: channel.availableTags || [],
      threads: threads.map((t: any) => {
        const owner = t.ownerId ? ownerMap.get(t.ownerId) : null;
        const first = firstMessageMap.get(t.id);
        return {
          id: t.id,
          name: t.name,
          type: t.type,
          archived: t.archived,
          locked: t.locked,
          appliedTags: t.appliedTags || [],
          messageCount: t.messageCount || 0,
          lastMessageId: t.lastMessageId || null,
          createdAt: t.createdAt,
          firstMessagePreview: first?.content || '',
          reactionCount: first?.reactionCount || 0,
          owner: owner ? {
            id: owner.id,
            username: owner.username,
            displayName: owner.displayName,
            avatar: owner.avatar,
          } : null,
        };
      }),
    };
  }, {
    params: t.Object({ channelId: t.String() }),
    query: t.Object({ archived: t.Optional(t.String()) }),
  })
  // Create a thread (post / ticket) inside a forum channel.
  .post('/:channelId/threads', async ({ headers, cookie, params, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { hasAccess, channel: forum, membership, error } = await checkChannelAccess(user.id, params.channelId);
    if (!hasAccess || !forum) {
      set.status = 403;
      return { error: error || 'Access denied' };
    }
    if (canHostThreads(forum.type)) {
      const result = await createChannelThread(forum, user, membership, body);
      set.status = result.status;
      return result.body;
    }
    if (forum.type !== 'forum') {
      set.status = 400;
      return { error: 'Channel is not a forum' };
    }

    // A post is a message: same timeout / SEND_MESSAGES / rate limit / slowmode
    // rules as POST /messages.
    const speakDenial = await checkCanSpeak(forum, membership, user.id, ['send']);
    if (speakDenial) {
      set.status = speakDenial.status;
      return speakDenial.body;
    }
    const [postRateLimit, globalPostRateLimit] = await Promise.all([
      checkRateLimit('message', `${user.id}:${forum.id}`),
      checkRateLimit('messageGlobal', user.id),
    ]);
    if (!postRateLimit.success || !globalPostRateLimit.success) {
      set.status = 429;
      return {
        error: 'You are posting too fast',
        retryAfter: !postRateLimit.success ? postRateLimit.retryAfter : globalPostRateLimit.retryAfter,
      };
    }
    if ((forum.rateLimitPerUser ?? 0) > 0 && forum.serverId) {
      const forumOwnerId = await getServerOwnerIdCached(forum.serverId);
      const exempt = (forumOwnerId && compareIds(forumOwnerId, user.id))
        || await canManageMessagesInServer(forum.serverId, user.id, membership);
      if (!exempt) {
        const myThreads = await Channel.find({ parentId: forum.id, ownerId: user.id });
        const lastCreated = myThreads.reduce(
          (max: number, t: { createdAt?: Date | string | null }) => Math.max(max, new Date(t.createdAt ?? 0).getTime() || 0),
          0,
        );
        const elapsed = Date.now() - lastCreated;
        if (lastCreated > 0 && elapsed < forum.rateLimitPerUser * 1000) {
          const waitTime = Math.ceil((forum.rateLimitPerUser * 1000 - elapsed) / 1000);
          set.status = 429;
          return { error: `Slowmode enabled. Wait ${waitTime} seconds.`, retryAfter: waitTime };
        }
      }
    }

    const { name, appliedTags = [] } = body;
    const content = body.content ?? '';
    const trimmedName = sanitizeInput(name).slice(0, 100);
    if (!trimmedName) {
      set.status = 400;
      return { error: 'Post title is required' };
    }
    if (!content || !content.trim()) {
      set.status = 400;
      return { error: 'Post body is required' };
    }
    const validation = validateMessageContent(content);
    if (!validation.valid) {
      set.status = 400;
      return { error: validation.error };
    }

    const isTicket = forum.forumMode === 'tickets';

    // Validate applied tags against the forum's available tags
    const validTagIds = new Set((forum.availableTags || []).map((tag: { id: string }) => tag.id));
    const tags = (appliedTags || []).filter((id: string) => validTagIds.has(id));

    const thread = await Channel.create({
      serverId: forum.serverId,
      name: trimmedName,
      type: isTicket ? 'private_thread' : 'public_thread',
      parentId: forum.id,
      ownerId: user.id,
      position: 0,
      appliedTags: tags,
      threadMemberIds: [user.id],
      messageCount: 1,
    });

    // Initial post message lives in the thread channel.
    let sanitizedContent = normalizeEmojiFormat(sanitizeMessageContent(content));
    const mentionData = await limitMentionsToPermissions(
      await extractMentionsFromContent(sanitizedContent, forum.serverId || null),
      forum,
      user.id,
    );
    const encryptedContent = await encryptForStorage(sanitizedContent);
    const message = await Message.create({
      channelId: thread.id,
      serverId: forum.serverId,
      authorId: user.id,
      content: encryptedContent,
      type: 'default',
      mentionEveryone: mentionData.mentionEveryone,
      mentionedUserIds: mentionData.mentionedUserIds,
      mentionedRoleIds: mentionData.mentionedRoleIds,
      mentionedChannelIds: mentionData.mentionedChannelIds,
    });
    await Channel.updateById(thread.id, { lastMessageId: message.id });

    // Open forum views refetch their post list on this.
    publishToChannel(forum.id, { type: 'thread_create', threadId: thread.id });

    return {
      success: true,
      thread: {
        id: thread.id,
        name: thread.name,
        type: thread.type,
        parentId: forum.id,
        serverId: forum.serverId,
        appliedTags: thread.appliedTags,
        archived: false,
        locked: false,
      },
    };
  }, {
    params: t.Object({ channelId: t.String() }),
    body: t.Object({
      name: t.String({ minLength: 1, maxLength: 100 }),
      // Required for forum posts; optional for a thread started from a message.
      content: t.Optional(t.String({ maxLength: 4000 })),
      appliedTags: t.Optional(t.Array(t.String())),
      // Text / announcement channels only:
      messageId: t.Optional(t.String()),
      type: t.Optional(t.Union([t.Literal('public'), t.Literal('private')])),
      autoArchiveDuration: t.Optional(t.Number()),
    }),
  })
  // Get messages
  .get('/:channelId/messages', async ({ headers, cookie, params, query, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { hasAccess, channel, error } = await checkChannelAccess(
      user.id,
      params.channelId,
      { lean: true }
    );

    if (!hasAccess) {
      set.status = 403;
      return { error };
    }

    // Fetch server ownerId for isOwner flag on authors
    let serverOwnerId: string | null = null;
    let nicknameMap: Map<string, string> = new Map();
    const serverId = channel?.serverId;

    const limit = clampInt(query.limit, 50, config.MAX_MESSAGES_PER_FETCH);
    const before = query.before;
    const after = query.after;
    const around = query.around;

    // Build cursor-based DB query — avoid loading all messages
    const msgFilter: Record<string, unknown> = {
      channelId: params.channelId,
      isDeleted: false,
      _limit: limit,
    };

    if (before) {
      // Fetch the before message to get its createdAt, then query messages older than it
      const beforeMsg = await Message.findById(before);
      if (beforeMsg) {
        msgFilter.createdAtBefore = beforeMsg.createdAt;
      }
    } else if (after) {
      const afterMsg = await Message.findById(after);
      if (afterMsg) {
        msgFilter.createdAtAfter = afterMsg.createdAt;
        // Oldest-first so the page starts right after the cursor (DESC + LIMIT
        // would return the newest page and skip everything in between).
        msgFilter._orderAsc = true;
      }
    } else if (around) {
      const aroundMsg = await Message.findById(around);
      if (aroundMsg) {
        // createdAtBefore is exclusive; bump the cursor by 1ms so the jumped-to
        // message itself is included in the returned window.
        msgFilter.createdAtBefore = new Date(new Date(aroundMsg.createdAt as string | number | Date).getTime() + 1);
        msgFilter._limit = limit;
      }
    }

    const messages = await Message.find(msgFilter);
    if (!msgFilter._orderAsc) messages.reverse(); // oldest first for display

    // Everything below depends only on this page of messages, so the lookups
    // run in parallel (they used to be ~8 sequential DB round-trips).
    const authorIds = Array.from(new Set(messages.map((m: any) => m.authorId).filter(Boolean))) as string[];
    const refIds = Array.from(new Set(messages.map((m: any) => m.referencedMessageId).filter(Boolean))) as string[];

    // Server owner (isOwner flag) and nicknames for the authors in this page.
    const loadServerBits = async () => {
      if (!serverId) return;
      // Try Redis cache for server owner to avoid a DB round-trip on every page fetch
      const cachedOwner = await cache.get<string>(`server:owner:${serverId}`);
      const [server, authorMembers] = await Promise.all([
        cachedOwner ? null : Server.findById(serverId),
        authorIds.length > 0 ? ServerMember.find({ serverId, userId: { in: authorIds } }) : [],
      ]);
      if (cachedOwner) {
        serverOwnerId = cachedOwner;
      } else if (server?.ownerId) {
        serverOwnerId = server.ownerId;
        void cache.set(`server:owner:${serverId}`, server.ownerId, 3600);
      }
      for (const m of authorMembers as IServerMember[]) {
        if (m.nickname) {
          nicknameMap.set(m.userId, m.nickname);
        }
      }
    };

    const [, authors, refMessages, decryptedContents, extrasMap] = await Promise.all([
      loadServerBits(),
      authorIds.length > 0 ? User.find({ id: { in: authorIds } }) : Promise.resolve([]),
      // Scoped to this channel and live messages: a deleted or foreign
      // reference renders as "original message deleted" instead of leaking.
      refIds.length > 0 ? Message.find({ id: { in: refIds }, channelId: params.channelId, isDeleted: false }) : Promise.resolve([]),
      // Decrypt all message contents in parallel
      Promise.all((messages as IMessage[]).map((msg) => decryptFromStorage(msg.content || ''))),
      // Polls (tallies + your votes), poll result rows and forwarded messages.
      loadMessageExtras(messages as IMessage[], user.id).catch(() => new Map()),
    ]);
    const authorMap = new Map((authors as any[]).map((a: any) => [a.id, a]));
    const refMap = new Map((refMessages as any[]).map((r: any) => [r.id, r]));
    const refAuthorIds = Array.from(new Set((refMessages as any[]).map((r: any) => r.authorId).filter(Boolean))) as string[];
    const missingAuthorIds = authorIds.filter((id) => !authorMap.has(id));

    // Second wave: Discord-bridged authors, reply authors, and custom emojis
    // (one batched parse across all contents — no server restriction: access
    // was validated at send time, and restricting to the message's own server
    // broke rendering of cross-server emojis on fetch).
    // Thread chips: starter messages and "started a thread" rows carry their thread.
    const pageThreadIds = (messages as IMessage[]).map((m) => m.threadId).filter((id): id is string => Boolean(id));
    const [discordAuthors, refAuthors, emojiResults, threadSummaries] = await Promise.all([
      missingAuthorIds.length > 0
        ? import('@/lib/models/DiscordUser').then(({ DiscordUser }) => DiscordUser.findMany(missingAuthorIds))
        : Promise.resolve([]),
      refAuthorIds.length > 0 ? User.find({ id: { in: refAuthorIds } }) : Promise.resolve([]),
      batchParseCustomEmojis(decryptedContents),
      pageThreadIds.length > 0
        ? loadThreadSummariesByIds(pageThreadIds).catch(() => new Map<string, never>())
        : Promise.resolve(new Map<string, never>()),
    ]);
    for (const da of discordAuthors as any[]) {
      authorMap.set(da.id, {
        id: da.id,
        username: da.username || `discord-${da.discordId}`,
        displayName: da.displayName,
        avatar: da.avatar,
        status: 'offline',
        isBot: da.isBot,
        isSystem: false,
        isDiscord: true,
      });
    }
    // Webhook posts are stored under the webhook's own id.
    const webhookAuthorIds = missingAuthorIds.filter((id) => !authorMap.has(id));
    if (webhookAuthorIds.length > 0) {
      const { loadWebhookAuthors } = await import('@/lib/services/webhookAuthors');
      for (const wa of await loadWebhookAuthors(webhookAuthorIds)) authorMap.set(wa.id, wa);
    }
    const refAuthorMap = new Map((refAuthors as any[]).map((a: any) => [a.id, a]));
    // Fetch Discord users for ref authors not found in User table
    const missingRefAuthorIds = refAuthorIds.filter((id) => !refAuthorMap.has(id));
    if (missingRefAuthorIds.length > 0) {
      const { DiscordUser } = await import('@/lib/models/DiscordUser');
      const refDiscordAuthors = await DiscordUser.findMany(missingRefAuthorIds);
      for (const da of refDiscordAuthors) {
        refAuthorMap.set(da.id, {
          id: da.id,
          username: da.username || `discord-${da.discordId}`,
          displayName: da.displayName,
          avatar: da.avatar,
          status: 'offline',
          isBot: da.isBot,
          isSystem: false,
          isDiscord: true,
        });
      }
    }

    // Phase 3: Decrypt referenced message contents (batch, parallel)
    const refDecryptEntries = (messages as IMessage[])
      .filter((msg) => msg.referencedMessageId && refMap.get(msg.referencedMessageId))
      .map((msg) => {
        const refMsg = refMap.get(msg.referencedMessageId!)!;
        return { refId: msg.referencedMessageId!, content: refMsg.content || '' };
      });
    const refDecrypted = await Promise.all(
      refDecryptEntries.map((entry) => decryptFromStorage(entry.content))
    );
    const refContentMap = new Map<string, string>();
    refDecryptEntries.forEach((entry, i) => refContentMap.set(entry.refId, refDecrypted[i]));

    // Phase 4: Assemble final response objects (synchronous, no DB/await)
    const decryptedMessages = (messages as IMessage[]).map((msg, idx) => {
      const decryptedContent = decryptedContents[idx];
      const authorData = msg.authorId ? authorMap.get(msg.authorId) : null;
      const populatedAuthor = authorData ? {
        id: authorData.id,
        username: authorData.username,
        displayName: authorData.displayName,
        avatar: authorData.avatar,
        status: authorData.status,
        customization: authorData.customization,
        badges: authorData.badges,
        isSystem: authorData.isSystem,
        isBot: Boolean(authorData.isBot),
        isVerified: Boolean(authorData.isVerified),
        isDiscord: (authorData as { isDiscord?: boolean }).isDiscord || authorData.username?.startsWith('discord-') || false,
      } : null;

      const customEmojis = emojiResults[idx].emojis.map(e => ({
        id: e.id,
        name: e.name,
        animated: e.animated,
        url: e.url,
      }));

      const refId = msg.referencedMessageId;
      let referencedMessage:
        | {
            id: string;
            content: string;
            author?: {
              id: string;
              username: string;
              displayName: string;
              avatar?: string;
              isBot?: boolean;
              isVerified?: boolean;
            };
            createdAt?: Date;
          }
        | undefined;

      if (refId) {
        const refMsg = refMap.get(refId);
        if (refMsg) {
          const refAuthorData = refMsg.authorId ? refAuthorMap.get(refMsg.authorId) : null;
          referencedMessage = {
            id: refMsg.id,
            content: refContentMap.get(refId) || '',
            author: refAuthorData ? {
              id: refAuthorData.id,
              username: refAuthorData.username,
              displayName: refAuthorData.displayName || refAuthorData.username,
              avatar: refAuthorData.avatar,
              isBot: Boolean(refAuthorData.isBot),
              isVerified: Boolean(refAuthorData.isVerified),
            } : undefined,
            createdAt: refMsg.createdAt,
          };
        }
      }

      return {
        id: msg.id,
        content: decryptedContent,
        authorId: populatedAuthor?.id || msg.authorId,
        author: populatedAuthor ? {
          id: populatedAuthor.id,
          username: populatedAuthor.username,
          displayName: nicknameMap.get(populatedAuthor.id) || populatedAuthor.displayName || populatedAuthor.username,
          avatar: populatedAuthor.avatar,
          status: populatedAuthor.status,
          badges: populatedAuthor.badges || [],
          isOwner: serverOwnerId ? compareIds(serverOwnerId, populatedAuthor.id) : false,
          isSystem: populatedAuthor.isSystem || false,
          isBot: populatedAuthor.isBot,
          isVerified: populatedAuthor.isVerified,
          isDiscord: populatedAuthor.isDiscord || false,
          customization: populatedAuthor.customization || null,
        } : null,
        channelId: msg.channelId,
        serverId: msg.serverId,
        createdAt: msg.createdAt,
        updatedAt: msg.updatedAt,
        attachments: msg.attachments || [],
        embeds: Array.isArray(msg.embeds) ? msg.embeds : [],
        edited: msg.edited,
        type: msg.type,
        referencedMessageId: msg.referencedMessageId,
        referencedMessage,
        pinned: msg.pinned,
        reactions: msg.reactions || [],
        mentionEveryone: Boolean(msg.mentionEveryone),
        mentionedUserIds: msg.mentionedUserIds || [],
        mentionedRoleIds: msg.mentionedRoleIds || [],
        mentionedChannelIds: msg.mentionedChannelIds || [],
        customEmojis: customEmojis.length > 0 ? customEmojis : undefined,
        sticker: msg.sticker || undefined,
        interaction: (msg as { interaction?: unknown }).interaction ?? undefined,
        suppressEmbeds: Boolean((msg as { suppressEmbeds?: boolean }).suppressEmbeds),
        webhookId: (authorData as { isWebhook?: boolean } | null)?.isWebhook ? msg.authorId : undefined,
        threadId: msg.threadId ?? undefined,
        thread: msg.threadId ? (threadSummaries.get(msg.threadId) ?? null) : undefined,
        ...extrasMap.get(msg.id),
      };
    });

    return decryptedMessages;
  }, {
    params: t.Object({
      channelId: t.String(),
    }),
    query: t.Object({
      limit: t.Optional(t.String()),
      before: t.Optional(t.String()),
      after: t.Optional(t.String()),
      around: t.Optional(t.String()),
    }),
  })
  // Search messages in one channel (Discord's channel search). Same engine as
  // server / DM search (src/lib/api/search.ts), scoped to this channel.
  .get('/:channelId/messages/search', async ({ headers, cookie, params, query, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { hasAccess, error, channel } = await checkChannelAccess(user.id, params.channelId);
    if (!hasAccess || !channel) {
      set.status = 403;
      return { error };
    }
    const rl = await checkRateLimit('search', user.id);
    if (!rl.success) {
      set.status = 429;
      return { error: 'You are searching too fast. Try again in a moment.', retryAfter: rl.retryAfter };
    }

    const { searchInChannels, memberScopeForServer, memberScopeForUsers } = await import('./search');
    const memberScope = channel.serverId
      ? memberScopeForServer(channel.serverId)
      : memberScopeForUsers((channel.recipientIds || []) as string[]);
    // Only this channel, whatever channelId the query names.
    return searchInChannels(user.id, [channel], { ...query, channelId: undefined }, { memberScope });
  }, {
    params: t.Object({
      channelId: t.String(),
    }),
    query: t.Object({
      q: t.Optional(t.String({ maxLength: 512 })),
      limit: t.Optional(t.String()),
      offset: t.Optional(t.String()),
      sort: t.Optional(t.String()),
      searchLimit: t.Optional(t.String()),
      from: t.Optional(t.String({ maxLength: 200 })),
      authorId: t.Optional(t.String({ maxLength: 2000 })),
      author: t.Optional(t.String({ maxLength: 500 })),
      mentions: t.Optional(t.String({ maxLength: 2000 })),
      mentionName: t.Optional(t.String({ maxLength: 500 })),
      has: t.Optional(t.String({ maxLength: 200 })),
      pinned: t.Optional(t.String()),
      authorType: t.Optional(t.String({ maxLength: 50 })),
      minTime: t.Optional(t.String({ maxLength: 40 })),
      maxTime: t.Optional(t.String({ maxLength: 40 })),
      before: t.Optional(t.String({ maxLength: 40 })),
      after: t.Optional(t.String({ maxLength: 40 })),
    }),
  })
  // Send message
  .post('/:channelId/messages', async ({ headers, cookie, params, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { hasAccess, channel, membership, error } = await checkChannelAccess(
      user.id,
      params.channelId,
      { lean: true }
    );

    if (!hasAccess || !channel) {
      set.status = 403;
      return { error: error || 'Access denied' };
    }

    // Timeout, SEND_MESSAGES and (with attachments) ATTACH_FILES on server channels.
    const speakDenial = await checkCanSpeak(
      channel,
      membership,
      user.id,
      (body.attachments?.length ?? 0) > 0 ? ['send', 'attach'] : ['send'],
    );
    if (speakDenial) {
      set.status = speakDenial.status;
      return speakDenial.body;
    }
    // Blocks + DM privacy on DMs (and the same timeout/send gate on servers).
    const postDenied = await checkCanPostInChannel(channel, user, membership);
    if (postDenied) {
      set.status = postDenied.status;
      return postDenied.body;
    }

    // Threads: a locked thread only takes messages from thread moderators; an
    // archived one is reopened by the message (Discord). The author (and anyone
    // they @mention) joins the thread once the message is stored, below.
    const isThreadChannel = channel.type === 'public_thread' || channel.type === 'private_thread';
    let unarchivedThread = false;
    if (isThreadChannel && (channel.locked || channel.archived)) {
      if (channel.locked && !hasPermissionBit(await memberPermissionsIn(channel, user.id, membership), PERM_MANAGE_THREADS)) {
        set.status = 403;
        return { error: 'This thread is locked' };
      }
      if (channel.archived) {
        await setThreadArchived(channel.id, false);
        channel.archived = false;
        unarchivedThread = true;
      }
    }

    // ownerId for the isOwner flag; the sender's nickname is reused from the
    // membership already resolved by checkChannelAccess (one fewer query).
    // Fetch serverOwnerId (from Redis cache with DB fallback) in parallel with
    // rate limit checks to save a serial round-trip on the hot path.
    const senderNickname: string | null = membership?.nickname || null;
    const serverOwnerPromise = (async () => {
      if (!channel.serverId) return null;
      const cacheKey = `server:owner:${channel.serverId}`;
      const cached = await cache.get<string>(cacheKey);
      if (cached !== null) return cached;
      const server = await Server.findById(channel.serverId);
      const ownerId = server?.ownerId ?? null;
      if (ownerId) await cache.set(cacheKey, ownerId, 3600); // 1 hour TTL
      return ownerId;
    })();

    // Server safety settings (anti-spam toggle, mention spam limit). Cached
    // briefly; the settings routes drop the key when they change.
    const safetyPromise = (async (): Promise<ServerSafety> => {
      if (!channel.serverId) return DEFAULT_SERVER_SAFETY;
      const cacheKey = `server:safety:${channel.serverId}`;
      const cached = await cache.get<ServerSafety>(cacheKey).catch(() => null);
      if (cached) return cached;
      const server = await Server.findById(channel.serverId);
      const safety = resolveServerSafety((server?.settings as IServerSettings | undefined)?.safety);
      await cache.set(cacheKey, safety, 60).catch(() => {});
      return safety;
    })().catch(() => DEFAULT_SERVER_SAFETY);

    const [rateLimit, globalRateLimit, serverOwnerId, safety] = await Promise.all([
      checkRateLimit('message', `${user.id}:${params.channelId}`),
      checkRateLimit('messageGlobal', user.id),
      serverOwnerPromise,
      safetyPromise,
    ]);
    if (!rateLimit.success) {
      set.status = 429;
      return { error: 'Message rate limited', retryAfter: rateLimit.retryAfter };
    }
    if (!globalRateLimit.success) {
      set.status = 429;
      return { error: 'Global message rate limited', retryAfter: globalRateLimit.retryAfter };
    }

    // Check slowmode (bypass for server owner and users with Manage Messages)
    if (channel.rateLimitPerUser > 0 && serverOwnerId !== user.id) {
      let hasManageMessages = false;
      if (membership?.roles?.length) {
        const roles = await Role.find({ id: { in: membership.roles }, serverId: channel.serverId });
        hasManageMessages = roles.some((r: any) => {
          const perms = BigInt(r.permissions || '0');
          return (perms & PERM_MANAGE_MESSAGES) === PERM_MANAGE_MESSAGES || (perms & PERM_ADMINISTRATOR) === PERM_ADMINISTRATOR;
        });
      }
      if (!hasManageMessages) {
        const allUserMsgs = await Message.find({
          channelId: params.channelId,
          authorId: user.id,
          isDeleted: false,
          _limit: 1,
        });
        const lastMessage = allUserMsgs[0];

        if (lastMessage) {
          const timeSinceLastMessage = Date.now() - new Date(lastMessage.createdAt ?? 0).getTime();
          if (timeSinceLastMessage < channel.rateLimitPerUser * 1000) {
            const waitTime = Math.ceil((channel.rateLimitPerUser * 1000 - timeSinceLastMessage) / 1000);
            set.status = 429;
            return { error: `Slowmode enabled. Wait ${waitTime} seconds.`, retryAfter: waitTime };
          }
        }
      }
    }

    const { content, replyTo, attachments = [], sticker } = body;

    // Validate sticker if provided
    let stickerData: { id: string; name: string; imageUrl: string; serverId?: string; serverName?: string } | undefined;
    if (sticker?.id) {
      const stickerDoc = await ServerSticker.findById(sticker.id);
      if (!stickerDoc || !stickerDoc.available) {
        set.status = 400;
        return { error: 'Sticker not found' };
      }
      const stickerServer = stickerDoc.serverId
        ? await cache.get<string>(`server:name:${stickerDoc.serverId}`).then(async (name) => {
            if (name) return name;
            const srv = await Server.findById(stickerDoc.serverId!);
            if (srv?.name) { await cache.set(`server:name:${stickerDoc.serverId}`, srv.name, 3600); return srv.name; }
            return undefined;
          })
        : null;
      stickerData = {
        id: stickerDoc.id,
        name: stickerDoc.name,
        imageUrl: stickerDoc.imageUrl,
        serverId: stickerDoc.serverId,
        serverName: stickerServer ?? undefined,
      };
    }

    // Validate content
    if (!content && attachments.length === 0 && !stickerData) {
      set.status = 400;
      return { error: 'Message must have content, attachments, or a sticker' };
    }

    // Attachments must be our own uploads by this user (see attachmentPolicy).
    const attachmentError = validateMessageAttachments(attachments, { cdnUrl: config.CDN_URL, userId: user.id });
    if (attachmentError) {
      set.status = 400;
      return { error: attachmentError };
    }

    // The reply target must be a live message in this same channel; otherwise
    // its content would be echoed back (and to every viewer) from anywhere.
    let reference: IMessage | null = null;
    if (replyTo) {
      reference = isValidObjectId(replyTo)
        ? await Message.findOne({ id: replyTo, channelId: params.channelId, isDeleted: false })
        : null;
      if (!reference) {
        set.status = 400;
        return { error: 'Referenced message not found' };
      }
    }

    if (content) {
      const validation = validateMessageContent(content);
      if (!validation.valid) {
        set.status = 400;
        return { error: validation.error };
      }
    }

    // Bot (application) slash command: if the message is a `/command` that maps
    // to a registered application command, dispatch the interaction and DON'T
    // persist the raw "/command" text as a message. The bot's response (or an
    // ephemeral reply) arrives over the channel SSE stream. Only plain-text
    // sends can be commands (no attachments/sticker).
    if (content && content.trim().startsWith('/') && attachments.length === 0 && !stickerData) {
      const { dispatchSlashCommand } = await import('@/lib/services/interactions');
      const consumed = await dispatchSlashCommand({
        content: content.trim(),
        channelId: params.channelId,
        serverId: channel.serverId ?? null,
        author: { id: user.id, username: user.username ?? undefined, displayName: user.displayName ?? undefined },
      }).catch(() => false);
      if (consumed) {
        // Signals the client to drop its optimistic message without rendering it.
        return { interaction: true };
      }
    }

    // Sanitize content while preserving mention/channel/custom-emoji tokens.
    let sanitizedContent = content ? sanitizeMessageContent(content) : '';
    if (sanitizedContent) {
      sanitizedContent = normalizeEmojiFormat(sanitizedContent);
    }

    // Duplicate-spam guard: block sending the same text many times in a row.
    // Only applies to plain text sends (attachments/stickers are exempt) and is
    // fingerprint-based so trivial variations don't sidestep it.
    // Owners can turn it off with the server's anti-spam setting.
    const spamFingerprint = normalizeForSpamCheck(sanitizedContent);
    if (safety.antiSpam && spamFingerprint && attachments.length === 0 && !stickerData) {
      const recent = await Message.find({
        channelId: params.channelId,
        authorId: user.id,
        isDeleted: false,
        _limit: DUPLICATE_SPAM_THRESHOLD,
      });
      if (recent.length >= DUPLICATE_SPAM_THRESHOLD) {
        const recentContents = await Promise.all(
          recent.map((m: any) => (m.content ? decryptFromStorage(m.content) : Promise.resolve('')))
        );
        const allDuplicate = recentContents.every(
          (c) => normalizeForSpamCheck(c) === spamFingerprint
        );
        if (allDuplicate) {
          set.status = 429;
          return { error: 'Please stop sending the same message repeatedly.' };
        }
      }
    }

    // Parse custom emojis, resolve mentions, and encrypt — all independent of
    // each other, so run them concurrently instead of serially. Emoji server
    // access needs the sender's memberships, but only bother fetching them when
    // the content actually contains a custom-emoji token (most messages don't).
    const hasCustomEmoji = /<?a?:[a-zA-Z0-9_]{2,32}:[0-9a-f]{8}-[0-9a-f]{4}-/i.test(sanitizedContent);
    const [emojiResult, mentionData, encryptedContent] = await Promise.all([
      (async () => {
        if (!hasCustomEmoji) return { content: sanitizedContent, emojis: [], invalidEmojis: [] };
        const userServerMemberships = await ServerMember.find({ userId: user.id });
        const userServerIds = userServerMemberships.map((m: any) => m.serverId);
        return parseCustomEmojis(sanitizedContent, channel.serverId, userServerIds);
      })(),
      extractMentionsFromContent(sanitizedContent, channel.serverId || null)
        .then((mentions) => limitMentionsToPermissions(mentions, channel, user.id)),
      sanitizedContent ? encryptForStorage(sanitizedContent) : Promise.resolve(''),
    ]);

    // Mention spam limit (server safety setting). Owners and members with
    // Manage Messages / Administrator are exempt.
    if (
      channel.serverId
      && exceedsMentionLimit(mentionData, safety)
      && !(serverOwnerId && compareIds(serverOwnerId, user.id))
    ) {
      let exempt = false;
      if (membership?.roles?.length) {
        const roles = await Role.find({ id: { in: membership.roles }, serverId: channel.serverId });
        exempt = roles.some((r: IRole) => {
          const perms = BigInt(r.permissions || '0');
          return (perms & PERM_MANAGE_MESSAGES) === PERM_MANAGE_MESSAGES || (perms & PERM_ADMINISTRATOR) === PERM_ADMINISTRATOR;
        });
      }
      if (!exempt) {
        set.status = 400;
        return { error: `This server allows at most ${safety.mentionSpamLimit} mentions per message.` };
      }
    }

    // Store parsed emoji data for the message response
    const customEmojis = emojiResult.emojis.map(e => ({
      id: e.id,
      name: e.name,
      animated: e.animated,
      url: e.url,
    }));

    // Create message
    const message = await Message.create({
      channelId: params.channelId,
      serverId: channel.serverId,
      authorId: user.id,
      content: encryptedContent,
      type: reference ? 'reply' : 'default',
      referencedMessageId: reference?.id,
      attachments,
      sticker: stickerData,
      mentionEveryone: mentionData.mentionEveryone,
      mentionedUserIds: mentionData.mentionedUserIds,
      mentionedRoleIds: mentionData.mentionedRoleIds,
      mentionedChannelIds: mentionData.mentionedChannelIds,
    });

    // Update channel's last message — not needed for the sender's response, so
    // fire-and-forget to keep the send round-trip as short as possible.
    void Channel.updateById(channel.id, { lastMessageId: message.id });

    // Thread: the author and @mentioned members join before the activity
    // fan-out below (which only reaches thread members), then the parent's
    // chip / browser get the new count.
    if (isThreadChannel) {
      const toAdd = threadMembersToAdd(channel.threadMemberIds as string[] | null, user.id, mentionData.mentionedUserIds);
      const joinedNow = toAdd.length > 0 ? await addThreadMembers(channel.id, toAdd).catch(() => []) : [];
      if (joinedNow.length > 0) channel.threadMemberIds = [...((channel.threadMemberIds as string[] | null) || []), ...joinedNow];
      notifyThreadMembership(
        channel.serverId,
        channel.id,
        unarchivedThread ? ((channel.threadMemberIds as string[] | null) || []) : joinedNow,
      );
      refreshThreadAfterMessage(channel.id);
    }

    // The authenticated `user` is already the full (cached) author record —
    // reuse it instead of re-querying the DB on every send.
    const author = user;
    let referencedMessage:
      | {
          id: string;
          content: string;
          author?: {
            id: string;
            username: string;
            displayName: string;
            avatar?: string;
            isBot?: boolean;
            isVerified?: boolean;
          };
          createdAt?: Date;
        }
      | undefined;

    if (reference) {
      let refAuthor: { id: string; username: string; displayName: string | null; avatar: string | null; isBot: boolean | null; isVerified: boolean | null } | null = reference.authorId ? (await User.findById(reference.authorId) as { id: string; username: string; displayName: string | null; avatar: string | null; isBot: boolean | null; isVerified: boolean | null } | null) : null;
      // Fall back to DiscordUser if not found in User table
      if (!refAuthor && reference.authorId) {
        const { DiscordUser } = await import('@/lib/models/DiscordUser');
        const da = await DiscordUser.findById(reference.authorId);
        if (da) {
          refAuthor = {
            id: da.id,
            username: da.username || `discord-${da.discordId}`,
            displayName: da.displayName,
            avatar: da.avatar,
            isBot: da.isBot ?? false,
            isVerified: false,
          };
        }
      }
      const refDecrypted = reference.content ? await decryptFromStorage(reference.content) : '';
      referencedMessage = {
        id: reference.id,
        content: refDecrypted,
        author: refAuthor ? {
          id: refAuthor.id,
          username: refAuthor.username,
          displayName: refAuthor.displayName || refAuthor.username,
          avatar: refAuthor.avatar ?? undefined,
          isBot: Boolean(refAuthor.isBot),
          isVerified: Boolean(refAuthor.isVerified),
        } : undefined,
        createdAt: reference.createdAt ?? undefined,
      };
    }

    const messageResponse = {
      id: message.id,
      content: sanitizedContent, // Return original content, not encrypted
      authorId: author?.id || message.authorId,
      author: author ? {
        id: author.id,
        username: author.username,
        displayName: senderNickname || author.displayName || author.username,
        avatar: author.avatar,
        status: author.status,
        badges: author.badges || [],
        isOwner: serverOwnerId ? compareIds(serverOwnerId, author.id) : false,
        isSystem: author.isSystem || false,
        isBot: Boolean(author.isBot),
        isVerified: Boolean(author.isVerified),
        isDiscord: author.username?.startsWith('discord-') || false,
        customization: author.customization || null,
      } : null,
      channelId: message.channelId,
      serverId: message.serverId,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
      attachments: message.attachments || [],
      edited: message.edited,
      type: message.type,
      referencedMessageId: message.referencedMessageId,
      referencedMessage,
      pinned: message.pinned,
      reactions: message.reactions || [],
      mentionEveryone: message.mentionEveryone,
      mentionedUserIds: message.mentionedUserIds || [],
      mentionedRoleIds: message.mentionedRoleIds || [],
      mentionedChannelIds: message.mentionedChannelIds || [],
      customEmojis: customEmojis.length > 0 ? customEmojis : undefined,
      sticker: message.sticker || undefined,
    };

    // Deliver to SSE connections everywhere: locally in-process AND, via the
    // Redis SSE bus, to every other app instance — so all viewers receive the
    // message at the same time.
    publishToChannel(params.channelId, {
      type: 'message',
      message: messageResponse,
    });

    void replicateToDiscord('create', params.channelId, messageResponse);

    // Sending reads the channel up to your message, on all your devices.
    void import('@/lib/api/activity')
      .then(({ ackOwnMessage }) => ackOwnMessage(user.id, message.channelId, message.id, message.createdAt))
      .catch(() => { /* best-effort */ });

    // App-wide unread signal: notify every other member of this server so their
    // sidebar can glow / badge the channel even when they're not viewing it.
    // Fire-and-forget — never block the sender's response on fan-out.
    if (channel.serverId) {
      void (async () => {
        try {
          const { notifyChannelActivity } = await import('@/lib/api/activity');
          const preview = typeof sanitizedContent === 'string' ? sanitizedContent.slice(0, 200) : undefined;
          const { lookupMentionNames } = await import('@/lib/services/mentionNames');
          const mentionNames = preview ? await lookupMentionNames([preview], { serverId: channel.serverId }) : undefined;
          await notifyChannelActivity({
            type: 'channel_activity',
            serverId: channel.serverId as string,
            channelId: message.channelId,
            channelName: channel.name,
            messageId: message.id,
            authorId: user.id,
            authorName: senderNickname || author?.displayName || author?.username,
            authorAvatar: author?.avatar ?? null,
            mentionedUserIds: (message.mentionedUserIds || []) as string[],
            mentionEveryone: Boolean(message.mentionEveryone),
            mentionedRoleIds: (message.mentionedRoleIds || []) as string[],
            preview,
            mentionNames,
            parentId: (channel as { parentId?: string | null }).parentId ?? null,
            createdAt: new Date(message.createdAt ?? Date.now()).toISOString(),
          });
        } catch { /* best-effort */ }
      })();
    } else if (channel.type === 'group_dm' || channel.type === 'dm') {
      // Group DMs (and DMs) sent through the channel route: same DM-list bump
      // and unread badge / notification as the DM send route, or the other
      // members never learn about the message outside the open conversation.
      void (async () => {
        const { signalDmMessage } = await import('@/lib/services/messageSignals');
        await signalDmMessage({
          channelId: message.channelId,
          recipientIds: ((channel as { recipientIds?: string[] | null }).recipientIds ?? []) as string[],
          messageId: message.id,
          authorId: user.id,
          authorName: author?.displayName || author?.username,
          authorAvatar: author?.avatar ?? null,
          content: typeof sanitizedContent === 'string' ? sanitizedContent : '',
          hasAttachments: Array.isArray(message.attachments) && message.attachments.length > 0,
          createdAt: message.createdAt,
        });
      })().catch(() => { /* best-effort */ });
    }

    // Bot gateway dispatch must NOT block the sender's response. Fire-and-forget.
    // (Slash-command interactions are handled earlier, before persistence, so a
    // recognized "/command" never reaches this point as a stored message.)
    void (async () => {
      try {
        const { emitMessageCreate } = await import('@/lib/services/gatewayEvents');
        await emitMessageCreate(messageResponse as never);
      } catch {}
    })();

    return { message: messageResponse };
  }, {
    params: t.Object({
      channelId: t.String(),
    }),
    body: t.Object({
      content: t.Optional(t.String({ maxLength: 4000 })),
      replyTo: t.Optional(t.String()),
      attachments: t.Optional(t.Array(t.Object({
        id: t.String(),
        filename: t.String(),
        contentType: t.String(),
        size: t.Optional(t.Number()),
        url: t.String(),
        width: t.Optional(t.Number()),
        height: t.Optional(t.Number()),
        spoiler: t.Optional(t.Boolean()),
      }))),
      sticker: t.Optional(t.Object({
        id: t.String(),
        name: t.String(),
        imageUrl: t.String(),
        serverId: t.Optional(t.String()),
        serverName: t.Optional(t.String()),
      })),
    }),
  })
  // Get pinned messages for channel
  .get('/:channelId/pins', async ({ headers, cookie, params, query, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { hasAccess, error } = await checkChannelAccess(
      user.id,
      params.channelId
    );

    if (!hasAccess) {
      set.status = 403;
      return { error };
    }

    const limit = clampInt(query.limit, 50, 100);
    const allPinned = await Message.find({
      channelId: params.channelId,
      pinned: true,
      isDeleted: false,
    });
    const pinnedMessages = allPinned
      .sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, limit);

    // Batch fetch authors
    const authorIds = Array.from(new Set(pinnedMessages.map((m: any) => m.authorId).filter(Boolean))) as string[];
    const authors = authorIds.length > 0 ? await User.find({ id: { in: authorIds } }) : [];
    const authorMap = new Map(authors.map((a: any) => [a.id, a]));
    // Fetch Discord users for authors not found in User table
    const missingAuthorIds = authorIds.filter((id) => !authorMap.has(id));
    if (missingAuthorIds.length > 0) {
      const { DiscordUser } = await import('@/lib/models/DiscordUser');
      const discordAuthors = await DiscordUser.findMany(missingAuthorIds);
      for (const da of discordAuthors) {
        authorMap.set(da.id, {
          id: da.id,
          username: da.username || `discord-${da.discordId}`,
          displayName: da.displayName,
          avatar: da.avatar,
          status: 'offline',
          isBot: da.isBot,
          isSystem: false,
          isDiscord: true,
        });
      }
      const webhookAuthorIds = missingAuthorIds.filter((id) => !authorMap.has(id));
      if (webhookAuthorIds.length > 0) {
        const { loadWebhookAuthors } = await import('@/lib/services/webhookAuthors');
        for (const wa of await loadWebhookAuthors(webhookAuthorIds)) authorMap.set(wa.id, wa);
      }
    }

    // Batch decrypt + batch parse emojis for pinned messages
    const pinnedContents = await Promise.all(
      (pinnedMessages as IMessage[]).map((msg) => decryptFromStorage(msg.content || ''))
    );
    const pinnedEmojiResults = await batchParseCustomEmojis(pinnedContents);

    const messages = (pinnedMessages as IMessage[]).map((msg, idx) => {
      const authorData = msg.authorId ? authorMap.get(msg.authorId) : null;
      const decryptedContent = pinnedContents[idx];
      const customEmojis = pinnedEmojiResults[idx].emojis.map(e => ({
        id: e.id,
        name: e.name,
        animated: e.animated,
        url: e.url,
      }));
      return {
        id: msg.id,
        content: decryptedContent,
        authorId: authorData?.id || msg.authorId,
        author: authorData
          ? {
              id: authorData.id,
              username: authorData.username,
              displayName: authorData.displayName || authorData.username,
              avatar: authorData.avatar,
              status: authorData.status,
            }
          : null,
        channelId: msg.channelId,
        createdAt: msg.createdAt,
        updatedAt: msg.updatedAt,
        pinned: true,
        attachments: msg.attachments || [],
        customEmojis: customEmojis.length > 0 ? customEmojis : undefined,
      };
    });

    return { messages };
  }, {
    params: t.Object({
      channelId: t.String(),
    }),
    query: t.Object({
      limit: t.Optional(t.String()),
    }),
  })
  // Pin a message
  .put('/:channelId/messages/:messageId/pin', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { hasAccess, channel, error } = await checkChannelAccess(
      user.id,
      params.channelId
    );

    if (!hasAccess || !channel) {
      set.status = 403;
      return { error: error || 'Access denied' };
    }

    const message = await Message.findOne({
      id: params.messageId,
      channelId: params.channelId,
      isDeleted: false,
    });

    if (!message) {
      set.status = 404;
      return { error: 'Message not found' };
    }

    // DMs (no serverId): both participants can pin. Server channels: require
    // PIN_MESSAGES, MANAGE_MESSAGES, ADMINISTRATOR, or ownership.
    if (channel.serverId) {
      const canPin = await canPinMessagesInServer(channel.serverId, user.id);
      if (!canPin) {
        set.status = 403;
        return { error: 'Missing Permissions' };
      }
    }

    await Message.updateById(message.id, { pinned: true });

    publishToChannel(params.channelId, {
      type: 'pin_update',
      messageId: params.messageId,
      pinned: true,
      updatedBy: user.id,
    });


    return { success: true };
  }, {
    params: t.Object({
      channelId: t.String(),
      messageId: t.String(),
    }),
  })
  // Unpin a message
  .delete('/:channelId/messages/:messageId/pin', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { hasAccess, channel, error } = await checkChannelAccess(
      user.id,
      params.channelId
    );

    if (!hasAccess || !channel) {
      set.status = 403;
      return { error: error || 'Access denied' };
    }

    const message = await Message.findOne({
      id: params.messageId,
      channelId: params.channelId,
      isDeleted: false,
    });

    if (!message) {
      set.status = 404;
      return { error: 'Message not found' };
    }

    // DMs (no serverId): both participants can unpin. Server channels: require
    // PIN_MESSAGES, MANAGE_MESSAGES, ADMINISTRATOR, or ownership.
    if (channel.serverId) {
      const canPin = await canPinMessagesInServer(channel.serverId, user.id);
      if (!canPin) {
        set.status = 403;
        return { error: 'Missing Permissions' };
      }
    }

    await Message.updateById(message.id, { pinned: false });

    publishToChannel(params.channelId, {
      type: 'pin_update',
      messageId: params.messageId,
      pinned: false,
      updatedBy: user.id,
    });


    return { success: true };
  }, {
    params: t.Object({
      channelId: t.String(),
      messageId: t.String(),
    }),
  })
  // Edit message
  .patch('/:channelId/messages/:messageId', async ({ headers, cookie, params, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { hasAccess, channel, error } = await checkChannelAccess(
      user.id,
      params.channelId
    );

    if (!hasAccess || !channel) {
      set.status = 403;
      return { error: error || 'Access denied' };
    }

    const message = await Message.findOne({
      id: params.messageId,
      channelId: params.channelId,
      isDeleted: false,
    });

    if (!message) {
      set.status = 404;
      return { error: 'Message not found' };
    }

    // Only author can edit their own messages
    if (!compareIds(message.authorId, user.id)) {
      set.status = 403;
      return { error: 'You can only edit your own messages' };
    }

    // In a 1:1 DM, a block (or DM privacy) also stops rewriting old messages.
    if (channel.type === 'dm') {
      const editDenied = await checkCanPostInChannel(channel, user, null);
      if (editDenied) {
        set.status = editDenied.status;
        return editDenied.body;
      }
    }

    const { content } = body;

    let sanitizedEditContent = '';
    const updateData: Record<string, any> = {};
    if (content) {
      const validation = validateMessageContent(content);
      if (!validation.valid) {
        set.status = 400;
        return { error: validation.error };
      }

      sanitizedEditContent = sanitizeMessageContent(content);
      sanitizedEditContent = normalizeEmojiFormat(sanitizedEditContent);
      const [mentionData, encryptedEdit] = await Promise.all([
        extractMentionsFromContent(sanitizedEditContent, channel.serverId || null)
          .then((mentions) => limitMentionsToPermissions(mentions, channel, user.id)),
        encryptForStorage(sanitizedEditContent),
      ]);
      updateData.mentionEveryone = mentionData.mentionEveryone;
      updateData.mentionedUserIds = mentionData.mentionedUserIds;
      updateData.mentionedRoleIds = mentionData.mentionedRoleIds;
      updateData.mentionedChannelIds = mentionData.mentionedChannelIds;
      updateData.content = encryptedEdit;
      updateData.edited = true;
      updateData.editedTimestamp = new Date();
    }

    await Message.updateById(message.id, updateData);

    // Live update for everyone viewing the channel (decrypted content).
    publishToChannel(params.channelId, {
      type: 'edit',
      messageId: params.messageId,
      content: sanitizedEditContent,
      editedTimestamp: updateData.editedTimestamp,
    });

    // Mentions the edit removed: those users' badges / Inbox entries go.
    if (content) {
      const before = new Set(((message.mentionedUserIds || []) as string[]).map(String));
      const after = new Set(((updateData.mentionedUserIds || []) as string[]).map(String));
      const removed = [...before].filter((id) => !after.has(id) && id !== user.id);
      const everyoneRemoved =
        Boolean(message.mentionEveryone) &&
        !updateData.mentionEveryone &&
        ((updateData.mentionedRoleIds || []) as string[]).length === 0;
      if (removed.length > 0 || (everyoneRemoved && channel.serverId)) {
        void import('@/lib/api/activity')
          .then(({ fanoutToUsers, notifyMentionRetract }) => {
            if (everyoneRemoved && channel.serverId) {
              void fanoutToUsers(
                { serverId: channel.serverId },
                { type: 'mention_retract', channelId: params.channelId, messageId: message.id, keepUserIds: [...after] },
              );
            } else {
              notifyMentionRetract(removed, params.channelId, message.id);
            }
          })
          .catch(() => { /* best-effort */ });
      }
    }

    const updatedMessage = await Message.findById(message.id);
    const responseMsg = { ...updatedMessage, content: sanitizedEditContent };
    void replicateToDiscord('edit', params.channelId, responseMsg);
    return { success: true, message: responseMsg };
  }, {
    params: t.Object({
      channelId: t.String(),
      messageId: t.String(),
    }),
    body: t.Object({
      content: t.String({ maxLength: 4000 }),
    }),
  })
  // Suppress embeds on a message
  .post('/:channelId/messages/:messageId/suppress-embeds', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { hasAccess, channel, error } = await checkChannelAccess(
      user.id,
      params.channelId
    );

    if (!hasAccess || !channel) {
      set.status = 403;
      return { error: error || 'Access denied' };
    }

    const message = await Message.findOne({
      id: params.messageId,
      channelId: params.channelId,
      isDeleted: false,
    });

    if (!message) {
      set.status = 404;
      return { error: 'Message not found' };
    }

    // Only the author or someone with MANAGE_MESSAGES can suppress embeds
    const isAuthor = compareIds(message.authorId, user.id);
    if (!isAuthor) {
      if (channel.serverId) {
        const canManage = await canManageMessagesInServer(channel.serverId, user.id);
        if (!canManage) {
          set.status = 403;
          return { error: 'You do not have permission to suppress embeds on this message' };
        }
      } else {
        set.status = 403;
        return { error: 'You can only suppress embeds on your own messages' };
      }
    }

    await Message.updateById(message.id, { suppressEmbeds: true });

    publishToChannel(params.channelId, {
      type: 'suppress_embeds',
      messageId: params.messageId,
    });

    return { success: true };
  }, {
    params: t.Object({
      channelId: t.String(),
      messageId: t.String(),
    }),
  })
  // Delete message
  .delete('/:channelId/messages/:messageId', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { hasAccess, channel, error } = await checkChannelAccess(
      user.id,
      params.channelId
    );

    if (!hasAccess || !channel) {
      set.status = 403;
      return { error: error || 'Access denied' };
    }

    const message = await Message.findOne({
      id: params.messageId,
      channelId: params.channelId,
      isDeleted: false,
    });

    if (!message) {
      set.status = 404;
      return { error: 'Message not found' };
    }

    // Check if user can delete (author, server owner, or MANAGE_MESSAGES).
    const isAuthor = compareIds(message.authorId, user.id);
    let hasPermission = isAuthor;

    if (!isAuthor && channel.serverId) {
      hasPermission = await canManageMessagesInServer(channel.serverId, user.id);
    }

    if (!hasPermission) {
      set.status = 403;
      return { error: 'You do not have permission to delete this message' };
    }

    // Soft delete
    await Message.updateById(message.id, { isDeleted: true, deletedAt: new Date() });


    // Send to SSE connections
    publishToChannel(params.channelId, {
      type: 'delete',
      messageId: params.messageId,
    });

    // Clear stale unread: if this deletion removed the message that left the
    // channel unread for other members, recompute the newest remaining message
    // time and broadcast a reset so their badges roll back. Fire-and-forget.
    void (async () => {
      const [latest] = await Message.find({ channelId: params.channelId, isDeleted: false, _limit: 1 });
      // Move the channel's newest-message pointer off the deleted message (the
      // unread seed reads it).
      if (channel.lastMessageId && compareIds(channel.lastMessageId, message.id)) {
        await Channel.updateById(channel.id, { lastMessageId: latest?.id ?? null }).catch(() => {});
      }
      const lastMessageAt = latest?.createdAt
        ? (latest.createdAt instanceof Date ? latest.createdAt.toISOString() : String(latest.createdAt))
        : null;
      const { notifyUnreadReset } = await import('@/lib/api/activity');
      notifyUnreadReset({ serverId: channel.serverId || undefined }, params.channelId, lastMessageAt, [
        { id: message.id, at: message.createdAt ? new Date(message.createdAt).toISOString() : null },
      ]);
    })().catch(() => { /* best-effort */ });

    void replicateToDiscord('delete', params.channelId, { id: params.messageId });

    // A thread's chip shows its message count.
    if (channel.type === 'public_thread' || channel.type === 'private_thread') {
      refreshThreadAfterMessage(channel.id);
    }

    return { success: true };
  }, {
    params: t.Object({
      channelId: t.String(),
      messageId: t.String(),
    }),
  })
  // Bulk delete (used by the /clear command). Requires MANAGE_MESSAGES / owner.
  .post('/:channelId/messages/bulk-delete', async ({ headers, cookie, params, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { hasAccess, channel, error } = await checkChannelAccess(user.id, params.channelId);
    if (!hasAccess || !channel) {
      set.status = 403;
      return { error: error || 'Access denied' };
    }

    if (!channel.serverId || !(await canManageMessagesInServer(channel.serverId, user.id))) {
      set.status = 403;
      return { error: 'You do not have permission to manage messages' };
    }

    const count = Math.min(Math.max(1, Number(body.count) || 100), 100);
    const targetUserId = body.userId;

    // Grab the most recent messages (optionally from a single author).
    const candidates = await Message.find({
      channelId: params.channelId,
      isDeleted: false,
      ...(targetUserId ? { authorId: targetUserId } : {}),
      _limit: count,
    });

    if (candidates.length === 0) {
      return { deleted: 0 };
    }

    const publisher = getPublisher();
    let deleted = 0;
    for (const msg of candidates as IMessage[]) {
      await Message.updateById(msg.id, { isDeleted: true, deletedAt: new Date() });
      deleted++;
      publishToChannel(params.channelId, { type: 'delete', messageId: msg.id });
      if (publisher) {
        void publisher.publish('message:delete', JSON.stringify({
          channelId: params.channelId,
          serverId: channel.serverId,
          messageId: msg.id,
        }));
      }
    }

    // Roll back stale unread badges for members not currently viewing the
    // channel: the per-message `delete` events above only reach clients with the
    // channel open, so without this a bulk /clear leaves an unread badge behind
    // with no messages behind it. Recompute the newest remaining message and
    // broadcast one reset. Fire-and-forget.
    if (deleted > 0) {
      void (async () => {
        const [latest] = await Message.find({ channelId: params.channelId, isDeleted: false, _limit: 1 });
        await Channel.updateById(channel.id, { lastMessageId: latest?.id ?? null }).catch(() => {});
        const lastMessageAt = latest?.createdAt
          ? (latest.createdAt instanceof Date ? latest.createdAt.toISOString() : String(latest.createdAt))
          : null;
        const { notifyUnreadReset } = await import('@/lib/api/activity');
        notifyUnreadReset(
          { serverId: channel.serverId || undefined },
          params.channelId,
          lastMessageAt,
          (candidates as IMessage[]).slice(0, 100).map((m) => ({
            id: m.id,
            at: m.createdAt ? new Date(m.createdAt).toISOString() : null,
          })),
        );
      })().catch(() => { /* best-effort */ });
    }

    return { deleted };
  }, {
    params: t.Object({
      channelId: t.String(),
    }),
    body: t.Object({
      count: t.Optional(t.Number()),
      userId: t.Optional(t.String()),
    }),
  })
  // Add reaction to message
  .put('/:channelId/messages/:messageId/reactions', async ({ headers, cookie, params, query, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown } >);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { hasAccess, channel, membership, error } = await checkChannelAccess(
      user.id,
      params.channelId
    );

    if (!hasAccess || !channel) {
      set.status = 403;
      return { error: error || 'Access denied' };
    }

    // Timeouts on server channels; blocks + DM privacy on 1:1 DMs.
    const reactDenied = await checkCanPostInChannel(channel, user, membership, { checkSendPermission: false });
    if (reactDenied) {
      set.status = reactDenied.status;
      return reactDenied.body;
    }

    const message = await Message.findOne({
      id: params.messageId,
      channelId: params.channelId,
      isDeleted: false,
    });

    if (!message) {
      set.status = 404;
      return { error: 'Message not found' };
    }

    // Get emoji from query parameter (avoids URL path encoding issues with custom emoji tokens)
    const decodedEmoji = typeof query.emoji === 'string' ? query.emoji : '';
    if (!decodedEmoji) {
      set.status = 400;
      return { error: 'Missing emoji parameter' };
    }
    
    // Parse emoji - handles both custom emojis and unicode
    const emojiData = await getReactionEmoji(decodedEmoji);
    if (!emojiData) {
      set.status = 400;
      return { error: 'Invalid emoji' };
    }
    
    // Timed-out members can't react; ADD_REACTIONS gates starting a new reaction
    // (joining an existing one is allowed, as on Discord).
    const startsNewReaction = !((message.reactions || []) as StoredReaction[]).some(matchReactionEmoji(emojiData));
    const speakDenial = await checkCanSpeak(channel, membership, user.id, startsNewReaction ? ['react'] : []);
    if (speakDenial) {
      set.status = speakDenial.status;
      return speakDenial.body;
    }

    // Find or create reaction - match by ID for custom emojis, name for unicode.
    // Row-locked so concurrent reactions can't overwrite each other.
    let reactionCount = 0;
    const stored = await Message.mutateReactions<StoredReaction>(message.id, (current) => {
      const result = addReaction(
        current,
        matchReactionEmoji(emojiData),
        { name: emojiData.name, id: emojiData.id, animated: emojiData.animated, url: emojiData.url },
        user.id,
        compareIds,
      );
      reactionCount = result.count;
      return result.reactions;
    });
    if (!stored) {
      set.status = 404;
      return { error: 'Message not found' };
    }

    // Publish reaction event
    publishToChannel(params.channelId, {
      type: 'reaction_add',
      messageId: params.messageId,
      emoji: decodedEmoji,
      userId: user.id,
      count: reactionCount,
    });

    return { success: true };
  }, {
    params: t.Object({
      channelId: t.String(),
      messageId: t.String(),
    }),
    query: t.Object({
      emoji: t.String(),
    }),
  })
  // Remove reaction from message
  .delete('/:channelId/messages/:messageId/reactions', async ({ headers, cookie, params, query, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown } >);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { hasAccess, channel, error } = await checkChannelAccess(
      user.id,
      params.channelId
    );

    if (!hasAccess || !channel) {
      set.status = 403;
      return { error: error || 'Access denied' };
    }

    const message = await Message.findOne({
      id: params.messageId,
      channelId: params.channelId,
      isDeleted: false,
    });

    if (!message) {
      set.status = 404;
      return { error: 'Message not found' };
    }

    const decodedEmoji = typeof query.emoji === 'string' ? query.emoji : '';
    if (!decodedEmoji) {
      set.status = 400;
      return { error: 'Missing emoji parameter' };
    }
    
    // Parse emoji to get ID for custom emojis
    const emojiData = await getReactionEmoji(decodedEmoji);
    
    // Row-locked so concurrent reaction changes can't overwrite each other.
    const removeMatch = matchReactionEmoji({ name: emojiData?.name || decodedEmoji, id: emojiData?.id });
    await Message.mutateReactions<StoredReaction>(message.id, (current) => {
      const result = removeReaction(current, removeMatch, user.id, compareIds);
      return result.changed ? result.reactions : null;
    });

    // Publish reaction removal event
    publishToChannel(params.channelId, {
      type: 'reaction_remove',
      messageId: params.messageId,
      emoji: emojiData?.id || decodedEmoji,
      userId: user.id,
    });

    return { success: true };
  }, {
    params: t.Object({
      channelId: t.String(),
      messageId: t.String(),
    }),
    query: t.Object({
      emoji: t.String(),
    }),
  })
  // Typing indicator
  .post('/:channelId/typing', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { hasAccess, channel, error } = await checkChannelAccess(
      user.id,
      params.channelId
    );

    if (!hasAccess || !channel) {
      set.status = 403;
      return { error: error || 'Access denied' };
    }

    // Set typing in Redis
    await cache.setTyping(params.channelId, user.id);


    // Send to SSE connections
    publishToChannel(params.channelId, {
      type: 'typing',
      userId: user.id,
      username: user.username,
    });

    return { success: true };
  }, {
    params: t.Object({
      channelId: t.String(),
    }),
  })
  // Whether this channel's messages are bridged out to Discord. Used by the
  // client to prompt the sender for data-processing consent on their first
  // message. Returns only a boolean — never the webhook URL (a secret).
  .get('/:channelId/bridge-status', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { hasAccess, channel } = await checkChannelAccess(user.id, params.channelId);
    if (!hasAccess || !channel || !channel.serverId) return { bridged: false };

    const server = await Server.findById(channel.serverId);
    const integrations = (server?.settings as IServerSettings | undefined)?.integrations || {};
    const bridged = Boolean(integrations.discord) && Boolean((integrations.discordWebhooks as Record<string, string> | undefined)?.[params.channelId]);
    return { bridged };
  }, {
    params: t.Object({
      channelId: t.String(),
    }),
  })
  // SSE stream for real-time messages
  .get('/:channelId/stream', async ({ headers, cookie, params }) => {
    const sseHeaders = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    };

    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      // Return error as SSE event
      const errorStream = new ReadableStream({
        start(controller) {
          controller.enqueue(sseEncoder.encode(`data: ${JSON.stringify({ type: 'error', error: authError || 'Unauthorized' })}\n\n`));
          controller.close();
        },
      });
      return new Response(errorStream, { headers: sseHeaders });
    }

    const { hasAccess, error } = await checkChannelAccess(
      user.id,
      params.channelId
    );

    if (!hasAccess) {
      const errorStream = new ReadableStream({
        start(controller) {
          controller.enqueue(sseEncoder.encode(`data: ${JSON.stringify({ type: 'error', error: error || 'Access denied' })}\n\n`));
          controller.close();
        },
      });
      return new Response(errorStream, { headers: sseHeaders });
    }

    const channelKey = params.channelId;
    let controllerRef: ReadableStreamDefaultController | null = null;
    let pingInterval: NodeJS.Timeout | null = null;
    let disposeGuard: (() => void) | null = null;

    // Create SSE stream
    const stream = new ReadableStream({
      start(controller) {
        controllerRef = controller;
        // Add to active connections
        if (!activeConnections.has(channelKey)) {
          activeConnections.set(channelKey, new Set());
        }
        activeConnections.get(channelKey)!.add(controller);

        // Close the stream once the user loses access (kick/ban/leave/role edit).
        disposeGuard = attachChannelAccessGuard(user.id, channelKey, () => {
          if (pingInterval) clearInterval(pingInterval);
          const set = activeConnections.get(channelKey);
          if (set) {
            set.delete(controller);
            if (set.size === 0) activeConnections.delete(channelKey);
          }
          try {
            controller.enqueue(sseEncoder.encode(CHANNEL_STREAM_REVOKED_EVENT));
            controller.close();
          } catch { /* already closed */ }
        });

        // Send initial ping
        controller.enqueue(sseEncoder.encode('data: {"type":"connected"}\n\n'));

        // Keep-alive ping every 15 seconds
        pingInterval = setInterval(() => {
          try {
            controller.enqueue(sseEncoder.encode('data: {"type":"ping"}\n\n'));
          } catch {
            if (pingInterval) {
              clearInterval(pingInterval);
            }
            disposeGuard?.();
            activeConnections.get(channelKey)?.delete(controller);
          }
        }, 15000);
      },
      cancel() {
        // Connection closed - cleanup
        if (pingInterval) {
          clearInterval(pingInterval);
        }
        disposeGuard?.();
        if (controllerRef) {
          const set = activeConnections.get(channelKey);
          if (set) {
            set.delete(controllerRef);
            if (set.size === 0) activeConnections.delete(channelKey);
          }
        }
      },
    });

    return new Response(stream, { headers: sseHeaders });
  }, {
    params: t.Object({
      channelId: t.String(),
    }),
  })
  // Join thread
  .put('/:channelId/join', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { hasAccess, channel } = await checkChannelAccess(user.id, params.channelId);
    if (!hasAccess || !channel) {
      set.status = 403;
      return { error: 'Access denied' };
    }

    if (channel.type !== 'public_thread' && channel.type !== 'private_thread') {
      set.status = 400;
      return { error: 'Channel is not a thread' };
    }

    const joined = await addThreadMembers(channel.id, [user.id]);
    if (joined.length > 0) {
      notifyThreadMembership(channel.serverId, channel.id, joined);
      const updated = await Channel.findById(channel.id);
      if (updated) void broadcastThreadUpdate(updated).catch(() => null);
    }

    return { success: true };
  }, {
    params: t.Object({
      channelId: t.String(),
    }),
  })
  // Leave thread
  .delete('/:channelId/leave', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { hasAccess, channel } = await checkChannelAccess(user.id, params.channelId);
    if (!hasAccess || !channel) {
      set.status = 403;
      return { error: 'Access denied' };
    }

    if (channel.type !== 'public_thread' && channel.type !== 'private_thread') {
      set.status = 400;
      return { error: 'Channel is not a thread' };
    }

    const threadMemberIds = Array.isArray(channel.threadMemberIds) ? (channel.threadMemberIds as string[]) : [];
    if (threadMemberIds.some((id) => compareIds(id, user.id))) {
      await removeThreadMember(channel.id, user.id);
      notifyThreadMembership(channel.serverId, channel.id, [user.id]);
      const updated = await Channel.findById(channel.id);
      if (updated) void broadcastThreadUpdate(updated).catch(() => null);
    }

    return { success: true };
  }, {
    params: t.Object({
      channelId: t.String(),
    }),
  })

  // ─── Channel Webhooks (user-authenticated) ─────────────────────────────────
  .get('/:channelId/webhooks', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }
    const { hasAccess, channel, membership } = await checkChannelAccess(user.id, params.channelId);
    if (!hasAccess || !channel) { set.status = 403; return { error: 'Access denied' }; }
    // The token/url is the webhook's secret: only people who can manage
    // webhooks here (or the webhook's creator) get it.
    let canManage = true;
    if (channel.serverId) {
      canManage = await canManageWebhooksInServer(channel.serverId, user.id, membership);
    }
    const { ChannelWebhook } = await import('@/lib/models');
    const webhooks = await ChannelWebhook.find({ channelId: params.channelId });
    return webhooks.map((w) => {
      const showSecret = canManage || Boolean(w.creatorId && compareIds(w.creatorId, user.id));
      return {
        id: w.id,
        type: 1,
        guild_id: channel.serverId ?? null,
        channel_id: params.channelId,
        name: w.name,
        avatar: w.avatar,
        ...(showSecret ? { token: w.token, url: w.url } : {}),
        creator_id: w.creatorId ?? null,
      };
    });
  })
  .post('/:channelId/webhooks', async ({ headers, cookie, params, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }
    const { hasAccess, channel, membership } = await checkChannelAccess(user.id, params.channelId);
    if (!hasAccess || !channel) { set.status = 403; return { error: 'Access denied' }; }
    if (channel.serverId && !(await canManageWebhooksInServer(channel.serverId, user.id, membership))) {
      set.status = 403; return { error: 'Missing MANAGE_WEBHOOKS permission' };
    }
    const { name, avatar } = body as { name: string; avatar?: string };
    if (!name || typeof name !== 'string') { set.status = 400; return { error: 'Name is required' }; }
    const { ChannelWebhook } = await import('@/lib/models');
    const token = randomUUID().replace(/-/g, '');
    const webhook = await ChannelWebhook.create({
      channelId: params.channelId,
      serverId: channel.serverId ?? undefined,
      name: name.trim(),
      avatar: avatar ?? null,
      token,
      url: `${config.API_BASE_URL}/api/webhooks/${params.channelId}/${token}`,
      creatorId: user.id,
    });
    return {
      id: webhook.id,
      type: 1,
      guild_id: channel.serverId ?? null,
      channel_id: params.channelId,
      name: webhook.name,
      avatar: webhook.avatar,
      token: webhook.token,
      url: webhook.url,
      creator_id: user.id,
    };
  }, {
    body: t.Object({
      name: t.String({ minLength: 1, maxLength: 80 }),
      avatar: t.Optional(t.Any()),
    }),
  })
  .delete('/:channelId/webhooks/:webhookId', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }
    const { hasAccess, channel, membership } = await checkChannelAccess(user.id, params.channelId);
    if (!hasAccess || !channel) { set.status = 403; return { error: 'Access denied' }; }
    const { ChannelWebhook } = await import('@/lib/models');
    const webhook = await ChannelWebhook.findById(params.webhookId);
    if (!webhook || webhook.channelId !== params.channelId) {
      set.status = 404; return { error: 'Webhook not found' };
    }
    if (channel.serverId) {
      const isCreator = webhook.creatorId && compareIds(webhook.creatorId, user.id);
      if (!isCreator && !(await canManageWebhooksInServer(channel.serverId, user.id, membership))) {
        set.status = 403; return { error: 'You can only delete your own webhooks' };
      }
    }
    await ChannelWebhook.deleteById(params.webhookId);
    return { success: true };
  });
