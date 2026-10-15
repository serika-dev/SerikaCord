/**
 * UUID <-> snowflake mapping store for the bot API (section 4.1 of
 * docs/architecture/discord-parity.md).
 *
 * One row per entity a snowflake-format bot has seen, created lazily the first
 * time the entity leaves the API (`INSERT ... ON CONFLICT DO NOTHING`). The
 * snowflake's timestamp is the entity's real creation time (message
 * `timestamp`, or `created_at` from its table), so libraries derive correct
 * `createdAt` values and ordering by id matches ordering by time.
 *
 * Lookups go: process BoundedMap -> Redis (`sf:u2s:<uuid>`, `sf:s2u:<sf>`) ->
 * Postgres, batched (one query per payload). Mappings never change, so caches
 * need no invalidation.
 *
 * Special cases:
 *  - An application's snowflake is its numeric OAuth2 `client_id` (Discord:
 *    application id == client id), so install links and interaction
 *    `application_id`s agree with READY.
 *  - A server's @everyone role has no row of its own: outbound it becomes the
 *    guild's snowflake (Discord: @everyone id == guild id) and inbound the
 *    guild snowflake in a role position resolves back to that role.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/postgres';
import { getRedis } from '@/lib/db/redis';
import { BoundedMap } from '@/lib/utils/boundedMap';
import { processShared } from '@/lib/realtime/processShared';
import { candidateSnowflake, isSnowflake } from './snowflake';

/** `api_snowflakes.kind` values. */
export const SF_KIND = {
  unknown: 0,
  user: 1,
  guild: 2,
  channel: 3,
  message: 4,
  role: 5,
  emoji: 6,
  sticker: 7,
  webhook: 8,
  application: 9,
  command: 10,
  attachment: 11,
  interaction: 12,
  event: 13,
  automodRule: 14,
  auditEntry: 15,
  sku: 16,
  integration: 17,
  tag: 18,
} as const;

/** Most new mapping rows one payload may create. */
export const MAX_NEW_PER_PAYLOAD = 2000;

// ─── Schema ───────────────────────────────────────────────────────────────────

const g = globalThis as unknown as { __apiSnowflakeSchema?: Promise<void> | null };

/**
 * Idempotent boot-time DDL (same statements as drizzle/manual_api_snowflakes.sql).
 * Never throws; retries with a short lock timeout so it never queues behind a
 * long transaction on the shared production database.
 */
export function ensureApiSnowflakeSchema(): Promise<void> {
  if (g.__apiSnowflakeSchema) return g.__apiSnowflakeSchema;
  g.__apiSnowflakeSchema = (async () => {
    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        await db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
          await tx.execute(sql`CREATE TABLE IF NOT EXISTS api_snowflakes (
            snowflake bigint PRIMARY KEY,
            kind smallint NOT NULL DEFAULT 0,
            uuid uuid NOT NULL,
            created_at timestamp DEFAULT now()
          )`);
          await tx.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS api_snowflakes_uuid_unique ON api_snowflakes (uuid)`);
        });
        await db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
          await tx.execute(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS api_id_format text`);
        });
        return;
      } catch (err) {
        console.error(`[snowflakes] Ensuring api_snowflakes schema failed (attempt ${attempt}):`, (err as Error)?.message ?? err);
        await new Promise((r) => setTimeout(r, Math.min(30_000, 2_000 * attempt)));
      }
    }
    g.__apiSnowflakeSchema = null;
  })();
  return g.__apiSnowflakeSchema;
}

// ─── Caches ───────────────────────────────────────────────────────────────────

/** uuid -> snowflake. For @everyone roles the value is the guild's snowflake. */
const u2s = processShared('sf:u2s', () => new BoundedMap<string, string>(100_000));
/** snowflake -> { uuid, kind } */
const s2u = processShared('sf:s2u', () => new BoundedMap<string, { uuid: string; kind: number }>(100_000));
/** @everyone role uuids (their snowflake is the guild's). */
const everyoneRoles = processShared('sf:everyone', () => new BoundedMap<string, true>(20_000));
/** UUIDs recently found in no table (not minted): uuid -> when (ms). Skips repeat lookups. */
const unverified = processShared('sf:unverified', () => new BoundedMap<string, number>(50_000));
const UNVERIFIED_TTL_MS = 10 * 60_000;
/** server uuid -> its @everyone role uuid. */
const everyoneByServer = processShared('sf:everyoneByServer', () => new BoundedMap<string, string>(20_000));

