import { Elysia, t } from 'elysia';
import { Server, Channel, Role, ServerMember, Invite, ServerEmoji, ServerSticker, ServerBan, AdminLog, Message } from '@/lib/models';
import { authenticateRequest } from '@/lib/services/auth';
import { checkRateLimit, getClientIP, sanitizeInput, isValidObjectId, rejectInvalidObjectIdParams, decryptFromStorage } from '@/lib/security';
import { cache } from '@/lib/db';
import { nanoid } from 'nanoid';
import { config } from '@/lib/config';
import { isReservedSlug, isValidVanityCode } from '@/lib/constants/reserved';
import { resolveEffectiveStatus } from '@/lib/services/presence';
import { Types } from 'mongoose';

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
const PERM_MANAGE_ROLES = 1n << 28n;

// Check if user can manage roles in a server (owner or has Manage Roles / Administrator)
async function canManageRoles(server: { ownerId: Types.ObjectId; _id: Types.ObjectId }, userId: Types.ObjectId): Promise<boolean> {
  if (server.ownerId.equals(userId)) return true;
  const member = await ServerMember.findOne({ serverId: server._id, userId }).populate('roles', 'permissions');
  if (!member) return false;
  const roles = member.roles as unknown as { permissions: string }[];
  for (const role of roles) {
    const perms = BigInt(role.permissions || '0');
    if ((perms & PERM_ADMINISTRATOR) === PERM_ADMINISTRATOR) return true;
    if ((perms & PERM_MANAGE_ROLES) === PERM_MANAGE_ROLES) return true;
  }
  return false;
}

interface PopulatedRole {
  _id: Types.ObjectId;
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
  _id: Types.ObjectId;
  username: string;
  displayName?: string;
  avatar?: string;
  status?: string;
  customStatus?: string;
  isPremium?: boolean;
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
    id: role._id.toString(),
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
  const aggregated = await ServerMember.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { serverId: new Types.ObjectId(serverId) } },
    { $unwind: '$roles' },
    { $group: { _id: '$roles', count: { $sum: 1 } } },
  ]);

  return new Map(aggregated.map((item) => [item._id.toString(), item.count]));
}

async function getNormalizedRoles(serverId: string) {
  const roles = await Role.find({ serverId }).sort({ position: -1 });
  const memberCountMap = await getRoleMemberCountMap(serverId);
  return roles.map((role) =>
    normalizeRoleDto(role as unknown as PopulatedRole, memberCountMap.get(role._id.toString()) || 0)
  );
}

