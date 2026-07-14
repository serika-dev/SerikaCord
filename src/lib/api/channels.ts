import { Elysia, t } from 'elysia';
import { Channel, Message, Role, Server, ServerMember, ServerSticker, User } from '@/lib/models';
import { authenticateRequest } from '@/lib/services/auth';
import { parseCustomEmojis, batchParseCustomEmojis, normalizeEmojiFormat, getReactionEmoji } from '@/lib/services/emoji';
import { checkRateLimit, sanitizeInput, validateMessageContent, encryptForStorage, decryptFromStorage } from '@/lib/security';
import { decodeHtmlEntities } from '@/lib/chat/messages';
import { cache, getPublisher } from '@/lib/db';
import { config } from '@/lib/config';
import { randomUUID } from 'crypto';
import { normalizeId } from '@/lib/db/normalizeId';

// Helper to safely compare IDs (normalizes MongoDB ObjectId format to UUID)
function compareIds(id1: string, id2: string): boolean {
  return normalizeId(id1) === normalizeId(id2);
}

// Permission bits
const PERM_ADMINISTRATOR = 1n << 3n;
const PERM_MANAGE_MESSAGES = 1n << 13n;
const PERM_VIEW_CHANNEL = 1n << 10n;
const PERM_MANAGE_CHANNELS = 1n << 4n;
const PERM_PIN_MESSAGES = 1n << 51n;

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

/**
 * Check if a user can view a channel based on permissionOverwrites.
 * Returns true if:
 * - User is server owner (always allowed)
 * - User has Administrator permission (always allowed)
 * - No overwrites deny VIEW_CHANNEL to the user's roles or @everyone
 * - User's roles explicitly allow VIEW_CHANNEL
 */
// In-memory cache for role permission checks: serverId+roleId -> permissions bigint string
// TTL 60s — roles change rarely, but we don't want stale perms forever.
const rolePermCache = new Map<string, string>();
const ROLE_CACHE_TTL_MS = 60_000;

async function getRolePermissions(roleIds: string[], serverId: string): Promise<Map<string, bigint>> {
  const result = new Map<string, bigint>();
  const now = Date.now();
  const uncachedIds: string[] = [];
  for (const id of roleIds) {
    const key = `${serverId}:${id}`;
    const cached = rolePermCache.get(key);
    if (cached !== undefined) {
      result.set(id, BigInt(cached));
    } else {
      uncachedIds.push(id);
    }
  }
  if (uncachedIds.length > 0) {
    const roles = await Role.find({ id: { in: uncachedIds }, serverId });
    for (const role of roles) {
      const perms = role.permissions || '0';
      result.set(role.id, BigInt(perms));
      rolePermCache.set(`${serverId}:${role.id}`, perms);
    }
    // Schedule cleanup
    setTimeout(() => {
      for (const id of uncachedIds) rolePermCache.delete(`${serverId}:${id}`);
    }, ROLE_CACHE_TTL_MS);
  }
  return result;
}

async function canViewChannel(
  channel: { permissionOverwrites?: any[]; serverId?: string | null },
  userId: string,
  membership: { roles?: string[] | null } | null,
  serverOwnerId?: string | null,
): Promise<boolean> {
  if (serverOwnerId && compareIds(serverOwnerId, userId)) return true;

  const overwrites = channel.permissionOverwrites || [];
  if (!overwrites || overwrites.length === 0) return true;

  // Check if user has Administrator via roles (cached)
  if (membership?.roles?.length && channel.serverId) {
    const rolePerms = await getRolePermissions(membership.roles, channel.serverId);
    for (const [, perms] of rolePerms) {
      if ((perms & PERM_ADMINISTRATOR) === PERM_ADMINISTRATOR) return true;
      if ((perms & PERM_MANAGE_CHANNELS) === PERM_MANAGE_CHANNELS) return true;
    }
  }

  // Find @everyone overwrite (type 'role', id matches serverId)
  const everyoneOverwrite = overwrites.find((o: any) => o.type === 'role' && o.id === channel.serverId);
  let baseAllow = 0n;
  let baseDeny = 0n;
  if (everyoneOverwrite) {
    baseAllow = BigInt(everyoneOverwrite.allow || '0');
    baseDeny = BigInt(everyoneOverwrite.deny || '0');
  }

  // Start with @everyone baseline
  let effectiveAllow = baseAllow;
  let effectiveDeny = baseDeny;

  // Apply role-specific overwrites
  if (membership?.roles?.length) {
    for (const roleId of membership.roles) {
      const roleOverwrite = overwrites.find((o: any) => o.type === 'role' && o.id === roleId);
      if (roleOverwrite) {
        effectiveAllow |= BigInt(roleOverwrite.allow || '0');
        effectiveDeny |= BigInt(roleOverwrite.deny || '0');
      }
    }
  }

  // Apply member-specific overwrites (highest priority)
  const memberOverwrite = overwrites.find((o: any) => o.type === 'member' && o.id === userId);
  if (memberOverwrite) {
    effectiveAllow |= BigInt(memberOverwrite.allow || '0');
    effectiveDeny |= BigInt(memberOverwrite.deny || '0');
  }

  // If explicitly denied VIEW_CHANNEL, block
  if ((effectiveDeny & PERM_VIEW_CHANNEL) === PERM_VIEW_CHANNEL) return false;
  // If explicitly allowed VIEW_CHANNEL, permit
  if ((effectiveAllow & PERM_VIEW_CHANNEL) === PERM_VIEW_CHANNEL) return true;
  // Default: allow if @everyone doesn't deny it
  if ((baseDeny & PERM_VIEW_CHANNEL) === PERM_VIEW_CHANNEL) return false;
  return true;
}

