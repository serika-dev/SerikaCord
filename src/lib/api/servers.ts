import { Elysia, t } from 'elysia';
import { Server, Channel, Role, ServerMember, Invite, ServerEmoji, ServerSticker, ServerBan, AdminLog, Message, ServerMemberApplication } from '@/lib/models';
import { authenticateRequest } from '@/lib/services/auth';
import { checkRateLimit, getClientIP, sanitizeInput, isValidObjectId, rejectInvalidObjectIdParams, decryptFromStorage } from '@/lib/security';
import { cache } from '@/lib/db';
import { nanoid } from 'nanoid';
import { config } from '@/lib/config';
import { isReservedSlug, isValidVanityCode } from '@/lib/constants/reserved';
import { resolveEffectiveStatus, PRESENCE_TIMEOUT_MS } from '@/lib/services/presence';
import { parseCustomEmojis } from '@/lib/services/emoji';
import { User } from '@/lib/models';

// Live count of members who are actually online right now (status + fresh
// heartbeat), mirroring resolveEffectiveStatus. The Server.onlineCount field
// is never written to and must not be trusted as a source of truth.
async function computeOnlineCount(serverId: string): Promise<number> {
  const members = await ServerMember.find({ serverId });
  const userIds = members.map(m => m.userId);
  const users = userIds.length > 0 ? await User.find({ id: { in: userIds } }) : [];
  const userMap = new Map(users.map(u => [u.id, u]));
  const now = Date.now();
  return members.filter(m => {
    const u = userMap.get(m.userId);
    if (!u) return false;
    if (u.status === 'offline' || u.status === 'invisible') return false;
    const hb = u.presenceLastHeartbeatAt;
    if (!hb) return false;
    return new Date(hb).getTime() >= now - PRESENCE_TIMEOUT_MS;
  }).length;
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

// Default permissions
const DEFAULT_PERMISSIONS = {
  everyone: '1071698660929',
  admin: '8',
};

// Permission bits
const PERM_ADMINISTRATOR = 1n << 3n;
const PERM_MANAGE_SERVER = 1n << 5n;
const PERM_MANAGE_ROLES = 1n << 28n;

// Check if user can manage roles in a server (owner or has Manage Roles / Administrator)
async function canManageRoles(server: { ownerId: string; id: string }, userId: string): Promise<boolean> {
  if (server.ownerId === userId) return true;
  const member = await ServerMember.findOne({ serverId: server.id, userId });
  if (!member) return false;
  const roleIds = member.roles || [];
  const roles = roleIds.length > 0 ? await Role.find({ id: { in: roleIds }, serverId: server.id }) : [];
  for (const role of roles) {
    const perms = BigInt(role.permissions || '0');
    if ((perms & PERM_ADMINISTRATOR) === PERM_ADMINISTRATOR) return true;
    if ((perms & PERM_MANAGE_ROLES) === PERM_MANAGE_ROLES) return true;
  }
  return false;
}

// Check if user can manage server settings (owner or has Manage Server / Administrator)
async function canManageServer(server: { ownerId: string; id: string }, userId: string): Promise<boolean> {
  if (server.ownerId === userId) return true;
  const member = await ServerMember.findOne({ serverId: server.id, userId });
  if (!member) return false;
  const roleIds = member.roles || [];
  const roles = roleIds.length > 0 ? await Role.find({ id: { in: roleIds }, serverId: server.id }) : [];
  for (const role of roles) {
    const perms = BigInt(role.permissions || '0');
    if ((perms & PERM_ADMINISTRATOR) === PERM_ADMINISTRATOR) return true;
    if ((perms & PERM_MANAGE_SERVER) === PERM_MANAGE_SERVER) return true;
  }
  return false;
}

// Add a user to a server (used by invites, discovery joins, and application approvals)
async function addUserToServer(serverId: string, userId: string) {
  const existingMembership = await ServerMember.findOne({ serverId, userId });
  if (existingMembership) return existingMembership;

  const everyoneRole = await Role.findOne({ serverId, isDefault: true });
  const membership = await ServerMember.create({
    serverId,
    userId,
    roles: everyoneRole ? [everyoneRole.id] : [],
  });

  const server = await Server.findById(serverId);
  if (server) {
    await Server.updateById(serverId, { memberCount: (server.memberCount ?? 0) + 1 });
    await cache.del(`server:${serverId}`);
  }
  return membership;
}

interface PopulatedRole {
  id: string;
  name: string;
  color?: number | string | null;
  position?: number;
  permissions?: string;
  hoist?: boolean;
  mentionable?: boolean;
  managed?: boolean;
  isDefault?: boolean;
}

interface PopulatedMemberUser {
  id: string;
  username: string;
  displayName?: string;
  avatar?: string;
  status?: string;
  customStatus?: string;
  isPremium?: boolean;
  isBot?: boolean;
  isVerified?: boolean;
  presenceLastHeartbeatAt?: Date | null;
  customization?: {
    profileColor?: string;
    profileAccentColor?: string;
    profileGradient?: string[];
    displayNameStyle?: {
      font?: string;
      effect?: string;
      color?: string;
      gradient?: string[];
    };
  } | null;
}

function normalizeRoleColor(color?: number | string | null): string {
  if (typeof color === 'number' && Number.isFinite(color)) {
    return `#${Math.max(0, color).toString(16).padStart(6, '0').toUpperCase()}`;
  }

  if (typeof color === 'string' && color.trim()) {
    const stripped = color.trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{6}$/.test(stripped)) {
      return `#${stripped.toUpperCase()}`;
    }
    const asNumber = Number.parseInt(stripped, 16);
    if (Number.isFinite(asNumber)) {
      return `#${Math.max(0, asNumber).toString(16).padStart(6, '0').toUpperCase()}`;
    }
  }

  return '#99AAB5';
}

function parseHexColorToNumber(color?: string | null): number {
  if (!color) return 0x99aab5;
  const stripped = color.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(stripped)) return 0x99aab5;
  return Number.parseInt(stripped, 16);
}

function normalizeRoleDto(role: PopulatedRole, memberCount: number = 0) {
  return {
    id: role.id,
    name: role.name,
    color: normalizeRoleColor(role.color),
    position: role.position ?? 0,
    permissions: role.permissions || '0',
    hoist: Boolean(role.hoist),
    mentionable: Boolean(role.mentionable),
    managed: Boolean(role.managed),
    isDefault: Boolean(role.isDefault),
    memberCount,
  };
}

async function getRoleMemberCountMap(serverId: string): Promise<Map<string, number>> {
  const members = await ServerMember.find({ serverId });
  const countMap = new Map<string, number>();
  for (const m of members) {
    for (const roleId of (m.roles || [])) {
      countMap.set(roleId, (countMap.get(roleId) || 0) + 1);
    }
  }
  return countMap;
}

async function getNormalizedRoles(serverId: string) {
  const roles = await Role.find({ serverId });
  roles.sort((a: any, b: any) => (b.position ?? 0) - (a.position ?? 0));
  const memberCountMap = await getRoleMemberCountMap(serverId);
  return roles.map((role) =>
    normalizeRoleDto(role as unknown as PopulatedRole, memberCountMap.get(role.id) || 0)
  );
}

function normalizeMemberDto(member: {
  id: string;
  userId?: PopulatedMemberUser | null;
  roles?: PopulatedRole[];
  joinedAt?: Date;
  nickname?: string | null;
  avatar?: string | null;
  banner?: string | null;
}, ownerId?: string | null) {
  const memberRoles = (member.roles || [])
    .map((role) => normalizeRoleDto(role))
    .sort((a, b) => b.position - a.position);
  const highestRole = memberRoles[0] || null;
  const highestHoistedRole = memberRoles.find((role) => role.hoist) || null;
  const userData = member.userId;

  return {
    id: userData?.id || '',
    membershipId: member.id,
    username: userData?.username || 'Unknown',
    displayName: member.nickname || userData?.displayName || userData?.username || 'Unknown',
    avatar: member.avatar || userData?.avatar || null,
    status: resolveEffectiveStatus({
      status: userData?.status || 'offline',
      presenceLastHeartbeatAt: userData?.presenceLastHeartbeatAt || null,
    }),
    customStatus: userData?.customStatus || null,
    isPremium: Boolean(userData?.isPremium),
    isBot: Boolean(userData?.isBot),
    isVerified: Boolean(userData?.isVerified),
    isOwner: ownerId ? ownerId === userData?.id : false,
    customization: userData?.customization || null,
    joinedAt: member.joinedAt || null,
    roles: memberRoles,
    highestRole,
    highestHoistedRole,
  };
}

