import { Resolver, resolveTxt as systemResolveTxt } from 'node:dns/promises';
import { DOMAIN_TXT_HOST, txtRecordsContainToken } from '@/lib/connections/domain';

// Ask public resolvers directly so a record the user just added is seen as
// soon as the authoritative servers have it, not after a local cache expires.
const resolver = new Resolver({ timeout: 4000, tries: 2 });
resolver.setServers(['1.1.1.1', '8.8.8.8']);

const MISSING = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN', 'ENONAME']);

/** TXT records for `name`; [] when the name has none. Throws on lookup failure. */
async function lookupTxt(name: string): Promise<string[][]> {
  try {
    return await resolver.resolveTxt(name);
  } catch (err) {
    if (MISSING.has((err as { code?: string }).code ?? '')) return [];
    // Public resolvers unreachable (egress-filtered host): use the system one.
    try {
      return await systemResolveTxt(name);
    } catch (err2) {
      if (MISSING.has((err2 as { code?: string }).code ?? '')) return [];
      throw err2;
    }
  }
}

/**
 * Checks `_serika.<domain>` and `<domain>` for `serika-verification=<token>`.
 * `error` is set when DNS could not be queried at all (not when the record is missing).
 */
export async function checkDomainOwnership(domain: string, token: string): Promise<{ ok: boolean; error?: 'dns_error' }> {
  const results = await Promise.allSettled([
    lookupTxt(`${DOMAIN_TXT_HOST}.${domain}`),
    lookupTxt(domain),
  ]);
  for (const r of results) {
    if (r.status === 'fulfilled' && txtRecordsContainToken(r.value, token)) return { ok: true };
  }
  if (results.every((r) => r.status === 'rejected')) return { ok: false, error: 'dns_error' };
  return { ok: false };
}
