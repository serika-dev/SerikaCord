import { Elysia, t } from 'elysia';
import { authenticateRequest } from '@/lib/services/auth';
import { Application, DeveloperTeam, AppWebhook, AppEmoji, User, WidgetConfig, type ITeamMember, type IApplication } from '@/lib/models';
import * as crypto from 'crypto';
import { config } from '@/lib/config';
import { storage } from '@/lib/services/storage';
import { checkRateLimit, getClientIP } from '@/lib/security';
import { adjustServerMemberCount } from '@/lib/services/serverMembership';
import { resolveRedirectUri, appendQuery, parsePermissionsParam, clampBotPermissions } from '@/lib/oauth/authorize';
import { allowedPrivilegedIntents, INTENT, toStoredIntents } from '@/lib/gateway/intents';

const VALID_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

// All supported OAuth2 scopes
export const VALID_OAUTH_SCOPES: ReadonlySet<string> = new Set([
  'identify',
  'email',
  'connections',
  'guilds',
  'guilds.join',
  'guilds.members.read',
  'messages.read',
  'rpc',
  'rpc.notifications.read',
  'rpc.voice.read',
  'rpc.video.write',
  'rpc.screenshare.write',
  'bot',
  'applications.commands',
  'applications.commands.update',
  'applications.commands.permissions.update',
  'applications.entitlements',
  'applications.store.update',
  'webhook.incoming',
  'voice',
  'activity.read',
  'activity.write',
  'dm_channels.read',
  'dm_channels.write',
  'relationships.read',
  'profile.read',
  'profile.write',
  'analytics.read',
]);

// Scopes that require another scope to also be present
const SCOPE_DEPENDENCIES: Record<string, string[]> = {
  'email': ['identify'],
  'guilds.join': ['guilds'],
  'guilds.members.read': ['guilds'],
  'rpc.notifications.read': ['rpc'],
  'rpc.voice.read': ['rpc'],
  'rpc.video.write': ['rpc'],
  'rpc.screenshare.write': ['rpc'],
  'applications.commands.update': ['applications.commands'],
  'applications.commands.permissions.update': ['applications.commands'],
  'profile.write': ['profile.read'],
};

// ─── Helpers ───────────────────────────────────────────────

async function getAuth(headers: Record<string, string | undefined>, cookie: Record<string, { value?: unknown }>) {
  const authHeader = headers.authorization ?? null;
  const authToken = cookie.auth_token?.value;
  const cookies: Record<string, string> = {};
  if (typeof authToken === 'string') {
    cookies.auth_token = authToken;
  }
  return authenticateRequest(authHeader, cookies);
}

/**
 * Resolve the authed user and verify they own (or team-share) an application.
 * Returns `{ error }` (already status-stamped) on failure, or `{ app, user }`.
 */
async function requireAppAccess(
  headers: Record<string, string | undefined>,
  cookie: Record<string, { value?: unknown }>,
  appId: string,
  set: { status?: number | string },
): Promise<{ app: any; user: any } | { error: { error: string } }> {
  const { user, error: authError } = await getAuth(headers, cookie);
  if (!user) { set.status = 401; return { error: { error: authError || 'Unauthorized' } }; }
  if (!appId) { set.status = 404; return { error: { error: 'Application not found' } }; }
  const app = await Application.findById(appId);
  if (!app) { set.status = 404; return { error: { error: 'Application not found' } }; }
  let hasAccess = app.ownerId === user.id;
  if (!hasAccess && app.teamId) {
    const team = await DeveloperTeam.findById(app.teamId);
    hasAccess = (team?.members as ITeamMember[] | undefined)?.some((m) => m.userId === user.id) ?? false;
  }
  if (!hasAccess) { set.status = 403; return { error: { error: 'You do not have access to this application' } }; }
  return { app, user };
}

/** Outbound webhook URLs must be plain http(s): no javascript:, file:, data: and so on. */
function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

function generateClientId(): string {
  return String(Date.now() * 2048 + Math.floor(Math.random() * 2048));
}

function generateClientSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

function generateBotToken(appId: string): string {
  return `${appId}.${crypto.randomBytes(24).toString('hex')}`;
}

/** Which credentials a viewer of an application may see. */
interface AppSecretsAccess { clientSecret: boolean; botToken: boolean }
const NO_SECRETS: AppSecretsAccess = { clientSecret: false, botToken: false };
const ALL_SECRETS: AppSecretsAccess = { clientSecret: true, botToken: true };

/**
 * Credentials `userId` may see on `app`: the owner sees both; team owner /
 * admin / developer roles see the bot token (they manage the bot, like
 * Discord); everyone else (read-only and free-form roles) sees neither. The
 * client secret mints client_credentials tokens, so only the owner sees it.
 */
async function appSecretsFor(app: { ownerId: string; teamId?: string | null }, userId: string): Promise<AppSecretsAccess> {
  if (app.ownerId === userId) return ALL_SECRETS;
  if (!app.teamId) return NO_SECRETS;
  const team = await DeveloperTeam.findById(app.teamId);
  const member = (team?.members as ITeamMember[] | undefined)?.find((m) => m.userId === userId);
  const manages = !!member && (member.role === 'owner' || member.role === 'admin' || member.role === 'developer');
  return { clientSecret: false, botToken: manages };
}

function sanitizeApp(app: any, secrets: AppSecretsAccess = NO_SECRETS) {
  if (!app) return null;
  return {
    id: app.id,
    name: app.name,
    description: app.description,
    icon: app.icon,
    coverImage: app.coverImage,
    botId: app.botId ?? null,
    botPublic: app.botPublic,
    botRequireCodeGrant: app.botRequireCodeGrant,
    botToken: secrets.botToken ? app.botToken : undefined,
    clientId: app.clientId,
    clientSecret: secrets.clientSecret ? app.clientSecret : undefined,
    redirectUris: app.redirectUris,
    scopes: app.scopes,
    installParams: app.installParams,
    customInstallUrl: app.customInstallUrl,
    verified: app.verified,
    verificationStatus: app.verificationStatus,
    serverCount: app.serverCount,
    tags: app.tags,
    teamId: app.teamId ?? null,
    termsOfServiceUrl: app.termsOfServiceUrl,
    privacyPolicyUrl: app.privacyPolicyUrl,
    flags: app.flags,
    // Effective privileged intents (grandfathered apps show them enabled); the
    // internal "configured" marker never leaves the server.
    gatewayIntents: allowedPrivilegedIntents(app),
    interactionsEndpointUrl: app.interactionsEndpointUrl ?? null,
    publicKey: app.publicKey ?? null,
    // Id format the bot API shows this app ('snowflake' or 'uuid', see src/lib/botapi/boundary.ts).
    apiIdFormat: app.apiIdFormat === 'snowflake' ? 'snowflake' : 'uuid',
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
  };
}

function sanitizeTeam(team: any) {
  if (!team) return null;
  return {
    id: team.id,
    name: team.name,
    icon: team.icon,
    ownerUsername: team.members?.find((m: any) => m.role === 'owner')?.username ?? '',
    memberCount: team.members?.length ?? 0,
    appCount: 0,
    verified: team.verified,
    description: team.description,
    members: team.members?.map((m: any) => ({
      id: m.userId,
      username: m.username,
      avatar: m.avatar,
      role: m.role,
    })) ?? [],
    createdAt: team.createdAt,
  };
}

async function isTeamMember(teamId: string, userId: string): Promise<boolean> {
  const team = await DeveloperTeam.findById(teamId);
  if (!team) return false;
  return (team.members as ITeamMember[] | undefined)?.some((m) => m.userId === userId) ?? false;
}

// ─── Developer Routes ──────────────────────────────────────

export const developerRoutes = new Elysia({ prefix: '/developers' })

// ─── Applications ──────────────────────────────────────────

