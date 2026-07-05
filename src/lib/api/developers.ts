import { Elysia, t } from 'elysia';
import { authenticateRequest } from '@/lib/services/auth';
import { Application, DeveloperTeam, AppWebhook, AppEmoji, User } from '@/lib/models';
import { Types } from 'mongoose';
import * as crypto from 'crypto';
import { config } from '@/lib/config';

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
    id: app._id.toString(),
    name: app.name,
    description: app.description,
    icon: app.icon,
    coverImage: app.coverImage,
    botId: app.botId?.toString() ?? null,
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
    teamId: app.teamId?.toString() ?? null,
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
    id: team._id.toString(),
    name: team.name,
    icon: team.icon,
    ownerUsername: team.members?.find((m: any) => m.role === 'owner')?.username ?? '',
    memberCount: team.members?.length ?? 0,
    appCount: 0,
    verified: team.verified,
    description: team.description,
    members: team.members?.map((m: any) => ({
      id: m.userId.toString(),
      username: m.username,
      avatar: m.avatar,
      role: m.role,
    })) ?? [],
    createdAt: team.createdAt,
  };
}

async function isTeamMember(teamId: Types.ObjectId, userId: Types.ObjectId): Promise<boolean> {
  const team = await DeveloperTeam.findById(teamId).lean();
  if (!team) return false;
  return team.members?.some((m: any) => m.userId.toString() === userId.toString()) ?? false;
}

// ─── Developer Routes ──────────────────────────────────────

export const developerRoutes = new Elysia({ prefix: '/developers' })

// ─── Applications ──────────────────────────────────────────

// List applications
.get('/applications', async ({ headers, cookie, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  const apps = await Application.find({ ownerId: user._id }).sort({ createdAt: -1 }).lean();
  return { applications: apps.map(sanitizeApp) };
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
    ownerId: user._id,
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

  return { application: sanitizeApp(app) };
})

// Get application by ID
.get('/applications/:id', async ({ headers, cookie, params, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.id)) { set.status = 404; return { error: 'Application not found' }; }

  const app = await Application.findById(params.id).lean();
  if (!app) { set.status = 404; return { error: 'Application not found' }; }

  // Check ownership or team membership
  const isOwner = app.ownerId.toString() === user._id.toString();
  let hasAccess = isOwner;
  if (!hasAccess && app.teamId) {
    const team = await DeveloperTeam.findById(app.teamId).lean();
    hasAccess = team?.members?.some((m: any) => m.userId.toString() === user._id.toString()) ?? false;
  }
  if (!hasAccess) { set.status = 403; return { error: 'You do not have access to this application' }; }

  // Count emojis and webhooks
  const [emojiCount, webhookCount] = await Promise.all([
    AppEmoji.countDocuments({ applicationId: app._id }),
    AppWebhook.countDocuments({ applicationId: app._id }),
  ]);

  const sanitized = sanitizeApp(app);
  return { application: { ...sanitized, emojiCount, webhookCount } };
})

// Update application
.patch('/applications/:id', async ({ headers, cookie, params, body, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.id)) { set.status = 404; return { error: 'Application not found' }; }

  const app = await Application.findById(params.id);
  if (!app) { set.status = 404; return { error: 'Application not found' }; }

  const isOwner = app.ownerId.toString() === user._id.toString();
  let hasAccess = isOwner;
  if (!hasAccess && app.teamId) {
    const team = await DeveloperTeam.findById(app.teamId).lean();
    const member = team?.members?.find((m: any) => m.userId.toString() === user._id.toString());
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

  for (const key of allowed) {
    if (patch[key] !== undefined) {
      (app as any)[key] = patch[key];
    }
  }

  await app.save();
  return { application: sanitizeApp(app) };
})

// Delete application
.delete('/applications/:id', async ({ headers, cookie, params, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.id)) { set.status = 404; return { error: 'Application not found' }; }

  const app = await Application.findById(params.id);
  if (!app) { set.status = 404; return { error: 'Application not found' }; }

  if (app.ownerId.toString() !== user._id.toString()) {
    set.status = 403; return { error: 'Only the owner can delete this application' };
  }

  // Clean up related data
  await Promise.all([
    AppEmoji.deleteMany({ applicationId: app._id }),
    AppWebhook.deleteMany({ applicationId: app._id }),
  ]);

  await app.deleteOne();
  return { success: true };
})

