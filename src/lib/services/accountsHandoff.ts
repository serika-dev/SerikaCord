/**
 * Serika Accounts sign-in hand-off, server side (pure helpers; the Elysia
 * routes in src/lib/api/auth.ts do the I/O).
 *
 * Flow (docs/architecture/security.md, "Passkey sign-in"):
 *   1. GET /api/auth/accounts/start: random `state`, PKCE verifier + S256
 *      challenge and a random flow id. `{ state, verifier, next, redirectUri }`
 *      is stored in Redis under the flow id (10 min); the browser only gets the
 *      flow id in an HttpOnly cookie scoped to /api/auth/accounts, then is sent
 *      to accounts /api/auth/handoff/start.
 *   2. Accounts signs the user in on its own origin (passkey, or password +
 *      2FA) and redirects to the registered callback with `code` + `state`.
 *   3. GET /api/auth/accounts/callback: the flow is consumed atomically, the
 *      state compared in constant time, and the code redeemed server-to-server
 *      at POST /internal/auth/exchange-code with the verifier and service key.
 *
 * Never log codes, verifiers, states or tokens.
 */
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { HANDOFF_CALLBACK_PATH, type HandoffErrorCode } from '../accountsHandoff';

export const HANDOFF_PRODUCT_ID = 'serikacord';
export const HANDOFF_COOKIE = 'serika_handoff';
export const HANDOFF_COOKIE_PATH = '/api/auth/accounts';
/** How long a started flow (and its cookie) stays valid. Accounts codes live 2 minutes. */
export const HANDOFF_TTL_SECONDS = 600;
export const HANDOFF_REDIS_PREFIX = 'accounts-handoff:';

export interface HandoffFlow {
  state: string;
  verifier: string;
  next: string;
  redirectUri: string;
  createdAt: number;
}

/** base64url of `bytes` random bytes. */
export function randomUrlSafe(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

/** RFC 7636 S256 code challenge. */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'utf8').digest('base64url');
}

/** A fresh verifier (43 chars, 256 bits) and its S256 challenge. */
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomUrlSafe(32);
  return { verifier, challenge: pkceChallenge(verifier) };
}

/** Same charset/length rule as Serika Accounts (RFC 7636 unreserved, 43-128). */
export function isValidPkceVerifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._~-]{43,128}$/.test(value);
}

/** Our states are base64url (43 chars); accept a small range, nothing else. */
export function isValidHandoffState(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(value);
}

/** Accounts codes are 64 hex chars; accept url-safe 16-128 like the exchange endpoint. */
export function isValidHandoffCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value);
}

/** Flow ids are 32 random bytes as hex. */
export function isValidFlowId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

export function newFlowId(): string {
  return randomBytes(32).toString('hex');
}

/** Constant-time string comparison (false on any length/type mismatch). */
export function secureEquals(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length || ab.length === 0) return false;
  return timingSafeEqual(ab, bb);
}

/** Parse a stored flow (from Redis JSON); null unless every field is well-formed. */
export function parseHandoffFlow(raw: unknown): HandoffFlow | null {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (!isValidHandoffState(v.state) || !isValidPkceVerifier(v.verifier)) return null;
  if (typeof v.next !== 'string' || typeof v.redirectUri !== 'string') return null;
  return {
    state: v.state,
    verifier: v.verifier,
    next: v.next,
    redirectUri: v.redirectUri,
    createdAt: typeof v.createdAt === 'number' ? v.createdAt : 0,
  };
}

/** Value of one cookie from a raw Cookie header (first match). */
export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

export function handoffCookie(flowId: string): string {
  return `${HANDOFF_COOKIE}=${flowId}; HttpOnly; Secure; SameSite=Lax; Path=${HANDOFF_COOKIE_PATH}; Max-Age=${HANDOFF_TTL_SECONDS}`;
}

export const CLEAR_HANDOFF_COOKIE = `${HANDOFF_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=${HANDOFF_COOKIE_PATH}; Max-Age=0`;

function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.localhost');
}

/**
 * The callback URL registered with Serika Accounts (HANDOFF_CLIENTS there).
 * Order: explicit ACCOUNTS_HANDOFF_CALLBACK_URL; the request's own origin for
 * loopback dev (non-production only); FRONTEND_URL; https://serika.chat.
 */
export function resolveHandoffCallbackUrl(opts: {
  explicit?: string;
  frontendUrl?: string;
  requestOrigin?: string;
  production: boolean;
}): string {
  const fromBase = (base: string) => `${base.replace(/\/+$/, '')}${HANDOFF_CALLBACK_PATH}`;
  const explicit = opts.explicit?.trim();
  if (explicit) {
    try {
      const url = new URL(explicit);
      if (url.protocol === 'https:' || (!opts.production && isLoopbackHost(url.hostname))) return url.toString();
    } catch {
      /* fall through */
    }
  }
  if (!opts.production && opts.requestOrigin) {
    try {
      const url = new URL(opts.requestOrigin);
      if (isLoopbackHost(url.hostname)) return fromBase(url.origin);
    } catch {
      /* fall through */
    }
  }
  const frontend = opts.frontendUrl?.trim();
  if (frontend) {
    try {
      const url = new URL(frontend);
      if (url.protocol === 'https:') return fromBase(url.origin);
    } catch {
      /* fall through */
    }
  }
  return fromBase('https://serika.chat');
}

/** URL of accounts' GET /api/auth/handoff/start for this flow. */
export function buildHandoffStartUrl(opts: {
  accountsBase: string;
  redirectUri: string;
  state: string;
  challenge: string;
  passkey: boolean;
}): string {
  const url = new URL('/api/auth/handoff/start', opts.accountsBase);
  url.searchParams.set('product', HANDOFF_PRODUCT_ID);
  url.searchParams.set('return', opts.redirectUri);
  url.searchParams.set('state', opts.state);
  url.searchParams.set('code_challenge', opts.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (opts.passkey) url.searchParams.set('passkey', '1');
  return url.toString();
}

/**
 * Map an exchange-code result to the login page error code, or null when it
 * is a usable sign-in. Accounts answers 200 + `success: false` for bad codes,
 * and the accounts client normalizes network failures to 503.
 */
export function mapExchangeResult(result: {
  ok: boolean;
  status: number;
  data: { success?: boolean; token?: unknown; code?: unknown; error?: unknown } | null | undefined;
}): HandoffErrorCode | null {
  const data = result.data || {};
  if (result.ok && data.success === true && typeof data.token === 'string' && data.token) return null;
  if (data.code === 'AGE_RESTRICTION') return 'passkey_age';
  if (result.status === 429 || result.status >= 500) return 'passkey_unavailable';
  if (data.error === 'Invalid or expired code') return 'passkey_expired';
  return 'passkey_failed';
}

/** Known accounts login error codes passed through to the SerikaCord client. */
export function passThroughLoginCode(code: unknown): string | undefined {
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,47}$/.test(code) ? code : undefined;
}
