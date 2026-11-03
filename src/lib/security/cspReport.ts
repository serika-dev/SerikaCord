/**
 * Content-Security-Policy violation reports, reduced to what's needed to tune
 * the policy before it's enforced: the directive and the host that would have
 * been blocked. No page URL, user, script sample or IP is kept.
 *
 * Browsers send either the legacy `application/csp-report` body
 * ({ "csp-report": { ... } }) or Reporting API batches
 * ([{ type: "csp-violation", body: { ... } }]).
 */
export interface CspViolation {
  directive: string;
  /** Host of the blocked resource, or a keyword: inline, eval, data, blob, wasm-eval, ... */
  blocked: string;
}

const MAX_PER_BATCH = 20;

function hostOf(value: string): string {
  if (!value) return 'unknown';
  if (/^[a-z-]+$/i.test(value)) return value.length <= 30 ? value.toLowerCase() : 'unknown'; // inline, eval, self, data, blob, ...
  try {
    const url = new URL(value);
    if (url.protocol === 'data:' || url.protocol === 'blob:') return url.protocol.slice(0, -1);
    if (/-extension:$/.test(url.protocol)) return 'extension';
    return url.host.toLowerCase().slice(0, 100) || 'unknown';
  } catch {
    return 'unknown';
  }
}

function one(raw: Record<string, unknown> | null | undefined): CspViolation | null {
  if (!raw || typeof raw !== 'object') return null;
  const directive = String(raw['effective-directive'] ?? raw.effectiveDirective ?? raw['violated-directive'] ?? raw.violatedDirective ?? '')
    .split(' ')[0].toLowerCase().slice(0, 40);
  if (!/^[a-z-]+$/.test(directive)) return null;
  const blocked = hostOf(String(raw['blocked-uri'] ?? raw.blockedURL ?? raw.blockedUri ?? ''));
  return { directive, blocked };
}

export function parseCspReports(body: unknown): CspViolation[] {
  const out: CspViolation[] = [];
  if (Array.isArray(body)) {
    for (const item of body.slice(0, MAX_PER_BATCH)) {
      const v = item && typeof item === 'object' && (item as { type?: unknown }).type === 'csp-violation'
        ? one((item as { body?: Record<string, unknown> }).body)
        : null;
      if (v) out.push(v);
    }
  } else if (body && typeof body === 'object') {
    const v = one((body as { 'csp-report'?: Record<string, unknown> })['csp-report']);
    if (v) out.push(v);
  }
  return out;
}
