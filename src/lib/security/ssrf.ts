/**
 * SSRF guard for server-side fetches of user-supplied URLs (link previews,
 * media proxy).
 *
 * - Only http:/https: on default or common web ports, no embedded credentials.
 * - The hostname is resolved and every returned address must be public
 *   (no loopback, RFC1918, CGNAT, link-local, ULA, multicast, reserved, or
 *   IPv4-mapped/embedded forms of those).
 * - Redirects are followed manually (max 3 hops) and every hop is re-checked.
 *
 * Residual risk: a DNS-rebinding window remains between our lookup and the
 * connection fetch() opens. Closing it fully needs connection pinning or an
 * egress proxy that refuses private ranges.
 *
 * The address/URL checks are pure so they can be unit tested without network.
 */
import { isIP } from 'node:net';
import { promises as dns } from 'node:dns';

export class UnsafeUrlError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'UnsafeUrlError';
  }
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443']);
const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.home.arpa'];

/** Parse a strict dotted-quad IPv4 string into four octets. */
export function parseIPv4(addr: string): number[] | null {
  const parts = addr.split('.');
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    out.push(n);
  }
  return out;
}

/** True when an IPv4 address is not a routable public unicast address. */
export function isBlockedIPv4(o: number[]): boolean {
  const [a, b, c] = o;
  if (a === 0) return true;                               // 0.0.0.0/8
  if (a === 10) return true;                              // 10/8
  if (a === 100 && b >= 64 && b <= 127) return true;      // 100.64/10 CGNAT
  if (a === 127) return true;                             // loopback
  if (a === 169 && b === 254) return true;                // link-local / metadata
  if (a === 172 && b >= 16 && b <= 31) return true;       // 172.16/12
  if (a === 192 && b === 0 && c === 0) return true;       // 192.0.0/24 IETF
  if (a === 192 && b === 0 && c === 2) return true;       // TEST-NET-1
  if (a === 192 && b === 168) return true;                // 192.168/16
  if (a === 198 && (b === 18 || b === 19)) return true;   // 198.18/15 benchmark
  if (a === 198 && b === 51 && c === 100) return true;    // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true;     // TEST-NET-3
  if (a >= 224) return true;                              // multicast + reserved + broadcast
  return false;
}

