// Storage for server-owned connections (server_owned_connections, rules in
// src/lib/connections/serverOwned.ts). The rows a server shows are cached
// briefly in Redis because the invite page and the Server Guide read them.
import { randomBytes } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { cache } from '@/lib/db';
import { getRedis } from '@/lib/db/redis';
import { db, schema } from '@/lib/db/postgres';
import { normalizeId } from '@/lib/db/normalizeId';
import { createDomainToken, newDomainMetadata, verifiedDomainMetadata } from '@/lib/connections/domain';
import {
  SERVER_LINK_TICKET_TTL,
  oauthServerMetadata,
  parseServerLinkTarget,
  type ServerLinkTarget,
  type ServerOwnedRow,
} from '@/lib/connections/serverOwned';

type Row = typeof schema.serverOwnedConnections.$inferSelect;

const listKey = (serverId: string) => `server:owned-connections:${normalizeId(serverId)}`;

function toRow(r: Row): ServerOwnedRow {
  return {
    id: r.id,
    serverId: r.serverId,
    provider: r.provider,
    accountId: r.accountId,
    username: r.username,
    displayName: r.displayName,
    avatar: r.avatar,
    metadata: r.metadata,
    verified: r.verified,
    visible: r.visible,
    createdAt: r.createdAt,
  };
}

async function invalidate(serverId: string): Promise<void> {
  await cache.del(listKey(serverId)).catch(() => {});
}

/** Every row of a server (owner view: pending domains included). [] before the table exists. */
export async function listServerOwnedConnections(serverId: string, opts: { fresh?: boolean } = {}): Promise<ServerOwnedRow[]> {
  if (!opts.fresh) {
    const cached = await cache.get<ServerOwnedRow[]>(listKey(serverId)).catch(() => null);
    if (Array.isArray(cached)) return cached;
  }
  let rows: ServerOwnedRow[] = [];
  try {
    rows = (await db
      .select()
      .from(schema.serverOwnedConnections)
      .where(eq(schema.serverOwnedConnections.serverId, normalizeId(serverId)))
      .orderBy(asc(schema.serverOwnedConnections.createdAt))).map(toRow);
  } catch {
    return []; // table not created yet (boot DDL pending)
  }
  await cache.set(listKey(serverId), rows, 60).catch(() => {});
  return rows;
}

export async function getServerOwnedConnection(serverId: string, id: string): Promise<ServerOwnedRow | null> {
  const [row] = await db
    .select()
    .from(schema.serverOwnedConnections)
    .where(and(
      eq(schema.serverOwnedConnections.id, normalizeId(id)),
      eq(schema.serverOwnedConnections.serverId, normalizeId(serverId)),
    ))
    .limit(1);
  return row ? toRow(row) : null;
}

/** Adds a pending domain (or returns the server's existing row for it). */
export async function addServerDomain(serverId: string, domain: string, createdBy: string): Promise<ServerOwnedRow | null> {
  const sid = normalizeId(serverId);
  const [row] = await db
    .insert(schema.serverOwnedConnections)
    .values({
      serverId: sid,
      provider: 'website',
      accountId: domain,
      displayName: domain,
      metadata: newDomainMetadata(createDomainToken()),
      verified: false,
      visible: true,
      createdBy: normalizeId(createdBy),
    })
    .onConflictDoNothing()
    .returning();
  await invalidate(serverId);
  if (row) return toRow(row);
  const [existing] = await db
    .select()
    .from(schema.serverOwnedConnections)
    .where(and(
      eq(schema.serverOwnedConnections.serverId, sid),
      eq(schema.serverOwnedConnections.provider, 'website'),
      eq(schema.serverOwnedConnections.accountId, domain),
    ))
    .limit(1);
  return existing ? toRow(existing) : null;
}

export async function markServerDomainVerified(serverId: string, id: string, token: string): Promise<ServerOwnedRow | null> {
  const [row] = await db
    .update(schema.serverOwnedConnections)
    .set({ metadata: verifiedDomainMetadata(token, new Date()), verified: true, updatedAt: new Date() })
    .where(and(
      eq(schema.serverOwnedConnections.id, normalizeId(id)),
      eq(schema.serverOwnedConnections.serverId, normalizeId(serverId)),
    ))
    .returning();
  await invalidate(serverId);
  return row ? toRow(row) : null;
}

