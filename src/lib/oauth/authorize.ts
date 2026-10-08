/**
 * Pure helpers for the OAuth2 authorize flow (`/api/oauth2/authorize` and the
 * `/oauth2/authorize` consent page). No DB or network access, so they can be
 * shared by server and client and unit tested.
 */
import { ALL_PERMISSIONS, PERMISSION_BITS } from '@/lib/permissions/bits';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * True when `uri` is an absolute URL we are willing to navigate a user to:
 * `https:` anywhere, or `http:` only on a loopback host (local development).
 * Rejects `javascript:`, `data:`, custom schemes and relative/garbage input.
 */
export function isSafeRedirectUrl(uri: string | null | undefined): boolean {
  if (!uri || typeof uri !== 'string') return false;
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }
  if (parsed.protocol === 'https:') return true;
  if (parsed.protocol === 'http:') return LOCAL_HOSTS.has(parsed.hostname.toLowerCase());
  return false;
}

export type RedirectResolution =
  | { ok: true; uri: string | null }
  | { ok: false; error: 'invalid_redirect_uri' };

/**
 * Resolve the redirect URI for an authorize request against the app's
 * registered list.
 * - `requested` given: it must exactly equal a registered URI and be safe.
 * - `requested` missing: default to the only registered URI when there is
 *   exactly one; otherwise there is no redirect (`uri: null`), which is the
 *   normal "add bot" flow that just shows a success screen.
 */
export function resolveRedirectUri(
  requested: string | null | undefined,
  registered: readonly string[] | null | undefined,
): RedirectResolution {
  const list = (registered || []).filter((u): u is string => typeof u === 'string' && u.length > 0);
  if (requested) {
    if (!list.includes(requested) || !isSafeRedirectUrl(requested)) {
      return { ok: false, error: 'invalid_redirect_uri' };
    }
    return { ok: true, uri: requested };
  }
  if (list.length === 1 && isSafeRedirectUrl(list[0])) {
    return { ok: true, uri: list[0] };
  }
  return { ok: true, uri: null };
}

/** Append query params to a URL that may already have a query string. */
export function appendQuery(uri: string, params: Record<string, string>): string {
  const url = new URL(uri);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

/**
 * Parse the `permissions` integer string an authorize request carries.
 * Returns null for anything that is not a non-negative integer.
 */
export function parsePermissionsParam(raw: unknown): bigint | null {
  if (raw === undefined || raw === null || raw === '') return 0n;
  const str = String(raw).trim();
  if (!/^\d{1,40}$/.test(str)) return null;
  try {
    return BigInt(str) & ALL_PERMISSIONS;
  } catch {
    return null;
  }
}

/**
 * Compute the permission bits a newly added bot's managed role may carry.
 * The server owner and ADMINISTRATOR members can grant anything; everyone
 * else can only grant bits they hold themselves (Discord's rule).
 */
export function clampBotPermissions(requested: bigint, callerPerms: bigint, callerIsOwner: boolean): bigint {
  if (callerIsOwner) return requested;
  if ((callerPerms & PERMISSION_BITS.ADMINISTRATOR) !== 0n) return requested;
  return requested & callerPerms;
}
