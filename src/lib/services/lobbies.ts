/**
 * Social SDK lobby storage (Discord's Lobby resource) for the bot API routes
 * in src/lib/api/botApi/social.ts. Validation and serializers are pure, in
 * src/lib/botapi/lobbies.ts.
 *
 * Model: a lobby belongs to one application and is only ever reached through
 * that application (its bot token, or sdk.social_layer tokens its users
 * granted it); every lookup here takes the application id. Members are real
 * Serika users who authorized the application (an authorized_apps row), so an
 * app can't pull arbitrary people into its lobbies. Lobby chat is encrypted at
 * rest like channel messages and kept for 72 hours (what Discord serves).
 *
 * Idle timeout: Discord deletes a lobby nobody has been connected to for
 * idle_timeout_seconds. SerikaCord has no SDK sessions, so "activity" is any
 * write by the application or a member (member changes, messages, joins); an
 * idle lobby is deleted on its next access, and expired lobbies of an app are
 * swept when it creates one.
 */
import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { ensureSocialParitySchema } from '@/lib/services/socialParitySchema';
import { decryptFromStorage, encryptForStorage } from '@/lib/security';
import {
  LOBBY_LIMITS, isLobbyExpired, toDiscordLobby, toDiscordLobbyMessage, type Metadata, type MemberInput,
} from '@/lib/botapi/lobbies';

export type LobbyRow = typeof schema.lobbies.$inferSelect;
export type LobbyMemberRow = typeof schema.lobbyMembers.$inferSelect;
export type LobbyMessageRow = typeof schema.lobbyMessages.$inferSelect;

const L = schema.lobbies;
const M = schema.lobbyMembers;
const MSG = schema.lobbyMessages;

const lower = (s: string) => s.toLowerCase();

// ─── Lobbies ─────────────────────────────────────────────────────────────────

/** Remove a lobby with its members and messages. Safe when already gone. */
export async function deleteLobbyRows(lobbyIds: string[]): Promise<void> {
  if (lobbyIds.length === 0) return;
  await ensureSocialParitySchema();
  await db.delete(MSG).where(inArray(MSG.lobbyId, lobbyIds));
  await db.delete(M).where(inArray(M.lobbyId, lobbyIds));
  await db.delete(L).where(inArray(L.id, lobbyIds));
}

/** The application's live lobby, or null (unknown, another app's, or idle past its timeout). */
export async function loadLobby(lobbyId: string, applicationId: string): Promise<LobbyRow | null> {
  await ensureSocialParitySchema();
  const [row] = await db.select().from(L).where(and(eq(L.id, lower(lobbyId)), eq(L.applicationId, lower(applicationId)))).limit(1);
  if (!row) return null;
  if (isLobbyExpired(row)) {
    await deleteLobbyRows([row.id]).catch(() => {});
    return null;
  }
  return row;
}

/** Record activity (resets the idle timer). */
export async function touchLobby(lobbyId: string): Promise<void> {
  await db.update(L).set({ lastActivityAt: new Date() }).where(eq(L.id, lobbyId)).catch(() => {});
}

/** Delete an application's lobbies that went idle (bounded per call). */
async function sweepExpired(applicationId: string): Promise<void> {
  const now = new Date().toISOString();
  const rows = await db.select({ id: L.id }).from(L).where(and(
    eq(L.applicationId, applicationId),
    sql`${L.lastActivityAt} < (${now}::timestamp - make_interval(secs => ${L.idleTimeoutSeconds}))`,
  )).limit(200);
  await deleteLobbyRows(rows.map((r) => r.id));
}

export type CreateLobbyResult = { ok: true; lobby: LobbyRow; created: boolean } | { ok: false; reason: 'app_limit' };

/**
 * Create a lobby for `applicationId`. With `secretHash`, an existing lobby
 * with that secret is returned instead (`created: false`), race-free.
 */
