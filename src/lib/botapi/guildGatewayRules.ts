/**
 * GET /gateway/bot numbers (pure; tested in tests/guildparity-gateway.test.ts):
 * Discord recommends one shard per 1000 guilds, and reports the daily
 * IDENTIFY budget (1000 per day, max_concurrency 1 like the gateway enforces).
 */

export const GUILDS_PER_RECOMMENDED_SHARD = 1000;
export const IDENTIFY_DAILY = 1000;
export const IDENTIFY_WINDOW_MS = 86_400_000;

export function recommendedShards(guildCount: number): number {
  const n = Number.isFinite(guildCount) ? Math.max(0, guildCount) : 0;
  return Math.max(1, Math.ceil(n / GUILDS_PER_RECOMMENDED_SHARD));
}

/** session_start_limit from the daily limiter's state (null = no IDENTIFY in the current window). */
export function sessionStartLimit(state: { consumedPoints: number; msBeforeNext: number } | null) {
  if (!state) return { total: IDENTIFY_DAILY, remaining: IDENTIFY_DAILY, reset_after: IDENTIFY_WINDOW_MS, max_concurrency: 1 };
  return {
    total: IDENTIFY_DAILY,
    remaining: Math.max(0, IDENTIFY_DAILY - Math.max(0, Math.floor(state.consumedPoints))),
    reset_after: Math.max(0, Math.round(state.msBeforeNext)),
    max_concurrency: 1,
  };
}