// Reset bot token
.post('/applications/:id/bot/reset-token', async ({ headers, cookie, params, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.id)) { set.status = 404; return { error: 'Application not found' }; }

  const app = await Application.findById(params.id);
  if (!app) { set.status = 404; return { error: 'Application not found' }; }

  const isOwner = app.ownerId.toString() === user._id.toString();
  if (!isOwner) { set.status = 403; return { error: 'Only the owner can reset the bot token' }; }

  const newToken = generateBotToken(app.clientId);
  app.botToken = newToken;
  await app.save();

  // Ensure the bot User + keypair exist so the new token actually authenticates.
  const { ensureBotProvisioned } = await import('@/lib/services/appIdentity');
  await ensureBotProvisioned(app as any);

  return { token: newToken };
})

// Create/enable bot for application
.post('/applications/:id/bot', async ({ headers, cookie, params, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.id)) { set.status = 404; return { error: 'Application not found' }; }

  const app = await Application.findById(params.id);
  if (!app) { set.status = 404; return { error: 'Application not found' }; }

  if (app.ownerId.toString() !== user._id.toString()) {
    set.status = 403; return { error: 'Only the owner can enable the bot' };
  }

  // Provision the backing bot User, token, and Ed25519 keypair. Without the bot
  // User, gateway/REST authentication would fail (botId would stay null).
  const { ensureBotProvisioned } = await import('@/lib/services/appIdentity');
  await ensureBotProvisioned(app as any);

  return { application: sanitizeApp(app) };
})

// Set / verify the interactions endpoint URL. Discord-style: we send a signed
// PING and only save the URL if the endpoint acknowledges with { type: 1 }.
.post('/applications/:id/bot/interactions-endpoint', async ({ headers, cookie, params, body, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.id)) { set.status = 404; return { error: 'Application not found' }; }
  const app = await Application.findById(params.id).select('+privateKeyPem');
  if (!app) { set.status = 404; return { error: 'Application not found' }; }
  if (app.ownerId.toString() !== user._id.toString()) {
    set.status = 403; return { error: 'Only the owner can change the interactions endpoint' };
  }

  const url = (body as any)?.url?.trim() || null;

  if (!url) {
    app.interactionsEndpointUrl = null;
    await app.save();
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

  app.interactionsEndpointUrl = url;
  await app.save();
  return { interactionsEndpointUrl: url };
}, {
  body: t.Object({ url: t.Optional(t.Union([t.String(), t.Null()])) }),
})

// Reset client secret
.post('/applications/:id/oauth2/reset-secret', async ({ headers, cookie, params, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.id)) { set.status = 404; return { error: 'Application not found' }; }

  const app = await Application.findById(params.id);
  if (!app) { set.status = 404; return { error: 'Application not found' }; }

  if (app.ownerId.toString() !== user._id.toString()) {
    set.status = 403; return { error: 'Only the owner can reset the client secret' };
  }

  app.clientSecret = generateClientSecret();
  await app.save();

  return { clientSecret: app.clientSecret };
})

// ─── Application Emojis ────────────────────────────────────

.get('/applications/:id/emojis', async ({ headers, cookie, params, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.id)) { set.status = 404; return { error: 'Application not found' }; }

  const emojis = await AppEmoji.find({ applicationId: params.id }).sort({ createdAt: -1 }).lean();
  return { emojis: emojis.map((e: any) => ({
    id: e._id.toString(),
    name: e.name,
    image: e.image,
    animated: e.animated,
    createdAt: e.createdAt,
  })) };
})

.post('/applications/:id/emojis', async ({ headers, cookie, params, body, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.id)) { set.status = 404; return { error: 'Application not found' }; }

  const app = await Application.findById(params.id).lean();
  if (!app) { set.status = 404; return { error: 'Application not found' }; }

  const { name, image, animated } = body as any;
  if (!name || !image) { set.status = 400; return { error: 'Name and image are required' }; }

  const emoji = await AppEmoji.create({
    applicationId: new Types.ObjectId(params.id),
    name: name.trim(),
    image,
    animated: animated ?? false,
  });

  return { emoji: {
    id: emoji._id.toString(),
    name: emoji.name,
    image: emoji.image,
    animated: emoji.animated,
  }};
})

