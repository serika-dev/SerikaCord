import { Resolver, resolveTxt as systemResolveTxt } from 'node:dns/promises';
import { DOMAIN_TXT_HOST, DOMAIN_TXT_PREFIX, txtRecordsContainToken } from '@/lib/connections/domain';

// Public resolvers, used to find a zone's nameservers and as a fallback.
const resolver = new Resolver({ timeout: 4000, tries: 2 });
resolver.setServers(['1.1.1.1', '8.8.8.8']);

const MISSING = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN', 'ENONAME']);

const isMissing = (err: unknown) => MISSING.has((err as { code?: string }).code ?? '');

/** TXT records for `name` via public resolvers; [] when the name has none. Throws on lookup failure. */
async function lookupTxtPublic(name: string): Promise<string[][]> {
  try {
    return await resolver.resolveTxt(name);
  } catch (err) {
    if (isMissing(err)) return [];
    // Public resolvers unreachable (egress-filtered host): use the system one.
    try {
      return await systemResolveTxt(name);
    } catch (err2) {
      if (isMissing(err2)) return [];
      throw err2;
    }
  }
}

/**
 * Nameserver IPs for the zone `domain` belongs to (walks up to the closest
 * name with NS records), or [] when they can't be found.
 */
async function zoneNameserverIps(domain: string): Promise<string[]> {
  const labels = domain.split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    const zone = labels.slice(i).join('.');
    let hosts: string[] = [];
    try {
      hosts = await resolver.resolveNs(zone);
    } catch {
      continue;
    }
    if (hosts.length === 0) continue;
    const ips = await Promise.all(
      hosts.slice(0, 4).map((h) => resolver.resolve4(h).catch(() => [] as string[])),
    );
    return [...new Set(ips.flat())].slice(0, 4);
  }
  return [];
}

/**
 * TXT records for `name` straight from the zone's authoritative nameservers.
 * Public resolvers cache "no such record" (negative caching) for up to the
 * zone's SOA minimum, so a user who clicked Check before adding the record
 * would otherwise keep seeing "not found" for a long while.
 */
async function lookupTxtAuthoritative(name: string, nameservers: string[]): Promise<string[][]> {
  if (nameservers.length === 0) throw new Error('no nameservers');
  const auth = new Resolver({ timeout: 3000, tries: 1 });
  auth.setServers(nameservers);
  try {
    return await auth.resolveTxt(name);
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
}

/** `serika-verification=` values present in the records (for "wrong code" feedback). */
function verificationValues(results: PromiseSettledResult<string[][]>[]): string[] {
  const out = new Set<string>();
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const chunks of r.value) {
      const v = chunks.join('').trim().replace(/^"|"$/g, '').trim();
      if (v.startsWith(DOMAIN_TXT_PREFIX)) out.add(v.slice(0, 120));
    }
  }
  return [...out].slice(0, 5);
}

/**
 * Checks `_serika.<domain>` and `<domain>` for `serika-verification=<token>`,
 * asking the domain's own nameservers first and public resolvers second.
 * `error` is set when DNS could not be queried at all (not when the record is missing);
 * `found` lists other serika-verification values seen (a stale or mistyped record).
 */
export async function checkDomainOwnership(domain: string, token: string): Promise<{ ok: boolean; error?: 'dns_error'; found?: string[] }> {
  const names = [`${DOMAIN_TXT_HOST}.${domain}`, domain];
  const nameservers = await zoneNameserverIps(domain).catch(() => [] as string[]);
  const authoritative = await Promise.allSettled(names.map((n) => lookupTxtAuthoritative(n, nameservers)));
  if (authoritative.some((r) => r.status === 'fulfilled' && txtRecordsContainToken(r.value, token))) return { ok: true };

  const pub = await Promise.allSettled(names.map((n) => lookupTxtPublic(n)));
  if (pub.some((r) => r.status === 'fulfilled' && txtRecordsContainToken(r.value, token))) return { ok: true };
  if ([...authoritative, ...pub].every((r) => r.status === 'rejected')) return { ok: false, error: 'dns_error' };
  return { ok: false, found: verificationValues([...authoritative, ...pub]) };
}
