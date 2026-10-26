import { checkRateLimit } from '@/lib/security';

/**
 * Tight limit for bridge actions that fan out to Discord with the shared bot
 * token (guild list, fresh channel list, webhook check, bulk mapping, sync),
 * so one user or one server can't spend the bot's Discord rate limits for
 * everyone. Counted per user and per server; returns an error message when
 * either is exhausted.
 */
export async function checkDiscordBridgeHeavyLimit(userId: string, serverId: string): Promise<string | null> {
  const [byUser, byServer] = await Promise.all([
    checkRateLimit('discordBridgeHeavy', `user:${userId}`),
    checkRateLimit('discordBridgeHeavy', `server:${serverId.toLowerCase()}`),
  ]);
  if (byUser.success && byServer.success) return null;
  const wait = Math.max(byUser.retryAfter ?? 0, byServer.retryAfter ?? 0, 1);
  return `That talks to Discord a lot. Try again in ${wait}s.`;
}
