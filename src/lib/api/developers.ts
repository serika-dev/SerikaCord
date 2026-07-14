import { Elysia, t } from 'elysia';
import { authenticateRequest } from '@/lib/services/auth';
import { Application, DeveloperTeam, AppWebhook, AppEmoji, User } from '@/lib/models';
import * as crypto from 'crypto';
import { config } from '@/lib/config';
import { storage } from '@/lib/services/storage';
import { checkRateLimit, getClientIP } from '@/lib/security';

const VALID_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

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

function generateToken(prefix: string): string {
  return `${prefix}${crypto.randomBytes(24).toString('hex')}`;
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

function sanitizeApp(app: any) {
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
    botToken: app.botToken,
    clientId: app.clientId,
    clientSecret: app.clientSecret,
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
    gatewayIntents: app.gatewayIntents,
    interactionsEndpointUrl: app.interactionsEndpointUrl ?? null,
    publicKey: app.publicKey ?? null,
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
  return (team.members as any[])?.some((m: any) => m.userId === userId) ?? false;
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
    const sanitized = sanitizeApp(a);
    const botInfo = a.botId ? botAvatarMap.get(a.botId) : null;
    return { ...sanitized, botAvatar: botInfo?.avatar ?? null, botUsername: botInfo?.username ?? null };
  });
  return { applications: enriched };
})

// Create application
.post('/applications', async ({ headers, cookie, body, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  const { name } = body as any;
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
  });

  // Auto-assign active_developer badge
  const { recalculateUserBadges } = await import('@/lib/services/badges');
  void recalculateUserBadges(user.id).catch(() => {});

  return { application: sanitizeApp(app) };
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
    hasAccess = (team?.members as any[])?.some((m: any) => m.userId === user.id) ?? false;
  }
  if (!hasAccess) { set.status = 403; return { error: 'You do not have access to this application' }; }

  // Count emojis and webhooks
  const emojis = await AppEmoji.find({ applicationId: app.id });
  const webhooks = await AppWebhook.find({ applicationId: app.id });
  const emojiCount = emojis.length;
  const webhookCount = webhooks.length;

  const sanitized = sanitizeApp(app);
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
    const member = (team?.members as any[])?.find((m: any) => m.userId === user.id);
    hasAccess = member && (member.role === 'owner' || member.role === 'admin' || member.role === 'developer');
  }
  if (!hasAccess) { set.status = 403; return { error: 'You do not have permission to edit this application' }; }

  const patch = body as any;
  const allowed: string[] = [
    'name', 'description', 'icon', 'coverImage', 'botPublic', 'botRequireCodeGrant',
    'redirectUris', 'scopes', 'installParams', 'customInstallUrl', 'tags',
    'termsOfServiceUrl', 'privacyPolicyUrl', 'rpcOrigins', 'gatewayIntents',
    'interactionsEndpointUrl',
  ];

  const updateData: Record<string, any> = {};
  for (const key of allowed) {
    if (patch[key] !== undefined) {
      updateData[key] = patch[key];
    }
  }

  await Application.updateById(app.id, updateData);
  const updated = await Application.findById(app.id);
  return { application: sanitizeApp(updated) };
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

  // Ensure the bot User + keypair exist so the new token actually authenticates.
  const { ensureBotProvisioned } = await import('@/lib/services/appIdentity');
  const updatedApp = await Application.findById(app.id);
  await ensureBotProvisioned(updatedApp as any);

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
  await ensureBotProvisioned(app as any);

  const updatedApp = await Application.findById(app.id);
  return { application: sanitizeApp(updatedApp) };
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

  const url = (body as any)?.url?.trim() || null;

  if (!url) {
    await Application.updateById(app.id, { interactionsEndpointUrl: null });
    return { interactionsEndpointUrl: null };
  }

  try { new URL(url); } catch { set.status = 400; return { error: 'Invalid URL' }; }

  // Make sure the app has a keypair to sign with.
  const { ensureBotProvisioned } = await import('@/lib/services/appIdentity');
  await ensureBotProvisioned(app as any);

  const { verifyInteractionEndpoint } = await import('@/lib/services/interactions');
  const ok = await verifyInteractionEndpoint({
    interactionsEndpointUrl: url,
    privateKeyPem: app.privateKeyPem,
    clientId: app.clientId,
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

// ─── Application Emojis ────────────────────────────────────

.get('/applications/:id/emojis', async ({ headers, cookie, params, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!params.id) { set.status = 404; return { error: 'Application not found' }; }

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
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!params.id) { set.status = 404; return { error: 'Application not found' }; }

  const app = await Application.findById(params.id);
  if (!app) { set.status = 404; return { error: 'Application not found' }; }

  const { name, image, animated } = body as any;
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
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!params.id) { set.status = 404; return { error: 'Not found' }; }

  const emoji = await AppEmoji.findById(params.emojiId);
  if (emoji && emoji.applicationId === params.id) {
    await AppEmoji.deleteById(emoji.id);
  }
  return { success: true };
})

