import { Elysia, t } from 'elysia';
import { User } from '@/lib/models/User';
import { Server } from '@/lib/models/Server';
import { Message } from '@/lib/models/Message';
import { AdminLog, type AdminActionType, type IAdminLog } from '@/lib/models/AdminLog';
import { PlatformSettings, getPlatformSettings, updatePlatformSettings } from '@/lib/models/PlatformSettings';
import type { Types } from 'mongoose';

// System user ID for Serika Broadcast
export const SERIKA_BROADCAST_ID = '000000000000000000000000';

// Helper function for admin auth
async function getAdminAuth(headers: Record<string, string | undefined>, cookie: Record<string, { value?: unknown }>) {
  // Import getAuth from index to avoid circular dependency
  const { authenticateRequest } = await import('@/lib/services/auth');
  const authHeader = headers.authorization ?? null;
  const authToken = cookie.auth_token?.value;
  const cookies: Record<string, string> = {};
  if (typeof authToken === 'string') {
    cookies.auth_token = authToken;
  }
  const { user, error } = await authenticateRequest(authHeader, cookies);
  
  if (!user) {
    return { user: null, error: error || 'Unauthorized', isAdmin: false };
  }
  
  // Check if user is staff with admin permissions
  const isAdmin = user.isStaff && (user.staffRole === 'admin' || user.badges?.includes('admin') || user.badges?.includes('staff'));
  
  return { user, error: null, isAdmin };
}

// Log admin action
async function logAdminAction(
  adminId: string, 
  action: AdminActionType, 
  targetType: 'user' | 'server' | 'message' | 'platform',
  targetId: string,
  details?: Record<string, unknown>,
  reason?: string
) {
  try {
    await AdminLog.create({
      adminId,
      action,
      targetType,
      targetId,
      details,
      reason,
    });
  } catch (error) {
    console.error('Failed to log admin action:', error);
  }
}

