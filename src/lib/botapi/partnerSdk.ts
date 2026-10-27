/**
 * Discord Social SDK partner endpoints (provisional accounts). SerikaCord has
 * no provisional (game-only) accounts: every account is a real Serika account
 * from serika-accounts. So the token / unmerge endpoints validate the request
 * like Discord does and then answer Discord's own "not enabled" error
 * (530000) for every application. Pure, no I/O; unit tested in
 * tests/socialparity-partner-sdk.test.ts.
 */
import { FormErrors, FE } from './formErrors';

/** Discord: "Your Discord application has not been granted the permission to use provisional accounts." */
export const PROVISIONAL_ACCOUNTS_NOT_ENABLED = {
  code: 530000,
  message: 'Your application has not been granted the permission to use provisional accounts.',
} as const;
/** Discord: "Your client secret is invalid." */
export const INVALID_CLIENT_SECRET = {
  code: 530007,
  message: 'Your client secret is invalid. Double check what you are sending or regenerate your client secret.',
} as const;

/** `external_auth_type` values Discord documents for the token exchange. */
export const EXTERNAL_AUTH_TYPES = [
  'OIDC',
  'EPIC_ONLINE_SERVICES_ACCESS_TOKEN',
  'EPIC_ONLINE_SERVICES_ID_TOKEN',
  'STEAM_SESSION_TICKET',
  'UNITY_SERVICES_ID_TOKEN',
  'DISCORD_BOT_ISSUED_ACCESS_TOKEN',
  'APPLE_ID_TOKEN',
  'PLAYSTATION_NETWORK_ID_TOKEN',
] as const;

function str(raw: unknown, key: string, errors: FormErrors, opts: { required?: boolean; max: number }): string | undefined {
  if (raw === undefined || raw === null || raw === '') {
    if (opts.required) errors.add([key], FE.REQUIRED, 'This field is required');
    return undefined;
  }
  if (typeof raw !== 'string' && typeof raw !== 'number') { errors.add([key], FE.BAD_TYPE, 'Could not interpret value as string.'); return undefined; }
  const s = String(raw);
  if (s.length > opts.max) { errors.add([key], FE.MAX_LENGTH, `Must be ${opts.max} or fewer in length.`); return undefined; }
  return s;
}

export interface TokenExchangeInput {
  clientId: string;
  clientSecret: string;
  externalAuthType: string;
  externalAuthToken: string;
}

/** POST /partner-sdk/token and /partner-sdk/provisional-accounts/unmerge bodies. */
export function parseTokenExchange(body: unknown): { ok: true; value: TokenExchangeInput } | { ok: false; errors: FormErrors } {
  const errors = new FormErrors();
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const { client_id, client_secret, external_auth_type, external_auth_token } = b;
  const clientId = str(client_id, 'client_id', errors, { required: true, max: 128 });
  const clientSecret = str(client_secret, 'client_secret', errors, { required: true, max: 256 });
  const type = str(external_auth_type, 'external_auth_type', errors, { required: true, max: 64 });
  if (type !== undefined && !(EXTERNAL_AUTH_TYPES as readonly string[]).includes(type)) {
    errors.add(['external_auth_type'], FE.CHOICES, `Value must be one of {${EXTERNAL_AUTH_TYPES.map((t) => `'${t}'`).join(', ')}}.`);
  }
  const token = str(external_auth_token, 'external_auth_token', errors, { required: true, max: 8192 });
  if (!errors.ok) return { ok: false, errors };
  return { ok: true, value: { clientId: clientId!, clientSecret: clientSecret!, externalAuthType: type!, externalAuthToken: token! } };
}

/** POST /partner-sdk/token/bot and /partner-sdk/provisional-accounts/unmerge/bot bodies. */
export function parseBotTokenRequest(body: unknown, opts: { unmerge?: boolean } = {}): { ok: true; externalUserId: string } | { ok: false; errors: FormErrors } {
  const errors = new FormErrors();
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const { external_user_id, preferred_global_name, provisional_user_id } = b;
  const externalUserId = str(external_user_id, 'external_user_id', errors, { required: true, max: 256 });
  if (!opts.unmerge) {
    str(preferred_global_name, 'preferred_global_name', errors, { max: 32 });
    str(provisional_user_id, 'provisional_user_id', errors, { max: 64 });
  }
  return errors.ok ? { ok: true, externalUserId: externalUserId! } : { ok: false, errors };
}