.delete('/applications/:id/emojis/:emojiId', async ({ headers, cookie, params, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.id)) { set.status = 404; return { error: 'Not found' }; }

  await AppEmoji.deleteOne({ _id: params.emojiId, applicationId: params.id });
  return { success: true };
})

// ─── Application Webhooks ──────────────────────────────────

.get('/applications/:id/webhooks', async ({ headers, cookie, params, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.id)) { set.status = 404; return { error: 'Not found' }; }

  const webhooks = await AppWebhook.find({ applicationId: params.id }).sort({ createdAt: -1 }).lean();
  return { webhooks: webhooks.map((w: any) => ({
    id: w._id.toString(),
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

  if (!Types.ObjectId.isValid(params.id)) { set.status = 404; return { error: 'Not found' }; }

  const { name, url, events } = body as any;
  if (!name || !url) { set.status = 400; return { error: 'Name and URL are required' }; }

  try { new URL(url); } catch { set.status = 400; return { error: 'Invalid URL' }; }

  const webhook = await AppWebhook.create({
    applicationId: new Types.ObjectId(params.id),
    name: name.trim(),
    url,
    events: events ?? [],
    active: true,
  });

  return { webhook: {
    id: webhook._id.toString(),
    name: webhook.name,
    url: webhook.url,
    events: webhook.events,
    active: webhook.active,
  }};
})

.patch('/applications/:id/webhooks/:webhookId', async ({ headers, cookie, params, body, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.id)) { set.status = 404; return { error: 'Not found' }; }

  const webhook = await AppWebhook.findById(params.webhookId);
  if (!webhook || webhook.applicationId.toString() !== params.id) {
    set.status = 404; return { error: 'Webhook not found' };
  }

  const patch = body as any;
  if (patch.active !== undefined) webhook.active = patch.active;
  if (patch.events !== undefined) webhook.events = patch.events;
  if (patch.name !== undefined) webhook.name = patch.name;
  if (patch.url !== undefined) webhook.url = patch.url;

  await webhook.save();
  return {
    id: webhook._id.toString(),
    name: webhook.name,
    url: webhook.url,
    events: webhook.events,
    active: webhook.active,
  };
})

.delete('/applications/:id/webhooks/:webhookId', async ({ headers, cookie, params, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.id)) { set.status = 404; return { error: 'Not found' }; }

  await AppWebhook.deleteOne({ _id: params.webhookId, applicationId: params.id });
  return { success: true };
})

// ─── Application Team ──────────────────────────────────────

.get('/applications/:id/team', async ({ headers, cookie, params, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.id)) { set.status = 404; return { error: 'Not found' }; }

  const app = await Application.findById(params.id).lean();
  if (!app) { set.status = 404; return { error: 'Application not found' }; }

  if (!app.teamId) {
    // Solo owner — return just the owner
    const owner = await User.findById(app.ownerId).lean();
    return { members: [{
      id: owner!._id.toString(),
      username: owner!.username,
      avatar: owner!.avatar,
      role: 'owner' as const,
    }]};
  }

  const team = await DeveloperTeam.findById(app.teamId).lean();
  return { members: team?.members?.map((m: any) => ({
    id: m.userId.toString(),
    username: m.username,
    avatar: m.avatar,
    role: m.role,
  })) ?? [] };
})

