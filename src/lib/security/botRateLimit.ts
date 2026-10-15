/**
 * Per-bot rate limits for the Discord-compatible bot API (/api/v10), applied
 * in src/lib/api/botApi.ts. Pure (no Redis) so the bucket rules and the
 * Discord-shaped headers/body are unit tested; the counters themselves live in
 * checkRateLimit (src/lib/security/index.ts) under the limiter names below.
 *
 * Every bot request counts against a per-bot global budget (like Discord's
 * 50 requests/second). Writes also count against a per-route bucket keyed by
 * the route's major parameter (channel / guild / webhook), modelled on
 * Discord's documented limits.
 */

export const BOT_LIMITS = {
  botGlobal: { points: 50, duration: 1 },
  botMessageSend: { points: 5, duration: 5 },
  botMessageDelete: { points: 5, duration: 1 },
  // Discord: one reaction change per 250 ms per channel.
  botReaction: { points: 4, duration: 1 },
  botBulkDelete: { points: 1, duration: 1 },
  botTyping: { points: 5, duration: 5 },
  botWrite: { points: 30, duration: 10 },
} as const;

export type BotLimiterName = keyof typeof BOT_LIMITS;

export interface BotBucket {
  limiter: BotLimiterName;
  /** Counter identifier (bot + bucket). */
  key: string;
  /** Opaque bucket id for X-RateLimit-Bucket. */
  bucket: string;
  limit: number;
}

/** Discord "major parameters": a bucket is per route template AND per value of these. */
function majorParam(params: Record<string, string | undefined> | null | undefined): string {
  const p = params ?? {};
  return p.channelId ?? p.guildId ?? p.webhookId ?? p.applicationId ?? p.appId ?? '';
}

function hashBucket(s: string): string {
  // FNV-1a, hex: stable, short, reveals nothing about ids.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * The buckets one request counts against, most specific first (the last one
 * is always the per-bot global bucket). `route` is the matched route template,
 * e.g. `/api/v10/channels/:channelId/messages`.
 */
export function botRequestBuckets(
  botId: string,
  method: string,
  route: string,
  params?: Record<string, string | undefined> | null,
): BotBucket[] {
  const m = method.toUpperCase();
  const tpl = route.replace(/^\/api/, '').replace(/^\/v\d+/, '');
  const major = majorParam(params);
  const out: BotBucket[] = [];
  const add = (limiter: BotLimiterName, name: string) => {
    const bucket = hashBucket(`${name}`);
    out.push({ limiter, key: `${botId}:${bucket}:${major}`, bucket, limit: BOT_LIMITS[limiter].points });
  };
  if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') {
    if (m === 'POST' && tpl === '/channels/:channelId/messages') add('botMessageSend', 'message-send');
    else if (tpl.includes('/reactions')) add('botReaction', 'reactions');
    else if (m === 'DELETE' && tpl === '/channels/:channelId/messages/:messageId') add('botMessageDelete', 'message-delete');
    else if (m === 'POST' && tpl === '/channels/:channelId/messages/bulk-delete') add('botBulkDelete', 'bulk-delete');
    else if (m === 'POST' && tpl === '/channels/:channelId/typing') add('botTyping', 'typing');
    else add('botWrite', `${m} ${tpl}`);
  }
  out.push({ limiter: 'botGlobal', key: botId, bucket: 'global', limit: BOT_LIMITS.botGlobal.points });
  return out;
}

/** X-RateLimit-* headers for a bucket after a request. */
export function rateLimitHeaders(opts: {
  limit: number;
  remaining: number;
  resetAfterSeconds: number;
  bucket: string;
  now?: number;
}): Record<string, string> {
  const resetAfter = Math.max(0, opts.resetAfterSeconds);
  const now = opts.now ?? Date.now();
  return {
    'X-RateLimit-Limit': String(opts.limit),
    'X-RateLimit-Remaining': String(Math.max(0, opts.remaining)),
    'X-RateLimit-Reset': ((now / 1000) + resetAfter).toFixed(3),
    'X-RateLimit-Reset-After': resetAfter.toFixed(3),
    'X-RateLimit-Bucket': opts.bucket,
  };
}

/** Discord-shaped 429: body plus the extra headers (Retry-After, scope, Via for discord.py). */
export function rateLimitedResponse(opts: { retryAfterSeconds: number; global: boolean }): {
  body: { message: string; retry_after: number; global: boolean; code: number };
  headers: Record<string, string>;
} {
  const retry = Math.max(0.001, opts.retryAfterSeconds);
  return {
    body: { message: 'You are being rate limited.', retry_after: Number(retry.toFixed(3)), global: opts.global, code: 0 },
    headers: {
      'Retry-After': String(Math.ceil(retry)),
      'X-RateLimit-Scope': opts.global ? 'global' : 'user',
      ...(opts.global ? { 'X-RateLimit-Global': 'true' } : {}),
      // discord.py treats a 429 without Via as a Cloudflare ban and gives up.
      Via: '1.1 serika',
    },
  };
}

/** The bot token of a request to the versioned bot API (/api/v10, /api/v9), or null. */
export function botApiTokenFromRequest(path: string, authorization?: string | null): string | null {
  const p = path.startsWith('/api/') ? path.slice(4) : path;
  if (!/^\/v(?:9|10)(?:\/|$)/.test(p)) return null;
  if (typeof authorization !== 'string') return null;
  const m = /^Bot\s+(\S+)\s*$/i.exec(authorization);
  return m ? m[1] : null;
}