export const serverRoutes = new Elysia({ prefix: '/servers' })
  // Reject malformed ObjectId route params before any handler runs
  .onBeforeHandle(rejectInvalidObjectIdParams)
  // Get user's servers
  .get('/', async ({ headers, cookie, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const memberships = await ServerMember.find({ userId: user.id });
    const serverIds = memberships.map(m => m.serverId);
    const servers = serverIds.length > 0 ? await Server.find({ id: { in: serverIds } }) : [];
    const serverMap = new Map(servers.map(s => [s.id, s]));

    const mappedServers = memberships
      .filter(m => serverMap.has(m.serverId))
      .map(m => {
        const server = serverMap.get(m.serverId)!;
        return {
          ...server,
          id: server.id,
          joinedAt: m.joinedAt,
          roles: m.roles,
        };
      });

    return { servers: mappedServers };
  })
  // Create server
  .post('/', async ({ headers, cookie, body, request, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    // Rate limit server creation
    const ip = getClientIP(request);
    const rateLimit = await checkRateLimit('serverCreate', `${user.id}:${ip}`);
    if (!rateLimit.success) {
      set.status = 429;
      return { error: 'Server creation rate limited', retryAfter: rateLimit.retryAfter };
    }

    // Check server limit
    const userServers = await ServerMember.find({ userId: user.id });
    const serverCount = userServers.length;
    if (serverCount >= config.MAX_SERVERS_PER_USER) {
      set.status = 400;
      return { error: `You can only be in ${config.MAX_SERVERS_PER_USER} servers` };
    }

    const { name, icon } = body;
    const sanitizedName = sanitizeInput(name);

    // Create server
    const server = await Server.create({
      name: sanitizedName,
      icon,
      ownerId: user.id,
      memberCount: 1,
    });

    // Create @everyone role
    const everyoneRole = await Role.create({
      serverId: server.id,
      name: '@everyone',
      position: 0,
      permissions: DEFAULT_PERMISSIONS.everyone,
      isDefault: true,
    });

    // Create default channels
    const textCategory = await Channel.create({
      serverId: server.id,
      name: 'Text Channels',
      type: 'category',
      position: 0,
    });

    const generalChannel = await Channel.create({
      serverId: server.id,
      name: 'general',
      type: 'text',
      position: 0,
      parentId: textCategory.id,
    });

    // Create voice category and channel
    const voiceCategory = await Channel.create({
      serverId: server.id,
      name: 'Voice Channels',
      type: 'category',
      position: 1,
    });

    const generalVoice = await Channel.create({
      serverId: server.id,
      name: 'General',
      type: 'voice',
      position: 0,
      parentId: voiceCategory.id,
    });

    // Set system channel
    await Server.updateById(server.id, { systemChannelId: generalChannel.id });

    // Add owner as member
    await ServerMember.create({
      serverId: server.id,
      userId: user.id,
      roles: [everyoneRole.id],
    });

    return {
      success: true,
      server: {
        ...server,
        channels: [textCategory, generalChannel, voiceCategory, generalVoice],
        roles: [everyoneRole],
      },
    };
  }, {
    body: t.Object({
      name: t.String({ minLength: 2, maxLength: 100 }),
      icon: t.Optional(t.String()),
    }),
  })
  // Create channel in server
  .post('/:serverId/channels', async ({ headers, cookie, params, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isValidObjectId(params.serverId)) {
      set.status = 400;
      return { error: 'Invalid server ID' };
    }

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    const isBanned = await ServerBan.findOne({ serverId: server.id, userId: user.id });
    if (isBanned) {
      set.status = 403;
      return { error: 'You are banned from this server' };
    }

    // Check if owner or has manage channels permission
    if (server.ownerId !== user.id) {
      set.status = 403;
      return { error: 'You do not have permission to create channels' };
    }

    // Check channel limit
    const existingChannels = await Channel.find({ serverId: server.id });
    if (existingChannels.length >= config.MAX_CHANNELS_PER_SERVER) {
      set.status = 400;
      return { error: `Server has reached the channel limit of ${config.MAX_CHANNELS_PER_SERVER}` };
    }

    const { name, type = 'text', parentId, nsfw, forumMode } = body;
    const sanitizedName = sanitizeInput(name);

    if (type === 'category' && parentId) {
      set.status = 400;
      return { error: 'A category cannot have a parent category' };
    }

    // If parentId provided, verify it's a valid category
    if (parentId) {
      const parentChannel = await Channel.findById(parentId);
      if (!parentChannel || parentChannel.type !== 'category') {
        set.status = 400;
        return { error: 'Invalid parent category' };
      }
    }

    // Get highest position in parent or server
    const siblingChannels = await Channel.find({
      serverId: server.id,
      parentId: parentId || null,
    });
    siblingChannels.sort((a: any, b: any) => (b.position ?? 0) - (a.position ?? 0));
    const highestChannel = siblingChannels[0];

    const position = highestChannel ? (highestChannel.position ?? 0) + 1 : 0;

    const channel = await Channel.create({
      serverId: server.id,
      name: sanitizedName,
      type,
      position,
      parentId: parentId || null,
      nsfw: type !== 'category' ? Boolean(nsfw) : false,
      ...(type === 'forum' ? { forumMode: forumMode === 'tickets' ? 'tickets' : 'posts' } : {}),
    });

    return {
      success: true,
      channel,
    };
  }, {
    params: t.Object({
      serverId: t.String(),
    }),
    body: t.Object({
      name: t.String({ minLength: 1, maxLength: 100 }),
      type: t.Optional(t.Union([t.Literal('text'), t.Literal('voice'), t.Literal('announcement'), t.Literal('category'), t.Literal('forum')])),
      parentId: t.Optional(t.Union([t.String(), t.Null()])),
      nsfw: t.Optional(t.Boolean()),
      forumMode: t.Optional(t.Union([t.Literal('posts'), t.Literal('tickets')])),
    }),
  })
  // Bulk reorder channels (drag & drop)
  .patch('/:serverId/channels/reorder', async ({ headers, cookie, params, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    if (server.ownerId !== user.id) {
      set.status = 403;
      return { error: 'You do not have permission to reorder channels' };
    }

    const { channels: channelUpdates } = body;
    if (!Array.isArray(channelUpdates) || channelUpdates.length === 0) {
      set.status = 400;
      return { error: 'No channel updates provided' };
    }

    // Bulk update each channel's position and parentId
    for (const update of channelUpdates) {
      const updates: Record<string, unknown> = { position: update.position };
      if (update.parentId !== undefined) updates.parentId = update.parentId || null;
      await Channel.updateById(update.id, updates);
    }

    // Fetch fresh channel list
    const updatedChannels = await Channel.find({ serverId: server.id });
    updatedChannels.sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0));

    return { success: true, channels: updatedChannels };
  }, {
    params: t.Object({
      serverId: t.String(),
    }),
    body: t.Object({
      channels: t.Array(t.Object({
        id: t.String(),
        position: t.Number({ minimum: 0 }),
        parentId: t.Optional(t.Union([t.String(), t.Null()])),
      })),
    }),
  })
  // Get server details
  .get('/:serverId', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isValidObjectId(params.serverId)) {
      set.status = 400;
      return { error: 'Invalid server ID' };
    }

    // Check membership and fetch server data in parallel
    const [membership, server, channels, roles] = await Promise.all([
      ServerMember.findOne({ serverId: params.serverId, userId: user.id }),
      Server.findById(params.serverId),
      Channel.find({ serverId: params.serverId }),
      Role.find({ serverId: params.serverId }),
    ]);

    if (!membership) {
      set.status = 403;
      return { error: 'You are not a member of this server' };
    }

    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    channels.sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0));
    roles.sort((a: any, b: any) => (b.position ?? 0) - (a.position ?? 0));

    return {
      server: {
        ...server,
        channels,
        roles,
        member: membership,
      },
    };
  }, {
    params: t.Object({
      serverId: t.String(),
    }),
  })
  // Get server settings
  .get('/:serverId/settings', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isValidObjectId(params.serverId)) {
      set.status = 400;
      return { error: 'Invalid server ID' };
    }

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    const membership = await ServerMember.findOne({
      serverId: server.id,
      userId: user.id,
    });
    if (!membership) {
      set.status = 403;
      return { error: 'You are not a member of this server' };
    }

    return {
      settings: {
        widget: (server.settings as any)?.widget || { enabled: true, channelId: null },
        moderation: {
          verificationLevel: (server.settings as any)?.moderation?.verificationLevel || server.verificationLevel,
          explicitContentFilter: (server.settings as any)?.moderation?.explicitContentFilter || server.explicitContentFilter,
          require2FA: (server.settings as any)?.moderation?.require2FA || false,
        },
        safety: (server.settings as any)?.safety || { raidProtection: false, antiSpam: true, mentionSpamLimit: 5 },
        integrations: (server.settings as any)?.integrations || {
          discord: false,
          twitch: false,
          youtube: false,
          webhooks: false,
        },
        soundboard: (server.settings as any)?.soundboard || {
          enabled: true,
          volume: 100,
        },
        access: {
          joinMode: (server.settings as any)?.access?.joinMode || server.joinMode || 'invite_only',
        },
        isAgeGated: Boolean(server.isAgeGated),
      },
    };
  }, {
    params: t.Object({
      serverId: t.String(),
    }),
  })
  // Update server settings
  .patch('/:serverId/settings', async ({ headers, cookie, params, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isValidObjectId(params.serverId)) {
      set.status = 400;
      return { error: 'Invalid server ID' };
    }

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    if (server.ownerId !== user.id && !(await canManageRoles(server, user.id))) {
      set.status = 403;
      return { error: 'You do not have permission to edit this server' };
    }

    const payload = body as any;
    const serverSettings = server.settings as any || {};
    const nextSettings = {
      ...serverSettings,
      ...(payload.settings || {}),
      widget: {
        ...(serverSettings.widget || {}),
        ...(payload.settings?.widget || {}),
      },
      moderation: {
        ...(serverSettings.moderation || {}),
        ...(payload.settings?.moderation || {}),
      },
      safety: {
        ...(serverSettings.safety || {}),
        ...(payload.settings?.safety || {}),
      },
      integrations: {
        ...(serverSettings.integrations || {}),
        ...(payload.settings?.integrations || {}),
      },
      soundboard: {
        ...(serverSettings.soundboard || {}),
        ...(payload.settings?.soundboard || {}),
      },
      access: {
        ...(serverSettings.access || {}),
        ...(payload.settings?.access || {}),
      },
    } as any;

    if (nextSettings.moderation?.verificationLevel) {
      server.verificationLevel = nextSettings.moderation.verificationLevel;
    }
    if (nextSettings.moderation?.explicitContentFilter) {
      server.explicitContentFilter = nextSettings.moderation.explicitContentFilter;
    }
    if (nextSettings.access?.joinMode) {
      server.joinMode = nextSettings.access.joinMode;
      server.isDiscoverable = nextSettings.access.joinMode === 'discoverable';
      if (server.isDiscoverable && !server.discoverableAt) {
        server.discoverableAt = new Date();
      }
    }

    // Age-gated servers cannot be discoverable
    if (payload.isAgeGated !== undefined) {
      server.isAgeGated = payload.isAgeGated;
      if (payload.isAgeGated) {
        server.isPartnered = false;
        server.partneredAt = null;
        server.isDiscoverable = false;
        server.discoverableAt = null;
        server.joinMode = 'invite_only';
        nextSettings.access = { ...(nextSettings.access || {}), joinMode: 'invite_only' };
      }
    }

    await Server.updateById(server.id, { settings: nextSettings as any });
    await cache.del(`server:${server.id}`);

    return {
      success: true,
      settings: server.settings,
    };
  }, {
    params: t.Object({
      serverId: t.String(),
    }),
    body: t.Object({
      settings: t.Object({}, { additionalProperties: true }),
    }),
  })
  // Bulk settings update: validates every field first, rejects the whole
  // request with field-specific errors if anything is invalid, then applies
  // all changes in a single document save (atomic per server).
  .patch('/:serverId/settings/bulk', async ({ headers, cookie, params, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isValidObjectId(params.serverId)) {
      set.status = 400;
      return { error: 'Invalid server ID' };
    }

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    if (server.ownerId !== user.id && !(await canManageRoles(server, user.id))) {
      set.status = 403;
      return { error: 'You do not have permission to edit this server' };
    }

    const changes = body.changes as Record<string, string | number | boolean | null>;
    const fieldErrors: Record<string, string> = {};

    const VERIFICATION_LEVELS = ['none', 'low', 'medium', 'high', 'very_high'];
    const CONTENT_FILTERS = ['disabled', 'members_without_roles', 'all_members'];
    const JOIN_MODES = ['invite_only', 'apply_to_join', 'discoverable'];
    const CHANNEL_FIELDS = ['systemChannelId', 'rulesChannelId', 'afkChannelId', 'widget.channelId'];

    const expectString = (key: string, max: number, min = 0): string | undefined => {
      const value = changes[key];
      if (typeof value !== 'string') {
        fieldErrors[key] = 'Must be text';
        return undefined;
      }
      const trimmed = value.trim();
      if (trimmed.length < min) {
        fieldErrors[key] = `Must be at least ${min} characters`;
        return undefined;
      }
      if (trimmed.length > max) {
        fieldErrors[key] = `Must be at most ${max} characters`;
        return undefined;
      }
      return sanitizeInput(trimmed);
    };

    const expectBoolean = (key: string): boolean | undefined => {
      const value = changes[key];
      if (typeof value !== 'boolean') {
        fieldErrors[key] = 'Must be true or false';
        return undefined;
      }
      return value;
    };

    const expectIntInRange = (key: string, minValue: number, maxValue: number): number | undefined => {
      const value = changes[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
        fieldErrors[key] = 'Must be a whole number';
        return undefined;
      }
      if (value < minValue || value > maxValue) {
        fieldErrors[key] = `Must be between ${minValue} and ${maxValue}`;
        return undefined;
      }
      return value;
    };

    const expectEnum = (key: string, allowed: string[]): string | undefined => {
      const value = changes[key];
      if (typeof value !== 'string' || !allowed.includes(value)) {
        fieldErrors[key] = `Must be one of: ${allowed.join(', ')}`;
        return undefined;
      }
      return value;
    };

    // Validate channel references in one query
    const channelIdsToCheck: string[] = [];
    for (const key of CHANNEL_FIELDS) {
      if (!(key in changes)) continue;
      const value = changes[key];
      if (value === null || value === '') continue;
      if (typeof value !== 'string' || !isValidObjectId(value)) {
        fieldErrors[key] = 'Invalid channel';
        continue;
      }
      channelIdsToCheck.push(value);
    }
    if (channelIdsToCheck.length > 0) {
      const found = await Channel.find({
        id: { in: channelIdsToCheck },
        serverId: server.id,
      });
      const foundIds = new Set(found.map((c: any) => c.id));
      for (const key of CHANNEL_FIELDS) {
        const value = changes[key];
        if (typeof value === 'string' && value && isValidObjectId(value) && !foundIds.has(value)) {
          fieldErrors[key] = 'Channel does not belong to this server';
        }
      }
    }

    // Validate and stage every known field; unknown fields are rejected
    type Staged = () => void;
    const staged: Staged[] = [];
    const settings = () => {
      server.settings = server.settings || {};
      return server.settings as Record<string, Record<string, unknown>>;
    };
    const section = (name: string) => {
      const s = settings();
      s[name] = s[name] || {};
      return s[name];
    };

    for (const key of Object.keys(changes)) {
      switch (key) {
        case 'name': {
          const v = expectString(key, 100, 2);
          if (v !== undefined) staged.push(() => { server.name = v; });
          break;
        }
        case 'description': {
          if (changes[key] === null) {
            staged.push(() => { server.description = null; });
          } else {
            const v = expectString(key, 1024);
            if (v !== undefined) staged.push(() => { server.description = v || null; });
          }
          break;
        }
        case 'systemChannelId':
        case 'rulesChannelId':
        case 'afkChannelId': {
          if (fieldErrors[key]) break;
          const v = changes[key];
          staged.push(() => { (server as Record<string, unknown>)[key] = v || undefined; });
          break;
        }
        case 'afkTimeout': {
          const v = expectIntInRange(key, 30, 7200);
          if (v !== undefined) staged.push(() => { server.afkTimeout = v; });
          break;
        }
        case 'widget.enabled': {
          const v = expectBoolean(key);
          if (v !== undefined) staged.push(() => { section('widget').enabled = v; });
          break;
        }
        case 'widget.channelId': {
          if (fieldErrors[key]) break;
          const v = changes[key];
          staged.push(() => { section('widget').channelId = v || null; });
          break;
        }
        case 'moderation.verificationLevel': {
          const v = expectEnum(key, VERIFICATION_LEVELS);
          if (v !== undefined) staged.push(() => {
            section('moderation').verificationLevel = v;
            server.verificationLevel = v as typeof server.verificationLevel;
          });
          break;
        }
        case 'moderation.explicitContentFilter': {
          const v = expectEnum(key, CONTENT_FILTERS);
          if (v !== undefined) staged.push(() => {
            section('moderation').explicitContentFilter = v;
            server.explicitContentFilter = v as typeof server.explicitContentFilter;
          });
          break;
        }
        case 'moderation.require2FA': {
          const v = expectBoolean(key);
          if (v !== undefined) staged.push(() => { section('moderation').require2FA = v; });
          break;
        }
        case 'safety.raidProtection':
        case 'safety.antiSpam': {
          const v = expectBoolean(key);
          if (v !== undefined) staged.push(() => { section('safety')[key.split('.')[1]] = v; });
          break;
        }
        case 'safety.mentionSpamLimit': {
          const v = expectIntInRange(key, 1, 50);
          if (v !== undefined) staged.push(() => { section('safety').mentionSpamLimit = v; });
          break;
        }
        case 'integrations.discord':
        case 'integrations.twitch':
        case 'integrations.youtube':
        case 'integrations.webhooks': {
          const v = expectBoolean(key);
          if (v !== undefined) staged.push(() => { section('integrations')[key.split('.')[1]] = v; });
          break;
        }
        case 'soundboard.enabled': {
          const v = expectBoolean(key);
          if (v !== undefined) staged.push(() => { section('soundboard').enabled = v; });
          break;
        }
        case 'soundboard.volume': {
          const v = expectIntInRange(key, 0, 200);
          if (v !== undefined) staged.push(() => { section('soundboard').volume = v; });
          break;
        }
        case 'access.joinMode': {
          const v = expectEnum(key, JOIN_MODES);
          if (v !== undefined) staged.push(() => {
            section('access').joinMode = v;
            server.joinMode = v as typeof server.joinMode;
            server.isDiscoverable = v === 'discoverable';
            if (server.isDiscoverable && !server.discoverableAt) {
              server.discoverableAt = new Date();
            }
          });
          break;
        }
        case 'isAgeGated': {
          const v = expectBoolean(key);
          if (v !== undefined) staged.push(() => {
            server.isAgeGated = v;
            if (v) {
              server.isPartnered = false;
              server.partneredAt = null;
              server.isDiscoverable = false;
              server.discoverableAt = null;
              server.joinMode = 'invite_only';
              section('access').joinMode = 'invite_only';
            }
          });
          break;
        }
        default:
          fieldErrors[key] = 'Unknown setting';
      }
    }

    if (Object.keys(fieldErrors).length > 0) {
      set.status = 400;
      return { error: 'Some settings are invalid', fieldErrors };
    }

    // All valid: apply everything, then persist
    for (const apply of staged) apply();
    const { id: _sid, ...serverUpdates } = server;
    await Server.updateById(server.id, serverUpdates as any);
    await cache.del(`server:${server.id}`);

    return {
      success: true,
      server: {
        id: server.id,
        name: server.name,
        description: server.description,
        systemChannelId: server.systemChannelId ?? null,
        rulesChannelId: server.rulesChannelId ?? null,
        afkChannelId: server.afkChannelId ?? null,
        afkTimeout: server.afkTimeout,
      },
      settings: server.settings,
    };
  }, {
    params: t.Object({
      serverId: t.String(),
    }),
    body: t.Object({
      changes: t.Record(t.String(), t.Union([t.String(), t.Number(), t.Boolean(), t.Null()])),
    }),
  })
  // Update server
  .patch('/:serverId', async ({ headers, cookie, params, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    // Check if owner or has manage server permission
    if (server.ownerId !== user.id) {
      set.status = 403;
      return { error: 'You do not have permission to edit this server' };
    }

    const { name, description, icon, banner, systemChannelId, rulesChannelId, afkChannelId, afkTimeout, verificationLevel, explicitContentFilter, isAgeGated } = body;

    if (name !== undefined) server.name = sanitizeInput(name);
    if (description !== undefined) server.description = sanitizeInput(description);
    if (icon !== undefined) server.icon = icon;
    if (banner !== undefined) server.banner = banner;
    if (systemChannelId !== undefined) server.systemChannelId = systemChannelId || null;
    if (rulesChannelId !== undefined) server.rulesChannelId = rulesChannelId || null;
    if (afkChannelId !== undefined) server.afkChannelId = afkChannelId || null;
    if (afkTimeout !== undefined) server.afkTimeout = afkTimeout;
    if (verificationLevel !== undefined) server.verificationLevel = verificationLevel;
    if (explicitContentFilter !== undefined) server.explicitContentFilter = explicitContentFilter;

    // Age-gated servers cannot be partnered or discoverable
    if (isAgeGated !== undefined) {
      server.isAgeGated = isAgeGated;
      if (isAgeGated) {
        server.isPartnered = false;
        server.partneredAt = null;
        server.isDiscoverable = false;
        server.discoverableAt = null;
      }
    }

    // Keep extended settings document in sync with legacy fields
    const serverSettings2 = server.settings as any || {};
    server.settings = {
      ...serverSettings2,
      moderation: {
        ...(serverSettings2.moderation || {}),
        verificationLevel: verificationLevel ?? serverSettings2.moderation?.verificationLevel ?? server.verificationLevel,
        explicitContentFilter: explicitContentFilter ?? serverSettings2.moderation?.explicitContentFilter ?? server.explicitContentFilter,
      },
      widget: {
        enabled: serverSettings2.widget?.enabled ?? true,
        channelId: serverSettings2.widget?.channelId ?? null,
      },
      safety: {
        raidProtection: serverSettings2.safety?.raidProtection ?? false,
        antiSpam: serverSettings2.safety?.antiSpam ?? true,
        mentionSpamLimit: serverSettings2.safety?.mentionSpamLimit ?? 5,
      },
      integrations: {
        discord: serverSettings2.integrations?.discord ?? false,
        twitch: serverSettings2.integrations?.twitch ?? false,
        youtube: serverSettings2.integrations?.youtube ?? false,
        webhooks: serverSettings2.integrations?.webhooks ?? false,
      },
      soundboard: {
        enabled: serverSettings2.soundboard?.enabled ?? true,
        volume: serverSettings2.soundboard?.volume ?? 100,
      },
    } as any;

    const { id: _updateId, ...serverFields } = server;
    await Server.updateById(server.id, serverFields as any);

    // Invalidate cache
    await cache.del(`server:${server.id}`);

    return { success: true, server };
  }, {
    params: t.Object({
      serverId: t.String(),
    }),
    body: t.Object({
      name: t.Optional(t.String({ minLength: 2, maxLength: 100 })),
      description: t.Optional(t.String({ maxLength: 1024 })),
      icon: t.Optional(t.Union([t.String(), t.Null()])),
      banner: t.Optional(t.Union([t.String(), t.Null()])),
      systemChannelId: t.Optional(t.Union([t.String(), t.Null()])),
      rulesChannelId: t.Optional(t.Union([t.String(), t.Null()])),
      afkChannelId: t.Optional(t.Union([t.String(), t.Null()])),
      afkTimeout: t.Optional(t.Number()),
      verificationLevel: t.Optional(t.Union([
        t.Literal('none'),
        t.Literal('low'),
        t.Literal('medium'),
        t.Literal('high'),
        t.Literal('very_high'),
      ])),
      explicitContentFilter: t.Optional(t.Union([
        t.Literal('disabled'),
        t.Literal('members_without_roles'),
        t.Literal('all_members'),
      ])),
      isAgeGated: t.Optional(t.Boolean()),
    }),
  })
  // Delete server
  .delete('/:serverId', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    if (server.ownerId !== user.id) {
      set.status = 403;
      return { error: 'Only the server owner can delete the server' };
    }

    // Delete all related data
    const [channels, roles, members, invites] = await Promise.all([
      Channel.find({ serverId: server.id }),
      Role.find({ serverId: server.id }),
      ServerMember.find({ serverId: server.id }),
      Invite.find({ serverId: server.id }),
    ]);
    await Promise.all([
      ...channels.map((c: any) => Channel.deleteById(c.id)),
      ...roles.map((r: any) => Role.deleteById(r.id)),
      ...members.map((m: any) => ServerMember.deleteById(m.id)),
      ...invites.map((i: any) => Invite.deleteById(i.id)),
    ]);

    await Server.deleteById(server.id);

    return { success: true };
  }, {
    params: t.Object({
      serverId: t.String(),
    }),
  })
  // Get server members
  .get('/:serverId/members', async ({ headers, cookie, params, query, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const membership = await ServerMember.findOne({
      serverId: params.serverId,
      userId: user.id,
    });

    if (!membership) {
      set.status = 403;
      return { error: 'You are not a member of this server' };
    }

    const limit = Math.min(parseInt(query.limit || '50'), 1000);
    const after = query.after;

    const filter: Record<string, unknown> = { serverId: params.serverId };

    const [server, allMembers] = await Promise.all([
      Server.findById(params.serverId),
      ServerMember.find(filter),
    ]);

    // Manual populate: batch fetch users and roles
    const userIds = [...new Set(allMembers.map((m: any) => m.userId).filter(Boolean))];
    const roleIds = [...new Set(allMembers.flatMap((m: any) => m.roles || []).filter(Boolean))];

    const [users, roles] = await Promise.all([
      userIds.length > 0 ? User.find({ id: { in: userIds } }) : [],
      roleIds.length > 0 ? Role.find({ id: { in: roleIds }, serverId: params.serverId }) : [],
    ]);

    const userMap = new Map(users.map((u: any) => [u.id, u]));
    const roleMap = new Map(roles.map((r: any) => [r.id, r]));

    let members = allMembers.map((m: any) => ({
      ...m,
      userId: m.userId ? userMap.get(m.userId) ?? m.userId : null,
      roles: (m.roles || []).map((rid: string) => roleMap.get(rid)).filter(Boolean),
    }));

    // Apply 'after' cursor and limit in JS
    if (after) {
      const afterIdx = members.findIndex((m: any) => m.id === after);
      members = afterIdx >= 0 ? members.slice(afterIdx + 1) : [];
    }
    members = members.slice(0, limit);

    return {
      members: members.map((member: any) =>
        normalizeMemberDto(member as unknown as {
          id: string;
          userId?: PopulatedMemberUser | null;
          roles?: PopulatedRole[];
          joinedAt?: Date;
        }, server?.ownerId)
      ),
    };
  }, {
    params: t.Object({
      serverId: t.String(),
    }),
    query: t.Object({
      limit: t.Optional(t.String()),
      after: t.Optional(t.String()),
    }),
  })
  // Assign member roles
  .patch('/:serverId/members/:memberUserId/roles', async ({ headers, cookie, params, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isValidObjectId(params.serverId) || !isValidObjectId(params.memberUserId)) {
      set.status = 400;
      return { error: 'Invalid ID' };
    }

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    if (!(await canManageRoles(server, user.id))) {
      set.status = 403;
      return { error: 'You need Manage Roles permission to assign roles' };
    }

    const member = await ServerMember.findOne({
      serverId: params.serverId,
      userId: params.memberUserId,
    });

    if (!member) {
      set.status = 404;
      return { error: 'Member not found' };
    }

    const everyoneRole = await Role.findOne({
      serverId: params.serverId,
      isDefault: true,
    });

    if (!everyoneRole) {
      set.status = 500;
      return { error: 'Default role is missing for this server' };
    }

    const requestedRoleIds = Array.from(new Set((body.roleIds || []).filter((id): id is string => isValidObjectId(id))));
    const requestedWithEveryone = Array.from(new Set([everyoneRole.id, ...requestedRoleIds]));

    const validRoles = await Role.find({
      serverId: params.serverId,
      id: { in: requestedWithEveryone },
    });

    if (validRoles.length !== requestedWithEveryone.length) {
      set.status = 400;
      return { error: 'One or more provided role IDs are invalid for this server' };
    }

    await ServerMember.updateById(member.id, { roles: requestedWithEveryone });

    // Manual populate
    const populatedUser = member.userId ? await User.findById(member.userId) : null;
    const populatedRoles = await Role.find({ id: { in: requestedWithEveryone }, serverId: params.serverId });
    const populatedMember = { ...member, userId: populatedUser, roles: populatedRoles };

    return {
      member: normalizeMemberDto(populatedMember as unknown as {
        id: string;
        userId?: PopulatedMemberUser | null;
        roles?: PopulatedRole[];
        joinedAt?: Date;
      }),
    };
  }, {
    params: t.Object({
      serverId: t.String(),
      memberUserId: t.String(),
    }),
    body: t.Object({
      roleIds: t.Array(t.String()),
    }),
  })
  // Get single server member profile
  .get('/:serverId/members/:memberUserId', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isValidObjectId(params.memberUserId)) {
      set.status = 400;
      return { error: 'Invalid member user ID' };
    }

    const membership = await ServerMember.findOne({
      serverId: params.serverId,
      userId: user.id,
    });
    if (!membership) {
      set.status = 403;
      return { error: 'You are not a member of this server' };
    }

    const rawMember = await ServerMember.findOne({
      serverId: params.serverId,
      userId: params.memberUserId,
    });

    if (!rawMember) {
      set.status = 404;
      return { error: 'Member not found' };
    }

    const server = await Server.findById(params.serverId);

    // Manual populate
    const [populatedUser, populatedRoles] = await Promise.all([
      rawMember.userId ? User.findById(rawMember.userId) : null,
      rawMember.roles && rawMember.roles.length > 0 ? Role.find({ id: { in: rawMember.roles }, serverId: params.serverId }) : [],
    ]);
    const member = { ...rawMember, userId: populatedUser, roles: populatedRoles };

    const normalized = normalizeMemberDto(member as unknown as {
      id: string;
      userId?: PopulatedMemberUser | null;
      roles?: PopulatedRole[];
      joinedAt?: Date;
      nickname?: string | null;
      avatar?: string | null;
      banner?: string | null;
    });

    const userData = populatedUser as { bio?: string; banner?: string; badges?: string[] } | null;

    return {
      ...normalized,
      nickname: rawMember.nickname || null,
      avatarOverride: rawMember.avatar || null,
      bio: userData?.bio || null,
      banner: rawMember.banner || userData?.banner || null,
      badges: userData?.badges || [],
      isOwner: server ? server.ownerId === rawMember.userId : false,
    };
  }, {
    params: t.Object({
      serverId: t.String(),
      memberUserId: t.String(),
    }),
  })
  // Update server member profile for current user
  .patch('/:serverId/members/@me', async ({ headers, cookie, params, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const member = await ServerMember.findOne({
      serverId: params.serverId,
      userId: user.id,
    });

    if (!member) {
      set.status = 404;
      return { error: 'You are not a member of this server' };
    }

    const { nickname, avatar, banner } = body;

    const updates: Record<string, unknown> = {};
    if (nickname !== undefined) updates.nickname = nickname ? sanitizeInput(nickname) : undefined;
    if (avatar !== undefined) updates.avatar = avatar || undefined;
    if (banner !== undefined) updates.banner = banner || undefined;
    await ServerMember.updateById(member.id, updates);

    return {
      success: true,
      member: {
        nickname: updates.nickname ?? member.nickname ?? null,
        avatar: updates.avatar ?? member.avatar ?? null,
        banner: updates.banner ?? member.banner ?? null,
      },
    };
  }, {
    params: t.Object({
      serverId: t.String(),
    }),
    body: t.Object({
      nickname: t.Optional(t.Union([t.String({ maxLength: 32 }), t.Null()])),
      avatar: t.Optional(t.Union([t.String(), t.Null()])),
      banner: t.Optional(t.Union([t.String(), t.Null()])),
    }),
  })
  // Leave server
  .delete('/:serverId/members/@me', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    if (server.ownerId === user.id) {
      set.status = 400;
      return { error: 'Server owner cannot leave. Transfer ownership first or delete the server.' };
    }

    const memberToDelete = await ServerMember.findOne({
      serverId: params.serverId,
      userId: user.id,
    });
    if (memberToDelete) {
      await ServerMember.deleteById(memberToDelete.id);
    }

    // Update member count
    await Server.updateById(server.id, { memberCount: Math.max(0, (server.memberCount || 0) - 1) });

    return { success: true };
  }, {
    params: t.Object({
      serverId: t.String(),
    }),
  })
  // Current user's effective permissions in this server (for client-side UI gating).
  // Authoritative checks still run on each mutating endpoint; this only drives
  // whether controls are shown.
  .get('/:serverId/members/@me/permissions', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    const isOwner = server.ownerId === user.id;
    if (isOwner) {
      // Owner implicitly has every permission.
      return { isOwner: true, permissions: (~0n & ((1n << 48n) - 1n)).toString() };
    }

    const member = await ServerMember.findOne({ serverId: server.id, userId: user.id });
    if (!member) {
      set.status = 403;
      return { error: 'Not a member of this server' };
    }

    // Manual populate roles
    const roleIds = (member.roles || []) as string[];
    const roles = roleIds.length > 0 ? await Role.find({ id: { in: roleIds }, serverId: params.serverId }) : [];

    let effective = 0n;
    for (const role of roles) {
      effective |= BigInt((role as any).permissions || '0');
    }

    return { isOwner: false, permissions: effective.toString() };
  }, {
    params: t.Object({
      serverId: t.String(),
    }),
  })
  // Create invite
  .post('/:serverId/invites', async ({ headers, cookie, params, body, request, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const membership = await ServerMember.findOne({
      serverId: params.serverId,
      userId: user.id,
    });

    if (!membership) {
      set.status = 403;
      return { error: 'You are not a member of this server' };
    }

    // Rate limit
    const ip = getClientIP(request);
    const rateLimit = await checkRateLimit('invite', `${user.id}:${ip}`);
    if (!rateLimit.success) {
      set.status = 429;
      return { error: 'Invite creation rate limited', retryAfter: rateLimit.retryAfter };
    }

    // Get default channel
    const channels = await Channel.find({
      serverId: params.serverId,
      type: { in: ['text', 'announcement'] },
    });
    channels.sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0));
    const channel = channels[0];

    if (!channel) {
      set.status = 400;
      return { error: 'No valid channel for invite' };
    }

    const { maxUses = 0, maxAge = 86400, temporary = false } = body;

    const invite = await Invite.create({
      code: nanoid(8),
      serverId: params.serverId,
      channelId: channel.id,
      inviterId: user.id,
      maxUses,
      maxAge,
      temporary,
      expiresAt: maxAge > 0 ? new Date(Date.now() + maxAge * 1000) : null,
    });

    return {
      success: true,
      invite: {
        code: invite.code,
        expiresAt: invite.expiresAt,
        maxUses: invite.maxUses,
        uses: 0,
      },
    };
  }, {
    params: t.Object({
      serverId: t.String(),
    }),
    body: t.Object({
      maxUses: t.Optional(t.Number({ minimum: 0, maximum: 100 })),
      maxAge: t.Optional(t.Number({ minimum: 0, maximum: 604800 })),
      temporary: t.Optional(t.Boolean()),
    }),
  })
  // Get server channels
  .get('/:serverId/channels', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isValidObjectId(params.serverId)) {
      set.status = 400;
      return { error: 'Invalid server ID' };
    }

    // Check membership
    const membership = await ServerMember.findOne({
      serverId: params.serverId,
      userId: user.id,
    });

    if (!membership) {
      set.status = 403;
      return { error: 'You are not a member of this server' };
    }

    // Threads (public_thread / private_thread) live inside forum channels and are
    // listed via /channels/:id/threads — never as top-level sidebar channels.
    const allChannels = await Channel.find({
      serverId: params.serverId,
    });
    const channels = allChannels
      .filter((ch: any) => ch.type !== 'public_thread' && ch.type !== 'private_thread')
      .sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0));

    // Batch-resolve the timestamp of each channel's last message so the client
    // can compute initial unread state (bold) without an extra round-trip per
    // channel. One query for all last-message ids in this server.
    const lastMessageIds = channels
      .map((ch: any) => ch.lastMessageId)
      .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0);
    const lastMessageAtById = new Map<string, string>();
    if (lastMessageIds.length > 0) {
      const lastMsgs = await Message.find({ id: { in: lastMessageIds } });
      for (const m of lastMsgs as any[]) {
        if (m.createdAt) lastMessageAtById.set(m.id, new Date(m.createdAt).toISOString());
      }
    }

    // Transform for frontend compatibility
    return channels.map((ch: any) => ({
      id: ch.id,
      name: ch.name,
      type: ch.type,
      serverId: ch.serverId,
      position: ch.position,
      parentId: ch.parentId || null,
      topic: ch.topic,
      nsfw: ch.nsfw,
      forumMode: ch.forumMode,
      rateLimitPerUser: ch.rateLimitPerUser,
      lastMessageId: ch.lastMessageId || null,
      lastMessageAt: ch.lastMessageId ? (lastMessageAtById.get(ch.lastMessageId) || null) : null,
      permissionOverwrites: (ch.permissionOverwrites || []).map((o: { id: any; type: string; allow: string; deny: string }) => ({
        id: o.id,
        type: o.type,
        allow: o.allow,
        deny: o.deny,
      })),
    }));
  }, {
    params: t.Object({
      serverId: t.String(),
    }),
  })
  // Get server roles
  .get('/:serverId/roles', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isValidObjectId(params.serverId)) {
      set.status = 400;
      return { error: 'Invalid server ID' };
    }

    // Check membership
    const membership = await ServerMember.findOne({
      serverId: params.serverId,
      userId: user.id,
    });

    if (!membership) {
      set.status = 403;
      return { error: 'You are not a member of this server' };
    }

    const roles = await getNormalizedRoles(params.serverId);
    return { roles };
  }, {
    params: t.Object({
      serverId: t.String(),
    }),
  })
  // Create server role
  .post('/:serverId/roles', async ({ headers, cookie, params, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isValidObjectId(params.serverId)) {
      set.status = 400;
      return { error: 'Invalid server ID' };
    }

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    if (!(await canManageRoles(server, user.id))) {
      set.status = 403;
      return { error: 'You need Manage Roles permission to create roles' };
    }

    // Get highest position
    const existingRoles = await Role.find({ serverId: params.serverId });
    existingRoles.sort((a: any, b: any) => (b.position ?? 0) - (a.position ?? 0));
    const highestRole = existingRoles[0];
    const newPosition = (highestRole?.position || 0) + 1;

    const role = await Role.create({
      serverId: params.serverId,
      name: body.name || 'new role',
      color: parseHexColorToNumber(body.color),
      position: newPosition,
      permissions: body.permissions || DEFAULT_PERMISSIONS.everyone,
      hoist: body.hoist || false,
      mentionable: body.mentionable || false,
    });

    const roles = await getNormalizedRoles(params.serverId);
    const createdRole = roles.find((item) => item.id === role.id);

    return { role: createdRole || normalizeRoleDto(role as unknown as PopulatedRole) };
  }, {
    params: t.Object({
      serverId: t.String(),
    }),
    body: t.Object({
      name: t.Optional(t.String({ maxLength: 100 })),
      color: t.Optional(t.String()),
      permissions: t.Optional(t.String()),
      hoist: t.Optional(t.Boolean()),
      mentionable: t.Optional(t.Boolean()),
    }),
  })
  // Update server role
  .patch('/:serverId/roles/:roleId', async ({ headers, cookie, params, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isValidObjectId(params.serverId) || !isValidObjectId(params.roleId)) {
      set.status = 400;
      return { error: 'Invalid ID' };
    }

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    if (!(await canManageRoles(server, user.id))) {
      set.status = 403;
      return { error: 'You need Manage Roles permission to edit roles' };
    }

    const role = await Role.findOne({ id: params.roleId, serverId: params.serverId });
    if (!role) {
      set.status = 404;
      return { error: 'Role not found' };
    }

    // Cannot edit @everyone name
    if (role.isDefault && body.name && body.name !== '@everyone') {
      set.status = 400;
      return { error: 'Cannot rename the @everyone role' };
    }

    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.color !== undefined) updates.color = parseHexColorToNumber(body.color);
    if (body.permissions !== undefined) updates.permissions = body.permissions;
    if (body.hoist !== undefined) updates.hoist = body.hoist;
    if (body.mentionable !== undefined) updates.mentionable = body.mentionable;
    await Role.updateById(role.id, updates);

    const roles = await getNormalizedRoles(params.serverId);
    const updatedRole = roles.find((item) => item.id === role.id);
    return { role: updatedRole || normalizeRoleDto(role as unknown as PopulatedRole) };
  }, {
    params: t.Object({
      serverId: t.String(),
      roleId: t.String(),
    }),
    body: t.Object({
      name: t.Optional(t.String({ maxLength: 100 })),
      color: t.Optional(t.String()),
      permissions: t.Optional(t.String()),
      hoist: t.Optional(t.Boolean()),
      mentionable: t.Optional(t.Boolean()),
    }),
  })
  // Reorder server roles
  .patch('/:serverId/roles/reorder', async ({ headers, cookie, params, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isValidObjectId(params.serverId)) {
      set.status = 400;
      return { error: 'Invalid server ID' };
    }

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    if (!(await canManageRoles(server, user.id))) {
      set.status = 403;
      return { error: 'You need Manage Roles permission to reorder roles' };
    }

    const orderedRoleIds = body.orderedRoleIds || [];
    if (orderedRoleIds.length === 0) {
      set.status = 400;
      return { error: 'orderedRoleIds is required' };
    }

    const uniqueRoleIds = Array.from(new Set(orderedRoleIds));
    if (uniqueRoleIds.length !== orderedRoleIds.length) {
      set.status = 400;
      return { error: 'orderedRoleIds contains duplicates' };
    }

    if (!uniqueRoleIds.every((roleId) => isValidObjectId(roleId))) {
      set.status = 400;
      return { error: 'orderedRoleIds contains invalid role IDs' };
    }

    const reorderableRoles = await Role.find({
      serverId: params.serverId,
      isDefault: false,
    });

    if (reorderableRoles.length !== uniqueRoleIds.length) {
      set.status = 400;
      return { error: 'orderedRoleIds must include every non-default role exactly once' };
    }

    const existingIds = new Set(reorderableRoles.map((role: any) => role.id));
    if (!uniqueRoleIds.every((roleId) => existingIds.has(roleId))) {
      set.status = 400;
      return { error: 'orderedRoleIds contains role IDs that do not belong to this server' };
    }

    const highestPosition = uniqueRoleIds.length;
    await Promise.all(
      uniqueRoleIds.map((roleId, index) =>
        Role.updateById(roleId, { position: highestPosition - index })
      )
    );

    const roles = await getNormalizedRoles(params.serverId);
    return { roles };
  }, {
    params: t.Object({
      serverId: t.String(),
    }),
    body: t.Object({
      orderedRoleIds: t.Array(t.String()),
    }),
  })
  // Delete server role
  .delete('/:serverId/roles/:roleId', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isValidObjectId(params.serverId) || !isValidObjectId(params.roleId)) {
      set.status = 400;
      return { error: 'Invalid ID' };
    }

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    if (!(await canManageRoles(server, user.id))) {
      set.status = 403;
      return { error: 'You need Manage Roles permission to delete roles' };
    }

    const role = await Role.findOne({ id: params.roleId, serverId: params.serverId });
    if (!role) {
      set.status = 404;
      return { error: 'Role not found' };
    }

    if (role.isDefault) {
      set.status = 400;
      return { error: 'Cannot delete the @everyone role' };
    }

    // Remove role from all members
    const allMembers = await ServerMember.find({ serverId: params.serverId });
    await Promise.all(
      allMembers
        .filter((m: any) => (m.roles || []).includes(params.roleId))
        .map((m: any) => ServerMember.updateById(m.id, { roles: (m.roles || []).filter((r: string) => r !== params.roleId) }))
    );

    await Role.deleteById(role.id);

    const roles = await getNormalizedRoles(params.serverId);
    return { success: true, roles };
  }, {
    params: t.Object({
      serverId: t.String(),
      roleId: t.String(),
    }),
  })
  // Get server widget data (public endpoint) — powers the embeddable
  // /widget/:serverId chat preview. Accepts an optional `channel` query param
  // so the embed can switch which channel's messages are shown.
  .get('/:serverId/widget', async ({ params, query, set }) => {
    if (!isValidObjectId(params.serverId)) {
      set.status = 400;
      return { error: 'Invalid server ID' };
    }

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    if ((server.settings as any)?.widget?.enabled === false) {
      set.status = 403;
      return { error: 'Server widget is disabled' };
    }

    // Get online members
    const allMembers = await ServerMember.find({ serverId: params.serverId });
    const memberUserIds = allMembers.map((m: any) => m.userId).filter(Boolean);
    const memberUsers = memberUserIds.length > 0 ? await User.find({ id: { in: memberUserIds } }) : [];
    const userMap = new Map(memberUsers.map((u: any) => [u.id, u]));
    const members = allMembers.slice(0, 50).map((m: any) => ({
      ...m,
      userId: m.userId ? userMap.get(m.userId) ?? m.userId : null,
    }));

    // Get categories + text/voice/announcement channels, ordered like the
    // real client so the embed's sidebar matches the server's layout.
    const allServerChannels = await Channel.find({ serverId: params.serverId });
    const categories = allServerChannels
      .filter((c: any) => c.type === 'category')
      .sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))
      .slice(0, 25);
    const channels = allServerChannels
      .filter((c: any) =>
        ['text', 'voice', 'announcement'].includes(c.type) &&
        c.nsfw !== true &&
        (!c.permissionOverwrites || c.permissionOverwrites.length === 0)
      )
      .sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))
      .slice(0, 50);

    const rawWidgetChannelId = (server.settings as any)?.widget?.channelId as string | undefined;
    // Only honour the configured widget channel if it survived the public
    // (non-nsfw, no-overwrite) filter above — never leak a gated channel.
    const textChannels = channels.filter((c: any) => c.type === 'text' || c.type === 'announcement');
    const safeChannelIds = new Set(textChannels.map((c: any) => c.id));
    const widgetChannelId = rawWidgetChannelId && safeChannelIds.has(rawWidgetChannelId)
      ? rawWidgetChannelId
      : undefined;

    // A requested channel must actually belong to this server and be a
    // text-like channel — otherwise fall back to the configured widget
    // channel, then the first text channel.
    const requestedChannelId = typeof query.channel === 'string' ? query.channel : undefined;
    const requestedChannel = requestedChannelId && isValidObjectId(requestedChannelId)
      ? textChannels.find((c: any) => c.id === requestedChannelId)
      : undefined;
    const messageChannelId = requestedChannel?.id || widgetChannelId || textChannels[0]?.id;

    interface WidgetAttachment {
      id: string;
      filename: string;
      contentType: string;
      url: string;
      width?: number;
      height?: number;
    }
    interface WidgetEmoji { id: string; name: string; url: string; animated?: boolean }
    interface WidgetMessageAuthor { id: string; username: string; displayName?: string; avatar?: string }
    interface WidgetMessage {
      id: string;
      content: string;
      author: WidgetMessageAuthor;
      createdAt: Date;
      attachments: WidgetAttachment[];
      customEmojis: WidgetEmoji[];
      mentionedUserIds: string[];
      mentionedRoleIds: string[];
      mentionEveryone: boolean;
      sticker?: { id: string; name: string; imageUrl: string };
      referencedMessage?: {
        id: string;
        content: string;
        author?: WidgetMessageAuthor;
      };
    }

    let recentMessages: WidgetMessage[] = [];
    // Resolved names for any @user / @role mentions across the batch, so the
    // embed can render mentions without extra authenticated lookups.
    const mentionUserMap: Record<string, { username: string; displayName?: string }> = {};
    const mentionRoleMap: Record<string, { name: string; color?: string }> = {};

    if (messageChannelId) {
      const allMessages = await Message.find({ channelId: messageChannelId, isDeleted: false });
      allMessages.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const rawMessages = allMessages.slice(0, 30);

      // Batch fetch authors and referenced messages
      const authorIds = [...new Set(rawMessages.map((m: any) => m.authorId).filter(Boolean))];
      const refMsgIds = [...new Set(rawMessages.map((m: any) => m.referencedMessageId).filter(Boolean))];
      const [authors, refMsgs] = await Promise.all([
        authorIds.length > 0 ? User.find({ id: { in: authorIds } }) : [],
        refMsgIds.length > 0 ? Message.find({ id: { in: refMsgIds } }) : [],
      ]);
      const authorMap = new Map(authors.map((a: any) => [a.id, a]));
      const refMsgMap = new Map(refMsgs.map((m: any) => [m.id, m]));
      // Fetch ref message authors
      const refAuthorIds = [...new Set(refMsgs.map((m: any) => m.authorId).filter(Boolean))];
      const refAuthors = refAuthorIds.length > 0 ? await User.find({ id: { in: refAuthorIds } }) : [];
      const refAuthorMap = new Map(refAuthors.map((a: any) => [a.id, a]));

      const decrypted = await Promise.all(
        rawMessages.map(async (msg) => {
          const m = msg as unknown as {
            id: string;
            content?: string;
            authorId?: string;
            createdAt: Date;
            attachments?: Array<{ id?: string; filename?: string; contentType?: string; url?: string; width?: number; height?: number }>;
            sticker?: { id?: string; name?: string; imageUrl?: string };
            mentionedUserIds?: string[];
            mentionedRoleIds?: string[];
            mentionEveryone?: boolean;
            referencedMessageId?: string | null;
          };
          const author = m.authorId ? authorMap.get(m.authorId) : null;
          const content = await decryptFromStorage(m.content || '');

          const emojiResult = await parseCustomEmojis(content);
          const customEmojis: WidgetEmoji[] = emojiResult.emojis.map(e => ({
            id: e.id,
            name: e.name,
            url: e.url,
            animated: e.animated,
          }));

          const refId = m.referencedMessageId;
          let referencedMessage: WidgetMessage['referencedMessage'];
          if (refId) {
            const ref = refMsgMap.get(refId);
            if (ref) {
              const refAuthor = ref.authorId ? refAuthorMap.get(ref.authorId) : null;
              referencedMessage = {
                id: ref.id,
                content: ref.content ? await decryptFromStorage(ref.content) : '',
                author: refAuthor
                  ? {
                      id: refAuthor.id,
                      username: refAuthor.username || '',
                      displayName: refAuthor.displayName,
                      avatar: refAuthor.avatar,
                    }
                  : undefined,
              };
            }
          }

          return {
            id: m.id,
            content,
            author: {
              id: author?.id || '',
              username: author?.username || '',
              displayName: author?.displayName,
              avatar: author?.avatar,
            },
            createdAt: m.createdAt,
            attachments: (m.attachments || []).map(a => ({
              id: a.id || '',
              filename: a.filename || 'file',
              contentType: a.contentType || '',
              url: a.url || '',
              width: a.width,
              height: a.height,
            })),
            customEmojis,
            mentionedUserIds: (m.mentionedUserIds || []).map(id => String(id)),
            mentionedRoleIds: (m.mentionedRoleIds || []).map(id => String(id)),
            mentionEveryone: Boolean(m.mentionEveryone),
            sticker: m.sticker?.imageUrl
              ? { id: m.sticker.id || '', name: m.sticker.name || '', imageUrl: m.sticker.imageUrl }
              : undefined,
            referencedMessage,
          } satisfies WidgetMessage;
        })
      );
      recentMessages = decrypted.reverse();

      // Batch-resolve mention names once for the whole message set.
      const userIds = new Set<string>();
      const roleIds = new Set<string>();
      for (const msg of recentMessages) {
        msg.mentionedUserIds.forEach(id => userIds.add(id));
        msg.mentionedRoleIds.forEach(id => roleIds.add(id));
      }
      if (userIds.size > 0) {
        const mentionMembers = await ServerMember.find({
          serverId: params.serverId,
          userId: { in: Array.from(userIds) },
        });
        const mentionUserIds = mentionMembers.map((m: any) => m.userId).filter(Boolean);
        const mentionUsers = mentionUserIds.length > 0 ? await User.find({ id: { in: mentionUserIds } }) : [];
        for (const u of mentionUsers) {
          mentionUserMap[u.id] = { username: u.username || '', displayName: u.displayName as string | undefined };
        }
      }
      if (roleIds.size > 0) {
        const roles = await Role.find({
          serverId: params.serverId,
          id: { in: Array.from(roleIds) },
        });
        for (const r of roles) {
          mentionRoleMap[r.id] = {
            name: (r.name as string) || 'role',
            color: r.color as unknown as string | undefined,
          };
        }
      }
    }

    // Get an active invite. Partnered servers with a vanity URL prefer that as
    // the default invite (serika.cc/<vanity>) over a random invite code.
    const vanityCode = server.isPartnered && server.vanityUrlCode ? server.vanityUrlCode : undefined;
    let invite: any = null;
    if (!vanityCode) {
      const allInvites = await Invite.find({ serverId: params.serverId });
      const now = new Date();
      const activeInvites = allInvites.filter((i: any) => !i.expiresAt || new Date(i.expiresAt) > now);
      activeInvites.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      invite = activeInvites[0] || null;
    }

    const transformedMembers = members.map((m: any) => {
      const userData = m.userId as PopulatedMemberUser | null;
      return {
        id: userData?.id || '',
        username: userData?.username,
        displayName: userData?.displayName,
        avatar: userData?.avatar,
        status: resolveEffectiveStatus({
          status: userData?.status || 'offline',
          presenceLastHeartbeatAt: userData?.presenceLastHeartbeatAt || null,
        }),
      };
    });

    // Computed across the whole server, not just the (max 50) fetched
    // members above — otherwise larger servers under-report online count.
    const onlineCount = await computeOnlineCount(params.serverId);

    return {
      id: server.id,
      name: server.name,
      icon: server.icon,
      banner: server.banner,
      isPartnered: server.isPartnered,
      memberCount: server.memberCount || members.length,
      onlineCount,
      // Vanity (serika.cc/<vanity>) wins for partnered servers; otherwise the
      // newest active invite code.
      inviteCode: vanityCode || invite?.code,
      currentChannelId: messageChannelId || null,
      categories: categories.map((c: any) => ({
        id: c.id,
        name: c.name,
      })),
      channels: channels.map((c: any) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        parentId: c.parentId || null,
        isWidgetChannel: widgetChannelId ? c.id === widgetChannelId : false,
      })),
      members: transformedMembers,
      recentMessages,
      mentions: { users: mentionUserMap, roles: mentionRoleMap },
    };
  }, {
    params: t.Object({
      serverId: t.String(),
    }),
    query: t.Object({
      channel: t.Optional(t.String()),
    }),
  })
  // Get server emojis
  .get('/:serverId/emojis', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isValidObjectId(params.serverId)) {
      set.status = 400;
      return { error: 'Invalid server ID' };
    }

    const membership = await ServerMember.findOne({
      serverId: params.serverId,
      userId: user.id,
    });

    if (!membership) {
      set.status = 403;
      return { error: 'You are not a member of this server' };
    }

    const emojis = await ServerEmoji.find({ serverId: params.serverId, available: true });
    return { emojis };
  }, {
    params: t.Object({
      serverId: t.String(),
    }),
  })
  // Upload server emoji
  .post('/:serverId/emojis', async ({ headers, cookie, params, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isValidObjectId(params.serverId)) {
      set.status = 400;
      return { error: 'Invalid server ID' };
    }

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    // Check permissions (owner or admin)
    if (server.ownerId !== user.id) {
      set.status = 403;
      return { error: 'Only the server owner can upload emojis' };
    }

    // Check emoji limit (50 for non-premium, 100 for premium)
    const allEmojis = await ServerEmoji.find({ serverId: params.serverId });
    const emojiCount = allEmojis.length;
    const maxEmojis = Number(server.premiumTier || 0) >= 1 ? 100 : 50;
    if (emojiCount >= maxEmojis) {
      set.status = 400;
      return { error: `You can only have ${maxEmojis} custom emojis` };
    }

    const emoji = await ServerEmoji.create({
      serverId: params.serverId,
      name: sanitizeInput(body.name),
      imageUrl: body.imageUrl,
      animated: body.animated || false,
      uploadedBy: user.id,
    });

    return { emoji };
  }, {
    params: t.Object({
      serverId: t.String(),
    }),
    body: t.Object({
      name: t.String({ minLength: 2, maxLength: 32 }),
      imageUrl: t.String(),
      animated: t.Optional(t.Boolean()),
    }),
  })
  // Delete server emoji
  .delete('/:serverId/emojis/:emojiId', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isValidObjectId(params.serverId) || !isValidObjectId(params.emojiId)) {
      set.status = 400;
      return { error: 'Invalid ID' };
    }

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    if (server.ownerId !== user.id) {
      set.status = 403;
      return { error: 'Only the server owner can delete emojis' };
    }

    const emoji = await ServerEmoji.findOne({ id: params.emojiId, serverId: params.serverId });
    if (!emoji) {
      set.status = 404;
      return { error: 'Emoji not found' };
    }

    await ServerEmoji.deleteById(emoji.id);

    return { success: true };
  }, {
    params: t.Object({
      serverId: t.String(),
      emojiId: t.String(),
    }),
  })
  // Get server stickers
  .get('/:serverId/stickers', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isValidObjectId(params.serverId)) {
      set.status = 400;
      return { error: 'Invalid server ID' };
    }

    const membership = await ServerMember.findOne({
      serverId: params.serverId,
      userId: user.id,
    });

    if (!membership) {
      set.status = 403;
      return { error: 'You are not a member of this server' };
    }

    const allStickers = await ServerSticker.find({ serverId: params.serverId, available: true });
    allStickers.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return { stickers: allStickers };
  }, {
    params: t.Object({
      serverId: t.String(),
    }),
  })
  // Create server sticker
  .post('/:serverId/stickers', async ({ headers, cookie, params, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isValidObjectId(params.serverId)) {
      set.status = 400;
      return { error: 'Invalid server ID' };
    }

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    if (server.ownerId !== user.id) {
      set.status = 403;
      return { error: 'Only the server owner can upload stickers' };
    }

    const allStickers = await ServerSticker.find({ serverId: params.serverId });
    const stickerCount = allStickers.length;
    const maxStickers = Number(server.premiumTier || 0) >= 1 ? 30 : 15;
    if (stickerCount >= maxStickers) {
      set.status = 400;
      return { error: `Sticker limit reached (${maxStickers})` };
    }

    const sticker = await ServerSticker.create({
      serverId: params.serverId,
      name: sanitizeInput(body.name),
      description: body.description ? sanitizeInput(body.description) : undefined,
      imageUrl: body.imageUrl,
      tags: body.tags || [],
      uploadedBy: user.id,
    });

    return { sticker };
  }, {
    params: t.Object({
      serverId: t.String(),
    }),
    body: t.Object({
      name: t.String({ minLength: 2, maxLength: 30 }),
      imageUrl: t.String(),
      description: t.Optional(t.String({ maxLength: 200 })),
      tags: t.Optional(t.Array(t.String({ maxLength: 30 }))),
    }),
  })
  // Delete server sticker
  .delete('/:serverId/stickers/:stickerId', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isValidObjectId(params.serverId) || !isValidObjectId(params.stickerId)) {
      set.status = 400;
      return { error: 'Invalid ID' };
    }

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    if (server.ownerId !== user.id) {
      set.status = 403;
      return { error: 'Only the server owner can delete stickers' };
    }

    const stickerToDelete = await ServerSticker.findOne({ id: params.stickerId, serverId: params.serverId });
    if (stickerToDelete) {
      await ServerSticker.deleteById(stickerToDelete.id);
    }
    return { success: true };
  }, {
    params: t.Object({
      serverId: t.String(),
      stickerId: t.String(),
    }),
  })
  // Get soundboard sounds
  .get('/:serverId/soundboard', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isValidObjectId(params.serverId)) {
      set.status = 400;
      return { error: 'Invalid server ID' };
    }

    const membership = await ServerMember.findOne({
      serverId: params.serverId,
      userId: user.id,
    });

    if (!membership) {
      set.status = 403;
      return { error: 'You are not a member of this server' };
    }

    const server = await Server.findById(params.serverId);
    return { sounds: server?.soundboardSounds || [] };
  })
  // Upload soundboard sound
  .post('/:serverId/soundboard', async ({ headers, cookie, params, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isValidObjectId(params.serverId)) {
      set.status = 400;
      return { error: 'Invalid server ID' };
    }

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    if (server.ownerId !== user.id) {
      set.status = 403;
      return { error: 'Only the server owner can add soundboard sounds' };
    }

    const { name, url, emoji } = body as { name: string; url: string; emoji?: string };

    if (!name || !url) {
      set.status = 400;
      return { error: 'Name and URL are required' };
    }

    if ((server.soundboardSounds as any[] | undefined)?.length ?? 0 >= 20) {
      set.status = 400;
      return { error: 'Maximum of 20 soundboard sounds reached' };
    }

    const sounds = (server.soundboardSounds as any[]) || [];
    sounds.push({
      name: name.substring(0, 32),
      url,
      emoji: emoji || '🔊',
      uploadedBy: user.id,
    });

    await Server.updateById(server.id, { soundboardSounds: sounds as any });

    return {
      sound: sounds[sounds.length - 1],
    };
  }, {
    body: t.Object({
      name: t.String({ minLength: 1, maxLength: 32 }),
      url: t.String(),
      emoji: t.Optional(t.String()),
    }),
  })
  // Delete soundboard sound
  .delete('/:serverId/soundboard/:soundId', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isValidObjectId(params.serverId)) {
      set.status = 400;
      return { error: 'Invalid server ID' };
    }

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    if (server.ownerId !== user.id) {
      set.status = 403;
      return { error: 'Only the server owner can delete soundboard sounds' };
    }

    const sounds = (server.soundboardSounds as any[]) || [];
    const idx = sounds.findIndex(
      (s: any) => s.id === params.soundId
    );
    if (idx === -1) {
      set.status = 404;
      return { error: 'Sound not found' };
    }

    sounds.splice(idx, 1);
    await Server.updateById(server.id, { soundboardSounds: sounds as any });

    return { success: true };
  }, {
    params: t.Object({
      serverId: t.String(),
      soundId: t.String(),
    }),
  })
  // Get vanity URL (partnered servers)
  .get('/:serverId/vanity-url', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isValidObjectId(params.serverId)) {
      set.status = 400;
      return { error: 'Invalid server ID' };
    }

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    if (server.ownerId !== user.id && !(await canManageRoles(server, user.id))) {
      set.status = 403;
      return { error: 'You do not have permission to manage this server' };
    }

    return {
      code: server.vanityUrlCode ?? null,
      uses: server.vanityUrlUses ?? 0,
      isPartnered: Boolean(server.isPartnered),
    };
  }, {
    params: t.Object({
      serverId: t.String(),
    }),
  })
  // Set / change / remove vanity URL (partnered servers only)
  .patch('/:serverId/vanity-url', async ({ headers, cookie, params, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isValidObjectId(params.serverId)) {
      set.status = 400;
      return { error: 'Invalid server ID' };
    }

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    if (server.ownerId !== user.id && !(await canManageRoles(server, user.id))) {
      set.status = 403;
      return { error: 'You do not have permission to manage this server' };
    }

    if (!server.isPartnered) {
      set.status = 403;
      return { error: 'Custom invite links are only available to partnered servers' };
    }

    const rawCode = body.code;

    // null / empty clears the vanity URL
    if (rawCode === null || rawCode === undefined || rawCode.trim() === '') {
      await Server.updateById(server.id, { vanityUrlCode: null as any });
      return { code: null, uses: server.vanityUrlUses ?? 0 };
    }

    const code = rawCode.trim().toLowerCase();

    if (!isValidVanityCode(code)) {
      set.status = 400;
      return {
        error: isReservedSlug(code)
          ? 'That link is reserved and cannot be used'
          : 'Links must be 3-32 characters using lowercase letters, numbers, and hyphens',
      };
    }

    if (server.vanityUrlCode === code) {
      return { code, uses: server.vanityUrlUses ?? 0 };
    }

    // Enforce uniqueness against other servers' vanity URLs and invite codes
    const allServers = await Server.find({ vanityUrlCode: code });
    const vanityTaken = allServers.find((s: any) => s.id !== server.id);
    const inviteTaken = await Invite.findOne({ code });
    if (vanityTaken || inviteTaken) {
      set.status = 409;
      return { error: 'That link is already in use' };
    }

    await Server.updateById(server.id, { vanityUrlCode: code, vanityUrlUses: 0 });

    return { code, uses: 0 };
  }, {
    params: t.Object({
      serverId: t.String(),
    }),
    body: t.Object({
      code: t.Nullable(t.String()),
    }),
  })
  // Get server invites
  .get('/:serverId/invites', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isValidObjectId(params.serverId)) {
      set.status = 400;
      return { error: 'Invalid server ID' };
    }

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    // Only owner can view all invites
    if (server.ownerId !== user.id) {
      set.status = 403;
      return { error: 'You do not have permission to view invites' };
    }

    const invites = await Invite.find({ serverId: params.serverId });

    // Manual populate: batch fetch inviters and channels
    const inviterIds = [...new Set(invites.map((i: any) => i.inviterId).filter(Boolean))];
    const channelIds = [...new Set(invites.map((i: any) => i.channelId).filter(Boolean))];
    const [inviters, channels] = await Promise.all([
      inviterIds.length > 0 ? User.find({ id: { in: inviterIds } }) : [],
      channelIds.length > 0 ? Channel.find({ id: { in: channelIds } }) : [],
    ]);
    const inviterMap = new Map(inviters.map((u: any) => [u.id, u]));
    const channelMap = new Map(channels.map((c: any) => [c.id, c]));

    invites.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Transform invites to include channel data
    const transformedInvites = invites.map((invite: any) => {
      const channel = invite.channelId ? channelMap.get(invite.channelId) : null;
      const inviter = invite.inviterId ? inviterMap.get(invite.inviterId) : null;
      return {
        code: invite.code,
        uses: invite.uses,
        maxUses: invite.maxUses,
        expiresAt: invite.expiresAt,
        createdAt: invite.createdAt,
        channel: channel ? {
          id: channel.id,
          name: channel.name || 'unknown',
          type: channel.type || 'text',
        } : null,
        createdBy: inviter ? {
          id: inviter.id,
          username: inviter.username || 'Unknown',
          displayName: inviter.displayName,
          avatar: inviter.avatar,
        } : null,
      };
    });

    return { invites: transformedInvites };
  }, {
    params: t.Object({
      serverId: t.String(),
    }),
  })
  // Delete invite
  .delete('/:serverId/invites/:code', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    // Only owner can delete invites
    if (server.ownerId !== user.id) {
      set.status = 403;
      return { error: 'You do not have permission to delete invites' };
    }

    const inviteToDelete = await Invite.findOne({ code: params.code, serverId: params.serverId });
    if (inviteToDelete) {
      await Invite.deleteById(inviteToDelete.id);
    }
    return { success: true };
  }, {
    params: t.Object({
      serverId: t.String(),
      code: t.String(),
    }),
  })
  // Get server bans
  .get('/:serverId/bans', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isValidObjectId(params.serverId)) {
      set.status = 400;
      return { error: 'Invalid server ID' };
    }

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    // Only owner can view bans
    if (server.ownerId !== user.id) {
      set.status = 403;
      return { error: 'You do not have permission to view bans' };
    }

    const bans = await ServerBan.find({ serverId: params.serverId });

    // Manual populate: batch fetch banned users and banners
    const bannedUserIds = [...new Set(bans.map((b: any) => b.userId).filter(Boolean))];
    const bannerIds = [...new Set(bans.map((b: any) => b.bannedBy).filter(Boolean))];
    const allUserIds = [...new Set([...bannedUserIds, ...bannerIds])];
    const users = allUserIds.length > 0 ? await User.find({ id: { in: allUserIds } }) : [];
    const userMap = new Map(users.map((u: any) => [u.id, u]));

    bans.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return {
      bans: bans.map((ban: any) => {
        const bannedUser = ban.userId ? userMap.get(ban.userId) : null;
        const banner = ban.bannedBy ? userMap.get(ban.bannedBy) : null;
        return {
          id: bannedUser?.id || ban.userId,
          username: bannedUser?.displayName || bannedUser?.username || 'Unknown',
          avatar: bannedUser?.avatar,
          reason: ban.reason,
          bannedAt: ban.createdAt,
          bannedBy: {
            id: banner?.id || ban.bannedBy,
            username: banner?.displayName || banner?.username || 'Unknown',
          },
        };
      }),
    };
  }, {
    params: t.Object({
      serverId: t.String(),
    }),
  })
  // Ban user
  .post('/:serverId/bans/:userId', async ({ headers, cookie, params, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isValidObjectId(params.serverId) || !isValidObjectId(params.userId)) {
      set.status = 400;
      return { error: 'Invalid ID' };
    }

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    if (server.ownerId !== user.id) {
      set.status = 403;
      return { error: 'You do not have permission to ban users' };
    }

    if (server.ownerId === params.userId) {
      set.status = 400;
      return { error: 'You cannot ban the server owner' };
    }

    const targetUser = await ServerMember.findOne({
      serverId: params.serverId,
      userId: params.userId,
    });
    if (!targetUser) {
      set.status = 404;
      return { error: 'User is not a server member' };
    }

    // Upsert ban
    const existingBan = await ServerBan.findOne({ serverId: params.serverId, userId: params.userId });
    if (existingBan) {
      await ServerBan.updateById(existingBan.id, { bannedBy: user.id, reason: body.reason || null });
    } else {
      await ServerBan.create({
        serverId: params.serverId,
        userId: params.userId,
        bannedBy: user.id,
        reason: body.reason || null,
      });
    }

    await ServerMember.deleteById(targetUser.id);
    await Server.updateById(server.id, { memberCount: Math.max(0, (server.memberCount || 0) - 1) });

    await AdminLog.create({
      adminId: user.id,
      action: 'ban_user',
      targetType: 'server',
      targetId: params.serverId,
      reason: body.reason || null,
      details: { userId: params.userId },
    });

    return { success: true };
  }, {
    params: t.Object({
      serverId: t.String(),
      userId: t.String(),
    }),
    body: t.Object({
      reason: t.Optional(t.String({ maxLength: 512 })),
    }),
  })
  // Unban user
  .delete('/:serverId/bans/:userId', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    // Only owner can unban
    if (server.ownerId !== user.id) {
      set.status = 403;
      return { error: 'You do not have permission to unban users' };
    }

    const banToDelete = await ServerBan.findOne({ serverId: params.serverId, userId: params.userId });
    if (banToDelete) {
      await ServerBan.deleteById(banToDelete.id);
    }

    await AdminLog.create({
      adminId: user.id,
      action: 'unban_user',
      targetType: 'server',
      targetId: params.serverId,
      details: { userId: params.userId },
    });

    return { success: true };
  }, {
    params: t.Object({
      serverId: t.String(),
      userId: t.String(),
    }),
  })
  // Get server audit log
  .get('/:serverId/audit-log', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isValidObjectId(params.serverId)) {
      set.status = 400;
      return { error: 'Invalid server ID' };
    }

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    if (server.ownerId !== user.id) {
      set.status = 403;
      return { error: 'You do not have permission to view audit log' };
    }

    const logs = await AdminLog.find({ targetType: 'server', targetId: params.serverId });

    // Manual populate: batch fetch admins
    const adminIds = [...new Set(logs.map((l: any) => l.adminId).filter(Boolean))];
    const admins = adminIds.length > 0 ? await User.find({ id: { in: adminIds } }) : [];
    const adminMap = new Map(admins.map((a: any) => [a.id, a]));

    logs.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const limitedLogs = logs.slice(0, 100);

    return {
      logs: limitedLogs.map((log: any) => {
        const admin = log.adminId ? adminMap.get(log.adminId) : null;
        return {
          id: log.id,
          action: log.action,
          reason: log.reason,
          details: log.details,
          createdAt: log.createdAt,
          admin: {
            id: admin?.id,
            username: admin?.displayName || admin?.username || 'Unknown',
            avatar: admin?.avatar,
          },
        };
      }),
    };
  }, {
    params: t.Object({
      serverId: t.String(),
    }),
  })
  // Application management
  // Get pending application count (for badges)
  .get('/:serverId/applications/count', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isValidObjectId(params.serverId)) {
      set.status = 400;
      return { error: 'Invalid server ID' };
    }

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    if (server.ownerId !== user.id && !(await canManageServer(server, user.id))) {
      set.status = 403;
      return { error: 'You do not have permission to view applications' };
    }

    const allApps = await ServerMemberApplication.find({
      serverId: server.id,
      status: 'pending',
    });
    const count = allApps.length;

    return { count };
  }, {
    params: t.Object({ serverId: t.String() }),
  })
  // List applications for a server
  .get('/:serverId/applications', async ({ headers, cookie, params, query, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isValidObjectId(params.serverId)) {
      set.status = 400;
      return { error: 'Invalid server ID' };
    }

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    if (server.ownerId !== user.id && !(await canManageServer(server, user.id))) {
      set.status = 403;
      return { error: 'You do not have permission to view applications' };
    }

    const status = query.status || 'all';
    const filter: Record<string, string> = { serverId: server.id };
    if (status !== 'all') filter.status = status;

    const applications = await ServerMemberApplication.find(filter);

    // Manual populate: batch fetch users
    const userIds = [...new Set(applications.map((a: any) => a.userId).filter(Boolean))];
    const users = userIds.length > 0 ? await User.find({ id: { in: userIds } }) : [];
    const userMap = new Map(users.map((u: any) => [u.id, u]));

    applications.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return {
      applications: applications.map((app: any) => {
        const appUser = app.userId ? userMap.get(app.userId) : null;
        return {
          id: app.id,
          user: {
            id: appUser?.id || app.userId,
            username: appUser?.username,
            displayName: appUser?.displayName,
            avatar: appUser?.avatar,
            createdAt: appUser?.createdAt,
          },
          status: app.status,
          answers: app.answers,
          createdAt: app.createdAt,
          processedAt: app.processedAt,
        };
      }),
    };
  }, {
    params: t.Object({ serverId: t.String() }),
    query: t.Object({ status: t.Optional(t.String()) }),
  })
  // Submit an application to join a server
  .post('/:serverId/applications', async ({ headers, cookie, params, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isValidObjectId(params.serverId)) {
      set.status = 400;
      return { error: 'Invalid server ID' };
    }

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    const joinMode = server.joinMode || 'invite_only';
    if (joinMode !== 'apply_to_join') {
      set.status = 400;
      return { error: 'This server is not accepting applications' };
    }

    // Check bans
    const isBanned = await ServerBan.findOne({ serverId: server.id, userId: user.id });
    if (isBanned) {
      set.status = 403;
      return { error: 'You are banned from this server' };
    }

    // Check existing membership
    const existingMembership = await ServerMember.findOne({
      serverId: server.id,
      userId: user.id,
    });
    if (existingMembership) {
      set.status = 400;
      return { error: 'Already a member of this server' };
    }

    // Check for existing pending application
    const existingApp = await ServerMemberApplication.findOne({
      serverId: server.id,
      userId: user.id,
      status: 'pending',
    });
    if (existingApp) {
      set.status = 400;
      return { error: 'You already have a pending application' };
    }

    const { answers } = body as { answers: { question: string; answer: string }[] };
    if (!Array.isArray(answers) || answers.length === 0) {
      set.status = 400;
      return { error: 'Application answers are required' };
    }

    const application = await ServerMemberApplication.create({
      serverId: server.id,
      userId: user.id,
      status: 'pending',
      answers: answers.map((a) => ({
        question: sanitizeInput(a.question || ''),
        answer: sanitizeInput(a.answer || ''),
        isPrivate: true,
      })),
    });

    return {
      success: true,
      application: {
        id: application.id,
        status: application.status,
        createdAt: application.createdAt,
      },
    };
  }, {
    params: t.Object({ serverId: t.String() }),
    body: t.Object({
      answers: t.Array(t.Object({
        question: t.String({ maxLength: 200 }),
        answer: t.String({ maxLength: 2000 }),
      })),
    }),
  })
  // Get current user's application for a server
  .get('/:serverId/applications/my', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isValidObjectId(params.serverId)) {
      set.status = 400;
      return { error: 'Invalid server ID' };
    }

    const allApplications = await ServerMemberApplication.find({
      serverId: params.serverId,
      userId: user.id,
    });
    allApplications.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const application = allApplications[0] || null;

    if (!application) {
      return { application: null };
    }

    return {
      application: {
        id: application.id,
        status: application.status,
        answers: application.answers,
        createdAt: application.createdAt,
        processedAt: application.processedAt,
        rejectionReason: application.rejectionReason,
      },
    };
  }, {
    params: t.Object({ serverId: t.String() }),
  })
  // Review/update an application
  .patch('/:serverId/applications/:applicationId', async ({ headers, cookie, params, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isValidObjectId(params.serverId) || !isValidObjectId(params.applicationId)) {
      set.status = 400;
      return { error: 'Invalid ID' };
    }

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    if (server.ownerId !== user.id && !(await canManageServer(server, user.id))) {
      set.status = 403;
      return { error: 'You do not have permission to manage applications' };
    }

    const application = await ServerMemberApplication.findOne({
      id: params.applicationId,
      serverId: server.id,
    });
    if (!application) {
      set.status = 404;
      return { error: 'Application not found' };
    }

    const { status, rejectionReason } = body as { status: string; rejectionReason?: string };
    if (!['approved', 'rejected', 'interviewed'].includes(status)) {
      set.status = 400;
      return { error: 'Invalid status' };
    }

    const updates: Record<string, unknown> = {
      status,
      processedBy: user.id,
      processedAt: new Date(),
    };
    if (status === 'rejected' && rejectionReason) {
      updates.rejectionReason = sanitizeInput(rejectionReason).slice(0, 500);
    }

    // If approved, add user to server
    if (status === 'approved') {
      await addUserToServer(server.id, application.userId);
    }

    await ServerMemberApplication.updateById(application.id, updates);

    return {
      success: true,
      application: {
        id: application.id,
        status,
        processedAt: updates.processedAt,
      },
    };
  }, {
    params: t.Object({ serverId: t.String(), applicationId: t.String() }),
    body: t.Object({
      status: t.String(),
      rejectionReason: t.Optional(t.String({ maxLength: 500 })),
    }),
  })
  // Join server by ID (for explore page)
  .post('/:serverId/join', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isValidObjectId(params.serverId)) {
      set.status = 400;
      return { error: 'Invalid server ID' };
    }

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    // Respect server access settings
    const joinMode = server.joinMode || 'invite_only';
    if (joinMode === 'invite_only') {
      set.status = 403;
      return { error: 'This server is invite-only. You need an invite to join.' };
    }

    if (joinMode === 'apply_to_join') {
      set.status = 400;
      return { error: 'application_required' };
    }

    // Check if already a member
    const existingMembership = await ServerMember.findOne({
      serverId: server.id,
      userId: user.id,
    });

    if (existingMembership) {
      set.status = 400;
      return { error: 'Already a member of this server' };
    }

    // Check server limit
    const userServers = await ServerMember.find({ userId: user.id });
    const serverCount = userServers.length;
    if (serverCount >= config.MAX_SERVERS_PER_USER) {
      set.status = 400;
      return { error: `You can only be in ${config.MAX_SERVERS_PER_USER} servers` };
    }

    await addUserToServer(server.id, user.id);

    return {
      success: true,
      server: {
        id: server.id,
        name: server.name,
        icon: server.icon,
      },
    };
  }, {
    params: t.Object({
      serverId: t.String(),
    }),
  });