.post('/applications/:id/team/invite', async ({ headers, cookie, params, body, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.id)) { set.status = 404; return { error: 'Not found' }; }

  const app = await Application.findById(params.id);
  if (!app) { set.status = 404; return { error: 'Application not found' }; }

  if (app.ownerId.toString() !== user._id.toString()) {
    set.status = 403; return { error: 'Only the owner can invite members' };
  }

  const { username, role } = body as any;
  const invitee = await User.findOne({ username: username?.trim() }).lean();
  if (!invitee) { set.status = 404; return { error: 'User not found' }; }

  // For solo apps, create a team first
  if (!app.teamId) {
    const team = await DeveloperTeam.create({
      name: `${app.name} Team`,
      ownerId: app.ownerId,
      members: [
        { userId: app.ownerId, username: user.username, avatar: user.avatar, role: 'owner' },
        { userId: invitee._id, username: invitee.username, avatar: invitee.avatar, role: role ?? 'developer' },
      ],
    });
    app.teamId = team._id;
    await app.save();
    return { member: {
      id: invitee._id.toString(),
      username: invitee.username,
      avatar: invitee.avatar,
      role: role ?? 'developer',
    }};
  }

  const team = await DeveloperTeam.findById(app.teamId);
  if (team?.members.some((m: any) => m.userId.toString() === invitee._id.toString())) {
    set.status = 400; return { error: 'User is already a member' };
  }

  team!.members.push({
    userId: invitee._id,
    username: invitee.username,
    avatar: invitee.avatar,
    role: role ?? 'developer',
  });
  await team!.save();

  return { member: {
    id: invitee._id.toString(),
    username: invitee.username,
    avatar: invitee.avatar,
    role: role ?? 'developer',
  }};
})

.delete('/applications/:id/team/:memberId', async ({ headers, cookie, params, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.id)) { set.status = 404; return { error: 'Not found' }; }

  const app = await Application.findById(params.id).lean();
  if (!app) { set.status = 404; return { error: 'Application not found' }; }

  if (!app.teamId) { set.status = 400; return { error: 'No team for this application' }; }

  const team = await DeveloperTeam.findById(app.teamId);
  if (!team) { set.status = 404; return { error: 'Team not found' }; }

  // Only owner or admin can remove
  const requester = team.members.find((m: any) => m.userId.toString() === user._id.toString());
  if (!requester || (requester.role !== 'owner' && requester.role !== 'admin')) {
    set.status = 403; return { error: 'You do not have permission to remove members' };
  }

  team.members = team.members.filter((m: any) => m.userId.toString() !== params.memberId) as any;
  await team.save();
  return { success: true };
})

// ─── Teams ─────────────────────────────────────────────────

