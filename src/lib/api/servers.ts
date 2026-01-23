import { Elysia, t } from 'elysia';
import { Server, Channel, Role, ServerMember, Invite } from '@/lib/models';
import { authenticateRequest } from '@/lib/services/auth';
import { checkRateLimit, getClientIP, sanitizeInput, isValidObjectId } from '@/lib/security';
import { cache } from '@/lib/db';
import { nanoid } from 'nanoid';
import { config } from '@/lib/config';

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

export const serverRoutes = new Elysia({ prefix: '/servers' })
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
        select: 'name icon banner ownerId memberCount onlineCount features premiumTier',
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

    // Check if owner or has manage channels permission
    if (!server.ownerId.equals(user._id)) {
      set.status = 403;
      return { error: 'You do not have permission to create channels' };
    }

    const { name, type = 'text', parentId } = body;
    const sanitizedName = sanitizeInput(name);

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

    const { name, description, icon, banner } = body;

    if (name !== undefined) server.name = sanitizeInput(name);
    if (description !== undefined) server.description = sanitizeInput(description);
    if (icon !== undefined) server.icon = icon;
    if (banner !== undefined) server.banner = banner;

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

    const members = await ServerMember.find(filter)
      .limit(limit)
      .populate('userId', 'username displayName avatar status customStatus isPremium')
      .populate('roles', 'name color position');

    return { members };
  }, {
    params: t.Object({
      serverId: t.String(),
    }),
    query: t.Object({
      limit: t.Optional(t.String()),
      after: t.Optional(t.String()),
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
    return channels;
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

    const roles = await Role.find({ serverId: params.serverId }).sort({ position: -1 });
    return { roles };
  }, {
    params: t.Object({
      serverId: t.String(),
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
      .sort({ createdAt: -1 });

    return { invites };
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

    // TODO: Implement ban model, for now return empty
    return { bans: [] };
  }, {
    params: t.Object({
      serverId: t.String(),
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

    // TODO: Implement ban removal
    return { success: true };
  }, {
    params: t.Object({
      serverId: t.String(),
      userId: t.String(),
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

// Invite routes
export const inviteRoutes = new Elysia({ prefix: '/invites' })
  // Get invite info
  .get('/:code', async ({ params, set }) => {
    const invite = await Invite.findOne({ code: params.code })
      .populate('serverId', 'name icon memberCount onlineCount');

    if (!invite) {
      set.status = 404;
      return { error: 'Invite not found or expired' };
    }

    return {
      code: invite.code,
      server: invite.serverId,
      expiresAt: invite.expiresAt,
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

    const invite = await Invite.findOne({ code: params.code });

    if (!invite) {
      set.status = 404;
      return { error: 'Invite not found or expired' };
    }

    // Check if already a member
    const existingMembership = await ServerMember.findOne({
      serverId: invite.serverId,
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
    if (invite.maxUses > 0 && invite.uses >= invite.maxUses) {
      set.status = 400;
      return { error: 'Invite has reached maximum uses' };
    }

    // Get @everyone role
    const everyoneRole = await Role.findOne({
      serverId: invite.serverId,
      isDefault: true,
    });

    // Create membership
    const membership = new ServerMember({
      serverId: invite.serverId,
      userId: user._id,
      roles: everyoneRole ? [everyoneRole._id] : [],
    });

    await membership.save();

    // Update invite uses
    invite.uses += 1;
    await invite.save();

    // Update server member count
    await Server.updateOne(
      { _id: invite.serverId },
      { $inc: { memberCount: 1 } }
    );

    const server = await Server.findById(invite.serverId);

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
