/**
 * Discord-shaped application objects and the PATCH /applications/@me rules
 * (pure; the routes live in src/lib/api/botApi.ts). Ids stay internal UUIDs:
 * the snowflake boundary (./boundary.ts) translates them, and an
 * application's snowflake is its numeric client id.
 */
import { allowedPrivilegedIntents, intentApplicationFlags, INTENT, toStoredIntents, APPLICATION_FLAGS } from '@/lib/gateway/intents';
import { invalidFormBody, type DiscordError } from './errors';

/** Discord's "_LIMITED" intent flags: the only flags an app may PATCH. */
export const LIMITED_INTENT_FLAGS = {
  GATEWAY_PRESENCE_LIMITED: 1 << 13,
  GATEWAY_GUILD_MEMBERS_LIMITED: 1 << 15,
  GATEWAY_MESSAGE_CONTENT_LIMITED: 1 << 19,
} as const;

const ALL_INTENT_FLAGS =
  APPLICATION_FLAGS.GATEWAY_PRESENCE | APPLICATION_FLAGS.GATEWAY_GUILD_MEMBERS | APPLICATION_FLAGS.GATEWAY_MESSAGE_CONTENT |
  LIMITED_INTENT_FLAGS.GATEWAY_PRESENCE_LIMITED | LIMITED_INTENT_FLAGS.GATEWAY_GUILD_MEMBERS_LIMITED | LIMITED_INTENT_FLAGS.GATEWAY_MESSAGE_CONTENT_LIMITED;

export interface AppRow {
  id: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  coverImage?: string | null;
  botId?: string | null;
  botPublic?: boolean | null;
  botRequireCodeGrant?: boolean | null;
  redirectUris?: string[] | null;
  rpcOrigins?: string[] | null;
  installParams?: unknown;
  customInstallUrl?: string | null;
  tags?: string[] | null;
  termsOfServiceUrl?: string | null;
  privacyPolicyUrl?: string | null;
  flags?: number | null;
  gatewayIntents?: number | null;
  interactionsEndpointUrl?: string | null;
  publicKey?: string | null;
  createdAt?: Date | string | null;
}

/** Application `flags`: stored flags (minus intent bits) plus the enabled privileged intents. */
export function applicationFlags(app: AppRow): number {
  return ((Number(app.flags) || 0) & ~ALL_INTENT_FLAGS) | intentApplicationFlags(allowedPrivilegedIntents(app));
}

export function installParamsOf(app: AppRow): { scopes: string[]; permissions: string } | null {
  const p = app.installParams as { scopes?: unknown; permissions?: unknown } | null | undefined;
  if (!p || !Array.isArray(p.scopes) || p.scopes.length === 0) return null;
  const scopes = p.scopes.filter((s): s is string => typeof s === 'string');
  let permissions = '0';
  try { permissions = BigInt(String(p.permissions ?? '0')).toString(); } catch { /* keep 0 */ }
  return { scopes, permissions };
}

/** Discord application object (GET /applications/@me, /oauth2/applications/@me). */
export function toDiscordApplication(
  app: AppRow,
  opts: { owner?: Record<string, unknown> | null; bot?: Record<string, unknown> | null; guildCount?: number },
) {
  const install = installParamsOf(app);
  return {
    id: app.id,
    name: app.name,
    icon: app.icon ?? null,
    description: app.description ?? '',
    summary: '',
    type: null,
    is_monetized: false,
    is_verified: false,
    is_discoverable: false,
    hook: true,
    rpc_origins: app.rpcOrigins ?? [],
    bot_public: app.botPublic ?? true,
    bot_require_code_grant: app.botRequireCodeGrant ?? false,
    ...(opts.bot ? { bot: opts.bot } : {}),
    terms_of_service_url: app.termsOfServiceUrl ?? undefined,
    privacy_policy_url: app.privacyPolicyUrl ?? undefined,
    owner: opts.owner ?? undefined,
    verify_key: app.publicKey ?? '',
    team: null,
    flags: applicationFlags(app),
    approximate_guild_count: opts.guildCount ?? 0,
    approximate_user_install_count: 0,
    approximate_user_authorization_count: 0,
    redirect_uris: app.redirectUris ?? [],
    interactions_endpoint_url: app.interactionsEndpointUrl ?? null,
    role_connections_verification_url: null,
    event_webhooks_url: null,
    event_webhooks_status: 1,
    event_webhooks_types: [],
    tags: app.tags ?? [],
    ...(install ? { install_params: install } : {}),
    integration_types_config: { '0': install ? { oauth2_install_params: install } : {} },
    custom_install_url: app.customInstallUrl ?? undefined,
  };
}

const VALID_SCOPES = new Set(['bot', 'applications.commands', 'identify', 'email', 'guilds', 'guilds.join', 'guilds.members.read', 'connections', 'messages.read', 'webhook.incoming', 'applications.commands.permissions.update']);

/**
 * Validate a PATCH /applications/@me body into model updates (Discord's
 * editable fields). `interactions_endpoint_url` is returned separately: the
 * caller must verify it with a signed PING before saving.
 */