// ─── Application Webhooks ──────────────────────────────────

.get('/applications/:id/webhooks', async ({ headers, cookie, params, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!params.id) { set.status = 404; return { error: 'Not found' }; }

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
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!params.id) { set.status = 404; return { error: 'Not found' }; }

  const { name, url, events } = body as any;
  if (!name || !url) { set.status = 400; return { error: 'Name and URL are required' }; }

  try { new URL(url); } catch { set.status = 400; return { error: 'Invalid URL' }; }

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
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!params.id) { set.status = 404; return { error: 'Not found' }; }

  const webhook = await AppWebhook.findById(params.webhookId);
  if (!webhook || webhook.applicationId !== params.id) {
    set.status = 404; return { error: 'Webhook not found' };
  }

  const patch = body as any;
  const updateData: Record<string, any> = {};
  if (patch.active !== undefined) updateData.active = patch.active;
  if (patch.events !== undefined) updateData.events = patch.events;
  if (patch.name !== undefined) updateData.name = patch.name;
  if (patch.url !== undefined) updateData.url = patch.url;

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
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!params.id) { set.status = 404; return { error: 'Not found' }; }

  const webhook = await AppWebhook.findById(params.webhookId);
  if (webhook && webhook.applicationId === params.id) {
    await AppWebhook.deleteById(webhook.id);
  }
  return { success: true };
})

// ─── Application Team ──────────────────────────────────────