export async function createLobby(applicationId: string, input: {
  metadata?: Metadata | null;
  idleTimeoutSeconds?: number;
  flags?: number;
  secretHash?: string | null;
}): Promise<CreateLobbyResult> {
  await ensureSocialParitySchema();
  const appId = lower(applicationId);
  const bySecret = async () => {
    if (!input.secretHash) return null;
    const [row] = await db.select().from(L).where(and(eq(L.applicationId, appId), eq(L.secretHash, input.secretHash))).limit(1);
    if (row && isLobbyExpired(row)) {
      await deleteLobbyRows([row.id]);
      return null;
    }
    return row ?? null;
  };
  const existing = await bySecret();
  if (existing) return { ok: true, lobby: existing, created: false };

  await sweepExpired(appId).catch(() => {});
  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(L).where(eq(L.applicationId, appId));
  if (Number(n) >= LOBBY_LIMITS.lobbiesPerApp) return { ok: false, reason: 'app_limit' };

  const now = new Date();
  const inserted = await db.insert(L).values({
    applicationId: appId,
    secretHash: input.secretHash ?? null,
    metadata: input.metadata ?? null,
    flags: input.flags ?? 0,
    idleTimeoutSeconds: input.idleTimeoutSeconds ?? LOBBY_LIMITS.idleDefaultSeconds,
    lastActivityAt: now,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing().returning();
  if (inserted[0]) return { ok: true, lobby: inserted[0], created: true };
  // Lost a race on the same secret: the other request's lobby.
  const winner = await bySecret();
  if (winner) return { ok: true, lobby: winner, created: false };
  throw new Error('lobby insert conflicted without a secret match');
}

/** Update lobby fields (only the ones given). */
export async function updateLobby(lobbyId: string, patch: { metadata?: Metadata | null; idleTimeoutSeconds?: number; flags?: number }): Promise<LobbyRow | null> {
  const set: Partial<typeof L.$inferInsert> = { updatedAt: new Date(), lastActivityAt: new Date() };
  if (patch.metadata !== undefined) set.metadata = patch.metadata;
  if (patch.idleTimeoutSeconds !== undefined) set.idleTimeoutSeconds = patch.idleTimeoutSeconds;
  if (patch.flags !== undefined) set.flags = patch.flags;
  const [row] = await db.update(L).set(set).where(eq(L.id, lobbyId)).returning();
  return row ?? null;
}

/** Link (channelId) or unlink (null) a channel. `conflict` = linked to another lobby already. */
export async function setLinkedChannel(lobbyId: string, channelId: string | null, byUserId: string | null): Promise<{ ok: true; lobby: LobbyRow } | { ok: false; reason: 'conflict' | 'gone' }> {
  try {
    const [row] = await db.update(L).set({
      linkedChannelId: channelId ? lower(channelId) : null,
      linkedById: channelId ? byUserId : null,
      updatedAt: new Date(),
      lastActivityAt: new Date(),
    }).where(eq(L.id, lobbyId)).returning();
    return row ? { ok: true, lobby: row } : { ok: false, reason: 'gone' };
  } catch (err) {
    if (String((err as { code?: string })?.code ?? '') === '23505' || /unique/i.test(String((err as Error)?.message))) return { ok: false, reason: 'conflict' };
    throw err;
  }
}

/** The lobby linked to a channel, if any. */
export async function lobbyForChannel(channelId: string): Promise<LobbyRow | null> {
  await ensureSocialParitySchema();
  const [row] = await db.select().from(L).where(eq(L.linkedChannelId, lower(channelId))).limit(1);
  return row ?? null;
}

// ─── Members ─────────────────────────────────────────────────────────────────

export async function listMembers(lobbyId: string): Promise<LobbyMemberRow[]> {
  return db.select().from(M).where(eq(M.lobbyId, lobbyId)).orderBy(asc(M.createdAt)).limit(LOBBY_LIMITS.maxMembers);
}

export async function getMember(lobbyId: string, userId: string): Promise<LobbyMemberRow | null> {
  const [row] = await db.select().from(M).where(and(eq(M.lobbyId, lobbyId), eq(M.userId, lower(userId)))).limit(1);
  return row ?? null;
}

export interface UserCheck {
  /** Ids that are not users at all (Discord: 404 Unknown User). */
  unknown: string[];
  /** Users who may be lobby members of this application. */
  eligible: Set<string>;
}

/**
 * Which ids may join the application's lobbies: real, non-bot, non-banned
 * users who authorized the application (OAuth2 consent).
 */
export async function checkLobbyUsers(applicationId: string, ids: string[]): Promise<UserCheck> {
  const uuids = [...new Set(ids.map(lower))].filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id));
  const unknown = ids.filter((id) => !uuids.includes(lower(id)));
  if (uuids.length === 0) return { unknown, eligible: new Set() };
  const U = schema.users;
  const users = await db.select({ id: U.id, isBot: U.isBot, isBanned: U.isBanned }).from(U).where(inArray(U.id, uuids));
  const found = new Set(users.map((u) => lower(u.id)));
  for (const id of uuids) if (!found.has(id)) unknown.push(id);
  const candidates = users.filter((u) => !u.isBot && !u.isBanned).map((u) => lower(u.id));
  const eligible = new Set<string>();
  if (candidates.length > 0) {
    const A = schema.authorizedApps;
    const rows = await db.select({ userId: A.userId }).from(A)
      .where(and(eq(A.applicationId, lower(applicationId)), inArray(A.userId, candidates)));
    for (const r of rows) eligible.add(lower(r.userId));
  }
  return { unknown, eligible };
}