const REDIS_TTL = 60 * 60 * 24 * 30;
const lower = (s: string) => s.toLowerCase();

function remember(uuid: string, sf: string, kind: number) {
  u2s.set(uuid, sf);
  s2u.set(sf, { uuid, kind });
}

async function redisGetMany(keys: string[]): Promise<(string | null)[]> {
  const redis = getRedis();
  if (!redis || keys.length === 0) return keys.map(() => null);
  try {
    return await redis.mget(...keys);
  } catch {
    return keys.map(() => null);
  }
}

function redisSetMany(entries: Array<[string, string]>) {
  const redis = getRedis();
  if (!redis || entries.length === 0) return;
  try {
    const p = redis.pipeline();
    for (const [k, v] of entries) p.set(k, v, 'EX', REDIS_TTL);
    void p.exec().catch(() => {});
  } catch { /* best-effort */ }
}

type Row = Record<string, unknown>;

/**
 * A Postgres array literal for one bound parameter (drizzle expands a JS array
 * in a sql template into a row of params). Only uuids / digits / small ints
 * ever reach here; anything else is dropped.
 */
function pgArray(values: Array<string | number>): string {
  const safe = values.map(String).filter((v) => /^[0-9a-fA-F-]{1,36}$/.test(v));
  return `{${safe.join(',')}}`;
}
const rowsOf = (r: unknown): Row[] => ((r as { rows?: Row[] })?.rows ?? (Array.isArray(r) ? (r as Row[]) : []));

// ─── UUID -> snowflake ────────────────────────────────────────────────────────

export interface ResolvedOutbound {
  /** lower-case uuid -> snowflake */
  map: Map<string, string>;
  /** @everyone role uuids in the payload */
  everyone: Set<string>;
}

interface Origin { ts: number; kind: number; clientId?: string | null; everyoneOf?: string | null }

/**
 * Snowflakes for a batch of UUIDs, minting rows for new ones. `hints` gives
 * creation times already known from the payload (saves a lookup).
 */
export async function snowflakesForUuids(
  uuidsIn: Iterable<string>,
  hints?: Map<string, { ts: number }>,
  /** Kinds proven by position (attachments, tags, interactions): minted without a table hit. */
  structural?: Map<string, number>,
): Promise<ResolvedOutbound> {
  const map = new Map<string, string>();
  const everyone = new Set<string>();
  const want = [...new Set([...uuidsIn].map(lower))];
  if (want.length === 0) return { map, everyone };

  // 1. Process cache.
  let missing: string[] = [];
  for (const u of want) {
    const sf = u2s.get(u);
    if (sf) { map.set(u, sf); if (everyoneRoles.has(u)) everyone.add(u); } else missing.push(u);
  }
  if (missing.length === 0) return { map, everyone };

  // 2. Redis.
  const cached = await redisGetMany(missing.map((u) => `sf:u2s:${u}`));
  const stillMissing: string[] = [];
  missing.forEach((u, i) => {
    const v = cached[i];
    if (v && v.startsWith('e:')) {
      const sf = v.slice(2);
      u2s.set(u, sf); everyoneRoles.set(u, true); map.set(u, sf); everyone.add(u);
    } else if (v && isSnowflake(v)) {
      u2s.set(u, v); map.set(u, v);
    } else stillMissing.push(u);
  });
  missing = stillMissing;
  if (missing.length === 0) return { map, everyone };

  // 3. Postgres mapping table.
  try {
    const found = rowsOf(await db.execute(sql`SELECT snowflake::text AS sf, uuid::text AS uuid, kind FROM api_snowflakes WHERE uuid = ANY(${pgArray(missing)}::uuid[])`));
    const toRedis: Array<[string, string]> = [];
    for (const r of found) {
      const u = lower(String(r.uuid)); const sf = String(r.sf);
      remember(u, sf, Number(r.kind) || 0); map.set(u, sf);
      toRedis.push([`sf:u2s:${u}`, sf], [`sf:s2u:${sf}`, `${Number(r.kind) || 0}:${u}`]);
    }
    redisSetMany(toRedis);
    missing = missing.filter((u) => !map.has(u));
  } catch (err) {
    console.error('[snowflakes] lookup failed:', (err as Error)?.message ?? err);
    return { map, everyone };
  }
  if (missing.length === 0) return { map, everyone };

  // 4. New entities: find their creation time and kind, then mint rows. Ids
  // that recently matched no table are skipped (a fake <#uuid> in text must
  // not cost a lookup per dispatch), and one payload mints a bounded number.
  const now = Date.now();
  missing = missing.filter((u) => {
    const at = unverified.get(u);
    return !(at && now - at < UNVERIFIED_TTL_MS) || structural?.has(u);
  }).slice(0, MAX_NEW_PER_PAYLOAD);
  if (missing.length === 0) return { map, everyone };
  const origins = await originsOf(missing, hints, structural);

  // @everyone roles borrow the guild's snowflake.
  const everyoneRoleIds = missing.filter((u) => origins.get(u)?.everyoneOf);
  if (everyoneRoleIds.length > 0) {
    const servers = everyoneRoleIds.map((u) => origins.get(u)!.everyoneOf!);
    const res = await snowflakesForUuids(servers);
    const toRedis: Array<[string, string]> = [];
    for (const u of everyoneRoleIds) {
      const server = origins.get(u)!.everyoneOf!;
      const sf = res.map.get(server);
      if (!sf) continue;
      u2s.set(u, sf); everyoneRoles.set(u, true); everyoneByServer.set(server, u);
      map.set(u, sf); everyone.add(u);
      toRedis.push([`sf:u2s:${u}`, `e:${sf}`], [`sf:everyone:${server}`, u]);
    }
    redisSetMany(toRedis);
  }

  // Only entities that exist get a row: a table hit, or a structural kind.
  // Unknown ids (e.g. made-up tokens in message text) stay untranslated.
  const toMint = missing.filter((u) => {
    if (everyone.has(u)) return false;
    if ((origins.get(u)?.kind ?? SF_KIND.unknown) !== SF_KIND.unknown) return true;
    unverified.set(u, now);
    return false;
  });
  if (toMint.length > 0) {
    const minted = await mint(toMint, origins);
    for (const [u, sf] of minted) map.set(u, sf);
  }
  return { map, everyone };
}