.get('/teams', async ({ headers, cookie, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  const teams = await DeveloperTeam.find({ 'members.userId': user._id }).sort({ createdAt: -1 }).lean();

  // Get app counts per team
  const teamsWithCounts = await Promise.all(teams.map(async (team: any) => {
    const appCount = await Application.countDocuments({ teamId: team._id });
    return { ...sanitizeTeam(team), appCount };
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
    ownerId: user._id,
    members: [{
      userId: user._id,
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

  if (!Types.ObjectId.isValid(params.id)) { set.status = 404; return { error: 'Team not found' }; }

  const team = await DeveloperTeam.findById(params.id).lean();
  if (!team) { set.status = 404; return { error: 'Team not found' }; }

  const isMember = team.members.some((m: any) => m.userId.toString() === user._id.toString());
  if (!isMember) { set.status = 403; return { error: 'You are not a member of this team' }; }

  return { team: sanitizeTeam(team) };
})

.patch('/teams/:id', async ({ headers, cookie, params, body, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.id)) { set.status = 404; return { error: 'Team not found' }; }

  const team = await DeveloperTeam.findById(params.id);
  if (!team) { set.status = 404; return { error: 'Team not found' }; }

  const member = team.members.find((m: any) => m.userId.toString() === user._id.toString());
  if (!member || (member.role !== 'owner' && member.role !== 'admin')) {
    set.status = 403; return { error: 'You do not have permission to edit this team' };
  }

  const { name, description, icon } = body as any;
  if (name !== undefined) team.name = name.trim();
  if (description !== undefined) team.description = description;
  if (icon !== undefined) team.icon = icon;

  await team.save();
  return { team: sanitizeTeam(team) };
})

.delete('/teams/:id', async ({ headers, cookie, params, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.id)) { set.status = 404; return { error: 'Team not found' }; }

  const team = await DeveloperTeam.findById(params.id);
  if (!team) { set.status = 404; return { error: 'Team not found' }; }

  if (team.ownerId.toString() !== user._id.toString()) {
    set.status = 403; return { error: 'Only the team owner can delete it' };
  }

  // Unlink applications from this team
  await Application.updateMany({ teamId: team._id }, { $unset: { teamId: '' } });
  await team.deleteOne();
  return { success: true };
})

// Invite member to team
.post('/teams/:id/members', async ({ headers, cookie, params, body, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.id)) { set.status = 404; return { error: 'Team not found' }; }

  const team = await DeveloperTeam.findById(params.id);
  if (!team) { set.status = 404; return { error: 'Team not found' }; }

  const requester = team.members.find((m: any) => m.userId.toString() === user._id.toString());
  if (!requester || (requester.role !== 'owner' && requester.role !== 'admin')) {
    set.status = 403; return { error: 'You do not have permission to invite members' };
  }

  const { username, role } = body as any;
  const invitee = await User.findOne({ username: username?.trim() }).lean();
  if (!invitee) { set.status = 404; return { error: 'User not found' }; }

  if (team.members.some((m: any) => m.userId.toString() === invitee._id.toString())) {
    set.status = 400; return { error: 'User is already a member' };
  }

  team.members.push({
    userId: invitee._id,
    username: invitee.username,
    avatar: invitee.avatar,
    role: role ?? 'developer',
  } as any);
  await team.save();

  return { member: {
    id: invitee._id.toString(),
    username: invitee.username,
    avatar: invitee.avatar,
    role: role ?? 'developer',
  }};
})

// Remove member from team
.delete('/teams/:id/members/:memberId', async ({ headers, cookie, params, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.id)) { set.status = 404; return { error: 'Team not found' }; }

  const team = await DeveloperTeam.findById(params.id);
  if (!team) { set.status = 404; return { error: 'Team not found' }; }

  const requester = team.members.find((m: any) => m.userId.toString() === user._id.toString());
  if (!requester || (requester.role !== 'owner' && requester.role !== 'admin')) {
    set.status = 403; return { error: 'You do not have permission to remove members' };
  }

  const target = team.members.find((m: any) => m.userId.toString() === params.memberId);
  if (target?.role === 'owner') { set.status = 400; return { error: 'Cannot remove the team owner' }; }

  team.members = team.members.filter((m: any) => m.userId.toString() !== params.memberId) as any;
  await team.save();
  return { success: true };
})

// ─── OAuth2 Token Exchange ─────────────────────────────────

.post('/oauth2/token', async ({ body, set }) => {
  const formData = body as any;

  // Support both JSON and form-encoded
  const grantType = formData.grant_type;
  const clientId = formData.client_id;
  const clientSecret = formData.client_secret;

  const app = await Application.findOne({ clientId });
  if (!app) { set.status = 400; return { error: 'invalid_client' }; }

  if (app.clientSecret !== clientSecret) {
    set.status = 400; return { error: 'invalid_client' };
  }

  if (grantType === 'authorization_code') {
    // Exchange code for token — in production, store codes and validate
    const accessToken = generateToken('sc_');
    const refreshToken = generateToken('sc_r_');

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 604800,
      refresh_token: refreshToken,
      scope: app.scopes.join(' '),
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
      scope: app.scopes.join(' '),
    };
  }

  if (grantType === 'client_credentials') {
    const accessToken = generateToken('sc_');
    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: app.scopes.join(' '),
    };
  }

  set.status = 400;
  return { error: 'unsupported_grant_type' };
})

// OAuth2 authorize page info
.get('/oauth2/authorize', async ({ query, set }) => {
  const clientId = query.client_id as string;
  const app = await Application.findOne({ clientId }).lean();
  if (!app) { set.status = 404; return { error: 'Unknown application' }; }

  return {
    application: {
      id: app._id.toString(),
      name: app.name,
      icon: app.icon,
      description: app.description,
    },
    scopes: (query.scope as string || '').split(' ').filter(Boolean),
    redirect_uri: query.redirect_uri as string,
  };
})

// ─── Gateway URL ───────────────────────────────────────────

.get('/gateway', () => ({
  url: config.GATEWAY_URL,
}))