// Public partnered servers list (no auth required)
export const partnerRoutes = new Elysia({ prefix: '/servers' })
  .get('/partnered', async ({ set }) => {
    try {
      const allServers = await Server.find({ isPartnered: true });
      const servers = allServers
        .sort((a: any, b: any) => new Date(a.partneredAt || 0).getTime() - new Date(b.partneredAt || 0).getTime())
        .slice(0, 20);

      return {
        servers: servers.map((s: any) => ({
          id: s.id,
          name: s.name,
          icon: s.icon ?? null,
          description: s.description ?? null,
          memberCount: s.memberCount ?? 0,
          vanityUrlCode: s.vanityUrlCode ?? null,
        })),
      };
    } catch {
      set.status = 500;
      return { error: 'Failed to fetch partnered servers' };
    }
  })
  .get('/discoverable', async ({ query, set }) => {
    try {
      const filter: Record<string, unknown> = { isDiscoverable: true };
      if (query.category && query.category !== 'all') {
        filter.discoveryCategories = query.category;
      }

      let servers = await Server.find(filter);

      if (query.search) {
        const searchLower = query.search.toLowerCase();
        servers = servers.filter((s: any) =>
          (s.name || '').toLowerCase().includes(searchLower) ||
          (s.description || '').toLowerCase().includes(searchLower)
        );
      }

      servers.sort((a: any, b: any) => (b.memberCount ?? 0) - (a.memberCount ?? 0));
      const limitedServers = servers.slice(0, 50);

      // Calculate online counts dynamically for each server
      const serverIds = limitedServers.map((s: any) => s.id);
      const allMembers = serverIds.length > 0 ? await ServerMember.find({ serverId: { in: serverIds } }) : [];
      const memberUserIds = [...new Set(allMembers.map((m: any) => m.userId).filter(Boolean))];
      const memberUsers = memberUserIds.length > 0 ? await User.find({ id: { in: memberUserIds } }) : [];
      const userMap = new Map(memberUsers.map((u: any) => [u.id, u]));

      const now = Date.now();
      const onlineCountMap = new Map<string, number>();
      for (const sid of serverIds) {
        const count = allMembers
          .filter((m: any) => m.serverId === sid)
          .filter((m: any) => {
            const u = m.userId ? userMap.get(m.userId) : null;
            if (!u) return false;
            if (u.status === 'offline') return false;
            const hb = u.presenceLastHeartbeatAt;
            return hb && new Date(hb).getTime() >= now - 90000;
          })
          .length;
        onlineCountMap.set(sid, count);
      }

      return {
        servers: limitedServers.map((s: any) => ({
          id: s.id,
          name: s.name,
          icon: s.icon ?? null,
          banner: s.banner ?? null,
          description: s.description ?? s.discoveryDescription ?? null,
          memberCount: s.memberCount ?? 0,
          onlineCount: onlineCountMap.get(s.id) ?? 0,
          isPartnered: s.isPartnered ?? false,
          joinMode: s.joinMode || 'invite_only',
          category: s.discoveryCategories?.[0] ?? null,
          tags: s.discoveryCategories ?? [],
          vanityUrlCode: s.vanityUrlCode ?? null,
        })),
      };
    } catch {
      set.status = 500;
      return { error: 'Failed to fetch discoverable servers' };
    }
  }, {
    query: t.Object({
      category: t.Optional(t.String()),
      search: t.Optional(t.String()),
    }),
  });