/** Creation time + kind for UUIDs not mapped yet (hints first, then one lookup per table group). */
async function originsOf(
  uuids: string[],
  hints?: Map<string, { ts: number }>,
  structural?: Map<string, number>,
): Promise<Map<string, Origin>> {
  const out = new Map<string, Origin>();
  // Structural kinds need no lookup; a message `timestamp` hint gives the time
  // but its existence is still checked against the tables.
  for (const u of uuids) {
    const k = structural?.get(u);
    if (k) out.set(u, { ts: hints?.get(u)?.ts ?? Date.now(), kind: k });
  }
  const need = uuids.filter((u) => !out.has(u));
  if (need.length === 0) return out;

  const take = (rows: Row[]) => {
    for (const r of rows) {
      const u = lower(String(r.id));
      // timestamp columns hold UTC without a zone: read epoch ms from SQL, not a JS Date.
      const created = r.created_ms ? Number(r.created_ms) : NaN;
      out.set(u, {
        ts: hints?.get(u)?.ts ?? (Number.isFinite(created) ? created : Date.now()),
        kind: Number(r.kind) || SF_KIND.unknown,
        clientId: (r.client_id as string | null) ?? null,
        everyoneOf: r.is_default ? lower(String(r.server_id)) : null,
      });
    }
  };

  try {
    // Tables that always exist (created by the generated migrations).
    take(rowsOf(await db.execute(sql`
      SELECT id::text AS id, (extract(epoch FROM created_at) * 1000)::bigint::text AS created_ms, 1 AS kind, NULL::text AS client_id, NULL::uuid AS server_id, false AS is_default FROM users WHERE id = ANY(${pgArray(need)}::uuid[])
      UNION ALL SELECT id::text, (extract(epoch FROM created_at) * 1000)::bigint::text, 2, NULL, NULL, false FROM servers WHERE id = ANY(${pgArray(need)}::uuid[])
      UNION ALL SELECT id::text, (extract(epoch FROM created_at) * 1000)::bigint::text, 3, NULL, NULL, false FROM channels WHERE id = ANY(${pgArray(need)}::uuid[])
      UNION ALL SELECT id::text, (extract(epoch FROM created_at) * 1000)::bigint::text, 4, NULL, NULL, false FROM messages WHERE id = ANY(${pgArray(need)}::uuid[])
      UNION ALL SELECT id::text, (extract(epoch FROM created_at) * 1000)::bigint::text, 5, NULL, server_id, is_default FROM roles WHERE id = ANY(${pgArray(need)}::uuid[])
      UNION ALL SELECT id::text, (extract(epoch FROM created_at) * 1000)::bigint::text, 6, NULL, NULL, false FROM server_emojis WHERE id = ANY(${pgArray(need)}::uuid[])
      UNION ALL SELECT id::text, (extract(epoch FROM created_at) * 1000)::bigint::text, 7, NULL, NULL, false FROM server_stickers WHERE id = ANY(${pgArray(need)}::uuid[])
      UNION ALL SELECT id::text, (extract(epoch FROM created_at) * 1000)::bigint::text, 8, NULL, NULL, false FROM channel_webhooks WHERE id = ANY(${pgArray(need)}::uuid[])
      UNION ALL SELECT id::text, (extract(epoch FROM created_at) * 1000)::bigint::text, 9, client_id, NULL, false FROM applications WHERE id = ANY(${pgArray(need)}::uuid[])
      UNION ALL SELECT id::text, (extract(epoch FROM created_at) * 1000)::bigint::text, 10, NULL, NULL, false FROM app_commands WHERE id = ANY(${pgArray(need)}::uuid[])
      UNION ALL SELECT id::text, (extract(epoch FROM created_at) * 1000)::bigint::text, 6, NULL, NULL, false FROM app_emojis WHERE id = ANY(${pgArray(need)}::uuid[])
    `)));
  } catch (err) {
    console.error('[snowflakes] origin lookup failed:', (err as Error)?.message ?? err);
  }
  const rest = need.filter((u) => !out.has(u) || out.get(u)!.kind === SF_KIND.unknown);
  if (rest.length > 0) {
    // Tables created at boot by ensure* functions; tolerate their absence.
    try {
      take(rowsOf(await db.execute(sql`
        SELECT id::text AS id, (extract(epoch FROM created_at) * 1000)::bigint::text AS created_ms, 13 AS kind, NULL::text AS client_id, NULL::uuid AS server_id, false AS is_default FROM server_scheduled_events WHERE id = ANY(${pgArray(rest)}::uuid[])
        UNION ALL SELECT id::text, (extract(epoch FROM created_at) * 1000)::bigint::text, 14, NULL, NULL, false FROM automod_rules WHERE id = ANY(${pgArray(rest)}::uuid[])
        UNION ALL SELECT id::text, (extract(epoch FROM created_at) * 1000)::bigint::text, 15, NULL, NULL, false FROM server_audit_logs WHERE id = ANY(${pgArray(rest)}::uuid[])
      `)));
    } catch { /* optional tables */ }
  }
  for (const u of uuids) if (!out.has(u)) out.set(u, { ts: Date.now(), kind: SF_KIND.unknown });
  return out;
}