.get('/gateway/bot', async ({ headers, set }) => {
  const authHeader = headers.authorization;
  if (!authHeader?.startsWith('Bot ')) { set.status = 401; return { error: 'Unauthorized' }; }

  const token = authHeader.slice(4);
  const app = await Application.findOne({ botToken: token }).lean();
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

// ─── OAuth2 Token Revocation ───────────────────────────────

.post('/oauth2/token/revoke', async ({ body, set }) => {
  const formData = body as any;
  const token = formData.token;
  if (!token) { set.status = 400; return { error: 'invalid_request' }; }

  // In production, invalidate the token in the store
  // For now, return success
  return {};
})

// ─── Application Analytics ─────────────────────────────────

.get('/applications/:id/analytics', async ({ headers, cookie, params, query, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.id)) { set.status = 404; return { error: 'Application not found' }; }
  const app = await Application.findById(params.id).lean();
  if (!app) { set.status = 404; return { error: 'Application not found' }; }
  if (app.ownerId.toString() !== user._id.toString() && !(app.teamId && await isTeamMember(app.teamId, user._id))) {
    set.status = 403; return { error: 'Forbidden' };
  }

  const days = parseInt(query.days as string) || 30;
  const since = new Date(Date.now() - days * 86400000);

  // Get server count where bot is a member
  const { ServerMember } = await import('@/lib/models');
  const botUser = app.botId ? await User.findById(app.botId).lean() : null;
  const serverCount = botUser ? await ServerMember.countDocuments({ userId: botUser._id }) : 0;

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

  if (!Types.ObjectId.isValid(params.id)) { set.status = 404; return { error: 'Application not found' }; }
  const app = await Application.findById(params.id).lean();
  if (!app) { set.status = 404; return { error: 'Application not found' }; }
  if (app.ownerId.toString() !== user._id.toString() && !(app.teamId && await isTeamMember(app.teamId, user._id))) {
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

  if (!Types.ObjectId.isValid(params.id)) { set.status = 404; return { error: 'Application not found' }; }
  const app = await Application.findById(params.id);
  if (!app) { set.status = 404; return { error: 'Application not found' }; }
  if (app.ownerId.toString() !== user._id.toString()) {
    set.status = 403; return { error: 'Forbidden' };
  }

  const patch = body as any;
  if (patch.categories !== undefined) app.tags = patch.categories;
  if (patch.summary !== undefined) app.description = patch.summary;
  await app.save();

  return { success: true };
})

// ─── Get Individual App Emoji ──────────────────────────────

.get('/applications/:id/emojis/:emojiId', async ({ headers, cookie, params, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.emojiId)) { set.status = 404; return { error: 'Emoji not found' }; }
  const emoji = await AppEmoji.findById(params.emojiId).lean();
  if (!emoji || emoji.applicationId.toString() !== params.id) {
    set.status = 404; return { error: 'Emoji not found' };
  }
  return {
    id: emoji._id.toString(),
    name: emoji.name,
    image: emoji.imageUrl,
    animated: emoji.animated ?? false,
  };
})

// ─── Get Individual App Webhook ────────────────────────────

.get('/applications/:id/webhooks/:webhookId', async ({ headers, cookie, params, set }) => {
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.webhookId)) { set.status = 404; return { error: 'Webhook not found' }; }
  const webhook = await AppWebhook.findById(params.webhookId).lean();
  if (!webhook || webhook.applicationId.toString() !== params.id) {
    set.status = 404; return { error: 'Webhook not found' };
  }
  return {
    id: webhook._id.toString(),
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

  if (!Types.ObjectId.isValid(params.id)) { set.status = 404; return { error: 'Application not found' }; }
  const app = await Application.findById(params.id).lean();
  if (!app) { set.status = 404; return { error: 'Application not found' }; }
  if (app.ownerId.toString() !== user._id.toString() && !(app.teamId && await isTeamMember(app.teamId, user._id))) {
    set.status = 403; return { error: 'Forbidden' };
  }

  if (!app.botId) { return { bot: null }; }

  const botUser = await User.findById(app.botId).lean();
  if (!botUser) { return { bot: null }; }

  return {
    bot: {
      id: botUser._id.toString(),
      username: botUser.username,
      avatar: botUser.avatar,
      public: app.botPublic ?? false,
      require_code_grant: app.botRequireCodeGrant ?? false,
      token: app.botToken ?? null,
    },
  };
});
