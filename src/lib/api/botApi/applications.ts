// Discord v10 bot routes: applications, commands, OAuth2 OIDC and role connections.
// Mounted at the end of botApiRoutes (src/lib/api/botApi.ts), so the id
// boundary, per-bot rate limits and the guild/channel access guard registered
// there run for every route here too. Same conventions as botApi.ts.
//
// The helpers come from botApi.ts (a circular import: they are only called at
// request time, never while the modules load).
import { Elysia } from 'elysia';
import {
  MISSING_ACCESS, UNKNOWN_COMMAND, authenticateBot, authenticateCommandsCaller, bearerGuildCommandsCheck,
  discordApplication, ownsApp, requireBearerScope, respond, type BotAuth,
} from '../botApi';
import { parseApplicationPatch, type DecodedAppImage } from '@/lib/botapi/application';
import { invalidFormBody } from '@/lib/botapi/errors';
import { validateRoleConnectionMetadata, validateUserRoleConnection } from '@/lib/botapi/roleConnections';
import { config } from '@/lib/config';
import { checkRateLimit, getClientIP, isValidObjectId } from '@/lib/security';

const UNAUTHORIZED = { code: 0, message: '401: Unauthorized' };

type Body = Record<string, unknown>;
const isPlainObject = (v: unknown): v is Body => !!v && typeof v === 'object' && !Array.isArray(v);

/** Command fields Discord accepts on POST / PATCH (create_application_command). */
type CommandBody = {
  name?: unknown; name_localizations?: unknown; description?: unknown; description_localizations?: unknown; options?: unknown;
  default_member_permissions?: unknown; dm_permission?: unknown; default_permission?: unknown; integration_types?: unknown;
  contexts?: unknown; type?: unknown; nsfw?: unknown; handler?: unknown;
};

/**
 * Store a new application icon / cover (image data from PATCH
 * /applications/@me) under the app's own prefix, then delete the previous file
 * only when it provably is one of this app's uploads (same rule as the portal).
 */
async function uploadAppImage(
  app: { id: string; icon?: string | null; coverImage?: string | null },
  kind: 'icon' | 'cover',
  image: DecodedAppImage,
  uploaderId: string,
  ip: string,
): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  const { storage, ContentBlockedError } = await import('@/lib/services/storage');
  const { APP_ASSET_CATEGORY, isOwnedAppAssetUrl } = await import('@/lib/appDirectory/assets');
  const ext = image.contentType.split('/')[1] === 'jpeg' ? 'jpg' : image.contentType.split('/')[1];
  try {
    const result = await storage.upload({
      category: APP_ASSET_CATEGORY[kind],
      contentType: image.contentType,
      data: image.data,
      size: image.data.length,
      filename: `${kind}.${ext}`,
      keyScope: app.id.toLowerCase(),
      scanUserId: uploaderId,
      ip,
    });
    const previous = kind === 'icon' ? app.icon : app.coverImage;
    if (previous && previous !== result.url && isOwnedAppAssetUrl(previous, config.CDN_URL, kind, app.id)) {
      try { await storage.deleteByUrl(previous); } catch { /* best-effort cleanup */ }
    }
    return { ok: true, url: result.url };
  } catch (err) {
    if (err instanceof ContentBlockedError) return { ok: false, message: 'This image cannot be used' };
    console.error('[bot-api] application image upload failed:', (err as Error)?.message ?? err);
    return { ok: false, message: 'Image upload failed' };
  }
}

