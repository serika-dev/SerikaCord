import { Elysia, t } from 'elysia';
import { readServerTagConfig, stripServerTagWrite, withoutServerTag } from '@/lib/servers/serverProfile';
import { resolveCustomization } from '@/lib/services/serverTags';
import { acceptsFriendRequests, activityHiddenByStatus, activitySharing, friendRequestAllowedFrom, friendRequestSources, sanitizePrivacyPatch } from '@/lib/settings/privacy';
import { cors } from '@elysiajs/cors';
import { jwt } from '@elysiajs/jwt';
import { config } from '@/lib/config';
import { readServerTheme, sanitizeAppearanceSettingsPatch } from '@/lib/appearance/customization';
import { sanitizeNameplate } from '@/lib/constants/nameplates';
import { connectDB, cache } from '@/lib/db';
import { authenticateRequest, invalidateUserCache } from '@/lib/services/auth';
import { checkRateLimit, getClientIP, isGlobalRateLimitExempt, isValidObjectId, rejectInvalidObjectIdParams, decryptFromStorage } from '@/lib/security';
import { botApiTokenFromRequest, rateLimitedResponse } from '@/lib/security/botRateLimit';
import { anonymizeIp } from '@/lib/security/ipPrivacy';
import { User, type IUser, type IUserSettings, type IPendingFriendRequests, type IRole, AuthorizedApp, UserDeviceSession, UserConnection, ServerMember, Server, Role, ServerEmoji, ServerSticker, Channel, Message, BugReport } from '@/lib/models';
import type { IAllowedFileType } from '@/lib/models/PlatformSettings';
import { RichPresence, type IRichPresence } from '@/lib/models/RichPresence';
import { ActivityHistory } from '@/lib/models/ActivityHistory';
import { authRoutes } from './auth';
import { serverRoutes, inviteRoutes, partnerRoutes, computeOnlineCounts } from './servers';
import type { ServerActiveEvent } from '@/lib/chat/serverEventBadge';
import { discordBridgeRoutes } from './discordBridge';
import { channelRoutes } from './channels';
import { serverWebhookRoutes } from './serverWebhooks';
import { uploadRoutes } from './uploads';
import { dmRoutes } from './dms';
import { groupDmRoutes } from './groupDms';
import { messageExtrasRoutes } from './messageExtras';
import { interactionRoutes } from './interactionRoutes';
import { automodRoutes } from './automod';
import { communityRoutes } from './community';
import { faviconRoutes } from './favicons';
import { trustSafetyRoutes } from './trustSafety';
// End-to-end encryption keys / devices / backups (docs/architecture/e2ee.md).
import { e2eeRoutes } from './e2ee';
import { scheduledEventRoutes } from './scheduledEvents';
import { announcementRoutes } from './announcements';
import { searchRoutes } from './search';
import { adminRoutes } from './admin';
import { staffRoutes } from './staff';
import { changelogRoutes, adminChangelogRoutes } from './changelogs';
import { badgeRoutes } from './badges';
import { oembedRoutes } from './oembed';
import { experimentRoutes, instanceRoutes } from './experiments';
import { voiceRoutes } from './voice';
import { gifRoutes } from './gifs';
import { developerRoutes, oauth2Routes } from './developers';
import { appDirectoryRoutes, adminAppRoutes } from './appDirectory';
import { botApiRoutes } from './botApi';
import { validationErrorBody } from '@/lib/botapi/errors';
import { socialSdkRoutes } from './social-sdk';
import { mcpRoutes } from './mcp';
import { pushRoutes } from './push';
import { ensureSerikaBroadcastUser } from '@/lib/services/serikaBroadcast';
import { resolveEffectiveStatus } from '@/lib/services/presence';
import { getMoeActivity } from '@/lib/services/moeActivity';
import { getLastFmNowPlaying } from '@/lib/services/lastfmService';
import { normalizeId } from '@/lib/db/normalizeId';
import { getVersionInfo } from '@/lib/version';
import { getServerBuildTime } from '@/lib/versionServer';
import { filterVisibleConnections, isSelfDeclarableProvider, toOwnConnection } from '@/lib/connections/policy';
import { MAX_DOMAINS_PER_USER, createDomainToken, filterUnverifiedDomains, newDomainMetadata, normalizeDomain, ownDomainStatus, readDomainVerification, verifiedDomainMetadata } from '@/lib/connections/domain';
import { mutateFriendPair, type FriendPairOutcome } from '@/lib/services/friendPairLock';
import { addId, dedupeIds, hasId, removeId } from '@/lib/social/friendLists';
import { normalizeDisplayName } from '@/lib/utils/normalizeDisplayName';
import { db, schema } from '@/lib/db/postgres';
import { inArray } from 'drizzle-orm';
import { getRedis } from '@/lib/db/redis';
import { isCustomStatusExpired, sanitizeExpiry, sanitizeStatusEmoji, type CustomStatusEmoji } from '@/lib/social/customStatus';
import { ACTIVE_DEVICE_TTL_SECONDS, AUTO_IDLE_FLAG_TTL_SECONDS, decideAutoIdle, parseHeartbeatIdle } from '@/lib/presence/autoIdle';
// Helper to safely compare IDs (normalizes MongoDB ObjectId format to UUID)
function compareIds(id1: string, id2: string): boolean {
  return normalizeId(id1) === normalizeId(id2);
}

