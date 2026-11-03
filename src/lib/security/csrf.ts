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