/** PATCH /applications/@me (and /applications/{own id}) with the fields the route read. */
async function patchOwnApplication(auth: BotAuth, input: Body, set: { status?: number | string }, ip: string) {
  const parsed = parseApplicationPatch(input, { iconBytes: config.MAX_AVATAR_SIZE, coverBytes: config.MAX_BANNER_SIZE });
  if (!parsed.ok) { set.status = 400; return parsed.error; }
  const app = auth.app;
  if (parsed.teamId !== undefined) {
    const same = (parsed.teamId ?? null) === null ? !app.teamId : !!app.teamId && parsed.teamId!.toLowerCase() === app.teamId.toLowerCase();
    if (!same) {
      set.status = 400;
      return invalidFormBody([{ path: 'team_id', code: 'APPLICATION_TEAM_TRANSFER_UNSUPPORTED', message: 'Transfer the application to a team in the Developer Portal.' }]);
    }
  }
  const updates: Record<string, unknown> = { ...parsed.updates };
  if (parsed.interactionsEndpointUrl !== undefined) {
    const url = parsed.interactionsEndpointUrl;
    if (url) {
      // Same check as the portal: a signed PING must come back as a PONG.
      // safeFetch re-checks the address on the call itself, follows no
      // redirects and the reply is capped (src/lib/botapi/endpointVerify.ts).
      const { ensureBotProvisioned } = await import('@/lib/services/appIdentity');
      const provisioned = await ensureBotProvisioned(app);
      const { verifyInteractionsEndpointSafely } = await import('@/lib/botapi/endpointVerify');
      const ok = await verifyInteractionsEndpointSafely({ url, privateKeyPem: provisioned.privateKeyPem, clientId: provisioned.clientId });
      if (!ok) {
        set.status = 400;
        return invalidFormBody([{ path: 'interactions_endpoint_url', code: 'APPLICATION_INTERACTION_ENDPOINT_URL_INVALID', message: 'The specified interactions endpoint url could not be verified.' }]);
      }
    }
    updates.interactionsEndpointUrl = url;
  }
  if (parsed.images?.icon || parsed.images?.coverImage) {
    const limited = await checkRateLimit('upload', `${auth.botUser.id}:${ip}`);
    if (!limited.success) { set.status = 429; return { code: 0, message: 'You are being rate limited.', retry_after: limited.retryAfter ?? 1, global: false }; }
    for (const [kind, col, field] of [['icon', 'icon', 'icon'], ['cover', 'coverImage', 'cover_image']] as const) {
      const img = parsed.images[col];
      if (!img) continue;
      const stored = await uploadAppImage(app, kind, img, auth.botUser.id, ip);
      if (!stored.ok) { set.status = 400; return invalidFormBody([{ path: field, code: 'IMAGE_INVALID', message: stored.message }]); }
      updates[col] = stored.url;
    }
  }
  const { Application } = await import('@/lib/models');
  if (parsed.extras) {
    const { updateAppApiExtras } = await import('@/lib/services/applicationApiSettings');
    await updateAppApiExtras(app.id, parsed.extras);
  }
  if (Object.keys(updates).length > 0) {
    await Application.updateById(app.id, { ...updates, updatedAt: new Date() });
    const { invalidateBotTokenCache } = await import('@/lib/services/botTokens');
    invalidateBotTokenCache();
    if ('icon' in updates || 'coverImage' in updates || 'description' in updates || 'tags' in updates) {
      void import('@/lib/services/appDirectory').then((m) => m.invalidateAppDirectory()).catch(() => {});
    }
  }
  const fresh = (await Application.findById(app.id)) ?? app;
  return discordApplication(fresh, auth.botUser);
}

/** The caller of a role-connection route: a Bearer token with role_connections.write for this app. */
async function roleConnectionCaller(headers: Record<string, string | undefined>, appId: string) {
  const r = await requireBearerScope(headers, 'role_connections.write');
  if (!r.ok) return r;
  if (!ownsApp({ app: r.auth.app }, appId)) return { ok: false as const, status: 403, body: MISSING_ACCESS };
  return r;
}

export const applicationsBotRoutes = new Elysia()

