// CSP violation reports (report-only rollout of the Content-Security-Policy in
// next.config.ts), mounted at /api.
//
//   POST /csp-report          browsers (no auth); counts directive + blocked host per day
//   GET  /admin/csp-reports   staff (logs.view): the last 7 days, most frequent first
import { Elysia } from 'elysia';
import { getRedis } from '@/lib/db/redis';
import { checkRateLimit, getClientIP } from '@/lib/security';
import { parseCspReports } from '@/lib/security/cspReport';
import { getStaffAuth } from '@/lib/services/staffAuth';

const KEEP_DAYS = 14;
const MAX_BODY = 64 * 1024;
const MAX_FIELDS_PER_DAY = 1000;
const dayKey = (d: Date) => `csp:violations:${d.toISOString().slice(0, 10)}`;

export const cspReportRoutes = new Elysia()
  .post('/csp-report', async ({ request, set }) => {
    set.status = 204;
    const limit = await checkRateLimit('cspReport', getClientIP(request));
    if (!limit.success) return;
    const text = (await request.text().catch(() => '')).slice(0, MAX_BODY);
    let body: unknown = null;
    try { body = JSON.parse(text); } catch { return; }
    const violations = parseCspReports(body);
    const redis = getRedis();
    if (!redis || violations.length === 0) return;
    const key = dayKey(new Date());
    // A day's distinct directive|host pairs stay bounded (reports are unauthenticated).
    const fields = await redis.hlen(key).catch(() => MAX_FIELDS_PER_DAY);
    if (fields >= MAX_FIELDS_PER_DAY) return;
    const multi = redis.multi();
    for (const v of violations) multi.hincrby(key, `${v.directive}|${v.blocked}`, 1);
    multi.expire(key, KEEP_DAYS * 24 * 3600);
    await multi.exec().catch(() => {});
  }, { parse: 'none' })
  .get('/admin/csp-reports', async ({ headers, cookie, set }) => {
    const { user, isAdmin, status, error } = await getStaffAuth(headers, cookie as Record<string, { value?: unknown }>, 'logs.view');
    if (!user || !isAdmin) { set.status = status; return { error: error || 'Admin access required' }; }
    const redis = getRedis();
    if (!redis) return { violations: [] };
    const totals = new Map<string, number>();
    for (let i = 0; i < 7; i++) {
      const rows = await redis.hgetall(dayKey(new Date(Date.now() - i * 86_400_000))).catch(() => ({} as Record<string, string>));
      for (const [k, n] of Object.entries(rows)) totals.set(k, (totals.get(k) ?? 0) + (Number(n) || 0));
    }
    return {
      violations: [...totals]
        .map(([k, count]) => { const [directive, blocked] = k.split('|'); return { directive, blocked, count }; })
        .sort((a, b) => b.count - a.count)
        .slice(0, 200),
    };
  });
