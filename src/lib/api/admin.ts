import { Elysia, t } from 'elysia';
import { User } from '@/lib/models/User';
import { Server } from '@/lib/models/Server';
import { ServerMember } from '@/lib/models/ServerMember';
import { Message } from '@/lib/models/Message';
import { AdminLog, type AdminActionType } from '@/lib/models/AdminLog';
import { getPlatformSettings, updatePlatformSettings } from '@/lib/models/PlatformSettings';
import { TtsSound } from '@/lib/models/TtsSound';
import { BugReport } from '@/lib/models/BugReport';
import { checkRateLimit } from '@/lib/security';

// System user ID for Serika Broadcast
export const SERIKA_BROADCAST_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Multi-layer admin auth verification:
 * 1. Authenticate the user (JWT/cookie)
 * 2. Re-fetch user from DB to ensure fresh staff status (not stale JWT)
 * 3. Verify user has admin or developer privileges (NOT moderator/staff)
 * 4. Rate-limit admin API access
 * 5. Log access attempts for audit trail
 */
async function getAdminAuth(
  headers: Record<string, string | undefined>,
  cookie: Record<string, { value?: unknown }>,
  request?: { url?: string }
) {
  const { authenticateRequest } = await import('@/lib/services/auth');
  const authHeader = headers.authorization ?? null;
  const authToken = cookie.auth_token?.value;
  const cookies: Record<string, string> = {};
  if (typeof authToken === 'string') {
    cookies.auth_token = authToken;
  }
  const { user, error } = await authenticateRequest(authHeader, cookies);

  if (!user) {
    return { user: null, error: error || 'Unauthorized', isAdmin: false, status: 401 as const };
  }

  // Layer 2: Re-fetch user from DB to ensure staff status is current
  const dbUser = await User.findById(user.id);
  if (!dbUser) {
    return { user: null, error: 'User not found', isAdmin: false, status: 401 as const };
  }

  // Layer 3: Check if user is banned
  if (dbUser.isBanned) {
    return { user: null, error: 'Account banned', isAdmin: false, status: 403 as const };
  }

  // Layer 4: Verify admin or developer privileges (NOT moderator/staff)
  const badges = (dbUser.badges || []) as string[];
  const isAdminRole = dbUser.isStaff && dbUser.staffRole === 'admin';
  const hasAdminBadge = badges.includes('admin');
  const hasDevBadge = badges.includes('serikacord_developer');
  const isAdmin = isAdminRole || hasAdminBadge || hasDevBadge;

  if (!isAdmin) {
    // Log unauthorized admin access attempt
    try {
      await AdminLog.create({
        adminId: dbUser.id,
        action: 'update_settings' as AdminActionType, // Reuse existing enum value for access denied
        targetType: 'platform',
        targetId: 'admin_panel',
        details: { denied: true, reason: 'insufficient_privileges', endpoint: request?.url },
      });
    } catch { /* best-effort */ }
    return { user: null, error: 'Admin access required', isAdmin: false, status: 403 as const };
  }

  // Layer 5: Rate-limit admin API calls (stricter than normal)
  const rateKey = `admin:${dbUser.id}`;
  const rateLimit = await checkRateLimit('admin', rateKey);
  if (!rateLimit.success) {
    return { user: null, error: 'Rate limited', isAdmin: false, status: 429 as const };
  }

  return { user: dbUser, error: null, isAdmin: true, status: 200 as const };
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
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }

    const { q, page = '1', limit = '20' } = query as { q?: string; page?: string; limit?: string };
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const allUsers = await User.find({});
    let filtered = allUsers.filter(u => !u.username?.startsWith('discord-'));
    if (q) {
      const lowerQ = q.toLowerCase();
      filtered = filtered.filter(u => 
        u.username?.toLowerCase().includes(lowerQ) ||
        u.email?.toLowerCase().includes(lowerQ) ||
        u.displayName?.toLowerCase().includes(lowerQ)
      );
    }
    filtered.sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
    const total = filtered.length;
    const users = filtered.slice(skip, skip + limitNum);

    return {
      users: users.map(u => ({
        id: u.id,
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
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }

    const targetUser = await User.findById(params.userId);
    
    if (!targetUser) {
      set.status = 404;
      return { error: 'User not found' };
    }

    // Get server count - owned servers + servers where user is a member
    const ownedServers = await Server.find({ ownerId: targetUser.id });
    const memberships = await ServerMember.find({ userId: targetUser.id });
    const serverCount = ownedServers.length + memberships.length;

    // Get message count
    const messages = await Message.find({ authorId: targetUser.id });
    const messageCount = messages.length;

    return {
      id: targetUser.id,
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
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
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

    await User.updateById(targetUser.id, {
      isBanned: true,
      banReason: reason || 'No reason provided',
    });

    // Notify the user, then immediately kill all of their sessions so they're
    // signed out on every device on their next request. Order matters: DM first
    // (while their session still resolves for delivery), then revoke.
    const { notifySuspension } = await import('@/lib/services/systemNotify');
    const { revokeAllUserSessions } = await import('@/lib/services/auth');
    await notifySuspension(targetUser.id, reason).catch(() => {});
    const revoked = await revokeAllUserSessions(targetUser.id).catch(() => 0);

    await logAdminAction(
      user.id,
      'ban_user',
      'user',
      targetUser.id,
      { username: targetUser.username, sessionsRevoked: revoked },
      reason
    );

    return { success: true, message: 'User banned', sessionsRevoked: revoked };
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
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }

    const targetUser = await User.findById(params.userId);
    if (!targetUser) {
      set.status = 404;
      return { error: 'User not found' };
    }

    await User.updateById(targetUser.id, {
      isBanned: false,
      banReason: null,
    });
    // Clear the cached (banned) user record so they can authenticate again.
    const { cache } = await import('@/lib/db');
    await cache.del(`user:${targetUser.id}`).catch(() => {});

    const { notifyUnsuspension } = await import('@/lib/services/systemNotify');
    await notifyUnsuspension(targetUser.id).catch(() => {});

    await logAdminAction(
      user.id,
      'unban_user',
      'user',
      targetUser.id,
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
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }

    const { badges } = body as { badges: string[] };

    const targetUser = await User.findById(params.userId);
    if (!targetUser) {
      set.status = 404;
      return { error: 'User not found' };
    }

    const oldBadges = [...(targetUser.badges || [])];

    // Sync the isStaff flag and staffRole based on whether the admin
    // included staff-related badges in the request.  These badges are
    // auto-assigned by recalculateUserBadges based on the isStaff flag,
    // so we need to update the flag *before* recalculating.
    const STAFF_BADGE_IDS = ['staff', 'admin', 'moderator'];
    const requestedStaffBadges = badges.filter((b) => STAFF_BADGE_IDS.includes(b));
    const wantsStaff = requestedStaffBadges.length > 0;

    const staffUpdate: Record<string, any> = {};
    if (wantsStaff && !targetUser.isStaff) {
      staffUpdate.isStaff = true;
      // Pick the highest-privilege role requested
      if (requestedStaffBadges.includes('admin')) {
        staffUpdate.staffRole = 'admin';
      } else if (requestedStaffBadges.includes('moderator')) {
        staffUpdate.staffRole = 'moderator';
      } else {
        staffUpdate.staffRole = 'staff';
      }
    } else if (wantsStaff && targetUser.isStaff) {
      // Update staffRole if the requested set changed
      if (requestedStaffBadges.includes('admin')) {
        staffUpdate.staffRole = 'admin';
      } else if (requestedStaffBadges.includes('moderator')) {
        staffUpdate.staffRole = 'moderator';
      } else {
        staffUpdate.staffRole = 'staff';
      }
    } else if (!wantsStaff && targetUser.isStaff) {
      staffUpdate.isStaff = false;
      staffUpdate.staffRole = null;
    }

    // Only manual badges can be set by admin; auto badges are recalculated
    const { recalculateUserBadges, MANUAL_BADGES } = await import('@/lib/services/badges');
    const manualBadges = badges.filter((b) => (MANUAL_BADGES as readonly string[]).includes(b));
    await User.updateById(targetUser.id, { badges: manualBadges, ...staffUpdate });
    const finalBadges = await recalculateUserBadges(targetUser.id);

    // DM the user about any badge they just unlocked (skip system accounts).
    const newlyAdded = (finalBadges || manualBadges).filter((b) => !oldBadges.includes(b));
    if (newlyAdded.length > 0 && !targetUser.isSystem) {
      const { BADGES } = await import('@/lib/constants/badges');
      const { notifyBadgesUnlocked } = await import('@/lib/services/systemNotify');
      const byId = new Map(Object.values(BADGES).map((b) => [b.id, b.name]));
      const names = newlyAdded.map((b) => byId.get(b) || b);
      void notifyBadgesUnlocked(targetUser.id, names).catch(() => {});
    }

    await logAdminAction(
      user.id,
      'edit_badges',
      'user',
      targetUser.id,
      { oldBadges, newBadges: finalBadges || manualBadges }
    );

    return { success: true, badges: finalBadges || manualBadges };
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
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }

    const { q, page = '1', limit = '20' } = query as { q?: string; page?: string; limit?: string };
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const allServers = await Server.find({});
    let filtered = allServers;
    if (q) {
      const lowerQ = q.toLowerCase();
      filtered = allServers.filter(s => 
        s.name?.toLowerCase().includes(lowerQ) ||
        s.description?.toLowerCase().includes(lowerQ)
      );
    }
    filtered.sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
    const total = filtered.length;
    const servers = filtered.slice(skip, skip + limitNum);

    // Batch fetch owners
    const ownerIds = [...new Set(servers.map(s => s.ownerId))];
    const owners = ownerIds.length > 0 ? await User.find({ id: { in: ownerIds } }) : [];
    const ownerMap = new Map(owners.map(o => [o.id, o]));

    return {
      servers: servers.map(s => ({
        id: s.id,
        name: s.name,
        description: s.description,
        icon: s.icon,
        memberCount: s.memberCount,
        owner: ownerMap.get(s.ownerId) ? {
          id: ownerMap.get(s.ownerId)!.id,
          username: ownerMap.get(s.ownerId)!.username,
          displayName: ownerMap.get(s.ownerId)!.displayName,
        } : s.ownerId,
        isDiscoverable: s.isDiscoverable,
        isPartnered: s.isPartnered,
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
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }

    const { reason } = body as { reason?: string };

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    await logAdminAction(
      user.id,
      'delete_server',
      'server',
      server.id,
      { name: server.name, ownerId: server.ownerId },
      reason
    );

    // Delete the server and associated data
    await Server.deleteById(params.serverId);
    const serverMessages = await Message.find({ serverId: params.serverId });
    for (const msg of serverMessages) {
      await Message.deleteById(msg.id);
    }
    // Channel deletion happens via Server cascade
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
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    const newPartnerStatus = !server.isPartnered;

    // Age-gated servers cannot be partnered
    if (newPartnerStatus && server.isAgeGated) {
      set.status = 400;
      return { error: 'Age-gated servers cannot be partnered' };
    }

    await Server.updateById(server.id, {
      isPartnered: newPartnerStatus,
      partneredAt: newPartnerStatus ? new Date() : null,
    });

    // Auto-assign/remove partner badge for the server owner
    const { recalculateUserBadges } = await import('@/lib/services/badges');
    void recalculateUserBadges(server.ownerId).catch(() => {});

    await logAdminAction(
      user.id,
      newPartnerStatus ? 'grant_partner' : 'revoke_partner',
      'server',
      server.id,
      { name: server.name }
    );

    return { success: true, isPartnered: newPartnerStatus };
  }, {
    params: t.Object({
      serverId: t.String(),
    }),
  })

  // Toggle server discoverability
  .post('/servers/:serverId/discovery', async ({ headers, cookie, params, set }) => {
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    // Age-gated servers cannot be discoverable
    if (!server.isDiscoverable && server.isAgeGated) {
      set.status = 400;
      return { error: 'Age-gated servers cannot be discoverable' };
    }

    const newDiscoverable = !server.isDiscoverable;
    await Server.updateById(server.id, { isDiscoverable: newDiscoverable });

    await logAdminAction(
      user.id,
      'toggle_discovery',
      'server',
      server.id,
      { name: server.name, isDiscoverable: newDiscoverable }
    );

    return { success: true, isDiscoverable: newDiscoverable };
  }, {
    params: t.Object({
      serverId: t.String(),
    }),
  })

  // Transfer server ownership
  .post('/servers/:serverId/transfer', async ({ headers, cookie, params, body, set }) => {
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
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

    const oldOwnerId = server.ownerId;
    await Server.updateById(server.id, { ownerId: newOwner.id });

    // Recalculate badges for both old and new owner
    const { recalculateUserBadges } = await import('@/lib/services/badges');
    void recalculateUserBadges(oldOwnerId).catch(() => {});
    void recalculateUserBadges(newOwner.id).catch(() => {});

    await logAdminAction(
      user.id,
      'transfer_ownership',
      'server',
      server.id,
      { 
        name: server.name, 
        oldOwnerId, 
        newOwnerId: newOwner.id,
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

  // Public endpoint — returns connectionsEnabled flag and disabledProviders (no auth required)
  .get('/settings/connections', async () => {
    const settings = await getPlatformSettings();
    return {
      connectionsEnabled: settings.connectionsEnabled,
      disabledProviders: settings.disabledProviders || [],
    };
  })

  // Get platform settings
  .get('/settings', async ({ headers, cookie, set }) => {
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }

    const settings = await getPlatformSettings();
    return settings;
  })

  // Update platform settings
  .patch('/settings', async ({ headers, cookie, body, set }) => {
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }

    const { maintenanceMode, allowRegistration, connectionsEnabled, disabledProviders, globalAnnouncement, oembedWhitelist, allowedFileTypes, warnOnUnknownFileTypes } = body as {
      maintenanceMode?: boolean;
      allowRegistration?: boolean;
      connectionsEnabled?: boolean;
      disabledProviders?: string[];
      globalAnnouncement?: string;
      oembedWhitelist?: string[];
      allowedFileTypes?: { type: string; safe: boolean }[];
      warnOnUnknownFileTypes?: boolean;
    };

    const updates: Record<string, unknown> = {};
    if (maintenanceMode !== undefined) updates.maintenanceMode = maintenanceMode;
    if (allowRegistration !== undefined) updates.allowRegistration = allowRegistration;
    if (connectionsEnabled !== undefined) updates.connectionsEnabled = connectionsEnabled;
    if (disabledProviders !== undefined) updates.disabledProviders = disabledProviders;
    if (globalAnnouncement !== undefined) {
      updates.globalAnnouncement = globalAnnouncement || null;
      updates.announcementUpdatedAt = new Date();
    }
    if (oembedWhitelist !== undefined) updates.oembedWhitelist = oembedWhitelist;
    if (allowedFileTypes !== undefined) updates.allowedFileTypes = allowedFileTypes;
    if (warnOnUnknownFileTypes !== undefined) updates.warnOnUnknownFileTypes = warnOnUnknownFileTypes;

    const settings = await updatePlatformSettings(updates);

    await logAdminAction(
      user.id,
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
      connectionsEnabled: t.Optional(t.Boolean()),
      disabledProviders: t.Optional(t.Array(t.String())),
      globalAnnouncement: t.Optional(t.String()),
      oembedWhitelist: t.Optional(t.Array(t.String())),
      allowedFileTypes: t.Optional(t.Array(t.Object({
        type: t.String(),
        safe: t.Boolean(),
      }))),
      warnOnUnknownFileTypes: t.Optional(t.Boolean()),
    }),
  })

  // Publish global announcement
  .post('/broadcast', async ({ headers, cookie, body, set }) => {
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
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
      // Fire-and-forget: process DMs in the background so the HTTP request
      // returns immediately and doesn't time out on large user bases.
      void (async () => {
        try {
          const { SERIKA_BROADCAST_ID, ensureSerikaBroadcastUser } = await import('@/lib/services/serikaBroadcast');
          const { Channel } = await import('@/lib/models/Channel');
          const { Message } = await import('@/lib/models/Message');
          const { encryptForStorage } = await import('@/lib/security/encryption');
          const { emitDmListUpdate } = await import('@/lib/api/dms');

          await ensureSerikaBroadcastUser();

          // Get all users (excluding system users and banned users)
          const allUsers = await User.find({});
          const eligibleUsers = allUsers.filter(u => !u.isSystem && !u.isBanned);

          console.log(`[Broadcast] Sending to ${eligibleUsers.length} users`);

          // Send DM to each user (in batches)
          const batchSize = 50;
          const broadcastUserId = SERIKA_BROADCAST_ID;
          let sent = 0;

          for (let i = 0; i < eligibleUsers.length; i += batchSize) {
            const batch = eligibleUsers.slice(i, i + batchSize);

            await Promise.all(batch.map(async (targetUser: any) => {
              try {
                // Get or create DM channel with system user
                let channel = await Channel.findOne({
                  type: 'dm',
                  recipientIds: [broadcastUserId, targetUser.id],
                });

                if (!channel) {
                  channel = await Channel.create({
                    type: 'dm',
                    name: 'Direct Message',
                    recipientIds: [broadcastUserId, targetUser.id],
                    position: 0,
                  });
                }

                // Encrypt and send message
                const encryptedContent = await encryptForStorage(message.trim());
                const dmMessage = await Message.create({
                  channelId: channel.id,
                  authorId: broadcastUserId,
                  content: encryptedContent,
                  type: 'default',
                });

                // Update channel
                await Channel.updateById(channel.id, {
                  lastMessageId: dmMessage.id,
                  updatedAt: new Date(),
                });

                // Emit real-time DM list update to the target user
                emitDmListUpdate([targetUser.id], {
                  type: 'dm:list:update',
                  channelId: channel.id,
                  recipientId: SERIKA_BROADCAST_ID,
                  message: {
                    id: dmMessage.id,
                    content: message.trim().slice(0, 180),
                    authorId: broadcastUserId,
                    createdAt: dmMessage.createdAt,
                  },
                });

                sent++;
              } catch (err) {
                console.error(`[Broadcast] Failed to send DM to user ${targetUser.id}:`, err);
              }
            }));

            console.log(`[Broadcast] Progress: ${sent}/${eligibleUsers.length} DMs sent`);
          }

          console.log(`[Broadcast] Complete: ${sent}/${eligibleUsers.length} DMs sent`);
        } catch (err) {
          console.error('[Broadcast] Failed to send broadcast DMs:', err);
        }
      })();

      dmCount = -1; // Indicates "sending in background"
    }

    await logAdminAction(
      user.id,
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
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }

    const { type, page = '1', limit = '50' } = query as { type?: string; page?: string; limit?: string };
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const allLogs = await AdminLog.find({});
    let filtered = allLogs;
    if (type) {
      if (type === 'bans') {
        filtered = allLogs.filter(log => log.action === 'ban_user' || log.action === 'unban_user');
      } else if (type === 'reports') {
        filtered = allLogs.filter(log => log.action === 'resolve_report' || log.action === 'dismiss_report');
      } else if (type === 'admin') {
        filtered = allLogs.filter(log => ['update_settings', 'broadcast_announcement', 'grant_partner', 'revoke_partner'].includes(log.action));
      }
    }
    filtered.sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
    const total = filtered.length;
    const logs = filtered.slice(skip, skip + limitNum);

    // Batch fetch admins
    const adminIds = [...new Set(logs.map(log => log.adminId))];
    const admins = adminIds.length > 0 ? await User.find({ id: { in: adminIds } }) : [];
    const adminMap = new Map(admins.map(a => [a.id, a]));

    return {
      logs: logs.map((log) => ({
        id: log.id,
        admin: adminMap.get(log.adminId) ? {
          id: adminMap.get(log.adminId)!.id,
          username: adminMap.get(log.adminId)!.username,
          displayName: adminMap.get(log.adminId)!.displayName,
          avatar: adminMap.get(log.adminId)!.avatar,
        } : log.adminId,
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

  // ==================== EXPERIMENTS & A/B TESTING ====================

  // List all experiments
  .get('/experiments', async ({ headers, cookie, query, set }) => {
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }

    const { Experiment } = await import('@/lib/models/Experiment');
    const { status: expStatus, page = '1', limit = '20' } = query as { status?: string; page?: string; limit?: string };
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const allExperiments = await Experiment.find({});
    let filtered = allExperiments;
    if (expStatus) {
      // Frontend passes a comma-separated list (e.g. "running,paused,draft").
      const statuses = expStatus.split(',').map(s => s.trim()).filter(Boolean);
      if (statuses.length > 0) {
        filtered = allExperiments.filter(e => e.status && statuses.includes(e.status));
      }
    }
    filtered.sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
    const total = filtered.length;
    const experiments = filtered.slice(skip, skip + limitNum);

    // Batch fetch creators
    const creatorIds = [...new Set(experiments.map(e => e.createdBy).filter(Boolean))];
    const creators = creatorIds.length > 0 ? await User.find({ id: { in: creatorIds } }) : [];
    const creatorMap = new Map(creators.map(c => [c.id, c]));

    const experimentsWithCreators = experiments.map(e => ({
      ...e,
      createdBy: creatorMap.get(e.createdBy) ? {
        id: creatorMap.get(e.createdBy)!.id,
        username: creatorMap.get(e.createdBy)!.username,
        displayName: creatorMap.get(e.createdBy)!.displayName,
      } : e.createdBy,
    }));

    return {
      experiments: experimentsWithCreators,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      }
    };
  })

  // Get experiment by ID
  .get('/experiments/:experimentId', async ({ headers, cookie, params, set }) => {
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }

    const { Experiment } = await import('@/lib/models/Experiment');
    const experiment = await Experiment.findById(params.experimentId);
    
    if (!experiment) {
      set.status = 404;
      return { error: 'Experiment not found' };
    }

    // Fetch creator info
    let creator = null;
    if (experiment.createdBy) {
      creator = await User.findById(experiment.createdBy);
    }

    return {
      ...experiment,
      createdBy: creator ? {
        id: creator.id,
        username: creator.username,
        displayName: creator.displayName,
      } : experiment.createdBy,
    };
  }, {
    params: t.Object({
      experimentId: t.String(),
    }),
  })

  // Create experiment
  .post('/experiments', async ({ headers, cookie, body, set }) => {
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }

    const { Experiment } = await import('@/lib/models/Experiment');

    const {
      name,
      key,
      description,
      type,
      variants,
      rolloutPercentage,
      filters,
      excludedUserIds,
    } = body as {
      name: string;
      key: string;
      description?: string;
      type: 'feature_flag' | 'ab_test' | 'percentage_rollout' | 'user_segment';
      variants: Array<{ id: string; name: string; weight: number; config?: Record<string, unknown> }>;
      rolloutPercentage?: number;
      filters?: Array<{ type: string; operator: string; value: unknown }>;
      excludedUserIds?: string[];
    };

    // Check if key already exists
    const existing = await Experiment.findOne({ key });
    if (existing) {
      set.status = 400;
      return { error: 'Experiment key already exists' };
    }

    const experiment = await Experiment.create({
      name,
      key,
      description,
      type,
      variants,
      rolloutPercentage: rolloutPercentage ?? 100,
      filters: filters ?? [],
      excludedUsers: excludedUserIds ?? [],
      createdBy: user.id,
      status: 'draft',
    });

    await logAdminAction(
      user.id,
      'create_experiment',
      'platform',
      experiment.id,
      { name, key, type }
    );

    return experiment;
  }, {
    body: t.Object({
      name: t.String(),
      key: t.String(),
      description: t.Optional(t.String()),
      type: t.String(),
      variants: t.Array(t.Object({
        id: t.String(),
        name: t.String(),
        weight: t.Number(),
        config: t.Optional(t.Record(t.String(), t.Unknown())),
      })),
      rolloutPercentage: t.Optional(t.Number()),
      filters: t.Optional(t.Array(t.Object({
        type: t.String(),
        operator: t.String(),
        value: t.Unknown(),
      }))),
      excludedUserIds: t.Optional(t.Array(t.String())),
    }),
  })

  // Update experiment
  .patch('/experiments/:experimentId', async ({ headers, cookie, params, body, set }) => {
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }

    const { Experiment } = await import('@/lib/models/Experiment');
    const experiment = await Experiment.findById(params.experimentId);
    
    if (!experiment) {
      set.status = 404;
      return { error: 'Experiment not found' };
    }

    const {
      name,
      description,
      variants,
      rolloutPercentage,
      filters,
      excludedUsers: bodyExcludedUsers,
      userOverrides: bodyUserOverrides,
      status: expBodyStatus,
    } = body as {
      name?: string;
      description?: string;
      variants?: Array<{ id: string; name: string; weight: number; config?: Record<string, unknown> }>;
      rolloutPercentage?: number;
      filters?: Array<{ type: string; operator: string; value: unknown }>;
      excludedUsers?: string[];
      userOverrides?: Array<{ userId: string; variantId: string }>;
      status?: string;
    };

    const updates: Record<string, unknown> = {};
    if (name) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (variants) updates.variants = variants;
    if (rolloutPercentage !== undefined) updates.rolloutPercentage = rolloutPercentage;
    if (filters) updates.filters = filters;
    if (bodyExcludedUsers !== undefined) updates.excludedUsers = bodyExcludedUsers;
    if (bodyUserOverrides !== undefined) updates.userOverrides = bodyUserOverrides;
    
    // Handle status changes
    if (expBodyStatus && expBodyStatus !== experiment.status) {
      updates.status = expBodyStatus;
      if (expBodyStatus === 'running' && !experiment.startedAt) {
        updates.startedAt = new Date();
      }
      if (expBodyStatus === 'completed' && !experiment.endedAt) {
        updates.endedAt = new Date();
      }
    }

    const updated = await Experiment.updateById(experiment.id, updates);

    await logAdminAction(
      user.id,
      'update_experiment',
      'platform',
      experiment.id,
      { changes: body }
    );

    return updated || experiment;
  }, {
    params: t.Object({
      experimentId: t.String(),
    }),
    body: t.Object({
      name: t.Optional(t.String()),
      description: t.Optional(t.String()),
      variants: t.Optional(t.Array(t.Object({
        id: t.String(),
        name: t.String(),
        weight: t.Number(),
        config: t.Optional(t.Record(t.String(), t.Unknown())),
      }))),
      rolloutPercentage: t.Optional(t.Number()),
      filters: t.Optional(t.Array(t.Object({
        type: t.String(),
        operator: t.String(),
        value: t.Unknown(),
      }))),
      excludedUsers: t.Optional(t.Array(t.String())),
      userOverrides: t.Optional(t.Array(t.Object({
        userId: t.String(),
        variantId: t.String(),
      }))),
      status: t.Optional(t.String()),
    }),
  })

  // Delete experiment
  .delete('/experiments/:experimentId', async ({ headers, cookie, params, set }) => {
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }

    const { Experiment } = await import('@/lib/models/Experiment');
    const experiment = await Experiment.findById(params.experimentId);
    
    if (!experiment) {
      set.status = 404;
      return { error: 'Experiment not found' };
    }

    await Experiment.deleteById(experiment.id);

    await logAdminAction(
      user.id,
      'delete_experiment',
      'platform',
      params.experimentId,
      { name: experiment.name, key: experiment.key }
    );

    return { success: true };
  }, {
    params: t.Object({
      experimentId: t.String(),
    }),
  })

  // Get user's experiment variant
  .get('/experiments/:experimentId/variant/:userId', async ({ headers, cookie, params, set }) => {
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }

    const { Experiment, getUserVariant } = await import('@/lib/models/Experiment');
    const experiment = await Experiment.findById(params.experimentId);
    
    if (!experiment) {
      set.status = 404;
      return { error: 'Experiment not found' };
    }

    const targetUser = await User.findById(params.userId);
    if (!targetUser) {
      set.status = 404;
      return { error: 'User not found' };
    }

    const variant = await getUserVariant(experiment, params.userId);

    return {
      experimentKey: experiment.key,
      experimentName: experiment.name,
      user: {
        id: targetUser.id,
        username: targetUser.username,
      },
      variant,
    };
  }, {
    params: t.Object({
      experimentId: t.String(),
      userId: t.String(),
    }),
  })

  // List managed users for an experiment
  .get('/experiments/:experimentId/users', async ({ headers, cookie, params, set }) => {
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }

    const { Experiment } = await import('@/lib/models/Experiment');
    const experiment = await Experiment.findById(params.experimentId);

    if (!experiment) {
      set.status = 404;
      return { error: 'Experiment not found' };
    }

    const excludedUsers = (experiment.excludedUsers as string[]) || [];
    const userOverrides = (experiment.userOverrides as Array<{ userId: string; variantId: string }>) || [];

    const allUserIds = [...new Set([...excludedUsers, ...userOverrides.map(o => o.userId)])];
    const users = allUserIds.length > 0 ? await User.find({ id: { in: allUserIds } }) : [];
    const userMap = new Map(users.map(u => [u.id, u]));

    const managedUsers = allUserIds.map(id => {
      const u = userMap.get(id);
      const override = userOverrides.find(o => o.userId === id);
      return {
        id,
        username: u?.username ?? 'Unknown',
        displayName: u?.displayName ?? null,
        status: excludedUsers.includes(id) ? 'excluded' : 'included',
        variantId: override?.variantId ?? null,
      };
    });

    return { users: managedUsers };
  }, {
    params: t.Object({
      experimentId: t.String(),
    }),
  })

  // Add user to experiment (include or exclude)
  .post('/experiments/:experimentId/users', async ({ headers, cookie, params, body, set }) => {
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }

    const { Experiment } = await import('@/lib/models/Experiment');
    const experiment = await Experiment.findById(params.experimentId);

    if (!experiment) {
      set.status = 404;
      return { error: 'Experiment not found' };
    }

    const { userId, action } = body as { userId: string; action: 'include' | 'exclude' };

    if (!userId || !userId.trim()) {
      set.status = 400;
      return { error: 'User ID is required' };
    }

    const targetUser = await User.findById(userId.trim());
    if (!targetUser) {
      set.status = 404;
      return { error: 'User not found' };
    }

    const excludedUsers = (experiment.excludedUsers as string[]) || [];
    const userOverrides = (experiment.userOverrides as Array<{ userId: string; variantId: string }>) || [];
    const variants = (experiment.variants as Array<{ id: string; name: string; weight: number }>) || [];

    const updates: Record<string, unknown> = {};

    if (action === 'exclude') {
      if (!excludedUsers.includes(targetUser.id)) {
        updates.excludedUsers = [...excludedUsers, targetUser.id];
      }
      // Remove from overrides if present
      const filteredOverrides = userOverrides.filter(o => o.userId !== targetUser.id);
      if (filteredOverrides.length !== userOverrides.length) {
        updates.userOverrides = filteredOverrides;
      }
    } else {
      // Include: remove from excluded, add to overrides with first non-control variant (or 'enabled')
      const filteredExcluded = excludedUsers.filter(id => id !== targetUser.id);
      if (filteredExcluded.length !== excludedUsers.length) {
        updates.excludedUsers = filteredExcluded;
      }

      const existingOverride = userOverrides.find(o => o.userId === targetUser.id);
      if (!existingOverride) {
        const enabledVariant = variants.find(v => v.id === 'enabled') || variants.find(v => v.id !== 'control') || variants[0];
        updates.userOverrides = [...userOverrides, { userId: targetUser.id, variantId: enabledVariant?.id ?? 'enabled' }];
      }
    }

    if (Object.keys(updates).length > 0) {
      await Experiment.updateById(experiment.id, updates);
    }

    await logAdminAction(
      user.id,
      'update_experiment',
      'platform',
      experiment.id,
      { action, userId: targetUser.id, username: targetUser.username }
    );

    return { success: true, action, user: { id: targetUser.id, username: targetUser.username } };
  }, {
    params: t.Object({
      experimentId: t.String(),
    }),
    body: t.Object({
      userId: t.String(),
      action: t.Union([t.Literal('include'), t.Literal('exclude')]),
    }),
  })

  // Remove user from experiment management
  .delete('/experiments/:experimentId/users/:userId', async ({ headers, cookie, params, set }) => {
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }

    const { Experiment } = await import('@/lib/models/Experiment');
    const experiment = await Experiment.findById(params.experimentId);

    if (!experiment) {
      set.status = 404;
      return { error: 'Experiment not found' };
    }

    const excludedUsers = (experiment.excludedUsers as string[]) || [];
    const userOverrides = (experiment.userOverrides as Array<{ userId: string; variantId: string }>) || [];

    const updates: Record<string, unknown> = {};

    const filteredExcluded = excludedUsers.filter(id => id !== params.userId);
    if (filteredExcluded.length !== excludedUsers.length) {
      updates.excludedUsers = filteredExcluded;
    }

    const filteredOverrides = userOverrides.filter(o => o.userId !== params.userId);
    if (filteredOverrides.length !== userOverrides.length) {
      updates.userOverrides = filteredOverrides;
    }

    if (Object.keys(updates).length > 0) {
      await Experiment.updateById(experiment.id, updates);
    }

    await logAdminAction(
      user.id,
      'update_experiment',
      'platform',
      experiment.id,
      { action: 'remove_user', userId: params.userId }
    );

    return { success: true };
  }, {
    params: t.Object({
      experimentId: t.String(),
      userId: t.String(),
    }),
  })

  // ==================== INSTANCES ====================

  // List connected instances
  .get('/instances', async ({ headers, cookie, query, set }) => {
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }

    const { Instance } = await import('@/lib/models/Instance');
    const { status: instStatus, page = '1', limit = '20' } = query as { status?: string; page?: string; limit?: string };
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const allInstances = await Instance.find({}) as any[];
    let filtered = allInstances;
    if (instStatus) {
      filtered = allInstances.filter((i: any) => i.status === instStatus);
    }
    filtered.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const total = filtered.length;
    const instances = filtered.slice(skip, skip + limitNum);

    return {
      instances: instances.map((i: any) => ({
        id: i.id,
        name: i.name,
        domain: i.domain,
        type: i.type,
        status: i.status,
        version: i.version,
        features: i.features,
        lastPing: i.lastPing,
        userCount: i.userCount,
        serverCount: i.serverCount,
        createdAt: i.createdAt,
      })),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      }
    };
  })

  // Approve instance
  .post('/instances/:instanceId/approve', async ({ headers, cookie, params, set }) => {
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }

    const { Instance } = await import('@/lib/models/Instance');
    const instance = await Instance.findById(params.instanceId);
    
    if (!instance) {
      set.status = 404;
      return { error: 'Instance not found' };
    }

    await Instance.updateById(instance.id, { status: 'active' });

    await logAdminAction(
      user.id,
      'approve_instance',
      'platform',
      instance.id,
      { name: instance.name, domain: instance.domain }
    );

    return { success: true };
  }, {
    params: t.Object({
      instanceId: t.String(),
    }),
  })

  // Revoke instance
  .post('/instances/:instanceId/revoke', async ({ headers, cookie, params, body, set }) => {
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }

    const { reason } = body as { reason?: string };

    const { Instance } = await import('@/lib/models/Instance');
    const instance = await Instance.findById(params.instanceId);
    
    if (!instance) {
      set.status = 404;
      return { error: 'Instance not found' };
    }

    await Instance.updateById(instance.id, { status: 'revoked' });

    await logAdminAction(
      user.id,
      'revoke_instance',
      'platform',
      instance.id,
      { name: instance.name, domain: instance.domain },
      reason
    );

    return { success: true };
  }, {
    params: t.Object({
      instanceId: t.String(),
    }),
    body: t.Object({
      reason: t.Optional(t.String()),
    }),
  })

  // ==================== STATS ====================
  
  // Get platform stats
  .get('/stats', async ({ headers, cookie, set }) => {
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }

    const allUsers = await User.find({});
    const allServers = await Server.find({});
    const allMessages = await Message.find({});
    // Filter out legacy discord- prefixed users (now stored in DiscordUser table)
    const realUsers = allUsers.filter(u => !u.username?.startsWith('discord-'));
    const bannedUsers = realUsers.filter(u => u.isBanned);
    const botUsers = realUsers.filter(u => u.isBot);

    // Get today's new users
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();
    const newUsersToday = realUsers.filter(u => new Date(u.createdAt ?? 0).getTime() >= todayMs).length;

    // New users this week
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekMs = weekAgo.getTime();
    const newUsersThisWeek = realUsers.filter(u => new Date(u.createdAt ?? 0).getTime() >= weekMs).length;

    // Messages today
    const messagesToday = allMessages.filter(m => new Date(m.createdAt ?? 0).getTime() >= todayMs).length;

    // Online users (presence heartbeat within 5 min)
    const now = Date.now();
    const onlineUsers = realUsers.filter(u => {
      if (u.status === 'offline' || u.status === 'invisible') return false;
      const hb = u.presenceLastHeartbeatAt;
      if (!hb) return false;
      return new Date(hb).getTime() >= now - 5 * 60 * 1000;
    }).length;

    // Total server members across all servers
    const allServerMembers = await ServerMember.find({});
    const totalMemberships = allServerMembers.length;

    // Active servers (created in last 30 days)
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const activeServers = allServers.filter(s => new Date(s.createdAt ?? 0).getTime() >= thirtyDaysAgo.getTime()).length;

    return {
      users: realUsers.length,
      servers: allServers.length,
      messages: allMessages.length,
      banned: bannedUsers.length,
      bots: botUsers.length,
      newUsersToday,
      newUsersThisWeek,
      messagesToday,
      onlineUsers,
      totalMemberships,
      activeServers,
    };
  })

  // ==================== TTS SOUND TRIGGERS ====================

  // List all configured TTS sound triggers
  .get('/tts-sounds', async ({ headers, cookie, set }) => {
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }
    const sounds = await TtsSound.find({});
    return { sounds };
  })

  // Create a TTS sound trigger
  .post('/tts-sounds', async ({ headers, cookie, body, set }) => {
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }
    const { triggerWord, path, label, enabled } = body;
    const cleanTrigger = triggerWord.trim().toLowerCase();
    const cleanPath = path.trim();
    if (!cleanTrigger || !cleanPath) {
      set.status = 400;
      return { error: 'triggerWord and path are required' };
    }
    // Normalise to a leading-slash public path so clients can load it directly.
    const normalizedPath = cleanPath.startsWith('/') ? cleanPath : `/${cleanPath}`;
    const sound = await TtsSound.create({
      triggerWord: cleanTrigger,
      path: normalizedPath,
      label: label?.trim() || null,
      enabled: enabled ?? true,
      createdBy: user.id,
    });
    await logAdminAction(user.id, 'update_settings', 'platform', sound.id, { triggerWord: cleanTrigger, path: normalizedPath });
    return { sound };
  }, {
    body: t.Object({
      triggerWord: t.String(),
      path: t.String(),
      label: t.Optional(t.String()),
      enabled: t.Optional(t.Boolean()),
    }),
  })

  // Update a TTS sound trigger
  .patch('/tts-sounds/:id', async ({ headers, cookie, params, body, set }) => {
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }
    const updates: Record<string, unknown> = {};
    if (body.triggerWord !== undefined) updates.triggerWord = body.triggerWord.trim().toLowerCase();
    if (body.path !== undefined) {
      const p = body.path.trim();
      updates.path = p.startsWith('/') ? p : `/${p}`;
    }
    if (body.label !== undefined) updates.label = body.label.trim() || null;
    if (body.enabled !== undefined) updates.enabled = body.enabled;
    const sound = await TtsSound.updateById(params.id, updates);
    if (!sound) {
      set.status = 404;
      return { error: 'Sound not found' };
    }
    return { sound };
  }, {
    body: t.Object({
      triggerWord: t.Optional(t.String()),
      path: t.Optional(t.String()),
      label: t.Optional(t.String()),
      enabled: t.Optional(t.Boolean()),
    }),
  })

  // Delete a TTS sound trigger
  .delete('/tts-sounds/:id', async ({ headers, cookie, params, set }) => {
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }
    await TtsSound.deleteById(params.id);
    await logAdminAction(user.id, 'update_settings', 'platform', params.id, { deleted: true });
    return { success: true };
  })

  // ==================== TTS CUSTOM VOICES ====================

  // List all configured TTS voices
  .get('/tts-voices', async ({ headers, cookie, set }) => {
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }
    const { TtsVoice } = await import('@/lib/models/TtsVoice');
    const voices = await TtsVoice.find({});
    return { voices };
  })

  // Create a TTS custom voice
  .post('/tts-voices', async ({ headers, cookie, body, set }) => {
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }
    const { name, provider, referenceId, description, enabled, isDefault } = body;
    const cleanName = name.trim().toLowerCase();
    const cleanProvider = provider.trim().toLowerCase();
    const cleanRefId = referenceId.trim();
    if (!cleanName || !cleanProvider || !cleanRefId) {
      set.status = 400;
      return { error: 'name, provider, and referenceId are required' };
    }
    if (!['fish', 'streamelements', 'se'].includes(cleanProvider)) {
      set.status = 400;
      return { error: 'provider must be "fish" or "streamelements"' };
    }
    const { TtsVoice } = await import('@/lib/models/TtsVoice');
    if (isDefault) await TtsVoice.clearDefault();
    const voice = await TtsVoice.create({
      name: cleanName,
      provider: cleanProvider,
      referenceId: cleanRefId,
      description: description?.trim() || null,
      enabled: enabled ?? true,
      isDefault: isDefault ?? false,
      createdBy: user.id,
    });
    await logAdminAction(user.id, 'update_settings', 'platform', voice.id, { name: cleanName, provider: cleanProvider });
    return { voice };
  }, {
    body: t.Object({
      name: t.String(),
      provider: t.String(),
      referenceId: t.String(),
      description: t.Optional(t.String()),
      enabled: t.Optional(t.Boolean()),
      isDefault: t.Optional(t.Boolean()),
    }),
  })

  // Update a TTS voice
  .patch('/tts-voices/:id', async ({ headers, cookie, params, body, set }) => {
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }
    const { TtsVoice } = await import('@/lib/models/TtsVoice');
    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name.trim().toLowerCase();
    if (body.provider !== undefined) updates.provider = body.provider.trim().toLowerCase();
    if (body.referenceId !== undefined) updates.referenceId = body.referenceId.trim();
    if (body.description !== undefined) updates.description = body.description.trim() || null;
    if (body.enabled !== undefined) updates.enabled = body.enabled;
    if (body.isDefault !== undefined) {
      if (body.isDefault) await TtsVoice.clearDefault();
      updates.isDefault = body.isDefault;
    }
    const voice = await TtsVoice.updateById(params.id, updates);
    if (!voice) {
      set.status = 404;
      return { error: 'Voice not found' };
    }
    return { voice };
  }, {
    body: t.Object({
      name: t.Optional(t.String()),
      provider: t.Optional(t.String()),
      referenceId: t.Optional(t.String()),
      description: t.Optional(t.String()),
      enabled: t.Optional(t.Boolean()),
      isDefault: t.Optional(t.Boolean()),
    }),
  })

  // Set a voice as the platform default
  .patch('/tts-voices/:id/default', async ({ headers, cookie, params, set }) => {
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }
    const { TtsVoice } = await import('@/lib/models/TtsVoice');
    const voice = await TtsVoice.setDefault(params.id);
    if (!voice) {
      set.status = 404;
      return { error: 'Voice not found' };
    }
    await logAdminAction(user.id, 'update_settings', 'platform', params.id, { setDefault: true });
    return { voice };
  })

  // Delete a TTS voice
  .delete('/tts-voices/:id', async ({ headers, cookie, params, set }) => {
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }
    const { TtsVoice } = await import('@/lib/models/TtsVoice');
    await TtsVoice.deleteById(params.id);
    await logAdminAction(user.id, 'update_settings', 'platform', params.id, { deleted: true });
    return { success: true };
  })

  // ==================== TRANSLATION MANAGEMENT ====================

  // Get locale stats from Serika Translate
  .get('/translate/stats', async ({ headers, cookie, set }) => {
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }
    const apiKey = process.env.SERIKA_TRANSLATE_KEY;
    if (!apiKey) {
      set.status = 500;
      return { error: 'SERIKA_TRANSLATE_KEY not configured' };
    }
    const slug = process.env.SERIKA_TRANSLATE_SLUG || 'serikacord';
    try {
      const res = await fetch(`https://translate.serika.dev/api/v1/projects/${slug}/locales`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        set.status = res.status;
        return { error: `Translate API error: ${body}` };
      }
      const data = await res.json();
      return { locales: Array.isArray(data) ? data : data.locales || [] };
    } catch (err) {
      set.status = 500;
      return { error: 'Failed to fetch stats' };
    }
  })

  // Get translation keys from Serika Translate
  .get('/translate/keys', async ({ headers, cookie, query, set }) => {
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }
    const apiKey = process.env.SERIKA_TRANSLATE_KEY;
    if (!apiKey) {
      set.status = 500;
      return { error: 'SERIKA_TRANSLATE_KEY not configured' };
    }
    const slug = process.env.SERIKA_TRANSLATE_SLUG || 'serikacord';
    const { search, page = '1', limit = '50' } = query as { search?: string; page?: string; limit?: string };
    const params = new URLSearchParams({ page, limit });
    if (search) params.set('search', search);
    try {
      const res = await fetch(`https://translate.serika.dev/api/v1/projects/${slug}/keys?${params}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) {
        set.status = res.status;
        return { error: 'Translate API error' };
      }
      const data = await res.json();
      return { keys: data.keys || [], pagination: data.pagination };
    } catch {
      set.status = 500;
      return { error: 'Failed to fetch keys' };
    }
  })

  // Get activity log from Serika Translate
  .get('/translate/activity', async ({ headers, cookie, query, set }) => {
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }
    const apiKey = process.env.SERIKA_TRANSLATE_KEY;
    if (!apiKey) {
      set.status = 500;
      return { error: 'SERIKA_TRANSLATE_KEY not configured' };
    }
    const slug = process.env.SERIKA_TRANSLATE_SLUG || 'serikacord';
    const { limit = '30', offset = '0' } = query as { limit?: string; offset?: string };
    try {
      const res = await fetch(`https://translate.serika.dev/api/v1/projects/${slug}/activity?limit=${limit}&offset=${offset}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) {
        set.status = res.status;
        return { error: 'Translate API error' };
      }
      const data = await res.json();
      return { activity: Array.isArray(data) ? data : data.activity || [] };
    } catch {
      set.status = 500;
      return { error: 'Failed to fetch activity' };
    }
  })

  // Push source strings to Serika Translate
  .post('/translate/push', async ({ headers, cookie, set }) => {
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }
    const apiKey = process.env.SERIKA_TRANSLATE_KEY;
    if (!apiKey) {
      set.status = 500;
      return { error: 'SERIKA_TRANSLATE_KEY not configured' };
    }
    const slug = process.env.SERIKA_TRANSLATE_SLUG || 'serikacord';
    try {
      const { readFile } = await import('fs/promises');
      const { join } = await import('path');
      const enPath = join(process.cwd(), 'public', '_gt', 'en.json');
      const enContent = await readFile(enPath, 'utf8');
      const enData = JSON.parse(enContent);
      const entries = Object.entries(enData).map(([key, value]) => ({
        key,
        value: typeof value === 'string' ? value : JSON.stringify(value),
      }));
      const batchSize = 200;
      let pushed = 0;
      for (let i = 0; i < entries.length; i += batchSize) {
        const batch = entries.slice(i, i + batchSize);
        await fetch(`https://translate.serika.dev/api/v1/projects/${slug}/translations`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ entries: batch }),
        });
        pushed += batch.length;
      }
      await logAdminAction(user.id, 'update_settings', 'platform', 'translations', { action: 'push', pushed });
      return { pushed };
    } catch (err) {
      set.status = 500;
      return { error: 'Failed to push source strings' };
    }
  })

  // Pull translations from Serika Translate (non-destructive)
  .post('/translate/pull', async ({ headers, cookie, set }) => {
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }
    const apiKey = process.env.SERIKA_TRANSLATE_KEY;
    if (!apiKey) {
      set.status = 500;
      return { error: 'SERIKA_TRANSLATE_KEY not configured' };
    }
    const slug = process.env.SERIKA_TRANSLATE_SLUG || 'serikacord';
    try {
      const { readFile, writeFile, readdir } = await import('fs/promises');
      const { join } = await import('path');
      const gtDir = join(process.cwd(), 'public', '_gt');
      const enContent = await readFile(join(gtDir, 'en.json'), 'utf8');
      const enData = JSON.parse(enContent);
      const localFiles = await readdir(gtDir);
      const targetLocales = localFiles
        .filter((f) => f.endsWith('.json') && f !== 'en.json')
        .map((f) => f.replace('.json', ''));

      const bundleRes = await fetch(`https://translate.serika.dev/api/v1/projects/${slug}/bundle?status=approved`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!bundleRes.ok) {
        set.status = bundleRes.status;
        return { error: 'Failed to fetch bundle from Translate API' };
      }
      const bundle = await bundleRes.json();
      const remoteLocales = bundle.locales || {};

      let updated = 0;
      let newLocales = 0;

      for (const locale of targetLocales) {
        const remoteData = remoteLocales[locale];
        if (!remoteData || Object.keys(remoteData).length === 0) continue;

        const localPath = join(gtDir, `${locale}.json`);
        let localData: Record<string, unknown> = {};
        try {
          localData = JSON.parse(await readFile(localPath, 'utf8'));
        } catch {}

        let changed = 0;
        for (const [key, remoteValue] of Object.entries(remoteData)) {
          if (!remoteValue) continue;
          const localValue = localData[key];
          const enValue = enData[key];
          if (localValue && localValue !== enValue && localValue !== remoteValue) continue;
          if (localValue !== remoteValue) {
            localData[key] = remoteValue;
            changed++;
          }
        }
        if (changed > 0) {
          await writeFile(localPath, JSON.stringify(localData, null, 2) + '\n');
          updated++;
        }
      }

      for (const [remoteLocale, remoteData] of Object.entries(remoteLocales)) {
        if (remoteLocale === 'en') continue;
        const localPath = join(gtDir, `${remoteLocale}.json`);
        try {
          await readFile(localPath);
        } catch {
          if (remoteData && Object.keys(remoteData).length > 0) {
            await writeFile(localPath, JSON.stringify(remoteData, null, 2) + '\n');
            newLocales++;
          }
        }
      }

      await logAdminAction(user.id, 'update_settings', 'platform', 'translations', { action: 'pull', updated, newLocales });
      return { updated, newLocales };
    } catch (err) {
      set.status = 500;
      return { error: 'Failed to pull translations' };
    }
  })

  // Full sync: push then pull
  .post('/translate/sync', async ({ headers, cookie, set }) => {
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }
    const apiKey = process.env.SERIKA_TRANSLATE_KEY;
    if (!apiKey) {
      set.status = 500;
      return { error: 'SERIKA_TRANSLATE_KEY not configured' };
    }
    const slug = process.env.SERIKA_TRANSLATE_SLUG || 'serikacord';
    try {
      const { readFile, writeFile, readdir } = await import('fs/promises');
      const { join } = await import('path');
      const gtDir = join(process.cwd(), 'public', '_gt');

      // Push
      const enContent = await readFile(join(gtDir, 'en.json'), 'utf8');
      const enData = JSON.parse(enContent);
      const entries = Object.entries(enData).map(([key, value]) => ({
        key,
        value: typeof value === 'string' ? value : JSON.stringify(value),
      }));
      const batchSize = 200;
      for (let i = 0; i < entries.length; i += batchSize) {
        const batch = entries.slice(i, i + batchSize);
        await fetch(`https://translate.serika.dev/api/v1/projects/${slug}/translations`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ entries: batch }),
        });
      }

      // Pull
      const localFiles = await readdir(gtDir);
      const targetLocales = localFiles
        .filter((f) => f.endsWith('.json') && f !== 'en.json')
        .map((f) => f.replace('.json', ''));

      const bundleRes = await fetch(`https://translate.serika.dev/api/v1/projects/${slug}/bundle?status=approved`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!bundleRes.ok) {
        set.status = bundleRes.status;
        return { error: 'Failed to fetch bundle' };
      }
      const bundle = await bundleRes.json();
      const remoteLocales = bundle.locales || {};

      let updated = 0;
      let newLocales = 0;

      for (const locale of targetLocales) {
        const remoteData = remoteLocales[locale];
        if (!remoteData || Object.keys(remoteData).length === 0) continue;

        const localPath = join(gtDir, `${locale}.json`);
        let localData: Record<string, unknown> = {};
        try {
          localData = JSON.parse(await readFile(localPath, 'utf8'));
        } catch {}

        let changed = 0;
        for (const [key, remoteValue] of Object.entries(remoteData)) {
          if (!remoteValue) continue;
          const localValue = localData[key];
          const enValue = enData[key];
          if (localValue && localValue !== enValue && localValue !== remoteValue) continue;
          if (localValue !== remoteValue) {
            localData[key] = remoteValue;
            changed++;
          }
        }
        if (changed > 0) {
          await writeFile(localPath, JSON.stringify(localData, null, 2) + '\n');
          updated++;
        }
      }

      for (const [remoteLocale, remoteData] of Object.entries(remoteLocales)) {
        if (remoteLocale === 'en') continue;
        const localPath = join(gtDir, `${remoteLocale}.json`);
        try {
          await readFile(localPath);
        } catch {
          if (remoteData && Object.keys(remoteData).length > 0) {
            await writeFile(localPath, JSON.stringify(remoteData, null, 2) + '\n');
            newLocales++;
          }
        }
      }

      await logAdminAction(user.id, 'update_settings', 'platform', 'translations', { action: 'sync', updated, newLocales });
      return { updated, newLocales };
    } catch (err) {
      set.status = 500;
      return { error: 'Failed to sync translations' };
    }
  })

  // ==================== BUG REPORTS MANAGEMENT ====================

  // List all bug reports (with optional filters)
  .get('/bug-reports', async ({ headers, cookie, query, set }) => {
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }

    const { status: filterStatus, priority, category, page = '1', limit = '20' } = query as any;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    // 'active' = the default working set: everything except resolved / won't-fix.
    // Filtered in JS since the model only supports single-status equality, so we
    // must fetch the full set (no tight _limit) for pagination to stay correct.
    const isActiveFilter = filterStatus === 'active';
    const filter: Record<string, unknown> = { _orderByPriority: true };
    if (!isActiveFilter) filter._limit = limitNum;
    if (filterStatus && filterStatus !== 'all' && !isActiveFilter) filter.status = filterStatus;
    if (priority && priority !== 'all') filter.priority = priority;
    if (category && category !== 'all') filter.category = category;

    let allReports = await BugReport.find(filter);
    const { normalizeUrl } = await import('@/lib/services/storage');
    allReports = allReports.map((r) => {
      if (!r.attachments || !Array.isArray(r.attachments)) return r;
      return { ...r, attachments: r.attachments.map((att: any) => att?.url ? { ...att, url: normalizeUrl(att.url) } : att) };
    });
    if (isActiveFilter) {
      allReports = allReports.filter((r) => r.status !== 'resolved' && r.status !== 'wont_fix');
    }
    const total = allReports.length;
    const reports = allReports.slice(offset, offset + limitNum);

    // Fetch reporter info
    const reporterIds = [...new Set(reports.map(r => r.reporterId))];
    const reporters = reporterIds.length > 0 ? await User.find({ id: { in: reporterIds } }) : [];
    const reporterMap = new Map(reporters.map(u => [u.id, u]));

    return {
      reports: reports.map(r => ({
        ...r,
        reporter: reporterMap.get(r.reporterId)
          ? { id: reporterMap.get(r.reporterId)!.id, username: reporterMap.get(r.reporterId)!.username, displayName: reporterMap.get(r.reporterId)!.displayName, avatar: reporterMap.get(r.reporterId)!.avatar }
          : null,
      })),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    };
  })

  // Get a single bug report with full details
  .get('/bug-reports/:id', async ({ headers, cookie, params, set }) => {
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }

    const report = await BugReport.findById(params.id);
    if (!report) {
      set.status = 404;
      return { error: 'Bug report not found' };
    }

    const { normalizeUrl } = await import('@/lib/services/storage');
    const normalizedReport = report.attachments && Array.isArray(report.attachments)
      ? { ...report, attachments: report.attachments.map((att: any) => att?.url ? { ...att, url: normalizeUrl(att.url) } : att) }
      : report;

    const reporter = await User.findById(report.reporterId);

    return {
      ...normalizedReport,
      reporter: reporter
        ? { id: reporter.id, username: reporter.username, displayName: reporter.displayName, avatar: reporter.avatar, email: reporter.email }
        : null,
    };
  })

  // Update bug report (priority, status, admin notes, assignment)
  .patch('/bug-reports/:id', async ({ headers, cookie, params, body, set }) => {
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }

    const report = await BugReport.findById(params.id);
    if (!report) {
      set.status = 404;
      return { error: 'Bug report not found' };
    }

    const { priority, status: newStatus, adminNotes, assignedTo } = body as any;

    const updates: Record<string, unknown> = {};
    if (priority && ['low', 'medium', 'high', 'critical'].includes(priority)) {
      updates.priority = priority;
    }
    if (newStatus && ['open', 'acknowledged', 'resolved', 'wont_fix'].includes(newStatus)) {
      updates.status = newStatus;
      if (newStatus === 'resolved' || newStatus === 'wont_fix') {
        updates.resolvedAt = new Date();
        updates.resolvedBy = user.id;
      } else {
        updates.resolvedAt = null;
        updates.resolvedBy = null;
      }
    }
    if (adminNotes !== undefined) {
      updates.adminNotes = adminNotes;
    }
    if (assignedTo !== undefined) {
      updates.assignedTo = assignedTo || null;
    }

    if (Object.keys(updates).length === 0) {
      set.status = 400;
      return { error: 'No valid fields to update' };
    }

    const updated = await BugReport.updateById(params.id, updates);

    // Notify the reporter when the status changes (bug report / feedback status).
    if (updates.status && updates.status !== report.status && report.reporterId) {
      const { notifyBugReportStatus } = await import('@/lib/services/systemNotify');
      void notifyBugReportStatus({
        reporterId: report.reporterId,
        kind: report.kind || 'bug',
        title: report.title,
        newStatus: updates.status as string,
        adminNote: (updates.adminNotes as string | undefined) ?? report.adminNotes,
      }).catch(() => {});
    }

    await logAdminAction(user.id, 'update_settings', 'platform', params.id, {
      action: 'bug_report_update',
      priority: updates.priority,
      status: updates.status,
      adminNotes: updates.adminNotes !== undefined,
      assignedTo: updates.assignedTo !== undefined,
    });

    return { report: updated };
  }, {
    body: t.Object({
      priority: t.Optional(t.Union([t.Literal('low'), t.Literal('medium'), t.Literal('high'), t.Literal('critical')])),
      status: t.Optional(t.Union([t.Literal('open'), t.Literal('acknowledged'), t.Literal('resolved'), t.Literal('wont_fix')])),
      adminNotes: t.Optional(t.String()),
      assignedTo: t.Optional(t.String()),
    }),
  })

  // Delete a bug report
  .delete('/bug-reports/:id', async ({ headers, cookie, params, set }) => {
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }

    const report = await BugReport.findById(params.id);
    if (!report) {
      set.status = 404;
      return { error: 'Bug report not found' };
    }

    await BugReport.deleteById(params.id);

    await logAdminAction(user.id, 'update_settings', 'platform', params.id, {
      action: 'bug_report_delete',
    });

    return { success: true };
  })

  // Get bug report statistics
  .get('/bug-reports/stats', async ({ headers, cookie, set }) => {
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }

    const allReports = await BugReport.find({});
    const stats = {
      total: allReports.length,
      open: allReports.filter(r => r.status === 'open').length,
      acknowledged: allReports.filter(r => r.status === 'acknowledged').length,
      resolved: allReports.filter(r => r.status === 'resolved').length,
      wontFix: allReports.filter(r => r.status === 'wont_fix').length,
      byPriority: {
        low: allReports.filter(r => r.priority === 'low').length,
        medium: allReports.filter(r => r.priority === 'medium').length,
        high: allReports.filter(r => r.priority === 'high').length,
        critical: allReports.filter(r => r.priority === 'critical').length,
      },
    };

    return { stats };
  })

  // Normalize legacy Backblaze B2 URLs in bug report attachments to CDN format
  .post('/bug-reports/normalize-attachments', async ({ headers, cookie, set }) => {
    const { user, error, isAdmin, status } = await getAdminAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user || !isAdmin) {
      set.status = status;
      return { error: error || 'Admin access required' };
    }

    const { normalizeUrl } = await import('@/lib/services/storage');
    const allReports = await BugReport.find({});
    let fixed = 0;

    for (const report of allReports) {
      const attachments = report.attachments as Array<{ url: string; type: string; name: string }> | null;
      if (!attachments || attachments.length === 0) continue;

      let changed = false;
      const normalized = attachments.map((att) => {
        if (!att.url || att.url.includes('cdn.serika.chat')) return att;
        changed = true;
        return { ...att, url: normalizeUrl(att.url) };
      });

      if (changed) {
        await BugReport.updateById(report.id, { attachments: normalized } as any);
        fixed++;
      }
    }

    await logAdminAction(user.id, 'update_settings', 'platform', 'bug-reports', {
      action: 'normalize_attachment_urls',
      reportsFixed: fixed,
    });

    return { success: true, reportsFixed: fixed };
  });
