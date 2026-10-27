import { cache } from '@/lib/db/redis';
import { User, UserConnection } from '@/lib/models';
import { bridgeBotToken, discordBot } from '@/lib/discord/rest';
import { BoundedMap } from '@/lib/utils/boundedMap';
import {
  ACCOUNTS_DISCORD_MISS_TTL_SECONDS,
  accountsDiscordMetadata,
  accountsLookupsFor,
  discordLinkFromAccountsUser,
  shouldAskAccounts,
} from '@/lib/connections/accountsDiscord';
import { accountsInternalLookupUser } from './accountsClient';

/**
 * A user's linked Discord account, wherever it was linked.
 *
 * Discord is linked in Serika Accounts; SerikaCord mirrors it into its own
 * user_connections row (provider 'discord'), which used to be written only at
 * sign-in. When that row is missing this asks Serika Accounts
 * (/internal/get-user, x-service-key) and fills the row in, so a Discord
 * account linked after signing in counts straight away. "Not linked" answers
 * are remembered for ACCOUNTS_DISCORD_MISS_TTL_SECONDS per user.
 */

export interface LinkedDiscord {
  accountId: string;
  username: string | null;
  displayName: string | null;
}

const missKey = (userId: string) => `discordconn:miss:${userId}`;

// One accounts round-trip per user at a time (the bridge panel fires several
// requests at once).
const inflight = new BoundedMap<string, Promise<LinkedDiscord | null>>(2000);

function toLinked(row: { accountId: string; username?: string | null; displayName?: string | null }): LinkedDiscord {
  return { accountId: row.accountId, username: row.username ?? null, displayName: row.displayName ?? null };
}

/**
 * The Discord link Serika Accounts has for this user: the link, null when it
 * has none, or 'unavailable' when accounts could not be asked.
 */
async function discordLinkFromAccounts(userId: string): Promise<{ id: string; username: string | null } | null | 'unavailable'> {
  const derived = accountsLookupsFor(userId);
  // Legacy rows (own id) are found by originalUserId, then by email.
  const lookups = derived.length === 1 && 'id' in derived[0]
    ? derived
    : accountsLookupsFor(userId, (await User.findById(userId))?.email ?? null);
  for (const lookup of lookups) {
    const { ok, status, data } = await accountsInternalLookupUser(lookup);
    if (!ok) {
      if (status >= 500 || status === 401 || status === 403) return 'unavailable';
      continue;
    }
    if (data?.user) return discordLinkFromAccountsUser(data.user);
  }
  return null;
}

/** Best-effort Discord profile (display name, avatar) for the connection card. */
async function discordProfile(discordId: string): Promise<{ username?: string; displayName?: string; avatar?: string | null }> {
  if (!bridgeBotToken()) return {};
  const res = await discordBot<{ username?: string; global_name?: string | null; avatar?: string | null }>(`/users/${discordId}`);
  if (!res.ok || !res.data) return {};
  const d = res.data;
  const avatar = d.avatar
    ? `https://cdn.discordapp.com/avatars/${discordId}/${d.avatar}.${d.avatar.startsWith('a_') ? 'gif' : 'png'}?size=64`
    : null;
  return { username: d.username, displayName: d.global_name || d.username, avatar };
}

async function upsertFromAccounts(userId: string, link: { id: string; username: string | null }): Promise<LinkedDiscord> {
  const profile = await discordProfile(link.id);
  const username = profile.username || link.username || null;
  const fields = {
    accountId: link.id,
    username,
    displayName: profile.displayName || username,
    ...(profile.avatar !== undefined ? { avatar: profile.avatar } : {}),
  };
  const existing = await UserConnection.findOne({ userId, provider: 'discord' });
  if (existing) {
    const row = await UserConnection.updateById(existing.id, { ...fields, metadata: accountsDiscordMetadata(existing.metadata) });
    return toLinked(row ?? { ...existing, ...fields });
  }
  try {
    const row = await UserConnection.create({ userId, provider: 'discord', ...fields, metadata: accountsDiscordMetadata(null) });
    return toLinked(row ?? fields);
  } catch (err) {
    // Another request created it first (unique user/provider/account).
    const again = await UserConnection.findOne({ userId, provider: 'discord' });
    if (again?.accountId) return toLinked(again);
    throw err;
  }
}

async function syncFromAccounts(userId: string, fresh: boolean): Promise<LinkedDiscord | null> {
  const miss = await cache.get<{ at?: number }>(missKey(userId));
  if (!shouldAskAccounts(miss, Date.now(), fresh)) return null;
  const link = await discordLinkFromAccounts(userId);
  if (!link || link === 'unavailable') {
    // An unreachable accounts service is remembered too: every bridge request
    // would otherwise wait out its timeout again.
    await cache.set(missKey(userId), { at: Date.now() }, ACCOUNTS_DISCORD_MISS_TTL_SECONDS);
    return null;
  }
  const linked = await upsertFromAccounts(userId, link);
  await cache.del(missKey(userId));
  return linked;
}

/**
 * The user's linked Discord account: the local connection, or the one Serika
 * Accounts has (saved locally on the way). `fresh` re-asks accounts despite a
 * remembered "not linked", at most once every few seconds.
 */
export async function resolveLinkedDiscord(userId: string, opts: { fresh?: boolean } = {}): Promise<LinkedDiscord | null> {
  const local = await UserConnection.findOne({ userId, provider: 'discord' });
  if (local?.accountId) return toLinked(local);
  const pending = inflight.get(userId);
  if (pending) return pending;
  const job = syncFromAccounts(userId, Boolean(opts.fresh))
    .catch((err) => {
      console.error('[DiscordConnection] Accounts lookup failed:', err instanceof Error ? err.message : err);
      return null;
    })
    .finally(() => inflight.delete(userId));
  inflight.set(userId, job);
  return job;
}

/**
 * Serika Accounts pushed a Discord link change (/api/internal/update-profile):
 * save the link, or drop the local row on an explicit unlink (null).
 */
export async function applyAccountsDiscordUpdate(userId: string, update: { discordId?: unknown; discordUsername?: unknown }): Promise<void> {
  await cache.del(missKey(userId));
  const link = discordLinkFromAccountsUser(update);
  if (link) {
    await upsertFromAccounts(userId, link);
    return;
  }
  if (update.discordId === null || update.discordId === '') {
    const existing = await UserConnection.findOne({ userId, provider: 'discord' });
    if (existing) await UserConnection.deleteById(existing.id);
  }
}