export type UpsertMemberResult =
  | { ok: true; member: LobbyMemberRow; added: boolean }
  | { ok: false; reason: 'lobby_full' | 'user_limit' };

/**
 * Add or update a member. New members respect the 1,000 member cap and the
 * 100 lobbies per user per application cap (checked in the INSERT itself).
 */
export async function upsertMember(lobby: LobbyRow, userId: string, fields: Omit<MemberInput, 'id' | 'remove'>): Promise<UpsertMemberResult> {
  const uid = lower(userId);
  const existing = await getMember(lobby.id, uid);
  if (existing) {
    const set: Partial<typeof M.$inferInsert> = {};
    if (fields.metadata !== undefined) set.metadata = fields.metadata;
    if (fields.flags !== undefined) set.flags = fields.flags;
    if (fields.additionalName !== undefined) set.additionalName = fields.additionalName;
    if (Object.keys(set).length === 0) return { ok: true, member: existing, added: false };
    const [row] = await db.update(M).set(set).where(and(eq(M.lobbyId, lobby.id), eq(M.userId, uid))).returning();
    return { ok: true, member: row ?? existing, added: false };
  }
  const metadata = fields.metadata === undefined ? null : fields.metadata;
  const res = await db.execute(sql`
    INSERT INTO lobby_members (lobby_id, user_id, metadata, flags, additional_name, created_at)
    SELECT ${lobby.id}::uuid, ${uid}::uuid, ${metadata === null ? null : JSON.stringify(metadata)}::jsonb, ${fields.flags ?? 0}, ${fields.additionalName ?? null}, ${new Date().toISOString()}::timestamp
    WHERE (SELECT count(*) FROM lobby_members WHERE lobby_id = ${lobby.id}::uuid) < ${LOBBY_LIMITS.maxMembers}
      AND (SELECT count(*) FROM lobby_members m JOIN lobbies l ON l.id = m.lobby_id
           WHERE m.user_id = ${uid}::uuid AND l.application_id = ${lobby.applicationId}::uuid) < ${LOBBY_LIMITS.lobbiesPerUserPerApp}
    ON CONFLICT (lobby_id, user_id) DO NOTHING
    RETURNING lobby_id
  `);
  const inserted = ((res as { rows?: unknown[] }).rows ?? (Array.isArray(res) ? res : [])).length > 0;
  const member = await getMember(lobby.id, uid);
  if (member) return { ok: true, member, added: inserted };
  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(M).where(eq(M.lobbyId, lobby.id));
  return { ok: false, reason: Number(n) >= LOBBY_LIMITS.maxMembers ? 'lobby_full' : 'user_limit' };
}

export async function removeMembers(lobbyId: string, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  await db.delete(M).where(and(eq(M.lobbyId, lobbyId), inArray(M.userId, userIds.map(lower))));
}

/** Remove every member not in `keep`. */
export async function removeMembersExcept(lobbyId: string, keep: string[]): Promise<void> {
  const keepSet = new Set(keep.map(lower));
  const current = await db.select({ userId: M.userId }).from(M).where(eq(M.lobbyId, lobbyId));
  await removeMembers(lobbyId, current.map((r) => lower(r.userId)).filter((id) => !keepSet.has(id)));
}

// ─── Serialization ───────────────────────────────────────────────────────────

/** The Discord lobby object (members + linked channel), unlinking a channel that no longer exists. */
export async function lobbyView(lobby: LobbyRow) {
  const members = await listMembers(lobby.id);
  let linked: Record<string, unknown> | null = null;
  if (lobby.linkedChannelId) {
    const { Channel } = await import('@/lib/models');
    const channel = await Channel.findById(lobby.linkedChannelId).catch(() => null);
    if (channel) {
      const { toDiscordChannel } = await import('@/lib/services/gatewayEvents');
      // Members may not be in that server: only what identifies the channel,
      // never its topic or permission overwrites.
      const full = toDiscordChannel(channel as never) as Record<string, unknown>;
      linked = { id: full.id, type: full.type, name: full.name, guild_id: full.guild_id };
    } else {
      await setLinkedChannel(lobby.id, null, null).catch(() => {});
    }
  }
  return toDiscordLobby(lobby, members, linked);
}

