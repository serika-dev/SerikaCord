/**
 * Pure rules for server-owned connections (server_owned_connections rows):
 * accounts that belong to a server itself, not to its owner's profile. A
 * company can show its domain or its GitHub / Twitch / ... account on its
 * server without linking it to anyone's personal account.
 *
 * - Domains are proven with the same DNS TXT challenge as user domains
 *   (./domain.ts), with a token generated per server row.
 * - Accounts come from the same OAuth sign-ins as user connections; the flow
 *   carries the server through a one-time link ticket and the OAuth state,
 *   both bound to the owner who started it (see ServerLinkTarget below). No
 *   OAuth tokens are kept: only the identity.
 */
import { isVerifiedDomainConnection, ownDomainStatus, readDomainVerification, type OwnDomainStatus } from './domain';
import { OAUTH_VERIFIED_KEY } from './policy';

/** Providers a server can link through an OAuth sign-in (no "serika": that one is the owner's own account). */
export const SERVER_OAUTH_PROVIDERS = ['discord', 'github', 'twitch', 'spotify', 'steam', 'lastfm'] as const;
export type ServerOAuthProvider = (typeof SERVER_OAUTH_PROVIDERS)[number];

/** How many accounts (domains included) a server can own. */
export const MAX_SERVER_OWNED_CONNECTIONS = 10;
/** How many of those may be domains (verified or pending). */
export const MAX_DOMAINS_PER_SERVER = 5;
/** Lifetime of a link ticket (POST …/link → GET /api/auth/:provider/initiate?link=…). */
export const SERVER_LINK_TICKET_TTL = 300;

const UUID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

export function isServerOAuthProvider(provider: unknown): provider is ServerOAuthProvider {
  return typeof provider === 'string' && (SERVER_OAUTH_PROVIDERS as readonly string[]).includes(provider);
}

/** OAuth providers the platform lets anyone link right now (connectionsEnabled / disabledProviders). */
export function allowedServerOAuthProviders(
  settings: { connectionsEnabled?: boolean | null; disabledProviders?: string[] | null },
  configured: readonly string[],
): ServerOAuthProvider[] {
  if (settings.connectionsEnabled === false) return [];
  const disabled = new Set(settings.disabledProviders ?? []);
  return SERVER_OAUTH_PROVIDERS.filter((p) => configured.includes(p) && !disabled.has(p));
}

export function serverDomainsAllowed(settings: { connectionsEnabled?: boolean | null; disabledProviders?: string[] | null }): boolean {
  return settings.connectionsEnabled !== false && !(settings.disabledProviders ?? []).includes('website');
}

// ─── OAuth target binding ─────────────────────────────────────────────────────

/** What a link ticket / OAuth state entry carries for a server link. */
export interface ServerLinkTarget {
  provider: string;
  userId: string;
  serverId: string;
}

/** Validates a ticket / state entry read back from Redis. */
export function parseServerLinkTarget(entry: unknown): ServerLinkTarget | null {
  if (!entry || typeof entry !== 'object') return null;
  const { provider, userId, serverId } = entry as Record<string, unknown>;
  if (!isServerOAuthProvider(provider)) return null;
  if (typeof userId !== 'string' || !UUID_RE.test(userId)) return null;
  if (typeof serverId !== 'string' || !UUID_RE.test(serverId)) return null;
  return { provider, userId, serverId };
}

const sameUuid = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.replace(/-/g, '').toLowerCase() === b.replace(/-/g, '').toLowerCase();

/**
 * May this request act on the target? The provider must match the route, the
 * signed-in user must be the one who started the flow, and they must still own
 * the server (checked again on the callback, after the provider round trip).
 */
export function checkServerLinkTarget(
  target: ServerLinkTarget | null,
  ctx: { provider: string; authUserId: string | null | undefined; serverOwnerId: string | null | undefined },
): 'ok' | 'invalid' | 'wrong_user' | 'not_owner' {
  if (!target || target.provider !== ctx.provider) return 'invalid';
  if (!sameUuid(target.userId, ctx.authUserId)) return 'wrong_user';
  if (!sameUuid(target.userId, ctx.serverOwnerId)) return 'not_owner';
  return 'ok';
}

/** Where the browser lands after a server link (Server Settings → Server Connections). */
export function serverLinkReturnPath(serverId: string, result: { linked?: string; error?: string }): string {
  const params = new URLSearchParams({ serverSettings: 'connections' });
  if (result.linked) params.set('linked', result.linked);
  if (result.error) params.set('linkError', result.error.replace(/[^a-z0-9_]/gi, '').slice(0, 64));
  return `/channels/${encodeURIComponent(serverId)}?${params}`;
}

