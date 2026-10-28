/**
 * The current avatar / banner of the user's linked Discord account, for the
 * "Select an Image" dialog. Read with the bridge bot's token
 * (GET /users/{id}), cached for an hour per Discord account in Redis.
 */
import { cache } from '@/lib/db/redis';
import { bridgeBotToken, discordBot } from '@/lib/discord/rest';
import { resolveLinkedDiscord } from '@/lib/services/discordConnection';
import { discordAvatarUrl, discordBannerUrl } from '@/lib/profiles/recentMedia';

const TTL_SECONDS = 60 * 60;
const SNOWFLAKE_RE = /^\d{17,20}$/;

export interface DiscordProfileMedia {
  discordId: string;
  /** Image hashes (`a_` prefix = animated), null when not set. */
  avatar: string | null;
  banner: string | null;
}

const cacheKey = (discordId: string) => `discordmedia:${discordId}`;

/** Avatar / banner hashes of the user's linked Discord account, or null (not linked, no bot, Discord error). */
export async function getLinkedDiscordMedia(userId: string): Promise<DiscordProfileMedia | null> {
  const linked = await resolveLinkedDiscord(userId).catch(() => null);
  const discordId = linked?.accountId;
  if (!discordId || !SNOWFLAKE_RE.test(discordId)) return null;
  const hit = await cache.get<DiscordProfileMedia>(cacheKey(discordId)).catch(() => null);
  if (hit && hit.discordId === discordId) return hit;
  if (!bridgeBotToken()) return null;
  const res = await discordBot<{ avatar?: string | null; banner?: string | null }>(`/users/${discordId}`);
  if (!res.ok || !res.data) return null;
  const value: DiscordProfileMedia = { discordId, avatar: res.data.avatar ?? null, banner: res.data.banner ?? null };
  await cache.set(cacheKey(discordId), value, TTL_SECONDS).catch(() => {});
  return value;
}

/** Display URLs (small) for the dialog's tiles. */
export function discordMediaPreview(media: DiscordProfileMedia | null): { avatar: string | null; banner: string | null } {
  if (!media) return { avatar: null, banner: null };
  return {
    avatar: discordAvatarUrl(media.discordId, media.avatar, 128),
    banner: discordBannerUrl(media.discordId, media.banner, 600),
  };
}