/** A connection as returned to its owner; websites carry their DNS verification status. */
function toOwnConnectionView<T extends { provider: string; accountId: string; metadata?: unknown }>(row: T) {
  const own = toOwnConnection(row);
  return row.provider === 'website' ? { ...own, domain: ownDomainStatus(row) } : own;
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
      callRingtone: true,
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

function normalizeSettingsPatch(patch: Record<string, any>, userId: string) {
  const nextPatch: Record<string, any> = mergeDeep({}, patch || {});
  if (patch && patch.privacy !== undefined) {
    // Typed and validated (DM audience, per-server lists, booleans). Arrays
    // replace the stored list, so take them from the raw patch.
    const cleaned = sanitizePrivacyPatch(patch.privacy);
    if ('error' in cleaned) {
      return { error: cleaned.error, patch: null as typeof nextPatch | null };
    }
    nextPatch.privacy = cleaned.patch;
  }
  if (nextPatch.appearance && typeof nextPatch.appearance === 'object') {
    // Background image, font and server-theme opt-out reach CSS: validate them.
    const cleaned = sanitizeAppearanceSettingsPatch(nextPatch.appearance, { userId, cdnUrl: config.CDN_URL });
    if ('error' in cleaned) {
      return { error: cleaned.error, patch: null as typeof nextPatch | null };
    }
    nextPatch.appearance = cleaned.patch;
  }
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

/**
 * Merge a profile customization patch. The nameplate is validated (hex
 * colours, known presets, own CDN image) and replaces the stored one as a
 * whole, so no stale fields from an earlier type linger.
 */
function applyCustomizationPatch(
  user: { id: string; customization?: unknown },
  patch: Record<string, unknown>,
): { customization: Record<string, unknown> } | { error: string } {
  const merged = mergeDeep((user.customization || {}) as Record<string, unknown>, patch);
  if ('nameplate' in patch) {
    const result = sanitizeNameplate(patch.nameplate, { userId: user.id, cdnUrl: config.CDN_URL });
    if ('error' in result) return { error: result.error };
    merged.nameplate = result.nameplate;
  }
  return { customization: merged };
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
  // Every human presence change passes here once (on the instance where it
  // happened): bots with GUILD_PRESENCES in shared servers get PRESENCE_UPDATE.
  if (payload.type === 'presence:update' && typeof payload.userId === 'string') {
    const subject = payload.userId;
    void import('@/lib/services/gatewayEvents').then((m) => m.emitPresenceUpdate(subject)).catch(() => {});
  }
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

/**
 * Shared tail of every friend-graph route: map the locked mutation's outcome
 * to a response and, when something was written, notify both users' friend
 * streams. (mutateFriendPair already dropped both users' auth caches.)
 */
function finishFriendMutation(
  outcome: FriendPairOutcome | null,
  meId: string,
  targetId: string,
  set: { status?: number | string },
): Record<string, unknown> {
  if (!outcome) {
    set.status = 404;
    return { error: 'User not found' };
  }
  if (outcome.changed) {
    emitFriendEvent([normalizeId(meId), normalizeId(targetId)], { type: 'friends:update', timestamp: Date.now() });
    // Every open session (any instance) refreshes its friends / blocked lists,
    // which drive the user menus, blocked-message rows and message requests.
    void import('@/lib/api/activity')
      .then(({ fanoutToUsers }) => fanoutToUsers({ userIds: [normalizeId(meId), normalizeId(targetId)] }, { type: 'relationships_changed' }))
      .catch(() => {});
  }
  if (outcome.status) set.status = outcome.status;
  return outcome.body;
}

// ─── Custom status (emoji + "Clear after") ───────────────────────────────────
// Text stays in users.custom_status; emoji + expiry live in customization (see
// lib/social/customStatus.ts). Expiries are scheduled in a Redis sorted set and
// swept every 30s; readers also hide an expired status on their own.
const CUSTOM_STATUS_EXPIRY_KEY = 'customstatus:expiry';

/**
 * Fold a profile patch's custom-status fields into `updateFields`. Returns
 * the expiry to schedule (`undefined` = untouched), or an error message.
 */
function applyCustomStatusPatch(
  user: { customStatus?: string | null; customization?: unknown },
  data: Record<string, unknown>,
  updateFields: Record<string, unknown>,
): { error?: string; expiresAt?: string | null } {
  const hasEmoji = data.customStatusEmoji !== undefined;
  const hasExpiry = data.customStatusExpiresAt !== undefined;
  const textGiven = data.customStatus !== undefined;
  const text = typeof data.customStatus === 'string' ? data.customStatus.trim() : '';
  // A text-only edit (older editors) leaves the emoji and expiry alone.
  if (!hasEmoji && !hasExpiry && !(textGiven && !text)) return {};
  const current = (user.customization || {}) as Record<string, unknown>;
  let emoji = (current.customStatusEmoji ?? null) as CustomStatusEmoji | null;
  let expiresAt = (typeof current.customStatusExpiresAt === 'string' ? current.customStatusExpiresAt : null) as string | null;
  if (hasEmoji) {
    if (data.customStatusEmoji === null) emoji = null;
    else {
      emoji = sanitizeStatusEmoji(data.customStatusEmoji, config.CDN_URL);
      if (!emoji) return { error: 'Invalid custom status emoji' };
    }
  } else if (textGiven && !text) {
    // Clearing the text without sending an emoji clears the whole status.
    emoji = null;
  }
  if (hasExpiry) {
    const parsed = sanitizeExpiry(data.customStatusExpiresAt, Date.now());
    if (!parsed.ok) return { error: 'Invalid custom status expiry' };
    expiresAt = parsed.value;
  }
  const finalText = textGiven ? text : (user.customStatus || '').trim();
  if (!finalText && !emoji) {
    expiresAt = null;
    updateFields.customStatus = null;
  } else if (textGiven) {
    updateFields.customStatus = finalText || null;
  }
  const base = (updateFields.customization ?? current) as Record<string, unknown>;
  updateFields.customization = { ...base, customStatusEmoji: emoji, customStatusExpiresAt: expiresAt };
  return { expiresAt };
}

async function scheduleCustomStatusExpiry(userId: string, expiresAt: string | null | undefined): Promise<void> {
  if (expiresAt === undefined) return;
  const redis = getRedis();
  if (!redis) return;
  try {
    if (expiresAt) await redis.zadd(CUSTOM_STATUS_EXPIRY_KEY, new Date(expiresAt).getTime(), normalizeId(userId));
    else await redis.zrem(CUSTOM_STATUS_EXPIRY_KEY, normalizeId(userId));
  } catch { /* the lazy read-side check still hides it */ }
}

/** Clear one user's custom status if it has expired (and tell their friends). */
async function clearExpiredCustomStatus(userId: string): Promise<boolean> {
  const user = await User.findById(userId);
  if (!user || !isCustomStatusExpired(user.customization)) return false;
  const customization = { ...((user.customization || {}) as Record<string, unknown>), customStatusEmoji: null, customStatusExpiresAt: null };
  const updated = (await User.updateById(user.id, { customStatus: null, customization })) || user;
  await invalidateUserCache(user.id);
  emitFriendEvent((updated.friends || []).map((f: string) => f), {
    type: 'presence:update',
    userId: updated.id,
    status: getPublicPresenceStatus(updated),
    customStatus: null,
    displayName: updated.displayName || updated.username,
    customization: updated.customization || null,
    timestamp: Date.now(),
  });
  return true;
}

let customStatusSweeper: ReturnType<typeof setInterval> | null = null;
/** Every 30s, clear statuses whose "Clear after" passed. ZREM claims each one, so instances never double-process. */
function startCustomStatusExpirySweeper(): void {
  if (customStatusSweeper) return;
  customStatusSweeper = setInterval(() => {
    void (async () => {
      const redis = getRedis();
      if (!redis) return;
      try {
        const due = await redis.zrangebyscore(CUSTOM_STATUS_EXPIRY_KEY, 0, Date.now(), 'LIMIT', 0, 100);
        for (const id of due) {
          if ((await redis.zrem(CUSTOM_STATUS_EXPIRY_KEY, id)) !== 1) continue;
          await clearExpiredCustomStatus(id).catch(() => false);
        }
      } catch (err) {
        console.error('Custom status sweep failed:', (err as Error)?.message ?? err);
      }
    })();
  }, 30_000);
  (customStatusSweeper as { unref?: () => void }).unref?.();
}

// ─── Automatic idle ──────────────────────────────────────────────────────────
const autoIdleFlagKey = (userId: string) => `presence:autoidle:${normalizeId(userId)}`;
const activeDeviceKey = (userId: string) => `presence:active:${normalizeId(userId)}`;

/** A manual status choice wins over automatic idle. */
async function clearAutoIdleFlag(userId: string): Promise<void> {
  try { await getRedis()?.del(autoIdleFlagKey(userId)); } catch { /* best-effort */ }
}

/**
 * Apply a heartbeat's idle report. Returns the status to store, or null when
 * nothing changes. Never touches DND / Invisible / a manually chosen Idle.
 */
async function resolveAutoIdle(userId: string, status: string | null | undefined, idle: boolean): Promise<'online' | 'idle' | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    if (!idle) await redis.set(activeDeviceKey(userId), '1', 'EX', ACTIVE_DEVICE_TTL_SECONDS);
    const [flag, otherActive] = await Promise.all([
      redis.get(autoIdleFlagKey(userId)),
      idle ? redis.get(activeDeviceKey(userId)) : Promise.resolve(null),
    ]);
    const action = decideAutoIdle({ status, idle, otherDeviceActive: Boolean(otherActive), autoIdleFlag: Boolean(flag) });
    if (action === 'set-idle') {
      await redis.set(autoIdleFlagKey(userId), '1', 'EX', AUTO_IDLE_FLAG_TTL_SECONDS);
      return 'idle';
    }
    if (action === 'restore-online') {
      await redis.del(autoIdleFlagKey(userId));
      return 'online';
    }
  } catch { /* best-effort */ }
  return null;
}

// Rate limiting middleware. The hook must be `as: 'global'`: Elysia drops a
// plugin's local hooks on `.use()`, which left this limiter inert before.
// Checked in onBeforeHandle (not derive) so exempt paths never touch Redis.
const rateLimitPlugin = new Elysia({ name: 'rateLimit' })
  .onBeforeHandle({ as: 'global' }, async ({ request, set, path }) => {
    const authorization = request.headers.get('authorization');
    if (isGlobalRateLimitExempt(path, authorization)) return;
    // Bot API requests with a VALID bot token use the per-bot limits in
    // botApi.ts instead of the per-IP budget; anything else (including a
    // made-up "Bot x" header) counts against the IP.
    const botToken = botApiTokenFromRequest(path, authorization);
    if (botToken) {
      const { resolveBotToken } = await import('@/lib/services/botTokens');
      if (await resolveBotToken(botToken).catch(() => null)) return;
    }
    const result = await checkRateLimit('api', getClientIP(request));
    if (!result.success) {
      set.status = 429;
      // Bot API paths get Discord's 429 (body + Via, which discord.py requires).
      if (/^\/api\/v(9|10)(\/|$)/.test(path)) {
        const limited = rateLimitedResponse({ retryAfterSeconds: result.retryAfter ?? 1, global: true });
        Object.assign(set.headers, limited.headers);
        return limited.body;
      }
      set.headers['Retry-After'] = String(result.retryAfter ?? 1);
      return {
        error: 'Too many requests',
        retryAfter: result.retryAfter,
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
        // A local row already owns this username. Never rewrite its id or
        // credentials onto this accounts user unless it is the same person
        // (legacy row: same verified email, not a bot/system user); otherwise
        // give the accounts user their own row under a de-duplicated username.
        const { canAdoptLocalUser, dedupeUsername } = await import('@/lib/services/authPolicy');
        const requestedUsername = typeof payload.username === 'string' ? payload.username : '';
        if (!requestedUsername) {
          // findOne({ username: undefined }) would match an arbitrary row.
          set.status = 400;
          return { error: 'username is required to create a user', success: false };
        }
        const existing = await User.findOne({ username: requestedUsername });
        if (existing && canAdoptLocalUser(existing, { id: userId, email: payload.email, isVerified: payload.isVerified })) {
          user = await User.updateById(existing.id, userData) || existing;
          const { invalidateUserCache } = await import('@/lib/services/auth');
          await invalidateUserCache(existing.id);
        } else {
          let username = requestedUsername;
          if (existing) {
            username = dedupeUsername(requestedUsername, userId);
            if (await User.findOne({ username })) username = dedupeUsername(requestedUsername, userId, 1);
          }
          let email = userData.email;
          if (email && await User.findOne({ email })) email = undefined;
          user = await User.create({
            id: userId,
            ...userData,
            username,
            email,
            status: 'offline',
          });
          action = 'created';
        }
      }

      // Sync serika.moe connection if present in sync payload
      if (payload.serikaMoeUsername) {
        // An adopted legacy row keeps its own id.
        const localUserId = user?.id ?? userId;
        const connData = {
          userId: localUserId,
          provider: 'serika' as const,
          accountId: payload.serikaMoeUsername as string,
          displayName: payload.serikaMoeUsername as string,
          visible: true,
          metadata: { serikaMoeId: payload.serikaMoeId || null },
        };
        const existingConn = await UserConnection.findOne({ userId: localUserId, provider: 'serika' });
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
            provider: 'serika' as const,
            accountId: username as string,
            displayName: username as string,
            visible: true,
            metadata: { serikaMoeId: moeId },
          };
          const existing = await UserConnection.findOne({ userId: user.id, provider: 'serika' });
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
          const existing = await UserConnection.findOne({ userId: user.id, provider: 'serika' });
          if (existing) {
            await UserConnection.deleteById(existing.id);
          }
        }
      }

      // Discord linked/unlinked in Serika Accounts: mirror it into the local
      // connection the Discord bridge and profile read.
      if ('discordId' in updates) {
        try {
          const { applyAccountsDiscordUpdate } = await import('@/lib/services/discordConnection');
          await applyAccountsDiscordUpdate(user.id, { discordId: updates.discordId, discordUsername: updates.discordUsername });
        } catch (err) {
          console.error('Failed to sync discord connection from /internal/update-profile:', err);
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
        discordId: t.Optional(t.Union([t.String({ maxLength: 32 }), t.Null()])),
        discordUsername: t.Optional(t.Union([t.String({ maxLength: 64 }), t.Null()])),
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

      // Drop memberships, hand off or delete owned servers and scrub friend
      // references first, so nothing is left pointing at a missing user.
      const { cleanupDeletedUser } = await import('@/lib/services/deletionCascade');
      await cleanupDeletedUser(user.id);
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

const EMPTY_ACTIVITY = { activity: null, music: null, game: null, activities: [] as unknown[] };

function isUuidLike(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

// Matches the clients' 15s activity poll so most polls are cache hits. Rich
// presence writes delete `activity:<id>`, so game status still updates at once.
const ACTIVITY_CACHE_TTL_SECONDS = 15;

// Postgres returns lower-case UUIDs; key everything the same way.
function activityUserKey(id: string): string {
  return normalizeId(id).toLowerCase();
}

function parseCachedActivity(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    let value: unknown = raw;
    // Stored double-encoded (cache.set JSON-encodes an already JSON string).
    for (let i = 0; i < 2 && typeof value === 'string'; i++) value = JSON.parse(value);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Live activity for many users at once: "now watching" (serika.moe), Last.fm
 * scrobble and game/rich presence. Respects each user's "show activity"
 * privacy setting. One Redis MGET for the cached snapshots, then three batched
 * queries (users, rich presence, Last.fm connections) for the misses instead
 * of ~4 queries per user. Missing users are absent from the returned map.
 */
async function loadUserActivities(userIds: string[]): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  const ids = [...new Set(userIds.map(activityUserKey))];
  if (ids.length === 0) return out;

  const redis = getRedis();
  let cachedValues: (string | null)[] = [];
  if (redis) {
    try { cachedValues = await redis.mget(...ids.map((id) => `activity:${id}`)); } catch { cachedValues = []; }
  }
  const misses: string[] = [];
  ids.forEach((id, i) => {
    const hit = parseCachedActivity(cachedValues[i]);
    if (hit) out.set(id, hit);
    else misses.push(id);
  });
  if (misses.length === 0) return out;

  const [userRows, presenceRows, lastfmRows] = await Promise.all([
    db.select({ id: schema.users.id, settings: schema.users.settings, status: schema.users.status })
      .from(schema.users)
      .where(inArray(schema.users.id, misses))
      .catch(() => [] as { id: string; settings: unknown; status: string | null }[]),
    RichPresence.find({ userId: { in: misses } }).catch(() => [] as IRichPresence[]),
    UserConnection.find({ userId: { in: misses }, provider: 'lastfm' }).catch(() => []),
  ]);

  const now = new Date();
  const presenceByUser = new Map<string, IRichPresence[]>();
  for (const doc of presenceRows as IRichPresence[]) {
    if (!doc.expiresAt || new Date(doc.expiresAt) <= now) continue;
    const list = presenceByUser.get(doc.userId);
    if (list) list.push(doc);
    else presenceByUser.set(doc.userId, [doc]);
  }
  const lastfmByUser = new Map<string, string>();
  for (const conn of lastfmRows as { userId: string; accountId?: string | null }[]) {
    if (conn.accountId && !lastfmByUser.has(conn.userId)) lastfmByUser.set(conn.userId, conn.accountId);
  }

  const computed = await Promise.all(userRows.map(async (row) => {
    // Privacy: the master switch, each source's own switch, and Invisible
    // (shown as offline, so no live activity either).
    const sharing = activitySharing(row.settings);
    if (!sharing.enabled || activityHiddenByStatus(row.status)) return [row.id, { ...EMPTY_ACTIVITY }] as const;

    const lastfmAccount = sharing.music ? lastfmByUser.get(row.id) : undefined;
    const [watchActivity, music] = await Promise.all([
      sharing.watching ? getMoeActivity(row.id).catch(() => null) : Promise.resolve(null),
      lastfmAccount ? getLastFmNowPlaying(lastfmAccount).catch(() => null) : Promise.resolve(null),
    ]);

    const activities = sortActivitiesByPriority((sharing.games ? presenceByUser.get(row.id) || [] : []).map((doc) => ({
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

    return [row.id, { activity: watchActivity, music, game: activities[0] ?? null, activities }] as const;
  }));

  for (const [id, result] of computed) out.set(id, result as Record<string, unknown>);

  if (redis && computed.length > 0) {
    try {
      const pipeline = redis.pipeline();
      for (const [id, result] of computed) {
        pipeline.setex(`activity:${id}`, ACTIVITY_CACHE_TTL_SECONDS, JSON.stringify(result));
      }
      await pipeline.exec();
    } catch { /* cache is best-effort */ }
  }
  return out;
}

/** Single-user form of loadUserActivities. null = no such user. */
async function loadUserActivity(userId: string): Promise<Record<string, unknown> | null> {
  const results = await loadUserActivities([userId]);
  return results.get(activityUserKey(userId)) ?? null;
}

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
    const { user, error: authError, banned } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      // Suspended: the app shows Account Standing instead of signing out.
      if (banned) {
        set.status = 403;
        return { error: 'Account banned', code: 'account_banned' };
      }
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    // Badge recalculation is ~6 sequential queries: don't make every app load
    // wait for it. Return the stored badges; the recalculated set is saved for
    // the next request.
    const updatedBadges = user.badges ?? [];
    // A "Clear after" that passed while nobody swept it (e.g. Redis was down).
    if (isCustomStatusExpired(user.customization)) void clearExpiredCustomStatus(user.id).catch(() => false);
    void import('@/lib/services/badges')
      .then(({ recalculateUserBadges }) => recalculateUserBadges(user.id))
      .catch(() => {});

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

    const liveIds = servers.map((s) => s.id);
    // Rail event badge: one query for live / starting-within-the-hour events
    // across all these servers, cached per server (services/scheduledEvents).
    const [onlineCounts, activeEvents] = await Promise.all([
      computeOnlineCounts(liveIds).catch(() => new Map<string, number>()),
      import('@/lib/services/scheduledEvents')
        .then(({ activeEventsForServers }) => activeEventsForServers(user.id, liveIds))
        .catch(() => new Map<string, ServerActiveEvent>()),
    ]);
    const result = await Promise.all(memberships
      .filter(m => serverMap.has(m.serverId))
      .map(async (m) => {
        const server = serverMap.get(m.serverId)!;
        const onlineCount = onlineCounts.get(server.id) ?? 0;
        return {
          id: server.id,
          name: server.name,
          icon: server.icon,
          banner: server.banner ?? null,
          description: server.description,
          memberCount: server.memberCount,
          onlineCount,
          isOfficial: false,
          isVerified: Boolean(server.isPartnered),
          isPartnered: Boolean(server.isPartnered),
          vanityUrlCode: server.vanityUrlCode,
          ownerId: server.ownerId ?? null,
          isOwner: server.ownerId === user.id,
          systemChannelId: server.systemChannelId ?? null,
          rulesChannelId: server.rulesChannelId ?? null,
          afkChannelId: server.afkChannelId ?? null,
          afkTimeout: server.afkTimeout ?? 300,
          isAgeGated: server.isAgeGated ?? false,
          // Server theme (CORD-50), re-validated on the way out.
          theme: readServerTheme(server.settings),
          // Enabled server tag, for the "display a server tag" picker (CORD-53).
          serverTag: readServerTagConfig((server.settings as Record<string, unknown> | null)?.serverTag, config.CDN_URL),
          // Live event, or the next one starting within the hour (rail badge).
          activeEvent: activeEvents.get(String(server.id).toLowerCase()) ?? null,
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
    const rolesByServer = new Map<string, IRole[]>();
    for (const role of allRoles) {
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

      // Get all channels in those servers the user can actually view (private
      // channels' @everyone/role mentions must not leak to every member).
      const channels = await filterViewableChannels(user.id, await Channel.find({ serverId: { in: serverIds } }), memberships);
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

      // `?unread=1` (badge seeding on a new client): every mention you haven't
      // read yet, however old, instead of the newest 50 of the last week,
      // which undercounted next to a client that had been open all along.
      const unreadOnly = (query as { unread?: string })?.unread === '1';
      const filteredMessages = await Message.findMentionsOf({
        channelIds: filterChannelIds,
        userId: user.id,
        roleIds: [...allUserRoleIds],
        since: unreadOnly ? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) : sevenDaysAgo,
        limit: unreadOnly ? 500 : 50,
        unreadOnly,
      });

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
        // How this user was pinged, so clients can honour per-server
        // "suppress @everyone / role mentions" settings.
        const kind = ((msg.mentionedUserIds || []) as string[]).includes(user.id)
          ? 'user'
          : msg.mentionEveryone
            ? 'everyone'
            : 'role';
        return {
          id: msg.id,
          kind,
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

      // Names for the mention markup in the previews ("@Alice", not "@user").
      const { lookupMentionNames } = await import('@/lib/services/mentionNames');
      const mentionNames = await lookupMentionNames(decryptedMentionContents, {
        serverIds: [...serversWithMentions],
      });

      return {
        servers: Array.from(serversWithMentions).map(id => ({ id })),
        mentions,
        mentionNames,
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
  // Quick switcher (Ctrl+K): every channel the user can open in every server
  // (text, announcement, forum, voice, stage), name + server + parent only.
  // Fetched when the switcher opens; private channels are filtered by access.
  .get('/@me/switcher-channels', async ({ headers, cookie, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    const limited = await checkRateLimit('api', `switcher:${user.id}`).catch(() => ({ success: true }));
    if (!limited.success) {
      set.status = 429;
      return { error: 'Rate limited' };
    }
    try {
      const memberships = await ServerMember.find({ userId: user.id });
      const serverIds = memberships.map((m) => m.serverId);
      if (serverIds.length === 0) return { channels: [] };
      const all = await Channel.find({
        serverId: { in: serverIds },
        type: { in: ['text', 'announcement', 'forum', 'voice', 'stage'] },
      });
      const [visible, categories] = await Promise.all([
        filterViewableChannels(user.id, all, memberships),
        Channel.find({ serverId: { in: serverIds }, type: 'category' }),
      ]);
      const categoryNames = new Map<string, string>();
      for (const c of categories) {
        categoryNames.set(c.id, c.name);
      }
      return {
        channels: visible
          .map((c) => ({
            id: c.id,
            serverId: c.serverId,
            name: c.name,
            type: c.type,
            parentName: c.parentId ? categoryNames.get(c.parentId) ?? null : null,
          })),
      };
    } catch (error) {
      console.error('Failed to fetch switcher channels:', error);
      return { channels: [] };
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
      const allChannels = await Channel.find({ serverId: { in: serverIds }, type: { in: ['text', 'announcement'] } });
      // Hide channels the user can't view (permission overwrites), otherwise
      // their server shows unread forever for a channel they can't open.
      const channels = await filterViewableChannels(user.id, allChannels, memberships);
      // The newest message's own time + author (one id-only query). The
      // channel's `updatedAt` also moves on renames and permission edits,
      // which used to light channels up with nothing new in them.
      const lastIds = [...new Set(channels.map((c) => c.lastMessageId).filter((id): id is string => typeof id === 'string' && id.length > 0))];
      const lastById = new Map<string, { createdAt: Date | null; authorId: string; isDeleted: boolean | null }>();
      if (lastIds.length > 0) {
        const rows = await db
          .select({ id: schema.messages.id, createdAt: schema.messages.createdAt, authorId: schema.messages.authorId, isDeleted: schema.messages.isDeleted })
          .from(schema.messages)
          .where(inArray(schema.messages.id, lastIds.map((id) => normalizeId(id))));
        for (const r of rows) lastById.set(r.id, r);
      }
      return {
        channels: channels.map((c) => {
          const last = c.lastMessageId ? lastById.get(c.lastMessageId) : undefined;
          const live = last && !last.isDeleted && last.createdAt ? last : null;
          return {
            channelId: c.id,
            serverId: c.serverId,
            type: c.type,
            name: c.name,
            parentId: (c as { parentId?: string | null }).parentId ?? null,
            lastMessageAt: live?.createdAt ? new Date(live.createdAt).toISOString() : null,
            lastMessageId: live ? c.lastMessageId : null,
            lastMessageAuthorId: live?.authorId ?? null,
          };
        }),
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
      const ID_RE = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{24})$/i;
      if (!ID_RE.test(channelId) || (messageId !== undefined && !ID_RE.test(messageId))) {
        set.status = 400;
        return { error: 'Invalid id' };
      }

      // Only for channels and DMs you can see: otherwise this would reveal any
      // channel's latest message id/time and write rows for it.
      const { checkChannelAccess } = await import('./channels');
      const access = await checkChannelAccess(user.id, channelId, { lean: true }).catch(() => ({ hasAccess: false }));
      if (!access.hasAccess) {
        set.status = 403;
        return { error: 'Access denied' };
      }

      // "Mark Unread" from `messageId`: the marker moves back to the message
      // above it (or to just before it when it's the first one), on purpose
      // older than what's stored, and the user's other devices follow.
      if ((body as { rewind?: boolean }).rewind) {
        if (!messageId) {
          set.status = 400;
          return { error: 'messageId is required' };
        }
        const target = await Message.findOne({ id: messageId, channelId, isDeleted: false });
        if (!target?.createdAt) {
          set.status = 404;
          return { error: 'Message not found' };
        }
        const targetAt = target.createdAt instanceof Date ? target.createdAt : new Date(target.createdAt);
        const [previous] = await Message.find({ channelId, isDeleted: false, createdAtBefore: targetAt, _limit: 1 });
        const markerId = previous?.id ?? null;
        const markerAt = previous?.createdAt ? new Date(previous.createdAt) : new Date(targetAt.getTime() - 1);
        await ChannelReadState.rewind(user.id, channelId, markerId, markerAt);
        const lastReadAt = markerAt.toISOString();
        const { notifyReadState } = await import('@/lib/api/activity');
        notifyReadState(user.id, channelId, lastReadAt, markerId, true);
        return { ok: true, channelId, lastReadMessageId: markerId, lastReadAt, rewind: true };
      }

      let readMessageId: string | null = null;
      let readAt = new Date();
      const latest = (await Message.find({ channelId, isDeleted: false, _limit: 1 }))[0]; // default order is newest-first
      // An explicit messageId must belong to this channel; otherwise fall back
      // to the channel's latest message.
      const explicit = messageId && messageId !== latest?.id ? await Message.findById(messageId) : null;
      const target = explicit && explicit.channelId === channelId ? explicit : latest;
      if (target) {
        readMessageId = target.id;
        readAt = target.createdAt instanceof Date ? target.createdAt : new Date(target.createdAt ?? Date.now());
        // Acking the newest message reads the whole channel: also cover the
        // channel's activity stamp (bumped a moment after the insert) so
        // other devices comparing against it don't keep showing it unread.
        if (latest && target.id === latest.id) {
          const ch = await Channel.findById(channelId).catch(() => null);
          const updatedAt = ch?.updatedAt ? new Date(ch.updatedAt) : null;
          if (updatedAt && !Number.isNaN(updatedAt.getTime()) && updatedAt > readAt) readAt = updatedAt;
        }
      }

      const advanced = await ChannelReadState.ack(user.id, channelId, readMessageId, readAt);
      // Not advanced (an equal or newer marker exists, e.g. another device got
      // there first): answer with the stored marker, never an older one.
      const row = advanced ?? (await ChannelReadState.findByUserChannels(user.id, [channelId]))[0] ?? null;
      const lastReadAtIso =
        (row?.lastReadAt instanceof Date ? row.lastReadAt.toISOString() : row?.lastReadAt) ?? readAt.toISOString();
      const lastReadMessageId = row?.lastReadMessageId ?? readMessageId;

      // Live cross-device sync: tell this user's OTHER open sessions the channel
      // was read so their badges clear immediately (not just on next reload).
      if (advanced) {
        const { notifyReadState } = await import('@/lib/api/activity');
        notifyReadState(user.id, channelId, lastReadAtIso, lastReadMessageId);
      }

      return {
        ok: true,
        channelId,
        lastReadMessageId,
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
      // "Mark Unread": move the marker back to just before `messageId`.
      rewind: t.Optional(t.Boolean()),
    }),
  })
  // Per-server / per-channel notification settings (level, mute, @everyone and
  // role suppression), plus each joined server's default level. Cross-device:
  // a change is pushed to the user's other sessions over the activity stream.
  .get('/@me/notification-settings', async ({ headers, cookie, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    try {
      const { getNotificationSettings, getServerDefaultLevels } = await import('@/lib/services/notificationSettings');
      const memberships = await ServerMember.find({ userId: user.id });
      const [settings, serverDefaults] = await Promise.all([
        getNotificationSettings(user.id),
        getServerDefaultLevels(memberships.map((m) => m.serverId)),
      ]);
      return { settings, serverDefaults };
    } catch (error) {
      console.error('Failed to fetch notification settings:', error);
      set.status = 500;
      return { error: 'Failed to fetch notification settings' };
    }
  })
  .patch('/@me/notification-settings', async ({ headers, cookie, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    const { scope, id, settings: patch } = body as {
      scope: 'server' | 'channel';
      id: string;
      settings: Record<string, unknown> | null;
    };
    if (!/^[0-9a-zA-Z_-]{1,64}$/.test(id)) {
      set.status = 400;
      return { error: 'Invalid id' };
    }
    try {
      const { patchNotificationSettings } = await import('@/lib/services/notificationSettings');
      const settings = await patchNotificationSettings(user.id, scope, id, patch);
      const { fanoutToUsers } = await import('@/lib/api/activity');
      void fanoutToUsers({ userIds: [user.id] }, { type: 'notification_settings', settings });
      return { settings };
    } catch (error) {
      console.error('Failed to update notification settings:', error);
      set.status = 500;
      return { error: 'Failed to update notification settings' };
    }
  }, {
    body: t.Object({
      scope: t.Union([t.Literal('server'), t.Literal('channel')]),
      id: t.String({ maxLength: 64 }),
      settings: t.Union([
        t.Null(),
        t.Object({
          level: t.Optional(t.Union([t.Null(), t.Literal('all'), t.Literal('mentions'), t.Literal('nothing')])),
          muteUntil: t.Optional(t.Union([t.Null(), t.Number()])),
          suppressEveryone: t.Optional(t.Union([t.Null(), t.Boolean()])),
          suppressRoles: t.Optional(t.Union([t.Null(), t.Boolean()])),
        }),
      ]),
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
      const userId = authUser.id;
      const user = await User.findById(userId);
      
      if (!user) {
        set.status = 404;
        return { error: 'User not found in local database' };
      }

      const { displayName, bio, pronouns, customStatus, status, settings, customization, gifFavorites, timezone, showTimezone, customStatusEmoji, customStatusExpiresAt } = body as Record<string, any>;
      const prevStatus = user.status;

      const updateFields: Record<string, any> = {};
      if (displayName !== undefined) updateFields.displayName = normalizeDisplayName(displayName);
      if (bio !== undefined) updateFields.bio = bio;
      if (pronouns !== undefined) updateFields.pronouns = pronouns;
      if (timezone !== undefined) updateFields.timezone = timezone || null;
      if (showTimezone !== undefined) updateFields.showTimezone = Boolean(showTimezone);
      if (customStatus !== undefined) updateFields.customStatus = customStatus;
      if (status !== undefined) {
        updateFields.status = status;
        // Going Invisible hides live activity: drop the cached snapshot.
        void cache.del(`activity:${user.id}`).catch(() => {});
        if (status === 'offline' || status === 'invisible') {
          updateFields.presenceLastDisconnectAt = new Date();
        } else {
          updateFields.presenceLastDisconnectAt = null;
          updateFields.presenceLastHeartbeatAt = new Date();
        }
      }
      if (settings !== undefined) {
        const currentSettings = normalizeUserSettingsShape((user.settings || {}) as Record<string, any>);
        const normalizedPatch = normalizeSettingsPatch(settings as Record<string, any>, user.id);
        if (normalizedPatch.error) {
          set.status = 400;
          return { error: normalizedPatch.error };
        }
        updateFields.settings = normalizeUserSettingsShape(mergeDeep(currentSettings, normalizedPatch.patch || {}));
      }
      if (customization !== undefined && typeof customization === 'object') {
        const merged = applyCustomizationPatch(
          user,
          // serverTag is only set through PUT /users/@me/server-tag (membership-checked).
          stripServerTagWrite(customization as Record<string, unknown>),
        );
        if ('error' in merged) {
          set.status = 400;
          return { error: merged.error };
        }
        updateFields.customization = merged.customization;
      }
      const statusPatch = applyCustomStatusPatch(user, { customStatus, customStatusEmoji, customStatusExpiresAt }, updateFields);
      if (statusPatch.error) {
        set.status = 400;
        return { error: statusPatch.error };
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
      await scheduleCustomStatusExpiry(userId, statusPatch.expiresAt);
      if (status !== undefined) await clearAutoIdleFlag(userId);

      const finalUser = updatedUser || user;
      const changedProfile = customStatus !== undefined || customStatusEmoji !== undefined || customStatusExpiresAt !== undefined || displayName !== undefined || customization !== undefined || (status !== undefined && status !== prevStatus);
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
      customStatusEmoji: t.Optional(t.Union([t.Object({}, { additionalProperties: true }), t.Null()])),
      customStatusExpiresAt: t.Optional(t.Union([t.String({ maxLength: 64 }), t.Null()])),
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
      const userId = authUser.id;
      const user = await User.findById(userId);
      
      if (!user) {
        set.status = 404;
        return { error: 'User not found in local database' };
      }

      // Parse body if it is sent as string (e.g. from text/plain beacon)
      let data = body as Record<string, unknown>;
      if (typeof body === 'string') {
        try {
          data = JSON.parse(body);
        } catch {
          // ignore
        }
      }

      const { displayName, bio, pronouns, customStatus, status, settings, customization, gifFavorites, timezone, showTimezone, customStatusEmoji, customStatusExpiresAt } = data || {};
      const prevStatus = user.status;

      const updateFields: Record<string, any> = {};
      if (displayName !== undefined) updateFields.displayName = normalizeDisplayName(displayName);
      if (bio !== undefined) updateFields.bio = bio;
      if (pronouns !== undefined) updateFields.pronouns = pronouns;
      if (timezone !== undefined) updateFields.timezone = timezone || null;
      if (showTimezone !== undefined) updateFields.showTimezone = Boolean(showTimezone);
      if (customStatus !== undefined) updateFields.customStatus = customStatus;
      if (status !== undefined) {
        updateFields.status = status;
        // Going Invisible hides live activity: drop the cached snapshot.
        void cache.del(`activity:${user.id}`).catch(() => {});
        if (status === 'offline' || status === 'invisible') {
          updateFields.presenceLastDisconnectAt = new Date();
        } else {
          updateFields.presenceLastDisconnectAt = null;
          updateFields.presenceLastHeartbeatAt = new Date();
        }
      }
      if (settings !== undefined) {
        const currentSettings = normalizeUserSettingsShape((user.settings || {}) as Record<string, any>);
        const normalizedPatch = normalizeSettingsPatch(settings as Record<string, any>, user.id);
        if (!normalizedPatch.error) {
          updateFields.settings = normalizeUserSettingsShape(mergeDeep(currentSettings, normalizedPatch.patch || {}));
        }
      }
      if (customization !== undefined && typeof customization === 'object') {
        const merged = applyCustomizationPatch(
          user,
          // serverTag is only set through PUT /users/@me/server-tag (membership-checked).
          stripServerTagWrite(customization as Record<string, unknown>),
        );
        if ('error' in merged) {
          set.status = 400;
          return { error: merged.error };
        }
        updateFields.customization = merged.customization;
      }
      const statusPatch = applyCustomStatusPatch(user, { customStatus, customStatusEmoji, customStatusExpiresAt }, updateFields);
      if (statusPatch.error) {
        set.status = 400;
        return { error: statusPatch.error };
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
      await scheduleCustomStatusExpiry(userId, statusPatch.expiresAt);
      if (status !== undefined) await clearAutoIdleFlag(userId);

      const finalUser = updatedUser || user;
      const changedProfile = customStatus !== undefined || customStatusEmoji !== undefined || customStatusExpiresAt !== undefined || displayName !== undefined || customization !== undefined || (status !== undefined && status !== prevStatus);
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
  .post('/me/presence/heartbeat', async ({ headers, cookie, body, set }) => {
    const { user: authUser, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!authUser) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const user = await User.findById(authUser.id);
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
    // Automatic idle: the client says whether this device saw input in the
    // last 10 minutes. Only online <-> (automatic) idle ever changes here.
    const idle = parseHeartbeatIdle(body);
    const heartbeatApp = (body as { app?: unknown } | null)?.app;
    if (idle !== undefined && heartbeatApp !== 'android' && heartbeatApp !== 'ios') {
      void import('@/lib/services/pushNotifications')
        .then((m) => m.setDesktopAttending(user.id, !idle))
        .catch(() => { /* best-effort */ });
    }
    let autoStatus: 'online' | 'idle' | null = null;
    if (idle !== undefined) {
      autoStatus = await resolveAutoIdle(user.id, user.status, idle);
      if (autoStatus) updateFields.status = autoStatus;
    }
    const updatedUser = await User.updateById(user.id, updateFields) || user;
    if (autoStatus) await invalidateUserCache(user.id);

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

    return { success: true, ...(autoStatus ? { status: autoStatus } : {}) };
  })
  // Sent by a closing tab (sendBeacon). Ends the heartbeat instead of writing
  // status "offline": the chosen status (online/idle/dnd) survives reloads, and
  // the user stays online while another tab or device is still open. Waits a
  // moment so a reload's new tab can reconnect first.
  .post('/me/presence/disconnect', async ({ headers, cookie, set }) => {
    const { user: authUser, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!authUser) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    const userId = authUser.id;
    setTimeout(() => {
      void (async () => {
        try {
          const { hasActivityConnection } = await import('@/lib/api/activity');
          if (hasActivityConnection(userId)) return;
          const user = await User.findById(userId);
          if (!user) return;
          const previousStatus = resolveEffectiveStatus(user as any);
          const updatedUser = await User.updateById(userId, {
            presenceLastHeartbeatAt: null,
            presenceLastDisconnectAt: new Date(),
          }) || user;
          await invalidateUserCache(userId);
          if (previousStatus !== 'offline') {
            emitFriendEvent((updatedUser.friends || []).map((f: string) => f), {
              type: 'presence:update',
              userId,
              status: 'offline',
              timestamp: Date.now(),
            });
          }
        } catch (err) {
          console.error('Presence disconnect failed:', err);
        }
      })();
    }, 8000);
    return { success: true };
  })
  .get('/me/settings', async ({ headers, cookie, set }) => {
    const { user: authUser, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!authUser) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const user = await User.findById(authUser.id);
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

    const user = await User.findById(authUser.id);
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

    const normalizedPatch = normalizeSettingsPatch(patch, user.id);
    if (normalizedPatch.error) {
      set.status = 400;
      return { error: normalizedPatch.error };
    }

    const newSettings = normalizeUserSettingsShape(mergeDeep(currentSettings, normalizedPatch.patch || {}));
    const updatedUser = await User.updateById(user.id, { settings: newSettings });
    await invalidateUserCache(user.id);
    // Activity privacy changes show up at once instead of after the cache TTL.
    if (normalizedPatch.patch?.privacy) await cache.del(`activity:${user.id}`).catch(() => {});

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

    const apps = await AuthorizedApp.find({ userId: authUser.id });
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
      userId: authUser.id,
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

    // Scoped to the caller: another user's row id must not be deletable.
    const row = isValidObjectId(normalizeId(params.appId)) ? await AuthorizedApp.findById(params.appId) : null;
    const deleted = isValidObjectId(normalizeId(params.appId))
      && await AuthorizedApp.deleteByIdForUser(params.appId, authUser.id);
    if (!deleted) {
      set.status = 404;
      return { error: 'Authorized app not found' };
    }
    // Its OAuth2 access / refresh tokens stop working too.
    if (row) {
      try {
        const { revokeTokensForAuthorizedApp } = await import('@/lib/services/oauth2Tokens');
        await revokeTokensForAuthorizedApp(authUser.id, row);
      } catch (err) {
        console.error('[oauth2] revoke on deauthorize failed:', (err as Error)?.message ?? err);
        set.status = 500;
        return { error: 'Removed, but its access could not be revoked. Try again.' };
      }
    }
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
    const userId = authUser.id;

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
        ipAddress: anonymizeIp(getClientIP(request)),
      });
    } else {
      await UserDeviceSession.create({
        userId,
        deviceName,
        platform,
        browser: uaFingerprint,
        ipAddress: anonymizeIp(getClientIP(request)),
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

    const deleted = isValidObjectId(normalizeId(params.deviceId))
      && await UserDeviceSession.deleteByIdForUser(params.deviceId, authUser.id);
    if (!deleted) {
      set.status = 404;
      return { error: 'Device not found' };
    }
    return { success: true };
  }, {
    params: t.Object({
      deviceId: t.String(),
    }),
  })
  // `?refresh=1` re-asks Serika Accounts for a Discord link it said was missing.
  .get('/me/connections', async ({ headers, cookie, query, set }) => {
    const { user: authUser, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!authUser) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const userId = authUser.id;
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
            provider: 'serika' as const,
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

    // Discord is linked in Serika Accounts: pick up a link made after sign-in.
    if (!connections.some(c => c.provider === 'discord')) {
      try {
        const { resolveLinkedDiscord } = await import('@/lib/services/discordConnection');
        const fresh = (query as Record<string, unknown> | undefined)?.refresh === '1';
        if (await resolveLinkedDiscord(userId, { fresh })) {
          const row = await UserConnection.findOne({ userId, provider: 'discord' });
          if (row) connections.push(row);
        }
      } catch (err) {
        console.error('Failed to sync discord connection in GET /connections:', err);
      }
    }

    connections.sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
    return { connections: connections.map(toOwnConnectionView) };
  })
  .post('/me/connections', async ({ headers, cookie, body, set }) => {
    const { user: authUser, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!authUser) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const payload = body as Record<string, any>;
    const userId = authUser.id;
    // Providers with an OAuth flow (discord, steam, lastfm, ...) are only ever
    // created by their OAuth callbacks: a self-declared Discord id would
    // otherwise hijack that person's Discord-bridge identity.
    if (!isSelfDeclarableProvider(payload.provider)) {
      set.status = 400;
      return {
        error: payload.provider === 'website'
          ? 'Websites are added through domain verification'
          : 'This account type can only be linked through its sign-in flow',
      };
    }
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
      }) || connection;
    } else {
      connection = await UserConnection.create({
        userId,
        provider: payload.provider,
        accountId: payload.accountId,
        username: payload.username || null,
        displayName: payload.displayName || null,
        avatar: payload.avatar || null,
        // Client-supplied metadata is never stored: it is reserved for
        // OAuth-issued data (tokens, verification markers).
        metadata: null,
      });
    }

    return { connection: toOwnConnectionView(connection) };
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
  // Add a domain (or return the existing one). It stays off the profile until
  // its TXT record is verified by POST /me/connections/:id/verify.
  .post('/me/connections/domains', async ({ headers, cookie, body, set }) => {
    const { user: authUser, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!authUser) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    const { getPlatformSettings } = await import('@/lib/models/PlatformSettings');
    const settings = await getPlatformSettings();
    if (settings.connectionsEnabled === false || (settings.disabledProviders || []).includes('website')) {
      set.status = 403;
      return { error: 'Domain connections are currently disabled' };
    }
    const domain = normalizeDomain(body.domain);
    if (!domain) {
      set.status = 400;
      return { error: 'Enter a valid domain, like example.com' };
    }

    const userId = authUser.id;
    const existing = await UserConnection.find({ userId, provider: 'website' });
    const current = existing.find((c) => c.accountId === domain && readDomainVerification(c.metadata));
    if (current) return { connection: toOwnConnectionView(current) };

    // Unverified rows from before verification existed, for the same domain,
    // are replaced by this one.
    const legacy = existing.filter((c) => !readDomainVerification(c.metadata) && normalizeDomain(c.accountId) === domain);
    if (existing.length - legacy.length >= MAX_DOMAINS_PER_USER) {
      set.status = 400;
      return { error: `You can link up to ${MAX_DOMAINS_PER_USER} domains` };
    }
    for (const row of legacy) await UserConnection.deleteByIdForUser(row.id, userId);

    let connection;
    try {
      connection = await UserConnection.create({
        userId,
        provider: 'website',
        accountId: domain,
        displayName: domain,
        visible: true,
        metadata: newDomainMetadata(createDomainToken()),
      });
    } catch {
      // Lost a race with a concurrent add of the same domain.
      connection = await UserConnection.findOne({ userId, provider: 'website', accountId: domain });
    }
    if (!connection) {
      set.status = 500;
      return { error: 'Failed to add domain' };
    }
    return { connection: toOwnConnectionView(connection) };
  }, {
    body: t.Object({
      domain: t.String({ minLength: 1, maxLength: 300 }),
    }),
  })
  // Look up the domain's TXT record and mark the connection verified.
  .post('/me/connections/:connectionId/verify', async ({ headers, cookie, params, set }) => {
    const { user: authUser, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!authUser) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    const connection = isValidObjectId(normalizeId(params.connectionId))
      ? await UserConnection.findById(params.connectionId)
      : null;
    if (!connection || connection.provider !== 'website' || !compareIds(connection.userId, authUser.id)) {
      set.status = 404;
      return { error: 'Connection not found' };
    }
    const challenge = readDomainVerification(connection.metadata);
    if (!challenge) {
      set.status = 409;
      return { error: 'Re-add this domain to get a verification record', code: 'verification_not_started' };
    }
    if (challenge.verified) return { connection: toOwnConnectionView(connection) };

    const rate = await checkRateLimit('domainVerify', authUser.id);
    if (!rate.success) {
      set.status = 429;
      return { error: 'Too many verification attempts. Try again in a few minutes.', retryAfter: rate.retryAfter };
    }

    const { checkDomainOwnership } = await import('@/lib/services/domainVerification');
    const result = await checkDomainOwnership(connection.accountId, challenge.token);
    if (result.error) {
      set.status = 502;
      return { error: 'Could not look up DNS for this domain. Try again in a minute.', code: 'dns_error' };
    }
    if (!result.ok && result.found?.length) {
      // A serika-verification record exists but with another code (stale or mistyped).
      set.status = 400;
      return {
        error: "A serika-verification record was found, but its code doesn't match this domain's.",
        code: 'token_mismatch',
        found: result.found,
        connection: toOwnConnectionView(connection),
      };
    }
    if (!result.ok) {
      set.status = 400;
      return {
        error: 'TXT record not found yet. DNS changes can take a few minutes to show up.',
        code: 'record_not_found',
        connection: toOwnConnectionView(connection),
      };
    }

    const updated = await UserConnection.updateByIdForUser(connection.id, authUser.id, {
      metadata: verifiedDomainMetadata(challenge.token, new Date()),
    });
    return { connection: toOwnConnectionView(updated ?? connection) };
  }, {
    params: t.Object({
      connectionId: t.String(),
    }),
  })
  .delete('/me/connections/:connectionId', async ({ headers, cookie, params, set }) => {
    const { user: authUser, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!authUser) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const deleted = isValidObjectId(normalizeId(params.connectionId))
      && await UserConnection.deleteByIdForUser(params.connectionId, authUser.id);
    if (!deleted) {
      set.status = 404;
      return { error: 'Connection not found' };
    }
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

    const connection = isValidObjectId(normalizeId(params.connectionId))
      ? await UserConnection.updateByIdForUser(params.connectionId, authUser.id, update)
      : null;

    if (!connection) {
      set.status = 404;
      return { error: 'Connection not found' };
    }

    return { connection: toOwnConnectionView(connection) };
  }, {
    params: t.Object({
      connectionId: t.String(),
    }),
    body: t.Object({
      visible: t.Optional(t.Boolean()),
    }),
  })
  // Private notes about other users ("Note — only visible to you").
  .get('/@me/notes', async ({ headers, cookie, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    const { listUserNotes } = await import('@/lib/services/userNotes');
    return { notes: await listUserNotes(user.id) };
  })
  .get('/@me/notes/:userId', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    const { getUserNote } = await import('@/lib/services/userNotes');
    return { userId: params.userId, note: await getUserNote(user.id, params.userId) };
  }, {
    params: t.Object({ userId: t.String() }),
  })
  .put('/@me/notes/:userId', async ({ headers, cookie, params, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    if (compareIds(params.userId, user.id)) {
      set.status = 400;
      return { error: 'You cannot add a note to yourself' };
    }
    const rl = await checkRateLimit('userNote', user.id);
    if (!rl.success) {
      set.status = 429;
      return { error: 'Too many requests', retryAfter: rl.retryAfter };
    }
    const target = await User.findById(params.userId);
    if (!target) {
      set.status = 404;
      return { error: 'User not found' };
    }
    const { setUserNote } = await import('@/lib/services/userNotes');
    const note = await setUserNote(user.id, target.id, body.note);
    // Keep the note in sync on the user's other tabs and devices.
    const { fanoutToUsers } = await import('@/lib/api/activity');
    void fanoutToUsers({ userIds: [user.id] }, { type: 'user_note_update', userId: target.id, note });
    return { userId: target.id, note };
  }, {
    params: t.Object({ userId: t.String() }),
    body: t.Object({ note: t.String({ maxLength: 2048 }) }),
  })
  // Choose the server whose tag shows next to your name (CORD-53), or clear it.
  // Only a server you are a member of, with its tag turned on.
  .put('/@me/server-tag', async ({ headers, cookie, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    const current = await User.findById(user.id);
    if (!current) {
      set.status = 404;
      return { error: 'User not found' };
    }
    const base = { ...((current.customization || {}) as Record<string, unknown>) };
    const serverId = body.serverId ?? null;
    if (serverId === null) {
      delete base.serverTag;
      await User.updateById(user.id, { customization: base });
      await invalidateUserCache(user.id);
      return { serverTag: null };
    }
    if (!isValidObjectId(serverId)) {
      set.status = 400;
      return { error: 'Invalid server ID' };
    }
    const { canAdoptServerTag } = await import('@/lib/services/serverTags');
    const tag = await canAdoptServerTag(serverId, user.id);
    if (!tag) {
      set.status = 400;
      return { error: 'That server has no tag, or you are not a member of it' };
    }
    base.serverTag = { serverId: tag.serverId };
    await User.updateById(user.id, { customization: base });
    await invalidateUserCache(user.id);
    return { serverTag: tag };
  }, {
    body: t.Object({ serverId: t.Union([t.String({ maxLength: 64 }), t.Null()]) }),
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
    let friendRequestReceived = false;
    let isBlocked = false;
    let isSelf = false;
    let note: string | undefined;
    try {
      const { user: requester } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
      if (requester) {
        isFriend = (requester.friends || []).some((f: string) => compareIds(f, targetUser.id));
        const outgoing = ((requester.pendingFriendRequests as IPendingFriendRequests)?.outgoing || []) as string[];
        const incoming = ((requester.pendingFriendRequests as IPendingFriendRequests)?.incoming || []) as string[];
        friendRequestSent = outgoing.some((f: string) => compareIds(f, targetUser.id));
        friendRequestReceived = incoming.some((f: string) => compareIds(f, targetUser.id));
        isBlocked = (requester.blockedUsers || []).some((b: string) => compareIds(b, targetUser.id));
        isSelf = compareIds(requester.id, targetUser.id);
        if (!isSelf) {
          const { getUserNote } = await import('@/lib/services/userNotes');
          note = await getUserNote(requester.id, targetUser.id).catch(() => undefined);
        }
      }
    } catch {
      // Not authenticated — leave isFriend false
    }

    // Public connections — strip sensitive metadata (e.g. session keys).
    // Hidden ones are filtered here: UserConnection.find has no 'visible' key,
    // and the column is nullable (NULL means visible).
    // Websites only show once their domain is DNS-verified.
    const rawConnections = filterUnverifiedDomains(
      filterVisibleConnections(await UserConnection.find({ userId: targetUser.id }), isSelf),
    );
    const connections = rawConnections.map((c) => ({
      provider: c.provider,
      accountId: c.accountId,
      username: c.username,
      displayName: c.displayName,
      avatar: c.avatar,
      visible: c.visible !== false,
      ...(c.provider === 'website' ? { verified: true } : {}),
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
      customization: (await resolveCustomization(targetUser)) || {},
      createdAt: targetUser.createdAt,
      connections,
      isFriend,
      friendRequestSent,
      friendRequestReceived,
      isBlocked,
      ...(note !== undefined ? { note } : {}),
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
      customization: withoutServerTag(f.customization),
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
    const result = await loadUserActivity(params.userId);
    if (!result) {
      set.status = 404;
      return { error: 'User not found' };
    }
    return result;
  }, {
    params: t.Object({
      userId: t.String(),
    }),
  })
  // Same data for many users in one request (member list, DM list): the
  // client batches every visible user into one poll instead of one per row.
  .get('/activity/batch', async ({ query, set }) => {
    const ids = [...new Set(String(query.ids || '').split(',').map((id) => id.trim()).filter(isUuidLike))].slice(0, 100);
    if (ids.length === 0) {
      set.status = 400;
      return { error: 'ids is required' };
    }
    const results = await loadUserActivities(ids).catch(() => new Map<string, Record<string, unknown>>());
    const activities: Record<string, unknown> = {};
    for (const id of ids) {
      const result = results.get(activityUserKey(id));
      if (result) activities[id] = result;
    }
    return { activities };
  }, {
    query: t.Object({ ids: t.String() }),
  })
  // Public recent-activity history for a user's profile. Respects the target
  // user's activity privacy (games & apps switch) and Invisible status.
  .get('/:userId/activity-history', async ({ params, query, set }) => {
    const targetUser = await User.findById(params.userId);
    if (!targetUser) {
      set.status = 404;
      return { error: 'User not found' };
    }
    // History is games and apps, so it follows that switch; hidden while
    // Invisible too (its "last seen" times would give you away).
    if (!activitySharing(targetUser.settings).games || activityHiddenByStatus(targetUser.status)) {
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

    const raw = body as Record<string, unknown>;
    const incoming = Array.isArray(raw.activities)
      ? raw.activities.filter((a: any) => a?.name)
      : raw?.name ? [raw] : [];

    // Desktop app sends a heartbeat every 15s; TTL = 60s gives 3 missed beats before expiry
    const expiresAt = new Date(Date.now() + 60_000);
    const authUserId = authUser.id;
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

      const fields = {
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
      };

      // One atomic upsert per (user, type, name) on the existing unique index:
      // each activity keeps its own row, and two overlapping heartbeats can't
      // race into a unique violation.
      await db.insert(schema.richPresence)
        .values({ userId: authUserId, type, name, ...fields })
        .onConflictDoUpdate({
          target: [schema.richPresence.userId, schema.richPresence.type, schema.richPresence.name],
          set: { ...fields, updatedAt: new Date() },
        });
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
    const storeHistory = (authUser.settings as IUserSettings | undefined)?.privacy?.storeActivityHistory ?? true;
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
    const authUserId = authUser.id;
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
    const authUserId = authUser.id;
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
    const authUserId = authUser.id;
    await ActivityHistory.clear(authUserId);
    return { ok: true };
  });

// Friends routes
const friendsRoutes = new Elysia({ prefix: '/friends' })
  .onBeforeHandle(rejectInvalidObjectIdParams)
  .get('/', async ({ headers, cookie, set }) => {
    const { user: authUser, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!authUser) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    // Read the friend lists fresh: the auth user is a 5-minute cached copy.
    const user = (await User.findById(authUser.id).catch(() => null)) || authUser;

    // Batch fetch friends, pending requests, and blocked users (deduped so
    // rows duplicated by older concurrent writes render once)
    const friendIds = dedupeIds(user.friends);
    const incomingIds = dedupeIds((user.pendingFriendRequests as IPendingFriendRequests)?.incoming);
    const outgoingIds = dedupeIds((user.pendingFriendRequests as IPendingFriendRequests)?.outgoing);
    const blockedIds = dedupeIds(user.blockedUsers);
    
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
        customization: withoutServerTag(u.customization || null),
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
    const { user: authUser, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!authUser) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    // Read the friend list fresh: the auth user is a 5-minute cached copy.
    const user = (await User.findById(authUser.id).catch(() => null)) || authUser;

    const friendIds = dedupeIds(user.friends);
    if (friendIds.length === 0) return { active: [] };

    const friends = await User.find({ id: { in: friendIds } });

    // Online friends who share their activity. Offline users never show in
    // Active Now.
    const candidates = friends
      .filter((friend) => ((friend.settings as IUserSettings | undefined)?.privacy?.showActivity ?? true))
      .map((friend) => ({ friend, effectiveStatus: getPublicPresenceStatus(friend) }))
      .filter(({ effectiveStatus }) => effectiveStatus !== 'offline');
    if (candidates.length === 0) return { active: [] };

    // One batched (and shared-cache) activity lookup for every candidate
    // instead of two queries per friend.
    const activityById = await loadUserActivities(candidates.map(({ friend }) => friend.id))
      .catch(() => new Map<string, Record<string, unknown>>());

    const active = candidates.flatMap(({ friend, effectiveStatus }) => {
      const entry = activityById.get(activityUserKey(friend.id)) as
        | { activity?: unknown; music?: unknown; game?: unknown; activities?: unknown[] }
        | undefined;
      if (!entry) return [];
      const activities = Array.isArray(entry.activities) ? entry.activities : [];
      const hasActivity = entry.activity || activities.length > 0 || entry.music;
      if (!hasActivity) return [];
      return [{
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
          activity: entry.activity ?? null,
          music: entry.music ?? null,
          game: entry.game ?? activities[0] ?? null,
          activities,
        },
      }];
    });

    return { active };
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
    const authUserId = authUser.id;
    const rateLimit = await checkRateLimit('friendRequest', `${authUserId}:${ip}`);
    if (!rateLimit.success) {
      set.status = 429;
      return { error: 'Too many friend requests', retryAfter: rateLimit.retryAfter };
    }

    // Find user by username (case insensitive - Drizzle doesn't support regex, so try exact then lowercased)
    let foundUser = await User.findOne({ username });
    if (!foundUser) {
      // Try case-insensitive by fetching all and filtering
      const allUsers = await User.find({});
      const found = allUsers.find(u => u.username.toLowerCase() === username.toLowerCase());
      if (found) foundUser = found;
    }

    if (!foundUser) {
      set.status = 404;
      return { error: `User "${username}" not found. Make sure you entered the correct username.` };
    }

    if (compareIds(foundUser.id, authUserId)) {
      set.status = 400;
      return { error: 'You cannot send a friend request to yourself' };
    }

    // "Who can send you a friend request" (Everyone / Friends of Friends /
    // Server Members): only look up the ties when the target narrowed it.
    const ties = { mutualFriend: false, mutualServer: false };
    if (!friendRequestSources(foundUser.settings as Parameters<typeof friendRequestSources>[0]).everyone) {
      ties.mutualFriend = (authUser.friends || []).some((f: string) => (foundUser!.friends || []).some((g: string) => compareIds(f, g)));
      if (!ties.mutualFriend) {
        const [mine, theirs] = await Promise.all([
          ServerMember.find({ userId: authUserId }),
          ServerMember.find({ userId: foundUser.id }),
        ]);
        const myServers = new Set(mine.map((m) => normalizeId(m.serverId)));
        ties.mutualServer = theirs.some((m) => myServers.has(normalizeId(m.serverId)));
      }
    }

    // Both rows are re-read and locked inside the transaction, so every check
    // below sees the current state and concurrent requests can't clobber it.
    const outcome = await mutateFriendPair(authUserId, foundUser.id, async (user, targetUser, save) => {
      const targetName = targetUser.displayName || targetUser.username;

      // Block friend requests to system users
      if (targetUser.isSystem) {
        return { status: 403, body: { error: 'You cannot send a friend request to a system user' } };
      }

      // Check if already friends
      if (hasId(user.friends, targetUser.id)) {
        return { status: 400, body: { error: `You're already friends with ${targetName}` } };
      }

      // Check if blocked
      if (hasId(user.blockedUsers, targetUser.id)) {
        return { status: 400, body: { error: 'You have blocked this user. Unblock them first to send a friend request.' } };
      }

      // Check if target blocked the user
      if (hasId(targetUser.blockedUsers, user.id)) {
        return { status: 403, body: { error: 'Unable to send friend request to this user' } };
      }
      // Privacy: "Allow friend requests from" set to nobody.
      if (!acceptsFriendRequests(targetUser.settings as IUserSettings | undefined)) {
        return { status: 403, body: { error: `${targetUser.displayName || targetUser.username} is not accepting friend requests` } };
      }

      // Check privacy settings
      if ((targetUser.settings as IUserSettings | undefined)?.privacy?.friendRequests === 'none') {
        return { status: 403, body: { error: `${targetName} is not accepting friend requests` } };
      }

      // Check if request already pending
      const userPending = user.pendingFriendRequests as IPendingFriendRequests | null;
      const targetPending = targetUser.pendingFriendRequests as IPendingFriendRequests | null;
      const outgoing = (userPending?.outgoing || []) as string[];
      const incoming = (userPending?.incoming || []) as string[];
      if (hasId(outgoing, targetUser.id)) {
        return { status: 400, body: { error: `You already sent a friend request to ${targetName}` } };
      }

      // Check if they sent us a request - auto-accept
      if (hasId(incoming, targetUser.id)) {
        await save(user.id, {
          friends: addId(user.friends, targetUser.id),
          pendingFriendRequests: { incoming: removeId(incoming, targetUser.id), outgoing: dedupeIds(outgoing) },
        });
        await save(targetUser.id, {
          friends: addId(targetUser.friends, user.id),
          pendingFriendRequests: { incoming: dedupeIds(targetPending?.incoming), outgoing: removeId(targetPending?.outgoing, user.id) },
        });
        return {
          changed: true,
          body: {
            success: true,
            accepted: true,
            message: `You are now friends with ${targetName}!`,
            user: {
              id: targetUser.id,
              username: targetUser.username,
              displayName: targetUser.displayName,
              avatar: targetUser.avatar,
              status: getPublicPresenceStatus(targetUser),
            },
          },
        };
      }

      // Privacy: the target only takes requests from friends of friends
      // and/or people they share a server with.
      if (!friendRequestAllowedFrom(targetUser.settings as Parameters<typeof friendRequestAllowedFrom>[0], ties)) {
        return { status: 403, body: { error: `${targetName} is not accepting friend requests from you` } };
      }

      // Send friend request
      await save(user.id, {
        pendingFriendRequests: { incoming: dedupeIds(incoming), outgoing: addId(outgoing, targetUser.id) },
      });
      await save(targetUser.id, {
        pendingFriendRequests: { incoming: addId(targetPending?.incoming, user.id), outgoing: dedupeIds(targetPending?.outgoing) },
      });
      return {
        changed: true,
        body: { success: true, message: `Friend request sent to ${targetName}` },
      };
    });

    return finishFriendMutation(outcome, authUserId, foundUser.id, set);
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

    const outcome = await mutateFriendPair(authUser.id, params.userId, async (user, targetUser, save) => {
      // Check if there's a pending request (re-checked under the lock, so a
      // double-click or a second device can't accept twice)
      const userPending = user.pendingFriendRequests as IPendingFriendRequests | null;
      const targetPending = targetUser.pendingFriendRequests as IPendingFriendRequests | null;
      if (!hasId(userPending?.incoming, targetUser.id)) {
        return { status: 400, body: { error: 'No pending friend request from this user' } };
      }

      await save(user.id, {
        friends: addId(user.friends, targetUser.id),
        pendingFriendRequests: { incoming: removeId(userPending?.incoming, targetUser.id), outgoing: dedupeIds(userPending?.outgoing) },
      });
      await save(targetUser.id, {
        friends: addId(targetUser.friends, user.id),
        pendingFriendRequests: { incoming: dedupeIds(targetPending?.incoming), outgoing: removeId(targetPending?.outgoing, user.id) },
      });

      return {
        changed: true,
        body: {
          success: true,
          message: `You are now friends with ${targetUser.displayName || targetUser.username}!`,
        },
      };
    });

    return finishFriendMutation(outcome, authUser.id, params.userId, set);
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

    const outcome = await mutateFriendPair(authUser.id, params.userId, async (user, targetUser, save) => {
      // Remove from outgoing
      const userPending = user.pendingFriendRequests as IPendingFriendRequests | null;
      const targetPending = targetUser.pendingFriendRequests as IPendingFriendRequests | null;
      await save(user.id, {
        pendingFriendRequests: { incoming: dedupeIds(userPending?.incoming), outgoing: removeId(userPending?.outgoing, targetUser.id) },
      });
      await save(targetUser.id, {
        pendingFriendRequests: { incoming: removeId(targetPending?.incoming, user.id), outgoing: dedupeIds(targetPending?.outgoing) },
      });
      return { changed: true, body: { success: true, message: 'Friend request cancelled' } };
    });

    return finishFriendMutation(outcome, authUser.id, params.userId, set);
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

    const outcome = await mutateFriendPair(authUser.id, params.userId, async (user, targetUser, save) => {
      // Remove from incoming
      const userPending = user.pendingFriendRequests as IPendingFriendRequests | null;
      const targetPending = targetUser.pendingFriendRequests as IPendingFriendRequests | null;
      await save(user.id, {
        pendingFriendRequests: { incoming: removeId(userPending?.incoming, targetUser.id), outgoing: dedupeIds(userPending?.outgoing) },
      });
      await save(targetUser.id, {
        pendingFriendRequests: { incoming: dedupeIds(targetPending?.incoming), outgoing: removeId(targetPending?.outgoing, user.id) },
      });
      return { changed: true, body: { success: true, message: 'Friend request declined' } };
    });

    return finishFriendMutation(outcome, authUser.id, params.userId, set);
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

    if (compareIds(params.userId, authUser.id)) {
      set.status = 400;
      return { error: 'You cannot block yourself' };
    }

    const outcome = await mutateFriendPair(authUser.id, params.userId, async (user, targetUser, save) => {
      // Already blocked?
      if (hasId(user.blockedUsers, targetUser.id)) {
        return { status: 400, body: { error: 'User is already blocked' } };
      }

      const userPending = user.pendingFriendRequests as IPendingFriendRequests | null;
      const targetPending = targetUser.pendingFriendRequests as IPendingFriendRequests | null;

      // Remove from friends, drop any pending requests, add to blocked list
      await save(user.id, {
        friends: removeId(user.friends, targetUser.id),
        blockedUsers: addId(user.blockedUsers, targetUser.id),
        pendingFriendRequests: { incoming: removeId(userPending?.incoming, targetUser.id), outgoing: removeId(userPending?.outgoing, targetUser.id) },
      });
      await save(targetUser.id, {
        friends: removeId(targetUser.friends, user.id),
        pendingFriendRequests: { incoming: removeId(targetPending?.incoming, user.id), outgoing: removeId(targetPending?.outgoing, user.id) },
      });
      return { changed: true, body: { success: true, message: 'User blocked' } };
    });

    return finishFriendMutation(outcome, authUser.id, params.userId, set);
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

    const outcome = await mutateFriendPair(authUser.id, params.userId, async (user, targetUser, save) => {
      await save(user.id, { blockedUsers: removeId(user.blockedUsers, targetUser.id) });
      return { changed: true, body: { success: true, message: 'User unblocked' } };
    });

    return finishFriendMutation(outcome, authUser.id, params.userId, set);
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

    const outcome = await mutateFriendPair(authUser.id, params.userId, async (user, targetUser, save) => {
      // Check if actually friends
      if (!hasId(user.friends, targetUser.id)) {
        return { status: 400, body: { error: 'You are not friends with this user' } };
      }

      await save(user.id, { friends: removeId(user.friends, targetUser.id) });
      await save(targetUser.id, { friends: removeId(targetUser.friends, user.id) });
      return { changed: true, body: { success: true, message: 'Friend removed' } };
    });

    return finishFriendMutation(outcome, authUser.id, params.userId, set);
  }, {
    params: t.Object({
      userId: t.String(),
    }),
  });

// Bug Report routes (user-facing)
const bugReportRoutes = new Elysia({ prefix: '/bug-reports' })
  // New submissions live in Serika Issues; legacy reads/deletes remain available.
  .post('/', ({ set }) => {
    set.status = 410;
    return {
      error: 'Reports have moved to https://issues.serika.dev/issues/new?project=serikacord',
      code: 'REPORTING_MOVED',
      reportUrl: 'https://issues.serika.dev/issues/new?project=serikacord',
    };
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
/**
 * Drop server channels the user can't view (permission overwrites, private
 * threads). Channels without overwrites are visible to every member, so only
 * restricted ones pay for a full access check.
 */
async function filterViewableChannels<C extends { id: string; serverId?: string | null; type?: string | null; permissionOverwrites?: unknown }>(
  userId: string,
  channels: C[],
  memberships?: ReadonlyArray<{ serverId: string; roles?: string[] | null }>,
): Promise<C[]> {
  // Batched: one membership/owner lookup per server instead of a full
  // checkChannelAccess (3-4 queries) per restricted channel.
  const { filterViewableServerChannels } = await import('./channels');
  return filterViewableServerChannels(userId, channels, memberships);
}

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

      // Get all channels in those servers the user can actually view
      const channels = await filterViewableChannels(user.id, await Channel.find({ serverId: { in: serverIds } }), memberships);
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

      // Mentions filtered and limited in SQL (was a full-history scan).
      const filteredMessages = await Message.findMentionsOf({
        channelIds,
        userId: user.id,
        roleIds: [...allUserRoleIds],
        since: sevenDaysAgo,
        limit: 50,
      });

      // Read state comes from the cross-device read markers.
      const { ChannelReadState } = await import('@/lib/models/ChannelReadState');
      const mentionChannelIds = [...new Set(filteredMessages.map(m => m.channelId))];
      const readRows = await ChannelReadState.findByUserChannels(user.id, mentionChannelIds);
      const lastReadAt = new Map<string, number>();
      for (const r of readRows) {
        if (r.lastReadAt) lastReadAt.set(r.channelId, new Date(r.lastReadAt).getTime());
      }

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
        if (msg.mentionEveryone) {
          mentionType = 'everyone';
        }

        return {
          id: msg.id,
          type: 'mention' as const,
          title: author ? (author.displayName || author.username) : 'Unknown',
          description: `${mentionType === 'everyone' ? '@everyone' : 'mentioned you'} in #${channelName}`,
          avatar: author ? author.avatar : null,
          timestamp: msg.createdAt instanceof Date ? msg.createdAt.toISOString() : String(msg.createdAt),
          isRead: new Date(msg.createdAt ?? 0).getTime() <= (lastReadAt.get(channelId) ?? 0),
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

  // ── Profile Board placements (users.profileWidgets) ───────────────────────
  // One ordered list for everything on the Board: game sections, app widgets
  // and Serika Wishlist widgets. App widgets are hydrated with their published
  // config + this user's dynamic data; built-ins pass through. `order` is the
  // Board order including game sections that have no placement yet.
  .get('/:userId/profile-widgets', async ({ headers, cookie, params, set }) => {
    const { user } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    const targetId = params.userId === '@me' ? user.id : params.userId;
    if (!isValidObjectId(targetId)) { set.status = 400; return { error: 'Invalid user id' }; }
    // Always read placements fresh: the auth user object is cached for minutes,
    // so the owner would otherwise not see a widget they just added.
    const target = await User.findById(targetId);
    if (!target) { set.status = 404; return { error: 'User not found' }; }
    const { resolveLegacyWishlistPlacements } = await import('@/lib/services/serikaWishlist');
    const { boardOrder, placementId } = await import('@/lib/profileBoard');
    const stored = await resolveLegacyWishlistPlacements(target.id, target.profileWidgets);
    const placements = (Array.isArray(stored) ? stored : []) as Array<{ type?: string; applicationId?: string; [key: string]: unknown }>;
    const { WidgetConfig, WidgetUserData, Application } = await import('@/lib/models');
    const resolved = await Promise.all(placements.map(async (p, i) => {
      const id = placementId(p, i);
      if (p.type !== 'application' || !p.applicationId) return { ...p, id };
      const config = await WidgetConfig.findByApplication(p.applicationId);
      if (!config) return null;
      const app = await Application.findById(p.applicationId);
      // App owners can see their own widgets even in draft status
      if (config.status !== 'published') {
        if (!app || app.ownerId !== user.id) return null;
      }
      const data = await WidgetUserData.findOne({ applicationId: p.applicationId, userId: targetId });
      return {
        ...p,
        id,
        config: { name: config.name, surfaces: config.surfaces },
        data: data?.data ?? config.sampleData ?? null,
        application: app ? { name: app.name ?? null, icon: app.icon ?? null } : null,
      };
    }));
    return { widgets: resolved.filter(Boolean), order: boardOrder(placements) };
  })
  .put('/@me/widgets', async ({ headers, cookie, body, set }) => {
    const { user } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    const { mergeWidgetPut } = await import('@/lib/profileBoard');
    const fresh = await User.findById(user.id);
    const widgets = mergeWidgetPut(fresh?.profileWidgets, (body as { widgets: Array<{ id?: string; type: string; applicationId?: string | null; builtin?: string | null }> }).widgets);
    await User.updateById(user.id, { profileWidgets: widgets });
    await invalidateUserCache(user.id).catch(() => {});
    return { widgets };
  }, {
    body: t.Object({
      widgets: t.Array(t.Object({
        id: t.Optional(t.String({ maxLength: 128 })),
        type: t.String({ maxLength: 32 }),
        applicationId: t.Optional(t.Union([t.String({ maxLength: 64 }), t.Null()])),
        builtin: t.Optional(t.Union([t.String({ maxLength: 64 }), t.Null()])),
      }), { maxItems: 40 }),
    }),
  })
  // Reorder the Board. Only moves existing widgets (and turns implicit game
  // sections into placements); never adds or removes one.
  .put('/@me/widgets/order', async ({ headers, cookie, body, set }) => {
    const { user } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    const limited = await checkRateLimit('api', `board-order:${user.id}`).catch(() => ({ success: true }));
    if (!limited.success) { set.status = 429; return { error: 'Rate limited' }; }
    const { reorderPlacements, boardOrder } = await import('@/lib/profileBoard');
    const fresh = await User.findById(user.id);
    const widgets = reorderPlacements(fresh?.profileWidgets, (body as { ids: string[] }).ids);
    await User.updateById(user.id, { profileWidgets: widgets });
    await invalidateUserCache(user.id).catch(() => {});
    return { order: boardOrder(widgets) };
  }, {
    body: t.Object({ ids: t.Array(t.String({ maxLength: 128 }), { maxItems: 60 }) }),
  })
  // Remove (enabled: false) or add back a fixed Board section. A removed
  // section keeps its slot, so adding it back restores its previous position.
  .put('/@me/board-sections', async ({ headers, cookie, body, set }) => {
    const { user } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    const limited = await checkRateLimit('api', `board-sections:${user.id}`).catch(() => ({ success: true }));
    if (!limited.success) { set.status = 429; return { error: 'Rate limited' }; }
    const { setSectionEnabled, removedSections, boardOrder } = await import('@/lib/profileBoard');
    const b = body as { section: 'connections' | 'activity'; enabled: boolean };
    const fresh = await User.findById(user.id);
    const widgets = setSectionEnabled(fresh?.profileWidgets, b.section, b.enabled);
    await User.updateById(user.id, { profileWidgets: widgets });
    await invalidateUserCache(user.id).catch(() => {});
    return { order: boardOrder(widgets), removed: removedSections(widgets) };
  }, {
    body: t.Object({
      section: t.Union([t.Literal('connections'), t.Literal('activity')]),
      enabled: t.Boolean(),
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
  })

  // ── Serika Wishlist widgets ───────────────────────────────────────────────
  // Public wishlists from wish.serika.dev, one Board widget per list. Visitors
  // only get the lists that are on the Board; the owner gets every public list
  // so they can add more. Upstream only ever returns lists marked public.
  .get('/:userId/serika-wishlist', async ({ headers, cookie, params, query, set }) => {
    const { user } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    const targetId = params.userId === '@me' ? user.id : params.userId;
    if (!isValidObjectId(targetId)) { set.status = 400; return { error: 'Invalid user id' }; }
    const target = await User.findById(targetId);
    if (!target) { set.status = 404; return { error: 'User not found' }; }
    const isOwner = target.id === user.id;
    const { findWishlistPlacements, listForPlacement } = await import('@/lib/serikaWishlist');
    const { getSerikaWishlist, resolveLegacyWishlistPlacements } = await import('@/lib/services/serikaWishlist');
    const placements = findWishlistPlacements(await resolveLegacyWishlistPlacements(target.id, target.profileWidgets));
    const placedSlugs = placements.map((p) => p.options.listSlug);
    const compat = { enabled: placements.length > 0, listSlug: placedSlugs.find((s) => !!s) ?? null };
    const empty = { placedSlugs: [] as Array<string | null>, enabled: false, listSlug: null };
    if (!isOwner && placements.length === 0) return empty;
    if (!isOwner && (target.blockedUsers ?? []).includes(user.id)) return empty;

    const refresh = isOwner && (query as Record<string, string | undefined>).refresh === '1';
    const result = await getSerikaWishlist(target.id, { refresh });
    if (result.status === 'error') {
      set.status = 502;
      return { placedSlugs, ...compat, error: 'Serika Wishlist is unavailable right now' };
    }
    if (result.status === 'not_found') {
      return { placedSlugs, ...compat, found: false, profileUrl: null, lists: [] };
    }
    const all = result.profile.lists;
    const lists = isOwner
      ? all
      : placedSlugs
          .map((slug) => listForPlacement(all, slug, placedSlugs))
          .filter((l, i, arr): l is NonNullable<typeof l> => !!l && arr.findIndex((x) => x?.slug === l.slug) === i);
    return { placedSlugs, ...compat, found: true, profileUrl: result.profile.profileUrl, lists };
  })
  // Add (enabled) or remove (!enabled) the widget for one list. listSlug null:
  // add the first public list not on the Board yet / remove every wishlist widget.
  .put('/@me/serika-wishlist', async ({ headers, cookie, body, set }) => {
    const { user } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    const limited = await checkRateLimit('api', `wishlist-widget:${user.id}`).catch(() => ({ success: true }));
    if (!limited.success) { set.status = 429; return { error: 'Rate limited' }; }
    const { WISHLIST_SLUG_RE, addWishlistPlacement, removeWishlistPlacements, findWishlistPlacements, listForPlacement } = await import('@/lib/serikaWishlist');
    const b = body as { enabled: boolean; listSlug?: string | null };
    let listSlug = b.listSlug ?? null;
    if (listSlug !== null && !WISHLIST_SLUG_RE.test(listSlug)) { set.status = 400; return { error: 'Invalid list' }; }
    const { resolveLegacyWishlistPlacements, getSerikaWishlist } = await import('@/lib/services/serikaWishlist');
    const fresh = await User.findById(user.id);
    const current = await resolveLegacyWishlistPlacements(user.id, fresh?.profileWidgets);
    let profileWidgets: Array<Record<string, unknown>>;
    if (b.enabled) {
      if (listSlug === null) {
        const result = await getSerikaWishlist(user.id);
        const placed = findWishlistPlacements(current).map((p) => p.options.listSlug);
        const next = result.status === 'ok' ? listForPlacement(result.profile.lists, null, placed) : null;
        if (!next) { set.status = 409; return { error: 'No public wishlist left to add' }; }
        listSlug = next.slug;
      }
      profileWidgets = addWishlistPlacement(current, listSlug);
    } else {
      profileWidgets = removeWishlistPlacements(current, listSlug);
    }
    await User.updateById(user.id, { profileWidgets });
    await invalidateUserCache(user.id).catch(() => {});
    const placedSlugs = findWishlistPlacements(profileWidgets).map((p) => p.options.listSlug);
    return { placedSlugs, enabled: placedSlugs.length > 0, listSlug: placedSlugs.find((s) => !!s) ?? null };
  }, {
    body: t.Object({
      enabled: t.Boolean(),
      listSlug: t.Optional(t.Union([t.String({ maxLength: 64 }), t.Null()])),
    }),
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
    const settings = { ...(fullUser?.settings as IUserSettings | undefined || {}) };
    settings.dataPrivacy = { allowPersonalization: settings.dataPrivacy?.allowPersonalization ?? true, allowCrashReports: settings.dataPrivacy?.allowCrashReports ?? true, discordBridgeOutbound: false };
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

    // The bot API answers with Discord JSON errors (this handler runs before
    // the bot group's own onError): 50035 + errors tree, 50109, { code, message }.
    if (/^\/api\/v(9|10)(\/|$)/.test(path) && code !== 'NOT_FOUND') {
      if (code === 'VALIDATION') { set.status = 400; return validationErrorBody(error); }
      if (code === 'PARSE') { set.status = 400; return { code: 50109, message: 'The request body contains invalid JSON.' }; }
      set.status = 500;
      return { code: 0, message: '500: Internal Server Error' };
    }

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
  // Public build identity — what's deployed here. See src/lib/version.ts.
  .get('/version', ({ request, set }) => {
    set.headers['cache-control'] = 'no-store';
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
    const info = getVersionInfo(host);
    return { ...info, builtAt: getServerBuildTime() ?? info.builtAt };
  })
  // Channel webhook execute. Old URLs are /api/webhooks/{channel_id}/{token};
  // Discord-style ones are /api/webhooks/{webhook_id}/{token} (same as
  // /api/v10/webhooks/..., see botApi.ts): both resolve here, the token is
  // compared in constant time. Without ?wait the old response shape is kept.
  .post('/webhooks/:channelId/:token', async ({ params, body, query, request, set }) => {
    const { findLegacyWebhook, executeWebhook, runWebhookTokenRoute } = await import('@/lib/services/channelWebhooks');
    const webhook = await findLegacyWebhook(normalizeId(params.channelId), params.token);
    if (!webhook) { set.status = 404; return { code: 10015, message: 'Unknown Webhook', error: 'Webhook not found' }; }
    const { wait, thread_id, with_components } = query as Record<string, string | undefined>;
    const result = await runWebhookTokenRoute(webhook, 'execute', { body, threadId: thread_id }, (b, threadId) =>
      executeWebhook(webhook, b, { wait, thread_id: threadId, with_components }, { ip: getClientIP(request), legacy: true }));
    set.status = result.status;
    if (result.headers) Object.assign(set.headers, result.headers);
    return result.status === 204 ? '' : result.body;
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
    const fileTypes = (settings.allowedFileTypes as IAllowedFileType[] | undefined)?.length
      ? (settings.allowedFileTypes as IAllowedFileType[]).map((f) => f.type)
      : [...config.ALLOWED_FILE_TYPES];
    return { fileTypes };
  })
  .get('/platform/file-types-accept', async () => {
    const { getPlatformSettings } = await import('@/lib/models/PlatformSettings');
    const settings = await getPlatformSettings();
    const mimeTypes: string[] = (settings.allowedFileTypes as IAllowedFileType[] | undefined)?.length
      ? (settings.allowedFileTypes as IAllowedFileType[]).map((f) => f.type)
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
  .post('/tts/fish', async ({ body, set, headers, cookie }) => {
    // Paid upstream API: signed-in users only, known voices only, rate limited.
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    const apiKey = process.env.FISH_API_KEY;
    if (!apiKey) {
      set.status = 503;
      return { error: 'Fish Audio TTS is not configured' };
    }
    const { text, reference_id } = body as {
      text: string;
      reference_id: string;
      speed?: number;
      volume?: number;
    };
    if (!text?.trim() || !reference_id) {
      set.status = 400;
      return { error: 'text and reference_id are required' };
    }
    // Only voices configured by staff (enabled ones; staff may preview disabled ones).
    const { TtsVoice } = await import('@/lib/models/TtsVoice');
    const voices = await TtsVoice.find({});
    const voice = voices.find((v) => v.referenceId === reference_id);
    if (!voice || (voice.enabled === false && !user.isStaff)) {
      set.status = 400;
      return { error: 'Unknown voice' };
    }
    const limit = await checkRateLimit('ttsFish', user.id);
    if (!limit.success) {
      set.status = 429;
      set.headers['Retry-After'] = String(limit.retryAfter ?? 1);
      return { error: 'Too many requests', retryAfter: limit.retryAfter };
    }
    const clamp = (v: unknown, min: number, max: number, fallback: number) =>
      typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
    const speed = clamp((body as { speed?: unknown }).speed, 0.5, 2, 1);
    const volume = clamp((body as { volume?: unknown }).volume, -20, 20, 0);
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
          speed,
          volume,
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
      text: t.String({ minLength: 1, maxLength: 1000 }),
      reference_id: t.String({ minLength: 1, maxLength: 128 }),
      speed: t.Optional(t.Number()),
      volume: t.Optional(t.Number()),
    }),
  })
  .use(authRoutes)
  .use(internalRoutes)
  .use(pushRoutes)
  .use(userRoutes)
  .use(bugReportRoutes)
  .use(notificationsRoutes)
  .use(friendsRoutes)
  .use(searchRoutes)
  .use(serverRoutes)
  .use(inviteRoutes)
  .use(partnerRoutes)
  .use(discordBridgeRoutes)
  .use(serverWebhookRoutes)
  .use(channelRoutes)
  .use(dmRoutes)
  .use(groupDmRoutes)
  .use(messageExtrasRoutes)
  .use(interactionRoutes)
  .use(automodRoutes)
  .use(communityRoutes)
  .use(faviconRoutes)
  .use(trustSafetyRoutes)
  // End-to-end encryption (keys, devices, backups, enabling per DM).
  .use(e2eeRoutes)
  .use(scheduledEventRoutes)
  .use(announcementRoutes)
  .use(voiceRoutes)
  .use(gifRoutes)
  .use(uploadRoutes)
  .use(staffRoutes)
  .use(changelogRoutes)
  .use(adminChangelogRoutes)
  .use(adminRoutes)
  .use(badgeRoutes)
  .use(oembedRoutes)
  .use(experimentRoutes)
  .use(instanceRoutes)
  .use(developerRoutes)
  .use(oauth2Routes)
  .use(appDirectoryRoutes)
  .use(adminAppRoutes)
  .use(igdbRoutes)
  .use(gameLibraryRoutes)
  .use(socialSdkRoutes)
  .use(discordRoutes)
  .use(botApiRoutes)
  .use(mcpRoutes);

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
    // FIRST, before anything can read a message row: messages.tts /
    // messages.pinned_at are named in every Drizzle select on messages
    // (src/lib/db/schema.ts). server.ts awaits initializeAPI() before it starts
    // serving or the gateway, so no message query runs before this. Idempotent,
    // metadata-only, lock_timeout 3s per attempt, skipped when present; throws
    // (boot fails, the old instance keeps serving) when it can't be completed.
    const { ensureBotMessageSchema } = await import('@/lib/services/botMessageSchema');
    await ensureBotMessageSchema();
    // Same for interactions + components: messages.components / webhook_author
    // (also in every message select), app_commands fields,
    // app_command_permissions, channel_webhooks.application_id.
    const { ensureInteractionSchema } = await import('@/lib/services/interactionSchema');
    await ensureInteractionSchema();
    // Per-server profiles: server_members.profile_overrides (named in every
    // member select). Idempotent, skipped when present; throws when it can't
    // be completed.
    const { ensureMemberProfileSchema } = await import('@/lib/services/memberProfileSchema');
    await ensureMemberProfileSchema();
    // Create + seed the staff-editable `badges` table if this database predates
    // it. Idempotent, runs once per process, never throws (falls back to the
    // built-in badge constants on failure).
    const { ensureBadgesTable } = await import('@/lib/services/badgeRegistry');
    await ensureBadgesTable();
    // DM call log messages: 'call' message type + messages.call column.
    // Idempotent, never throws.
    const { ensureCallMessageSchema } = await import('@/lib/services/dmCallMessages');
    await ensureCallMessageSchema();
    // messages.flags (@silent). Idempotent, never throws.
    const { ensureMessageFlagsSchema } = await import('@/lib/services/messageFlagsSchema');
    await ensureMessageFlagsSchema();
    // E2EE: channels.e2ee / messages.e2ee (read by every message query) +
    // key tables. Idempotent, never throws.
    const { ensureE2eeSchema } = await import('@/lib/services/e2ee');
    await ensureE2eeSchema();
    // Group DMs: system message types + channels.icon. Idempotent, never throws.
    const { ensureGroupDmSchema } = await import('@/lib/services/groupDms');
    await ensureGroupDmSchema();
    // Bot API snowflake ids: api_snowflakes + applications.api_id_format (read
    // by every application query). Idempotent, skipped when present; throws
    // when it can't be completed.
    const { ensureApiSnowflakeSchema } = await import('@/lib/botapi/snowflakeStore');
    await ensureApiSnowflakeSchema();
    // App Directory + verification review columns on applications (read by
    // every application query). Idempotent, skipped when present; throws
    // when it can't be completed.
    const { ensureAppDirectorySchema, backfillVerifiedBotUsers } = await import('@/lib/services/appDirectorySchema');
    await ensureAppDirectorySchema();
    // Bot users of verified/official apps get users.is_verified (the BOT tag
    // check). Only ever sets true, bots only; background, never throws.
    void backfillVerifiedBotUsers();
    // OAuth2 grants: oauth2_tokens + authorized_apps.application_id (read by
    // every authorized_apps query). Idempotent, skipped when present; throws
    // when it can't be completed.
    const { ensureOAuth2TokenSchema } = await import('@/lib/services/oauth2Tokens');
    await ensureOAuth2TokenSchema();
    // Thread / forum parity columns: channels.flags + channels.thread_invitable
    // (read by every channel query). Idempotent, skipped when present; throws
    // when it can't be completed.
    const { ensureThreadParitySchema } = await import('@/lib/services/threadParitySchema');
    await ensureThreadParitySchema();
    // Threads in text channels: 'thread_created' message type + thread columns
    // on channels, then the auto-archive sweep. Idempotent, never throws.
    const { ensureThreadSchema, startThreadAutoArchive } = await import('@/lib/services/threads');
    await ensureThreadSchema();
    startThreadAutoArchive();
    // Polls + forwarding: 'poll_result' type, messages.poll / message_snapshot,
    // poll_votes. Idempotent, never throws. Then close expired polls.
    const { ensureMessageExtrasSchema, startPollSweeper } = await import('@/lib/services/messageExtras');
    await ensureMessageExtrasSchema();
    startPollSweeper();
    // Per-user notification settings table. Idempotent, never throws.
    const { ensureNotificationSettingsSchema } = await import('@/lib/services/notificationSettings');
    await ensureNotificationSettingsSchema();
    // Mobile push device tokens table. Idempotent, never throws; not awaited
    // (every push path awaits it itself) so it can never delay startup.
    const { ensurePushSchema } = await import('@/lib/services/pushNotifications');
    void ensurePushSchema();
    // Rules screening + server templates tables. Idempotent, never throws;
    // not awaited (screening reads fall back to "off" until it exists).
    const { ensureCommunitySchema } = await import('@/lib/services/serverCommunity');
    void ensureCommunitySchema();
    const { ensureTrustSafetySchema } = await import('@/lib/services/trustSafety');
    void ensureTrustSafetySchema();
    // Message search blind index table, then (a minute after boot, so it
    // never competes with startup) the gentle leader-locked history backfill.
    // Idempotent, never throws, not awaited.
    {
      const search = await import('@/lib/services/messageSearch');
      const { PROCESS_INSTANCE_ID } = await import('@/lib/realtime/processShared');
      void search.ensureMessageSearchSchema().then((ok) => {
        if (!ok) return;
        const timer = setTimeout(() => search.startSearchBackfill(PROCESS_INSTANCE_ID), 60_000);
        (timer as { unref?: () => void }).unref?.();
      });
    }
    // Scheduled events + announcement follows tables, then the sweeper that
    // starts / completes events on time. Idempotent, never throws, not awaited.
    {
      const events = await import('@/lib/services/scheduledEvents');
      void events.ensureScheduledEventSchema().then((ok) => {
        if (ok) events.startScheduledEventSweeper();
      });
    }
    // Private user notes + DM message requests tables. Idempotent, never
    // throw; not awaited (their readers wait for or skip them).
    const { ensureUserNotesSchema } = await import('@/lib/services/userNotes');
    void ensureUserNotesSchema();
    const { ensureMessageRequestSchema } = await import('@/lib/services/messageRequests');
    void ensureMessageRequestSchema();
    // Server audit log table. Idempotent, never throws; not awaited (every
    // audit read/write awaits it itself).
    const { ensureAuditLogSchema } = await import('@/lib/services/auditLog');
    void ensureAuditLogSchema();
    // AutoMod rules table. Idempotent, never throws; not awaited (rule reads
    // await it themselves).
    const { ensureAutoModSchema } = await import('@/lib/services/automod');
    void ensureAutoModSchema();
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

    // "Clear after" for custom statuses.
    startCustomStatusExpirySweeper();

    console.log('✅ API initialized');
  })();
  // If init fails, clear the promise so a retry is possible.
  initPromise.catch(() => { initPromise = null; });
  return initPromise;
}

export type API = typeof api;

// Export the getAuth helper for other files
export { getAuth };
