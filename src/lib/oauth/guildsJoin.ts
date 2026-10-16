/**
 * The OAuth2 check behind Discord's `PUT /guilds/{guild_id}/members/{user_id}`
 * ("Add Guild Member"): the body's `access_token` must be a live token the
 * user granted with the `guilds.join` scope, to the same application whose
 * bot makes the request. The members route (src/lib/api/botApi.ts) still has
 * to check the bot's CREATE_INSTANT_INVITE (plus MANAGE_NICKNAMES /
 * MANAGE_ROLES / MUTE_MEMBERS / DEAFEN_MEMBERS for those body fields), bans
 * and the member cap before adding anyone.
 */
import { hasScope } from './scopes';

export type GuildsJoinGrant =
  | { ok: true; userId: string; applicationId: string; scopes: string[] }
  | { ok: false; status: number; body: { code: number; message: string } };

const INVALID_TOKEN = { code: 50025, message: 'Invalid OAuth2 access token' };

/**
 * Validate an `access_token` for adding `userId` to a guild.
 *
 * `bearer` is the raw access token from the request body (a `Bearer ` prefix
 * is tolerated). The token must belong to `opts.applicationId` (the calling
 * bot's application id, internal UUID), as on Discord.
 * Errors are Discord-shaped: 50025 for a bad / expired / foreign token or one
 * granted by another user, 50026 when it lacks the `guilds.join` scope.
 */
export async function resolveGuildsJoinGrant(
  bearer: unknown,
  userId: string,
  opts: { applicationId: string },
): Promise<GuildsJoinGrant> {
  if (typeof bearer !== 'string' || !bearer.trim()) return { ok: false, status: 400, body: INVALID_TOKEN };
  const token = bearer.trim().replace(/^Bearer\s+/i, '');
  const { resolveBearerToken } = await import('@/lib/services/oauth2Tokens');
  const grant = await resolveBearerToken(token);
  if (!grant) return { ok: false, status: 403, body: INVALID_TOKEN };
  if (!opts.applicationId || grant.applicationId.toLowerCase() !== opts.applicationId.toLowerCase()) {
    return { ok: false, status: 403, body: INVALID_TOKEN };
  }
  if (grant.userId.toLowerCase() !== String(userId).toLowerCase()) return { ok: false, status: 403, body: INVALID_TOKEN };
  if (!hasScope(grant.scopes, 'guilds.join')) {
    return { ok: false, status: 403, body: { code: 50026, message: 'Missing required OAuth2 scope' } };
  }
  return { ok: true, userId: grant.userId, applicationId: grant.applicationId, scopes: grant.scopes };
}
