/**
 * The RS256 key that signs OpenID Connect id_tokens (POST /oauth2/token with
 * the `openid` scope) and is published at GET /oauth2/keys.
 *
 * Where the key comes from, in order:
 *  1. `OIDC_SIGNING_KEY`: an RSA private key PEM (PKCS#8 or PKCS#1; `\n`
 *     escapes allowed). Recommended for production: it never changes unless
 *     the operator rotates it.
 *  2. Otherwise one key is generated on first use and shared by every
 *     instance through Redis (`oauth2:oidc:signing-key`, SET NX so all
 *     instances agree), encrypted at rest with the storage encryption key.
 *     If Redis loses it a new key is generated; id_tokens are verified right
 *     after login, so that only affects tokens issued before the loss.
 *  3. No env key and no Redis: no id_token is issued and the JWKS is empty.
 */
import { createPrivateKey, createPublicKey, generateKeyPair, type KeyObject } from 'crypto';
import { promisify } from 'util';
import { getRedis } from '@/lib/db/redis';
import { processShared } from '@/lib/realtime/processShared';
import { publicJwk, rsaThumbprint } from '@/lib/oauth/oidc';

export interface OidcSigningKey { privateKey: KeyObject; publicKey: KeyObject; kid: string }

const REDIS_KEY = 'oauth2:oidc:signing-key';
const RETRY_MS = 60_000;
/** A Redis-shared key is re-read this often, so instances converge after a regeneration. */
const SHARED_TTL_MS = 10 * 60_000;

const state = processShared('oidcSigningKey', () => ({
  key: null as OidcSigningKey | null,
  loadedAt: 0,
  fromEnv: false,
  pending: null as Promise<OidcSigningKey | null> | null,
  failedAt: 0,
}));

function fromPem(pem: string): OidcSigningKey {
  const privateKey = createPrivateKey(pem.replace(/\\n/g, '\n'));
  if (privateKey.asymmetricKeyType !== 'rsa') throw new Error('OIDC signing key must be an RSA key');
  const publicKey = createPublicKey(privateKey);
  return { privateKey, publicKey, kid: rsaThumbprint(publicKey) };
}

async function loadOrCreateShared(): Promise<OidcSigningKey | null> {
  const redis = getRedis();
  if (!redis) return null;
  const { encryptForStorage, decryptFromStorage } = await import('@/lib/security');
  const existing = await redis.get(REDIS_KEY);
  if (existing) return fromPem(await decryptFromStorage(existing));
  const { privateKey } = await promisify(generateKeyPair)('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  // Another instance may have won the race: whatever is stored now is the key.
  await redis.set(REDIS_KEY, await encryptForStorage(pem), 'NX');
  const stored = await redis.get(REDIS_KEY);
  return stored ? fromPem(await decryptFromStorage(stored)) : null;
}

/** The current signing key, or null when none can be had (see the file header). */
export async function getOidcSigningKey(): Promise<OidcSigningKey | null> {
  if (state.key && (state.fromEnv || Date.now() - state.loadedAt < SHARED_TTL_MS)) return state.key;
  const env = process.env.OIDC_SIGNING_KEY;
  if (env) {
    try {
      state.key = fromPem(env);
      state.fromEnv = true;
      return state.key;
    } catch (err) {
      console.error('[oidc] OIDC_SIGNING_KEY is not a usable RSA private key:', (err as Error)?.message ?? err);
      return null;
    }
  }
  if (state.pending) return state.pending;
  if (!state.key && Date.now() - state.failedAt < RETRY_MS) return null;
  state.pending = loadOrCreateShared()
    .then((k) => {
      if (k) { state.key = k; state.loadedAt = Date.now(); } else state.failedAt = Date.now();
      return k ?? state.key;
    })
    .catch((err) => {
      console.error('[oidc] signing key unavailable:', (err as Error)?.message ?? err);
      state.failedAt = Date.now();
      return state.key;
    })
    .finally(() => { state.pending = null; });
  return state.pending;
}

/** GET /oauth2/keys: the JSON Web Key Set (Discord's shape: `{ keys: [...] }`). */
export async function getJwks(): Promise<{ keys: Array<ReturnType<typeof publicJwk>> }> {
  const key = await getOidcSigningKey();
  return { keys: key ? [publicJwk(key.publicKey, key.kid)] : [] };
}

/** `iss` of our id_tokens. */
export function oidcIssuer(): string {
  const raw = process.env.OIDC_ISSUER || process.env.FRONTEND_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://serika.chat';
  return raw.replace(/\/+$/, '');
}