/** Cached snowflake for a uuid (process cache only, no I/O). */
export function cachedSnowflakeOf(uuid: string): string | undefined {
  return u2s.get(lower(uuid));
}

/** Whether a uuid is a cached @everyone role (process cache only). */
export function isCachedEveryoneRole(uuid: string): boolean {
  return everyoneRoles.has(lower(uuid));
}

/** Insert mapping rows, retrying a candidate that collides with another entity's snowflake. */
async function mint(uuids: string[], origins: Map<string, Origin>): Promise<Map<string, string>> {
  const done = new Map<string, string>();
  let pending = uuids;
  for (let attempt = 0; attempt < 8 && pending.length > 0; attempt++) {
    const sfs: string[] = [];
    const kinds: number[] = [];
    for (const u of pending) {
      const o = origins.get(u)!;
      // Applications use their numeric client id (== Discord application id).
      const sf = attempt === 0 && o.kind === SF_KIND.application && o.clientId && isSnowflake(o.clientId)
        ? o.clientId
        : candidateSnowflake(u, o.ts, attempt);
      sfs.push(sf);
      kinds.push(o.kind);
    }
    try {
      await db.execute(sql`
        INSERT INTO api_snowflakes (snowflake, kind, uuid)
        SELECT * FROM unnest(${pgArray(sfs)}::bigint[], ${pgArray(kinds)}::smallint[], ${pgArray(pending)}::uuid[])
        ON CONFLICT DO NOTHING
      `);
      // Whatever row now exists for each uuid wins (ours, or a concurrent writer's).
      const rows = rowsOf(await db.execute(sql`SELECT snowflake::text AS sf, uuid::text AS uuid, kind FROM api_snowflakes WHERE uuid = ANY(${pgArray(pending)}::uuid[])`));
      const toRedis: Array<[string, string]> = [];
      for (const r of rows) {
        const u = lower(String(r.uuid)); const sf = String(r.sf); const kind = Number(r.kind) || 0;
        remember(u, sf, kind); done.set(u, sf);
        toRedis.push([`sf:u2s:${u}`, sf], [`sf:s2u:${sf}`, `${kind}:${u}`]);
      }
      redisSetMany(toRedis);
    } catch (err) {
      console.error('[snowflakes] mint failed:', (err as Error)?.message ?? err);
      break;
    }
    pending = pending.filter((u) => !done.has(u));
  }
  return done;
}