.get('/applications/:id/team', async ({ headers, cookie, params, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!params.id) { set.status = 404; return { error: 'Not found' }; }

  const app = await Application.findById(params.id);
  if (!app) { set.status = 404; return { error: 'Application not found' }; }

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
  return { members: (team?.members as any[])?.map((m: any) => ({
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

  const { username, role } = body as any;
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
  if ((team?.members as any[])?.some((m: any) => m.userId === invitee.id)) {
    set.status = 400; return { error: 'User is already a member' };
  }

  (team!.members as any[]).push({
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
  const requester = (team.members as any[]).find((m: any) => m.userId === user.id);
  if (!requester || (requester.role !== 'owner' && requester.role !== 'admin')) {
    set.status = 403; return { error: 'You do not have permission to remove members' };
  }

  team.members = (team.members as any[]).filter((m: any) => m.userId !== params.memberId);
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
  for (const app of allApps as any[]) {
    appCountByTeam.set(app.teamId, (appCountByTeam.get(app.teamId) || 0) + 1);
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

  const { name } = body as any;
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

  const isMember = (team.members as any[]).some((m: any) => m.userId === user.id);
  if (!isMember) { set.status = 403; return { error: 'You are not a member of this team' }; }

  return { team: sanitizeTeam(team) };
})

.patch('/teams/:id', async ({ headers, cookie, params, body, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!params.id) { set.status = 404; return { error: 'Team not found' }; }

  const team = await DeveloperTeam.findById(params.id);
  if (!team) { set.status = 404; return { error: 'Team not found' }; }

  const member = (team.members as any[]).find((m: any) => m.userId === user.id);
  if (!member || (member.role !== 'owner' && member.role !== 'admin')) {
    set.status = 403; return { error: 'You do not have permission to edit this team' };
  }

  const { name, description, icon } = body as any;
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

  const requester = (team.members as any[]).find((m: any) => m.userId === user.id);
  if (!requester || (requester.role !== 'owner' && requester.role !== 'admin')) {
    set.status = 403; return { error: 'You do not have permission to invite members' };
  }

  const { username, role } = body as any;
  const invitee = await User.findOne({ username: username?.trim() });
  if (!invitee) { set.status = 404; return { error: 'User not found' }; }

  if ((team.members as any[]).some((m: any) => m.userId === invitee.id)) {
    set.status = 400; return { error: 'User is already a member' };
  }

  (team.members as any[]).push({
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

  const requester = (team.members as any[]).find((m: any) => m.userId === user.id);
  if (!requester || (requester.role !== 'owner' && requester.role !== 'admin')) {
    set.status = 403; return { error: 'You do not have permission to remove members' };
  }

  const target = (team.members as any[]).find((m: any) => m.userId === params.memberId);
  if (target?.role === 'owner') { set.status = 400; return { error: 'Cannot remove the team owner' }; }

  team.members = (team.members as any[]).filter((m: any) => m.userId !== params.memberId);
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

  const patch = body as any;
  const updateData: Record<string, any> = {};
  if (patch.categories !== undefined) updateData.tags = patch.categories;
  if (patch.summary !== undefined) updateData.description = patch.summary;
  await Application.updateById(app.id, updateData);

  return { success: true };
})

// ─── Get Individual App Emoji ──────────────────────────────

.get('/applications/:id/emojis/:emojiId', async ({ headers, cookie, params, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

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
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

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

export const oauth2Routes = new Elysia({ prefix: '/oauth2' })
  .post('/token', async ({ body, set }) => {
    const formData = body as any;

    const grantType = formData.grant_type;
    const clientId = formData.client_id;
    const clientSecret = formData.client_secret;

    const { Application } = await import('@/lib/models');
    const app = await Application.findOne({ clientId });
    if (!app) { set.status = 400; return { error: 'invalid_client' }; }

    if (app.clientSecret !== clientSecret) {
      set.status = 400; return { error: 'invalid_client' };
    }

    if (grantType === 'authorization_code') {
      const accessToken = generateToken('sc_');
      const refreshToken = generateToken('sc_r_');

      return {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: 604800,
        refresh_token: refreshToken,
        scope: (app.scopes || []).join(' '),
      };
    }

    if (grantType === 'refresh_token') {
      const refreshToken = formData.refresh_token;
      if (!refreshToken) { set.status = 400; return { error: 'invalid_request' }; }

      const newAccessToken = generateToken('sc_');
      return {
        access_token: newAccessToken,
        token_type: 'Bearer',
        expires_in: 604800,
        refresh_token: generateToken('sc_r_'),
        scope: (app.scopes || []).join(' '),
      };
    }

    if (grantType === 'client_credentials') {
      const accessToken = generateToken('sc_');
      return {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: 3600,
        scope: (app.scopes || []).join(' '),
      };
    }

    set.status = 400;
    return { error: 'unsupported_grant_type' };
  })

  .get('/authorize', async ({ query, set, headers }) => {
    const accept = headers['accept'] || '';
    if (accept.includes('text/html')) {
      const searchParams = new URLSearchParams();
      for (const [key, val] of Object.entries(query)) {
        if (val !== undefined) searchParams.append(key, String(val));
      }
      return Response.redirect(`/oauth2/authorize?${searchParams.toString()}`, 302);
    }

    const clientId = query.client_id as string;
    const { Application } = await import('@/lib/models');
    let app = await Application.findOne({ clientId });
    if (!app) {
      set.status = 404;
      return { error: 'Unknown application' };
    }

    const scopes = (query.scope as string || '').split(' ').filter(Boolean);
    if (scopes.includes('bot') && (!app.botId || !app.botToken)) {
      const { ensureBotProvisioned } = await import('@/lib/services/appIdentity');
      app = await ensureBotProvisioned(app);
    }

    return {
      application: {
        id: app.id,
        name: app.name,
        icon: app.icon || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(app.name)}`,
        description: app.description,
      },
      scopes,
      redirect_uri: query.redirect_uri as string,
    };
  })

  .post('/token/revoke', async ({ body, set }) => {
    const formData = body as any;
    const token = formData.token;
    if (!token) { set.status = 400; return { error: 'invalid_request' }; }
    return {};
  })

  .post('/authorize', async ({ headers, cookie, query, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const payload = body as any;
    const clientId = payload.client_id || (query.client_id as string);
    const serverId = payload.serverId;
    const permissions = BigInt(payload.permissions || '0');
    const requestedScopes = (payload.scopes as string[]) || (query.scope as string || '').split(' ').filter(Boolean);
    const redirectUri = payload.redirect_uri || (query.redirect_uri as string);
    const state = payload.state || (query.state as string);
    const responseType = payload.response_type || (query.response_type as string) || 'code';

    if (!clientId) {
      set.status = 400;
      return { error: 'Missing client_id' };
    }

    const { Application, User, ServerMember, Server, Role, AuthorizedApp, Channel } = await import('@/lib/models');

    const app = await Application.findOne({ clientId });
    if (!app) {
      set.status = 404;
      return { error: 'Unknown application' };
    }

    const existingAuth = await AuthorizedApp.findOne({ userId: user.id, name: app.name });
    if (existingAuth) {
      const mergedScopes = Array.from(new Set([...(existingAuth.scopes || []), ...requestedScopes]));
      await AuthorizedApp.updateById(existingAuth.id, {
        scopes: mergedScopes,
        lastUsedAt: new Date(),
      });
    } else {
      await AuthorizedApp.create({
        userId: user.id,
        name: app.name,
        description: app.description || '',
        icon: app.icon || '',
        scopes: requestedScopes,
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

      let hasPermission = targetServer.ownerId === user.id;
      if (!hasPermission && userMembership) {
        const serverRoles = await Role.find({ serverId });
        const memberRoles = serverRoles.filter(r => (userMembership.roles || []).includes(r.id) || r.isDefault);
        let userPerms = 0n;
        for (const role of memberRoles) {
          userPerms |= BigInt(role.permissions || '0');
        }
        const PERM_ADMINISTRATOR = 1n << 3n;
        const PERM_MANAGE_SERVER = 1n << 5n;
        if ((userPerms & PERM_ADMINISTRATOR) !== 0n || (userPerms & PERM_MANAGE_SERVER) !== 0n) {
          hasPermission = true;
        }
      }

      if (!hasPermission) {
        set.status = 403;
        return { error: 'You do not have permission to add bots to this server' };
      }

      let botMembership = await ServerMember.findOne({ serverId, userId: botUser.id });
      if (!botMembership) {
        const everyoneRole = await Role.findOne({ serverId, isDefault: true });
        const existingRoles = await Role.find({ serverId });
        const highestPosition = existingRoles.reduce((max, r) => Math.max(max, r.position ?? 0), 0);

        const botRole = await Role.create({
          serverId,
          name: botUser.username,
          position: highestPosition + 1,
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

        await Server.updateById(serverId, {
          memberCount: (targetServer.memberCount ?? 0) + 1,
        });

        const { emitGuildMemberAdd, emitGuildCreate } = await import('@/lib/services/gatewayEvents');

        const memberDto = {
          user: {
            id: botUser.id,
            username: botUser.username,
            avatar: botUser.avatar || null,
            bot: true,
            discriminator: '0',
          },
          nick: null,
          roles: botRolesList,
          joined_at: new Date().toISOString(),
          deaf: false,
          mute: false,
        };

        await emitGuildMemberAdd({ guildId: serverId, member: memberDto });

        const serverChannels = await Channel.find({ serverId });
        const serverRolesUpdated = await Role.find({ serverId });
        
        const mappedRoles = serverRolesUpdated.map(r => ({
          id: r.id,
          name: r.name,
          color: Number(r.color) || 0,
          hoist: Boolean(r.hoist),
          position: r.position ?? 0,
          permissions: r.permissions || '0',
          managed: Boolean(r.managed),
          mentionable: Boolean(r.mentionable),
        }));

        const typeMap: Record<string, number> = {
          text: 0,
          dm: 1,
          voice: 2,
          group_dm: 3,
          category: 4,
          announcement: 5,
          forum: 15,
        };

        const mappedChannels = serverChannels.map(c => ({
          id: c.id,
          type: typeMap[c.type] ?? 0,
          name: c.name,
          position: c.position ?? 0,
          parent_id: c.parentId ?? null,
          topic: c.topic ?? null,
          nsfw: Boolean(c.nsfw),
          rate_limit_per_user: c.rateLimitPerUser ?? 0,
        }));

        const allServerMembers = await ServerMember.find({ serverId });
        const allUserIds = allServerMembers.map(m => m.userId);
        const allUsers = await User.find({ id: { in: allUserIds } });
        const userMap = new Map(allUsers.map(u => [u.id, u]));

        const mappedMembers = allServerMembers.map(m => {
          const u = userMap.get(m.userId) || { id: m.userId, username: 'Unknown', isBot: false, avatar: null };
          return {
            user: {
              id: u.id,
              username: u.username,
              avatar: u.avatar || null,
              bot: Boolean(u.isBot),
              discriminator: '0',
            },
            nick: m.nickname || null,
            roles: m.roles || [],
            joined_at: m.joinedAt ? new Date(m.joinedAt).toISOString() : new Date().toISOString(),
            deaf: Boolean(m.deaf),
            mute: Boolean(m.mute),
          };
        });

        const guildCreatePayload = {
          id: targetServer.id,
          name: targetServer.name,
          icon: targetServer.icon ?? null,
          owner_id: targetServer.ownerId,
          roles: mappedRoles,
          channels: mappedChannels,
          members: mappedMembers,
          member_count: mappedMembers.length,
          joined_at: new Date().toISOString(),
          large: false,
          unavailable: false,
        };

        await emitGuildCreate({
          guildId: serverId,
          targetBotId: botUser.id,
          guild: guildCreatePayload,
        });

        botAdded = true;
      }
    }

    if (redirectUri) {
      let callbackUrl = redirectUri;
      if (responseType === 'token') {
        const accessToken = generateToken('sc_');
        callbackUrl += `#access_token=${accessToken}&token_type=Bearer&expires_in=604800&scope=${encodeURIComponent(requestedScopes.join(' '))}`;
        if (state) callbackUrl += `&state=${encodeURIComponent(state)}`;
      } else {
        const code = generateToken('sc_code_');
        callbackUrl += callbackUrl.includes('?') ? '&' : '?';
        callbackUrl += `code=${code}`;
        if (state) callbackUrl += `&state=${encodeURIComponent(state)}`;
      }
      return { redirect: callbackUrl };
    }

    return { success: true, botAdded };
  });