export function parseApplicationPatch(
  body: unknown,
): { ok: true; updates: Record<string, unknown>; interactionsEndpointUrl?: string | null } | { ok: false; error: DiscordError } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const errs: Array<{ path: string; code: string; message: string }> = [];
  const updates: Record<string, unknown> = {};
  let interactionsEndpointUrl: string | null | undefined;

  if (b.description !== undefined) {
    if (b.description !== null && typeof b.description !== 'string') errs.push({ path: 'description', code: 'BASE_TYPE_STRING', message: 'Must be a string.' });
    else if ((b.description ?? '').length > 400) errs.push({ path: 'description', code: 'BASE_TYPE_MAX_LENGTH', message: 'Must be 400 or fewer in length.' });
    else updates.description = b.description ?? '';
  }
  if (b.custom_install_url !== undefined) {
    const v = b.custom_install_url;
    if (v === null || v === '') updates.customInstallUrl = null;
    else if (typeof v !== 'string' || !/^https?:\/\//i.test(v) || v.length > 2048) errs.push({ path: 'custom_install_url', code: 'URL_TYPE_INVALID_URL', message: 'Not a well formed URL.' });
    else updates.customInstallUrl = v;
  }
  if (b.tags !== undefined) {
    const v = b.tags;
    if (!Array.isArray(v) || v.length > 5 || v.some((t) => typeof t !== 'string' || t.length === 0 || t.length > 20)) {
      errs.push({ path: 'tags', code: 'BASE_TYPE_BAD_LENGTH', message: 'Up to 5 tags of 1-20 characters.' });
    } else updates.tags = v;
  }
  const installIn = b.install_params !== undefined
    ? b.install_params
    : ((b.integration_types_config as Record<string, { oauth2_install_params?: unknown }> | undefined)?.['0']?.oauth2_install_params);
  if (installIn !== undefined) {
    if (installIn === null) updates.installParams = null;
    else {
      const p = installIn as { scopes?: unknown; permissions?: unknown };
      const scopes = Array.isArray(p.scopes) ? p.scopes : null;
      let permsOk = true;
      try { BigInt(String(p.permissions ?? '0')); } catch { permsOk = false; }
      if (!scopes || scopes.some((s) => typeof s !== 'string' || !VALID_SCOPES.has(s))) {
        errs.push({ path: 'install_params.scopes', code: 'BASE_TYPE_CHOICES', message: 'Value must be one of the valid OAuth2 scopes.' });
      } else if (scopes.includes('bot') === false && p.permissions && String(p.permissions) !== '0') {
        errs.push({ path: 'install_params.permissions', code: 'APPLICATION_INSTALL_PARAMS_PERMISSIONS_REQUIRE_BOT', message: 'Permissions require the bot scope.' });
      } else if (!permsOk) {
        errs.push({ path: 'install_params.permissions', code: 'BASE_TYPE_BAD_TYPE', message: 'Must be a permission bitfield string.' });
      } else updates.installParams = { scopes, permissions: BigInt(String(p.permissions ?? '0')).toString() };
    }
  }
  if (b.flags !== undefined) {
    const f = Number(b.flags);
    if (!Number.isInteger(f) || f < 0) errs.push({ path: 'flags', code: 'BASE_TYPE_BAD_TYPE', message: 'Must be an integer.' });
    else {
      // Only the intent flags are editable (Discord: the _LIMITED ones).
      const presence = f & (LIMITED_INTENT_FLAGS.GATEWAY_PRESENCE_LIMITED | APPLICATION_FLAGS.GATEWAY_PRESENCE);
      const members = f & (LIMITED_INTENT_FLAGS.GATEWAY_GUILD_MEMBERS_LIMITED | APPLICATION_FLAGS.GATEWAY_GUILD_MEMBERS);
      const content = f & (LIMITED_INTENT_FLAGS.GATEWAY_MESSAGE_CONTENT_LIMITED | APPLICATION_FLAGS.GATEWAY_MESSAGE_CONTENT);
      const intents = (presence ? INTENT.GUILD_PRESENCES : 0) | (members ? INTENT.GUILD_MEMBERS : 0) | (content ? INTENT.MESSAGE_CONTENT : 0);
      const stored = toStoredIntents(intents);
      if (stored !== null) updates.gatewayIntents = stored;
    }
  }
  if (b.interactions_endpoint_url !== undefined) {
    const v = b.interactions_endpoint_url;
    if (v === null || v === '') interactionsEndpointUrl = null;
    else if (typeof v !== 'string' || !/^https:\/\//i.test(v) || v.length > 2048) {
      errs.push({ path: 'interactions_endpoint_url', code: 'URL_TYPE_INVALID_URL', message: 'Not a well formed https URL.' });
    } else interactionsEndpointUrl = v;
  }
  for (const k of ['icon', 'cover_image'] as const) {
    if (b[k] !== undefined && b[k] !== null) {
      errs.push({ path: k, code: 'BASE_TYPE_BAD_TYPE', message: 'Change the image in the Developer Portal.' });
    }
  }
  if (b.icon === null) updates.icon = null;
  if (b.cover_image === null) updates.coverImage = null;
  if (b.role_connections_verification_url !== undefined && b.role_connections_verification_url !== null) {
    errs.push({ path: 'role_connections_verification_url', code: 'BASE_TYPE_BAD_TYPE', message: 'Linked roles are not supported.' });
  }

  if (errs.length > 0) return { ok: false, error: invalidFormBody(errs) };
  return { ok: true, updates, ...(interactionsEndpointUrl !== undefined ? { interactionsEndpointUrl } : {}) };
}
