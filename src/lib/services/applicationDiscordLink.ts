/**
 * A SerikaCord application's linked Discord bot (Serika extension).
 *
 * Proof of ownership: the developer sends the Discord bot's token once, we
 * ask Discord (GET /users/@me with that token) which bot it is, and store only
 * the Discord bot user id and application id in application_api_settings.
 * The token is never stored, logged or echoed. A Discord bot is linked to at
 * most one application: a newer proven link moves it.
 *
 * Used by PUT/GET/DELETE /api/v10/applications/@me/discord-link
 * (src/lib/api/botApi/applications.ts), the Developer Portal
 * (/api/developers/applications/:id/discord-link) and the Discord bridge
 * (src/lib/discord/bot.ts), which relays a linked Discord bot's messages as
 * the app's own bot user when that bot is in the bridged server.
 * Pure parts: src/lib/discord/botLink.ts.
 */
import { and, eq, ne } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { BoundedMap } from '@/lib/utils/boundedMap';
import { processShared } from '@/lib/realtime/processShared';
import { checkRateLimit } from '@/lib/security';
import type { DiscordError } from '@/lib/botapi/errors';
import {
  DISCORD_UNAVAILABLE, INVALID_DISCORD_TOKEN, classifyDiscordUserResponse, discordTokenClaimedId, isDiscordSnowflake,
  serializeDiscordLink, type DiscordLinkView, type LinkedBotUser,
} from '@/lib/discord/botLink';
import { ensureApplicationApiSchema } from './applicationApiSettings';

const s = () => schema.applicationApiSettings;

/** The app's link, or null. Throws only when the table can't be reached. */
export async function getDiscordLink(applicationId: string): Promise<DiscordLinkView | null> {
  await ensureApplicationApiSchema();
  const [row] = await db.select({
    discordBotUserId: s().discordBotUserId,
    discordApplicationId: s().discordApplicationId,
    discordLinkedAt: s().discordLinkedAt,
  }).from(s()).where(eq(s().applicationId, applicationId)).limit(1);
  return serializeDiscordLink(row);
}

/** Store the link (moving the Discord bot off any other application). */
async function storeDiscordLink(applicationId: string, discordBotUserId: string, discordApplicationId: string | null): Promise<DiscordLinkView> {
  await ensureApplicationApiSchema();
  const now = new Date();
  const fields = { discordBotUserId, discordApplicationId, discordLinkedAt: now, updatedAt: now };
  await db.transaction(async (tx) => {
    // Unique index on discord_bot_user_id: free it first, then claim it.
    await tx.update(s())
      .set({ discordBotUserId: null, discordApplicationId: null, discordLinkedAt: null, updatedAt: now })
      .where(and(eq(s().discordBotUserId, discordBotUserId), ne(s().applicationId, applicationId)));
    await tx.insert(s())
      .values({ applicationId, ...fields })
      .onConflictDoUpdate({ target: s().applicationId, set: fields });
  });
  invalidateDiscordLinkCache();
  return { discord_bot_user_id: discordBotUserId, discord_application_id: discordApplicationId, linked_at: now.toISOString() };
}

/** Remove the app's link. True when there was one. */
export async function removeDiscordLink(applicationId: string): Promise<boolean> {
  await ensureApplicationApiSchema();
  const existing = await getDiscordLink(applicationId);
  if (!existing) return false;
  await db.update(s())
    .set({ discordBotUserId: null, discordApplicationId: null, discordLinkedAt: null, updatedAt: new Date() })
    .where(eq(s().applicationId, applicationId));
  invalidateDiscordLinkCache();
  return true;
}

export type LinkResult =
  | { ok: true; link: DiscordLinkView; discordUsername: string | null }
  | { ok: false; status: number; body: DiscordError & { retry_after?: number; global?: boolean } };

/**
 * Verify `token` with Discord and link the bot it belongs to. `token` must
 * already be normalized and shape-checked (parseDiscordLinkBody). 5 attempts
 * per application per hour (each one calls Discord).
 */