const PRESERVED_MESSAGE_TOKEN_REGEX = /<@!?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}>|<@&[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}>|<#(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>|<a?:[a-zA-Z0-9_]+:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}>|<t:-?\d{1,13}(?::[tTdDfFRC](?:\[[^\]]*\])?)?>|<t:-?\d{1,13}>/g;
const USER_MENTION_REGEX = /<@!?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>/g;
const ROLE_MENTION_REGEX = /<@&([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>/g;
const CHANNEL_MENTION_REGEX = /<#([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>/g;

function sanitizeMessageContent(content: string): string {
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
    mentionedUserIds: (memberRows as any[]).map((row) => row.userId),
    mentionedRoleIds: (roleRows as any[]).map((row) => row.id),
    mentionedChannelIds: (channelRows as any[]).map((row) => row.id),
  };
}

// Store active SSE connections for server channels
const activeConnections = new Map<string, Set<ReadableStreamDefaultController>>();

// Unique id for THIS process, so the Redis→SSE bridge can skip re-delivering
// events this instance already delivered locally (prevents duplicates).
const INSTANCE_ID = randomUUID();
// Single Redis channel carrying all channel SSE events (payload names the channel).
const SSE_BUS = 'sse:channel';

// Deliver an event to SSE connections held by THIS process only.
function deliverToLocalChannel(channelId: string, data: object) {
  const connections = activeConnections.get(channelId);
  if (connections) {
    const encodedData = `data: ${JSON.stringify(data)}\n\n`;
    connections.forEach((controller) => {
      try {
        controller.enqueue(new TextEncoder().encode(encodedData));
      } catch {
        // Connection closed, will be cleaned up
      }
    });
  }
}

// Register a raw SSE write callback into the channel's active connection set.
// Used by server.ts to bypass Next.js response buffering — the raw HTTP response
// writes go directly to the socket, so events are flushed immediately.
export function registerRawSSEConnection(
  channelId: string,
  write: (data: string) => void,
): () => void {
  const controller = {
    enqueue: (data: Uint8Array) => { try { write(new TextDecoder().decode(data)); } catch { /* closed */ } },
  } as unknown as ReadableStreamDefaultController;

  if (!activeConnections.has(channelId)) {
    activeConnections.set(channelId, new Set());
  }
  activeConnections.get(channelId)!.add(controller);

  return () => { activeConnections.get(channelId)?.delete(controller); };
}

// Publish a channel event: deliver locally AND fan out over Redis so every
// other app instance delivers it to its own SSE connections at the same time.
// This is what makes chat realtime for all users regardless of which instance
// they're connected to. Redis (not Postgres) is the right tool here — the
// bottleneck was never the datastore, it was the missing pub/sub fan-out.
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
      const { originId, channelId, data } = JSON.parse(payload) as {
        originId: string; channelId: string; data: object;
      };
      // Skip events this instance already delivered locally.
      if (originId === INSTANCE_ID) return;
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
  membership?: { roles?: string[] | null; nickname?: string | null } | null;
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
    const [membership, server] = await Promise.all([
      ServerMember.findOne({ serverId: channel.serverId, userId }),
      Server.findById(channel.serverId),
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
        if (!isServerOwner && channel.parentId) {
          const parent = await Channel.findById(channel.parentId);
          const accessRoles = (parent?.ticketAccessRoleIds || []).map((r: string) => r);
          if (accessRoles.length) {
            const memberRoles = (membership.roles || []).map((r: string) => r);
            hasAccessRole = memberRoles.some((r: string) => accessRoles.includes(r));
          }
        }
        if (!isServerOwner && !hasAccessRole) {
          return { hasAccess: false, error: 'You do not have access to this thread' };
        }
      }
    }

    // Check channel permission overwrites for VIEW_CHANNEL
    const serverOwnerId = server?.ownerId ?? null;
    const canView = await canViewChannel(
      { permissionOverwrites: (channel.permissionOverwrites || []) as any[], serverId: channel.serverId },
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
    const integrations = (server.settings as any)?.integrations || {};
    if (!integrations.discord) return;

    // Avoid feedback loops from Discord-bridged users
    if (message.author?.isDiscord || message.author?.username?.startsWith('discord-')) {
      return;
    }

    const guildId = integrations.discordGuildId;
    const webhookUrl = integrations.discordWebhooks?.[channelId];

    if (!webhookUrl) return;

    console.log(`[Discord Bridge] Replicating ${action} on channel #${channel.name} to Discord (Guild: ${guildId})`);

    const username = message.author?.displayName || message.author?.username || 'User';
    const avatarUrl = message.author?.avatar || undefined;
    const webhookUserPart = {
      username: `${username} (Serika)`,
      avatar_url: avatarUrl,
    };

    // Build Discord-friendly content from Serika content
    const discordContent = formatSerikaContentForDiscord(message.content || '');

    // Build embeds from attachments — handle images, videos, and other files
    const buildAttachmentEmbeds = (attachments: any[]): any[] => {
      if (!attachments || !Array.isArray(attachments)) return [];
      const embeds: any[] = [];
      for (const att of attachments) {
        const url = att.url || att;
        const contentType = att.contentType || '';
        const filename = att.filename || '';
        if (contentType.startsWith('image/')) {
          embeds.push({ image: { url } });
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
      const body: any = {
        content: discordContent,
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
          await Message.updateById(message.id, { discordMessageId: discordMsg.id }).catch(() => {});
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
        const body: any = {
          content: discordContent,
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
            content: discordContent,
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
        const body: any = {
          content: `*(edited)* ${discordContent}`,
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
        await fetch(deleteUrl, {
          method: 'DELETE',
        }).catch(err => console.error('[Discord Bridge] Failed to delete webhook message:', err));
        console.log(`[Discord Bridge] Deleted Discord message ${discordMsgId} for Serika message ${message.id}`);
      } else {
        console.log(`[Discord Bridge] No Discord message ID stored for Serika message ${message.id} — cannot delete on Discord.`);
      }
    }
  } catch (err) {
    console.error('[Discord Bridge] Error in replicateToDiscord:', err);
  }
}

export const channelRoutes = new Elysia({ prefix: '/channels' })
  // Get channel
  .get('/:channelId', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { hasAccess, channel, error } = await checkChannelAccess(
      user.id,
      params.channelId
    );

    if (!hasAccess) {
      set.status = 403;
      return { error };
    }

    // Expose the parent forum name for thread channels so the client can
    // render the forum post list alongside the open thread.
    if (channel && (channel.type === 'public_thread' || channel.type === 'private_thread') && channel.parentId) {
      const parent = await Channel.findById(channel.parentId);
      const enriched = { ...channel, parentName: parent?.name, parentId: channel.parentId };
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
    const { hasAccess, channel, error } = await checkChannelAccess(user.id, params.channelId);
    if (!hasAccess || !channel) {
      set.status = 403;
      return { error: error || 'Access denied' };
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

    const { hasAccess, channel, error } = await checkChannelAccess(
      user.id,
      params.channelId
    );

    if (!hasAccess || !channel) {
      set.status = 403;
      return { error: error || 'Access denied' };
    }

    const isThread = channel.type === 'public_thread' || channel.type === 'private_thread';

    // Check permissions (owner or manage channels). Thread owners may manage
    // their own thread (rename / archive / lock).
    let isServerOwner = false;
    if (channel.serverId) {
      const server = await Server.findById(channel.serverId);
      isServerOwner = !!server && compareIds(server.ownerId, user.id);
      const isThreadOwner = isThread && compareIds(channel.ownerId, user.id);
      if (!isServerOwner && !isThreadOwner) {
        set.status = 403;
        return { error: 'You do not have permission to edit this channel' };
      }
    }

    const { name, topic, nsfw, rateLimitPerUser, bitrate, userLimit, parentId, position, permissionOverwrites, type, forumMode, ticketAccessRoleIds, availableTags, archived, locked } = body;

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

    if (parentId !== undefined) {
      if (parentId === null) {
        updateData.parentId = null;
      } else {
        if (channel.type === 'category') {
          set.status = 400;
          return { error: 'A category cannot have a parent category' };
        }
        const parentChannel = await Channel.findById(parentId);
        if (!parentChannel || parentChannel.type !== 'category') {
          set.status = 400;
          return { error: 'Invalid parent category' };
        }
        updateData.parentId = parentId;
      }
    }

    // Thread self-management
    if (isThread) {
      if (archived !== undefined) updateData.archived = Boolean(archived);
      if (locked !== undefined && isServerOwner) updateData.locked = Boolean(locked);
    }

    // Forum configuration (server owner only)
    if (channel.type === 'forum' && isServerOwner) {
      if (forumMode !== undefined && (forumMode === 'posts' || forumMode === 'tickets')) {
        updateData.forumMode = forumMode;
      }
      if (ticketAccessRoleIds !== undefined) {
        updateData.ticketAccessRoleIds = ticketAccessRoleIds;
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
    const updated = await Channel.findById(channel.id);

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
    }),
  })
  // Delete channel
  .delete('/:channelId', async ({ headers, cookie, params, set }) => {
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

    // Can't delete DMs this way
    if (channel.type === 'dm' || channel.type === 'group_dm') {
      set.status = 400;
      return { error: 'Cannot delete DM channels' };
    }

    // Check permissions
    if (channel.serverId) {
      const server = await Server.findById(channel.serverId);
      if (!server || !compareIds(server.ownerId, user.id)) {
        set.status = 403;
        return { error: 'You do not have permission to delete this channel' };
      }
    }

    // Soft delete messages
    const messages = await Message.find({ channelId: channel.id });
    await Promise.all(messages.map(m => Message.updateById(m.id, { isDeleted: true, deletedAt: new Date() })));

    await Channel.deleteById(channel.id);

    // Publish delete event
    const publisher = getPublisher();
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

    const { hasAccess, channel, error } = await checkChannelAccess(user.id, params.channelId);
    if (!hasAccess || !channel) {
      set.status = 403;
      return { error: error || 'Access denied' };
    }
    if (channel.type !== 'forum') {
      set.status = 400;
      return { error: 'Channel is not a forum' };
    }

    const includeArchived = (query as { archived?: string }).archived === 'true';
    const allThreads = await Channel.find({ parentId: channel.id });
    let threads = allThreads
      .filter((t: any) => t.type === 'public_thread' || t.type === 'private_thread')
      .filter((t: any) => includeArchived || !t.archived)
      .sort((a: any, b: any) => {
        const aLast = a.lastMessageId || a.createdAt;
        const bLast = b.lastMessageId || b.createdAt;
        return new Date(bLast).getTime() - new Date(aLast).getTime();
      })
      .slice(0, 100);

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
          const reactions = (first.reactions as any[]) || [];
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

    const { hasAccess, channel: forum, error } = await checkChannelAccess(user.id, params.channelId);
    if (!hasAccess || !forum) {
      set.status = 403;
      return { error: error || 'Access denied' };
    }
    if (forum.type !== 'forum') {
      set.status = 400;
      return { error: 'Channel is not a forum' };
    }

    const { name, content, appliedTags = [] } = body;
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
    const mentionData = await extractMentionsFromContent(sanitizedContent, forum.serverId || null);
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

    const publisher = getPublisher();
    if (publisher) {
      await publisher.publish('thread:create', JSON.stringify({
        channelId: forum.id,
        threadId: thread.id,
        serverId: forum.serverId,
      }));
    }

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
      content: t.String({ minLength: 1, maxLength: 4000 }),
      appliedTags: t.Optional(t.Array(t.String())),
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

    const limit = Math.min(parseInt(query.limit || '50'), config.MAX_MESSAGES_PER_FETCH);
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
      }
    } else if (around) {
      const aroundMsg = await Message.findById(around);
      if (aroundMsg) {
        msgFilter.createdAtBefore = aroundMsg.createdAt;
        msgFilter._limit = limit;
      }
    }

    const messages = await Message.find(msgFilter);
    messages.reverse(); // oldest first for display

    // Now fetch server owner and nicknames only for the authors in this page
    if (serverId) {
      const authorIds = [...new Set(messages.map((m: any) => m.authorId).filter(Boolean))];
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
      for (const m of authorMembers as any[]) {
        if (m.nickname) {
          nicknameMap.set(m.userId, m.nickname);
        }
      }
    }

    // Batch fetch authors
    const authorIds = Array.from(new Set(messages.map((m: any) => m.authorId).filter(Boolean))) as string[];
    const authors = authorIds.length > 0 ? await User.find({ id: { in: authorIds } }) : [];
    const authorMap = new Map(authors.map((a: any) => [a.id, a]));

    // Fetch Discord users for author IDs not found in the User table
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
    }

    // Batch fetch referenced messages
    const refIds = Array.from(new Set(messages.map((m: any) => m.referencedMessageId).filter(Boolean))) as string[];
    const refMessages = refIds.length > 0 ? await Message.find({ id: { in: refIds } }) : [];
    const refMap = new Map(refMessages.map((r: any) => [r.id, r]));
    // Batch fetch referenced message authors
    const refAuthorIds = Array.from(new Set(refMessages.map((r: any) => r.authorId).filter(Boolean))) as string[];
    const refAuthors = refAuthorIds.length > 0 ? await User.find({ id: { in: refAuthorIds } }) : [];
    const refAuthorMap = new Map(refAuthors.map((a: any) => [a.id, a]));
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

    // Transform for frontend - return array directly and map id
    // Phase 1: Decrypt all message contents in parallel
    const decryptedContents = await Promise.all(
      (messages as any[]).map((msg) => decryptFromStorage(msg.content || ''))
    );

    // Phase 2: Batch-parse custom emojis across all decrypted contents in a
    // single pass — one DB query for all cache misses instead of N per-message
    // parseCustomEmojis calls. No server restriction here: access was validated
    // at send time, and restricting to the message's own server broke rendering
    // of cross-server emojis on fetch.
    const emojiResults = await batchParseCustomEmojis(decryptedContents);

    // Phase 3: Decrypt referenced message contents (batch, parallel)
    const refDecryptEntries = (messages as any[])
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
    const decryptedMessages = (messages as any[]).map((msg, idx) => {
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
        isDiscord: (authorData as any).isDiscord || authorData.username?.startsWith('discord-') || false,
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
        interaction: (msg as any).interaction ?? undefined,
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
  // Search messages in channel (decrypt + filter)
  .get('/:channelId/messages/search', async ({ headers, cookie, params, query, set }) => {
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

    const rawQuery = (query.q || '').trim();
    if (rawQuery.length < 2) {
      return { messages: [] };
    }

    const resultLimit = Math.min(parseInt(query.limit || '20', 10), 50);
    const searchLimit = Math.min(parseInt(query.searchLimit || '400', 10), 1000);

    const candidates = await Message.find({
      channelId: params.channelId,
      isDeleted: false,
      _limit: searchLimit,
    });
    const sortedCandidates = candidates;

    // Batch fetch authors
    const authorIds = Array.from(new Set(sortedCandidates.map((m: any) => m.authorId).filter(Boolean))) as string[];
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
        });
      }
    }
    const lowered = rawQuery.toLowerCase();
    const results: Array<Record<string, unknown>> = [];

    for (const msg of sortedCandidates as any[]) {
      const decrypted = await decryptFromStorage(msg.content || '');
      if (!decrypted.toLowerCase().includes(lowered)) continue;

      const authorData = msg.authorId ? authorMap.get(msg.authorId) : null;

      results.push({
        id: msg.id,
        content: decrypted,
        authorId: authorData?.id || msg.authorId,
        author: authorData
          ? {
              id: authorData.id,
              username: authorData.username,
              displayName: authorData.displayName || authorData.username,
              avatar: authorData.avatar,
            }
          : null,
        channelId: msg.channelId,
        createdAt: msg.createdAt,
        updatedAt: msg.updatedAt,
        pinned: msg.pinned,
      });

      if (results.length >= resultLimit) break;
    }

    return { messages: results };
  }, {
    params: t.Object({
      channelId: t.String(),
    }),
    query: t.Object({
      q: t.String({ minLength: 1 }),
      limit: t.Optional(t.String()),
      searchLimit: t.Optional(t.String()),
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

    // Enforce timeout (communication disabled) on server channels
    if (channel.serverId && membership) {
      const disabledUntil = (membership as any).communicationDisabledUntil;
      if (disabledUntil && new Date(disabledUntil).getTime() > Date.now()) {
        set.status = 403;
        return { error: 'You are timed out from this server', communicationDisabledUntil: new Date(disabledUntil).toISOString() };
      }
    }

    if (channel.type === 'public_thread' || channel.type === 'private_thread') {
      const threadMembers = Array.isArray(channel.threadMemberIds) ? (channel.threadMemberIds as string[]) : [];
      if (!threadMembers.includes(user.id)) {
        const nextMembers = [...threadMembers, user.id];
        await Channel.updateById(channel.id, { threadMemberIds: nextMembers });
        channel.threadMemberIds = nextMembers;
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

    const [rateLimit, globalRateLimit, serverOwnerId] = await Promise.all([
      checkRateLimit('message', `${user.id}:${params.channelId}`),
      checkRateLimit('messageGlobal', user.id),
      serverOwnerPromise,
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
      extractMentionsFromContent(sanitizedContent, channel.serverId || null),
      sanitizedContent ? encryptForStorage(sanitizedContent) : Promise.resolve(''),
    ]);

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
      type: replyTo ? 'reply' : 'default',
      referencedMessageId: replyTo,
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

    if (message.referencedMessageId) {
      const reference = await Message.findById(message.referencedMessageId);
      if (reference) {
        let refAuthor = reference.authorId ? await User.findById(reference.authorId) : null;
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
              isBot: da.isBot,
              isVerified: false,
            } as any;
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

    // App-wide unread signal: notify every other member of this server so their
    // sidebar can glow / badge the channel even when they're not viewing it.
    // Fire-and-forget — never block the sender's response on fan-out.
    if (channel.serverId) {
      void (async () => {
        try {
          const { notifyChannelActivity } = await import('@/lib/api/activity');
          await notifyChannelActivity({
            type: 'channel_activity',
            serverId: channel.serverId as string,
            channelId: message.channelId,
            channelName: channel.name,
            messageId: message.id,
            authorId: user.id,
            authorName: senderNickname || author?.displayName || author?.username,
            mentionedUserIds: (message.mentionedUserIds || []) as string[],
            mentionEveryone: Boolean(message.mentionEveryone),
            createdAt: new Date(message.createdAt ?? Date.now()).toISOString(),
          });
        } catch { /* best-effort */ }
      })();
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

    const limit = Math.min(parseInt(query.limit || '50', 10), 100);
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
    }

    // Batch decrypt + batch parse emojis for pinned messages
    const pinnedContents = await Promise.all(
      (pinnedMessages as any[]).map((msg) => decryptFromStorage(msg.content || ''))
    );
    const pinnedEmojiResults = await batchParseCustomEmojis(pinnedContents);

    const messages = (pinnedMessages as any[]).map((msg, idx) => {
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

    const publisher = getPublisher();
    if (publisher) {
      await publisher.publish('message:update', JSON.stringify({
        channelId: params.channelId,
        serverId: channel.serverId,
        messageId: params.messageId,
        pinned: true,
      }));
    }

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

    const publisher = getPublisher();
    if (publisher) {
      await publisher.publish('message:update', JSON.stringify({
        channelId: params.channelId,
        serverId: channel.serverId,
        messageId: params.messageId,
        pinned: false,
      }));
    }

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
        extractMentionsFromContent(sanitizedEditContent, channel.serverId || null),
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

    // Publish update event with decrypted content for SSE
    const publisher = getPublisher();
    if (publisher) {
      await publisher.publish('message:update', JSON.stringify({
        channelId: params.channelId,
        serverId: channel.serverId,
        messageId: params.messageId,
        content: sanitizedEditContent, // Send decrypted for SSE
        editedTimestamp: updateData.editedTimestamp,
      }));
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

    // Publish delete event
    const publisher = getPublisher();
    if (publisher) {
      await publisher.publish('message:delete', JSON.stringify({
        channelId: params.channelId,
        serverId: channel.serverId,
        messageId: params.messageId,
      }));
    }

    // Send to SSE connections
    publishToChannel(params.channelId, {
      type: 'delete',
      messageId: params.messageId,
    });

    void replicateToDiscord('delete', params.channelId, { id: params.messageId });

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
    for (const msg of candidates as any[]) {
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
    
    // Find or create reaction - match by ID for custom emojis, name for unicode
    const reactions = (message.reactions || []) as Array<{ emoji: { name: string; id?: string; url?: string; animated?: boolean }; count: number; userIds: string[] }>;
    const existingReaction = reactions.find(
      (r) => 
        (emojiData.id && r.emoji.id === emojiData.id) || 
        (!emojiData.id && r.emoji.name === emojiData.name)
    );

    let reactionCount: number;
    if (existingReaction) {
      // Check if user already reacted
      if (!existingReaction.userIds.some((id: string) => compareIds(id, user.id))) {
        existingReaction.userIds.push(user.id);
        existingReaction.count++;
        // Ensure url is populated for custom emoji reactions
        if (emojiData.url) {
          existingReaction.emoji.url = emojiData.url;
        }
      }
      reactionCount = existingReaction.count;
    } else {
      // Add new reaction with full emoji data
      reactions.push({
        emoji: {
          name: emojiData.name,
          id: emojiData.id,
          animated: emojiData.animated,
          url: emojiData.url,
        },
        count: 1,
        userIds: [user.id],
      });
      reactionCount = 1;
    }

    await Message.updateById(message.id, { reactions });

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
    
    const reactions = (message.reactions || []) as Array<{ emoji: { name: string; id?: string }; count: number; userIds: string[] }>;
    const reactionIndex = reactions.findIndex(r => 
      (emojiData?.id && r.emoji.id === emojiData.id) || 
      (!emojiData?.id && r.emoji.name === (emojiData?.name || decodedEmoji))
    );

    if (reactionIndex !== -1) {
      const reaction = reactions[reactionIndex];
      reaction.userIds = reaction.userIds.filter((id: string) => !compareIds(id, user.id));
      reaction.count = reaction.userIds.length;

      if (reaction.count === 0) {
        reactions.splice(reactionIndex, 1);
      }

      await Message.updateById(message.id, { reactions });
    }

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

    // Publish typing event
    const publisher = getPublisher();
    if (publisher) {
      await publisher.publish('typing:start', JSON.stringify({
        channelId: params.channelId,
        serverId: channel.serverId,
        userId: user.id,
        username: user.username,
      }));
    }

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
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'error', error: authError || 'Unauthorized' })}\n\n`));
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
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'error', error: error || 'Access denied' })}\n\n`));
          controller.close();
        },
      });
      return new Response(errorStream, { headers: sseHeaders });
    }

    const channelKey = params.channelId;
    let controllerRef: ReadableStreamDefaultController | null = null;
    let pingInterval: NodeJS.Timeout | null = null;

    // Create SSE stream
    const stream = new ReadableStream({
      start(controller) {
        controllerRef = controller;
        // Add to active connections
        if (!activeConnections.has(channelKey)) {
          activeConnections.set(channelKey, new Set());
        }
        activeConnections.get(channelKey)!.add(controller);

        // Send initial ping
        controller.enqueue(new TextEncoder().encode('data: {"type":"connected"}\n\n'));

        // Keep-alive ping every 15 seconds
        pingInterval = setInterval(() => {
          try {
            controller.enqueue(new TextEncoder().encode('data: {"type":"ping"}\n\n'));
          } catch {
            if (pingInterval) {
              clearInterval(pingInterval);
            }
            activeConnections.get(channelKey)?.delete(controller);
          }
        }, 15000);
      },
      cancel() {
        // Connection closed - cleanup
        if (pingInterval) {
          clearInterval(pingInterval);
        }
        if (controllerRef) {
          activeConnections.get(channelKey)?.delete(controllerRef);
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

    const threadMemberIds = Array.isArray(channel.threadMemberIds) ? (channel.threadMemberIds as string[]) : [];
    if (!threadMemberIds.includes(user.id)) {
      const nextMembers = [...threadMemberIds, user.id];
      await Channel.updateById(channel.id, { threadMemberIds: nextMembers });
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
    if (threadMemberIds.includes(user.id)) {
      const nextMembers = threadMemberIds.filter((id) => id !== user.id);
      await Channel.updateById(channel.id, { threadMemberIds: nextMembers });
    }

    return { success: true };
  }, {
    params: t.Object({
      channelId: t.String(),
    }),
  });
