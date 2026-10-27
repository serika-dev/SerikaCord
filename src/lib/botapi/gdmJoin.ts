/**
 * The OAuth2 check behind Discord's `PUT /channels/{channel_id}/recipients/{user_id}`
 * (Group DM Add Recipient): `access_token` must be a live token that user
 * granted with the `gdm.join` scope to the calling bot's own application.
 * Same shape as guilds.join (src/lib/oauth/guildsJoin.ts): 50025 for a bad,
 * expired, foreign or other user's token, 50026 when the scope is missing.
 */
import { hasScope } from '@/lib/oauth/scopes';

export type GdmJoinGrant =
  | { ok: true; userId: string }
  | { ok: false; status: number; body: { code: number; message: string } };

const INVALID_TOKEN = { code: 50025, message: 'Invalid OAuth2 access token' };

/** Pure part: does `grant` let the app add `userId` to a group DM? */
export function checkGdmJoinGrant(
  grant: { applicationId: string; userId: string; scopes: string[] } | null,
  userId: string,
  applicationId: string,
): GdmJoinGrant {
  if (!grant) return { ok: false, status: 403, body: INVALID_TOKEN };
  if (!applicationId || grant.applicationId.toLowerCase() !== applicationId.toLowerCase()) return { ok: false, status: 403, body: INVALID_TOKEN };
  if (grant.userId.toLowerCase() !== String(userId).toLowerCase()) return { ok: false, status: 403, body: INVALID_TOKEN };
  if (!hasScope(grant.scopes, 'gdm.join')) return { ok: false, status: 403, body: { code: 50026, message: 'Missing required OAuth2 scope' } };
  return { ok: true, userId: grant.userId };
}

export async function resolveGdmJoinGrant(accessToken: unknown, userId: string, applicationId: string): Promise<GdmJoinGrant> {
  if (typeof accessToken !== 'string' || !accessToken.trim()) {
    return {
      ok: false,
      status: 400,
      body: { code: 50035, message: 'Invalid Form Body', errors: { access_token: { _errors: [{ code: 'BASE_TYPE_REQUIRED', message: 'This field is required' }] } } } as unknown as { code: number; message: string },
    };
  }
  const token = accessToken.trim().replace(/^Bearer\s+/i, '');
  const { resolveBearerToken } = await import('@/lib/services/oauth2Tokens');
  const grant = await resolveBearerToken(token).catch(() => null);
  return checkGdmJoinGrant(grant, userId, applicationId);
}