// List applications
.get('/applications', async ({ headers, cookie, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  const apps = await Application.find({ ownerId: user.id });
  apps.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Batch-fetch bot avatars for apps that have a bot user
  const botIds = apps.map((a: any) => a.botId).filter(Boolean) as string[];
  const botUsers = botIds.length > 0 ? await User.find({ id: { in: botIds }, isBot: true }) : [];
  const botAvatarMap = new Map(botUsers.map((u: any) => [u.id, { avatar: u.avatar, username: u.username }]));

  const enriched = apps.map((a: any) => {
    const sanitized = sanitizeApp(a, ALL_SECRETS); // Application.find({ ownerId: user.id })
    const botInfo = a.botId ? botAvatarMap.get(a.botId) : null;
    return { ...sanitized, botAvatar: botInfo?.avatar ?? null, botUsername: botInfo?.username ?? null };
  });
  return { applications: enriched };
})

// Create application
.post('/applications', async ({ headers, cookie, body, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  const { name } = body as { name?: string };
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    set.status = 400; return { error: 'Name is required' };
  }
  if (name.length > 32) { set.status = 400; return { error: 'Name must be 32 characters or less' }; }

  const clientId = generateClientId();
  const clientSecret = generateClientSecret();

  const app = await Application.create({
    ownerId: user.id,
    name: name.trim(),
    description: '',
    clientId,
    clientSecret,
    botPublic: true,
    botRequireCodeGrant: false,
    redirectUris: [],
    scopes: ['identify'],
    installParams: { scopes: ['bot', 'applications.commands'], permissions: '0' },
    verified: false,
    verificationStatus: 'none',
    serverCount: 0,
    tags: [],
    flags: 0,
    // New apps get Discord-style numeric ids so discord.js / discord.py work as is.
    apiIdFormat: 'snowflake',
  });

  // Auto-assign active_developer badge
  const { recalculateUserBadges } = await import('@/lib/services/badges');
  void recalculateUserBadges(user.id).catch(() => {});

  return { application: sanitizeApp(app, ALL_SECRETS) }; // just created by this owner
})

// Get application by ID
.get('/applications/:id', async ({ headers, cookie, params, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!params.id) { set.status = 404; return { error: 'Application not found' }; }

  const app = await Application.findById(params.id);
  if (!app) { set.status = 404; return { error: 'Application not found' }; }

  // Check ownership or team membership
  const isOwner = app.ownerId === user.id;
  let hasAccess = isOwner;
  if (!hasAccess && app.teamId) {
    const team = await DeveloperTeam.findById(app.teamId);
    hasAccess = (team?.members as ITeamMember[] | undefined)?.some((m) => m.userId === user.id) ?? false;
  }
  if (!hasAccess) { set.status = 403; return { error: 'You do not have access to this application' }; }

  // Count emojis and webhooks
  const emojis = await AppEmoji.find({ applicationId: app.id });
  const webhooks = await AppWebhook.find({ applicationId: app.id });
  const emojiCount = emojis.length;
  const webhookCount = webhooks.length;

  const sanitized = sanitizeApp(app, await appSecretsFor(app, user.id));
  let botAvatar: string | null = null;
  let botUsername: string | null = null;
  if (app.botId) {
    const botUser = await User.findById(app.botId);
    botAvatar = botUser?.avatar ?? null;
    botUsername = botUser?.username ?? null;
  }
  return { application: { ...sanitized, emojiCount, webhookCount, botAvatar, botUsername } };
})

// Update application
.patch('/applications/:id', async ({ headers, cookie, params, body, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!params.id) { set.status = 404; return { error: 'Application not found' }; }

  const app = await Application.findById(params.id);
  if (!app) { set.status = 404; return { error: 'Application not found' }; }

  const isOwner = app.ownerId === user.id;
  let hasAccess = isOwner;
  if (!hasAccess && app.teamId) {
    const team = await DeveloperTeam.findById(app.teamId);
    const member = (team?.members as ITeamMember[] | undefined)?.find((m) => m.userId === user.id);
    hasAccess = Boolean(member && (member.role === 'owner' || member.role === 'admin' || member.role === 'developer'));
  }
  if (!hasAccess) { set.status = 403; return { error: 'You do not have permission to edit this application' }; }

  const patch = body as Record<string, unknown>;
  const allowed: string[] = [
    'name', 'description', 'icon', 'coverImage', 'botPublic', 'botRequireCodeGrant',
    'redirectUris', 'scopes', 'installParams', 'customInstallUrl', 'tags',
    'termsOfServiceUrl', 'privacyPolicyUrl', 'rpcOrigins', 'gatewayIntents',
    'apiIdFormat',
    // interactionsEndpointUrl is set only through POST .../bot/interactions-endpoint (verified PING).
  ];

  const updateData: Record<string, unknown> = {};
  for (const key of allowed) {
    if (patch[key] !== undefined) {
      updateData[key] = patch[key];
    }
  }
  if (updateData.gatewayIntents !== undefined) {
    // Only privileged bits are stored, plus the marker that ends grandfathering
    // (src/lib/gateway/intents.ts).
    const stored = toStoredIntents(updateData.gatewayIntents);
    if (stored === null) { set.status = 400; return { error: 'gatewayIntents must be a non-negative integer' }; }
    updateData.gatewayIntents = stored;
  }
  if (updateData.apiIdFormat !== undefined) {
    // 'snowflake' = Discord-style numeric ids; 'uuid' (stored as NULL) = legacy ids.
    if (updateData.apiIdFormat !== 'snowflake' && updateData.apiIdFormat !== 'uuid') {
      set.status = 400; return { error: "apiIdFormat must be 'snowflake' or 'uuid'" };
    }
    updateData.apiIdFormat = updateData.apiIdFormat === 'snowflake' ? 'snowflake' : null;
  }

  await Application.updateById(app.id, updateData);
  if (updateData.apiIdFormat !== undefined) {
    // The bot API reads the format from the cached token lookup: drop it.
    const { invalidateBotTokenCache } = await import('@/lib/services/botTokens');
    invalidateBotTokenCache();
  }
  const updated = await Application.findById(app.id);
  return { application: sanitizeApp(updated, await appSecretsFor(app, user.id)) };
})

// Delete application
.delete('/applications/:id', async ({ headers, cookie, params, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!params.id) { set.status = 404; return { error: 'Application not found' }; }

  const app = await Application.findById(params.id);
  if (!app) { set.status = 404; return { error: 'Application not found' }; }

  if (app.ownerId !== user.id) {
    set.status = 403; return { error: 'Only the owner can delete this application' };
  }

  // Clean up related data
  const emojis = await AppEmoji.find({ applicationId: app.id });
  const webhooks = await AppWebhook.find({ applicationId: app.id });
  await Promise.all([
    ...emojis.map(e => AppEmoji.deleteById(e.id)),
    ...webhooks.map(w => AppWebhook.deleteById(w.id)),
  ]);

  await Application.deleteById(app.id);
  void import('@/lib/services/botTokens').then((m) => m.invalidateBotTokenCache()).catch(() => {});

  // Recalculate active_developer / verified_bot_developer badges
  const { recalculateUserBadges } = await import('@/lib/services/badges');
  void recalculateUserBadges(user.id).catch(() => {});

  return { success: true };
})

// Reset bot token
.post('/applications/:id/bot/reset-token', async ({ headers, cookie, params, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!params.id) { set.status = 404; return { error: 'Application not found' }; }

  const app = await Application.findById(params.id);
  if (!app) { set.status = 404; return { error: 'Application not found' }; }

  const isOwner = app.ownerId === user.id;
  if (!isOwner) { set.status = 403; return { error: 'Only the owner can reset the bot token' }; }

  const newToken = generateBotToken(app.clientId);
  await Application.updateById(app.id, { botToken: newToken });
  // The old token must stop authenticating (and stop skipping the IP rate limit) now.
  void import('@/lib/services/botTokens').then((m) => m.invalidateBotTokenCache()).catch(() => {});

  // Ensure the bot User + keypair exist so the new token actually authenticates.
  const { ensureBotProvisioned } = await import('@/lib/services/appIdentity');
  const updatedApp = await Application.findById(app.id);
  await ensureBotProvisioned(updatedApp);

  return { token: newToken };
})

// Create/enable bot for application
.post('/applications/:id/bot', async ({ headers, cookie, params, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!params.id) { set.status = 404; return { error: 'Application not found' }; }

  const app = await Application.findById(params.id);
  if (!app) { set.status = 404; return { error: 'Application not found' }; }

  if (app.ownerId !== user.id) {
    set.status = 403; return { error: 'Only the owner can enable the bot' };
  }

  // Provision the backing bot User, token, and Ed25519 keypair. Without the bot
  // User, gateway/REST authentication would fail (botId would stay null).
  const { ensureBotProvisioned } = await import('@/lib/services/appIdentity');
  await ensureBotProvisioned(app);

  const updatedApp = await Application.findById(app.id);
  return { application: sanitizeApp(updatedApp, ALL_SECRETS) }; // owner only (checked above)
})

// Set / verify the interactions endpoint URL. Discord-style: we send a signed
// PING and only save the URL if the endpoint acknowledges with { type: 1 }.
.post('/applications/:id/bot/interactions-endpoint', async ({ headers, cookie, params, body, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!params.id) { set.status = 404; return { error: 'Application not found' }; }
  const app = await Application.findById(params.id);
  if (!app) { set.status = 404; return { error: 'Application not found' }; }
  if (app.ownerId !== user.id) {
    set.status = 403; return { error: 'Only the owner can change the interactions endpoint' };
  }

  const url = ((body as Record<string, unknown>)?.url as string | undefined)?.trim() || null;

  if (!url) {
    await Application.updateById(app.id, { interactionsEndpointUrl: null });
    return { interactionsEndpointUrl: null };
  }

  // Each save sends a signed PING: limit per user.
  const { checkRateLimit } = await import('@/lib/security');
  if (!(await checkRateLimit('interactionsEndpointVerify', user.id)).success) { set.status = 429; return { error: 'Too many attempts. Try again later.' }; }
  const { isAcceptableEndpointUrl, verifyInteractionsEndpointSafely } = await import('@/lib/botapi/endpointVerify');
  if (!isAcceptableEndpointUrl(url)) { set.status = 400; return { error: 'The interactions endpoint must be an https URL' }; }

  // Make sure the app has a keypair to sign with.
  const { ensureBotProvisioned } = await import('@/lib/services/appIdentity');
  const provisioned = await ensureBotProvisioned(app);

  // Public addresses only (checked on the request itself), no redirects, capped reply.
  const ok = await verifyInteractionsEndpointSafely({
    url,
    privateKeyPem: provisioned.privateKeyPem,
    clientId: provisioned.clientId,
  });
  if (!ok) {
    set.status = 400;
    return { error: 'The interactions endpoint did not respond to our PING with a valid PONG.' };
  }

  await Application.updateById(app.id, { interactionsEndpointUrl: url });
  return { interactionsEndpointUrl: url };
}, {
  body: t.Object({ url: t.Optional(t.Union([t.String(), t.Null()])) }),
})

// Reset client secret
.post('/applications/:id/oauth2/reset-secret', async ({ headers, cookie, params, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!params.id) { set.status = 404; return { error: 'Application not found' }; }

  const app = await Application.findById(params.id);
  if (!app) { set.status = 404; return { error: 'Application not found' }; }

  if (app.ownerId !== user.id) {
    set.status = 403; return { error: 'Only the owner can reset the client secret' };
  }

  const newSecret = generateClientSecret();
  await Application.updateById(app.id, { clientSecret: newSecret });

  return { clientSecret: newSecret };
})

// Apply for bot verification (bot must be in 100+ servers). Moves the app to
// 'pending' so staff can review it; repeat applications are no-ops.
.post('/applications/:id/verification', async ({ headers, cookie, params, set }) => {
  const access = await requireAppAccess(headers, cookie as Record<string, { value?: unknown }>, params.id, set);
  if ('error' in access) return access.error;
  const { app, user } = access;
  if (app.ownerId !== user.id) {
    set.status = 403; return { error: 'Only the owner can apply for verification' };
  }
  if (app.verified || app.verificationStatus === 'approved') {
    set.status = 400; return { error: 'Application is already verified' };
  }
  if (app.verificationStatus === 'pending') {
    return { verificationStatus: 'pending' };
  }
  const { ServerMember } = await import('@/lib/models');
  const serverCount = app.botId ? (await ServerMember.find({ userId: app.botId })).length : 0;
  if (serverCount < 100) {
    set.status = 400; return { error: 'Your bot must be in at least 100 servers to apply' };
  }
  await Application.updateById(app.id, { verificationStatus: 'pending' });
  return { verificationStatus: 'pending' };
})

// ─── Application Emojis ────────────────────────────────────

.get('/applications/:id/emojis', async ({ headers, cookie, params, set }) => {
  const access = await requireAppAccess(headers, cookie as Record<string, { value?: unknown }>, params.id, set);
  if ('error' in access) return access.error;

  const emojis = await AppEmoji.find({ applicationId: params.id });
  emojis.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return { emojis: emojis.map((e: any) => ({
    id: e.id,
    name: e.name,
    image: e.image,
    animated: e.animated,
    createdAt: e.createdAt,
  })) };
})

.post('/applications/:id/emojis', async ({ headers, cookie, params, body, set }) => {
  const access = await requireAppAccess(headers, cookie as Record<string, { value?: unknown }>, params.id, set);
  if ('error' in access) return access.error;

  const { name, image, animated } = body as { name?: string; image?: string; animated?: boolean };
  if (!name || !image) { set.status = 400; return { error: 'Name and image are required' }; }

  const emoji = await AppEmoji.create({
    applicationId: params.id,
    name: name.trim(),
    image,
    animated: animated ?? false,
  });

  return { emoji: {
    id: emoji.id,
    name: emoji.name,
    image: emoji.image,
    animated: emoji.animated,
  }};
})

.delete('/applications/:id/emojis/:emojiId', async ({ headers, cookie, params, set }) => {
  const access = await requireAppAccess(headers, cookie as Record<string, { value?: unknown }>, params.id, set);
  if ('error' in access) return access.error;

  const emoji = await AppEmoji.findById(params.emojiId);
  if (emoji && emoji.applicationId === params.id) {
    await AppEmoji.deleteById(emoji.id);
  }
  return { success: true };
})

// ─── Application Webhooks ──────────────────────────────────

.get('/applications/:id/webhooks', async ({ headers, cookie, params, set }) => {
  const access = await requireAppAccess(headers, cookie as Record<string, { value?: unknown }>, params.id, set);
  if ('error' in access) return access.error;

  const webhooks = await AppWebhook.find({ applicationId: params.id });
  webhooks.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return { webhooks: webhooks.map((w: any) => ({
    id: w.id,
    name: w.name,
    url: w.url,
    events: w.events,
    active: w.active,
    createdAt: w.createdAt,
  })) };
})

.post('/applications/:id/webhooks', async ({ headers, cookie, params, body, set }) => {
  const access = await requireAppAccess(headers, cookie as Record<string, { value?: unknown }>, params.id, set);
  if ('error' in access) return access.error;

  const { name, url, events } = body as { name?: string; url?: string; events?: string[] };
  if (!name || !url) { set.status = 400; return { error: 'Name and URL are required' }; }

  if (!isHttpUrl(url)) { set.status = 400; return { error: 'Invalid URL' }; }

  const webhook = await AppWebhook.create({
    applicationId: params.id,
    name: name.trim(),
    url,
    events: events ?? [],
    active: true,
  });

  return { webhook: {
    id: webhook.id,
    name: webhook.name,
    url: webhook.url,
    events: webhook.events,
    active: webhook.active,
  }};
})

.patch('/applications/:id/webhooks/:webhookId', async ({ headers, cookie, params, body, set }) => {
  const access = await requireAppAccess(headers, cookie as Record<string, { value?: unknown }>, params.id, set);
  if ('error' in access) return access.error;

  const webhook = await AppWebhook.findById(params.webhookId);
  if (!webhook || webhook.applicationId !== params.id) {
    set.status = 404; return { error: 'Webhook not found' };
  }

  const patch = body as Record<string, unknown>;
  const updateData: Record<string, any> = {};
  if (patch.active !== undefined) updateData.active = patch.active;
  if (patch.events !== undefined) updateData.events = patch.events;
  if (patch.name !== undefined) updateData.name = patch.name;
  if (patch.url !== undefined) {
    if (typeof patch.url !== 'string' || !isHttpUrl(patch.url)) { set.status = 400; return { error: 'Invalid URL' }; }
    updateData.url = patch.url;
  }

  await AppWebhook.updateById(webhook.id, updateData);
  const updated = await AppWebhook.findById(webhook.id);
  return {
    id: updated!.id,
    name: updated!.name,
    url: updated!.url,
    events: updated!.events,
    active: updated!.active,
  };
})

.delete('/applications/:id/webhooks/:webhookId', async ({ headers, cookie, params, set }) => {
  const access = await requireAppAccess(headers, cookie as Record<string, { value?: unknown }>, params.id, set);
  if ('error' in access) return access.error;

  const webhook = await AppWebhook.findById(params.webhookId);
  if (webhook && webhook.applicationId === params.id) {
    await AppWebhook.deleteById(webhook.id);
  }
  return { success: true };
})

// ─── Application Team ──────────────────────────────────────

.get('/applications/:id/team', async ({ headers, cookie, params, set }) => {
  const access = await requireAppAccess(headers, cookie as Record<string, { value?: unknown }>, params.id, set);
  if ('error' in access) return access.error;
  const { app } = access;

  if (!app.teamId) {
    // Solo owner — return just the owner
    const owner = await User.findById(app.ownerId);
    return { members: [{
      id: owner!.id,
      username: owner!.username,
      avatar: owner!.avatar,
      role: 'owner' as const,
    }]};
  }

  const team = await DeveloperTeam.findById(app.teamId);
  return { members: (team?.members as ITeamMember[] | undefined)?.map((m) => ({
    id: m.userId,
    username: m.username,
    avatar: m.avatar,
    role: m.role,
  })) ?? [] };
})

.post('/applications/:id/team/invite', async ({ headers, cookie, params, body, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!params.id) { set.status = 404; return { error: 'Not found' }; }

  const app = await Application.findById(params.id);
  if (!app) { set.status = 404; return { error: 'Application not found' }; }

  if (app.ownerId !== user.id) {
    set.status = 403; return { error: 'Only the owner can invite members' };
  }

  const { username, role } = body as { username?: string; role?: string };
  const invitee = await User.findOne({ username: username?.trim() });
  if (!invitee) { set.status = 404; return { error: 'User not found' }; }

  // For solo apps, create a team first
  if (!app.teamId) {
    const team = await DeveloperTeam.create({
      name: `${app.name} Team`,
      ownerId: app.ownerId,
      members: [
        { userId: app.ownerId, username: user.username, avatar: user.avatar, role: 'owner' },
        { userId: invitee.id, username: invitee.username, avatar: invitee.avatar, role: role ?? 'developer' },
      ],
    });
    await Application.updateById(app.id, { teamId: team.id });
    return { member: {
      id: invitee.id,
      username: invitee.username,
      avatar: invitee.avatar,
      role: role ?? 'developer',
    }};
  }

  const team = await DeveloperTeam.findById(app.teamId);
  if ((team?.members as ITeamMember[] | undefined)?.some((m) => m.userId === invitee.id)) {
    set.status = 400; return { error: 'User is already a member' };
  }

  (team!.members as ITeamMember[]).push({
    userId: invitee.id,
    username: invitee.username,
    avatar: invitee.avatar,
    role: role ?? 'developer',
  });
  await DeveloperTeam.updateById(team!.id, { members: team!.members });

  return { member: {
    id: invitee.id,
    username: invitee.username,
    avatar: invitee.avatar,
    role: role ?? 'developer',
  }};
})

.delete('/applications/:id/team/:memberId', async ({ headers, cookie, params, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!params.id) { set.status = 404; return { error: 'Not found' }; }

  const app = await Application.findById(params.id);
  if (!app) { set.status = 404; return { error: 'Application not found' }; }

  if (!app.teamId) { set.status = 400; return { error: 'No team for this application' }; }

  const team = await DeveloperTeam.findById(app.teamId);
  if (!team) { set.status = 404; return { error: 'Team not found' }; }

  // Only owner or admin can remove
  const requester = (team.members as ITeamMember[]).find((m) => m.userId === user.id);
  if (!requester || (requester.role !== 'owner' && requester.role !== 'admin')) {
    set.status = 403; return { error: 'You do not have permission to remove members' };
  }

  team.members = (team.members as ITeamMember[]).filter((m) => m.userId !== params.memberId);
  await DeveloperTeam.updateById(team.id, { members: team.members });
  return { success: true };
})

// ─── Teams ─────────────────────────────────────────────────

.get('/teams', async ({ headers, cookie, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  const allTeams = await DeveloperTeam.find({});
  const teams = allTeams
    .filter((t: any) => t.members?.some((m: any) => m.userId === user.id))
    .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Get app counts per team — batch fetch all apps for all teams in one query
  const teamIds = teams.map((t: any) => t.id);
  const allApps = teamIds.length > 0 ? await Application.find({ teamId: { in: teamIds } }) : [];
  const appCountByTeam = new Map<string, number>();
  for (const app of allApps as IApplication[]) {
    const teamId = app.teamId || '';
    appCountByTeam.set(teamId, (appCountByTeam.get(teamId) || 0) + 1);
  }
  const teamsWithCounts = teams.map((team: any) => ({
    ...sanitizeTeam(team),
    appCount: appCountByTeam.get(team.id) || 0,
  }));

  return { teams: teamsWithCounts };
})

.post('/teams', async ({ headers, cookie, body, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  const { name } = body as { name?: string };
  if (!name || name.trim().length === 0) { set.status = 400; return { error: 'Team name is required' }; }

  const team = await DeveloperTeam.create({
    name: name.trim(),
    ownerId: user.id,
    members: [{
      userId: user.id,
      username: user.username,
      avatar: user.avatar,
      role: 'owner',
    }],
  });

  return { team: sanitizeTeam(team) };
})

.get('/teams/:id', async ({ headers, cookie, params, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!params.id) { set.status = 404; return { error: 'Team not found' }; }

  const team = await DeveloperTeam.findById(params.id);
  if (!team) { set.status = 404; return { error: 'Team not found' }; }

  const isMember = (team.members as ITeamMember[]).some((m) => m.userId === user.id);
  if (!isMember) { set.status = 403; return { error: 'You are not a member of this team' }; }

  return { team: sanitizeTeam(team) };
})

.patch('/teams/:id', async ({ headers, cookie, params, body, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!params.id) { set.status = 404; return { error: 'Team not found' }; }

  const team = await DeveloperTeam.findById(params.id);
  if (!team) { set.status = 404; return { error: 'Team not found' }; }

  const member = (team.members as ITeamMember[]).find((m) => m.userId === user.id);
  if (!member || (member.role !== 'owner' && member.role !== 'admin')) {
    set.status = 403; return { error: 'You do not have permission to edit this team' };
  }

  const { name, description, icon } = body as { name?: string; description?: string; icon?: string };
  const updateData: Record<string, any> = {};
  if (name !== undefined) updateData.name = name.trim();
  if (description !== undefined) updateData.description = description;
  if (icon !== undefined) updateData.icon = icon;

  await DeveloperTeam.updateById(team.id, updateData);
  const updated = await DeveloperTeam.findById(team.id);
  return { team: sanitizeTeam(updated) };
})

.delete('/teams/:id', async ({ headers, cookie, params, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!params.id) { set.status = 404; return { error: 'Team not found' }; }

  const team = await DeveloperTeam.findById(params.id);
  if (!team) { set.status = 404; return { error: 'Team not found' }; }

  if (team.ownerId !== user.id) {
    set.status = 403; return { error: 'Only the team owner can delete it' };
  }

  // Unlink applications from this team
  const apps = await Application.find({ teamId: team.id });
  await Promise.all(apps.map(a => Application.updateById(a.id, { teamId: null })));
  await DeveloperTeam.deleteById(team.id);
  return { success: true };
})

// Invite member to team
.post('/teams/:id/members', async ({ headers, cookie, params, body, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!params.id) { set.status = 404; return { error: 'Team not found' }; }

  const team = await DeveloperTeam.findById(params.id);
  if (!team) { set.status = 404; return { error: 'Team not found' }; }

  const requester = (team.members as ITeamMember[]).find((m) => m.userId === user.id);
  if (!requester || (requester.role !== 'owner' && requester.role !== 'admin')) {
    set.status = 403; return { error: 'You do not have permission to invite members' };
  }

  const { username, role } = body as { username?: string; role?: string };
  const invitee = await User.findOne({ username: username?.trim() });
  if (!invitee) { set.status = 404; return { error: 'User not found' }; }

  if ((team.members as ITeamMember[]).some((m) => m.userId === invitee.id)) {
    set.status = 400; return { error: 'User is already a member' };
  }

  (team.members as ITeamMember[]).push({
    userId: invitee.id,
    username: invitee.username,
    avatar: invitee.avatar,
    role: role ?? 'developer',
  });
  await DeveloperTeam.updateById(team.id, { members: team.members });

  return { member: {
    id: invitee.id,
    username: invitee.username,
    avatar: invitee.avatar,
    role: role ?? 'developer',
  }};
})

// Remove member from team
.delete('/teams/:id/members/:memberId', async ({ headers, cookie, params, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!params.id) { set.status = 404; return { error: 'Team not found' }; }

  const team = await DeveloperTeam.findById(params.id);
  if (!team) { set.status = 404; return { error: 'Team not found' }; }

  const requester = (team.members as ITeamMember[]).find((m) => m.userId === user.id);
  if (!requester || (requester.role !== 'owner' && requester.role !== 'admin')) {
    set.status = 403; return { error: 'You do not have permission to remove members' };
  }

  const target = (team.members as ITeamMember[]).find((m) => m.userId === params.memberId);
  if (target?.role === 'owner') { set.status = 400; return { error: 'Cannot remove the team owner' }; }

  team.members = (team.members as ITeamMember[]).filter((m) => m.userId !== params.memberId);
  await DeveloperTeam.updateById(team.id, { members: team.members });
  return { success: true };
})



// ─── Gateway URL ───────────────────────────────────────────

.get('/gateway', () => ({
  url: config.GATEWAY_URL,
}))

.get('/gateway/bot', async ({ headers, set }) => {
  const authHeader = headers.authorization;
  if (!authHeader?.startsWith('Bot ')) { set.status = 401; return { error: 'Unauthorized' }; }

  const token = authHeader.slice(4);
  const app = await Application.findOne({ botToken: token });
  if (!app) { set.status = 401; return { error: 'Invalid token' }; }

  return {
    url: config.GATEWAY_URL,
    shards: 1,
    session_start_limit: {
      total: 1000,
      remaining: 1000,
      reset_after: 86400000,
      max_concurrency: 1,
    },
  };
})



// ─── Application Analytics ─────────────────────────────────

.get('/applications/:id/analytics', async ({ headers, cookie, params, query, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!params.id) { set.status = 404; return { error: 'Application not found' }; }
  const app = await Application.findById(params.id);
  if (!app) { set.status = 404; return { error: 'Application not found' }; }
  if (app.ownerId !== user.id && !(app.teamId && await isTeamMember(app.teamId, user.id))) {
    set.status = 403; return { error: 'Forbidden' };
  }

  const days = parseInt(query.days as string) || 30;
  const since = new Date(Date.now() - days * 86400000);

  // Get server count where bot is a member
  const { ServerMember } = await import('@/lib/models');
  const botUser = app.botId ? await User.findById(app.botId) : null;
  const botMemberships = botUser ? await ServerMember.find({ userId: botUser.id }) : [];
  const serverCount = botMemberships.length;

  return {
    server_count: serverCount,
    active_users: 0,
    commands_used_today: 0,
    commands_used_30d: 0,
    interactions_today: 0,
    interactions_30d: 0,
    since: since.toISOString(),
  };
})

// ─── Application Directory ─────────────────────────────────

.get('/applications/:id/directory', async ({ headers, cookie, params, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!params.id) { set.status = 404; return { error: 'Application not found' }; }
  const app = await Application.findById(params.id);
  if (!app) { set.status = 404; return { error: 'Application not found' }; }
  if (app.ownerId !== user.id && !(app.teamId && await isTeamMember(app.teamId, user.id))) {
    set.status = 403; return { error: 'Forbidden' };
  }

  return {
    listed: app.verified ?? false,
    categories: app.tags ?? [],
    summary: app.description ?? '',
    description: app.description ?? '',
    icon: app.icon ?? null,
    screenshots: [],
    website: null,
    support_url: null,
    privacy_policy_url: null,
    terms_of_service_url: null,
  };
})

.patch('/applications/:id/directory', async ({ headers, cookie, params, body, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!params.id) { set.status = 404; return { error: 'Application not found' }; }
  const app = await Application.findById(params.id);
  if (!app) { set.status = 404; return { error: 'Application not found' }; }
  if (app.ownerId !== user.id) {
    set.status = 403; return { error: 'Forbidden' };
  }

  const patch = body as Record<string, unknown>;
  const updateData: Record<string, any> = {};
  if (patch.categories !== undefined) updateData.tags = patch.categories;
  if (patch.summary !== undefined) updateData.description = patch.summary;
  await Application.updateById(app.id, updateData);

  return { success: true };
})

// ─── Get Individual App Emoji ──────────────────────────────

.get('/applications/:id/emojis/:emojiId', async ({ headers, cookie, params, set }) => {
  const access = await requireAppAccess(headers, cookie as Record<string, { value?: unknown }>, params.id, set);
  if ('error' in access) return access.error;

  if (!params.emojiId) { set.status = 404; return { error: 'Emoji not found' }; }
  const emoji = await AppEmoji.findById(params.emojiId);
  if (!emoji || emoji.applicationId !== params.id) {
    set.status = 404; return { error: 'Emoji not found' };
  }
  return {
    id: emoji.id,
    name: emoji.name,
    image: emoji.image,
    animated: emoji.animated ?? false,
  };
})

// ─── Get Individual App Webhook ────────────────────────────

.get('/applications/:id/webhooks/:webhookId', async ({ headers, cookie, params, set }) => {
  const access = await requireAppAccess(headers, cookie as Record<string, { value?: unknown }>, params.id, set);
  if ('error' in access) return access.error;

  if (!params.webhookId) { set.status = 404; return { error: 'Webhook not found' }; }
  const webhook = await AppWebhook.findById(params.webhookId);
  if (!webhook || webhook.applicationId !== params.id) {
    set.status = 404; return { error: 'Webhook not found' };
  }
  return {
    id: webhook.id,
    name: webhook.name,
    url: webhook.url,
    events: webhook.events,
    active: webhook.active,
  };
})

// ─── Application Bot Info ──────────────────────────────────

.get('/applications/:id/bot', async ({ headers, cookie, params, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!params.id) { set.status = 404; return { error: 'Application not found' }; }
  const app = await Application.findById(params.id);
  if (!app) { set.status = 404; return { error: 'Application not found' }; }
  if (app.ownerId !== user.id && !(app.teamId && await isTeamMember(app.teamId, user.id))) {
    set.status = 403; return { error: 'Forbidden' };
  }

  if (!app.botId) { return { bot: null }; }

  const botUser = await User.findById(app.botId);
  if (!botUser) { return { bot: null }; }

  return {
    bot: {
      id: botUser.id,
      username: botUser.username,
      displayName: botUser.displayName ?? botUser.username,
      avatar: botUser.avatar,
      banner: botUser.banner ?? null,
      public: app.botPublic ?? false,
      require_code_grant: app.botRequireCodeGrant ?? false,
      token: app.botToken ?? null,
    },
  };
})

// Update the bot user's profile (username / display name).
.patch('/applications/:id/bot', async ({ headers, cookie, params, body, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  const app = await Application.findById(params.id);
  if (!app) { set.status = 404; return { error: 'Application not found' }; }
  if (app.ownerId !== user.id) { set.status = 403; return { error: 'Only the owner can edit the bot profile' }; }
  if (!app.botId) { set.status = 400; return { error: 'Enable the bot before editing its profile' }; }

  const { username, displayName } = (body as { username?: string; displayName?: string });
  const updates: Record<string, unknown> = {};

  if (username !== undefined) {
    const normalized = username.trim().toLowerCase();
    if (!/^[a-z0-9_.]{2,32}$/.test(normalized)) {
      set.status = 400;
      return { error: 'Username must be 2-32 characters using letters, numbers, underscores or periods.' };
    }
    const existing = await User.findOne({ username: normalized });
    if (existing && existing.id !== app.botId) {
      set.status = 409;
      return { error: 'That username is already taken.' };
    }
    updates.username = normalized;
  }

  if (displayName !== undefined) {
    const trimmed = displayName.trim();
    if (trimmed.length > 32) {
      set.status = 400;
      return { error: 'Display name must be 32 characters or fewer.' };
    }
    updates.displayName = trimmed || null;
  }

  if (Object.keys(updates).length === 0) {
    set.status = 400;
    return { error: 'Nothing to update.' };
  }

  const updated = await User.updateById(app.botId, updates);
  if (!updated) { set.status = 404; return { error: 'Bot user not found' }; }
  return {
    bot: {
      id: updated.id,
      username: updated.username,
      displayName: updated.displayName ?? updated.username,
      avatar: updated.avatar,
      banner: updated.banner ?? null,
    },
  };
}, {
  body: t.Object({
    username: t.Optional(t.String({ maxLength: 32 })),
    displayName: t.Optional(t.String({ maxLength: 64 })),
  }),
})

// Upload the bot's avatar or banner image.
.post('/applications/:id/bot/:kind', async ({ headers, cookie, params, body, request, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  const kind = params.kind;
  if (kind !== 'avatar' && kind !== 'banner') { set.status = 404; return { error: 'Not found' }; }

  const app = await Application.findById(params.id);
  if (!app) { set.status = 404; return { error: 'Application not found' }; }
  if (app.ownerId !== user.id) { set.status = 403; return { error: 'Only the owner can edit the bot profile' }; }
  if (!app.botId) { set.status = 400; return { error: 'Enable the bot before editing its profile' }; }

  const botUser = await User.findById(app.botId);
  if (!botUser) { set.status = 404; return { error: 'Bot user not found' }; }

  const ip = getClientIP(request);
  const rateLimit = await checkRateLimit('upload', `${user.id}:${ip}`);
  if (!rateLimit.success) { set.status = 429; return { error: 'Upload rate limited', retryAfter: rateLimit.retryAfter }; }

  const { file } = body as { file?: File };
  if (!file) { set.status = 400; return { error: 'No file provided' }; }
  if (!VALID_IMAGE_TYPES.has(file.type)) {
    set.status = 400;
    return { error: 'Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.' };
  }
  const maxSize = kind === 'banner'
    ? (file.type === 'image/gif' ? 50 * 1024 * 1024 : config.MAX_BANNER_SIZE)
    : config.MAX_AVATAR_SIZE;
  if (file.size > maxSize) {
    set.status = 400;
    return { error: `File too large. Maximum size is ${maxSize / 1024 / 1024}MB.` };
  }

  try {
    const current = kind === 'banner' ? botUser.banner : botUser.avatar;
    if (current && current.includes(config.B2_BUCKET_NAME)) {
      try { await storage.deleteByUrl(current); } catch { /* best-effort cleanup */ }
    }
    const result = await storage.uploadFromFormData(file, kind === 'banner' ? 'banners' : 'avatars', {
      userId: botUser.id,
      // The developer uploading is accountable, not the bot.
      scanUserId: user.id,
    });
    await User.updateById(botUser.id, kind === 'banner' ? { banner: result.url } : { avatar: result.url });
    return { success: true, url: result.url };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : `Failed to upload ${kind}`;
    console.error(`Bot ${kind} upload error:`, error);
    set.status = 500;
    return { error: message };
  }
}, {
  body: t.Object({ file: t.File() }),
})

// Upload application icon.
.post('/applications/:id/icon', async ({ headers, cookie, params, body, request, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  const app = await Application.findById(params.id);
  if (!app) { set.status = 404; return { error: 'Application not found' }; }
  if (app.ownerId !== user.id) { set.status = 403; return { error: 'Only the owner can edit the application' }; }

  const ip = getClientIP(request);
  const rateLimit = await checkRateLimit('upload', `${user.id}:${ip}`);
  if (!rateLimit.success) { set.status = 429; return { error: 'Upload rate limited', retryAfter: rateLimit.retryAfter }; }

  const { file } = body as { file?: File };
  if (!file) { set.status = 400; return { error: 'No file provided' }; }
  if (!VALID_IMAGE_TYPES.has(file.type)) {
    set.status = 400;
    return { error: 'Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.' };
  }
  if (file.size > config.MAX_AVATAR_SIZE) {
    set.status = 400;
    return { error: `File too large. Maximum size is ${config.MAX_AVATAR_SIZE / 1024 / 1024}MB.` };
  }

  try {
    if (app.icon && app.icon.includes(config.B2_BUCKET_NAME)) {
      try { await storage.deleteByUrl(app.icon); } catch { /* best-effort cleanup */ }
    }
    const result = await storage.uploadFromFormData(file, 'app-icons', { userId: user.id });
    await Application.updateById(app.id, { icon: result.url });
    return { success: true, url: result.url };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to upload icon';
    console.error('App icon upload error:', error);
    set.status = 500;
    return { error: message };
  }
}, {
  body: t.Object({ file: t.File() }),
})

  // ─── Widget config (Social SDK widget editor backend) ──────────────────────
  .get('/applications/:id/widget', async ({ headers, cookie, params, set }) => {
    const access = await requireAppAccess(headers, cookie as Record<string, { value?: unknown }>, params.id, set);
    if ('error' in access) return access.error;
    const config = await WidgetConfig.findByApplication(params.id);
    return { widget: config ?? null };
  })
  .put('/applications/:id/widget', async ({ headers, cookie, params, body, set }) => {
    const access = await requireAppAccess(headers, cookie as Record<string, { value?: unknown }>, params.id, set);
    if ('error' in access) return access.error;
    const b = body as { name?: string; surfaces?: unknown; sampleData?: unknown };
    const saved = await WidgetConfig.upsert(params.id, {
      ...(b.name !== undefined ? { name: b.name } : {}),
      ...(b.surfaces !== undefined ? { surfaces: b.surfaces as object } : {}),
      ...(b.sampleData !== undefined ? { sampleData: b.sampleData as object } : {}),
    });
    return { widget: saved };
  }, {
    body: t.Object({
      name: t.Optional(t.String({ minLength: 1, maxLength: 128 })),
      surfaces: t.Optional(t.Any()),
      sampleData: t.Optional(t.Any()),
    }),
  })
  .post('/applications/:id/widget/publish', async ({ headers, cookie, params, set }) => {
    const access = await requireAppAccess(headers, cookie as Record<string, { value?: unknown }>, params.id, set);
    if ('error' in access) return access.error;
    const config = await WidgetConfig.findByApplication(params.id);
    if (!config) { set.status = 404; return { error: 'No widget to publish' }; }
    const saved = await WidgetConfig.updateByApplication(params.id, {
      status: 'published', publishedAt: new Date(), version: (config.version ?? 1) + 1,
    });
    return { widget: saved };
  })
  .post('/applications/:id/widget/unpublish', async ({ headers, cookie, params, set }) => {
    const access = await requireAppAccess(headers, cookie as Record<string, { value?: unknown }>, params.id, set);
    if ('error' in access) return access.error;
    const saved = await WidgetConfig.updateByApplication(params.id, { status: 'draft' });
    return { widget: saved };
  })
  .delete('/applications/:id/widget', async ({ headers, cookie, params, set }) => {
    const access = await requireAppAccess(headers, cookie as Record<string, { value?: unknown }>, params.id, set);
    if ('error' in access) return access.error;
    await WidgetConfig.deleteByApplication(params.id);
    return { success: true };
  })
  // ─── 1:1 list alias (List Application Widget Configs) ──────────────────────
  .get('/applications/:id/widget-configs', async ({ headers, cookie, params, set }) => {
    const access = await requireAppAccess(headers, cookie as Record<string, { value?: unknown }>, params.id, set);
    if ('error' in access) return access.error;
    const config = await WidgetConfig.findByApplication(params.id);
    return { configs: config ? [{
      application_id: config.applicationId,
      config_id: config.id,
      display_name: config.name,
      surfaces: config.surfaces,
      resolved_assets: config.resolvedAssets ?? [],
      status: config.status,
      published_at: config.publishedAt ?? null,
      updated_at: config.updatedAt ?? null,
    }] : [] };
  });

/**
 * GET /oauth2/authorize for API callers (JSON: the app, scopes and validated
 * redirect URI for the consent page); browsers are sent to the consent page.
 * Shared by /api/oauth2/authorize and its /api/v10 alias.
 */
export async function oauthAuthorizeInfo(
  query: Record<string, unknown>,
  headers: Record<string, string | undefined>,
  set: { status?: number | string },
) {
  const accept = headers['accept'] || '';
  if (accept.includes('text/html')) {
    const searchParams = new URLSearchParams();
    for (const [key, val] of Object.entries(query)) {
      if (val !== undefined) searchParams.append(key, String(val));
    }
    return new Response(null, { status: 302, headers: { Location: `/oauth2/authorize?${searchParams.toString()}` } });
  }

  const clientId = typeof query.client_id === 'string' ? query.client_id : '';
  const { Application } = await import('@/lib/models');
  const app = clientId ? await Application.findOne({ clientId }) : null;
  if (!app) {
    set.status = 404;
    return { error: 'Unknown application' };
  }

  // Only ever hand back a redirect URI the app registered (and that uses a
  // safe scheme), so the consent page can never be turned into an open
  // redirect or a javascript: URL.
  const redirect = resolveRedirectUri(query.redirect_uri as string | undefined, app.redirectUris);
  if (!redirect.ok) {
    set.status = 400;
    return { error: 'invalid_redirect_uri', message: 'redirect_uri is not registered for this application' };
  }

  // Read-only: the bot user is provisioned by the authenticated POST that
  // actually installs it, never by this unauthenticated lookup.
  const scopes = (typeof query.scope === 'string' ? query.scope : '').split(' ').filter(Boolean);

  return {
    application: {
      id: app.id,
      name: app.name,
      icon: app.icon || null,
      description: app.description,
    },
    scopes,
    redirect_uri: redirect.uri,
  };
}

// Token and revoke endpoints: real grants backed by src/lib/services/oauth2Tokens.ts
// (one-time codes, hashed tokens, refresh rotation, client_credentials for
// the app owner). Clients authenticate with client_id/client_secret in the
// body or HTTP Basic, like Discord.
export async function oauthTokenEndpoint(body: unknown, headers: Record<string, string | undefined>, set: { status?: number | string }, ip: string) {
  const limited = await checkRateLimit('oauthToken', ip);
  if (!limited.success) { set.status = 429; return { error: 'rate_limited', retry_after: limited.retryAfter ?? 1 }; }
  const { handleTokenRequest } = await import('@/lib/services/oauth2Tokens');
  const r = await handleTokenRequest(body, headers.authorization, VALID_OAUTH_SCOPES);
  set.status = r.status;
  return r.body;
}

export async function oauthRevokeEndpoint(body: unknown, headers: Record<string, string | undefined>, set: { status?: number | string }, ip: string) {
  const limited = await checkRateLimit('oauthToken', ip);
  if (!limited.success) { set.status = 429; return { error: 'rate_limited', retry_after: limited.retryAfter ?? 1 }; }
  const { handleRevokeRequest } = await import('@/lib/services/oauth2Tokens');
  const r = await handleRevokeRequest(body, headers.authorization);
  set.status = r.status;
  return r.body;
}

export const oauth2Routes = new Elysia({ prefix: '/oauth2' })
  .post('/token', async ({ body, headers, set, request }) => oauthTokenEndpoint(body, headers, set, getClientIP(request)))

  .get('/authorize', async ({ query, set, headers }) => oauthAuthorizeInfo(query as Record<string, unknown>, headers, set))

  .post('/token/revoke', async ({ body, headers, set, request }) => oauthRevokeEndpoint(body, headers, set, getClientIP(request)))

  .post('/authorize', async ({ headers, cookie, query, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    // Each approval issues a code or token: bounded per user.
    const authorizeLimit = await checkRateLimit('oauthAuthorize', user.id);
    if (!authorizeLimit.success) { set.status = 429; return { error: 'Too many requests', retryAfter: authorizeLimit.retryAfter }; }

    const payload = body as { client_id?: string; serverId?: string; permissions?: string; scopes?: string[]; redirect_uri?: string; state?: string; response_type?: string; code_challenge?: string; code_challenge_method?: string };
    const clientId = payload.client_id || (query.client_id as string);
    const serverId = payload.serverId;
    const requestedPermissions = parsePermissionsParam(payload.permissions);
    if (requestedPermissions === null) {
      set.status = 400;
      return { error: 'invalid_permissions' };
    }
    const requestedScopes = payload.scopes || (query.scope as string || '').split(' ').filter(Boolean);
    const requestedRedirectUri = payload.redirect_uri || (query.redirect_uri as string);
    const state = payload.state || (query.state as string);
    const responseType = payload.response_type || (query.response_type as string) || 'code';
    // PKCE (S256 only); never silently ignored.
    const { parsePkceChallenge, userGrantScopes } = await import('@/lib/oauth/scopes');
    const pkce = parsePkceChallenge(payload.code_challenge ?? query.code_challenge, payload.code_challenge_method ?? query.code_challenge_method);
    if (!pkce.ok) { set.status = 400; return { error: 'invalid_request', message: pkce.error }; }
    if (pkce.challenge && responseType === 'token') { set.status = 400; return { error: 'invalid_request', message: 'PKCE applies to response_type=code only' }; }

    if (!clientId) {
      set.status = 400;
      return { error: 'Missing client_id' };
    }

    // Validate scopes
    for (const scope of requestedScopes) {
      if (!VALID_OAUTH_SCOPES.has(scope)) {
        set.status = 400;
        return { error: 'invalid_scope', message: `Unknown scope: ${scope}` };
      }
    }
    // What a user-consented token may carry (applications.commands.update is
    // client_credentials-only; bot / webhook.incoming act at install time).
    const userScopes = userGrantScopes(requestedScopes);
    if (!userScopes.ok) { set.status = 400; return { error: 'invalid_scope', message: `Scope '${userScopes.scope}' is only available with the client_credentials grant` }; }
    // Check scope dependencies
    for (const scope of requestedScopes) {
      const deps = SCOPE_DEPENDENCIES[scope];
      if (deps) {
        for (const dep of deps) {
          if (!requestedScopes.includes(dep)) {
            set.status = 400;
            return { error: 'invalid_scope', message: `Scope '${scope}' requires '${dep}'` };
          }
        }
      }
    }

    const { Application, User, ServerMember, Server, Role, AuthorizedApp } = await import('@/lib/models');

    const app = await Application.findOne({ clientId });
    if (!app) {
      set.status = 404;
      return { error: 'Unknown application' };
    }

    const redirect = resolveRedirectUri(requestedRedirectUri, app.redirectUris);
    if (!redirect.ok) {
      set.status = 400;
      return { error: 'invalid_redirect_uri', message: 'redirect_uri is not registered for this application' };
    }
    const redirectUri = redirect.uri;

    // Rows carry the app id; legacy rows (no id yet) are matched by name once.
    const byName = await AuthorizedApp.findOne({ userId: user.id, name: app.name });
    const existingAuth = (await AuthorizedApp.findOne({ userId: user.id, applicationId: app.id }))
      ?? (byName && !byName.applicationId ? byName : null);
    if (existingAuth) {
      const mergedScopes = Array.from(new Set([...(existingAuth.scopes || []), ...requestedScopes]));
      await AuthorizedApp.updateById(existingAuth.id, {
        scopes: mergedScopes,
        applicationId: existingAuth.applicationId ?? app.id,
        lastUsedAt: new Date(),
      });
    } else {
      await AuthorizedApp.create({
        userId: user.id,
        name: app.name,
        description: app.description || '',
        icon: app.icon || '',
        scopes: requestedScopes,
        applicationId: app.id,
        lastUsedAt: new Date(),
      });
    }

    let botAdded = false;

    if (requestedScopes.includes('bot')) {
      if (!serverId) {
        set.status = 400;
        return { error: 'bot scope requires serverId' };
      }

      let currentApp = app;
      if (!currentApp.botId || !currentApp.botToken) {
        const { ensureBotProvisioned } = await import('@/lib/services/appIdentity');
        currentApp = await ensureBotProvisioned(app);
      }

      const botUser = currentApp.botId ? await User.findById(currentApp.botId) : null;
      if (!botUser) {
        set.status = 400;
        return { error: 'Application bot user not found' };
      }

      const targetServer = await Server.findById(serverId);
      if (!targetServer) {
        set.status = 404;
        return { error: 'Target server not found' };
      }

      const userMembership = await ServerMember.findOne({ serverId, userId: user.id });
      if (!userMembership && targetServer.ownerId !== user.id) {
        set.status = 403;
        return { error: 'You must be a member of the server' };
      }

      const isServerOwner = targetServer.ownerId === user.id;
      const serverRoles = await Role.find({ serverId });
      const callerRoleIds = new Set(userMembership?.roles || []);
      const memberRoles = serverRoles.filter(r => callerRoleIds.has(r.id) || r.isDefault);
      let userPerms = 0n;
      for (const role of memberRoles) {
        try { userPerms |= BigInt(role.permissions || '0'); } catch { /* malformed role bits */ }
      }
      const PERM_ADMINISTRATOR = 1n << 3n;
      const PERM_MANAGE_SERVER = 1n << 5n;
      const callerIsAdmin = (userPerms & PERM_ADMINISTRATOR) !== 0n;
      const hasPermission = isServerOwner || (!!userMembership && (callerIsAdmin || (userPerms & PERM_MANAGE_SERVER) !== 0n));

      if (!hasPermission) {
        set.status = 403;
        return { error: 'You do not have permission to add bots to this server' };
      }

      let botMembership = await ServerMember.findOne({ serverId, userId: botUser.id });
      if (!botMembership) {
        const everyoneRole = await Role.findOne({ serverId, isDefault: true });
        const highestPosition = serverRoles.reduce((max, r) => Math.max(max, r.position ?? 0), 0);

        // A member can only hand the bot permissions they hold themselves, and
        // the bot's role goes just below their own top role (owner/admins:
        // top of the list, as before).
        const permissions = clampBotPermissions(requestedPermissions, userPerms, isServerOwner);
        let botPosition = highestPosition + 1;
        if (!isServerOwner && !callerIsAdmin) {
          const callerTop = serverRoles
            .filter(r => callerRoleIds.has(r.id) && !r.isDefault)
            .reduce((max, r) => Math.max(max, r.position ?? 0), 0);
          botPosition = Math.max(1, callerTop);
          // Shift the caller's top role and everything above it up by one.
          for (const r of serverRoles) {
            if (!r.isDefault && (r.position ?? 0) >= botPosition) {
              await Role.updateById(r.id, { position: (r.position ?? 0) + 1 });
            }
          }
        }

        const botRole = await Role.create({
          serverId,
          name: botUser.username,
          position: botPosition,
          permissions: String(permissions),
          managed: true,
          hoist: false,
          mentionable: false,
          color: 3447003,
        });

        const botRolesList = [everyoneRole.id, botRole.id];
        botMembership = await ServerMember.create({
          serverId,
          userId: botUser.id,
          roles: botRolesList,
          joinedAt: new Date(),
        });

        await adjustServerMemberCount(serverId, 1);

        // The new bot must show up in this server's gateway audiences right away.
        void import('@/lib/services/gatewayAudience').then((m) => m.invalidateServerAudience(serverId)).catch(() => {});
        const { emitGuildCreate } = await import('@/lib/services/gatewayEvents');
        const guildEvents = await import('@/lib/services/guildGatewayEvents');

        // The bot's managed role, its GUILD_MEMBER_ADD (the full member, which
        // also adds the guild to the bot's session) and GUILD_INTEGRATIONS_UPDATE.
        await guildEvents.emitRoleCreate(serverId, botRole.id);
        await guildEvents.emitMemberAdd(serverId, botUser.id);
        void guildEvents.emitGuildIntegrationsUpdate(serverId);

        // The same full GUILD_CREATE a bot gets after READY. Like Discord, the
        // member list only goes to apps with the privileged GUILD_MEMBERS
        // intent; everyone else gets just the bot.
        const { buildGuildCreate } = await import('@/lib/gateway/guildPayload');
        const guildCreatePayload = await buildGuildCreate(serverId, {
          botId: botUser.id,
          intents: allowedPrivilegedIntents(app) & INTENT.GUILD_MEMBERS,
          largeThreshold: 250,
        });
        if (guildCreatePayload) {
          await emitGuildCreate({
            guildId: serverId,
            targetBotId: botUser.id,
            guild: guildCreatePayload,
          });
        }

        botAdded = true;
      }
    }

    if (redirectUri) {
      // Real grants (src/lib/services/oauth2Tokens.ts): the code is one-time,
      // bound to this app, user, scope set and redirect URI; the implicit
      // token is stored hashed and works as a Bearer token on /api/v10.
      const { issueAuthorizationCode, mintToken } = await import('@/lib/services/oauth2Tokens');
      const grantScopes = userScopes.scopes;
      let callbackUrl = redirectUri;
      try {
        if (responseType === 'token') {
          const issued = await mintToken({ applicationId: app.id, userId: user.id, scopes: grantScopes, grantType: 'implicit', withRefresh: false });
          const frag = new URLSearchParams({ access_token: issued.access_token, token_type: 'Bearer', expires_in: String(issued.expires_in), scope: issued.scope });
          if (state) frag.set('state', state);
          callbackUrl = `${redirectUri.split('#')[0]}#${frag.toString()}`;
        } else {
          const code = await issueAuthorizationCode({ applicationId: app.id, userId: user.id, scopes: grantScopes, redirectUri: requestedRedirectUri ? redirectUri : null, codeChallenge: pkce.challenge });
          const params: Record<string, string> = { code };
          if (state) params.state = state;
          callbackUrl = appendQuery(redirectUri, params);
        }
      } catch (err) {
        console.error('[oauth2] grant failed:', (err as Error)?.message ?? err);
        set.status = 503;
        return { error: 'temporarily_unavailable' };
      }
      return { redirect: callbackUrl };
    }

    return { success: true, botAdded };
  })

  // ─── App Discovery (public bot listing) ────────────────────
  .get('/discoverable-apps', async ({ query, set }) => {
    const { db, schema } = await import('@/lib/db/postgres');
    const { eq, and, ilike, or, sql } = await import('drizzle-orm');
    const conditions = [eq(schema.applications.botPublic, true)];
    if (query.search) {
      conditions.push(ilike(schema.applications.name, `%${query.search}%`));
    }
    const rows = await db.select({
      id: schema.applications.id,
      name: schema.applications.name,
      description: schema.applications.description,
      icon: schema.applications.icon,
      botId: schema.applications.botId,
      tags: schema.applications.tags,
      ownerId: schema.applications.ownerId,
    })
      .from(schema.applications)
      .where(and(...conditions))
      .limit(50);

    return { apps: rows };
  });