export const adminRoutes = new Elysia({ prefix: '/admin' })
  // ==================== USER MANAGEMENT ====================
  
  // Search users
  .get('/users/search', async ({ headers, cookie, query, set }) => {
    const { user, error, isAdmin } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = 403;
      return { error: error || 'Admin access required' };
    }

    const { q, page = '1', limit = '20' } = query as { q?: string; page?: string; limit?: string };
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const searchQuery = q ? {
      $or: [
        { username: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } },
        { displayName: { $regex: q, $options: 'i' } },
      ]
    } : {};

    const [users, total] = await Promise.all([
      User.find(searchQuery)
        .select('_id username displayName email avatar badges isVerified isBanned isStaff createdAt')
        .skip(skip)
        .limit(limitNum)
        .sort({ createdAt: -1 }),
      User.countDocuments(searchQuery)
    ]);

    return {
      users: users.map(u => ({
        id: u._id,
        username: u.username,
        displayName: u.displayName,
        email: u.email,
        avatar: u.avatar,
        badges: u.badges,
        isVerified: u.isVerified,
        isBanned: u.isBanned,
        isStaff: u.isStaff,
        createdAt: u.createdAt,
      })),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      }
    };
  })

  // Get user details
  .get('/users/:userId', async ({ headers, cookie, params, set }) => {
    const { user, error, isAdmin } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = 403;
      return { error: error || 'Admin access required' };
    }

    const targetUser = await User.findById(params.userId)
      .select('-passwordHash -verificationToken -resetToken');
    
    if (!targetUser) {
      set.status = 404;
      return { error: 'User not found' };
    }

    // Get server count
    const serverCount = await Server.countDocuments({ 
      $or: [
        { ownerId: targetUser._id },
        { 'members.userId': targetUser._id }
      ]
    });

    // Get message count
    const messageCount = await Message.countDocuments({ authorId: targetUser._id });

    return {
      id: targetUser._id,
      username: targetUser.username,
      displayName: targetUser.displayName,
      email: targetUser.email,
      avatar: targetUser.avatar,
      banner: targetUser.banner,
      bio: targetUser.bio,
      badges: targetUser.badges,
      isVerified: targetUser.isVerified,
      isBanned: targetUser.isBanned,
      banReason: targetUser.banReason,
      isStaff: targetUser.isStaff,
      staffRole: targetUser.staffRole,
      isPremium: targetUser.isPremium,
      premiumSince: targetUser.premiumSince,
      createdAt: targetUser.createdAt,
      stats: {
        servers: serverCount,
        messages: messageCount,
      }
    };
  }, {
    params: t.Object({
      userId: t.String(),
    }),
  })

  // Ban user
  .post('/users/:userId/ban', async ({ headers, cookie, params, body, set }) => {
    const { user, error, isAdmin } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = 403;
      return { error: error || 'Admin access required' };
    }

    const { reason } = body as { reason?: string };

    const targetUser = await User.findById(params.userId);
    if (!targetUser) {
      set.status = 404;
      return { error: 'User not found' };
    }

    // Can't ban staff
    if (targetUser.isStaff) {
      set.status = 400;
      return { error: 'Cannot ban staff members' };
    }

    targetUser.isBanned = true;
    targetUser.banReason = reason || 'No reason provided';
    await targetUser.save();

    await logAdminAction(
      user._id.toString(),
      'ban_user',
      'user',
      targetUser._id.toString(),
      { username: targetUser.username },
      reason
    );

    return { success: true, message: 'User banned' };
  }, {
    params: t.Object({
      userId: t.String(),
    }),
    body: t.Object({
      reason: t.Optional(t.String()),
    }),
  })

  // Unban user
  .post('/users/:userId/unban', async ({ headers, cookie, params, set }) => {
    const { user, error, isAdmin } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = 403;
      return { error: error || 'Admin access required' };
    }

    const targetUser = await User.findById(params.userId);
    if (!targetUser) {
      set.status = 404;
      return { error: 'User not found' };
    }

    targetUser.isBanned = false;
    targetUser.banReason = undefined;
    await targetUser.save();

    await logAdminAction(
      user._id.toString(),
      'unban_user',
      'user',
      targetUser._id.toString(),
      { username: targetUser.username }
    );

    return { success: true, message: 'User unbanned' };
  }, {
    params: t.Object({
      userId: t.String(),
    }),
  })

  // Update user badges
  .patch('/users/:userId/badges', async ({ headers, cookie, params, body, set }) => {
    const { user, error, isAdmin } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = 403;
      return { error: error || 'Admin access required' };
    }

    const { badges } = body as { badges: string[] };

    const targetUser = await User.findById(params.userId);
    if (!targetUser) {
      set.status = 404;
      return { error: 'User not found' };
    }

    const oldBadges = [...(targetUser.badges || [])];
    targetUser.badges = badges;
    await targetUser.save();

    await logAdminAction(
      user._id.toString(),
      'edit_badges',
      'user',
      targetUser._id.toString(),
      { oldBadges, newBadges: badges }
    );

    return { success: true, badges: targetUser.badges };
  }, {
    params: t.Object({
      userId: t.String(),
    }),
    body: t.Object({
      badges: t.Array(t.String()),
    }),
  })

  // ==================== SERVER MANAGEMENT ====================

  // Search servers
  .get('/servers/search', async ({ headers, cookie, query, set }) => {
    const { user, error, isAdmin } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = 403;
      return { error: error || 'Admin access required' };
    }

    const { q, page = '1', limit = '20' } = query as { q?: string; page?: string; limit?: string };
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const searchQuery = q ? {
      $or: [
        { name: { $regex: q, $options: 'i' } },
        { description: { $regex: q, $options: 'i' } },
      ]
    } : {};

    const [servers, total] = await Promise.all([
      Server.find(searchQuery)
        .populate('ownerId', 'username displayName')
        .skip(skip)
        .limit(limitNum)
        .sort({ createdAt: -1 }),
      Server.countDocuments(searchQuery)
    ]);

    return {
      servers: servers.map(s => ({
        id: s._id,
        name: s.name,
        description: s.description,
        icon: s.icon,
        memberCount: s.memberCount,
        owner: s.ownerId,
        isDiscoverable: s.isDiscoverable,
        isPartner: s.isPartner,
        createdAt: s.createdAt,
      })),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      }
    };
  })

  // Delete server
  .delete('/servers/:serverId', async ({ headers, cookie, params, body, set }) => {
    const { user, error, isAdmin } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = 403;
      return { error: error || 'Admin access required' };
    }

    const { reason } = body as { reason?: string };

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    await logAdminAction(
      user._id.toString(),
      'delete_server',
      'server',
      server._id.toString(),
      { name: server.name, ownerId: server.ownerId.toString() },
      reason
    );

    // Delete the server and associated data
    await Promise.all([
      Server.findByIdAndDelete(params.serverId),
      Message.deleteMany({ serverId: params.serverId }),
      // Channel deletion happens via Server cascade
    ]);

    return { success: true, message: 'Server deleted' };
  }, {
    params: t.Object({
      serverId: t.String(),
    }),
    body: t.Object({
      reason: t.Optional(t.String()),
    }),
  })

  // Toggle server partner status
  .post('/servers/:serverId/partner', async ({ headers, cookie, params, set }) => {
    const { user, error, isAdmin } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = 403;
      return { error: error || 'Admin access required' };
    }

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    server.isPartner = !server.isPartner;
    await server.save();

    await logAdminAction(
      user._id.toString(),
      server.isPartner ? 'grant_partner' : 'revoke_partner',
      'server',
      server._id.toString(),
      { name: server.name }
    );

    return { success: true, isPartner: server.isPartner };
  }, {
    params: t.Object({
      serverId: t.String(),
    }),
  })

  // Toggle server discoverability
  .post('/servers/:serverId/discovery', async ({ headers, cookie, params, set }) => {
    const { user, error, isAdmin } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = 403;
      return { error: error || 'Admin access required' };
    }

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    server.isDiscoverable = !server.isDiscoverable;
    await server.save();

    await logAdminAction(
      user._id.toString(),
      'toggle_discovery',
      'server',
      server._id.toString(),
      { name: server.name, isDiscoverable: server.isDiscoverable }
    );

    return { success: true, isDiscoverable: server.isDiscoverable };
  }, {
    params: t.Object({
      serverId: t.String(),
    }),
  })

  // Transfer server ownership
  .post('/servers/:serverId/transfer', async ({ headers, cookie, params, body, set }) => {
    const { user, error, isAdmin } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = 403;
      return { error: error || 'Admin access required' };
    }

    const { newOwnerId, reason } = body as { newOwnerId: string; reason?: string };

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    const newOwner = await User.findById(newOwnerId);
    if (!newOwner) {
      set.status = 404;
      return { error: 'New owner not found' };
    }

    const oldOwnerId = server.ownerId.toString();
    server.ownerId = newOwner._id;
    await server.save();

    await logAdminAction(
      user._id.toString(),
      'transfer_ownership',
      'server',
      server._id.toString(),
      { 
        name: server.name, 
        oldOwnerId, 
        newOwnerId: newOwner._id.toString(),
        newOwnerUsername: newOwner.username
      },
      reason
    );

    return { success: true, message: 'Ownership transferred' };
  }, {
    params: t.Object({
      serverId: t.String(),
    }),
    body: t.Object({
      newOwnerId: t.String(),
      reason: t.Optional(t.String()),
    }),
  })

  // ==================== PLATFORM SETTINGS ====================

  // Get platform settings
  .get('/settings', async ({ headers, cookie, set }) => {
    const { user, error, isAdmin } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = 403;
      return { error: error || 'Admin access required' };
    }

    const settings = await getPlatformSettings();
    return settings;
  })

  // Update platform settings
  .patch('/settings', async ({ headers, cookie, body, set }) => {
    const { user, error, isAdmin } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = 403;
      return { error: error || 'Admin access required' };
    }

    const { maintenanceMode, allowRegistration, globalAnnouncement } = body as {
      maintenanceMode?: boolean;
      allowRegistration?: boolean;
      globalAnnouncement?: string;
    };

    const updates: Record<string, unknown> = {};
    if (maintenanceMode !== undefined) updates.maintenanceMode = maintenanceMode;
    if (allowRegistration !== undefined) updates.allowRegistration = allowRegistration;
    if (globalAnnouncement !== undefined) {
      updates.globalAnnouncement = globalAnnouncement || null;
      updates.announcementUpdatedAt = new Date();
    }

    const settings = await updatePlatformSettings(updates);

    await logAdminAction(
      user._id.toString(),
      'update_settings',
      'platform',
      'settings',
      updates
    );

    return settings;
  }, {
    body: t.Object({
      maintenanceMode: t.Optional(t.Boolean()),
      allowRegistration: t.Optional(t.Boolean()),
      globalAnnouncement: t.Optional(t.String()),
    }),
  })

  // Publish global announcement
  .post('/broadcast', async ({ headers, cookie, body, set }) => {
    const { user, error, isAdmin } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = 403;
      return { error: error || 'Admin access required' };
    }

    const { message, sendDMs } = body as { message: string; sendDMs?: boolean };
    
    if (!message || message.trim().length === 0) {
      set.status = 400;
      return { error: 'Message is required' };
    }

    // Update platform announcement
    await updatePlatformSettings({
      globalAnnouncement: message.trim(),
      announcementUpdatedAt: new Date(),
    });

    // Send DMs from Serika Broadcast system user if requested
    let dmCount = 0;
    if (sendDMs) {
      try {
        const { SERIKA_BROADCAST_ID, ensureSerikaBroadcastUser } = await import('@/lib/services/serikaBroadcast');
        const { Channel } = await import('@/lib/models/Channel');
        const { Message } = await import('@/lib/models/Message');
        const { encryptForStorage } = await import('@/lib/security/encryption');
        
        await ensureSerikaBroadcastUser();
        
        // Get all users
        const allUsers = await User.find({ isSystem: { $ne: true } }).select('_id');
        
        // Send DM to each user (in batches)
        const batchSize = 50;
        for (let i = 0; i < allUsers.length; i += batchSize) {
          const batch = allUsers.slice(i, i + batchSize);
          
          await Promise.all(batch.map(async (targetUser) => {
            try {
              // Get or create DM channel with system user
              let channel = await Channel.findOne({
                type: 'dm',
                recipientIds: { $all: [SERIKA_BROADCAST_ID, targetUser._id] },
              });
              
              if (!channel) {
                channel = new Channel({
                  type: 'dm',
                  recipientIds: [SERIKA_BROADCAST_ID, targetUser._id],
                });
                await channel.save();
              }
              
              // Encrypt and send message
              const encryptedContent = await encryptForStorage(message.trim());
              const dmMessage = new Message({
                channelId: channel._id,
                authorId: SERIKA_BROADCAST_ID,
                content: encryptedContent,
                type: 'default',
              });
              await dmMessage.save();
              
              // Update channel
              channel.lastMessageId = dmMessage._id;
              channel.updatedAt = new Date();
              await channel.save();
              
              dmCount++;
            } catch (err) {
              console.error(`Failed to send DM to user ${targetUser._id}:`, err);
            }
          }));
        }
      } catch (err) {
        console.error('Failed to send broadcast DMs:', err);
      }
    }

    await logAdminAction(
      user._id.toString(),
      'broadcast_announcement',
      'platform',
      'broadcast',
      { message, dmsSent: dmCount }
    );

    return { success: true, message: 'Announcement published', dmsSent: dmCount };
  }, {
    body: t.Object({
      message: t.String(),
      sendDMs: t.Optional(t.Boolean()),
    }),
  })

  // ==================== ACTIVITY LOGS ====================

  // Get admin activity logs
  .get('/logs', async ({ headers, cookie, query, set }) => {
    const { user, error, isAdmin } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = 403;
      return { error: error || 'Admin access required' };
    }

    const { type, page = '1', limit = '50' } = query as { type?: string; page?: string; limit?: string };
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const filter: Record<string, unknown> = {};
    if (type) {
      if (type === 'bans') {
        filter.action = { $in: ['ban_user', 'unban_user'] };
      } else if (type === 'reports') {
        filter.action = { $in: ['resolve_report', 'dismiss_report'] };
      } else if (type === 'admin') {
        filter.action = { $in: ['update_settings', 'broadcast_announcement', 'grant_partner', 'revoke_partner'] };
      }
    }

    const [logs, total] = await Promise.all([
      AdminLog.find(filter)
        .populate('adminId', 'username displayName avatar')
        .skip(skip)
        .limit(limitNum)
        .sort({ createdAt: -1 }),
      AdminLog.countDocuments(filter)
    ]);

    return {
      logs: logs.map((log: IAdminLog) => ({
        id: log._id,
        admin: log.adminId,
        action: log.action,
        targetType: log.targetType,
        targetId: log.targetId,
        details: log.details,
        reason: log.reason,
        createdAt: log.createdAt,
      })),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      }
    };
  })

  // ==================== STATS ====================
  
  // Get platform stats
  .get('/stats', async ({ headers, cookie, set }) => {
    const { user, error, isAdmin } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = 403;
      return { error: error || 'Admin access required' };
    }

    const [userCount, serverCount, messageCount, bannedCount] = await Promise.all([
      User.countDocuments(),
      Server.countDocuments(),
      Message.countDocuments(),
      User.countDocuments({ isBanned: true }),
    ]);

    // Get today's new users
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const newUsersToday = await User.countDocuments({ createdAt: { $gte: today } });

    return {
      users: userCount,
      servers: serverCount,
      messages: messageCount,
      banned: bannedCount,
      newUsersToday,
    };
  });
