/**
 * Cross-site request guard for cookie-authenticated writes. SameSite=Lax keeps
 * the session cookie off most cross-site requests; this also stops writes from
 * sibling subdomains (same-site, so Lax lets the cookie through) and browsers
 * that don't honour SameSite. Requests that authenticate with an Authorization
 * header (bots, OAuth apps) or carry no session cookie aren't affected; native
 * clients that send no Origin / Sec-Fetch-Site headers aren't either.
 */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isCrossSiteWrite(
  request: { method: string; headers: { get(name: string): string | null } },
  allowedOrigins: readonly string[],
): boolean {
  if (!WRITE_METHODS.has(request.method.toUpperCase())) return false;
  const h = request.headers;
  // Only a real token header means the cookie isn't what authenticates (auth
  // falls back to the cookie for anything else).
  if (/^(?:Bearer|Bot) \S/.test(h.get('authorization') ?? '')) return false;
  if (!/(?:^|;\s*)(?:auth_token|refresh_token)=/.test(h.get('cookie') ?? '')) return false;
  if (h.get('sec-fetch-site') === 'cross-site') return true;
  const origin = h.get('origin');
  if (!origin) return false; // same-origin GET-style forms and native clients
  if (origin === 'null') return true;
  const host = (h.get('x-forwarded-host') ?? h.get('host') ?? '').split(',')[0].trim().toLowerCase();
  if (host && (origin === `https://${host}` || origin === `http://${host}`)) return false;
  return !allowedOrigins.includes(origin);
}

/**
 * First-party app hosts whose https subdomains (canary.serika.chat,
 * www.serika.chat, ...) may make credentialed CORS calls to the API. Other
 * subdomains of allowed origins (other *.serika.dev apps, user-content hosts)
 * must be listed exactly in ALLOWED_ORIGINS.
 */
export const CORS_SUBDOMAIN_BASES: readonly string[] = ['serika.chat'];

export type CorsOriginPolicy = {
  /** Exact origins (scheme + host + port), e.g. config.ALLOWED_ORIGINS. */
  allowedOrigins: readonly string[];
  /** Hosts whose https subdomains are trusted. */
  subdomainBases: readonly string[];
  /** Hosts never trusted, even when they match a base (the CDN serves user uploads). */
  blockedHosts?: readonly string[];
  /** localhost / 127.0.0.1 / [::1] origins; off in production. */
  allowLocalhost: boolean;
};

/** Lowercased hostname of a URL, or '' when it doesn't parse. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isLocalHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost');
}

/** Whether a browser Origin may make credentialed CORS requests to the API. */
export function isAllowedCorsOrigin(origin: string, policy: CorsOriginPolicy): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false; // includes the opaque "null" origin
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  const host = url.hostname.toLowerCase();
  if (!host) return false;
  if (policy.blockedHosts?.some((h) => h && h.toLowerCase() === host)) return false;
  if (isLocalHost(host) && !policy.allowLocalhost) return false;

  for (const allowed of policy.allowedOrigins) {
    const trimmed = allowed.trim();
    if (!trimmed) continue;
    try {
      if (new URL(trimmed).origin === url.origin) return true;
    } catch {
      // ignore malformed config entries
    }
  }

  if (url.protocol !== 'https:') return false;
  return policy.subdomainBases.some((base) => {
    const b = base.trim().toLowerCase();
    return b !== '' && host.endsWith(`.${b}`);
  });
}
