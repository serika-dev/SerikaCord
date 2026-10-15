/**
 * IP minimization for long-lived storage. Rate limits use the full address in
 * short-lived Redis keys; anything kept for days (device lists, sessions)
 * stores only the network part: IPv4 /24, IPv6 /48. Enough for "a new device
 * signed in from roughly here", not enough to single out a household.
 */
import { isIP } from 'node:net';

function stripPort(raw: string): string {
  const v = raw.trim();
  // [v6]:port
  const bracket = /^\[([^\]]+)\](?::\d+)?$/.exec(v);
  if (bracket) return bracket[1];
  // v4:port
  const v4port = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(v);
  if (v4port) return v4port[1];
  return v;
}

/**
 * Truncated form of an address for storage; null for anything that is not an
 * IP (e.g. 'unknown'). Accepts an X-Forwarded-For list and uses its first hop.
 */
export function anonymizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let ip = stripPort(String(raw).split(',')[0] ?? '');
  // IPv4-mapped IPv6 (::ffff:1.2.3.4) is really IPv4.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) ip = mapped[1];
  const zone = ip.indexOf('%');
  if (zone !== -1) ip = ip.slice(0, zone);
  const kind = isIP(ip);
  if (kind === 4) {
    const parts = ip.split('.');
    return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
  }
  if (kind === 6) {
    const [head, tail] = ip.toLowerCase().split('::');
    const headParts = head ? head.split(':') : [];
    const tailParts = tail !== undefined && tail ? tail.split(':') : [];
    const missing = 8 - headParts.length - tailParts.length;
    const full = tail !== undefined
      ? [...headParts, ...Array(Math.max(0, missing)).fill('0'), ...tailParts]
      : headParts;
    const prefix = full.slice(0, 3).map((g) => (g || '0').replace(/^0+(?=.)/, ''));
    return `${prefix.join(':')}::`;
  }
  return null;
}