// ─── Snowflake -> UUID ────────────────────────────────────────────────────────

export interface ResolvedInbound {
  /** snowflake -> { uuid, kind } for known snowflakes */
  map: Map<string, { uuid: string; kind: number }>;
}

/** UUIDs for a batch of snowflakes (unknown ones are absent from the map). */
export async function uuidsForSnowflakes(sfsIn: Iterable<string>): Promise<ResolvedInbound> {
  const map = new Map<string, { uuid: string; kind: number }>();
  const want = [...new Set([...sfsIn].filter(isSnowflake))];
  if (want.length === 0) return { map };
  let missing: string[] = [];
  for (const sf of want) {
    const hit = s2u.get(sf);
    if (hit) map.set(sf, hit); else missing.push(sf);
  }
  if (missing.length === 0) return { map };
  const cached = await redisGetMany(missing.map((sf) => `sf:s2u:${sf}`));
  const still: string[] = [];
  missing.forEach((sf, i) => {
    const v = cached[i];
    const m = v ? /^(\d+):([0-9a-f-]{36})$/.exec(v) : null;
    if (m) { const e = { uuid: m[2], kind: Number(m[1]) }; s2u.set(sf, e); map.set(sf, e); } else still.push(sf);
  });
  missing = still;
  if (missing.length === 0) return { map };
  try {
    const rows = rowsOf(await db.execute(sql`SELECT snowflake::text AS sf, uuid::text AS uuid, kind FROM api_snowflakes WHERE snowflake = ANY(${pgArray(missing)}::bigint[])`));
    const toRedis: Array<[string, string]> = [];
    for (const r of rows) {
      const sf = String(r.sf); const u = lower(String(r.uuid)); const kind = Number(r.kind) || 0;
      remember(u, sf, kind); map.set(sf, { uuid: u, kind });
      toRedis.push([`sf:s2u:${sf}`, `${kind}:${u}`], [`sf:u2s:${u}`, sf]);
    }
    redisSetMany(toRedis);
  } catch (err) {
    console.error('[snowflakes] reverse lookup failed:', (err as Error)?.message ?? err);
  }
  return { map };
}

/** A server's @everyone role uuid (role positions that name the guild id). */
export async function everyoneRoleOf(serverUuid: string): Promise<string | null> {
  const s = lower(serverUuid);
  const hit = everyoneByServer.get(s);
  if (hit) return hit;
  const [cached] = await redisGetMany([`sf:everyone:${s}`]);
  if (cached) { everyoneByServer.set(s, cached); return cached; }
  try {
    const rows = rowsOf(await db.execute(sql`SELECT id::text AS id FROM roles WHERE server_id = ${s}::uuid AND is_default = true LIMIT 1`));
    const id = rows[0]?.id ? lower(String(rows[0].id)) : null;
    if (id) { everyoneByServer.set(s, id); redisSetMany([[`sf:everyone:${s}`, id]]); }
    return id;
  } catch {
    return null;
  }
}

/**
 * Inbound application ids: the numeric client id of an application that has
 * not been exposed yet (so has no mapping row) resolves through its client id.
 */
export async function applicationByClientId(clientId: string): Promise<string | null> {
  if (!isSnowflake(clientId)) return null;
  try {
    const rows = rowsOf(await db.execute(sql`SELECT id::text AS id FROM applications WHERE client_id = ${clientId} LIMIT 1`));
    const id = rows[0]?.id ? lower(String(rows[0].id)) : null;
    if (id) await snowflakesForUuids([id]);
    return id;
  } catch {
    return null;
  }
}