export async function linkDiscordBotWithToken(applicationId: string, token: string): Promise<LinkResult> {
  const limited = await checkRateLimit('discordBotLink', applicationId.toLowerCase());
  if (!limited.success) {
    return { ok: false, status: 429, body: { code: 0, message: 'You are being rate limited.', retry_after: limited.retryAfter ?? 60, global: false } };
  }
  const claimedId = discordTokenClaimedId(token);
  if (!claimedId) return { ok: false, status: 400, body: INVALID_DISCORD_TOKEN };

  const { discordGetWithToken } = await import('@/lib/discord/rest');
  const me = await discordGetWithToken<unknown>(token, '/users/@me');
  const check = classifyDiscordUserResponse(me.status, me.data, claimedId);
  if (check.kind === 'invalid') return { ok: false, status: 400, body: INVALID_DISCORD_TOKEN };
  if (check.kind === 'unavailable') return { ok: false, status: 502, body: DISCORD_UNAVAILABLE };

  // The Discord application id is optional (older bots have one that differs from the user id).
  let discordApplicationId: string | null = null;
  const app = await discordGetWithToken<{ id?: unknown }>(token, '/applications/@me');
  if (app.status === 200 && isDiscordSnowflake(app.data?.id)) discordApplicationId = app.data.id as string;

  const link = await storeDiscordLink(applicationId, check.id, discordApplicationId);
  console.log(`[discord-link] application ${applicationId} linked a Discord bot`);
  return { ok: true, link, discordUsername: check.username };
}

// ─── Discord name for the portal ────────────────────────────────────────────

const discordNameCache = new BoundedMap<string, { at: number; name: string | null }>(500);

/** The linked Discord bot's username, looked up with the bridge bot (cached 10 minutes). */
export async function discordBotUsername(discordUserId: string): Promise<string | null> {
  const hit = discordNameCache.get(discordUserId);
  if (hit && Date.now() - hit.at < 600_000) return hit.name;
  const { discordBot } = await import('@/lib/discord/rest');
  const res = await discordBot<{ username?: unknown }>(`/users/${discordUserId}`);
  const name = res.ok && typeof res.data?.username === 'string' ? res.data.username.slice(0, 64) : null;
  if (res.ok || res.status === 404) discordNameCache.set(discordUserId, { at: Date.now(), name });
  return name;
}

export function rememberDiscordBotUsername(discordUserId: string, name: string | null): void {
  if (name) discordNameCache.set(discordUserId, { at: Date.now(), name });
}

// ─── Bridge lookup ──────────────────────────────────────────────────────────

const LOOKUP_TTL_MS = 60_000;
// `${discordBotId}:${channelId}` -> the bot user to post as, or null (also cached).
// Process-shared so a link / unlink handled by any module copy clears it.
const linkedAuthorCache = processShared('discordLinkAuthors', () => new BoundedMap<string, { at: number; user: LinkedBotUser | null }>(2000));

/**
 * Drop cached bridge lookups. Link / unlink call it in-process; other app
 * instances (the bridge runs on the Discord-bot leader) pick the change up
 * when their entries expire (one minute).
 */
export function invalidateDiscordLinkCache(): void {
  linkedAuthorCache.clear();
}

/**
 * The SerikaCord bot user a Discord bot's bridged message in `channelId`
 * should be posted as: set when that Discord bot is linked to an application
 * whose bot user is a member of the channel's server and can see the channel.
 * Null otherwise, and on any error (the bridge then falls back to the bridged
 * Discord account).
 */
export async function resolveLinkedBotAuthor(discordBotId: string, channelId: string): Promise<LinkedBotUser | null> {
  if (!isDiscordSnowflake(discordBotId) || !channelId) return null;
  const key = `${discordBotId}:${channelId.toLowerCase()}`;
  const hit = linkedAuthorCache.get(key);
  if (hit && Date.now() - hit.at < LOOKUP_TTL_MS) return hit.user;
  let user: LinkedBotUser | null = null;
  try {
    await ensureApplicationApiSchema();
    const [link] = await db.select({ botId: schema.applications.botId })
      .from(s())
      .innerJoin(schema.applications, eq(schema.applications.id, s().applicationId))
      .where(eq(s().discordBotUserId, discordBotId))
      .limit(1);
    if (link?.botId) {
      // Membership + VIEW_CHANNEL (overwrites, private threads, screening).
      const { checkChannelAccess } = await import('@/lib/api/channels');
      const access = await checkChannelAccess(link.botId, channelId);
      if (access.hasAccess) {
        const [u] = await db.select({
          id: schema.users.id,
          username: schema.users.username,
          displayName: schema.users.displayName,
          avatar: schema.users.avatar,
          isBot: schema.users.isBot,
          isVerified: schema.users.isVerified,
          badges: schema.users.badges,
        }).from(schema.users).where(eq(schema.users.id, link.botId)).limit(1);
        if (u?.isBot) user = u;
      }
    }
  } catch (err) {
    console.error('[discord-link] bridge lookup failed:', (err as Error)?.message ?? err);
    return null; // not cached: retried on the next message
  }
  linkedAuthorCache.set(key, { at: Date.now(), user });
  return user;
}
