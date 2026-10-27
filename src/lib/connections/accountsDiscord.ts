/**
 * Pure rules for reading a user's Discord link from Serika Accounts.
 *
 * Discord is linked in Serika Accounts (accounts.serika.dev → Settings →
 * Connections), which stores it as `discordId` / `discordUsername` on the
 * accounts user. SerikaCord keeps its own `user_connections` row (provider
 * 'discord') that the bridge, profile and bot API read. That row used to be
 * written only at sign-in, so a Discord account linked later stayed invisible
 * until the next login. src/lib/services/discordConnection.ts uses these
 * helpers to look the link up server-to-server and fill the local row in.
 *
 * No server or browser globals here: shared by the service and unit tests.
 */
import { accountsIdFromUserId } from '../serikaWishlist';
import { OAUTH_VERIFIED_KEY } from './policy';

/** How long "Serika Accounts has no Discord link for this user" is remembered. */
export const ACCOUNTS_DISCORD_MISS_TTL_SECONDS = 45;
/** A forced re-check ("I've connected it") still waits this long between calls to accounts. */
export const ACCOUNTS_DISCORD_FRESH_MIN_INTERVAL_MS = 5_000;

const SNOWFLAKE = /^\d{17,20}$/;

/** One /internal/get-user request body. */
export type AccountsLookup = { id: string } | { originalUserId: string } | { email: string };

/**
 * The accounts lookups that identify this local user, most specific first:
 * the accounts id the local id was derived from; otherwise (a legacy row that
 * kept its own id) the `originalUserId` accounts recorded at migration, then
 * the email both services share.
 */
export function accountsLookupsFor(userId: string, email?: string | null): AccountsLookup[] {
  // Local ids derived from an accounts id are that id right-padded with zeros.
  const accountsId = accountsIdFromUserId(userId);
  if (accountsId) return [{ id: accountsId }];
  const lookups: AccountsLookup[] = [{ originalUserId: userId }];
  const mail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (mail.includes('@')) lookups.push({ email: mail });
  return lookups;
}

/** The Discord link on an accounts user, or null when there is none (or it is malformed). */
export function discordLinkFromAccountsUser(
  user: { discordId?: unknown; discordUsername?: unknown } | null | undefined,
): { id: string; username: string | null } | null {
  const id = user?.discordId;
  if (typeof id !== 'string' || !SNOWFLAKE.test(id)) return null;
  const username = typeof user?.discordUsername === 'string' && user.discordUsername.trim() ? user.discordUsername.trim().slice(0, 64) : null;
  return { id, username };
}

/**
 * Whether to ask Serika Accounts again. A remembered miss is trusted until it
 * expires; a forced check (the user says they just linked Discord) bypasses it,
 * but no more than once every few seconds so a button can't hammer accounts.
 */
export function shouldAskAccounts(miss: { at?: unknown } | null | undefined, now: number, fresh: boolean): boolean {
  if (!miss) return true;
  if (!fresh) return false;
  const at = typeof miss.at === 'number' ? miss.at : 0;
  return now - at >= ACCOUNTS_DISCORD_FRESH_MIN_INTERVAL_MS;
}

/**
 * Metadata for a row filled in from Serika Accounts. Accounts links Discord
 * through Discord OAuth, so the row is as trustworthy as one made by our own
 * callback (the bridge maps Discord authors only through verified rows).
 */
export function accountsDiscordMetadata(previous: unknown): Record<string, unknown> {
  const prev = previous && typeof previous === 'object' && !Array.isArray(previous) ? (previous as Record<string, unknown>) : {};
  return { ...prev, [OAUTH_VERIFIED_KEY]: true, source: 'serika-accounts' };
}