function normalizeMemberDto(member: {
  _id: Types.ObjectId;
  userId?: PopulatedMemberUser | null;
  roles?: PopulatedRole[];
  joinedAt?: Date;
  nickname?: string | null;
  avatar?: string | null;
  banner?: string | null;
}, ownerId?: Types.ObjectId | null) {
  const memberRoles = (member.roles || [])
    .map((role) => normalizeRoleDto(role))
    .sort((a, b) => b.position - a.position);
  const highestRole = memberRoles[0] || null;
  const highestHoistedRole = memberRoles.find((role) => role.hoist) || null;
  const userData = member.userId;

  return {
    id: userData?._id?.toString() || '',
    membershipId: member._id.toString(),
    username: userData?.username || 'Unknown',
    displayName: member.nickname || userData?.displayName || userData?.username || 'Unknown',
    avatar: member.avatar || userData?.avatar || null,
    status: resolveEffectiveStatus({
      status: userData?.status || 'offline',
      presenceLastHeartbeatAt: userData?.presenceLastHeartbeatAt || null,
    }),
    customStatus: userData?.customStatus || null,
    isPremium: Boolean(userData?.isPremium),
    isOwner: ownerId ? ownerId.equals(userData?._id as unknown as Types.ObjectId) : false,
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

    const memberships = await ServerMember.find({ userId: user._id })
      .populate({
        path: 'serverId',
        select: 'name icon banner ownerId memberCount onlineCount features premiumTier isAgeGated isPartnered',
      });

    const servers = memberships
      .filter(m => m.serverId)
      .map(m => ({
        ...(m.serverId as unknown as { toJSON: () => Record<string, unknown> }).toJSON(),
        joinedAt: m.joinedAt,
        roles: m.roles,
      }));

    return { servers };
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
    const rateLimit = await checkRateLimit('serverCreate', `${user._id}:${ip}`);
    if (!rateLimit.success) {
      set.status = 429;
      return { error: 'Server creation rate limited', retryAfter: rateLimit.retryAfter };
    }

    // Check server limit
    const serverCount = await ServerMember.countDocuments({ userId: user._id });
    if (serverCount >= config.MAX_SERVERS_PER_USER) {
      set.status = 400;
      return { error: `You can only be in ${config.MAX_SERVERS_PER_USER} servers` };
    }

    const { name, icon } = body;
    const sanitizedName = sanitizeInput(name);

    // Create server
    const server = new Server({
      name: sanitizedName,
      icon,
      ownerId: user._id,
      memberCount: 1,
    });

    await server.save();

    // Create @everyone role
    const everyoneRole = new Role({
      serverId: server._id,
      name: '@everyone',
      position: 0,
      permissions: DEFAULT_PERMISSIONS.everyone,
      isDefault: true,
    });

    await everyoneRole.save();

    // Create default channels
    const textCategory = new Channel({
      serverId: server._id,
      name: 'Text Channels',
      type: 'category',
      position: 0,
    });

    await textCategory.save();

    const generalChannel = new Channel({
      serverId: server._id,
      name: 'general',
      type: 'text',
      position: 0,
      parentId: textCategory._id,
    });

    await generalChannel.save();

    // Create voice category and channel
    const voiceCategory = new Channel({
      serverId: server._id,
      name: 'Voice Channels',
      type: 'category',
      position: 1,
    });

    await voiceCategory.save();

    const generalVoice = new Channel({
      serverId: server._id,
      name: 'General',
      type: 'voice',
      position: 0,
      parentId: voiceCategory._id,
    });

    await generalVoice.save();

    // Set system channel
    server.systemChannelId = generalChannel._id;
    await server.save();

    // Add owner as member
    const membership = new ServerMember({
      serverId: server._id,
      userId: user._id,
      roles: [everyoneRole._id],
    });

    await membership.save();

    return {
      success: true,
      server: {
        ...server.toJSON(),
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

    const isBanned = await ServerBan.exists({ serverId: server._id, userId: user._id });
    if (isBanned) {
      set.status = 403;
      return { error: 'You are banned from this server' };
    }

    // Check if owner or has manage channels permission
    if (!server.ownerId.equals(user._id)) {
      set.status = 403;
      return { error: 'You do not have permission to create channels' };
    }

    // Check channel limit
    const channelCount = await Channel.countDocuments({ serverId: server._id });
    if (channelCount >= config.MAX_CHANNELS_PER_SERVER) {
      set.status = 400;
      return { error: `Server has reached the channel limit of ${config.MAX_CHANNELS_PER_SERVER}` };
    }

    const { name, type = 'text', parentId, nsfw } = body;
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
    const highestChannel = await Channel.findOne({
      serverId: server._id,
      parentId: parentId || null,
    }).sort({ position: -1 });

    const position = highestChannel ? highestChannel.position + 1 : 0;

    const channel = new Channel({
      serverId: server._id,
      name: sanitizedName,
      type,
      position,
      parentId: parentId || null,
      nsfw: type !== 'category' ? Boolean(nsfw) : false,
    });

    await channel.save();

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
      type: t.Optional(t.Union([t.Literal('text'), t.Literal('voice'), t.Literal('announcement'), t.Literal('category')])),
      parentId: t.Optional(t.String()),
      nsfw: t.Optional(t.Boolean()),
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

    if (!server.ownerId.equals(user._id)) {
      set.status = 403;
      return { error: 'You do not have permission to reorder channels' };
    }

    const { channels: channelUpdates } = body;
    if (!Array.isArray(channelUpdates) || channelUpdates.length === 0) {
      set.status = 400;
      return { error: 'No channel updates provided' };
    }

    // Bulk update each channel's position and parentId
    const bulkOps = channelUpdates.map((update: { id: string; position: number; parentId?: string | null }) => ({
      updateOne: {
        filter: { _id: update.id, serverId: server._id },
        update: {
          $set: {
            position: update.position,
            ...(update.parentId !== undefined ? { parentId: update.parentId || null } : {}),
          },
        },
      },
    }));

    await Channel.bulkWrite(bulkOps);

    // Fetch fresh channel list
    const updatedChannels = await Channel.find({ serverId: server._id }).sort({ position: 1 });

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

    // Check membership
    const membership = await ServerMember.findOne({
      serverId: params.serverId,
      userId: user._id,
    });

    if (!membership) {
      set.status = 403;
      return { error: 'You are not a member of this server' };
    }

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    const channels = await Channel.find({ serverId: server._id }).sort({ position: 1 });
    const roles = await Role.find({ serverId: server._id }).sort({ position: -1 });

    return {
      server: {
        ...server.toJSON(),
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
      serverId: server._id,
      userId: user._id,
    });
    if (!membership) {
      set.status = 403;
      return { error: 'You are not a member of this server' };
    }

    return {
      settings: {
        widget: server.settings?.widget || { enabled: true, channelId: null },
        moderation: {
          verificationLevel: server.settings?.moderation?.verificationLevel || server.verificationLevel,
          explicitContentFilter: server.settings?.moderation?.explicitContentFilter || server.explicitContentFilter,
          require2FA: server.settings?.moderation?.require2FA || false,
        },
        safety: server.settings?.safety || { raidProtection: false, antiSpam: true, mentionSpamLimit: 5 },
        integrations: server.settings?.integrations || {
          discord: false,
          twitch: false,
          youtube: false,
          webhooks: false,
        },
        soundboard: server.settings?.soundboard || {
          enabled: true,
          volume: 100,
        },
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

    if (!server.ownerId.equals(user._id) && !(await canManageRoles(server, user._id))) {
      set.status = 403;
      return { error: 'You do not have permission to edit this server' };
    }

    const payload = body as any;
    const nextSettings = {
      ...(server.settings || {}),
      ...(payload.settings || {}),
      widget: {
        ...(server.settings?.widget || {}),
        ...(payload.settings?.widget || {}),
      },
      moderation: {
        ...(server.settings?.moderation || {}),
        ...(payload.settings?.moderation || {}),
      },
      safety: {
        ...(server.settings?.safety || {}),
        ...(payload.settings?.safety || {}),
      },
      integrations: {
        ...(server.settings?.integrations || {}),
        ...(payload.settings?.integrations || {}),
      },
      soundboard: {
        ...(server.settings?.soundboard || {}),
        ...(payload.settings?.soundboard || {}),
      },
    } as any;

    if (nextSettings.moderation?.verificationLevel) {
      server.verificationLevel = nextSettings.moderation.verificationLevel;
    }
    if (nextSettings.moderation?.explicitContentFilter) {
      server.explicitContentFilter = nextSettings.moderation.explicitContentFilter;
    }

    server.settings = nextSettings;
    await server.save();
    await cache.del(`server:${server._id}`);

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

    if (!server.ownerId.equals(user._id) && !(await canManageRoles(server, user._id))) {
      set.status = 403;
      return { error: 'You do not have permission to edit this server' };
    }

    const changes = body.changes as Record<string, string | number | boolean | null>;
    const fieldErrors: Record<string, string> = {};

    const VERIFICATION_LEVELS = ['none', 'low', 'medium', 'high', 'very_high'];
    const CONTENT_FILTERS = ['disabled', 'members_without_roles', 'all_members'];
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
        _id: { $in: channelIdsToCheck },
        serverId: server._id,
      }).select('_id').lean();
      const foundIds = new Set(found.map((c) => c._id.toString()));
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
        default:
          fieldErrors[key] = 'Unknown setting';
      }
    }

    if (Object.keys(fieldErrors).length > 0) {
      set.status = 400;
      return { error: 'Some settings are invalid', fieldErrors };
    }

    // All valid: apply everything, then persist in one save
    for (const apply of staged) apply();
    server.markModified('settings');
    await server.save();
    await cache.del(`server:${server._id}`);

    return {
      success: true,
      server: {
        id: server._id.toString(),
        name: server.name,
        description: server.description,
        systemChannelId: server.systemChannelId?.toString() ?? null,
        rulesChannelId: server.rulesChannelId?.toString() ?? null,
        afkChannelId: server.afkChannelId?.toString() ?? null,
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
    if (!server.ownerId.equals(user._id)) {
      set.status = 403;
      return { error: 'You do not have permission to edit this server' };
    }

    const { name, description, icon, banner, systemChannelId, rulesChannelId, afkChannelId, afkTimeout, verificationLevel, explicitContentFilter, isAgeGated } = body;

    if (name !== undefined) server.name = sanitizeInput(name);
    if (description !== undefined) server.description = sanitizeInput(description);
    if (icon !== undefined) server.icon = icon;
    if (banner !== undefined) server.banner = banner;
    if (systemChannelId !== undefined) server.systemChannelId = systemChannelId || undefined;
    if (rulesChannelId !== undefined) server.rulesChannelId = rulesChannelId || undefined;
    if (afkChannelId !== undefined) server.afkChannelId = afkChannelId || undefined;
    if (afkTimeout !== undefined) server.afkTimeout = afkTimeout;
    if (verificationLevel !== undefined) server.verificationLevel = verificationLevel;
    if (explicitContentFilter !== undefined) server.explicitContentFilter = explicitContentFilter;

    // Age-gated servers cannot be partnered or discoverable
    if (isAgeGated !== undefined) {
      server.isAgeGated = isAgeGated;
      if (isAgeGated) {
        server.isPartnered = false;
        server.partneredAt = undefined;
        server.isDiscoverable = false;
        server.discoverableAt = undefined;
      }
    }

    // Keep extended settings document in sync with legacy fields
    server.settings = {
      ...(server.settings || {}),
      moderation: {
        ...(server.settings?.moderation || {}),
        verificationLevel: verificationLevel ?? server.settings?.moderation?.verificationLevel ?? server.verificationLevel,
        explicitContentFilter: explicitContentFilter ?? server.settings?.moderation?.explicitContentFilter ?? server.explicitContentFilter,
      },
      widget: {
        enabled: server.settings?.widget?.enabled ?? true,
        channelId: server.settings?.widget?.channelId ?? null,
      },
      safety: {
        raidProtection: server.settings?.safety?.raidProtection ?? false,
        antiSpam: server.settings?.safety?.antiSpam ?? true,
        mentionSpamLimit: server.settings?.safety?.mentionSpamLimit ?? 5,
      },
      integrations: {
        discord: server.settings?.integrations?.discord ?? false,
        twitch: server.settings?.integrations?.twitch ?? false,
        youtube: server.settings?.integrations?.youtube ?? false,
        webhooks: server.settings?.integrations?.webhooks ?? false,
      },
      soundboard: {
        enabled: server.settings?.soundboard?.enabled ?? true,
        volume: server.settings?.soundboard?.volume ?? 100,
      },
    } as any;

    await server.save();

    // Invalidate cache
    await cache.del(`server:${server._id}`);

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

    if (!server.ownerId.equals(user._id)) {
      set.status = 403;
      return { error: 'Only the server owner can delete the server' };
    }

    // Delete all related data
    await Promise.all([
      Channel.deleteMany({ serverId: server._id }),
      Role.deleteMany({ serverId: server._id }),
      ServerMember.deleteMany({ serverId: server._id }),
      Invite.deleteMany({ serverId: server._id }),
    ]);

    await server.deleteOne();

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
      userId: user._id,
    });

    if (!membership) {
      set.status = 403;
      return { error: 'You are not a member of this server' };
    }

    const limit = Math.min(parseInt(query.limit || '50'), 1000);
    const after = query.after;

    const filter: Record<string, unknown> = { serverId: params.serverId };
    if (after) {
      filter._id = { $gt: after };
    }

    const [server, members] = await Promise.all([
      Server.findById(params.serverId).select('ownerId'),
      ServerMember.find(filter)
        .limit(limit)
        .populate('userId', 'username displayName avatar status customStatus isPremium presenceLastHeartbeatAt customization')
        .populate('roles', 'name color position permissions hoist mentionable managed isDefault'),
    ]);

    return {
      members: members.map((member) =>
        normalizeMemberDto(member as unknown as {
          _id: Types.ObjectId;
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

    if (!(await canManageRoles(server, user._id))) {
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
    const requestedWithEveryone = Array.from(new Set([everyoneRole._id.toString(), ...requestedRoleIds]));

    const validRoles = await Role.find({
      serverId: params.serverId,
      _id: { $in: requestedWithEveryone.map((id) => new Types.ObjectId(id)) },
    }).select('_id');

    if (validRoles.length !== requestedWithEveryone.length) {
      set.status = 400;
      return { error: 'One or more provided role IDs are invalid for this server' };
    }

    member.roles = requestedWithEveryone.map((id) => new Types.ObjectId(id));
    await member.save();

    const populatedMember = await ServerMember.findById(member._id)
      .populate('userId', 'username displayName avatar status customStatus isPremium presenceLastHeartbeatAt customization')
      .populate('roles', 'name color position permissions hoist mentionable managed isDefault');

    if (!populatedMember) {
      set.status = 404;
      return { error: 'Member not found' };
    }

    return {
      member: normalizeMemberDto(populatedMember as unknown as {
        _id: Types.ObjectId;
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
      userId: user._id,
    });
    if (!membership) {
      set.status = 403;
      return { error: 'You are not a member of this server' };
    }

    const member = await ServerMember.findOne({
      serverId: params.serverId,
      userId: params.memberUserId,
    })
      .populate('userId', 'username displayName avatar status customStatus isPremium badges bio banner presenceLastHeartbeatAt customization')
      .populate('roles', 'name color position permissions hoist mentionable managed isDefault');

    if (!member) {
      set.status = 404;
      return { error: 'Member not found' };
    }

    const server = await Server.findById(params.serverId).select('ownerId');

    const normalized = normalizeMemberDto(member as unknown as {
      _id: Types.ObjectId;
      userId?: PopulatedMemberUser | null;
      roles?: PopulatedRole[];
      joinedAt?: Date;
      nickname?: string | null;
      avatar?: string | null;
      banner?: string | null;
    });

    const userData = member.userId as unknown as { bio?: string; banner?: string; badges?: string[] } | null;

    return {
      ...normalized,
      nickname: member.nickname || null,
      avatarOverride: member.avatar || null,
      bio: userData?.bio || null,
      banner: member.banner || userData?.banner || null,
      badges: userData?.badges || [],
      isOwner: server ? server.ownerId.equals(member.userId as unknown as Types.ObjectId) : false,
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
      userId: user._id,
    });

    if (!member) {
      set.status = 404;
      return { error: 'You are not a member of this server' };
    }

    const { nickname, avatar, banner } = body;

    if (nickname !== undefined) {
      member.nickname = nickname ? sanitizeInput(nickname) : undefined;
    }
    if (avatar !== undefined) {
      member.avatar = avatar || undefined;
    }
    if (banner !== undefined) {
      member.banner = banner || undefined;
    }

    await member.save();

    return {
      success: true,
      member: {
        nickname: member.nickname || null,
        avatar: member.avatar || null,
        banner: member.banner || null,
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

    if (server.ownerId.equals(user._id)) {
      set.status = 400;
      return { error: 'Server owner cannot leave. Transfer ownership first or delete the server.' };
    }

    await ServerMember.deleteOne({
      serverId: params.serverId,
      userId: user._id,
    });

    // Update member count
    server.memberCount = Math.max(0, server.memberCount - 1);
    await server.save();

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

    const server = await Server.findById(params.serverId).select('ownerId');
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    const isOwner = server.ownerId.equals(user._id);
    if (isOwner) {
      // Owner implicitly has every permission.
      return { isOwner: true, permissions: (~0n & ((1n << 48n) - 1n)).toString() };
    }

    const member = await ServerMember.findOne({ serverId: server._id, userId: user._id })
      .populate('roles', 'permissions');
    if (!member) {
      set.status = 403;
      return { error: 'Not a member of this server' };
    }

    const roles = member.roles as unknown as { permissions: string }[];
    let effective = 0n;
    for (const role of roles) {
      effective |= BigInt(role.permissions || '0');
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
      userId: user._id,
    });

    if (!membership) {
      set.status = 403;
      return { error: 'You are not a member of this server' };
    }

    // Rate limit
    const ip = getClientIP(request);
    const rateLimit = await checkRateLimit('invite', `${user._id}:${ip}`);
    if (!rateLimit.success) {
      set.status = 429;
      return { error: 'Invite creation rate limited', retryAfter: rateLimit.retryAfter };
    }

    // Get default channel
    const channel = await Channel.findOne({
      serverId: params.serverId,
      type: { $in: ['text', 'announcement'] },
    }).sort({ position: 1 });

    if (!channel) {
      set.status = 400;
      return { error: 'No valid channel for invite' };
    }

    const { maxUses = 0, maxAge = 86400, temporary = false } = body;

    const invite = new Invite({
      code: nanoid(8),
      serverId: params.serverId,
      channelId: channel._id,
      inviterId: user._id,
      maxUses,
      maxAge,
      temporary,
      expiresAt: maxAge > 0 ? new Date(Date.now() + maxAge * 1000) : null,
    });

    await invite.save();

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
      userId: user._id,
    });

    if (!membership) {
      set.status = 403;
      return { error: 'You are not a member of this server' };
    }

    const channels = await Channel.find({ serverId: params.serverId }).sort({ position: 1 });
    // Transform _id to id for frontend compatibility
    return channels.map(ch => ({
      id: ch._id.toString(),
      name: ch.name,
      type: ch.type,
      serverId: ch.serverId?.toString(),
      position: ch.position,
      parentId: ch.parentId?.toString() || null,
      topic: ch.topic,
      nsfw: ch.nsfw,
      rateLimitPerUser: ch.rateLimitPerUser,
      lastMessageId: ch.lastMessageId?.toString() || null,
      permissionOverwrites: (ch.permissionOverwrites || []).map((o: { id: any; type: string; allow: string; deny: string }) => ({
        id: o.id.toString(),
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
      userId: user._id,
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

    if (!(await canManageRoles(server, user._id))) {
      set.status = 403;
      return { error: 'You need Manage Roles permission to create roles' };
    }

    // Get highest position
    const highestRole = await Role.findOne({ serverId: params.serverId }).sort({ position: -1 });
    const newPosition = (highestRole?.position || 0) + 1;

    const role = new Role({
      serverId: params.serverId,
      name: body.name || 'new role',
      color: parseHexColorToNumber(body.color),
      position: newPosition,
      permissions: body.permissions || DEFAULT_PERMISSIONS.everyone,
      hoist: body.hoist || false,
      mentionable: body.mentionable || false,
    });

    await role.save();

    const roles = await getNormalizedRoles(params.serverId);
    const createdRole = roles.find((item) => item.id === role._id.toString());

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

    if (!(await canManageRoles(server, user._id))) {
      set.status = 403;
      return { error: 'You need Manage Roles permission to edit roles' };
    }

    const role = await Role.findOne({ _id: params.roleId, serverId: params.serverId });
    if (!role) {
      set.status = 404;
      return { error: 'Role not found' };
    }

    // Cannot edit @everyone name
    if (role.isDefault && body.name && body.name !== '@everyone') {
      set.status = 400;
      return { error: 'Cannot rename the @everyone role' };
    }

    if (body.name !== undefined) role.name = body.name;
    if (body.color !== undefined) role.color = parseHexColorToNumber(body.color);
    if (body.permissions !== undefined) role.permissions = body.permissions;
    if (body.hoist !== undefined) role.hoist = body.hoist;
    if (body.mentionable !== undefined) role.mentionable = body.mentionable;

    await role.save();

    const roles = await getNormalizedRoles(params.serverId);
    const updatedRole = roles.find((item) => item.id === role._id.toString());
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

    if (!(await canManageRoles(server, user._id))) {
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
    }).select('_id position');

    if (reorderableRoles.length !== uniqueRoleIds.length) {
      set.status = 400;
      return { error: 'orderedRoleIds must include every non-default role exactly once' };
    }

    const existingIds = new Set(reorderableRoles.map((role) => role._id.toString()));
    if (!uniqueRoleIds.every((roleId) => existingIds.has(roleId))) {
      set.status = 400;
      return { error: 'orderedRoleIds contains role IDs that do not belong to this server' };
    }

    const highestPosition = uniqueRoleIds.length;
    await Promise.all(
      uniqueRoleIds.map((roleId, index) =>
        Role.updateOne(
          { _id: roleId, serverId: params.serverId, isDefault: false },
          { $set: { position: highestPosition - index } }
        )
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

    if (!(await canManageRoles(server, user._id))) {
      set.status = 403;
      return { error: 'You need Manage Roles permission to delete roles' };
    }

    const role = await Role.findOne({ _id: params.roleId, serverId: params.serverId });
    if (!role) {
      set.status = 404;
      return { error: 'Role not found' };
    }

    if (role.isDefault) {
      set.status = 400;
      return { error: 'Cannot delete the @everyone role' };
    }

    // Remove role from all members
    await ServerMember.updateMany(
      { serverId: params.serverId },
      { $pull: { roles: params.roleId } }
    );

    await role.deleteOne();

    const roles = await getNormalizedRoles(params.serverId);
    return { success: true, roles };
  }, {
    params: t.Object({
      serverId: t.String(),
      roleId: t.String(),
    }),
  })
  // Get server widget data (public endpoint)
  .get('/:serverId/widget', async ({ params, set }) => {
    if (!isValidObjectId(params.serverId)) {
      set.status = 400;
      return { error: 'Invalid server ID' };
    }

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    if (server.settings?.widget?.enabled === false) {
      set.status = 403;
      return { error: 'Server widget is disabled' };
    }
    
    // Get online members
    const members = await ServerMember.find({ serverId: params.serverId })
      .populate('userId', 'username displayName avatar status presenceLastHeartbeatAt')
      .limit(50);
    
    // Get channels
    const channels = await Channel.find({ serverId: params.serverId, type: { $in: ['text', 'voice'] } })
      .select('name type')
      .limit(10);

    const widgetChannelId = server.settings?.widget?.channelId?.toString();
    const messageChannelId = widgetChannelId || channels.find(c => c.type === 'text')?._id?.toString();

    let recentMessages: Array<{
      id: string;
      content: string;
      author: { id: string; username: string; displayName?: string; avatar?: string };
      createdAt: Date;
    }> = [];
    if (messageChannelId) {
      const rawMessages = await Message.find({ channelId: messageChannelId, isDeleted: false })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('authorId', 'username displayName avatar')
        .lean();
      const decrypted = await Promise.all(
        rawMessages.map(async (msg) => {
          const author = (msg.authorId as unknown as { _id: Types.ObjectId; username: string; displayName?: string; avatar?: string }) || {};
          return {
            id: (msg._id as Types.ObjectId).toString(),
            content: await decryptFromStorage(msg.content || ''),
            author: {
              id: author._id?.toString() || '',
              username: author.username || '',
              displayName: author.displayName,
              avatar: author.avatar,
            },
            createdAt: msg.createdAt as Date,
          };
        })
      );
      recentMessages = decrypted.reverse();
    }

    // Get an active invite
    const invite = await Invite.findOne({
      serverId: params.serverId,
      $or: [
        { expiresAt: { $gt: new Date() } },
        { expiresAt: null }
      ]
    }).sort({ createdAt: -1 });

    const transformedMembers = members.map(m => {
      const userData = m.userId as unknown as PopulatedMemberUser;
      return {
        id: userData._id.toString(),
        username: userData.username,
        displayName: userData.displayName,
        avatar: userData.avatar,
        status: resolveEffectiveStatus({
          status: userData.status || 'offline',
          presenceLastHeartbeatAt: userData.presenceLastHeartbeatAt || null,
        }),
      };
    });

    const onlineCount = transformedMembers.filter(m => m.status !== 'offline').length;

    return {
      id: server._id.toString(),
      name: server.name,
      icon: server.icon,
      isPartnered: server.isPartnered,
      memberCount: server.memberCount || members.length,
      onlineCount,
      inviteCode: invite?.code,
      channels: channels.map(c => ({
        id: c._id.toString(),
        name: c.name,
        type: c.type,
        isWidgetChannel: widgetChannelId ? c._id.toString() === widgetChannelId : false,
      })),
      members: transformedMembers,
      recentMessages,
    };
  }, {
    params: t.Object({
      serverId: t.String(),
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
      userId: user._id,
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
    if (!server.ownerId.equals(user._id)) {
      set.status = 403;
      return { error: 'Only the server owner can upload emojis' };
    }

    // Check emoji limit (50 for non-premium, 100 for premium)
    const emojiCount = await ServerEmoji.countDocuments({ serverId: params.serverId });
    const maxEmojis = server.premiumTier >= 1 ? 100 : 50;
    if (emojiCount >= maxEmojis) {
      set.status = 400;
      return { error: `You can only have ${maxEmojis} custom emojis` };
    }

    const emoji = new ServerEmoji({
      serverId: params.serverId,
      name: sanitizeInput(body.name),
      imageUrl: body.imageUrl,
      animated: body.animated || false,
      uploadedBy: user._id,
    });

    await emoji.save();

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

    if (!server.ownerId.equals(user._id)) {
      set.status = 403;
      return { error: 'Only the server owner can delete emojis' };
    }

    const emoji = await ServerEmoji.findOne({ _id: params.emojiId, serverId: params.serverId });
    if (!emoji) {
      set.status = 404;
      return { error: 'Emoji not found' };
    }

    await emoji.deleteOne();

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
      userId: user._id,
    });

    if (!membership) {
      set.status = 403;
      return { error: 'You are not a member of this server' };
    }

    const stickers = await ServerSticker.find({ serverId: params.serverId, available: true }).sort({ createdAt: -1 });
    return { stickers };
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

    if (!server.ownerId.equals(user._id)) {
      set.status = 403;
      return { error: 'Only the server owner can upload stickers' };
    }

    const stickerCount = await ServerSticker.countDocuments({ serverId: params.serverId });
    const maxStickers = server.premiumTier >= 1 ? 30 : 15;
    if (stickerCount >= maxStickers) {
      set.status = 400;
      return { error: `Sticker limit reached (${maxStickers})` };
    }

    const sticker = new ServerSticker({
      serverId: params.serverId,
      name: sanitizeInput(body.name),
      description: body.description ? sanitizeInput(body.description) : undefined,
      imageUrl: body.imageUrl,
      tags: body.tags || [],
      uploadedBy: user._id,
    });
    await sticker.save();

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

    if (!server.ownerId.equals(user._id)) {
      set.status = 403;
      return { error: 'Only the server owner can delete stickers' };
    }

    await ServerSticker.deleteOne({ _id: params.stickerId, serverId: params.serverId });
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
      userId: user._id,
    });

    if (!membership) {
      set.status = 403;
      return { error: 'You are not a member of this server' };
    }

    const server = await Server.findById(params.serverId).select('soundboardSounds');
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

    if (!server.ownerId.equals(user._id)) {
      set.status = 403;
      return { error: 'Only the server owner can add soundboard sounds' };
    }

    const { name, url, emoji } = body as { name: string; url: string; emoji?: string };

    if (!name || !url) {
      set.status = 400;
      return { error: 'Name and URL are required' };
    }

    if (server.soundboardSounds.length >= 20) {
      set.status = 400;
      return { error: 'Maximum of 20 soundboard sounds reached' };
    }

    server.soundboardSounds.push({
      name: name.substring(0, 32),
      url,
      emoji: emoji || '🔊',
      uploadedBy: user._id,
    });

    await server.save();

    return {
      sound: server.soundboardSounds[server.soundboardSounds.length - 1],
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

    if (!server.ownerId.equals(user._id)) {
      set.status = 403;
      return { error: 'Only the server owner can delete soundboard sounds' };
    }

    const idx = server.soundboardSounds.findIndex(
      (s: any) => s._id.toString() === params.soundId
    );
    if (idx === -1) {
      set.status = 404;
      return { error: 'Sound not found' };
    }

    server.soundboardSounds.splice(idx, 1);
    await server.save();

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

    const server = await Server.findById(params.serverId)
      .select('ownerId isPartnered vanityUrlCode vanityUrlUses');
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    if (!server.ownerId.equals(user._id) && !(await canManageRoles(server, user._id))) {
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

    if (!server.ownerId.equals(user._id) && !(await canManageRoles(server, user._id))) {
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
      server.vanityUrlCode = undefined;
      await server.save();
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
    const [vanityTaken, inviteTaken] = await Promise.all([
      Server.exists({ vanityUrlCode: code, _id: { $ne: server._id } }),
      Invite.exists({ code }),
    ]);
    if (vanityTaken || inviteTaken) {
      set.status = 409;
      return { error: 'That link is already in use' };
    }

    server.vanityUrlCode = code;
    server.vanityUrlUses = 0;
    await server.save();

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
    if (!server.ownerId.equals(user._id)) {
      set.status = 403;
      return { error: 'You do not have permission to view invites' };
    }

    const invites = await Invite.find({ serverId: params.serverId })
      .populate('inviterId', 'username displayName avatar')
      .populate('channelId', 'name type')
      .sort({ createdAt: -1 });

    // Transform invites to include channel data
    const transformedInvites = invites.map(invite => ({
      code: invite.code,
      uses: invite.uses,
      maxUses: invite.maxUses,
      expiresAt: invite.expiresAt,
      createdAt: invite.createdAt,
      channel: invite.channelId ? {
        id: (invite.channelId as any)._id?.toString() || invite.channelId.toString(),
        name: (invite.channelId as any).name || 'unknown',
        type: (invite.channelId as any).type || 'text',
      } : null,
      createdBy: invite.inviterId ? {
        id: (invite.inviterId as any)._id?.toString() || invite.inviterId.toString(),
        username: (invite.inviterId as any).username || 'Unknown',
        displayName: (invite.inviterId as any).displayName,
        avatar: (invite.inviterId as any).avatar,
      } : null,
    }));

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
    if (!server.ownerId.equals(user._id)) {
      set.status = 403;
      return { error: 'You do not have permission to delete invites' };
    }

    await Invite.deleteOne({ code: params.code, serverId: params.serverId });
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
    if (!server.ownerId.equals(user._id)) {
      set.status = 403;
      return { error: 'You do not have permission to view bans' };
    }

    const bans = await ServerBan.find({ serverId: params.serverId })
      .populate('userId', 'username displayName avatar')
      .populate('bannedBy', 'username displayName')
      .sort({ createdAt: -1 });

    return {
      bans: bans.map((ban: any) => ({
        id: ban.userId?._id?.toString() || ban.userId?.toString(),
        username: ban.userId?.displayName || ban.userId?.username || 'Unknown',
        avatar: ban.userId?.avatar,
        reason: ban.reason,
        bannedAt: ban.createdAt,
        bannedBy: {
          id: ban.bannedBy?._id?.toString() || ban.bannedBy?.toString(),
          username: ban.bannedBy?.displayName || ban.bannedBy?.username || 'Unknown',
        },
      })),
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

    if (!server.ownerId.equals(user._id)) {
      set.status = 403;
      return { error: 'You do not have permission to ban users' };
    }

    if (server.ownerId.toString() === params.userId) {
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

    await ServerBan.findOneAndUpdate(
      { serverId: params.serverId, userId: params.userId },
      {
        $set: {
          bannedBy: user._id,
          reason: body.reason || null,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await ServerMember.deleteOne({ serverId: params.serverId, userId: params.userId });
    await Server.updateOne({ _id: params.serverId }, { $inc: { memberCount: -1 } });

    await AdminLog.create({
      adminId: user._id,
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
    if (!server.ownerId.equals(user._id)) {
      set.status = 403;
      return { error: 'You do not have permission to unban users' };
    }

    await ServerBan.deleteOne({ serverId: params.serverId, userId: params.userId });

    await AdminLog.create({
      adminId: user._id,
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

    if (!server.ownerId.equals(user._id)) {
      set.status = 403;
      return { error: 'You do not have permission to view audit log' };
    }

    const logs = await AdminLog.find({ targetType: 'server', targetId: params.serverId })
      .populate('adminId', 'username displayName avatar')
      .sort({ createdAt: -1 })
      .limit(100);

    return {
      logs: logs.map((log: any) => ({
        id: log._id.toString(),
        action: log.action,
        reason: log.reason,
        details: log.details,
        createdAt: log.createdAt,
        admin: {
          id: log.adminId?._id?.toString(),
          username: log.adminId?.displayName || log.adminId?.username || 'Unknown',
          avatar: log.adminId?.avatar,
        },
      })),
    };
  }, {
    params: t.Object({
      serverId: t.String(),
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

    // Check if server is discoverable/public (for now, only allow official servers)
    if (!server.isOfficial && !server.isVerified) {
      set.status = 403;
      return { error: 'This server is not discoverable. You need an invite to join.' };
    }

    // Check if already a member
    const existingMembership = await ServerMember.findOne({
      serverId: server._id,
      userId: user._id,
    });

    if (existingMembership) {
      set.status = 400;
      return { error: 'Already a member of this server' };
    }

    // Check server limit
    const serverCount = await ServerMember.countDocuments({ userId: user._id });
    if (serverCount >= config.MAX_SERVERS_PER_USER) {
      set.status = 400;
      return { error: `You can only be in ${config.MAX_SERVERS_PER_USER} servers` };
    }

    // Get @everyone role
    const everyoneRole = await Role.findOne({
      serverId: server._id,
      isDefault: true,
    });

    // Create membership
    const membership = new ServerMember({
      serverId: server._id,
      userId: user._id,
      roles: everyoneRole ? [everyoneRole._id] : [],
    });

    await membership.save();

    // Update server member count
    server.memberCount += 1;
    await server.save();

    return {
      success: true,
      server: {
        id: server._id,
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
      const servers = await Server.find({ isPartnered: true })
        .select('name icon description memberCount vanityUrlCode')
        .sort({ partneredAt: 1 })
        .limit(20)
        .lean();

      return {
        servers: servers.map((s: any) => ({
          id: s._id.toString(),
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
      const filter: Record<string, any> = { isDiscoverable: true };
      if (query.category && query.category !== 'all') {
        filter.discoveryCategories = query.category;
      }
      if (query.search) {
        filter.$or = [
          { name: { $regex: query.search, $options: 'i' } },
          { description: { $regex: query.search, $options: 'i' } },
        ];
      }

      const servers = await Server.find(filter)
        .select('name icon banner description memberCount onlineCount isPartnered discoveryCategories vanityUrlCode')
        .sort({ memberCount: -1 })
        .limit(50)
        .lean();

      return {
        servers: servers.map((s: any) => ({
          id: s._id.toString(),
          name: s.name,
          icon: s.icon ?? null,
          banner: s.banner ?? null,
          description: s.description ?? s.discoveryDescription ?? null,
          memberCount: s.memberCount ?? 0,
          onlineCount: s.onlineCount ?? 0,
          isPartnered: s.isPartnered ?? false,
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
  | { kind: 'invite'; invite: InstanceType<typeof Invite>; serverId: Types.ObjectId }
  | { kind: 'vanity'; server: InstanceType<typeof Server>; serverId: Types.ObjectId }
  | null
> {
  const invite = await Invite.findOne({ code });
  if (invite) {
    if (invite.expiresAt && invite.expiresAt.getTime() <= Date.now()) return null;
    return { kind: 'invite', invite, serverId: invite.serverId };
  }

  const vanityServer = await Server.findOne({ vanityUrlCode: code.toLowerCase() });
  if (vanityServer) {
    return { kind: 'vanity', server: vanityServer, serverId: vanityServer._id };
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

    const server = await Server.findById(resolved.serverId)
      .select('name icon banner description memberCount onlineCount isPartnered');

    if (!server) {
      set.status = 404;
      return { error: 'Invite not found or expired' };
    }

    return {
      code: params.code,
      server: {
        _id: server._id,
        name: server.name,
        icon: server.icon,
        banner: server.banner,
        description: server.description,
        memberCount: server.memberCount,
        onlineCount: server.onlineCount,
        isPartnered: server.isPartnered,
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

    const isBanned = await ServerBan.exists({ serverId: resolved.serverId, userId: user._id });
    if (isBanned) {
      set.status = 403;
      return { error: 'You are banned from this server' };
    }

    // Check if already a member
    const existingMembership = await ServerMember.findOne({
      serverId: resolved.serverId,
      userId: user._id,
    });

    if (existingMembership) {
      set.status = 400;
      return { error: 'Already a member of this server' };
    }

    // Check server limit
    const serverCount = await ServerMember.countDocuments({ userId: user._id });
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
    const membership = new ServerMember({
      serverId: resolved.serverId,
      userId: user._id,
      roles: everyoneRole ? [everyoneRole._id] : [],
    });

    await membership.save();

    // Track uses on the invite doc, or on the server for vanity joins
    if (invite) {
      invite.uses += 1;
      await invite.save();
    } else {
      await Server.updateOne(
        { _id: resolved.serverId },
        { $inc: { vanityUrlUses: 1 } }
      );
    }

    // Update server member count
    await Server.updateOne(
      { _id: resolved.serverId },
      { $inc: { memberCount: 1 } }
    );

    const server = await Server.findById(resolved.serverId);

    return {
      success: true,
      server: {
        id: server?._id,
        name: server?.name,
        icon: server?.icon,
      },
    };
  }, {
    params: t.Object({
      code: t.String(),
    }),
  });