// Resolve an invite code to a server: normal invite docs first, then partnered
// vanity URLs stored on the server itself (e.g. serika.cc/my-community).
async function resolveInviteCode(code: string): Promise<
  | { kind: 'invite'; invite: any; serverId: string }
  | { kind: 'vanity'; server: any; serverId: string }
  | null
> {
  const invite = await Invite.findOne({ code });
  if (invite) {
    if (invite.expiresAt && new Date(invite.expiresAt).getTime() <= Date.now()) return null;
    return { kind: 'invite', invite, serverId: invite.serverId };
  }

  const vanityServer = await Server.findOne({ vanityUrlCode: code.toLowerCase() });
  if (vanityServer) {
    return { kind: 'vanity', server: vanityServer, serverId: vanityServer.id };
  }

  return null;
}

// Invite routes
export const inviteRoutes = new Elysia({ prefix: '/invites' })
  // Get invite info
  .get('/:code', async ({ params, set }) => {
    const resolved = await resolveInviteCode(params.code);

    if (!resolved) {
      set.status = 404;
      return { error: 'Invite not found or expired' };
    }

    const server = await Server.findById(resolved.serverId);

    if (!server) {
      set.status = 404;
      return { error: 'Invite not found or expired' };
    }

    const onlineCount = await computeOnlineCount(resolved.serverId);

    return {
      code: params.code,
      server: {
        id: server.id,
        name: server.name,
        icon: server.icon,
        banner: server.banner,
        description: server.description,
        memberCount: server.memberCount,
        onlineCount,
        isPartnered: server.isPartnered,
        joinMode: server.joinMode || 'invite_only',
      },
      expiresAt: resolved.kind === 'invite' ? resolved.invite.expiresAt : null,
    };
  }, {
    params: t.Object({
      code: t.String(),
    }),
  })
  // Join via invite
  .post('/:code', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const resolved = await resolveInviteCode(params.code);

    if (!resolved) {
      set.status = 404;
      return { error: 'Invite not found or expired' };
    }

    const invite = resolved.kind === 'invite' ? resolved.invite : null;

    const isBanned = await ServerBan.findOne({ serverId: resolved.serverId, userId: user.id });
    if (isBanned) {
      set.status = 403;
      return { error: 'You are banned from this server' };
    }

    // Check if already a member
    const existingMembership = await ServerMember.findOne({
      serverId: resolved.serverId,
      userId: user.id,
    });

    if (existingMembership) {
      set.status = 400;
      return { error: 'Already a member of this server' };
    }

    // Check server limit
    const userServers = await ServerMember.find({ userId: user.id });
    const serverCount = userServers.length;
    if (serverCount >= config.MAX_SERVERS_PER_USER) {
      set.status = 400;
      return { error: `You can only be in ${config.MAX_SERVERS_PER_USER} servers` };
    }

    // Check max uses
    if (invite && invite.maxUses > 0 && invite.uses >= invite.maxUses) {
      set.status = 400;
      return { error: 'Invite has reached maximum uses' };
    }

    // Get @everyone role
    const everyoneRole = await Role.findOne({
      serverId: resolved.serverId,
      isDefault: true,
    });

    // Create membership
    await ServerMember.create({
      serverId: resolved.serverId,
      userId: user.id,
      roles: everyoneRole ? [everyoneRole.id] : [],
    });

    // Track uses on the invite doc, or on the server for vanity joins
    if (invite) {
      await Invite.updateById(invite.id, { uses: (invite.uses || 0) + 1 });
    } else {
      const vanityServer = await Server.findById(resolved.serverId);
      if (vanityServer) {
        await Server.updateById(vanityServer.id, { vanityUrlUses: (vanityServer.vanityUrlUses || 0) + 1 });
      }
    }

    // Update server member count
    const server = await Server.findById(resolved.serverId);
    if (server) {
      await Server.updateById(server.id, { memberCount: (server.memberCount || 0) + 1 });
    }

    return {
      success: true,
      server: {
        id: server?.id,
        name: server?.name,
        icon: server?.icon,
      },
    };
  }, {
    params: t.Object({
      code: t.String(),
    }),
  });