// ─── The calling bot's application (WP6) ───────────────────
// Discord's editable fields, all read here; icon / cover_image take image
// data, interactions_endpoint_url is verified with a signed PING, fields
// without an `applications` column live in application_api_settings.
.patch('/applications/@me', async ({ headers, body, request, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return UNAUTHORIZED; }
  const {
    custom_install_url, description, role_connections_verification_url, install_params, integration_types_config, flags, icon,
    cover_image, interactions_endpoint_url, tags, event_webhooks_url, event_webhooks_status, event_webhooks_types,
    explicit_content_filter, max_participants, type, team_id,
  } = (body ?? {}) as Body;
  return patchOwnApplication(auth, {
    custom_install_url, description, role_connections_verification_url, install_params, integration_types_config, flags, icon,
    cover_image, interactions_endpoint_url, tags, event_webhooks_url, event_webhooks_status, event_webhooks_types,
    explicit_content_filter, max_participants, type, team_id,
  }, set, getClientIP(request));
})
.patch('/applications/:appId', async ({ headers, params, body, request, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return UNAUTHORIZED; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  const {
    custom_install_url, description, role_connections_verification_url, install_params, integration_types_config, flags, icon,
    cover_image, interactions_endpoint_url, tags, event_webhooks_url, event_webhooks_status, event_webhooks_types,
    explicit_content_filter, max_participants, type, team_id,
  } = (body ?? {}) as Body;
  return patchOwnApplication(auth, {
    custom_install_url, description, role_connections_verification_url, install_params, integration_types_config, flags, icon,
    cover_image, interactions_endpoint_url, tags, event_webhooks_url, event_webhooks_status, event_webhooks_types,
    explicit_content_filter, max_participants, type, team_id,
  }, set, getClientIP(request));
})

// ─── Application command writes (WP3) ──────────────────────
// Validation (50035 trees) is src/lib/botapi/commands.ts validateCommand;
// storage is src/lib/services/appCommands.ts. A non-object body goes through
// as is so the validator reports it.
.post('/applications/:appId/commands', async ({ headers, params, body, set }) => {
  const auth = await authenticateCommandsCaller(headers, 'write');
  if (!auth) { set.status = 401; return UNAUTHORIZED; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  const {
    name, name_localizations, description, description_localizations, options, default_member_permissions, dm_permission,
    default_permission, integration_types, contexts, type, nsfw, handler,
  } = (body ?? {}) as CommandBody;
  const input = isPlainObject(body)
    ? { name, name_localizations, description, description_localizations, options, default_member_permissions, dm_permission, default_permission, integration_types, contexts, type, nsfw, handler }
    : body;
  const { upsertCommand } = await import('@/lib/services/appCommands');
  return respond(set, await upsertCommand(auth.app.id, null, input));
})
.patch('/applications/:appId/commands/:commandId', async ({ headers, params, body, set }) => {
  const auth = await authenticateCommandsCaller(headers, 'write');
  if (!auth) { set.status = 401; return UNAUTHORIZED; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  if (!isValidObjectId(params.commandId)) { set.status = 404; return UNKNOWN_COMMAND; }
  const {
    name, name_localizations, description, description_localizations, options, default_member_permissions, dm_permission,
    default_permission, integration_types, contexts, type, nsfw, handler,
  } = (body ?? {}) as CommandBody;
  const input = isPlainObject(body)
    ? { name, name_localizations, description, description_localizations, options, default_member_permissions, dm_permission, default_permission, integration_types, contexts, type, nsfw, handler }
    : body;
  const { patchCommand } = await import('@/lib/services/appCommands');
  return respond(set, await patchCommand(auth.app.id, null, params.commandId, input));
})
.post('/applications/:appId/guilds/:guildId/commands', async ({ headers, params, body, set }) => {
  const auth = await authenticateCommandsCaller(headers, 'write');
  if (!auth) { set.status = 401; return UNAUTHORIZED; }
  const gc = await bearerGuildCommandsCheck(auth, params.guildId, 'write');
  if (gc) { set.status = gc.status; return gc.body; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  const {
    name, name_localizations, description, description_localizations, options, default_member_permissions, dm_permission,
    default_permission, integration_types, contexts, type, nsfw, handler,
  } = (body ?? {}) as CommandBody;
  const input = isPlainObject(body)
    ? { name, name_localizations, description, description_localizations, options, default_member_permissions, dm_permission, default_permission, integration_types, contexts, type, nsfw, handler }
    : body;
  const { upsertCommand } = await import('@/lib/services/appCommands');
  return respond(set, await upsertCommand(auth.app.id, params.guildId, input));
})
.patch('/applications/:appId/guilds/:guildId/commands/:commandId', async ({ headers, params, body, set }) => {
  const auth = await authenticateCommandsCaller(headers, 'write');
  if (!auth) { set.status = 401; return UNAUTHORIZED; }
  const gc = await bearerGuildCommandsCheck(auth, params.guildId, 'write');
  if (gc) { set.status = gc.status; return gc.body; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  if (!isValidObjectId(params.commandId)) { set.status = 404; return UNKNOWN_COMMAND; }
  const {
    name, name_localizations, description, description_localizations, options, default_member_permissions, dm_permission,
    default_permission, integration_types, contexts, type, nsfw, handler,
  } = (body ?? {}) as CommandBody;
  const input = isPlainObject(body)
    ? { name, name_localizations, description, description_localizations, options, default_member_permissions, dm_permission, default_permission, integration_types, contexts, type, nsfw, handler }
    : body;
  const { patchCommand } = await import('@/lib/services/appCommands');
  return respond(set, await patchCommand(auth.app.id, params.guildId, params.commandId, input));
})
// Batch permissions (the v1 form Discord disabled for bots): a list of
// { id, permissions } that replaces every override this app has in the guild.
// Same callers as the single-command PUT (a Bearer token with
// applications.commands.permissions.update of a user who can manage the guild
// and its roles, or the app's own bot).
.put('/applications/:appId/guilds/:guildId/commands/permissions', async ({ headers, params, body, set }) => {
  const auth = await authenticateCommandsCaller(headers, 'permissions');
  if (!auth) { set.status = 401; return UNAUTHORIZED; }
  const gc = await bearerGuildCommandsCheck(auth, params.guildId, 'permissions');
  if (gc) { set.status = gc.status; return gc.body; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  const { putGuildCommandPermissionsBatch } = await import('@/lib/services/appCommands');
  return respond(set, await putGuildCommandPermissionsBatch({ id: auth.app.id, botId: auth.app.botId ?? null }, params.guildId, body));
})

// ─── Linked roles: metadata records (bot token) ────────────
.get('/applications/:appId/role-connections/metadata', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return UNAUTHORIZED; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  const { getRoleConnectionMetadata } = await import('@/lib/services/applicationApiSettings');
  return getRoleConnectionMetadata(auth.app.id);
})
.put('/applications/:appId/role-connections/metadata', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return UNAUTHORIZED; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  const parsed = validateRoleConnectionMetadata(body);
  if (!parsed.ok) { set.status = 400; return parsed.error; }
  const { putRoleConnectionMetadata } = await import('@/lib/services/applicationApiSettings');
  return putRoleConnectionMetadata(auth.app.id, parsed.records);
})

// ─── Linked roles: the user's connection (Bearer, role_connections.write) ─
.get('/users/@me/applications/:appId/role-connection', async ({ headers, params, set }) => {
  const caller = await roleConnectionCaller(headers, params.appId);
  if (!caller.ok) { set.status = caller.status; return caller.body; }
  const { getUserRoleConnection } = await import('@/lib/services/applicationApiSettings');
  return getUserRoleConnection(caller.auth.app.id, caller.auth.user.id);
})
.put('/users/@me/applications/:appId/role-connection', async ({ headers, params, body, set }) => {
  const caller = await roleConnectionCaller(headers, params.appId);
  if (!caller.ok) { set.status = caller.status; return caller.body; }
  const { platform_name, platform_username, metadata } = (body ?? {}) as Body;
  const input = isPlainObject(body) ? { platform_name, platform_username, metadata } : body;
  const { getRoleConnectionMetadata, getUserRoleConnection, putUserRoleConnection } = await import('@/lib/services/applicationApiSettings');
  const appId = caller.auth.app.id;
  const records = await getRoleConnectionMetadata(appId);
  const current = await getUserRoleConnection(appId, caller.auth.user.id, records);
  const parsed = validateUserRoleConnection(input, records, current);
  if (!parsed.ok) { set.status = 400; return parsed.error; }
  return putUserRoleConnection(appId, caller.auth.user.id, parsed.connection, records);
})
.delete('/users/@me/applications/:appId/role-connection', async ({ headers, params, set }) => {
  const caller = await roleConnectionCaller(headers, params.appId);
  if (!caller.ok) { set.status = caller.status; return caller.body; }
  const { deleteUserRoleConnection } = await import('@/lib/services/applicationApiSettings');
  await deleteUserRoleConnection(caller.auth.app.id, caller.auth.user.id);
  set.status = 204;
  return '';
})

// ─── Activities (Embedded App SDK) ─────────────────────────
// Attachment upload: multipart `file`, stored through the chat upload path
// (type whitelist, size limit, Trust & Safety scan), returned as an ephemeral
// attachment. Only the app's own bot token may upload: the upload scan's
// verdict (strikes, restrictions) lands on the uploader, so a Bearer token
// must never make a user the uploader of a file the app chose.
.post('/applications/:appId/attachment', async ({ headers, params, body, request, set }) => {
  const bot = await authenticateBot(headers);
  if (!bot) { set.status = 401; return UNAUTHORIZED; }
  const app = bot.app;
  if (!ownsApp({ app }, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  const uploaderId = bot.botUser.id;
  const { file } = (body ?? {}) as { file?: unknown };
  if (!file || typeof file !== 'object' || typeof (file as Blob).arrayBuffer !== 'function') {
    set.status = 400;
    return invalidFormBody([{ path: 'file', code: 'BASE_TYPE_REQUIRED', message: 'This field is required' }]);
  }
  const ip = getClientIP(request);
  const limited = await checkRateLimit('upload', `${uploaderId}:${ip}`);
  if (!limited.success) { set.status = 429; return { code: 0, message: 'You are being rate limited.', retry_after: limited.retryAfter ?? 1, global: false }; }
  const { storeChatAttachment } = await import('@/lib/api/uploads');
  const f = file as File;
  const stored = await storeChatAttachment(f, { uploaderId, ip });
  if (!stored.ok) {
    set.status = stored.status;
    return { code: stored.status === 413 ? 40005 : 50035, message: `file: ${stored.error}` };
  }
  let dims: { width: number; height: number } | null = null;
  if (stored.attachment.contentType.startsWith('image/')) {
    const { imageDimensions } = await import('@/lib/chat/botMultipart');
    dims = imageDimensions(new Uint8Array(await f.slice(0, 256 * 1024).arrayBuffer()));
  }
  const { snowflakeNow } = await import('@/lib/botapi/commands');
  return {
    attachment: {
      id: snowflakeNow(),
      filename: stored.attachment.filename,
      size: stored.attachment.size,
      url: stored.attachment.url,
      proxy_url: stored.attachment.url,
      content_type: stored.attachment.contentType,
      ...(dims ?? {}),
      ephemeral: true,
    },
  };
})
// Activity instances: SerikaCord has no running Embedded App activities, so
// every instance id is unknown (Discord's 404 for an instance that ended).
.get('/applications/:appId/activity-instances/:instanceId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return UNAUTHORIZED; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  set.status = 404;
  return { code: 0, message: '404: Not Found' };
})

// ─── OpenID Connect ────────────────────────────────────────
// userinfo: a Bearer token with `openid` (email + email_verified also need
// `email`); `sub` is the user id in the app's id format. keys: the JWKS that
// verifies our id_tokens (src/lib/services/oidcKeys.ts), public like Discord's.
.get('/oauth2/userinfo', async ({ headers, set }) => {
  const r = await requireBearerScope(headers, 'openid');
  if (!r.ok) { set.status = r.status; return r.body; }
  const { buildUserInfo } = await import('@/lib/oauth/oidc');
  const info = buildUserInfo(r.auth.user, r.auth.grant.scopes);
  const { idFormatOf, toSnowflakes } = await import('@/lib/botapi/boundary');
  if (idFormatOf(r.auth.app) === 'snowflake') info.sub = (await toSnowflakes({ id: r.auth.user.id })).id;
  return info;
})
.get('/oauth2/keys', async ({ set }) => {
  const { getJwks } = await import('@/lib/services/oidcKeys');
  set.headers['cache-control'] = 'public, max-age=3600';
  return getJwks();
});
