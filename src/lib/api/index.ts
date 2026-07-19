import { Elysia, t } from 'elysia';
import { cors } from '@elysiajs/cors';
import { jwt } from '@elysiajs/jwt';
import { config } from '@/lib/config';
import { connectDB, cache } from '@/lib/db';
import { authenticateRequest, invalidateUserCache } from '@/lib/services/auth';
import { checkRateLimit, getClientIP, rejectInvalidObjectIdParams, decryptFromStorage } from '@/lib/security';
import { User, type IUser, AuthorizedApp, UserDeviceSession, UserConnection, ServerMember, Server, Role, ServerEmoji, ServerSticker, Channel, Message, BugReport } from '@/lib/models';
import { RichPresence } from '@/lib/models/RichPresence';
import { ActivityHistory } from '@/lib/models/ActivityHistory';
import { authRoutes } from './auth';
import { serverRoutes, inviteRoutes, partnerRoutes, computeOnlineCount } from './servers';
import { channelRoutes } from './channels';
import { uploadRoutes } from './uploads';
import { dmRoutes } from './dms';
import { adminRoutes } from './admin';
import { oembedRoutes } from './oembed';
import { experimentRoutes, instanceRoutes } from './experiments';
import { voiceRoutes } from './voice';
import { gifRoutes } from './gifs';
import { developerRoutes, oauth2Routes } from './developers';
import { botApiRoutes } from './botApi';
import { socialSdkRoutes } from './social-sdk';
import { ensureSerikaBroadcastUser } from '@/lib/services/serikaBroadcast';
import { resolveEffectiveStatus } from '@/lib/services/presence';
import { getMoeActivity } from '@/lib/services/moeActivity';
import { getLastFmNowPlaying } from '@/lib/services/lastfmService';
import { normalizeId } from '@/lib/db/normalizeId';
// Helper to safely compare IDs (normalizes MongoDB ObjectId format to UUID)
function compareIds(id1: string, id2: string): boolean {
  return normalizeId(id1) === normalizeId(id2);
}

const sseEncoder = new TextEncoder();

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
      showTimestamps: true,
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
      storeActivityHistory: true,
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
      soundboardVolume: 100,
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
  const output: Record<string, any> = {};
  // Copy base, skipping undefined values
  for (const [key, value] of Object.entries(base || {})) {
    if (value !== undefined) {
      output[key] = value;
    }
  }
  for (const [key, value] of Object.entries(patch || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      output[key] = mergeDeep((output[key] || {}) as Record<string, any>, value);
    } else if (value !== undefined) {
      output[key] = value;
    }
  }
  return output as T;
}

function getPublicPresenceStatus(user: { status?: string | null; presenceLastHeartbeatAt?: Date | string | number | null; isSystem?: boolean | null }) {
  return resolveEffectiveStatus({
    status: user.status,
    presenceLastHeartbeatAt: user.presenceLastHeartbeatAt ?? null,
    isSystem: user.isSystem,
  });
}

// Which rich-presence types should surface first on a profile. Games always win
// over IDEs/coding tools (devin, vscode, cursor, …) so "Playing a Game" is the
// primary card even when a coding session is also live.
const ACTIVITY_TYPE_PRIORITY: Record<string, number> = {
  game: 0,
};
function activityPriorityRank(type: string | null | undefined): number {
  return ACTIVITY_TYPE_PRIORITY[(type ?? 'other') as string] ?? 10;
}
function sortActivitiesByPriority<T extends { type?: string | null }>(activities: T[]): T[] {
  // Stable sort: game types float to the front, everything else keeps insertion order.
  return activities
    .map((a, i) => [a, i] as const)
    .sort((x, y) => {
      const d = activityPriorityRank(x[0].type) - activityPriorityRank(y[0].type);
      return d !== 0 ? d : x[1] - y[1];
    })
    .map(([a]) => a);
}

const activeFriendStreamConnections = new Map<string, Set<ReadableStreamDefaultController>>();

