import { Elysia, t } from 'elysia';
import { cors } from '@elysiajs/cors';
import { jwt } from '@elysiajs/jwt';
import { config } from '@/lib/config';
import { connectDB } from '@/lib/db';
import { authenticateRequest, invalidateUserCache } from '@/lib/services/auth';
import { checkRateLimit, getClientIP, rejectInvalidObjectIdParams, decryptFromStorage } from '@/lib/security';
import { User, type IUser, AuthorizedApp, UserDeviceSession, UserConnection } from '@/lib/models';
import { RichPresence } from '@/lib/models/RichPresence';
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
import { developerRoutes, oauth2Routes } from './developers';
import { botApiRoutes } from './botApi';
import { ensureSerikaBroadcastUser } from '@/lib/services/serikaBroadcast';
import { resolveEffectiveStatus } from '@/lib/services/presence';
import { getMoeActivity } from '@/lib/services/moeActivity';
import { getLastFmNowPlaying } from '@/lib/services/lastfmService';
// Helper to safely compare IDs
function compareIds(id1: string, id2: string): boolean {
  return id1 === id2;
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
    
    const memberships = await ServerMember.find({ userId: user.id });

    // Batch fetch servers
    const serverIds = memberships.map(m => m.serverId);
    const servers = serverIds.length > 0 ? await Server.find({ id: { in: serverIds } }) : [];
    const serverMap = new Map(servers.map(s => [s.id, s]));

    const result = memberships
      .filter(m => serverMap.has(m.serverId))
      .map(m => {
        const server = serverMap.get(m.serverId) as any;
        return {
          id: server.id,
          name: server.name,
          icon: server.icon,
          banner: server.banner ?? null,
          description: server.description,
          memberCount: server.memberCount,
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
      });

    return result;
  })
  .get('/@me/guilds', async ({ headers, cookie, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { ServerMember, Server, Role } = await import('@/lib/models');
    
    const memberships = await ServerMember.find({ userId: user.id });
    const serverIds = memberships.map(m => m.serverId);
    const servers = serverIds.length > 0 ? await Server.find({ id: { in: serverIds } }) : [];
    const serverMap = new Map(servers.map(s => [s.id, s]));

    const results = [];
    for (const membership of memberships) {
      const server = serverMap.get(membership.serverId);
      if (!server) continue;
      
      let perms = 0n;
      if (server.ownerId === user.id) {
        perms = 8n | (1n << 3n);
      } else {
        const serverRoles = await Role.find({ serverId: server.id });
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
      const { ServerMember, Message, Channel, User } = await import('@/lib/models');

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

      // Map channel -> serverId for filtering
      const serversWithMentions = new Set<string>();
      const mentions = await Promise.all(filteredMessages.map(async (msg) => {
        const sid = channelToServer.get(msg.channelId) || '';
        if (sid) serversWithMentions.add(sid);
        const author = authorMap.get(msg.authorId);
        const decryptedContent = await decryptFromStorage(msg.content || '');
        return {
          id: msg.id,
          content: decryptedContent,
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
      }));

      return {
        servers: Array.from(serversWithMentions).map(id => ({ id })),
        mentions,
      };
    } catch (error) {
      console.error('Failed to fetch mentions:', error);
      return { servers: [], mentions: [] };
    }
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
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'error', error: authError || 'Unauthorized' })}\n\n`));
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
      const { ServerMember, ServerEmoji, Server } = await import('@/lib/models');

      // Get all servers the user is a member of
      const memberships = await ServerMember.find({ userId: user.id });
      const serverIds = memberships.map(m => m.serverId);

      if (serverIds.length === 0) {
        return { emojis: [] };
      }

      // Get all emojis from all servers the user is in
      const emojis = await ServerEmoji.find({
        serverId: { in: serverIds },
        available: true,
      });

      // Get server names for grouping
      const servers = await Server.find({ id: { in: serverIds } });
      const serverNameMap = new Map(servers.map(s => [s.id, s.name]));

      return {
        emojis: emojis.map(e => ({
          id: e.id,
          name: e.name,
          url: e.imageUrl,
          animated: e.animated,
          serverId: e.serverId,
          serverName: serverNameMap.get(e.serverId) || 'Unknown',
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
      const memberships = await ServerMember.find({ userId: user.id });
      const serverIds = memberships.map(m => m.serverId);

      if (serverIds.length === 0) {
        return { stickers: [] };
      }

      // Get all stickers from all servers the user is in
      const stickers = await ServerSticker.find({
        serverId: { in: serverIds },
        available: true,
      });
      // Sort by createdAt desc
      stickers.sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());

      // Get server names for grouping
      const servers = await Server.find({ id: { in: serverIds } });
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
      bio: t.Optional(t.String({ maxLength: 190 })),
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
    const existingCurrent = await UserDeviceSession.findOne({ userId, current: true });
    if (!existingCurrent) {
      await UserDeviceSession.create({
        userId,
        deviceName: userAgent.slice(0, 120),
        platform: userAgent.includes('Mobile') ? 'Mobile' : 'Desktop',
        browser: userAgent.slice(0, 80),
        ipAddress: getClientIP(request),
        current: true,
        lastActiveAt: new Date(),
      });
    } else {
      await UserDeviceSession.updateById(existingCurrent.id, { lastActiveAt: new Date() });
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

    const connections = await UserConnection.find({ userId: (authUser as any).id || (authUser as any)._id });
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

    const { ServerMember, Server } = await import('@/lib/models');
    const requesterMemberships = await ServerMember.find({ userId: requester.id });
    const targetMemberships = await ServerMember.find({ userId: targetUser.id });

    const requesterServerIds = requesterMemberships.map((m) => m.serverId);
    const mutualServerIds = targetMemberships
      .map((m) => m.serverId)
      .filter((id) => requesterServerIds.includes(id));

    const servers = await Server.find({ id: { in: mutualServerIds } });

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

    // Fetch all three in parallel
    const now = new Date();
    const [watchActivity, richPresenceDocs, lastfmConnection] = await Promise.all([
      getMoeActivity(userId),
      RichPresence.find({ userId: targetUser.id }),
      UserConnection.findOne({ userId: targetUser.id, provider: 'lastfm' }),
    ]);

    // Filter non-expired rich presence
    const activeRichPresence = richPresenceDocs.filter((doc: any) => doc.expiresAt && new Date(doc.expiresAt) > now);

    // Fetch Last.fm now playing if connected
    let music: import('@/lib/services/lastfmService').LastFmTrack | null = null;
    if (lastfmConnection?.accountId) {
      music = await getLastFmNowPlaying(lastfmConnection.accountId);
    }

    const activities = (activeRichPresence as any[]).map((doc) => ({
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
    }));

    return {
      activity: watchActivity,
      music,
      game: activities[0] ?? null,
      activities,
    };
  }, {
    params: t.Object({
      userId: t.String(),
    }),
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
    const userKey = user.id;

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

// Notifications routes
const notificationsRoutes = new Elysia({ prefix: '/notifications' })
  .get('/', async ({ headers, cookie, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const { ServerMember, Message, Channel, Server, User } = await import('@/lib/models');

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

      const notifications = await Promise.all(filteredMessages.map(async (msg) => {
        const channelId = msg.channelId;
        const serverId = channelToServer.get(channelId) || '';
        const channelName = channelToName.get(channelId) || '';
        const serverName = serverToName.get(serverId) || '';
        const serverIcon = serverToIcon.get(serverId) || '';
        
        const author = authorMap.get(msg.authorId);
        const decryptedContent = await decryptFromStorage(msg.content || '');

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
          content: decryptedContent,
        };
      }));

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
    const name = (query as Record<string, string | undefined>).name?.trim();
    if (!name) {
      set.status = 400;
      return { error: 'Missing "name" query parameter' };
    }
    const { lookupGame } = await import('@/lib/services/igdbService');
    const game = await lookupGame(name);
    return { game };
  }, {
    query: t.Object({ name: t.String({ minLength: 1, maxLength: 128 }) }),
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
      : config.ALLOWED_FILE_TYPES;
    return { fileTypes };
  })
  .use(authRoutes)
  .use(userRoutes)
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
  .use(botApiRoutes);

// Initialize database connection
export async function initializeAPI() {
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
}

export type API = typeof api;

// Export the getAuth helper for other files
export { getAuth };
