/**
 * Choosing a GIF as an avatar / banner / icon: which GIFs the server will
 * fetch for the client (pure, tested in tests/recent-media.test.ts).
 *
 * The client never hotlinks a GIF as a profile image. It asks
 * POST /api/gifs/import for the bytes (fetched server-side, SSRF-guarded,
 * size-capped) and then sends them through the normal crop + upload path,
 * which type-checks them and runs the Trust & Safety scan before storing
 * them on our CDN.
 *
 * - by slug: looked up on the Serika GIF API, whose answer is trusted for
 *   the media URL (still only public addresses, see safeFetch);
 * - by URL (GIF favorites only keep the URL): only GIF CDNs on this list.
 */

/** Hosts (exact, or `.suffix` for subdomains) a GIF URL may be imported from. */
export const DEFAULT_GIF_MEDIA_HOSTS: readonly string[] = [
  'cdn.ado.wtf', // Serika GIFs media
  '.serika.dev',
  'media.tenor.com',
  'c.tenor.com',
  '.giphy.com',
];

const SLUG_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function isGifSlug(value: unknown): value is string {
  return typeof value === 'string' && SLUG_RE.test(value);
}

/** Extra hosts from a comma separated env value (SERIKA_GIFS_MEDIA_HOSTS). */
export function parseGifHostList(raw: string | undefined | null): string[] {
  return (raw ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => /^\.?[a-z0-9.-]+$/.test(h) && h.replace(/^\./, '').includes('.'));
}

export function hostMatches(hostname: string, allowed: readonly string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return allowed.some((entry) => (entry.startsWith('.') ? host.endsWith(entry) && host.length > entry.length : host === entry));
}

/** An https URL on an allowed GIF host, without credentials or odd ports. */
export function isImportableGifUrl(url: unknown, allowed: readonly string[] = DEFAULT_GIF_MEDIA_HOSTS): boolean {
  if (typeof url !== 'string' || url.length === 0 || url.length > 1024) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
  return hostMatches(u.hostname, allowed);
}
