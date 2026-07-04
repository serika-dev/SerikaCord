import { Elysia, t } from 'elysia';
import { cors } from '@elysiajs/cors';
import { jwt } from '@elysiajs/jwt';
import { config } from '@/lib/config';
import { connectDB } from '@/lib/db';
import { authenticateRequest, invalidateUserCache } from '@/lib/services/auth';
import { checkRateLimit, getClientIP, rejectInvalidObjectIdParams } from '@/lib/security';
import { User, type IUser, AuthorizedApp, UserDeviceSession, UserConnection } from '@/lib/models';
import { authRoutes } from './auth';
import { serverRoutes, inviteRoutes, partnerRoutes } from './servers';
import { channelRoutes } from './channels';
import { uploadRoutes } from './uploads';
import { dmRoutes } from './dms';
import { adminRoutes } from './admin';
import { oembedRoutes } from './oembed';
import { experimentRoutes, instanceRoutes } from './experiments';
import { voiceRoutes } from './voice';
import { gifRoutes } from './gifs';
import { ensureSerikaBroadcastUser } from '@/lib/services/serikaBroadcast';
import { resolveEffectiveStatus } from '@/lib/services/presence';
import { Types } from 'mongoose';

// Helper to safely compare IDs (handles both ObjectId and string)
function compareIds(id1: Types.ObjectId | string, id2: Types.ObjectId | string): boolean {
  const str1 = id1 instanceof Types.ObjectId ? id1.toString() : id1;
  const str2 = id2 instanceof Types.ObjectId ? id2.toString() : id2;
  return str1 === str2;
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

function getDefaultUserSettings() {
  return {
    theme: 'dark',
    locale: 'en-US',
    appearance: {
      theme: 'dark',
      themeStyle: 'dark',
      accentColor: '#8B5CF6',
      fontSize: 14,
      compactMode: false,
      showRoleColors: true,
      enableAnimations: true,
      saturation: 100,
    },
    notifications: {
      desktop: true,
      sounds: true,
      mentions: true,
      directMessages: true,
      friendRequests: true,
      muteEveryone: false,
    },
    privacy: {
      directMessages: 'everyone',
      friendRequests: 'everyone',
      showActivity: true,
      allowDataCollection: true,
    },
    accessibility: {
      reducedMotion: false,
      highContrast: false,
      dyslexicFont: false,
      messageSpacing: 'cozy',
      tts: false,
    },
    voiceVideo: {
      inputVolume: 100,
      outputVolume: 100,
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true,
      pushToTalk: false,
      pushToTalkKey: 'V',
      streamPreview: true,
    },
    textImages: {
      inlineMedia: true,
      inlineEmbeds: true,
      gifAutoplay: true,
      emojiPicker: true,
      stickerSuggestions: true,
    },
    keybinds: {
      enabled: true,
      preset: 'default',
      custom: {},
    },
    language: {
      locale: 'en-US',
      spellcheck: true,
    },
    friendRequests: {
      allowEveryone: true,
      allowFriendsOfFriends: true,
      allowServerMembers: true,
    },
    contentSocial: {
      explicitFilter: 'moderate',
      showSensitiveMedia: false,
    },
    dataPrivacy: {
      allowPersonalization: true,
      allowCrashReports: true,
    },
    advanced: {
      developerMode: false,
    },
  } as Record<string, any>;
}

const ALLOWED_APPEARANCE_THEMES = new Set(['light', 'dark', 'midnight']);

function normalizeUserSettingsShape(settings: Record<string, any>) {
  const next = mergeDeep(getDefaultUserSettings(), settings || {});
  if (!next.appearance || typeof next.appearance !== 'object') {
    next.appearance = { ...getDefaultUserSettings().appearance };
  }

  const rawTheme = next.appearance.theme ?? next.appearance.themeStyle;
  const theme = ALLOWED_APPEARANCE_THEMES.has(rawTheme) ? rawTheme : 'dark';
  next.appearance.theme = theme;
  next.appearance.themeStyle = theme;
  return next;
}

function normalizeSettingsPatch(patch: Record<string, any>) {
  const nextPatch: Record<string, any> = mergeDeep({}, patch || {});
  const appearancePatch = nextPatch.appearance;
  if (appearancePatch && typeof appearancePatch === 'object') {
    const requestedTheme = appearancePatch.theme ?? appearancePatch.themeStyle;
    if (requestedTheme !== undefined) {
      if (!ALLOWED_APPEARANCE_THEMES.has(requestedTheme)) {
        return {
          error: "appearance.theme must be one of 'light', 'dark', or 'midnight'",
          patch: null as Record<string, any> | null,
        };
      }
      appearancePatch.theme = requestedTheme;
      appearancePatch.themeStyle = requestedTheme;
    }
  }

  return { error: null as string | null, patch: nextPatch };
}

function mergeDeep<T extends Record<string, any>>(base: T, patch: Record<string, any>): T {
  const output = { ...base } as Record<string, any>;
  for (const [key, value] of Object.entries(patch || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      output[key] = mergeDeep((output[key] || {}) as Record<string, any>, value);
    } else if (value !== undefined) {
      output[key] = value;
    }
  }
  return output as T;
}

function getPublicPresenceStatus(user: { status?: string | null; presenceLastHeartbeatAt?: Date | string | number | null; isSystem?: boolean }) {
  return resolveEffectiveStatus({
    status: user.status,
    presenceLastHeartbeatAt: user.presenceLastHeartbeatAt ?? null,
    isSystem: user.isSystem,
  });
}

const activeFriendStreamConnections = new Map<string, Set<ReadableStreamDefaultController>>();

function emitFriendEvent(userIds: string[], payload: Record<string, unknown>) {
  const encoded = new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
  for (const userId of userIds) {
    const streams = activeFriendStreamConnections.get(userId);
    if (!streams) continue;
    streams.forEach((controller) => {
      try {
        controller.enqueue(encoded);
      } catch {
        streams.delete(controller);
      }
    });
    if (streams.size === 0) {
      activeFriendStreamConnections.delete(userId);
    }
  }
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
  .onBeforeHandle(rejectInvalidObjectIdParams)
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
        select: 'name icon banner description memberCount isOfficial isVerified isPartnered vanityUrlCode ownerId systemChannelId rulesChannelId afkChannelId afkTimeout',
      });

    const servers = memberships
      .filter(m => m.serverId) // Filter out any null references
      .map(m => {
        const server = m.serverId as any;
        return {
          id: server._id,
          name: server.name,
          icon: server.icon,
          banner: server.banner ?? null,
          description: server.description,
          memberCount: server.memberCount,
          isOfficial: server.isOfficial,
          isVerified: server.isVerified,
          isPartnered: Boolean(server.isPartnered),
          vanityUrlCode: server.vanityUrlCode,
          ownerId: server.ownerId?.toString() ?? null,
          isOwner: server.ownerId?.toString() === user._id.toString(),
          systemChannelId: server.systemChannelId?.toString() ?? null,
          rulesChannelId: server.rulesChannelId?.toString() ?? null,
          afkChannelId: server.afkChannelId?.toString() ?? null,
          afkTimeout: server.afkTimeout ?? 300,
          joinedAt: m.joinedAt,
          roles: m.roles,
          nickname: m.nickname,
        };
      });

    return servers;
  })
  .get('/@me/mentions', async ({ headers, cookie, set, query }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const { ServerMember, Message, Channel } = await import('@/lib/models');

      // Get all servers the user is a member of, plus their role IDs per server
      const memberships = await ServerMember.find({ userId: user._id }).select('serverId roles').lean();
      const serverIds = memberships.map(m => m.serverId);

      if (serverIds.length === 0) {
        return { servers: [], mentions: [] };
      }

      // Map serverId -> user's role IDs (for role mention matching)
      const serverToRoles = new Map<string, string[]>();
      for (const m of memberships) {
        serverToRoles.set(m.serverId.toString(), (m.roles || []).map((r: { toString(): string }) => r.toString()));
      }

      // Get all channels in those servers
      const channels = await Channel.find({ serverId: { $in: serverIds } }).select('_id serverId name').lean();
      const channelIds = channels.map(c => c._id);

      // Map channelId -> { serverId, name }
      const channelToServer = new Map<string, string>();
      const channelToName = new Map<string, string>();
      for (const c of channels) {
        channelToServer.set(c._id.toString(), c.serverId.toString());
        channelToName.set(c._id.toString(), c.name);
      }

      // Build mention query: direct user mentions, @everyone, or role mentions
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      // Collect all role IDs the user has across all servers
      const allUserRoleIds = new Set<string>();
      for (const roleIds of serverToRoles.values()) {
        for (const rid of roleIds) allUserRoleIds.add(rid);
      }

      const orConditions: Record<string, unknown>[] = [
        { mentionedUserIds: user._id },
        { mentionEveryone: true },
      ];
      if (allUserRoleIds.size > 0) {
        orConditions.push({ mentionedRoleIds: { $in: Array.from(allUserRoleIds) } });
      }

      // Optional server filter
      const serverFilter = (query as { serverId?: string })?.serverId;
      let filterChannelIds = channelIds;
      if (serverFilter) {
        filterChannelIds = channels.filter(c => c.serverId.toString() === serverFilter).map(c => c._id);
      }

      const mentionedMessages = await Message.find({
        channelId: { $in: filterChannelIds },
        isDeleted: false,
        createdAt: { $gte: sevenDaysAgo },
        $or: orConditions,
      })
        .select('content channelId createdAt authorId author')
        .sort({ createdAt: -1 })
        .limit(50)
        .lean();

      // Map channel -> serverId for filtering
      const serversWithMentions = new Set<string>();
      const mentions = mentionedMessages.map(msg => {
        const sid = channelToServer.get(msg.channelId.toString()) || '';
        if (sid) serversWithMentions.add(sid);
        const author = msg.author as unknown as { id?: string; _id?: string; username?: string; displayName?: string; avatar?: string } | undefined;
        return {
          id: (msg as { _id: { toString(): string } })._id.toString(),
          content: msg.content,
          channelId: msg.channelId.toString(),
          channelName: channelToName.get(msg.channelId.toString()) || '',
          serverId: sid,
          createdAt: msg.createdAt instanceof Date ? msg.createdAt.toISOString() : String(msg.createdAt),
          author: author ? {
            id: author.id || author._id?.toString() || '',
            username: author.username || '',
            displayName: author.displayName || author.username || '',
            avatar: author.avatar,
          } : null,
        };
      });

      return {
        servers: Array.from(serversWithMentions).map(id => ({ id })),
        mentions,
      };
    } catch (error) {
      console.error('Failed to fetch mentions:', error);
      return { servers: [], mentions: [] };
    }
  })
  .get('/@me/emojis', async ({ headers, cookie, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const { ServerMember, ServerEmoji, Server } = await import('@/lib/models');

      // Get all servers the user is a member of
      const memberships = await ServerMember.find({ userId: user._id }).select('serverId').lean();
      const serverIds = memberships.map(m => m.serverId);

      if (serverIds.length === 0) {
        return { emojis: [] };
      }

      // Get all emojis from all servers the user is in
      const emojis = await ServerEmoji.find({
        serverId: { $in: serverIds },
        available: true,
      }).lean();

      // Get server names for grouping
      const servers = await Server.find({ _id: { $in: serverIds } }).select('name').lean();
      const serverNameMap = new Map(servers.map(s => [s._id.toString(), s.name]));

      return {
        emojis: emojis.map(e => ({
          id: e._id.toString(),
          name: e.name,
          url: e.imageUrl,
          animated: e.animated,
          serverId: e.serverId.toString(),
          serverName: serverNameMap.get(e.serverId.toString()) || 'Unknown',
        })),
      };
    } catch (error) {
      console.error('Failed to fetch user emojis:', error);
      return { emojis: [] };
    }
  })
  .get('/@me/stickers', async ({ headers, cookie, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const { ServerMember, ServerSticker, Server } = await import('@/lib/models');

      // Get all servers the user is a member of
      const memberships = await ServerMember.find({ userId: user._id }).select('serverId').lean();
      const serverIds = memberships.map(m => m.serverId);

      if (serverIds.length === 0) {
        return { stickers: [] };
      }

      // Get all stickers from all servers the user is in
      const stickers = await ServerSticker.find({
        serverId: { $in: serverIds },
        available: true,
      }).sort({ createdAt: -1 }).lean();

      // Get server names for grouping
      const servers = await Server.find({ _id: { $in: serverIds } }).select('name').lean();
      const serverNameMap = new Map(servers.map(s => [s._id.toString(), s.name]));

      return {
        stickers: stickers.map(s => ({
          id: s._id.toString(),
          name: s.name,
          description: s.description,
          imageUrl: s.imageUrl,
          tags: s.tags || [],
          serverId: s.serverId.toString(),
          serverName: serverNameMap.get(s.serverId.toString()) || 'Unknown',
        })),
      };
    } catch (error) {
      console.error('Failed to fetch user stickers:', error);
      return { stickers: [] };
    }
  })
  .put('/me', async ({ headers, cookie, body, set }) => {
    const { user: authUser, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!authUser) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      // Fetch the actual Mongoose document for the user (authUser might be from external API)
      const userId = authUser._id || (authUser as unknown as { id: string }).id;
      const user = await User.findById(userId);
      
      if (!user) {
        set.status = 404;
        return { error: 'User not found in local database' };
      }

      const { displayName, bio, pronouns, customStatus, status, settings } = body as Record<string, any>;
      const prevStatus = user.status;

      if (displayName !== undefined) user.displayName = displayName;
      if (bio !== undefined) user.bio = bio;
      if (pronouns !== undefined) user.pronouns = pronouns;
      if (customStatus !== undefined) user.customStatus = customStatus;
      if (status !== undefined) {
        user.status = status;
        if (status === 'offline' || status === 'invisible') {
          user.presenceLastDisconnectAt = new Date();
        } else {
          user.presenceLastDisconnectAt = null;
          user.presenceLastHeartbeatAt = new Date();
        }
      }
      if (settings !== undefined) {
        const currentSettings = normalizeUserSettingsShape((user.settings || {}) as Record<string, any>);
        const normalizedPatch = normalizeSettingsPatch(settings);
        if (normalizedPatch.error) {
          set.status = 400;
          return { error: normalizedPatch.error };
        }
        user.settings = normalizeUserSettingsShape(mergeDeep(currentSettings, normalizedPatch.patch || {})) as any;
      }

      await user.save();
      
      // Invalidate user cache so fresh data is fetched
      await invalidateUserCache(userId.toString());

      if (status !== undefined && status !== prevStatus) {
        const friendIds = (user.friends || []).map((f: Types.ObjectId | string) =>
          f instanceof Types.ObjectId ? f.toString() : f
        );
        emitFriendEvent(friendIds, {
          type: 'presence:update',
          userId: user._id.toString(),
          status: getPublicPresenceStatus(user),
          timestamp: Date.now(),
        });
      }

      return { success: true, user };
    } catch (error) {
      console.error('Error updating user:', error);
      set.status = 500;
      return { error: 'Failed to update user profile' };
    }
  }, {
    body: t.Object({
      displayName: t.Optional(t.String({ maxLength: 32 })),
      bio: t.Optional(t.String({ maxLength: 190 })),
      pronouns: t.Optional(t.String({ maxLength: 32 })),
      customStatus: t.Optional(t.String({ maxLength: 128 })),
      status: t.Optional(t.Union([
        t.Literal('online'),
        t.Literal('idle'),
        t.Literal('dnd'),
        t.Literal('offline'),
        t.Literal('invisible'),
      ])),
      settings: t.Optional(t.Object({}, { additionalProperties: true })),
    }),
  })
  .post('/me/presence/heartbeat', async ({ headers, cookie, set }) => {
    const { user: authUser, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!authUser) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const user = await User.findById(authUser._id || (authUser as unknown as { id: string }).id);
    if (!user) {
      set.status = 404;
      return { error: 'User not found' };
    }

    const previousStatus = getPublicPresenceStatus(user);
    user.presenceLastHeartbeatAt = new Date();
    if (user.status !== 'offline' && user.status !== 'invisible') {
      user.presenceLastDisconnectAt = null;
    }
    await user.save();

    const nextStatus = getPublicPresenceStatus(user);
    if (previousStatus !== nextStatus) {
      const friendIds = (user.friends || []).map((friend: Types.ObjectId | string) =>
        friend instanceof Types.ObjectId ? friend.toString() : friend
      );
      emitFriendEvent(friendIds, {
        type: 'presence:update',
        userId: user._id.toString(),
        status: nextStatus,
        timestamp: Date.now(),
      });
    }

    return { success: true };
  })
  .get('/me/settings', async ({ headers, cookie, set }) => {
    const { user: authUser, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!authUser) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const user = await User.findById(authUser._id || (authUser as unknown as { id: string }).id);
    if (!user) {
      set.status = 404;
      return { error: 'User not found' };
    }

    return {
      settings: normalizeUserSettingsShape((user.settings || {}) as Record<string, any>),
    };
  })
  .patch('/me/settings', async ({ headers, cookie, body, set }) => {
    const { user: authUser, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!authUser) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const user = await User.findById(authUser._id || (authUser as unknown as { id: string }).id);
    if (!user) {
      set.status = 404;
      return { error: 'User not found' };
    }

    const payload = body as Record<string, any>;
    const currentSettings = normalizeUserSettingsShape((user.settings || {}) as Record<string, any>);

    let patch: Record<string, any> = payload;
    if (payload.section && payload.value !== undefined) {
      patch = { [payload.section]: payload.value };
    } else if (payload.settings && typeof payload.settings === 'object') {
      patch = payload.settings;
    }

    const normalizedPatch = normalizeSettingsPatch(patch);
    if (normalizedPatch.error) {
      set.status = 400;
      return { error: normalizedPatch.error };
    }

    user.settings = normalizeUserSettingsShape(mergeDeep(currentSettings, normalizedPatch.patch || {})) as any;
    await user.save();
    await invalidateUserCache(user._id.toString());

    return {
      success: true,
      settings: user.settings,
    };
  }, {
    body: t.Object({}, { additionalProperties: true }),
  })
  .get('/me/authorized-apps', async ({ headers, cookie, set }) => {
    const { user: authUser, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!authUser) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const apps = await AuthorizedApp.find({ userId: authUser._id }).sort({ updatedAt: -1 });
    return { apps };
  })
  .post('/me/authorized-apps', async ({ headers, cookie, body, set }) => {
    const { user: authUser, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!authUser) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const payload = body as Record<string, any>;
    const app = await AuthorizedApp.create({
      userId: authUser._id,
      name: payload.name,
      description: payload.description || null,
      icon: payload.icon || null,
      scopes: Array.isArray(payload.scopes) ? payload.scopes : [],
      approvedAt: new Date(),
      lastUsedAt: new Date(),
    });

    return { app };
  }, {
    body: t.Object({
      name: t.String({ minLength: 2, maxLength: 120 }),
      description: t.Optional(t.String({ maxLength: 300 })),
      icon: t.Optional(t.String()),
      scopes: t.Optional(t.Array(t.String())),
    }),
  })
  .delete('/me/authorized-apps/:appId', async ({ headers, cookie, params, set }) => {
    const { user: authUser, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!authUser) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    await AuthorizedApp.deleteOne({ _id: params.appId, userId: authUser._id });
    return { success: true };
  }, {
    params: t.Object({
      appId: t.String(),
    }),
  })
  .get('/me/devices', async ({ headers, cookie, set, request }) => {
    const { user: authUser, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!authUser) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const userAgent = request.headers.get('user-agent') || 'Unknown Device';
    const existingCurrent = await UserDeviceSession.findOne({ userId: authUser._id, current: true });
    if (!existingCurrent) {
      await UserDeviceSession.create({
        userId: authUser._id,
        deviceName: userAgent.slice(0, 120),
        platform: userAgent.includes('Mobile') ? 'Mobile' : 'Desktop',
        browser: userAgent.slice(0, 80),
        ipAddress: getClientIP(request),
        current: true,
        lastActiveAt: new Date(),
      });
    } else {
      existingCurrent.lastActiveAt = new Date();
      await existingCurrent.save();
    }

    const devices = await UserDeviceSession.find({ userId: authUser._id }).sort({ lastActiveAt: -1 });
    return { devices };
  })
  .delete('/me/devices/:deviceId', async ({ headers, cookie, params, set }) => {
    const { user: authUser, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!authUser) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    await UserDeviceSession.deleteOne({ _id: params.deviceId, userId: authUser._id, current: false });
    return { success: true };
  }, {
    params: t.Object({
      deviceId: t.String(),
    }),
  })
  .get('/me/connections', async ({ headers, cookie, set }) => {
    const { user: authUser, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!authUser) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const connections = await UserConnection.find({ userId: authUser._id }).sort({ createdAt: -1 });
    return { connections };
  })
  .post('/me/connections', async ({ headers, cookie, body, set }) => {
    const { user: authUser, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!authUser) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const payload = body as Record<string, any>;
    const connection = await UserConnection.findOneAndUpdate(
      { userId: authUser._id, provider: payload.provider, accountId: payload.accountId },
      {
        $set: {
          username: payload.username || null,
          displayName: payload.displayName || null,
          avatar: payload.avatar || null,
          metadata: payload.metadata || null,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return { connection };
  }, {
    body: t.Object({
      provider: t.Union([
        t.Literal('discord'),
        t.Literal('twitch'),
        t.Literal('youtube'),
        t.Literal('github'),
        t.Literal('spotify'),
        t.Literal('website'),
      ]),
      accountId: t.String({ minLength: 1 }),
      username: t.Optional(t.String()),
      displayName: t.Optional(t.String()),
      avatar: t.Optional(t.String()),
      metadata: t.Optional(t.Object({}, { additionalProperties: true })),
    }),
  })
  .delete('/me/connections/:connectionId', async ({ headers, cookie, params, set }) => {
    const { user: authUser, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!authUser) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    await UserConnection.deleteOne({ _id: params.connectionId, userId: authUser._id });
    return { success: true };
  }, {
    params: t.Object({
      connectionId: t.String(),
    }),
  })
  .get('/:userId', async ({ params, headers, cookie, set }) => {
    const targetUser = await User.findById(params.userId).select('-settings -blockedUsers -pendingFriendRequests');

    if (!targetUser) {
      set.status = 404;
      return { error: 'User not found' };
    }

    // Optionally check friend status if the requester is authenticated
    let isFriend = false;
    let friendRequestSent = false;
    try {
      const { user: requester } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
      if (requester) {
        isFriend = (requester.friends as Types.ObjectId[]).some((f) => compareIds(f, targetUser._id));
        const outgoing = (requester.pendingFriendRequests?.outgoing as Types.ObjectId[]) || [];
        friendRequestSent = outgoing.some((f) => compareIds(f, targetUser._id));
      }
    } catch {
      // Not authenticated — leave isFriend false
    }

    return {
      id: targetUser._id,
      username: targetUser.username,
      displayName: targetUser.displayName,
      avatar: targetUser.avatar,
      banner: targetUser.banner,
      bio: targetUser.bio,
      badges: targetUser.badges || [],
      status: getPublicPresenceStatus(targetUser),
      customStatus: targetUser.customStatus,
      isPremium: targetUser.isPremium,
      isSystem: targetUser.isSystem || false,
      createdAt: targetUser.createdAt,
      isFriend,
      friendRequestSent,
    };
  }, {
    params: t.Object({
      userId: t.String(),
    }),
  });

// Friends routes
const friendsRoutes = new Elysia({ prefix: '/friends' })
  .onBeforeHandle(rejectInvalidObjectIdParams)
  .get('/', async ({ headers, cookie, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const populatedUser = await User.findById(user._id)
      .populate('friends', 'username displayName avatar status customStatus isPremium badges createdAt presenceLastHeartbeatAt')
      .populate('pendingFriendRequests.incoming', 'username displayName avatar status customStatus isPremium badges createdAt presenceLastHeartbeatAt')
      .populate('pendingFriendRequests.outgoing', 'username displayName avatar status customStatus isPremium badges createdAt presenceLastHeartbeatAt')
      .populate('blockedUsers', 'username displayName avatar');
    
    return {
      friends: (populatedUser?.friends || []).map((friend: any) => ({
        id: friend._id,
        username: friend.username,
        displayName: friend.displayName,
        avatar: friend.avatar,
        status: getPublicPresenceStatus(friend),
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
          status: getPublicPresenceStatus(u),
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
          status: getPublicPresenceStatus(u),
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
  .get('/stream', async ({ headers, cookie }) => {
    const sseHeaders = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    };

    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      const errorStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'error', error: authError || 'Unauthorized' })}\n\n`));
          controller.close();
        },
      });
      return new Response(errorStream, { headers: sseHeaders });
    }

    let controllerRef: ReadableStreamDefaultController | null = null;
    let pingInterval: NodeJS.Timeout | null = null;
    const userKey = user._id.toString();

    const stream = new ReadableStream({
      start(controller) {
        controllerRef = controller;
        if (!activeFriendStreamConnections.has(userKey)) {
          activeFriendStreamConnections.set(userKey, new Set());
        }
        activeFriendStreamConnections.get(userKey)!.add(controller);
        controller.enqueue(new TextEncoder().encode('data: {"type":"connected"}\n\n'));

        pingInterval = setInterval(() => {
          try {
            controller.enqueue(new TextEncoder().encode('data: {"type":"ping"}\n\n'));
          } catch {
            if (pingInterval) clearInterval(pingInterval);
            activeFriendStreamConnections.get(userKey)?.delete(controller);
          }
        }, 30000);
      },
      cancel() {
        if (pingInterval) clearInterval(pingInterval);
        if (controllerRef) {
          activeFriendStreamConnections.get(userKey)?.delete(controllerRef);
        }
      },
    });

    return new Response(stream, { headers: sseHeaders });
  })
  // Add friend by username
  .post('/add', async ({ headers, cookie, body, request, set }) => {
    const { user: authUser, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!authUser) {
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
    const rateLimit = await checkRateLimit('friendRequest', `${authUser._id}:${ip}`);
    if (!rateLimit.success) {
      set.status = 429;
      return { error: 'Too many friend requests', retryAfter: rateLimit.retryAfter };
    }

    // Fetch actual Mongoose documents for both users
    const user = await User.findById(authUser._id);
    if (!user) {
      set.status = 404;
      return { error: 'User not found' };
    }

    // Find user by username (case insensitive)
    const targetUser = await User.findOne({ 
      username: { $regex: new RegExp(`^${username}$`, 'i') } 
    });
    
    if (!targetUser) {
      set.status = 404;
      return { error: `User "${username}" not found. Make sure you entered the correct username.` };
    }

    if (compareIds(targetUser._id, user._id)) {
      set.status = 400;
      return { error: 'You cannot send a friend request to yourself' };
    }

    // Check if already friends
    if (user.friends.some((f: Types.ObjectId | string) => compareIds(f, targetUser._id))) {
      set.status = 400;
      return { error: `You're already friends with ${targetUser.displayName || targetUser.username}` };
    }

    // Check if blocked
    if (user.blockedUsers.some((b: Types.ObjectId | string) => compareIds(b, targetUser._id))) {
      set.status = 400;
      return { error: 'You have blocked this user. Unblock them first to send a friend request.' };
    }

    // Check if target blocked the user
    if (targetUser.blockedUsers.some((b: Types.ObjectId | string) => compareIds(b, user._id))) {
      set.status = 403;
      return { error: 'Unable to send friend request to this user' };
    }

    // Check privacy settings
    if (targetUser.settings.privacy.friendRequests === 'none') {
      set.status = 403;
      return { error: `${targetUser.displayName || targetUser.username} is not accepting friend requests` };
    }

    // Check if request already pending
    if (user.pendingFriendRequests.outgoing.some((p: Types.ObjectId | string) => compareIds(p, targetUser._id))) {
      set.status = 400;
      return { error: `You already sent a friend request to ${targetUser.displayName || targetUser.username}` };
    }

    // Check if they sent us a request - auto-accept
    if (user.pendingFriendRequests.incoming.some((p: Types.ObjectId | string) => compareIds(p, targetUser._id))) {
      // Accept the friend request
      user.pendingFriendRequests.incoming = user.pendingFriendRequests.incoming.filter(
        (p: Types.ObjectId | string) => !compareIds(p, targetUser._id)
      );
      targetUser.pendingFriendRequests.outgoing = targetUser.pendingFriendRequests.outgoing.filter(
        (p: Types.ObjectId | string) => !compareIds(p, user._id)
      );
      
      user.friends.push(targetUser._id);
      targetUser.friends.push(user._id);

      await Promise.all([user.save(), targetUser.save()]);
      emitFriendEvent([user._id.toString(), targetUser._id.toString()], { type: 'friends:update', timestamp: Date.now() });

      return { 
        success: true, 
        message: `You are now friends with ${targetUser.displayName || targetUser.username}!`,
        user: {
          id: targetUser._id,
          username: targetUser.username,
          displayName: targetUser.displayName,
          avatar: targetUser.avatar,
          status: getPublicPresenceStatus(targetUser),
        },
      };
    }

    // Send friend request
    user.pendingFriendRequests.outgoing.push(targetUser._id);
    targetUser.pendingFriendRequests.incoming.push(user._id);

    await Promise.all([user.save(), targetUser.save()]);
    emitFriendEvent([user._id.toString(), targetUser._id.toString()], { type: 'friends:update', timestamp: Date.now() });

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
    const { user: authUser, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!authUser) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    // Fetch actual Mongoose document
    const user = await User.findById(authUser._id);
    if (!user) {
      set.status = 404;
      return { error: 'User not found' };
    }

    const targetUser = await User.findById(params.userId);
    if (!targetUser) {
      set.status = 404;
      return { error: 'User not found' };
    }

    // Check if there's a pending request
    if (!user.pendingFriendRequests.incoming.some((p: Types.ObjectId | string) => compareIds(p, targetUser._id))) {
      set.status = 400;
      return { error: 'No pending friend request from this user' };
    }

    // Accept the request
    user.pendingFriendRequests.incoming = user.pendingFriendRequests.incoming.filter(
      (p: Types.ObjectId | string) => !compareIds(p, targetUser._id)
    );
    targetUser.pendingFriendRequests.outgoing = targetUser.pendingFriendRequests.outgoing.filter(
      (p: Types.ObjectId | string) => !compareIds(p, user._id)
    );
    
    user.friends.push(targetUser._id);
    targetUser.friends.push(user._id);

    await Promise.all([user.save(), targetUser.save()]);
    emitFriendEvent([user._id.toString(), targetUser._id.toString()], { type: 'friends:update', timestamp: Date.now() });

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
    const { user: authUser, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!authUser) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    // Fetch actual Mongoose document
    const user = await User.findById(authUser._id);
    if (!user) {
      set.status = 404;
      return { error: 'User not found' };
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
    emitFriendEvent([user._id.toString(), targetUser._id.toString()], { type: 'friends:update', timestamp: Date.now() });

    return { success: true, message: 'Friend request cancelled' };
  }, {
    params: t.Object({
      userId: t.String(),
    }),
  })
  // Decline incoming friend request  
  .delete('/decline/:userId', async ({ headers, cookie, params, set }) => {
    const { user: authUser, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!authUser) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    // Fetch actual Mongoose document
    const user = await User.findById(authUser._id);
    if (!user) {
      set.status = 404;
      return { error: 'User not found' };
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
    emitFriendEvent([user._id.toString(), targetUser._id.toString()], { type: 'friends:update', timestamp: Date.now() });

    return { success: true, message: 'Friend request declined' };
  }, {
    params: t.Object({
      userId: t.String(),
    }),
  })
  // Block user
  .post('/block/:userId', async ({ headers, cookie, params, set }) => {
    const { user: authUser, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!authUser) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    // Fetch actual Mongoose document
    const user = await User.findById(authUser._id);
    if (!user) {
      set.status = 404;
      return { error: 'User not found' };
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
    if (user.blockedUsers.some((b: Types.ObjectId | string) => compareIds(b, targetUser._id))) {
      set.status = 400;
      return { error: 'User is already blocked' };
    }

    // Remove from friends if present
    user.friends = user.friends.filter((f: Types.ObjectId | string) => !compareIds(f, targetUser._id));
    targetUser.friends = targetUser.friends.filter((f: Types.ObjectId | string) => !compareIds(f, user._id));

    // Remove any pending requests
    user.pendingFriendRequests.incoming = user.pendingFriendRequests.incoming.filter(
      (p: Types.ObjectId | string) => !compareIds(p, targetUser._id)
    );
    user.pendingFriendRequests.outgoing = user.pendingFriendRequests.outgoing.filter(
      (p: Types.ObjectId | string) => !compareIds(p, targetUser._id)
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
    emitFriendEvent([user._id.toString(), targetUser._id.toString()], { type: 'friends:update', timestamp: Date.now() });

    return { success: true, message: 'User blocked' };
  }, {
    params: t.Object({
      userId: t.String(),
    }),
  })
  // Unblock user
  .delete('/unblock/:userId', async ({ headers, cookie, params, set }) => {
    const { user: authUser, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!authUser) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    // Fetch actual Mongoose document
    const user = await User.findById(authUser._id);
    if (!user) {
      set.status = 404;
      return { error: 'User not found' };
    }

    const targetUser = await User.findById(params.userId);
    if (!targetUser) {
      set.status = 404;
      return { error: 'User not found' };
    }

    user.blockedUsers = user.blockedUsers.filter((b: Types.ObjectId | string) => !compareIds(b, targetUser._id));
    await user.save();
    emitFriendEvent([user._id.toString(), targetUser._id.toString()], { type: 'friends:update', timestamp: Date.now() });

    return { success: true, message: 'User unblocked' };
  }, {
    params: t.Object({
      userId: t.String(),
    }),
  })
  // Remove friend
  .delete('/:userId', async ({ headers, cookie, params, set }) => {
    const { user: authUser, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!authUser) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    // Fetch actual Mongoose document
    const user = await User.findById(authUser._id);
    if (!user) {
      set.status = 404;
      return { error: 'User not found' };
    }

    const targetUser = await User.findById(params.userId);
    if (!targetUser) {
      set.status = 404;
      return { error: 'User not found' };
    }

    // Check if actually friends
    if (!user.friends.some((f: Types.ObjectId | string) => compareIds(f, targetUser._id))) {
      set.status = 400;
      return { error: 'You are not friends with this user' };
    }

    // Remove from friends
    user.friends = user.friends.filter((f: Types.ObjectId | string) => !compareIds(f, targetUser._id));
    targetUser.friends = targetUser.friends.filter((f: Types.ObjectId | string) => !compareIds(f, user._id));

    await Promise.all([user.save(), targetUser.save()]);
    emitFriendEvent([user._id.toString(), targetUser._id.toString()], { type: 'friends:update', timestamp: Date.now() });

    return { success: true, message: 'Friend removed' };
  }, {
    params: t.Object({
      userId: t.String(),
    }),
  });

// Main API app
export const api = new Elysia({ prefix: '/api' })
  .onError(({ code, error, set }) => {
    console.error('API Error:', code, error);
    
    if (code === 'VALIDATION') {
      set.status = 400;
      return { error: 'Validation error', details: error.message };
    }
    
    if (code === 'NOT_FOUND') {
      set.status = 404;
      return { error: 'Not found' };
    }
    
    set.status = 500;
    return { error: 'Internal server error' };
  })
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
  .get('/platform/announcement', async () => {
    const { getPlatformSettings } = await import('@/lib/models/PlatformSettings');
    const settings = await getPlatformSettings();
    return {
      announcement: settings.globalAnnouncement || null,
      updatedAt: settings.announcementUpdatedAt || null,
      maintenanceMode: settings.maintenanceMode,
    };
  })
  .use(authRoutes)
  .use(userRoutes)
  .use(friendsRoutes)
  .use(serverRoutes)
  .use(inviteRoutes)
  .use(partnerRoutes)
  .use(channelRoutes)
  .use(dmRoutes)
  .use(voiceRoutes)
  .use(gifRoutes)
  .use(uploadRoutes)
  .use(adminRoutes)
  .use(oembedRoutes)
  .use(experimentRoutes)
  .use(instanceRoutes);

// Initialize database connection
export async function initializeAPI() {
  await connectDB();
  await ensureSerikaBroadcastUser();
  // Ensure system users exist
  const { ensureSystemUsers } = await import('@/lib/services/systemUsers');
  await ensureSystemUsers();
  console.log('✅ API initialized');
}

export type API = typeof api;

// Export the getAuth helper for other files
export { getAuth };
