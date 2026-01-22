import { Elysia, t } from 'elysia';
import { cors } from '@elysiajs/cors';
import { jwt } from '@elysiajs/jwt';
import { config } from '@/lib/config';
import { connectDB } from '@/lib/db';
import { authenticateRequest } from '@/lib/services/auth';
import { checkRateLimit, getClientIP } from '@/lib/security';
import { User, type IUser } from '@/lib/models';
import { authRoutes } from './auth';
import { serverRoutes, inviteRoutes } from './servers';
import { channelRoutes } from './channels';
import { uploadRoutes } from './uploads';
import { dmRoutes } from './dms';
import type { Types } from 'mongoose';

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

// Rate limiting middleware
const rateLimitPlugin = new Elysia({ name: 'rateLimit' })
  .derive(async ({ request }) => {
    const ip = getClientIP(request);
    const result = await checkRateLimit('api', ip);
    
    return {
      rateLimited: !result.success,
      retryAfter: result.retryAfter,
      remainingRequests: result.remaining,
    };
  })
  .onBeforeHandle(({ rateLimited, retryAfter, set }) => {
    if (rateLimited) {
      set.status = 429;
      set.headers['Retry-After'] = String(retryAfter);
      return {
        error: 'Too many requests',
        retryAfter,
      };
    }
  });

