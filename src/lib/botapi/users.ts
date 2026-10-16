/**
 * Current-user routes of the Discord-compatible API (bots and OAuth2 Bearer
 * users): GET /users/@me/guilds (partial guilds, cursor pagination,
 * with_counts), GET /users/@me/connections, and the PATCH /users/@me body
 * rules for bots. The pure parts (query parsing, body validation,
 * connection mapping) are unit tested in tests/bot-users.test.ts.
 */
import { and, asc, desc, eq, gt, inArray, lt, or, type SQL } from 'drizzle-orm';
import { computeGuildStanding } from '@/lib/permissions/botGuild';

// ─── GET /users/@me/guilds ───────────────────────────────────────────────────

export interface GuildPageQuery {
  before: string | null;
  after: string | null;
  limit: number;
  withCounts: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Discord: limit 1-200 (default 200), before/after guild ids, with_counts boolean. */
export function parseGuildPageQuery(q: Record<string, unknown> | null | undefined): GuildPageQuery | { error: string } {
  const query = q ?? {};
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  let limit = 200;
  if (query.limit !== undefined && query.limit !== '') {
    const n = Number(str(query.limit));
    if (!Number.isInteger(n) || n < 1 || n > 200) return { error: 'limit' };
    limit = n;
  }
  const before = str(query.before) || null;
  const after = str(query.after) || null;
  // Ids reach here as UUIDs (the snowflake boundary translated them); an
  // unknown snowflake stays digits and matches nothing, like Discord.
  const okId = (v: string | null) => v === null || UUID_RE.test(v) || /^\d{1,20}$/.test(v);
  if (!okId(before)) return { error: 'before' };
  if (!okId(after)) return { error: 'after' };
  const wc = str(query.with_counts).toLowerCase();
  return { before, after, limit, withCounts: wc === 'true' || wc === '1' };
}

interface ServerRow {
  id: string;
  name: string;
  icon: string | null;
  banner: string | null;
  ownerId: string;
  features: string[] | null;
  memberCount: number | null;
  onlineCount: number | null;
  createdAt: Date | null;
}

/** Discord's partial guild for GET /users/@me/guilds. */
export function partialGuild(s: ServerRow, viewerId: string, perms: bigint, withCounts: boolean) {
  return {
    id: s.id,
    name: s.name,
    icon: s.icon ?? null,
    banner: s.banner ?? null,
    owner: s.ownerId.toLowerCase() === viewerId.toLowerCase(),
    permissions: perms.toString(),
    features: s.features ?? [],
    ...(withCounts ? { approximate_member_count: s.memberCount ?? 0, approximate_presence_count: s.onlineCount ?? 0 } : {}),
  };
}

/**
 * One page of the guilds `userId` is in, in snowflake order (snowflakes are
 * derived from created_at, so created_at then id), honouring before / after.
 */
export async function listCurrentUserGuilds(userId: string, q: GuildPageQuery) {
  const { db, schema } = await import('@/lib/db/postgres');
  const s = schema.servers;
  const m = schema.serverMembers;

  const cursorOf = async (id: string | null) => {
    if (!id || !UUID_RE.test(id)) return id ? 'none' as const : null;
    const rows = await db.select({ id: s.id, createdAt: s.createdAt }).from(s).where(eq(s.id, id)).limit(1);
    return rows[0] ? { id: rows[0].id, at: rows[0].createdAt ?? new Date(0) } : 'none' as const;
  };
  const [after, before] = await Promise.all([cursorOf(q.after), cursorOf(q.before)]);
  if (after === 'none' || before === 'none') return [];

  const conds: SQL[] = [eq(m.userId, userId)];
  if (after) conds.push(or(gt(s.createdAt, after.at), and(eq(s.createdAt, after.at), gt(s.id, after.id)))!);
  if (before) conds.push(or(lt(s.createdAt, before.at), and(eq(s.createdAt, before.at), lt(s.id, before.id)))!);
  // `before` alone pages backwards (closest first), then the page is re-sorted ascending.
  const backwards = !!before && !after;
  const rows = await db.select({
    server: {
      id: s.id, name: s.name, icon: s.icon, banner: s.banner, ownerId: s.ownerId, features: s.features,
      memberCount: s.memberCount, onlineCount: s.onlineCount, createdAt: s.createdAt,
    },
    roleIds: m.roles,
  })
    .from(m)
    .innerJoin(s, eq(s.id, m.serverId))
    .where(and(...conds))
    .orderBy(...(backwards ? [desc(s.createdAt), desc(s.id)] : [asc(s.createdAt), asc(s.id)]))
    .limit(q.limit);
  if (backwards) rows.reverse();
  if (rows.length === 0) return [];

  const roles = await db.select({ id: schema.roles.id, serverId: schema.roles.serverId, permissions: schema.roles.permissions, isDefault: schema.roles.isDefault, position: schema.roles.position })
    .from(schema.roles)
    .where(inArray(schema.roles.serverId, rows.map((r) => r.server.id)));
  const byServer = new Map<string, typeof roles>();
  for (const r of roles) {
    const list = byServer.get(r.serverId);
    if (list) list.push(r);
    else byServer.set(r.serverId, [r]);
  }
  return rows.map((r) => {
    const isOwner = r.server.ownerId.toLowerCase() === userId.toLowerCase();
    const standing = computeGuildStanding(byServer.get(r.server.id) ?? [], r.roleIds ?? [], isOwner);
    return partialGuild(r.server, userId, standing.perms, q.withCounts);
  });
}

// ─── GET /users/@me/connections ──────────────────────────────────────────────

/** Serika connection providers -> Discord connection `type`. */
const CONNECTION_TYPES: Record<string, string> = {
  psn: 'playstation',
  website: 'domain',
};

interface ConnectionRow {
  id: string;
  provider: string;
  accountId: string;
  username?: string | null;
  displayName?: string | null;
  visible?: boolean | null;
}

/** Discord's connection object (no tokens, no metadata). */
export function discordConnection(c: ConnectionRow) {
  return {
    id: c.accountId,
    name: c.displayName || c.username || c.accountId,
    type: CONNECTION_TYPES[c.provider] ?? c.provider,
    verified: true,
    friend_sync: false,
    show_activity: true,
    two_way_link: false,
    visibility: c.visible === false ? 0 : 1,
  };
}

export async function listConnections(userId: string) {
  const { db, schema } = await import('@/lib/db/postgres');
  const t = schema.userConnections;
  const rows = await db.select({ id: t.id, provider: t.provider, accountId: t.accountId, username: t.username, displayName: t.displayName, visible: t.visible })
    .from(t).where(eq(t.userId, userId)).limit(100);
  // Serika's own account link is an identity, not a third-party connection.
  return rows.filter((r) => r.provider !== 'serika').map(discordConnection);
}

// ─── PATCH /users/@me (bots) ─────────────────────────────────────────────────

export type ImageField = { kind: 'set'; mime: string; data: Buffer } | { kind: 'clear' };

export interface BotUserPatch {
  username?: string;
  avatar?: ImageField;
  banner?: ImageField;
}

export interface PatchError { path: string; code: string; message: string }

/** Discord's avatar / banner upload limit (10 MiB of image data). */
export const MAX_PROFILE_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
/** Names Discord refuses in usernames (and we reserve). */
const RESERVED_NAMES = ['everyone', 'here', 'discord', 'serika', 'clyde', 'system'];

/** `data:image/png;base64,...` -> bytes (null when malformed / not an image / too big). */
export function parseImageDataUri(v: string): { mime: string; data: Buffer } | null | 'too_big' {
  const m = /^data:(image\/(?:png|jpeg|jpg|gif|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(v);
  if (!m) return null;
  const mime = m[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : m[1].toLowerCase();
  if (!IMAGE_MIME.has(mime)) return null;
  const b64 = m[2].replace(/\s+/g, '');
  if (b64.length * 0.75 > MAX_PROFILE_IMAGE_BYTES + 4) return 'too_big';
  const data = Buffer.from(b64, 'base64');
  if (data.length === 0) return null;
  if (data.length > MAX_PROFILE_IMAGE_BYTES) return 'too_big';
  // Magic bytes must match the declared type.
  const sig = data.subarray(0, 12);
  const ok =
    (mime === 'image/png' && sig[0] === 0x89 && sig[1] === 0x50 && sig[2] === 0x4e && sig[3] === 0x47) ||
    (mime === 'image/jpeg' && sig[0] === 0xff && sig[1] === 0xd8) ||
    (mime === 'image/gif' && sig.subarray(0, 4).toString('latin1') === 'GIF8') ||
    (mime === 'image/webp' && sig.subarray(0, 4).toString('latin1') === 'RIFF' && sig.subarray(8, 12).toString('latin1') === 'WEBP');
  return ok ? { mime, data } : null;
}

/** Validate a bot's PATCH /users/@me body (username / avatar / banner). */
export function parseBotUserPatch(body: unknown): { ok: true; patch: BotUserPatch } | { ok: false; errors: PatchError[] } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const errors: PatchError[] = [];
  const patch: BotUserPatch = {};
  if (b.username !== undefined) {
    if (typeof b.username !== 'string') errors.push({ path: 'username', code: 'BASE_TYPE_STRING', message: 'Must be a string.' });
    else {
      // Serika usernames are unique handles: 2-32 of a-z 0-9 _ . (stored lower-case).
      const name = b.username.trim().toLowerCase();
      if (name.length < 2 || name.length > 32) errors.push({ path: 'username', code: 'BASE_TYPE_BAD_LENGTH', message: 'Must be between 2 and 32 in length.' });
      else if (!/^[a-z0-9_.]+$/.test(name)) errors.push({ path: 'username', code: 'USERNAME_INVALID_CONTAINS', message: 'Username can only use letters, numbers, underscores and periods.' });
      else if (RESERVED_NAMES.includes(name) || name.includes('discord')) errors.push({ path: 'username', code: 'USERNAME_INVALID', message: 'Username is not allowed.' });
      else patch.username = name;
    }
  }
  for (const key of ['avatar', 'banner'] as const) {
    const v = b[key];
    if (v === undefined) continue;
    if (v === null) { patch[key] = { kind: 'clear' }; continue; }
    if (typeof v !== 'string') { errors.push({ path: key, code: 'BASE_TYPE_STRING', message: 'Must be a string.' }); continue; }
    const img = parseImageDataUri(v);
    if (img === 'too_big') errors.push({ path: key, code: 'BINARY_TYPE_MAX_SIZE', message: 'File cannot be larger than 10240.0 kb.' });
    else if (!img) errors.push({ path: key, code: 'IMAGE_INVALID', message: 'Invalid image data' });
    else patch[key] = { kind: 'set', ...img };
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, patch };
}