/** Expand an IPv6 string (optionally with trailing dotted IPv4) to 8 16-bit groups. */
export function expandIPv6(addr: string): number[] | null {
  let s = addr.toLowerCase();
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  const zone = s.indexOf('%');
  if (zone !== -1) s = s.slice(0, zone);

  // Trailing embedded IPv4 (e.g. ::ffff:127.0.0.1)
  let tail: number[] = [];
  const lastColon = s.lastIndexOf(':');
  if (lastColon !== -1 && s.slice(lastColon + 1).includes('.')) {
    const v4 = parseIPv4(s.slice(lastColon + 1));
    if (!v4) return null;
    tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
    s = s.slice(0, lastColon + 1) + '0';
    // Replace the placeholder "0" group below by dropping it.
    s = s.slice(0, -1);
    if (s.endsWith(':') && !s.endsWith('::')) s = s.slice(0, -1);
  }

  const halves = s.split('::');
  if (halves.length > 2) return null;
  const parseGroups = (part: string): number[] | null => {
    if (part === '') return [];
    const groups = part.split(':');
    const out: number[] = [];
    for (const g of groups) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const head = parseGroups(halves[0]);
  if (!head) return null;
  const want = 8 - tail.length;
  if (halves.length === 2) {
    const rest = parseGroups(halves[1]);
    if (!rest) return null;
    const fill = want - head.length - rest.length;
    if (fill < 0) return null;
    return [...head, ...new Array(fill).fill(0), ...rest, ...tail];
  }
  if (head.length !== want) return null;
  return [...head, ...tail];
}

function embeddedV4(g: number[], hi: number, lo: number): number[] {
  return [g[hi] >> 8, g[hi] & 0xff, g[lo] >> 8, g[lo] & 0xff];
}

/** True when an IPv6 address is not a routable public unicast address. */
export function isBlockedIPv6(addr: string): boolean {
  const g = expandIPv6(addr);
  if (!g) return true; // unparseable: refuse
  const first6Zero = g.slice(0, 6).every((x) => x === 0);
  if (first6Zero) {
    // :: (unspecified), ::1 (loopback), and deprecated IPv4-compatible ::a.b.c.d
    if (g[6] === 0 && (g[7] === 0 || g[7] === 1)) return true;
    return isBlockedIPv4(embeddedV4(g, 6, 7));
  }
  // IPv4-mapped ::ffff:a.b.c.d
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return isBlockedIPv4(embeddedV4(g, 6, 7));
  // IPv4-translated ::ffff:0:a.b.c.d
  if (g.slice(0, 4).every((x) => x === 0) && g[4] === 0xffff && g[5] === 0) return isBlockedIPv4(embeddedV4(g, 6, 7));
  // NAT64 64:ff9b::/96 and 64:ff9b:1::/48
  if (g[0] === 0x64 && g[1] === 0xff9b) return true;
  // 6to4 2002::/16 embeds an IPv4 in groups 1-2
  if (g[0] === 0x2002) return isBlockedIPv4(embeddedV4(g, 1, 2));
  // Teredo 2001:0::/32, documentation 2001:db8::/32
  if (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0xdb8)) return true;
  // Discard-only 100::/64
  if (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true;
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

/** True when an IP literal (v4 or v6) must not be fetched. Non-IPs return true. */
export function isBlockedAddress(addr: string): boolean {
  const bare = addr.startsWith('[') && addr.endsWith(']') ? addr.slice(1, -1) : addr;
  const kind = isIP(bare);
  if (kind === 4) {
    const o = parseIPv4(bare);
    return !o || isBlockedIPv4(o);
  }
  if (kind === 6) return isBlockedIPv6(bare);
  return true;
}

/**
 * Synchronous shape check for a URL (scheme, credentials, port, obviously
 * internal hostnames and IP literals). Returns the parsed URL.
 */
export function checkUrlShape(input: string | URL): URL {
  let u: URL;
  try {
    u = typeof input === 'string' ? new URL(input) : input;
  } catch {
    throw new UnsafeUrlError('Invalid URL');
  }
  if (!ALLOWED_PROTOCOLS.has(u.protocol)) throw new UnsafeUrlError('Unsupported protocol');
  if (u.username || u.password) throw new UnsafeUrlError('Credentials in URL');
  if (!ALLOWED_PORTS.has(u.port)) throw new UnsafeUrlError('Port not allowed');

  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) throw new UnsafeUrlError('Missing host');
  if (host === 'localhost' || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new UnsafeUrlError('Internal host');
  }
  const bare = host.startsWith('[') ? host.slice(1, -1) : host;
  if (isIP(bare) && isBlockedAddress(bare)) throw new UnsafeUrlError('Private address');
  return u;
}

/** Shape check + DNS resolution; throws UnsafeUrlError if any address is private. */
export async function assertPublicUrl(input: string | URL): Promise<URL> {
  const u = checkUrlShape(input);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return u; // literal already vetted by checkUrlShape

  let addrs: { address: string }[];
  try {
    addrs = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new UnsafeUrlError('DNS lookup failed');
  }
  if (!addrs.length) throw new UnsafeUrlError('DNS lookup failed');
  for (const a of addrs) {
    if (isBlockedAddress(a.address)) throw new UnsafeUrlError('Private address');
  }
  return u;
}

export interface SafeFetchOptions {
  /** Max redirect hops to follow (each one re-validated). Default 3. */
  maxRedirects?: number;
  /** Extra per-hop host check (e.g. a strict allowlist). */
  allowHost?: (hostname: string) => boolean;
}

/**
 * fetch() for untrusted URLs: validates the target, follows redirects
 * manually and re-validates every hop. Throws UnsafeUrlError on a blocked
 * target or too many redirects; other fetch errors propagate as-is.
 */
export async function safeFetch(
  input: string,
  init: RequestInit = {},
  opts: SafeFetchOptions = {},
): Promise<Response> {
  const maxRedirects = opts.maxRedirects ?? 3;
  let current = input;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const u = await assertPublicUrl(current);
    if (opts.allowHost && !opts.allowHost(u.hostname.toLowerCase())) {
      throw new UnsafeUrlError('Host not allowed');
    }
    const res = await fetch(u.toString(), { ...init, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      try { await res.body?.cancel(); } catch { /* ignore */ }
      if (!loc) return res;
      current = new URL(loc, u).toString();
      continue;
    }
    return res;
  }
  throw new UnsafeUrlError('Too many redirects');
}