/** Saves (or refreshes) an account an OAuth sign-in proved, for the server. Identity only. */
export async function upsertServerOAuthConnection(
  serverId: string,
  createdBy: string,
  provider: string,
  identity: { accountId: string; username?: string | null; displayName?: string | null; avatar?: string | null },
): Promise<ServerOwnedRow | null> {
  const values = {
    serverId: normalizeId(serverId),
    provider,
    accountId: identity.accountId,
    username: identity.username || identity.accountId,
    displayName: identity.displayName || identity.username || identity.accountId,
    avatar: identity.avatar ?? null,
    metadata: oauthServerMetadata(),
    verified: true,
    visible: true,
    createdBy: normalizeId(createdBy),
  };
  const [row] = await db
    .insert(schema.serverOwnedConnections)
    .values(values)
    .onConflictDoUpdate({
      target: [schema.serverOwnedConnections.serverId, schema.serverOwnedConnections.provider, schema.serverOwnedConnections.accountId],
      set: {
        username: values.username,
        displayName: values.displayName,
        avatar: values.avatar,
        metadata: values.metadata,
        verified: true,
        updatedAt: new Date(),
      },
    })
    .returning();
  await invalidate(serverId);
  return row ? toRow(row) : null;
}

export async function setServerOwnedVisible(serverId: string, id: string, visible: boolean): Promise<ServerOwnedRow | null> {
  const [row] = await db
    .update(schema.serverOwnedConnections)
    .set({ visible, updatedAt: new Date() })
    .where(and(
      eq(schema.serverOwnedConnections.id, normalizeId(id)),
      eq(schema.serverOwnedConnections.serverId, normalizeId(serverId)),
    ))
    .returning();
  await invalidate(serverId);
  return row ? toRow(row) : null;
}

export async function deleteServerOwnedConnection(serverId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(schema.serverOwnedConnections)
    .where(and(
      eq(schema.serverOwnedConnections.id, normalizeId(id)),
      eq(schema.serverOwnedConnections.serverId, normalizeId(serverId)),
    ))
    .returning({ id: schema.serverOwnedConnections.id });
  await invalidate(serverId);
  return rows.length > 0;
}

/** Server deletion: drop everything the server owned (best-effort, table may not exist yet). */
export async function deleteAllServerOwnedConnections(serverId: string): Promise<void> {
  try {
    await db.delete(schema.serverOwnedConnections).where(eq(schema.serverOwnedConnections.serverId, normalizeId(serverId)));
  } catch {
    // Table not created yet: nothing to delete.
  }
  await invalidate(serverId);
}

// ─── OAuth link tickets ───────────────────────────────────────────────────────
// POST /servers/:id/owned-connections/link (a credentialed JSON request, so a
// cross-site page can't start it) mints a one-time ticket; the browser then
// opens /api/auth/:provider/initiate?link=<ticket>, which burns it and puts the
// server into the OAuth state. A plain link to the initiate URL does nothing.

const ticketKey = (nonce: string) => `serverlink:${nonce}`;

export async function createServerLinkTicket(target: ServerLinkTarget): Promise<string> {
  const nonce = randomBytes(24).toString('hex');
  await cache.set(ticketKey(nonce), target, SERVER_LINK_TICKET_TTL);
  return nonce;
}

/** Reads and deletes a ticket; null when unknown, expired or malformed. */
export async function consumeServerLinkTicket(nonce: unknown): Promise<ServerLinkTarget | null> {
  if (typeof nonce !== 'string' || !/^[a-f0-9]{48}$/.test(nonce)) return null;
  const key = ticketKey(nonce);
  const redis = getRedis();
  if (!redis) return null;
  // GETDEL: two tabs racing on the same ticket can't both use it.
  const raw = await redis.getdel(key).catch(() => null);
  if (!raw) return null;
  try {
    return parseServerLinkTarget(JSON.parse(raw));
  } catch {
    return null;
  }
}