function emitFriendEvent(userIds: string[], payload: Record<string, unknown>) {
  const encoded = sseEncoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
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
  .onBeforeHandle(({ rateLimited, retryAfter, set, path }) => {
    // Skip rate limiting for admin routes — admin operations like broadcast
    // should never be throttled by per-IP limits.
    if (path.startsWith('/admin')) return;
    if (rateLimited) {
      set.status = 429;
      set.headers['Retry-After'] = String(retryAfter);
      return {
        error: 'Too many requests',
        retryAfter,
      };
    }
  });

// Internal service routes (communication from accounts.serika.dev)
const internalRoutes = new Elysia({ prefix: '/internal' })
  .post('/sync-user', async ({ headers, body, set }) => {
    const serviceKey = headers['x-service-key'];
    if (!config.ACCOUNTS_SERVICE_KEY || serviceKey !== config.ACCOUNTS_SERVICE_KEY) {
      set.status = 401;
      return { error: 'Invalid service key', success: false };
    }

    const payload = body as Record<string, any>;
    const userId = payload.accountsUserId;
    if (!userId) {
      set.status = 400;
      return { error: 'accountsUserId is required', success: false };
    }

    try {
      let user = await User.findById(userId);
      const userData = {
        username: payload.username,
        email: payload.email?.toLowerCase(),
        passwordHash: payload.password || null,
        avatar: payload.avatar || null,
        banner: payload.banner || null,
        isVerified: payload.isVerified ?? false,
        isPremium: payload.isPremium ?? false,
        discordId: payload.discordId || null,
        discordUsername: payload.discordUsername || null,
        isBanned: payload.isBanned ?? false,
        banReason: payload.banInfo?.reason || null,
        createdAt: payload.joinDate ? new Date(payload.joinDate) : new Date(),
      };

      let action = 'updated';
      if (user) {
        await User.updateById(userId, userData);
        const { invalidateUserCache } = await import('@/lib/services/auth');
        await invalidateUserCache(userId);
      } else {
        // Double check username uniqueness
        const existing = await User.findOne({ username: payload.username });
        if (existing) {
          user = await User.updateById(existing.id, { id: userId, ...userData }) || existing;
        } else {
          user = await User.create({
            id: userId,
            ...userData,
            status: 'offline',
          });
          action = 'created';
        }
      }

      // Sync serika.moe connection if present in sync payload
      if (payload.serikaMoeUsername) {
        const connData = {
          userId,
          provider: 'serika' as any,
          accountId: payload.serikaMoeUsername,
          displayName: payload.serikaMoeUsername,
          visible: true,
          metadata: { serikaMoeId: payload.serikaMoeId || null },
        };
        const existingConn = await UserConnection.findOne({ userId, provider: 'serika' as any });
        if (existingConn) {
          await UserConnection.updateById(existingConn.id, connData);
        } else {
          const crypto = await import('crypto');
          await UserConnection.create({
            ...connData,
            id: crypto.randomUUID(),
          });
        }
      }

      return { success: true, action };
    } catch (err: any) {
      console.error('Failed to handle /internal/sync-user:', err);
      set.status = 500;
      return { error: err.message, success: false };
    }
  }, {
    body: t.Object({
      accountsUserId: t.String({ maxLength: 64 }),
      username: t.Optional(t.String({ maxLength: 64 })),
      email: t.Optional(t.String({ maxLength: 320 })),
      password: t.Optional(t.Union([t.String({ maxLength: 512 }), t.Null()])),
      avatar: t.Optional(t.Union([t.String({ maxLength: 2048 }), t.Null()])),
      banner: t.Optional(t.Union([t.String({ maxLength: 2048 }), t.Null()])),
      isVerified: t.Optional(t.Boolean()),
      isPremium: t.Optional(t.Boolean()),
      isBanned: t.Optional(t.Boolean()),
      discordId: t.Optional(t.Union([t.String({ maxLength: 32 }), t.Null()])),
      discordUsername: t.Optional(t.Union([t.String({ maxLength: 64 }), t.Null()])),
      banInfo: t.Optional(t.Union([
        t.Object({ reason: t.Optional(t.Union([t.String({ maxLength: 1024 }), t.Null()])) }, { additionalProperties: true }),
        t.Null(),
      ])),
      joinDate: t.Optional(t.Union([t.String({ maxLength: 64 }), t.Null()])),
      serikaMoeUsername: t.Optional(t.Union([t.String({ maxLength: 128 }), t.Null()])),
      serikaMoeId: t.Optional(t.Union([t.String({ maxLength: 128 }), t.Null()])),
    }, { additionalProperties: true }),
  })
  .post('/update-profile', async ({ headers, body, set }) => {
    const serviceKey = headers['x-service-key'];
    if (!config.ACCOUNTS_SERVICE_KEY || serviceKey !== config.ACCOUNTS_SERVICE_KEY) {
      set.status = 401;
      return { error: 'Invalid service key', success: false };
    }

    const { email, updates } = body as { email: string; updates: Record<string, any> };
    if (!email || !updates) {
      set.status = 400;
      return { error: 'Email and updates are required', success: false };
    }

    try {
      const user = await User.findOne({ email: email.toLowerCase() });
      if (!user) {
        set.status = 404;
        return { error: 'User not found', success: false };
      }

      // If serikaMoeUsername or serikaMoeId is updated, sync local UserConnection
      if ('serikaMoeUsername' in updates || 'serikaMoeId' in updates) {
        const username = updates.serikaMoeUsername;
        const moeId = updates.serikaMoeId;

        if (username) {
          const connData = {
            userId: user.id,
            provider: 'serika' as any,
            accountId: username,
            displayName: username,
            visible: true,
            metadata: { serikaMoeId: moeId },
          };
          const existing = await UserConnection.findOne({ userId: user.id, provider: 'serika' as any });
          if (existing) {
            await UserConnection.updateById(existing.id, connData);
          } else {
            const crypto = await import('crypto');
            await UserConnection.create({
              ...connData,
              id: crypto.randomUUID(),
            });
          }
        } else {
          // Unlink: delete local connection if it exists
          const existing = await UserConnection.findOne({ userId: user.id, provider: 'serika' as any });
          if (existing) {
            await UserConnection.deleteById(existing.id);
          }
        }
      }

      // Sync other whitelisted fields to the local User model if needed
      const userUpdates: Record<string, any> = {};
      if ('isPremium' in updates) userUpdates.isPremium = updates.isPremium;
      if ('isVerified' in updates) userUpdates.isVerified = updates.isVerified;
      if ('isBanned' in updates) userUpdates.isBanned = updates.isBanned;
      if ('avatar' in updates) userUpdates.avatar = updates.avatar;
      if ('banner' in updates) userUpdates.banner = updates.banner;
      
      if (Object.keys(userUpdates).length > 0) {
        await User.updateById(user.id, userUpdates);
        const { invalidateUserCache } = await import('@/lib/services/auth');
        await invalidateUserCache(user.id);
      }

      return { success: true };
    } catch (err: any) {
      console.error('Failed to handle /internal/update-profile:', err);
      set.status = 500;
      return { error: err.message, success: false };
    }
  }, {
    body: t.Object({
      email: t.String({ maxLength: 320 }),
      updates: t.Object({
        serikaMoeUsername: t.Optional(t.Union([t.String({ maxLength: 128 }), t.Null()])),
        serikaMoeId: t.Optional(t.Union([t.String({ maxLength: 128 }), t.Null()])),
        isPremium: t.Optional(t.Boolean()),
        isVerified: t.Optional(t.Boolean()),
        isBanned: t.Optional(t.Boolean()),
        avatar: t.Optional(t.Union([t.String({ maxLength: 2048 }), t.Null()])),
        banner: t.Optional(t.Union([t.String({ maxLength: 2048 }), t.Null()])),
      }, { additionalProperties: true }),
    }, { additionalProperties: true }),
  })
  .post('/update-password', async ({ headers, body, set }) => {
    const serviceKey = headers['x-service-key'];
    if (!config.ACCOUNTS_SERVICE_KEY || serviceKey !== config.ACCOUNTS_SERVICE_KEY) {
      set.status = 401;
      return { error: 'Invalid service key', success: false };
    }

    const { email, password } = body as { email: string; password?: string };
    if (!email) {
      set.status = 400;
      return { error: 'Email is required', success: false };
    }

    try {
      const user = await User.findOne({ email: email.toLowerCase() });
      if (!user) {
        set.status = 404;
        return { error: 'User not found', success: false };
      }

      await User.updateById(user.id, { passwordHash: password || null });
      const { invalidateUserCache } = await import('@/lib/services/auth');
      await invalidateUserCache(user.id);

      return { success: true };
    } catch (err: any) {
      console.error('Failed to handle /internal/update-password:', err);
      set.status = 500;
      return { error: err.message, success: false };
    }
  }, {
    body: t.Object({
      email: t.String({ maxLength: 320 }),
      password: t.Optional(t.Union([t.String({ maxLength: 512 }), t.Null()])),
    }, { additionalProperties: true }),
  })
  .post('/delete-user', async ({ headers, body, set }) => {
    const serviceKey = headers['x-service-key'];
    if (!config.ACCOUNTS_SERVICE_KEY || serviceKey !== config.ACCOUNTS_SERVICE_KEY) {
      set.status = 401;
      return { error: 'Invalid service key', success: false };
    }

    const { email } = body as { email: string };
    if (!email) {
      set.status = 400;
      return { error: 'Email is required', success: false };
    }

    try {
      const user = await User.findOne({ email: email.toLowerCase() });
      if (!user) {
        set.status = 404;
        return { error: 'User not found', success: false };
      }

      await User.deleteById(user.id);
      const { invalidateUserCache } = await import('@/lib/services/auth');
      await invalidateUserCache(user.id);

      return { success: true };
    } catch (err: any) {
      console.error('Failed to handle /internal/delete-user:', err);
      set.status = 500;
      return { error: err.message, success: false };
    }
  }, {
    body: t.Object({
      email: t.String({ maxLength: 320 }),
    }, { additionalProperties: true }),
  });

// User routes
// Shared TypeBox fields for Serika RPC presence extensions (assets/buttons/app).
const rpcPresenceExtras = {
  applicationId: t.Optional(t.String({ maxLength: 64 })),
  assets: t.Optional(t.Object({
    largeImage: t.Optional(t.String({ maxLength: 512 })),
    largeText: t.Optional(t.String({ maxLength: 128 })),
    smallImage: t.Optional(t.String({ maxLength: 512 })),
    smallText: t.Optional(t.String({ maxLength: 128 })),
  })),
  buttons: t.Optional(t.Array(t.Object({
    label: t.String({ maxLength: 32 }),
    url: t.String({ maxLength: 512 }),
  }), { maxItems: 2 })),
  partyId: t.Optional(t.String({ maxLength: 128 })),
  partySize: t.Optional(t.Array(t.Number(), { minItems: 2, maxItems: 2 })),
};

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
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      avatar: user.avatar,
      banner: user.banner,
      bio: user.bio,
      pronouns: user.pronouns,
      timezone: user.timezone,
      showTimezone: user.showTimezone,
      status: user.status,
      customStatus: user.customStatus,
      isPremium: user.isPremium,
      premiumSince: user.premiumSince,
      premiumTier: user.premiumTier,
      badges: user.badges || [],
      isVerified: user.isVerified,
      settings: user.settings,
      customization: user.customization || {},
      gifFavorites: user.gifFavorites || [],
      emojiFavorites: user.emojiFavorites || [],
      createdAt: user.createdAt,
    };
  })
  .get('/@me', async ({ headers, cookie, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    // Fire-and-forget badge recalculation to keep auto-badges in sync
    const { recalculateUserBadges } = await import('@/lib/services/badges');
    const updatedBadges = await recalculateUserBadges(user.id);

    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      avatar: user.avatar,
      banner: user.banner,
      bio: user.bio,
      pronouns: user.pronouns,
      timezone: user.timezone,
      showTimezone: user.showTimezone,
      status: user.status,
      customStatus: user.customStatus,
      isPremium: user.isPremium,
      premiumSince: user.premiumSince,
      premiumTier: user.premiumTier,
      badges: updatedBadges || user.badges || [],
      isVerified: user.isVerified,
      settings: user.settings,
      customization: user.customization || {},
      gifFavorites: user.gifFavorites || [],
      emojiFavorites: user.emojiFavorites || [],
      createdAt: user.createdAt,
    };
  })
  .get('/@me/servers', async ({ headers, cookie, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    // Get user's servers
    const memberships = await ServerMember.find({ userId: user.id });

    // Batch fetch servers
    const serverIds = memberships.map(m => m.serverId);
    const servers = serverIds.length > 0 ? await Server.find({ id: { in: serverIds } }) : [];
    const serverMap = new Map(servers.map(s => [s.id, s]));

    const result = await Promise.all(memberships
      .filter(m => serverMap.has(m.serverId))
      .map(async (m) => {
        const server = serverMap.get(m.serverId) as any;
        const onlineCount = await computeOnlineCount(server.id);
        return {
          id: server.id,
          name: server.name,
          icon: server.icon,
          banner: server.banner ?? null,
          description: server.description,
          memberCount: server.memberCount,
          onlineCount,
          isOfficial: server.isOfficial,
          isVerified: server.isVerified,
          isPartnered: Boolean(server.isPartnered),
          vanityUrlCode: server.vanityUrlCode,
          ownerId: server.ownerId ?? null,
          isOwner: server.ownerId === user.id,
          systemChannelId: server.systemChannelId ?? null,
          rulesChannelId: server.rulesChannelId ?? null,
          afkChannelId: server.afkChannelId ?? null,
          afkTimeout: server.afkTimeout ?? 300,
          isAgeGated: server.isAgeGated ?? false,
          joinedAt: m.joinedAt,
          roles: m.roles,
          nickname: m.nickname,
        };
      }));

    return result;
  })
  .get('/@me/guilds', async ({ headers, cookie, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const memberships = await ServerMember.find({ userId: user.id });
    const serverIds = memberships.map(m => m.serverId);
    const [servers, allRoles] = await Promise.all([
      serverIds.length > 0 ? Server.find({ id: { in: serverIds } }) : [],
      serverIds.length > 0 ? Role.find({ serverId: { in: serverIds } }) : [],
    ]);
    const serverMap = new Map(servers.map(s => [s.id, s]));
    // Group roles by serverId for O(1) lookup
    const rolesByServer = new Map<string, any[]>();
    for (const role of allRoles as any[]) {
      const list = rolesByServer.get(role.serverId) || [];
      list.push(role);
      rolesByServer.set(role.serverId, list);
    }

    const results = [];
    for (const membership of memberships) {
      const server = serverMap.get(membership.serverId);
      if (!server) continue;
      
      let perms = 0n;
      if (server.ownerId === user.id) {
        perms = 8n | (1n << 3n);
      } else {
        const serverRoles = rolesByServer.get(server.id) || [];
        const memberRoles = serverRoles.filter(r => (membership.roles || []).includes(r.id) || r.isDefault);
        for (const role of memberRoles) {
          perms |= BigInt(role.permissions || '0');
        }
      }
      
      results.push({
        id: server.id,
        name: server.name,
        icon: server.icon ?? null,
        owner: server.ownerId === user.id,
        permissions: String(perms),
        features: server.features || [],
      });
    }

    return results;
  })
  .get('/@me/mentions', async ({ headers, cookie, set, query }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {

      // Get all servers the user is a member of, plus their role IDs per server
      const memberships = await ServerMember.find({ userId: user.id });
      const serverIds = memberships.map(m => m.serverId);

      if (serverIds.length === 0) {
        return { servers: [], mentions: [] };
      }

      // Map serverId -> user's role IDs (for role mention matching)
      const serverToRoles = new Map<string, string[]>();
      for (const m of memberships) {
        serverToRoles.set(m.serverId, (m.roles || []).map((r: string) => r));
      }

      // Get all channels in those servers
      const channels = await Channel.find({ serverId: { in: serverIds } });
      const channelIds = channels.map(c => c.id);

      // Map channelId -> { serverId, name }
      const channelToServer = new Map<string, string>();
      const channelToName = new Map<string, string>();
      for (const c of channels) {
        channelToServer.set(c.id, c.serverId ?? '');
        channelToName.set(c.id, c.name);
      }

      // Build mention query: direct user mentions, @everyone, or role mentions
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      // Collect all role IDs the user has across all servers
      const allUserRoleIds = new Set<string>();
      for (const roleIds of serverToRoles.values()) {
        for (const rid of roleIds) allUserRoleIds.add(rid);
      }

      // Optional server filter
      const serverFilter = (query as { serverId?: string })?.serverId;
      let filterChannelIds = channelIds;
      if (serverFilter) {
        filterChannelIds = channels.filter(c => c.serverId === serverFilter).map(c => c.id);
      }

      // Fetch recent mentioned messages - use DB-level date filter and limit
      const mentionedMessages = await Message.find({
        channelId: { in: filterChannelIds },
        isDeleted: false,
        createdAtAfter: sevenDaysAgo,
        _limit: 200,
      });

      // Filter by mention conditions in JS (can't do OR easily in Drizzle)
      const filteredMessages = mentionedMessages
        .filter(msg => {
          // Your own messages are never a mention *of you* — otherwise sending
          // an @everyone/@here or a role you hold pings yourself.
          if (compareIds(msg.authorId, user.id)) return false;
          const mentionedUsers = (msg as any).mentionedUserIds || [];
          const mentionEveryone = (msg as any).mentionEveryone || false;
          const mentionedRoles = (msg as any).mentionedRoleIds || [];
          if (mentionedUsers.includes(user.id)) return true;
          if (mentionEveryone) return true;
          if (allUserRoleIds.size > 0 && mentionedRoles.some((r: string) => allUserRoleIds.has(r))) return true;
          return false;
        })
        .slice(0, 50);

      // Batch fetch authors
      const authorIds = [...new Set(filteredMessages.map(m => m.authorId))];
      const authors = authorIds.length > 0 ? await User.find({ id: { in: authorIds } }) : [];
      const authorMap = new Map(authors.map(a => [a.id, a]));

      // Batch-decrypt all mention contents in parallel
      const decryptedMentionContents = await Promise.all(
        filteredMessages.map((msg) => decryptFromStorage(msg.content || ''))
      );

      // Map channel -> serverId for filtering
      const serversWithMentions = new Set<string>();
      const mentions = filteredMessages.map((msg, idx) => {
        const sid = channelToServer.get(msg.channelId) || '';
        if (sid) serversWithMentions.add(sid);
        const author = authorMap.get(msg.authorId);
        return {
          id: msg.id,
          content: decryptedMentionContents[idx],
          channelId: msg.channelId,
          channelName: channelToName.get(msg.channelId) || '',
          serverId: sid,
          createdAt: msg.createdAt instanceof Date ? msg.createdAt.toISOString() : String(msg.createdAt),
          author: author ? {
            id: author.id,
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
  // Cross-device read markers. GET seeds the unread engine on startup so unread
  // glow, mention counts and DM badges are consistent on every device; POST acks
  // a channel up to a message (server resolves the latest message if omitted).
  .get('/@me/read-states', async ({ headers, cookie, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    try {
      const { ChannelReadState } = await import('@/lib/models/ChannelReadState');
      const rows = await ChannelReadState.findByUser(user.id);
      return {
        readStates: rows.map((r) => ({
          channelId: r.channelId,
          lastReadMessageId: r.lastReadMessageId,
          lastReadAt: r.lastReadAt instanceof Date ? r.lastReadAt.toISOString() : r.lastReadAt,
        })),
      };
    } catch (error) {
      console.error('Failed to fetch read states:', error);
      return { readStates: [] };
    }
  })
  // Lightweight seed for the unread engine: every text channel the user can see,
  // with its server id and last-activity time. Combined with /@me/read-states
  // this lets the client compute per-server unread (the white rail pill) on load
  // for ALL servers — not just the one currently open. One membership query +
  // one channel query; no message joins (channel.updatedAt bumps on send).
  .get('/@me/channel-activity', async ({ headers, cookie, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    try {
      const memberships = await ServerMember.find({ userId: user.id });
      const serverIds = memberships.map((m) => m.serverId);
      if (serverIds.length === 0) return { channels: [] };
      const channels = await Channel.find({ serverId: { in: serverIds }, type: 'text' });
      return {
        channels: channels.map((c) => ({
          channelId: c.id,
          serverId: c.serverId,
          lastMessageAt: c.updatedAt instanceof Date ? c.updatedAt.toISOString() : c.updatedAt,
        })),
      };
    } catch (error) {
      console.error('Failed to fetch channel activity:', error);
      return { channels: [] };
    }
  })
  .post('/@me/read-states', async ({ headers, cookie, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    try {
      const { channelId, messageId } = body as { channelId: string; messageId?: string };
      if (!channelId) {
        set.status = 400;
        return { error: 'channelId is required' };
      }
      const { ChannelReadState } = await import('@/lib/models/ChannelReadState');

      // Resolve the marker: an explicit messageId (preferred) or the channel's
      // current latest message. Fall back to "now" for an empty channel.
      let readMessageId: string | null = messageId ?? null;
      let readAt = new Date();
      const target = messageId
        ? await Message.findById(messageId)
        : (await Message.find({ channelId, isDeleted: false, _limit: 1 }))[0]; // default order is newest-first
      if (target) {
        readMessageId = target.id;
        readAt = target.createdAt instanceof Date ? target.createdAt : new Date(target.createdAt as any);
      }

      const row = await ChannelReadState.ack(user.id, channelId, readMessageId, readAt);
      const lastReadAtIso =
        (row?.lastReadAt instanceof Date ? row.lastReadAt.toISOString() : row?.lastReadAt) ?? readAt.toISOString();

      // Live cross-device sync: tell this user's OTHER open sessions the channel
      // was read so their badges clear immediately (not just on next reload).
      const { notifyReadState } = await import('@/lib/api/activity');
      notifyReadState(user.id, channelId, lastReadAtIso);

      return {
        ok: true,
        channelId,
        lastReadMessageId: row?.lastReadMessageId ?? readMessageId,
        lastReadAt: lastReadAtIso,
      };
    } catch (error) {
      console.error('Failed to ack read state:', error);
      set.status = 500;
      return { error: 'Failed to update read state' };
    }
  }, {
    body: t.Object({
      channelId: t.String(),
      messageId: t.Optional(t.String()),
    }),
  })
  // App-wide unread/activity stream. Emits a lightweight `channel_activity`
  // event whenever a message lands in any channel this user can see, so the
  // sidebar can glow / badge channels the user isn't currently viewing.
  //
  // In production the raw SSE fast-path in server.ts intercepts this path before
  // Next.js (avoids response buffering); this Elysia handler is the dev-mode and
  // fallback implementation. Both register into the same activity connection map.
  .get('/@me/activity', async ({ headers, cookie }) => {
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
          controller.enqueue(sseEncoder.encode(`data: ${JSON.stringify({ type: 'error', error: authError || 'Unauthorized' })}\n\n`));
          controller.close();
        },
      });
      return new Response(errorStream, { headers: sseHeaders });
    }

    const { registerActivityConnection } = await import('@/lib/api/activity');
    const encoder = new TextEncoder();
    let pingInterval: NodeJS.Timeout | null = null;
    let unregister: (() => void) | null = null;

    const stream = new ReadableStream({
      start(controller) {
        const write = (data: string) => {
          try { controller.enqueue(encoder.encode(data)); } catch { /* closed */ }
        };
        controller.enqueue(encoder.encode('data: {"type":"connected"}\n\n'));
        unregister = registerActivityConnection(user.id, write);
        pingInterval = setInterval(() => write('data: {"type":"ping"}\n\n'), 30000);
      },
      cancel() {
        if (pingInterval) clearInterval(pingInterval);
        unregister?.();
      },
    });

    return new Response(stream, { headers: sseHeaders });
  })
  .get('/@me/emojis', async ({ headers, cookie, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      // Get all servers the user is a member of, plus emojis and server names in parallel
      const memberships = await ServerMember.find({ userId: user.id });
      const serverIds = memberships.map(m => m.serverId);

      if (serverIds.length === 0) {
        return { emojis: [] };
      }

      const [emojis, servers] = await Promise.all([
        ServerEmoji.find({ serverId: { in: serverIds }, available: true }),
        Server.find({ id: { in: serverIds } }),
      ]);
      const serverDataMap = new Map(servers.map(s => [s.id, { name: s.name, icon: s.icon }]));

      return {
        emojis: emojis.map(e => {
          const serverData = serverDataMap.get(e.serverId);
          return {
            id: e.id,
            name: e.name,
            url: e.imageUrl,
            animated: e.animated,
            serverId: e.serverId,
            serverName: serverData?.name || 'Unknown',
            serverIcon: serverData?.icon || undefined,
          };
        }),
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
      // Get all servers the user is a member of
      const memberships = await ServerMember.find({ userId: user.id });
      const serverIds = memberships.map(m => m.serverId);

      if (serverIds.length === 0) {
        return { stickers: [] };
      }

      // Fetch stickers and server names in parallel
      const [stickers, servers] = await Promise.all([
        ServerSticker.find({ serverId: { in: serverIds }, available: true }),
        Server.find({ id: { in: serverIds } }),
      ]);
      // Sort by createdAt desc
      stickers.sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());

      const serverNameMap = new Map(servers.map(s => [s.id, s.name]));

      return {
        stickers: stickers.map(s => ({
          id: s.id,
          name: s.name,
          description: s.description,
          imageUrl: s.imageUrl,
          tags: s.tags || [],
          serverId: s.serverId,
          serverName: serverNameMap.get(s.serverId) || 'Unknown',
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
      // Fetch the actual user document
      const userId = (authUser as any).id || (authUser as any)._id;
      const user = await User.findById(userId);
      
      if (!user) {
        set.status = 404;
        return { error: 'User not found in local database' };
      }

      const { displayName, bio, pronouns, customStatus, status, settings, customization, gifFavorites, timezone, showTimezone } = body as Record<string, any>;
      const prevStatus = user.status;

      const updateFields: Record<string, any> = {};
      if (displayName !== undefined) updateFields.displayName = displayName;
      if (bio !== undefined) updateFields.bio = bio;
      if (pronouns !== undefined) updateFields.pronouns = pronouns;
      if (timezone !== undefined) updateFields.timezone = timezone || null;
      if (showTimezone !== undefined) updateFields.showTimezone = Boolean(showTimezone);
      if (customStatus !== undefined) updateFields.customStatus = customStatus;
      if (status !== undefined) {
        updateFields.status = status;
        if (status === 'offline' || status === 'invisible') {
          updateFields.presenceLastDisconnectAt = new Date();
        } else {
          updateFields.presenceLastDisconnectAt = null;
          updateFields.presenceLastHeartbeatAt = new Date();
        }
      }
      if (settings !== undefined) {
        const currentSettings = normalizeUserSettingsShape((user.settings || {}) as Record<string, any>);
        const normalizedPatch = normalizeSettingsPatch(settings);
        if (normalizedPatch.error) {
          set.status = 400;
          return { error: normalizedPatch.error };
        }
        updateFields.settings = normalizeUserSettingsShape(mergeDeep(currentSettings, normalizedPatch.patch || {})) as any;
      }
      if (customization !== undefined && typeof customization === 'object') {
        updateFields.customization = mergeDeep((user.customization || {}) as Record<string, any>, customization) as any;
      }
      if (gifFavorites !== undefined && Array.isArray(gifFavorites)) {
        updateFields.gifFavorites = gifFavorites.slice(0, 200).map((f: any) => ({
          url: String(f?.url || ''),
          title: String(f?.title || ''),
          source: String(f?.source || ''),
          addedAt: Number(f?.addedAt) || Date.now(),
        })).filter((f: any) => f.url);
      }

      const updatedUser = await User.updateById(userId, updateFields);
      
      // Invalidate user cache so fresh data is fetched
      await invalidateUserCache(userId);

      const finalUser = updatedUser || user;
      const changedProfile = customStatus !== undefined || displayName !== undefined || customization !== undefined || (status !== undefined && status !== prevStatus);
      if (changedProfile) {
        const friendIds = (finalUser.friends || []).map((f: string) => f);
        emitFriendEvent(friendIds, {
          type: 'presence:update',
          userId: finalUser.id,
          status: getPublicPresenceStatus(finalUser),
          customStatus: finalUser.customStatus || null,
          displayName: finalUser.displayName || finalUser.username,
          customization: finalUser.customization || null,
          timestamp: Date.now(),
        });
      }

      const freshUser = {
        id: finalUser.id,
        username: finalUser.username,
        displayName: finalUser.displayName,
        email: finalUser.email,
        avatar: finalUser.avatar,
        banner: finalUser.banner,
        bio: finalUser.bio,
        pronouns: finalUser.pronouns,
        timezone: finalUser.timezone,
        showTimezone: finalUser.showTimezone,
        status: finalUser.status,
        customStatus: finalUser.customStatus,
        isPremium: finalUser.isPremium,
        premiumSince: finalUser.premiumSince,
        premiumTier: finalUser.premiumTier,
        badges: finalUser.badges || [],
        isVerified: finalUser.isVerified,
        settings: finalUser.settings,
        customization: finalUser.customization || {},
        gifFavorites: finalUser.gifFavorites || [],
        createdAt: finalUser.createdAt,
      };
      return { success: true, user: freshUser };
    } catch (error) {
      console.error('Error updating user:', error);
      set.status = 500;
      return { error: 'Failed to update user profile' };
    }
  }, {
    body: t.Object({
      displayName: t.Optional(t.String({ maxLength: 32 })),
      bio: t.Optional(t.String({ maxLength: 1000 })),
      pronouns: t.Optional(t.String({ maxLength: 32 })),
      timezone: t.Optional(t.Union([t.String(), t.Null()])),
      showTimezone: t.Optional(t.Boolean()),
      customStatus: t.Optional(t.Union([t.String({ maxLength: 128 }), t.Null()])),
      status: t.Optional(t.Union([
        t.Literal('online'),
        t.Literal('idle'),
        t.Literal('dnd'),
        t.Literal('offline'),
        t.Literal('invisible'),
      ])),
      settings: t.Optional(t.Object({}, { additionalProperties: true })),
      customization: t.Optional(t.Object({}, { additionalProperties: true })),
      gifFavorites: t.Optional(t.Array(t.Object({
        url: t.String(),
        title: t.Optional(t.String()),
        source: t.Optional(t.String()),
        addedAt: t.Optional(t.Number()),
      }))),
    }),
  })
  .post('/me', async ({ headers, cookie, body, set }) => {
    const { user: authUser, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!authUser) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const userId = (authUser as any).id || (authUser as any)._id;
      const user = await User.findById(userId);
      
      if (!user) {
        set.status = 404;
        return { error: 'User not found in local database' };
      }

      // Parse body if it is sent as string (e.g. from text/plain beacon)
      let data = body as any;
      if (typeof body === 'string') {
        try {
          data = JSON.parse(body);
        } catch {
          // ignore
        }
      }

      const { displayName, bio, pronouns, customStatus, status, settings, customization, gifFavorites, timezone, showTimezone } = data || {};
      const prevStatus = user.status;

      const updateFields: Record<string, any> = {};
      if (displayName !== undefined) updateFields.displayName = displayName;
      if (bio !== undefined) updateFields.bio = bio;
      if (pronouns !== undefined) updateFields.pronouns = pronouns;
      if (timezone !== undefined) updateFields.timezone = timezone || null;
      if (showTimezone !== undefined) updateFields.showTimezone = Boolean(showTimezone);
      if (customStatus !== undefined) updateFields.customStatus = customStatus;
      if (status !== undefined) {
        updateFields.status = status;
        if (status === 'offline' || status === 'invisible') {
          updateFields.presenceLastDisconnectAt = new Date();
        } else {
          updateFields.presenceLastDisconnectAt = null;
          updateFields.presenceLastHeartbeatAt = new Date();
        }
      }
      if (settings !== undefined) {
        const currentSettings = normalizeUserSettingsShape((user.settings || {}) as Record<string, any>);
        const normalizedPatch = normalizeSettingsPatch(settings);
        if (!normalizedPatch.error) {
          updateFields.settings = normalizeUserSettingsShape(mergeDeep(currentSettings, normalizedPatch.patch || {})) as any;
        }
      }
      if (customization !== undefined && typeof customization === 'object') {
        updateFields.customization = mergeDeep((user.customization || {}) as Record<string, any>, customization) as any;
      }
      if (gifFavorites !== undefined && Array.isArray(gifFavorites)) {
        updateFields.gifFavorites = gifFavorites.slice(0, 200).map((f: any) => ({
          url: String(f?.url || ''),
          title: String(f?.title || ''),
          source: String(f?.source || ''),
          addedAt: Number(f?.addedAt) || Date.now(),
        })).filter((f: any) => f.url);
      }

      const updatedUser = await User.updateById(userId, updateFields);
      await invalidateUserCache(userId);

      const finalUser = updatedUser || user;
      const changedProfile = customStatus !== undefined || displayName !== undefined || customization !== undefined || (status !== undefined && status !== prevStatus);
      if (changedProfile) {
        const friendIds = (finalUser.friends || []).map((f: string) => f);
        emitFriendEvent(friendIds, {
          type: 'presence:update',
          userId: finalUser.id,
          status: getPublicPresenceStatus(finalUser),
          customStatus: finalUser.customStatus || null,
          displayName: finalUser.displayName || finalUser.username,
          customization: finalUser.customization || null,
          timestamp: Date.now(),
        });
      }

      const freshUser = {
        id: finalUser.id,
        username: finalUser.username,
        displayName: finalUser.displayName,
        email: finalUser.email,
        avatar: finalUser.avatar,
        banner: finalUser.banner,
        bio: finalUser.bio,
        pronouns: finalUser.pronouns,
        timezone: finalUser.timezone,
        showTimezone: finalUser.showTimezone,
        status: finalUser.status,
        customStatus: finalUser.customStatus,
        isPremium: finalUser.isPremium,
        premiumSince: finalUser.premiumSince,
        premiumTier: finalUser.premiumTier,
        badges: finalUser.badges || [],
        isVerified: finalUser.isVerified,
        settings: finalUser.settings,
        customization: finalUser.customization || {},
        gifFavorites: finalUser.gifFavorites || [],
        createdAt: finalUser.createdAt,
      };
      return { success: true, user: freshUser };
    } catch (error) {
      console.error('Error updating user via POST:', error);
      set.status = 500;
      return { error: 'Failed to update user profile' };
    }
  })
  .post('/me/presence/heartbeat', async ({ headers, cookie, set }) => {
    const { user: authUser, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!authUser) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const user = await User.findById((authUser as any).id || (authUser as any)._id);
    if (!user) {
      set.status = 404;
      return { error: 'User not found' };
    }

    const previousStatus = getPublicPresenceStatus(user);
    const updateFields: Record<string, any> = {
      presenceLastHeartbeatAt: new Date(),
    };
    if (user.status !== 'offline' && user.status !== 'invisible') {
      updateFields.presenceLastDisconnectAt = null;
    }
    const updatedUser = await User.updateById(user.id, updateFields) || user;

    const nextStatus = getPublicPresenceStatus(updatedUser);
    if (previousStatus !== nextStatus) {
      const friendIds = (updatedUser.friends || []).map((friend: string) => friend);
      emitFriendEvent(friendIds, {
        type: 'presence:update',
        userId: updatedUser.id,
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

    const user = await User.findById((authUser as any).id || (authUser as any)._id);
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

    const user = await User.findById((authUser as any).id || (authUser as any)._id);
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

    const newSettings = normalizeUserSettingsShape(mergeDeep(currentSettings, normalizedPatch.patch || {})) as any;
    const updatedUser = await User.updateById(user.id, { settings: newSettings });
    await invalidateUserCache(user.id);

    return {
      success: true,
      settings: newSettings,
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

    const apps = await AuthorizedApp.find({ userId: (authUser as any).id || (authUser as any)._id });
    // Sort by updatedAt desc
    apps.sort((a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime());
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
      userId: (authUser as any).id || (authUser as any)._id,
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

    await AuthorizedApp.deleteById(params.appId);
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
    const userId = (authUser as any).id || (authUser as any)._id;

    // Parse user agent for a friendly device name
    const isTauri = userAgent.includes('Tauri') || request.headers.get('x-serika-client') === 'tauri';
    let browser = 'Unknown Browser';
    let platform = 'Desktop';
    let deviceName = 'Unknown Device';

    if (isTauri) {
      deviceName = 'SerikaCord Desktop App';
      browser = 'Tauri';
      if (userAgent.includes('Windows')) platform = 'Windows';
      else if (userAgent.includes('Mac')) platform = 'macOS';
      else if (userAgent.includes('Linux')) platform = 'Linux';
    } else {
      // Detect browser
      if (userAgent.includes('Edg/')) browser = 'Edge';
      else if (userAgent.includes('OPR/') || userAgent.includes('Opera')) browser = 'Opera';
      else if (userAgent.includes('Chrome/') && !userAgent.includes('Edg/')) browser = 'Chrome';
      else if (userAgent.includes('Firefox/')) browser = 'Firefox';
      else if (userAgent.includes('Safari/') && !userAgent.includes('Chrome/')) browser = 'Safari';

      // Detect platform
      if (userAgent.includes('Android')) { platform = 'Android'; deviceName = `${browser} on Android`; }
      else if (userAgent.includes('iPhone') || userAgent.includes('iPad')) { platform = 'iOS'; deviceName = `${browser} on iOS`; }
      else if (userAgent.includes('Windows')) { platform = 'Windows'; deviceName = `${browser} on Windows`; }
      else if (userAgent.includes('Mac')) { platform = 'macOS'; deviceName = `${browser} on macOS`; }
      else if (userAgent.includes('Linux')) { platform = 'Linux'; deviceName = `${browser} on Linux`; }
      else deviceName = `${browser} on Desktop`;
    }

    if (isTauri) {
      deviceName = `SerikaCord Desktop (${platform})`;
    }

    // Match by UA fingerprint so the same browser/app reuses its session
    const uaFingerprint = userAgent.slice(0, 200);
    const existing = await UserDeviceSession.findOne({ userId, browser: uaFingerprint });

    // Unset any previous "current" sessions for this user
    await UserDeviceSession.updateMany({ userId, current: true }, { current: false });

    if (existing) {
      await UserDeviceSession.updateById(existing.id, {
        current: true,
        lastActiveAt: new Date(),
        deviceName,
        platform,
        browser: uaFingerprint,
        ipAddress: getClientIP(request),
      });
    } else {
      await UserDeviceSession.create({
        userId,
        deviceName,
        platform,
        browser: uaFingerprint,
        ipAddress: getClientIP(request),
        current: true,
        lastActiveAt: new Date(),
      });
    }

    const devices = await UserDeviceSession.find({ userId });
    devices.sort((a, b) => new Date(b.lastActiveAt ?? 0).getTime() - new Date(a.lastActiveAt ?? 0).getTime());
    return { devices };
  })
  .delete('/me/devices/:deviceId', async ({ headers, cookie, params, set }) => {
    const { user: authUser, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!authUser) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    await UserDeviceSession.deleteById(params.deviceId);
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

    const userId = (authUser as any).id || (authUser as any)._id;
    const connections = await UserConnection.find({ userId });

    // Fallback sync: if the user does not have a local 'serika' connection,
    // query the accounts service to see if they have a linked serika.moe account.
    const hasSerika = connections.some(c => c.provider === 'serika');
    if (!hasSerika) {
      try {
        const { accountsInternalGetUserByOriginalId } = await import('@/lib/services/accountsClient');
        const { ok, data } = await accountsInternalGetUserByOriginalId(userId);
        if (ok && data?.user?.serikaMoeUsername) {
          const accountId = data.user.serikaMoeUsername;
          const moeId = data.user.serikaMoeId || null;
          
          const connData = {
            userId,
            provider: 'serika' as any,
            accountId,
            displayName: accountId,
            visible: true,
            metadata: { serikaMoeId: moeId },
          };

          const crypto = await import('crypto');
          const newConn = await UserConnection.create({
            ...connData,
            id: crypto.randomUUID(),
          });
          if (newConn) {
            connections.push(newConn);
          }
        }
      } catch (err) {
        console.error('Failed to sync serika connection in GET /connections:', err);
      }
    }

    connections.sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
    return { connections };
  })
  .post('/me/connections', async ({ headers, cookie, body, set }) => {
    const { user: authUser, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!authUser) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const payload = body as Record<string, any>;
    const userId = (authUser as any).id || (authUser as any)._id;
    // Check if connection already exists
    let connection = await UserConnection.findOne({
      userId,
      provider: payload.provider,
      accountId: payload.accountId,
    });
    if (connection) {
      connection = await UserConnection.updateById(connection.id, {
        username: payload.username || null,
        displayName: payload.displayName || null,
        avatar: payload.avatar || null,
        metadata: payload.metadata || null,
      }) || connection;
    } else {
      connection = await UserConnection.create({
        userId,
        provider: payload.provider,
        accountId: payload.accountId,
        username: payload.username || null,
        displayName: payload.displayName || null,
        avatar: payload.avatar || null,
        metadata: payload.metadata || null,
      });
    }

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
        t.Literal('lastfm'),
        t.Literal('steam'),
        t.Literal('xbox'),
        t.Literal('psn'),
        t.Literal('roblox'),
        t.Literal('twitter'),
        t.Literal('instagram'),
        t.Literal('battlenet'),
        t.Literal('serika'),
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

    await UserConnection.deleteById(params.connectionId);
    return { success: true };
  }, {
    params: t.Object({
      connectionId: t.String(),
    }),
  })
  .patch('/me/connections/:connectionId', async ({ headers, cookie, params, body, set }) => {
    const { user: authUser, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!authUser) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const payload = body as Record<string, any>;
    const update: Record<string, any> = {};
    if (payload.visible !== undefined) {
      update.visible = Boolean(payload.visible);
    }

    const connection = await UserConnection.updateById(params.connectionId, update);

    if (!connection) {
      set.status = 404;
      return { error: 'Connection not found' };
    }

    return { connection };
  }, {
    params: t.Object({
      connectionId: t.String(),
    }),
    body: t.Object({
      visible: t.Optional(t.Boolean()),
    }),
  })
  .get('/:userId', async ({ params, headers, cookie, set }) => {
    const targetUser = await User.findById(params.userId);

    if (!targetUser) {
      set.status = 404;
      return { error: 'User not found' };
    }

    // Optionally check friend status if the requester is authenticated
    let isFriend = false;
    let friendRequestSent = false;
    let isSelf = false;
    try {
      const { user: requester } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
      if (requester) {
        isFriend = (requester.friends || []).some((f: string) => compareIds(f, targetUser.id));
        const outgoing = ((requester as any).pendingFriendRequests?.outgoing || []) as string[];
        friendRequestSent = outgoing.some((f: string) => compareIds(f, targetUser.id));
        isSelf = compareIds(requester.id, targetUser.id);
      }
    } catch {
      // Not authenticated — leave isFriend false
    }

    // Public connections — strip sensitive metadata (e.g. session keys)
    let connQuery: Record<string, any> = { userId: targetUser.id };
    if (!isSelf) {
      connQuery.visible = true;
    }
    const rawConnections = await UserConnection.find(connQuery);
    const connections = rawConnections.map((c) => ({
      provider: c.provider,
      accountId: c.accountId,
      username: c.username,
      displayName: c.displayName,
      avatar: c.avatar,
      visible: c.visible !== false,
    }));

    return {
      id: targetUser.id,
      username: targetUser.username,
      displayName: targetUser.displayName,
      avatar: targetUser.avatar,
      banner: targetUser.banner,
      bio: targetUser.bio,
      pronouns: targetUser.pronouns,
      timezone: targetUser.showTimezone ? targetUser.timezone : null,
      showTimezone: targetUser.showTimezone,
      badges: targetUser.badges || [],
      status: getPublicPresenceStatus(targetUser),
      customStatus: targetUser.customStatus,
      isPremium: targetUser.isPremium,
      isSystem: targetUser.isSystem || false,
      isBot: Boolean(targetUser.isBot),
      isVerified: Boolean(targetUser.isVerified),
      customization: targetUser.customization || {},
      createdAt: targetUser.createdAt,
      connections,
      isFriend,
      friendRequestSent,
    };
  }, {
    params: t.Object({
      userId: t.String(),
    }),
  })
  .get('/:userId/mutual-friends', async ({ params, headers, cookie, set }) => {
    const { user: requester, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!requester) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const targetUser = await User.findById(params.userId);
    if (!targetUser) {
      set.status = 404;
      return { error: 'User not found' };
    }

    const mutualFriendIds = (requester.friends || []).filter((f1: string) =>
      (targetUser.friends || []).some((f2: string) => compareIds(f1, f2))
    );

    const friends = await User.find({ id: { in: mutualFriendIds } });

    return friends.map((f) => ({
      id: f.id,
      username: f.username,
      displayName: f.displayName,
      avatar: f.avatar,
      status: getPublicPresenceStatus(f),
      customStatus: f.customStatus,
      customization: f.customization,
    }));
  }, {
    params: t.Object({
      userId: t.String(),
    }),
  })
  .get('/:userId/mutual-servers', async ({ params, headers, cookie, set }) => {
    const { user: requester, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!requester) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const targetUser = await User.findById(params.userId);
    if (!targetUser) {
      set.status = 404;
      return { error: 'User not found' };
    }

    const [requesterMemberships, targetMemberships] = await Promise.all([
      ServerMember.find({ userId: requester.id }),
      ServerMember.find({ userId: targetUser.id }),
    ]);

    const requesterServerIds = new Set(requesterMemberships.map((m) => m.serverId));
    const mutualServerIds = targetMemberships
      .map((m) => m.serverId)
      .filter((id) => requesterServerIds.has(id));

    const servers = mutualServerIds.length > 0 ? await Server.find({ id: { in: mutualServerIds } }) : [];

    return servers.map((s) => ({
      id: s.id,
      name: s.name,
      icon: s.icon,
      description: s.description,
      memberCount: s.memberCount,
      isPartnered: s.isPartnered,
    }));
  }, {
    params: t.Object({
      userId: t.String(),
    }),
  })
  // Live activity for a user: "now watching" (serika.moe), Last.fm scrobble, and game/rich presence.
  // Respects the target user's "show activity" privacy setting.
  .get('/:userId/activity', async ({ params, set }) => {
    // Short Redis cache to prevent DB pool exhaustion from 5s client polling.
    const cacheKey = `activity:${params.userId}`;
    const cached = await cache.get<string>(cacheKey).catch(() => null);
    if (cached) {
      set.headers['Content-Type'] = 'application/json';
      return cached as any;
    }

    const targetUser = await User.findById(params.userId);
    if (!targetUser) {
      set.status = 404;
      return { error: 'User not found' };
    }

    const showActivity = (targetUser.settings as any)?.privacy?.showActivity ?? true;
    if (!showActivity) {
      return { activity: null, music: null, game: null, activities: [] };
    }

    const userId = params.userId;

    // Fetch all three in parallel — each is wrapped so one failure doesn't crash the endpoint
    const now = new Date();
    const [watchActivity, richPresenceDocs, lastfmConnection] = await Promise.all([
      getMoeActivity(userId).catch(() => null),
      RichPresence.find({ userId: targetUser.id }).catch(() => []),
      UserConnection.findOne({ userId: targetUser.id, provider: 'lastfm' as any }).catch(() => null),
    ]);

    // Filter non-expired rich presence
    const activeRichPresence = richPresenceDocs.filter((doc: any) => doc.expiresAt && new Date(doc.expiresAt) > now);

    // Fetch Last.fm now playing if connected
    let music: import('@/lib/services/lastfmService').LastFmTrack | null = null;
    if (lastfmConnection?.accountId) {
      music = await getLastFmNowPlaying(lastfmConnection.accountId).catch(() => null);
    }

    const activities = sortActivitiesByPriority((activeRichPresence as any[]).map((doc) => ({
      type: doc.type,
      name: doc.name,
      details: doc.details ?? null,
      state: doc.state ?? null,
      largeImageUrl: doc.largeImageUrl ?? null,
      largeImageText: doc.largeImageText ?? null,
      smallImageUrl: doc.smallImageUrl ?? null,
      smallImageText: doc.smallImageText ?? null,
      startedAt: doc.startedAt ?? null,
      endsAt: doc.endsAt ?? null,
      applicationId: doc.applicationId ?? null,
      assets: doc.assets ?? null,
      buttons: doc.buttons ?? null,
    })));

    const result = {
      activity: watchActivity,
      music,
      game: activities[0] ?? null,
      activities,
    };

    // Cache for 5 seconds — short enough for live activity, long enough to dedupe concurrent polls
    await cache.set(cacheKey, JSON.stringify(result), 5).catch(() => {});

    return result;
  }, {
    params: t.Object({
      userId: t.String(),
    }),
  })
  // Public recent-activity history for a user's profile. Respects the target
  // user's "show activity" privacy setting (same gate as live activity).
  .get('/:userId/activity-history', async ({ params, query, set }) => {
    const targetUser = await User.findById(params.userId);
    if (!targetUser) {
      set.status = 404;
      return { error: 'User not found' };
    }
    const showActivity = (targetUser.settings as any)?.privacy?.showActivity ?? true;
    if (!showActivity) {
      return { activities: [] };
    }
    const rawLimit = Number((query as Record<string, string | undefined>).limit);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 30) : 12;
    const rows = await ActivityHistory.recent(targetUser.id, limit).catch(() => []);
    return {
      activities: sortActivitiesByPriority(rows.map((r) => ({
        type: r.type,
        name: r.name,
        imageUrl: r.imageUrl ?? null,
        firstSeenAt: r.firstSeenAt,
        lastSeenAt: r.lastSeenAt,
        durationSeconds: r.durationSeconds,
        sessions: r.sessions,
      }))),
    };
  }, {
    params: t.Object({ userId: t.String() }),
    query: t.Object({ limit: t.Optional(t.String()) }),
  })
  // Rich presence — reported by the SerikaCord desktop app
  .post('/me/rich-presence', async ({ headers, cookie, body, set }) => {
    const { user: authUser, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!authUser) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const raw = body as any;
    const incoming = Array.isArray(raw.activities)
      ? raw.activities.filter((a: any) => a?.name)
      : raw?.name ? [raw] : [];

    // Desktop app sends a heartbeat every 15s; TTL = 60s gives 3 missed beats before expiry
    const expiresAt = new Date(Date.now() + 60_000);
    const authUserId = (authUser as any).id || (authUser as any)._id;
    const activeKeys = new Set<string>();

    // Upsert each activity individually
    for (const item of incoming) {
      const type = item.type || 'other';
      const name = item.name;
      activeKeys.add(`${type}:${name}`);
      
      // Serika RPC extensions (assets/buttons/applicationId). Nullable and
      // optional so legacy desktop reports keep working unchanged.
      const rpcExtras = {
        applicationId: item.applicationId ?? null,
        assets: item.assets ?? null,
        buttons: item.buttons ?? null,
        partyId: item.partyId ?? null,
        partySize: item.partySize ?? null,
      };

      const existing = await RichPresence.findOne({ userId: authUserId, type, name });
      if (existing) {
        await RichPresence.updateById(existing.id, {
          details: item.details ?? null,
          state: item.state ?? null,
          largeImageUrl: item.largeImageUrl ?? null,
          largeImageText: item.largeImageText ?? null,
          smallImageUrl: item.smallImageUrl ?? null,
          smallImageText: item.smallImageText ?? null,
          startedAt: item.startedAt ? new Date(item.startedAt) : null,
          endsAt: item.endsAt ? new Date(item.endsAt) : null,
          expiresAt,
          ...rpcExtras,
        });
      } else {
        await RichPresence.create({
          userId: authUserId,
          type,
          name,
          details: item.details ?? null,
          state: item.state ?? null,
          largeImageUrl: item.largeImageUrl ?? null,
          largeImageText: item.largeImageText ?? null,
          smallImageUrl: item.smallImageUrl ?? null,
          smallImageText: item.smallImageText ?? null,
          startedAt: item.startedAt ? new Date(item.startedAt) : null,
          endsAt: item.endsAt ? new Date(item.endsAt) : null,
          expiresAt,
          ...rpcExtras,
        });
      }
    }

    // Anything not reported in this batch is no longer active.
    const allPresence = await RichPresence.find({ userId: authUserId });
    const toDelete = allPresence.filter((p: any) => {
      return !incoming.some((item: any) => (item.type || 'other') === p.type && item.name === p.name);
    });
    for (const p of toDelete) {
      await RichPresence.deleteById(p.id);
    }

    // Drop the cached activity snapshot so the next poll reflects this heartbeat
    // immediately (added/removed apps, e.g. closing Devin) instead of serving a
    // stale 5s copy.
    await cache.del(`activity:${authUserId}`).catch(() => {});

    // Persist to the recent-activity log unless the user disabled it. Games and
    // apps are worth remembering; skip transient "other" noise. Fire-and-forget
    // so history writes never slow down or fail the presence heartbeat.
    const storeHistory = (authUser as any)?.settings?.privacy?.storeActivityHistory ?? true;
    if (storeHistory) {
      for (const item of incoming) {
        const type = item.type || 'other';
        // Remember games and recognised apps; skip unclassified "other" noise.
        if (type === 'other') continue;
        ActivityHistory.record(authUserId, {
          type,
          name: item.name,
          imageUrl: item.largeImageUrl ?? null,
        }).catch(() => {});
      }
    }

    return { ok: true };
  }, {
    body: t.Union([
      t.Object({
        type: t.Optional(t.String()),
        name: t.String({ minLength: 1, maxLength: 128 }),
        details: t.Optional(t.String({ maxLength: 128 })),
        state: t.Optional(t.String({ maxLength: 128 })),
        largeImageUrl: t.Optional(t.String({ maxLength: 512 })),
        largeImageText: t.Optional(t.String({ maxLength: 128 })),
        smallImageUrl: t.Optional(t.String({ maxLength: 512 })),
        smallImageText: t.Optional(t.String({ maxLength: 128 })),
        startedAt: t.Optional(t.String()),
        endsAt: t.Optional(t.String()),
        ...rpcPresenceExtras,
      }),
      t.Object({
        activities: t.Array(t.Object({
          type: t.Optional(t.String()),
          name: t.String({ minLength: 1, maxLength: 128 }),
          details: t.Optional(t.String({ maxLength: 128 })),
          state: t.Optional(t.String({ maxLength: 128 })),
          largeImageUrl: t.Optional(t.String({ maxLength: 512 })),
          largeImageText: t.Optional(t.String({ maxLength: 128 })),
          smallImageUrl: t.Optional(t.String({ maxLength: 512 })),
          smallImageText: t.Optional(t.String({ maxLength: 128 })),
          startedAt: t.Optional(t.String()),
          endsAt: t.Optional(t.String()),
          ...rpcPresenceExtras,
        })),
      }),
    ]),
  })
  // Clear rich presence (sent by desktop app on exit)
  .delete('/me/rich-presence', async ({ headers, cookie, set }) => {
    const { user: authUser, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!authUser) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    const authUserId = (authUser as any).id || (authUser as any)._id;
    const allPresence = await RichPresence.find({ userId: authUserId });
    for (const p of allPresence) {
      await RichPresence.deleteById(p.id);
    }
    // Invalidate cache so the profile clears instantly on desktop app exit.
    await cache.del(`activity:${authUserId}`).catch(() => {});
    return { ok: true };
  })
  // Recent activity log — games/apps the user has played, newest first.
  .get('/me/activity-history', async ({ headers, cookie, query, set }) => {
    const { user: authUser, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!authUser) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    const authUserId = (authUser as any).id || (authUser as any)._id;
    const rawLimit = Number((query as Record<string, string | undefined>).limit);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 50) : 20;
    const rows = await ActivityHistory.recent(authUserId, limit);
    return {
      activities: sortActivitiesByPriority(rows.map((r) => ({
        type: r.type,
        name: r.name,
        imageUrl: r.imageUrl ?? null,
        firstSeenAt: r.firstSeenAt,
        lastSeenAt: r.lastSeenAt,
        durationSeconds: r.durationSeconds,
        sessions: r.sessions,
      }))),
    };
  }, {
    query: t.Object({ limit: t.Optional(t.String()) }),
  })
  // Clear the recent activity log.
  .delete('/me/activity-history', async ({ headers, cookie, set }) => {
    const { user: authUser, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!authUser) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    const authUserId = (authUser as any).id || (authUser as any)._id;
    await ActivityHistory.clear(authUserId);
    return { ok: true };
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

    // Batch fetch friends, pending requests, and blocked users
    const friendIds = (user.friends || []) as string[];
    const incomingIds = ((user as any).pendingFriendRequests?.incoming || []) as string[];
    const outgoingIds = ((user as any).pendingFriendRequests?.outgoing || []) as string[];
    const blockedIds = (user.blockedUsers || []) as string[];
    
    const allIds = [...new Set([...friendIds, ...incomingIds, ...outgoingIds, ...blockedIds])];
    const allUsers = allIds.length > 0 ? await User.find({ id: { in: allIds } }) : [];
    const userMap = new Map(allUsers.map(u => [u.id, u]));
    
    const mapUser = (id: string) => {
      const u = userMap.get(id);
      if (!u) return null;
      return {
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        avatar: u.avatar,
        status: getPublicPresenceStatus(u),
        customStatus: u.customStatus,
        isPremium: u.isPremium,
        badges: u.badges || [],
        createdAt: u.createdAt,
      };
    };
    
    const mapBlockedUser = (id: string) => {
      const u = userMap.get(id);
      if (!u) return null;
      return {
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        avatar: u.avatar,
      };
    };
    
    return {
      friends: friendIds.map(mapUser).filter(Boolean),
      pending: {
        incoming: incomingIds.map(mapUser).filter(Boolean),
        outgoing: outgoingIds.map(mapUser).filter(Boolean),
      },
      blocked: blockedIds.map(mapBlockedUser).filter(Boolean),
    };
  })
  .get('/active', async ({ headers, cookie, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const friendIds = (user.friends || []) as string[];
    if (friendIds.length === 0) return { active: [] };

    const friends = await User.find({ id: { in: friendIds } });
    const now = new Date();

    const activeEntries = await Promise.all(
      friends.map(async (friend) => {
        const showActivity = (friend.settings as any)?.privacy?.showActivity ?? true;
        if (!showActivity) return null;

        // Don't show offline users in Active Now
        const effectiveStatus = getPublicPresenceStatus(friend);
        if (effectiveStatus === 'offline') return null;

        const friendId = friend.id;
        const [watchActivity, richPresenceDocs, lastfmConnection] = await Promise.all([
          getMoeActivity(friendId).catch(() => null),
          RichPresence.find({ userId: friendId }).catch(() => []),
          UserConnection.findOne({ userId: friendId, provider: 'lastfm' as any }).catch(() => null),
        ]);

        const activeRichPresence = (richPresenceDocs as any[]).filter((doc) => doc.expiresAt && new Date(doc.expiresAt) > now);
        const activities = sortActivitiesByPriority(activeRichPresence.map((doc) => ({
          type: doc.type,
          name: doc.name,
          details: doc.details ?? null,
          state: doc.state ?? null,
          largeImageUrl: doc.largeImageUrl ?? null,
          largeImageText: doc.largeImageText ?? null,
          smallImageUrl: doc.smallImageUrl ?? null,
          smallImageText: doc.smallImageText ?? null,
          startedAt: doc.startedAt ?? null,
          endsAt: doc.endsAt ?? null,
          applicationId: doc.applicationId ?? null,
          assets: doc.assets ?? null,
          buttons: doc.buttons ?? null,
        })));

        let music: import('@/lib/services/lastfmService').LastFmTrack | null = null;
        if (lastfmConnection?.accountId) {
          music = await getLastFmNowPlaying(lastfmConnection.accountId).catch(() => null);
        }

        const hasActivity = watchActivity || activities.length > 0 || music;
        if (!hasActivity) return null;

        return {
          friend: {
            id: friend.id,
            username: friend.username,
            displayName: friend.displayName,
            avatar: friend.avatar,
            status: effectiveStatus,
            customStatus: friend.customStatus,
            isPremium: friend.isPremium,
            badges: friend.badges || [],
          },
          activity: {
            activity: watchActivity,
            music,
            game: activities[0] ?? null,
            activities,
          },
        };
      })
    );

    return { active: activeEntries.filter(Boolean) };
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
          controller.enqueue(sseEncoder.encode(`data: ${JSON.stringify({ type: 'error', error: authError || 'Unauthorized' })}\n\n`));
          controller.close();
        },
      });
      return new Response(errorStream, { headers: sseHeaders });
    }

    let controllerRef: ReadableStreamDefaultController | null = null;
    let pingInterval: NodeJS.Timeout | null = null;
    const userKey = user.id;

    const stream = new ReadableStream({
      start(controller) {
        controllerRef = controller;
        if (!activeFriendStreamConnections.has(userKey)) {
          activeFriendStreamConnections.set(userKey, new Set());
        }
        activeFriendStreamConnections.get(userKey)!.add(controller);
        controller.enqueue(sseEncoder.encode('data: {"type":"connected"}\n\n'));

        pingInterval = setInterval(() => {
          try {
            controller.enqueue(sseEncoder.encode('data: {"type":"ping"}\n\n'));
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
    const authUserId = (authUser as any).id || (authUser as any)._id;
    const rateLimit = await checkRateLimit('friendRequest', `${authUserId}:${ip}`);
    if (!rateLimit.success) {
      set.status = 429;
      return { error: 'Too many friend requests', retryAfter: rateLimit.retryAfter };
    }

    // Fetch actual user documents
    const user = await User.findById(authUserId);
    if (!user) {
      set.status = 404;
      return { error: 'User not found' };
    }

    // Find user by username (case insensitive - Drizzle doesn't support regex, so try exact then lowercased)
    let targetUser = await User.findOne({ username });
    if (!targetUser) {
      // Try case-insensitive by fetching all and filtering
      const allUsers = await User.find({});
      const found = allUsers.find(u => u.username.toLowerCase() === username.toLowerCase());
      if (found) targetUser = found;
    }
    
    if (!targetUser) {
      set.status = 404;
      return { error: `User "${username}" not found. Make sure you entered the correct username.` };
    }

    if (compareIds(targetUser.id, user.id)) {
      set.status = 400;
      return { error: 'You cannot send a friend request to yourself' };
    }

    // Block friend requests to system users
    if (targetUser.isSystem) {
      set.status = 403;
      return { error: 'You cannot send a friend request to a system user' };
    }

    // Check if already friends
    if ((user.friends || []).some((f: string) => compareIds(f, targetUser.id))) {
      set.status = 400;
      return { error: `You're already friends with ${targetUser.displayName || targetUser.username}` };
    }

    // Check if blocked
    if ((user.blockedUsers || []).some((b: string) => compareIds(b, targetUser.id))) {
      set.status = 400;
      return { error: 'You have blocked this user. Unblock them first to send a friend request.' };
    }

    // Check if target blocked the user
    if ((targetUser.blockedUsers || []).some((b: string) => compareIds(b, user.id))) {
      set.status = 403;
      return { error: 'Unable to send friend request to this user' };
    }

    // Check privacy settings
    if ((targetUser.settings as any)?.privacy?.friendRequests === 'none') {
      set.status = 403;
      return { error: `${targetUser.displayName || targetUser.username} is not accepting friend requests` };
    }

    // Check if request already pending
    const outgoing = ((user as any).pendingFriendRequests?.outgoing || []) as string[];
    if (outgoing.some((p: string) => compareIds(p, targetUser.id))) {
      set.status = 400;
      return { error: `You already sent a friend request to ${targetUser.displayName || targetUser.username}` };
    }

    // Check if they sent us a request - auto-accept
    const incoming = ((user as any).pendingFriendRequests?.incoming || []) as string[];
    if (incoming.some((p: string) => compareIds(p, targetUser.id))) {
      // Accept the friend request
      const newIncoming = incoming.filter((p: string) => !compareIds(p, targetUser.id));
      const targetOutgoing = ((targetUser as any).pendingFriendRequests?.outgoing || []) as string[];
      const newTargetOutgoing = targetOutgoing.filter((p: string) => !compareIds(p, user.id));
      
      const userFriends = [...(user.friends || []), targetUser.id];
      const targetFriends = [...(targetUser.friends || []), user.id];
      
      await Promise.all([
        User.updateById(user.id, {
          friends: userFriends,
          pendingFriendRequests: { incoming: newIncoming, outgoing },
        }),
        User.updateById(targetUser.id, {
          friends: targetFriends,
          pendingFriendRequests: { incoming: ((targetUser as any).pendingFriendRequests?.incoming || []), outgoing: newTargetOutgoing },
        }),
      ]);
      emitFriendEvent([user.id, targetUser.id], { type: 'friends:update', timestamp: Date.now() });

      return { 
        success: true, 
        message: `You are now friends with ${targetUser.displayName || targetUser.username}!`,
        user: {
          id: targetUser.id,
          username: targetUser.username,
          displayName: targetUser.displayName,
          avatar: targetUser.avatar,
          status: getPublicPresenceStatus(targetUser),
        },
      };
    }

    // Send friend request
    const newOutgoing = [...outgoing, targetUser.id];
    const targetIncoming = [...((targetUser as any).pendingFriendRequests?.incoming || []), user.id];

    await Promise.all([
      User.updateById(user.id, {
        pendingFriendRequests: { incoming, outgoing: newOutgoing },
      }),
      User.updateById(targetUser.id, {
        pendingFriendRequests: { incoming: targetIncoming, outgoing: ((targetUser as any).pendingFriendRequests?.outgoing || []) },
      }),
    ]);
    emitFriendEvent([user.id, targetUser.id], { type: 'friends:update', timestamp: Date.now() });

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

    // Fetch actual user document
    const user = await User.findById((authUser as any).id || (authUser as any)._id);
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
    const incoming = ((user as any).pendingFriendRequests?.incoming || []) as string[];
    if (!incoming.some((p: string) => compareIds(p, targetUser.id))) {
      set.status = 400;
      return { error: 'No pending friend request from this user' };
    }

    // Accept the request
    const newIncoming = incoming.filter((p: string) => !compareIds(p, targetUser.id));
    const targetOutgoing = ((targetUser as any).pendingFriendRequests?.outgoing || []) as string[];
    const newTargetOutgoing = targetOutgoing.filter((p: string) => !compareIds(p, user.id));
    
    const userFriends = [...(user.friends || []), targetUser.id];
    const targetFriends = [...(targetUser.friends || []), user.id];

    await Promise.all([
      User.updateById(user.id, {
        friends: userFriends,
        pendingFriendRequests: { incoming: newIncoming, outgoing: ((user as any).pendingFriendRequests?.outgoing || []) },
      }),
      User.updateById(targetUser.id, {
        friends: targetFriends,
        pendingFriendRequests: { incoming: ((targetUser as any).pendingFriendRequests?.incoming || []), outgoing: newTargetOutgoing },
      }),
    ]);
    emitFriendEvent([user.id, targetUser.id], { type: 'friends:update', timestamp: Date.now() });

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

    // Fetch actual user document
    const user = await User.findById((authUser as any).id || (authUser as any)._id);
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
    const outgoing = ((user as any).pendingFriendRequests?.outgoing || []) as string[];
    const newOutgoing = outgoing.filter((p: string) => !compareIds(p, targetUser.id));
    const targetIncoming = ((targetUser as any).pendingFriendRequests?.incoming || []) as string[];
    const newTargetIncoming = targetIncoming.filter((p: string) => !compareIds(p, user.id));

    await Promise.all([
      User.updateById(user.id, {
        pendingFriendRequests: { incoming: ((user as any).pendingFriendRequests?.incoming || []), outgoing: newOutgoing },
      }),
      User.updateById(targetUser.id, {
        pendingFriendRequests: { incoming: newTargetIncoming, outgoing: ((targetUser as any).pendingFriendRequests?.outgoing || []) },
      }),
    ]);
    emitFriendEvent([user.id, targetUser.id], { type: 'friends:update', timestamp: Date.now() });

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

    // Fetch actual user document
    const user = await User.findById((authUser as any).id || (authUser as any)._id);
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
    const incoming = ((user as any).pendingFriendRequests?.incoming || []) as string[];
    const newIncoming = incoming.filter((p: string) => !compareIds(p, targetUser.id));
    const targetOutgoing = ((targetUser as any).pendingFriendRequests?.outgoing || []) as string[];
    const newTargetOutgoing = targetOutgoing.filter((p: string) => !compareIds(p, user.id));

    await Promise.all([
      User.updateById(user.id, {
        pendingFriendRequests: { incoming: newIncoming, outgoing: ((user as any).pendingFriendRequests?.outgoing || []) },
      }),
      User.updateById(targetUser.id, {
        pendingFriendRequests: { incoming: ((targetUser as any).pendingFriendRequests?.incoming || []), outgoing: newTargetOutgoing },
      }),
    ]);
    emitFriendEvent([user.id, targetUser.id], { type: 'friends:update', timestamp: Date.now() });

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

    // Fetch actual user document
    const user = await User.findById((authUser as any).id || (authUser as any)._id);
    if (!user) {
      set.status = 404;
      return { error: 'User not found' };
    }

    const targetUser = await User.findById(params.userId);
    if (!targetUser) {
      set.status = 404;
      return { error: 'User not found' };
    }

    if (compareIds(targetUser.id, user.id)) {
      set.status = 400;
      return { error: 'You cannot block yourself' };
    }

    // Already blocked?
    if ((user.blockedUsers || []).some((b: string) => compareIds(b, targetUser.id))) {
      set.status = 400;
      return { error: 'User is already blocked' };
    }

    // Remove from friends if present
    const userFriends = (user.friends || []).filter((f: string) => !compareIds(f, targetUser.id));
    const targetFriends = (targetUser.friends || []).filter((f: string) => !compareIds(f, user.id));

    // Remove any pending requests
    const userIncoming = ((user as any).pendingFriendRequests?.incoming || []) as string[];
    const userOutgoing = ((user as any).pendingFriendRequests?.outgoing || []) as string[];
    const targetIncoming = ((targetUser as any).pendingFriendRequests?.incoming || []) as string[];
    const targetOutgoing = ((targetUser as any).pendingFriendRequests?.outgoing || []) as string[];

    const newUserIncoming = userIncoming.filter((p: string) => !compareIds(p, targetUser.id));
    const newUserOutgoing = userOutgoing.filter((p: string) => !compareIds(p, targetUser.id));
    const newTargetIncoming = targetIncoming.filter((p: string) => !compareIds(p, user.id));
    const newTargetOutgoing = targetOutgoing.filter((p: string) => !compareIds(p, user.id));

    // Add to blocked list
    const newBlockedUsers = [...(user.blockedUsers || []), targetUser.id];

    await Promise.all([
      User.updateById(user.id, {
        friends: userFriends,
        blockedUsers: newBlockedUsers,
        pendingFriendRequests: { incoming: newUserIncoming, outgoing: newUserOutgoing },
      }),
      User.updateById(targetUser.id, {
        friends: targetFriends,
        pendingFriendRequests: { incoming: newTargetIncoming, outgoing: newTargetOutgoing },
      }),
    ]);
    emitFriendEvent([user.id, targetUser.id], { type: 'friends:update', timestamp: Date.now() });

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

    // Fetch actual user document
    const user = await User.findById((authUser as any).id || (authUser as any)._id);
    if (!user) {
      set.status = 404;
      return { error: 'User not found' };
    }

    const targetUser = await User.findById(params.userId);
    if (!targetUser) {
      set.status = 404;
      return { error: 'User not found' };
    }

    const newBlockedUsers = (user.blockedUsers || []).filter((b: string) => !compareIds(b, targetUser.id));
    await User.updateById(user.id, { blockedUsers: newBlockedUsers });
    emitFriendEvent([user.id, targetUser.id], { type: 'friends:update', timestamp: Date.now() });

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

    // Fetch actual user document
    const user = await User.findById((authUser as any).id || (authUser as any)._id);
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
    if (!(user.friends || []).some((f: string) => compareIds(f, targetUser.id))) {
      set.status = 400;
      return { error: 'You are not friends with this user' };
    }

    // Remove from friends
    const userFriends = (user.friends || []).filter((f: string) => !compareIds(f, targetUser.id));
    const targetFriends = (targetUser.friends || []).filter((f: string) => !compareIds(f, user.id));

    await Promise.all([
      User.updateById(user.id, { friends: userFriends }),
      User.updateById(targetUser.id, { friends: targetFriends }),
    ]);
    emitFriendEvent([user.id, targetUser.id], { type: 'friends:update', timestamp: Date.now() });

    return { success: true, message: 'Friend removed' };
  }, {
    params: t.Object({
      userId: t.String(),
    }),
  });

// Bug Report routes (user-facing)
const bugReportRoutes = new Elysia({ prefix: '/bug-reports' })
  // Submit a new bug report
  .post('/', async ({ headers, cookie, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { kind, title, description, category, stepsToReproduce, expectedBehavior, actualBehavior, attachments, browserInfo, osInfo, appVersion } = body as any;

    const reportKind = kind === 'feedback' ? 'feedback' : 'bug';

    if (!title?.trim() || !description?.trim()) {
      set.status = 400;
      return { error: 'Title and description are required' };
    }

    if (title.trim().length > 200) {
      set.status = 400;
      return { error: 'Title must be 200 characters or less' };
    }

    if (description.trim().length > 5000) {
      set.status = 400;
      return { error: 'Description must be 5000 characters or less' };
    }

    // Rate limit: max 5 bug reports per hour per user
    const rateKey = `bug-report:${user.id}`;
    const rateLimit = await checkRateLimit('bugReport', rateKey);
    if (!rateLimit.success) {
      set.status = 429;
      return { error: 'You are submitting bug reports too quickly. Please try again later.' };
    }

    const report = await BugReport.create({
      reporterId: user.id,
      kind: reportKind,
      title: title.trim(),
      description: description.trim(),
      category: category || (reportKind === 'feedback' ? 'general' : 'other'),
      priority: 'low',
      status: 'open',
      // Repro/expected/actual are bug-only concepts; feedback ignores them.
      stepsToReproduce: reportKind === 'bug' ? (stepsToReproduce?.trim() || null) : null,
      expectedBehavior: reportKind === 'bug' ? (expectedBehavior?.trim() || null) : null,
      actualBehavior: reportKind === 'bug' ? (actualBehavior?.trim() || null) : null,
      attachments: attachments || [],
      browserInfo: browserInfo || null,
      osInfo: osInfo || null,
      appVersion: appVersion || null,
    });

    return { report };
  }, {
    body: t.Object({
      kind: t.Optional(t.String()),
      title: t.String(),
      description: t.String(),
      category: t.Optional(t.String()),
      stepsToReproduce: t.Optional(t.String()),
      expectedBehavior: t.Optional(t.String()),
      actualBehavior: t.Optional(t.String()),
      attachments: t.Optional(t.Array(t.Object({
        url: t.String(),
        type: t.String(),
        name: t.String(),
      }))),
      browserInfo: t.Optional(t.String()),
      osInfo: t.Optional(t.String()),
      appVersion: t.Optional(t.String()),
    }),
  })

  // List own bug reports
  .get('/me', async ({ headers, cookie, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const reports = await BugReport.find({ reporterId: user.id });
    const { normalizeUrl } = await import('@/lib/services/storage');
    const normalizedReports = reports.map((r) => {
      if (!r.attachments || !Array.isArray(r.attachments)) return r;
      return { ...r, attachments: r.attachments.map((att: any) => att?.url ? { ...att, url: normalizeUrl(att.url) } : att) };
    });
    return { reports: normalizedReports };
  })

  // Get a single bug report (only if owned by user)
  .get('/:id', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const report = await BugReport.findById(params.id);
    if (!report) {
      set.status = 404;
      return { error: 'Bug report not found' };
    }

    if (report.reporterId !== user.id) {
      set.status = 403;
      return { error: 'You can only view your own bug reports' };
    }

    const { normalizeUrl } = await import('@/lib/services/storage');
    const normalizedReport = report.attachments && Array.isArray(report.attachments)
      ? { ...report, attachments: report.attachments.map((att: any) => att?.url ? { ...att, url: normalizeUrl(att.url) } : att) }
      : report;
    return { report: normalizedReport };
  }, {
    params: t.Object({
      id: t.String(),
    }),
  })

  // Delete own bug report (only if open)
  .delete('/:id', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const report = await BugReport.findById(params.id);
    if (!report) {
      set.status = 404;
      return { error: 'Bug report not found' };
    }

    if (report.reporterId !== user.id) {
      set.status = 403;
      return { error: 'You can only delete your own bug reports' };
    }

    if (report.status === 'resolved' || report.status === 'wont_fix') {
      set.status = 400;
      return { error: 'Cannot delete a resolved or closed bug report' };
    }

    await BugReport.deleteById(params.id);
    return { success: true };
  }, {
    params: t.Object({
      id: t.String(),
    }),
  });

// Notifications routes
const notificationsRoutes = new Elysia({ prefix: '/notifications' })
  .get('/', async ({ headers, cookie, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      // Get all servers the user is a member of
      const memberships = await ServerMember.find({ userId: user.id });
      const serverIds = memberships.map(m => m.serverId);

      if (serverIds.length === 0) {
        return { notifications: [] };
      }

      // Map serverId -> user's role IDs (for role mention matching)
      const serverToRoles = new Map<string, string[]>();
      for (const m of memberships) {
        serverToRoles.set(m.serverId, (m.roles || []).map((r: string) => r));
      }

      // Get all channels in those servers
      const channels = await Channel.find({ serverId: { in: serverIds } });
      const channelIds = channels.map(c => c.id);

      // Map channelId -> { serverId, name }
      const channelToServer = new Map<string, string>();
      const channelToName = new Map<string, string>();
      for (const c of channels) {
        channelToServer.set(c.id, c.serverId ?? '');
        channelToName.set(c.id, c.name);
      }

      // Get server names
      const servers = await Server.find({ id: { in: serverIds } });
      const serverToName = new Map<string, string>();
      const serverToIcon = new Map<string, string>();
      for (const s of servers) {
        serverToName.set(s.id, s.name);
        serverToIcon.set(s.id, s.icon || '');
      }

      // Build mention query: direct user mentions, @everyone, or role mentions
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      // Collect all role IDs the user has across all servers
      const allUserRoleIds = new Set<string>();
      for (const roleIds of serverToRoles.values()) {
        for (const rid of roleIds) allUserRoleIds.add(rid);
      }

      // Fetch messages in channels and filter manually
      const mentionedMessages = await Message.find({
        channelId: { in: channelIds },
        isDeleted: false,
      });

      const filteredMessages = mentionedMessages
        .filter(msg => new Date(msg.createdAt ?? 0) >= sevenDaysAgo)
        .filter(msg => {
          const mentionedUsers = (msg as any).mentionedUserIds || [];
          const mentionEveryone = (msg as any).mentionEveryone || false;
          const mentionedRoles = (msg as any).mentionedRoleIds || [];
          if (mentionedUsers.includes(user.id)) return true;
          if (mentionEveryone) return true;
          if (allUserRoleIds.size > 0 && mentionedRoles.some((r: string) => allUserRoleIds.has(r))) return true;
          return false;
        })
        .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
        .slice(0, 50);

      // Batch fetch authors
      const authorIds = [...new Set(filteredMessages.map(m => m.authorId))];
      const authors = authorIds.length > 0 ? await User.find({ id: { in: authorIds } }) : [];
      const authorMap = new Map(authors.map(a => [a.id, a]));

      // Batch-decrypt all notification contents in parallel
      const decryptedNotifContents = await Promise.all(
        filteredMessages.map((msg) => decryptFromStorage(msg.content || ''))
      );

      const notifications = filteredMessages.map((msg, idx) => {
        const channelId = msg.channelId;
        const serverId = channelToServer.get(channelId) || '';
        const channelName = channelToName.get(channelId) || '';
        const serverName = serverToName.get(serverId) || '';
        const serverIcon = serverToIcon.get(serverId) || '';
        
        const author = authorMap.get(msg.authorId);

        // Determine mention type
        let mentionType = 'mention';
        if ((msg as any).mentionEveryone) {
          mentionType = 'everyone';
        }

        return {
          id: msg.id,
          type: 'mention' as const,
          title: author ? (author.displayName || author.username) : 'Unknown',
          description: `${mentionType === 'everyone' ? '@everyone' : 'mentioned you'} in #${channelName}`,
          avatar: author ? author.avatar : null,
          timestamp: msg.createdAt instanceof Date ? msg.createdAt.toISOString() : String(msg.createdAt),
          isRead: false,
          serverId,
          channelId,
          serverName,
          channelName,
          content: decryptedNotifContents[idx],
        };
      });

      return { notifications };
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
      return { notifications: [] };
    }
  })
  .post('/read-all', async ({ headers, cookie, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    // For now, just return success - read status tracking would need a notification model
    return { success: true };
  });

// IGDB proxy — resolves a running app/executable name to game metadata without
// ever exposing the Twitch credentials to the client (desktop rich presence).
const igdbRoutes = new Elysia({ prefix: '/igdb' })
  .get('/game', async ({ headers, cookie, query, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    const q = query as Record<string, string | undefined>;
    const name = q.name?.trim();
    const appId = q.appId?.trim();
    if (!name && !appId) {
      set.status = 400;
      return { error: 'Missing "name" or "appId" query parameter' };
    }
    const igdb = await import('@/lib/services/igdbService');
    // A Steam AppId resolves to the canonical English title/cover; otherwise
    // fall back to a plain name search.
    const game = appId
      ? await igdb.lookupGameBySteamAppId(appId, name)
      : await igdb.lookupGame(name!);
    return { game };
  }, {
    query: t.Object({
      name: t.Optional(t.String({ minLength: 1, maxLength: 128 })),
      appId: t.Optional(t.String({ minLength: 1, maxLength: 20 })),
    }),
  })
  .get('/games', async ({ headers, cookie, query, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    const q = query as Record<string, string | undefined>;
    const queryText = q.query?.trim();
    if (!queryText) {
      set.status = 400;
      return { error: 'Missing "query" parameter' };
    }
    const igdb = await import('@/lib/services/igdbService');
    const games = await igdb.searchGames(queryText, 3);
    return { games };
  }, {
    query: t.Object({
      query: t.String({ minLength: 1, maxLength: 128 }),
    }),
  });

// Per-user game library backing the profile game widgets (favorite / liked /
// rotation / wishlist). Session-authed; see docs/social-sdk-design.md §4.
const gameLibraryRoutes = new Elysia({ prefix: '/users' })
  .get('/:userId/games', async ({ headers, cookie, params, query, set }) => {
    const { user } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    const lib = await import('@/lib/services/gamesLibrary');
    const targetId = params.userId === '@me' ? user.id : params.userId;
    const category = (query as Record<string, string | undefined>).category;
    if (category) {
      if (!lib.isValidCategory(category)) { set.status = 400; return { error: 'Invalid category' }; }
      return { games: await lib.getUserCategory(targetId, category) };
    }
    return { library: await lib.getUserLibrary(targetId) };
  })
  .post('/@me/games', async ({ headers, cookie, body, set }) => {
    const { user } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    const lib = await import('@/lib/services/gamesLibrary');
    const b = body as { category: string; igdbId?: number; steamAppId?: string; name: string; coverUrl?: string; tags?: string[]; note?: string };
    if (!lib.isValidCategory(b.category)) { set.status = 400; return { error: 'Invalid category' }; }
    try {
      return { game: await lib.addGame(user.id, b.category, b) };
    } catch (e) {
      const err = e as { status?: number; message?: string };
      set.status = err.status || 400;
      return { error: err.message || 'Failed to add game' };
    }
  }, {
    body: t.Object({
      category: t.String(),
      igdbId: t.Optional(t.Number()),
      steamAppId: t.Optional(t.String({ maxLength: 20 })),
      name: t.String({ minLength: 1, maxLength: 256 }),
      coverUrl: t.Optional(t.String({ maxLength: 1024 })),
      tags: t.Optional(t.Array(t.String({ maxLength: 48 }), { maxItems: 12 })),
      note: t.Optional(t.String({ maxLength: 512 })),
    }),
  })
  .patch('/@me/games/:id', async ({ headers, cookie, params, body, set }) => {
    const { user } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    const lib = await import('@/lib/services/gamesLibrary');
    try {
      return { game: await lib.updateGame(user.id, params.id, body as { tags?: string[]; note?: string | null; coverUrl?: string | null }) };
    } catch (e) {
      const err = e as { status?: number; message?: string };
      set.status = err.status || 400;
      return { error: err.message || 'Failed to update game' };
    }
  }, {
    body: t.Object({
      tags: t.Optional(t.Array(t.String({ maxLength: 48 }), { maxItems: 12 })),
      note: t.Optional(t.Union([t.String({ maxLength: 512 }), t.Null()])),
      coverUrl: t.Optional(t.Union([t.String({ maxLength: 1024 }), t.Null()])),
    }),
  })
  .delete('/@me/games/:id', async ({ headers, cookie, params, set }) => {
    const { user } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    const lib = await import('@/lib/services/gamesLibrary');
    try {
      await lib.removeGame(user.id, params.id);
      return { success: true };
    } catch (e) {
      const err = e as { status?: number; message?: string };
      set.status = err.status || 400;
      return { error: err.message || 'Failed to remove game' };
    }
  })
  .post('/@me/games/reorder', async ({ headers, cookie, body, set }) => {
    const { user } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    const lib = await import('@/lib/services/gamesLibrary');
    const b = body as { category: string; orderedIds: string[] };
    if (!lib.isValidCategory(b.category)) { set.status = 400; return { error: 'Invalid category' }; }
    return { games: await lib.reorderCategory(user.id, b.category, b.orderedIds) };
  }, {
    body: t.Object({
      category: t.String(),
      orderedIds: t.Array(t.String(), { maxItems: 40 }),
    }),
  })

  // ── Profile widget placements (users.profileWidgets) ──────────────────────
  // Resolved list for rendering: built-ins pass through; app widgets are
  // hydrated with their published config + this user's dynamic data.
  .get('/:userId/profile-widgets', async ({ headers, cookie, params, set }) => {
    const { user } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    const targetId = params.userId === '@me' ? user.id : params.userId;
    const target = targetId === user.id ? user : await User.findById(targetId);
    if (!target) { set.status = 404; return { error: 'User not found' }; }
    const placements: any[] = Array.isArray((target as any).profileWidgets) ? (target as any).profileWidgets : [];
    const { WidgetConfig, WidgetUserData, Application } = await import('@/lib/models');
    const resolved = await Promise.all(placements.map(async (p) => {
      if (p.type !== 'application' || !p.applicationId) return { ...p };
      const config = await WidgetConfig.findByApplication(p.applicationId);
      if (!config) return null;
      // App owners can see their own widgets even in draft status
      if (config.status !== 'published') {
        const app = await Application.findById(p.applicationId);
        if (!app || app.ownerId !== user.id) return null;
      }
      const data = await WidgetUserData.findOne({ applicationId: p.applicationId, userId: targetId });
      return { ...p, config: { name: config.name, surfaces: config.surfaces }, data: data?.data ?? config.sampleData ?? null };
    }));
    return { widgets: resolved.filter(Boolean) };
  })
  .put('/@me/widgets', async ({ headers, cookie, body, set }) => {
    const { user } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    const widgets = ((body as any).widgets as any[]).map((w, i) => ({
      id: w.id || `${w.type}:${w.applicationId || w.builtin || i}`,
      type: w.type,
      applicationId: w.applicationId ?? null,
      builtin: w.builtin ?? null,
      position: i,
    }));
    await User.updateById(user.id, { profileWidgets: widgets });
    return { widgets };
  }, {
    body: t.Object({
      widgets: t.Array(t.Object({
        id: t.Optional(t.String()),
        type: t.String(),
        applicationId: t.Optional(t.Union([t.String(), t.Null()])),
        builtin: t.Optional(t.Union([t.String(), t.Null()])),
      }), { maxItems: 25 }),
    }),
  })

  // Published app widgets available to add to a profile (for the Add Widget modal).
  .get('/@me/available-widgets', async ({ headers, cookie, set }) => {
    const { user } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    const { db, schema } = await import('@/lib/db/postgres');
    const { eq, or } = await import('drizzle-orm');
    const rows = await db.select({
      applicationId: schema.widgetConfigs.applicationId,
      name: schema.widgetConfigs.name,
      icon: schema.applications.icon,
      appName: schema.applications.name,
    })
      .from(schema.widgetConfigs)
      .leftJoin(schema.applications, eq(schema.applications.id, schema.widgetConfigs.applicationId))
      .where(or(
        eq(schema.widgetConfigs.status, 'published'),
        eq(schema.applications.ownerId, user.id),
      ))
      .limit(50);
    return { widgets: rows };
  });

// Discord bridge self-service data controls.
const discordRoutes = new Elysia({ prefix: '/discord' })
  // Erase the authenticated user's bridged Discord data (messages + profile),
  // and turn off outbound sync. This is the web counterpart of the /forgetme
  // Discord slash command. Satisfies the "delete on user request" obligation in
  // Discord's Developer Terms of Service.
  .post('/forget-me', async ({ headers, cookie, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const fullUser = await User.findById(user.id);
    const discordId = fullUser?.discordId;

    let deletedMessages = 0;
    if (discordId) {
      try {
        const { deleteBridgedUserData } = await import('@/lib/discord/consent');
        const result = await deleteBridgedUserData(discordId, { forgetProfile: true });
        deletedMessages = result.deletedMessages;
      } catch (err) {
        console.error('[Discord] forget-me failed:', err);
        set.status = 500;
        return { error: 'Failed to erase data' };
      }
    }

    // Withdraw outbound consent so future Serika messages aren't forwarded either.
    const settings = { ...(fullUser?.settings as any || {}) };
    settings.dataPrivacy = { ...(settings.dataPrivacy || {}), discordBridgeOutbound: false };
    await User.updateById(user.id, { settings });

    return { success: true, deletedMessages, hadLinkedDiscord: Boolean(discordId) };
  });

// Main API app
export const api = new Elysia({ prefix: '/api' })
  .onError(({ code, error, set, request }) => {
    let path = '';
    try { path = new URL(request.url).pathname; } catch {}
    const method = request.method;
    console.error('API Error:', code, `${method} ${path}`, error);

    if (code === 'VALIDATION') {
      set.status = 400;
      return { error: 'Validation error', details: error.message };
    }

    if (code === 'NOT_FOUND') {
      set.status = 404;

      // Discord-compatible shape for the bot API so libraries parse it correctly.
      if (path.startsWith('/api/v10')) {
        return { message: '404: Not Found', code: 0 };
      }

      // Friendly, self-describing 404 for everything else.
      return {
        error: 'Not found',
        message: `No route matches ${path || 'this path'}. This is the SerikaCord API.`,
        documentation: `${config.API_BASE_URL}/developers/docs`,
        hint: 'Bot endpoints live under /api/v10 — see /api/v10 for an index.',
      };
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
  .get('/', () => ({
    message: 'Hi! This is the SerikaCord API — a Discord-compatible bot & app API.',
    service: 'serikacord',
    documentation: `${config.API_BASE_URL}/developers/docs`,
    versions: { v10: `${config.API_BASE_URL}/api/v10` },
    health: `${config.API_BASE_URL}/api/health`,
  }))
  .get('/health', () => ({
    status: 'ok',
    service: 'serikacord',
    timestamp: new Date().toISOString(),
  }))
  .post('/webhooks/:channelId/:token', async ({ params, body, set }) => {
    const { ChannelWebhook, Channel, Message } = await import('@/lib/models');
    const webhook = await ChannelWebhook.findOne({ 
      channelId: params.channelId, 
      token: params.token 
    });
    if (!webhook) {
      set.status = 404;
      return { error: 'Webhook not found' };
    }
    const channel = await Channel.findById(params.channelId);
    if (!channel) {
      set.status = 404;
      return { error: 'Channel not found' };
    }
    const payload = body as any;
    const content = payload.content || '';
    const username = payload.username || webhook.name;
    const avatarUrl = payload.avatar_url || webhook.avatar;
    const { encryptForStorage } = await import('@/lib/security');
    const encryptedContent = await encryptForStorage(content);
    const message = await Message.create({
      channelId: channel.id,
      authorId: webhook.creatorId || '00000000-0000-0000-0000-000000000000',
      content: encryptedContent,
      type: 'default',
    });
    await Channel.updateById(channel.id, { lastMessageId: message.id, updatedAt: new Date() });
    const isDiscord = username.toLowerCase().includes('discord') || webhook.name.toLowerCase().includes('discord');
    const messageResponse = {
      id: message.id,
      content: content,
      authorId: message.authorId,
      author: {
        id: message.authorId,
        username: username,
        displayName: username,
        avatar: avatarUrl,
        status: 'online',
        isBot: true,
        isSystem: false,
        isDiscord: isDiscord,
      },
      channelId: message.channelId,
      serverId: channel.serverId,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
      attachments: [],
      edited: false,
      type: 'default',
      pinned: false,
      reactions: [],
    };
    const { publishToChannel } = await import('./channels');
    publishToChannel(channel.id, { type: 'message', message: messageResponse });
    return {
      id: message.id,
      channel_id: channel.id,
      content: content,
      webhook_id: webhook.id,
    };
  })
  .get('/platform/announcement', async () => {
    const { getPlatformSettings } = await import('@/lib/models/PlatformSettings');
    const settings = await getPlatformSettings();
    return {
      announcement: settings.globalAnnouncement || null,
      updatedAt: settings.announcementUpdatedAt || null,
      maintenanceMode: settings.maintenanceMode,
    };
  })
  .get('/platform/file-types', async () => {
    const { getPlatformSettings } = await import('@/lib/models/PlatformSettings');
    const settings = await getPlatformSettings();
    const fileTypes = (settings.allowedFileTypes as any[])?.length
      ? (settings.allowedFileTypes as any[]).map((f: any) => f.type)
      : [...config.ALLOWED_FILE_TYPES];
    return { fileTypes };
  })
  .get('/platform/file-types-accept', async () => {
    const { getPlatformSettings } = await import('@/lib/models/PlatformSettings');
    const settings = await getPlatformSettings();
    const mimeTypes: string[] = (settings.allowedFileTypes as any[])?.length
      ? (settings.allowedFileTypes as any[]).map((f: any) => f.type)
      : [...config.ALLOWED_FILE_TYPES];

    // Convert MIME types to OS-file-picker-friendly accept tokens.
    // OS pickers understand wildcards (image/*) and extensions (.mov) well,
    // but often fail on specific MIME types like video/quicktime.
    const MIME_TO_EXT: Record<string, string[]> = {
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'image/gif': ['.gif'],
      'image/webp': ['.webp'],
      'image/avif': ['.avif'],
      'image/bmp': ['.bmp'],
      'image/svg+xml': ['.svg'],
      'audio/mpeg': ['.mp3'],
      'audio/ogg': ['.ogg', '.oga'],
      'audio/wav': ['.wav'],
      'audio/x-wav': ['.wav'],
      'audio/flac': ['.flac'],
      'audio/aac': ['.aac'],
      'audio/mp4': ['.m4a', '.mp4'],
      'audio/x-m4a': ['.m4a'],
      'audio/webm': ['.weba'],
      'video/mp4': ['.mp4', '.m4v'],
      'video/webm': ['.webm'],
      'video/ogg': ['.ogv'],
      'video/quicktime': ['.mov'],
      'video/x-matroska': ['.mkv'],
      'application/pdf': ['.pdf'],
      'text/plain': ['.txt'],
      'text/csv': ['.csv'],
      'text/markdown': ['.md', '.markdown'],
      'application/json': ['.json'],
      'application/rtf': ['.rtf'],
      'application/msword': ['.doc'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-powerpoint': ['.ppt'],
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
      'application/vnd.oasis.opendocument.text': ['.odt'],
      'application/vnd.oasis.opendocument.spreadsheet': ['.ods'],
      'application/vnd.oasis.opendocument.presentation': ['.odp'],
      'application/zip': ['.zip'],
      'application/gzip': ['.gz', '.gzip', '.tgz'],
      'application/x-tar': ['.tar'],
      'font/woff': ['.woff'],
      'font/woff2': ['.woff2'],
      'font/ttf': ['.ttf'],
      'font/otf': ['.otf'],
    };

    const tokens: string[] = [];
    const seen = new Set<string>();
    for (const mime of mimeTypes) {
      const exts = MIME_TO_EXT[mime];
      if (exts) {
        for (const ext of exts) {
          if (!seen.has(ext)) {
            seen.add(ext);
            tokens.push(ext);
          }
        }
      } else if (mime.endsWith('/*')) {
        if (!seen.has(mime)) {
          seen.add(mime);
          tokens.push(mime);
        }
      } else {
        // Unknown MIME — pass it through, the browser may or may not understand it
        if (!seen.has(mime)) {
          seen.add(mime);
          tokens.push(mime);
        }
      }
    }
    return { accept: tokens.join(',') };
  })
  // Public list of enabled TTS sound triggers (triggerWord + path). Every
  // client fetches this to know which words play sounds. No auth needed —
  // it's just a mapping of public asset paths.
  .get('/tts-sounds', async () => {
    const { TtsSound } = await import('@/lib/models/TtsSound');
    const sounds = await TtsSound.find({ enabled: true });
    return {
      sounds: sounds.map((s) => ({ triggerWord: s.triggerWord, path: s.path })),
    };
  })
  // Public list of enabled TTS custom voices. Clients fetch this to resolve
  // preset names like [fish:miku] or [se:Brian] to actual provider IDs.
  .get('/tts-voices', async () => {
    const { TtsVoice } = await import('@/lib/models/TtsVoice');
    const voices = await TtsVoice.find({ enabled: true });
    return {
      voices: voices.map((v) => ({
        id: v.id,
        name: v.name,
        provider: v.provider,
        referenceId: v.referenceId,
        description: v.description,
        isDefault: v.isDefault,
      })),
    };
  })
  // Fish Audio TTS proxy — hides the API key from the client.
  // Clients POST { text, reference_id, speed, volume } and receive raw audio bytes.
  .post('/tts/fish', async ({ body, set }) => {
    const apiKey = process.env.FISH_API_KEY;
    if (!apiKey) {
      set.status = 503;
      return { error: 'Fish Audio TTS is not configured' };
    }
    const { text, reference_id, speed, volume } = body as {
      text: string;
      reference_id: string;
      speed?: number;
      volume?: number;
    };
    if (!text?.trim() || !reference_id) {
      set.status = 400;
      return { error: 'text and reference_id are required' };
    }
    try {
      const fishBody: Record<string, unknown> = {
        text,
        reference_id,
        format: 'mp3',
        mp3_bitrate: 128,
        normalize: true,
        latency: 'normal',
        chunk_length: 300,
        prosody: {
          speed: speed ?? 1,
          volume: volume ?? 0,
          normalize_loudness: true,
        },
      };
      const res = await fetch('https://api.fish.audio/v1/tts', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'model': 's2-pro',
        },
        body: JSON.stringify(fishBody),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => 'Unknown error');
        console.error('Fish Audio TTS error:', res.status, errText);
        set.status = res.status === 402 ? 402 : 502;
        return { error: `Fish Audio error: ${errText}` };
      }
      const audioBuffer = await res.arrayBuffer();
      set.headers['Content-Type'] = 'audio/mpeg';
      set.headers['Cache-Control'] = 'no-store';
      return new Response(audioBuffer, {
        headers: {
          'Content-Type': 'audio/mpeg',
          'Cache-Control': 'no-store',
        },
      });
    } catch (err) {
      console.error('Fish Audio TTS proxy error:', err);
      set.status = 500;
      return { error: 'Failed to generate speech' };
    }
  }, {
    body: t.Object({
      text: t.String(),
      reference_id: t.String(),
      speed: t.Optional(t.Number()),
      volume: t.Optional(t.Number()),
    }),
  })
  .use(authRoutes)
  .use(internalRoutes)
  .use(userRoutes)
  .use(bugReportRoutes)
  .use(notificationsRoutes)
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
  .use(instanceRoutes)
  .use(developerRoutes)
  .use(oauth2Routes)
  .use(igdbRoutes)
  .use(gameLibraryRoutes)
  .use(socialSdkRoutes)
  .use(discordRoutes)
  .use(botApiRoutes);

// Idempotency guard: once initializeAPI() has been called, subsequent calls
// return the same promise instead of re-running DB connections and seeding.
// This prevents duplicate connection pools / repeated "✅ API initialized" when
// the custom server (server.ts) and the Next.js catch-all route both call it.
let initPromise: Promise<void> | null = null;

// Initialize database connection
export async function initializeAPI() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    await connectDB();
    await ensureSerikaBroadcastUser();
    // Ensure system users exist
    const { ensureSystemUsers } = await import('@/lib/services/systemUsers');
    await ensureSystemUsers();

    // Auto-provision bot users for existing applications
    try {
      const { ensureAllBotsProvisioned } = await import('@/lib/services/appIdentity');
      await ensureAllBotsProvisioned();
    } catch (err) {
      console.error('Failed to auto-provision bots on startup:', err);
    }

    console.log('✅ API initialized');
  })();
  // If init fails, clear the promise so a retry is possible.
  initPromise.catch(() => { initPromise = null; });
  return initPromise;
}

export type API = typeof api;

// Export the getAuth helper for other files
export { getAuth };