/** Reads serverLinkReturnPath's query back on the client. */
export function parseServerLinkReturn(search: string): { tab: 'connections'; linked: string | null; error: string | null } | null {
  const params = new URLSearchParams(search);
  if (params.get('serverSettings') !== 'connections') return null;
  const linked = params.get('linked');
  const error = params.get('linkError');
  return {
    tab: 'connections',
    linked: linked && /^[a-z0-9]{2,20}$/.test(linked) ? linked : null,
    error: error && /^[a-z0-9_]{1,64}$/i.test(error) ? error : null,
  };
}

// ─── Rows and views ───────────────────────────────────────────────────────────

export interface ServerOwnedRow {
  id: string;
  serverId: string;
  provider: string;
  accountId: string;
  username?: string | null;
  displayName?: string | null;
  avatar?: string | null;
  metadata?: unknown;
  verified: boolean;
  visible: boolean;
  createdAt?: Date | string | null;
}

/** Metadata for an account proven by an OAuth sign-in (identity only, no tokens). */
export function oauthServerMetadata(): Record<string, unknown> {
  return { [OAUTH_VERIFIED_KEY]: true };
}

/** Is this server-owned row proven? Domains by their TXT record, accounts by OAuth. */
export function isServerOwnedVerified(row: Pick<ServerOwnedRow, 'provider' | 'metadata' | 'verified'>): boolean {
  if (!row.verified) return false;
  if (row.provider === 'website') return isVerifiedDomainConnection(row);
  if (!isServerOAuthProvider(row.provider)) return false;
  const meta = row.metadata;
  return !!meta && typeof meta === 'object' && (meta as Record<string, unknown>)[OAUTH_VERIFIED_KEY] === true;
}

/** What members see on the invite page / Server Guide (shared with owner-linked rows). */
export interface ServerConnectionView {
  id: string;
  provider: string;
  accountId: string;
  username: string | null;
  displayName: string | null;
  verified: boolean;
  /** "owner": one of the owner's own linked accounts; "server": owned by the server itself. */
  source: 'owner' | 'server';
}

export function serverOwnedToView(row: ServerOwnedRow): ServerConnectionView {
  return {
    id: row.id,
    provider: row.provider,
    accountId: row.accountId,
    username: row.username ?? null,
    displayName: row.displayName ?? null,
    verified: isServerOwnedVerified(row),
    source: 'server',
  };
}

/** A row as its server's owner sees it in settings (with the domain challenge, never metadata). */
export interface ServerOwnedOwnView {
  id: string;
  provider: string;
  accountId: string;
  username: string | null;
  displayName: string | null;
  avatar: string | null;
  verified: boolean;
  visible: boolean;
  domain?: OwnDomainStatus;
}

export function serverOwnedOwnView(row: ServerOwnedRow): ServerOwnedOwnView {
  return {
    id: row.id,
    provider: row.provider,
    accountId: row.accountId,
    username: row.username ?? null,
    displayName: row.displayName ?? null,
    avatar: row.avatar ?? null,
    verified: isServerOwnedVerified(row),
    visible: row.visible !== false,
    ...(row.provider === 'website' ? { domain: ownDomainStatus(row) } : {}),
  };
}

/** The pending domain challenge token, or null once verified / for non-domains. */
export function pendingDomainToken(row: Pick<ServerOwnedRow, 'provider' | 'metadata'>): string | null {
  if (row.provider !== 'website') return null;
  const v = readDomainVerification(row.metadata);
  return v && !v.verified ? v.token : null;
}

/**
 * Concatenates two lists of shown connections, dropping repeats of the same
 * account (provider + account id); the first list wins.
 */
export function mergeConnectionViews<T extends { provider: string; accountId: string }>(
  first: T[],
  second: T[],
  max = MAX_SERVER_OWNED_CONNECTIONS + 8,
): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const c of [...first, ...second]) {
    const k = `${c.provider}:${c.accountId.toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out.slice(0, max);
}

/**
 * The list members see: the server's own verified, visible accounts first
 * (oldest first), then the owner's linked ones, without showing the same
 * account twice. Pending domains and hidden rows never appear.
 */
export function mergeServerConnections(
  serverOwned: ServerOwnedRow[],
  ownerLinked: ServerConnectionView[],
  max = MAX_SERVER_OWNED_CONNECTIONS + 8,
): ServerConnectionView[] {
  const owned = [...serverOwned]
    .filter((r) => r.visible !== false && isServerOwnedVerified(r))
    .sort((a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime())
    .map(serverOwnedToView);
  return mergeConnectionViews(owned, ownerLinked.map((c) => ({ ...c, source: 'owner' as const })), max);
}

/** Whether another account / domain fits: the overall cap and the domain cap. */
export function serverOwnedCapacity(rows: Pick<ServerOwnedRow, 'provider'>[], adding: 'website' | 'oauth'): 'ok' | 'too_many' | 'too_many_domains' {
  if (rows.length >= MAX_SERVER_OWNED_CONNECTIONS) return 'too_many';
  if (adding === 'website' && rows.filter((r) => r.provider === 'website').length >= MAX_DOMAINS_PER_SERVER) return 'too_many_domains';
  return 'ok';
}