// ─── Messages ────────────────────────────────────────────────────────────────

async function authorsById(ids: string[]): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  const uniq = [...new Set(ids.map(lower))];
  if (uniq.length === 0) return out;
  const U = schema.users;
  const rows = await db.select({ id: U.id, username: U.username, displayName: U.displayName, avatar: U.avatar, banner: U.banner, isBot: U.isBot })
    .from(U).where(inArray(U.id, uniq));
  const { toDiscordUserRow } = await import('@/lib/services/gatewayEvents');
  for (const r of rows) out.set(lower(r.id), toDiscordUserRow(r));
  return out;
}

const fallbackAuthor = (id: string) => ({ id, username: 'Deleted User', discriminator: '0', global_name: null, avatar: null, bot: false });

/**
 * Store a lobby message (content already sanitized; encrypted here) and prune
 * history older than 72 hours. Returns the Discord lobby message object.
 */
export async function createLobbyMessage(lobby: LobbyRow, opts: {
  authorId: string;
  content: string;
  flags: number;
  additionalName: string | null;
  metadata: Metadata | null | undefined;
  nonce?: string | number | null;
}): Promise<Record<string, unknown>> {
  const [row] = await db.insert(MSG).values({
    lobbyId: lobby.id,
    applicationId: lobby.applicationId,
    authorId: lower(opts.authorId),
    content: await encryptForStorage(opts.content),
    flags: opts.flags,
    additionalName: opts.additionalName,
    createdAt: new Date(),
  }).returning();
  void db.delete(MSG).where(and(eq(MSG.lobbyId, lobby.id), lt(MSG.createdAt, new Date(Date.now() - LOBBY_LIMITS.historyMs)))).catch(() => {});
  void touchLobby(lobby.id);
  const authors = await authorsById([row.authorId]);
  return toDiscordLobbyMessage(row, opts.content, authors.get(lower(row.authorId)) ?? fallbackAuthor(row.authorId), { metadata: opts.metadata ?? null, nonce: opts.nonce ?? null });
}

/** One stored lobby message (the enforce_nonce replay), or null. */
export async function getLobbyMessage(lobbyId: string, messageId: string): Promise<Record<string, unknown> | null> {
  const [row] = await db.select().from(MSG).where(and(eq(MSG.id, lower(messageId)), eq(MSG.lobbyId, lobbyId))).limit(1);
  if (!row) return null;
  const [authors, content] = await Promise.all([
    authorsById([row.authorId]),
    row.content ? decryptFromStorage(row.content).catch(() => '') : Promise.resolve(''),
  ]);
  return toDiscordLobbyMessage(row, content, authors.get(lower(row.authorId)) ?? fallbackAuthor(row.authorId));
}

/** The most recent `limit` messages of the last 72 hours, newest first. */
export async function listLobbyMessages(lobbyId: string, limit: number): Promise<Record<string, unknown>[]> {
  const rows = await db.select().from(MSG)
    .where(and(eq(MSG.lobbyId, lobbyId), gte(MSG.createdAt, new Date(Date.now() - LOBBY_LIMITS.historyMs))))
    .orderBy(desc(MSG.createdAt)).limit(limit);
  const [authors, contents] = await Promise.all([
    authorsById(rows.map((r) => r.authorId)),
    Promise.all(rows.map((r) => (r.content ? decryptFromStorage(r.content).catch(() => '') : Promise.resolve('')))),
  ]);
  return rows.map((r, i) => toDiscordLobbyMessage(r, contents[i], authors.get(lower(r.authorId)) ?? fallbackAuthor(r.authorId)));
}

/** Set a lobby message's moderation metadata. False when the message isn't in that lobby. */
export async function setLobbyMessageModeration(lobbyId: string, messageId: string, metadata: Metadata): Promise<boolean> {
  const rows = await db.update(MSG).set({ moderationMetadata: metadata })
    .where(and(eq(MSG.id, lower(messageId)), eq(MSG.lobbyId, lobbyId))).returning({ id: MSG.id });
  return rows.length > 0;
}