// User routes
const userRoutes = new Elysia({ prefix: '/users' })
  // Support both /me and /@me for compatibility
  .get('/me', async ({ headers, cookie, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    return {
      id: user._id,
      username: user.username,
      displayName: user.displayName,
      avatar: user.avatar,
      banner: user.banner,
      bio: user.bio,
      status: user.status,
      customStatus: user.customStatus,
      isPremium: user.isPremium,
      premiumSince: user.premiumSince,
      premiumTier: user.premiumTier,
      badges: user.badges || [],
      isVerified: user.isVerified,
      settings: user.settings,
      createdAt: user.createdAt,
    };
  })
  .get('/@me', async ({ headers, cookie, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    return {
      id: user._id,
      username: user.username,
      displayName: user.displayName,
      avatar: user.avatar,
      banner: user.banner,
      bio: user.bio,
      status: user.status,
      customStatus: user.customStatus,
      isPremium: user.isPremium,
      premiumSince: user.premiumSince,
      premiumTier: user.premiumTier,
      badges: user.badges || [],
      isVerified: user.isVerified,
      settings: user.settings,
      createdAt: user.createdAt,
    };
  })
  .get('/@me/servers', async ({ headers, cookie, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    // Import ServerMember to get user's servers
    const { ServerMember, Server } = await import('@/lib/models');
    
    const memberships = await ServerMember.find({ userId: user._id })
      .populate({
        path: 'serverId',
        select: 'name icon description memberCount isOfficial isVerified vanityUrlCode ownerId',
      });

    const servers = memberships
      .filter(m => m.serverId) // Filter out any null references
      .map(m => {
        const server = m.serverId as any;
        return {
          id: server._id,
          name: server.name,
          icon: server.icon,
          description: server.description,
          memberCount: server.memberCount,
          isOfficial: server.isOfficial,
          isVerified: server.isVerified,
          vanityUrlCode: server.vanityUrlCode,
          isOwner: server.ownerId?.toString() === user._id.toString(),
          joinedAt: m.joinedAt,
          roles: m.roles,
          nickname: m.nickname,
        };
      });

    return servers;
  })
  .put('/me', async ({ headers, cookie, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { displayName, bio, customStatus, status, settings } = body;

    if (displayName !== undefined) user.displayName = displayName;
    if (bio !== undefined) user.bio = bio;
    if (customStatus !== undefined) user.customStatus = customStatus;
    if (status !== undefined) user.status = status;
    if (settings !== undefined) {
      // Deep merge settings preserving existing values
      const currentSettings = user.settings;
      user.settings = {
        theme: settings.theme ?? currentSettings.theme,
        locale: settings.locale ?? currentSettings.locale,
        notifications: {
          desktop: settings.notifications?.desktop !== undefined 
            ? settings.notifications.desktop 
            : currentSettings.notifications.desktop,
          sounds: settings.notifications?.sounds !== undefined 
            ? settings.notifications.sounds 
            : currentSettings.notifications.sounds,
          mentions: settings.notifications?.mentions !== undefined 
            ? settings.notifications.mentions 
            : currentSettings.notifications.mentions,
        },
        privacy: {
          directMessages: settings.privacy?.directMessages ?? currentSettings.privacy.directMessages,
          friendRequests: settings.privacy?.friendRequests ?? currentSettings.privacy.friendRequests,
        },
      };
    }

    await user.save();

    return { success: true, user };
  }, {
    body: t.Object({
      displayName: t.Optional(t.String({ maxLength: 32 })),
      bio: t.Optional(t.String({ maxLength: 190 })),
      customStatus: t.Optional(t.String({ maxLength: 128 })),
      status: t.Optional(t.Union([
        t.Literal('online'),
        t.Literal('idle'),
        t.Literal('dnd'),
        t.Literal('invisible'),
      ])),
      settings: t.Optional(t.Object({
        theme: t.Optional(t.Union([
          t.Literal('dark'),
          t.Literal('light'),
          t.Literal('system'),
        ])),
        locale: t.Optional(t.String()),
        notifications: t.Optional(t.Object({
          desktop: t.Optional(t.Boolean()),
          sounds: t.Optional(t.Boolean()),
          mentions: t.Optional(t.Boolean()),
        })),
        privacy: t.Optional(t.Object({
          directMessages: t.Optional(t.Union([
            t.Literal('everyone'),
            t.Literal('friends'),
            t.Literal('servers'),
          ])),
          friendRequests: t.Optional(t.Union([
            t.Literal('everyone'),
            t.Literal('friends'),
            t.Literal('none'),
          ])),
        })),
      })),
    }),
  })
  .get('/:userId', async ({ params, set }) => {
    const user = await User.findById(params.userId).select('-settings -blockedUsers -pendingFriendRequests');

    if (!user) {
      set.status = 404;
      return { error: 'User not found' };
    }

    return {
      id: user._id,
      username: user.username,
      displayName: user.displayName,
      avatar: user.avatar,
      banner: user.banner,
      bio: user.bio,
      status: user.status,
      customStatus: user.customStatus,
      isPremium: user.isPremium,
      createdAt: user.createdAt,
    };
  }, {
    params: t.Object({
      userId: t.String(),
    }),
  });

// Friends routes
const friendsRoutes = new Elysia({ prefix: '/friends' })
  .get('/', async ({ headers, cookie, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const populatedUser = await User.findById(user._id)
      .populate('friends', 'username displayName avatar status customStatus isPremium badges createdAt')
      .populate('pendingFriendRequests.incoming', 'username displayName avatar status customStatus isPremium badges createdAt')
      .populate('pendingFriendRequests.outgoing', 'username displayName avatar status customStatus isPremium badges createdAt')
      .populate('blockedUsers', 'username displayName avatar');
    
    return {
      friends: (populatedUser?.friends || []).map((friend: any) => ({
        id: friend._id,
        username: friend.username,
        displayName: friend.displayName,
        avatar: friend.avatar,
        status: friend.status || 'offline',
        customStatus: friend.customStatus,
        isPremium: friend.isPremium,
        badges: friend.badges || [],
        createdAt: friend.createdAt,
      })),
      pending: {
        incoming: (populatedUser?.pendingFriendRequests?.incoming || []).map((u: any) => ({
          id: u._id,
          username: u.username,
          displayName: u.displayName,
          avatar: u.avatar,
          status: u.status || 'offline',
          customStatus: u.customStatus,
          isPremium: u.isPremium,
          badges: u.badges || [],
          createdAt: u.createdAt,
        })),
        outgoing: (populatedUser?.pendingFriendRequests?.outgoing || []).map((u: any) => ({
          id: u._id,
          username: u.username,
          displayName: u.displayName,
          avatar: u.avatar,
          status: u.status || 'offline',
          customStatus: u.customStatus,
          isPremium: u.isPremium,
          badges: u.badges || [],
          createdAt: u.createdAt,
        })),
      },
      blocked: (populatedUser?.blockedUsers || []).map((u: any) => ({
        id: u._id,
        username: u.username,
        displayName: u.displayName,
        avatar: u.avatar,
      })),
    };
  })
  // Add friend by username
  .post('/add', async ({ headers, cookie, body, request, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { username } = body;
    if (!username || typeof username !== 'string') {
      set.status = 400;
      return { error: 'Username is required' };
    }

    // Rate limit friend requests
    const ip = getClientIP(request);
    const rateLimit = await checkRateLimit('friendRequest', `${user._id}:${ip}`);
    if (!rateLimit.success) {
      set.status = 429;
      return { error: 'Too many friend requests', retryAfter: rateLimit.retryAfter };
    }

    // Find user by username (case insensitive)
    const targetUser = await User.findOne({ 
      username: { $regex: new RegExp(`^${username}$`, 'i') } 
    });
    
    if (!targetUser) {
      set.status = 404;
      return { error: `User "${username}" not found. Make sure you entered the correct username.` };
    }

    if (targetUser._id.equals(user._id)) {
      set.status = 400;
      return { error: 'You cannot send a friend request to yourself' };
    }

    // Check if already friends
    if (user.friends.some((f: Types.ObjectId) => f.equals(targetUser._id))) {
      set.status = 400;
      return { error: `You're already friends with ${targetUser.displayName || targetUser.username}` };
    }

    // Check if blocked
    if (user.blockedUsers.some((b: Types.ObjectId) => b.equals(targetUser._id))) {
      set.status = 400;
      return { error: 'You have blocked this user. Unblock them first to send a friend request.' };
    }

    // Check if target blocked the user
    if (targetUser.blockedUsers.some((b: Types.ObjectId) => b.equals(user._id))) {
      set.status = 403;
      return { error: 'Unable to send friend request to this user' };
    }

    // Check privacy settings
    if (targetUser.settings.privacy.friendRequests === 'none') {
      set.status = 403;
      return { error: `${targetUser.displayName || targetUser.username} is not accepting friend requests` };
    }

    // Check if request already pending
    if (user.pendingFriendRequests.outgoing.some((p: Types.ObjectId) => p.equals(targetUser._id))) {
      set.status = 400;
      return { error: `You already sent a friend request to ${targetUser.displayName || targetUser.username}` };
    }

    // Check if they sent us a request - auto-accept
    if (user.pendingFriendRequests.incoming.some((p: Types.ObjectId) => p.equals(targetUser._id))) {
      // Accept the friend request
      user.pendingFriendRequests.incoming = user.pendingFriendRequests.incoming.filter(
        (p: Types.ObjectId) => !p.equals(targetUser._id)
      );
      targetUser.pendingFriendRequests.outgoing = targetUser.pendingFriendRequests.outgoing.filter(
        (p: Types.ObjectId) => !p.equals(user._id)
      );
      
      user.friends.push(targetUser._id);
      targetUser.friends.push(user._id);

      await Promise.all([user.save(), targetUser.save()]);

      return { 
        success: true, 
        message: `You are now friends with ${targetUser.displayName || targetUser.username}!`,
        user: {
          id: targetUser._id,
          username: targetUser.username,
          displayName: targetUser.displayName,
          avatar: targetUser.avatar,
          status: targetUser.status,
        },
      };
    }

    // Send friend request
    user.pendingFriendRequests.outgoing.push(targetUser._id);
    targetUser.pendingFriendRequests.incoming.push(user._id);

    await Promise.all([user.save(), targetUser.save()]);

    return { 
      success: true, 
      message: `Friend request sent to ${targetUser.displayName || targetUser.username}` 
    };
  }, {
    body: t.Object({
      username: t.String({ minLength: 1 }),
    }),
  })
  // Accept friend request
  .post('/accept/:userId', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const targetUser = await User.findById(params.userId);
    if (!targetUser) {
      set.status = 404;
      return { error: 'User not found' };
    }

    // Check if there's a pending request
    if (!user.pendingFriendRequests.incoming.some((p: Types.ObjectId) => p.equals(targetUser._id))) {
      set.status = 400;
      return { error: 'No pending friend request from this user' };
    }

    // Accept the request
    user.pendingFriendRequests.incoming = user.pendingFriendRequests.incoming.filter(
      (p: Types.ObjectId) => !p.equals(targetUser._id)
    );
    targetUser.pendingFriendRequests.outgoing = targetUser.pendingFriendRequests.outgoing.filter(
      (p: Types.ObjectId) => !p.equals(user._id)
    );
    
    user.friends.push(targetUser._id);
    targetUser.friends.push(user._id);

    await Promise.all([user.save(), targetUser.save()]);

    return { 
      success: true, 
      message: `You are now friends with ${targetUser.displayName || targetUser.username}!`,
    };
  }, {
    params: t.Object({
      userId: t.String(),
    }),
  })
  // Cancel outgoing friend request
  .delete('/cancel/:userId', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const targetUser = await User.findById(params.userId);
    if (!targetUser) {
      set.status = 404;
      return { error: 'User not found' };
    }

    // Remove from outgoing
    user.pendingFriendRequests.outgoing = user.pendingFriendRequests.outgoing.filter(
      (p: Types.ObjectId) => !p.equals(targetUser._id)
    );
    targetUser.pendingFriendRequests.incoming = targetUser.pendingFriendRequests.incoming.filter(
      (p: Types.ObjectId) => !p.equals(user._id)
    );

    await Promise.all([user.save(), targetUser.save()]);

    return { success: true, message: 'Friend request cancelled' };
  }, {
    params: t.Object({
      userId: t.String(),
    }),
  })
  // Decline incoming friend request  
  .delete('/decline/:userId', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const targetUser = await User.findById(params.userId);
    if (!targetUser) {
      set.status = 404;
      return { error: 'User not found' };
    }

    // Remove from incoming
    user.pendingFriendRequests.incoming = user.pendingFriendRequests.incoming.filter(
      (p: Types.ObjectId) => !p.equals(targetUser._id)
    );
    targetUser.pendingFriendRequests.outgoing = targetUser.pendingFriendRequests.outgoing.filter(
      (p: Types.ObjectId) => !p.equals(user._id)
    );

    await Promise.all([user.save(), targetUser.save()]);

    return { success: true, message: 'Friend request declined' };
  }, {
    params: t.Object({
      userId: t.String(),
    }),
  })
  // Block user
  .post('/block/:userId', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const targetUser = await User.findById(params.userId);
    if (!targetUser) {
      set.status = 404;
      return { error: 'User not found' };
    }

    if (targetUser._id.equals(user._id)) {
      set.status = 400;
      return { error: 'You cannot block yourself' };
    }

    // Already blocked?
    if (user.blockedUsers.some((b: Types.ObjectId) => b.equals(targetUser._id))) {
      set.status = 400;
      return { error: 'User is already blocked' };
    }

    // Remove from friends if present
    user.friends = user.friends.filter((f: Types.ObjectId) => !f.equals(targetUser._id));
    targetUser.friends = targetUser.friends.filter((f: Types.ObjectId) => !f.equals(user._id));

    // Remove any pending requests
    user.pendingFriendRequests.incoming = user.pendingFriendRequests.incoming.filter(
      (p: Types.ObjectId) => !p.equals(targetUser._id)
    );
    user.pendingFriendRequests.outgoing = user.pendingFriendRequests.outgoing.filter(
      (p: Types.ObjectId) => !p.equals(targetUser._id)
    );
    targetUser.pendingFriendRequests.incoming = targetUser.pendingFriendRequests.incoming.filter(
      (p: Types.ObjectId) => !p.equals(user._id)
    );
    targetUser.pendingFriendRequests.outgoing = targetUser.pendingFriendRequests.outgoing.filter(
      (p: Types.ObjectId) => !p.equals(user._id)
    );

    // Add to blocked list
    user.blockedUsers.push(targetUser._id);

    await Promise.all([user.save(), targetUser.save()]);

    return { success: true, message: 'User blocked' };
  }, {
    params: t.Object({
      userId: t.String(),
    }),
  })
  // Unblock user
  .delete('/unblock/:userId', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const targetUser = await User.findById(params.userId);
    if (!targetUser) {
      set.status = 404;
      return { error: 'User not found' };
    }

    user.blockedUsers = user.blockedUsers.filter((b: Types.ObjectId) => !b.equals(targetUser._id));
    await user.save();

    return { success: true, message: 'User unblocked' };
  }, {
    params: t.Object({
      userId: t.String(),
    }),
  })
  // Remove friend
  .delete('/:userId', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const targetUser = await User.findById(params.userId);
    if (!targetUser) {
      set.status = 404;
      return { error: 'User not found' };
    }

    // Check if actually friends
    if (!user.friends.some((f: Types.ObjectId) => f.equals(targetUser._id))) {
      set.status = 400;
      return { error: 'You are not friends with this user' };
    }

    // Remove from friends
    user.friends = user.friends.filter((f: Types.ObjectId) => !f.equals(targetUser._id));
    targetUser.friends = targetUser.friends.filter((f: Types.ObjectId) => !f.equals(user._id));

    await Promise.all([user.save(), targetUser.save()]);

    return { success: true, message: 'Friend removed' };
  }, {
    params: t.Object({
      userId: t.String(),
    }),
  });

// Main API app
export const api = new Elysia({ prefix: '/api' })
  .use(cors({
    origin: (request): boolean => {
      const origin = request.headers.get('origin');
      if (!origin) return true;
      return config.ALLOWED_ORIGINS.some(allowed => 
        origin === allowed || origin.endsWith(`.${new URL(allowed).hostname}`)
      );
    },
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'x-auth-token'],
  }))
  .use(jwt({
    name: 'jwt',
    secret: config.JWT_SECRET,
  }))
  .use(rateLimitPlugin)
  .get('/health', () => ({ 
    status: 'ok', 
    service: 'serikacord',
    timestamp: new Date().toISOString(),
  }))
  .use(authRoutes)
  .use(userRoutes)
  .use(friendsRoutes)
  .use(serverRoutes)
  .use(inviteRoutes)
  .use(channelRoutes)
  .use(dmRoutes)
  .use(uploadRoutes);

// Initialize database connection
export async function initializeAPI() {
  await connectDB();
  console.log('✅ API initialized');
}

export type API = typeof api;

// Export the getAuth helper for other files
export { getAuth };
