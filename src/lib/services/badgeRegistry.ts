import { sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { cache } from '@/lib/db';
import { Badge, type IBadge } from '@/lib/models/Badge';
import { DEFAULT_BADGES } from '@/lib/constants/badges';
import type { BadgeDefinition } from '@/lib/badges/shared';

// Cached read access to the `badges` table. Badge definitions are read on every
// profile/admin badge request but change only when staff edit them, so they
// sit behind two layers:
//   • an in-process copy (LOCAL_TTL_MS) — no network hop at all on hot paths;
//   • Redis (REDIS_TTL_S) — shared across server processes.
// Writes call invalidateBadgeCache(), which clears this process immediately and
// Redis for everyone; other processes pick the change up within LOCAL_TTL_MS.
// If the database is unreachable (or the table is missing) we fall back to the
// built-in constants so badges keep rendering.

const REDIS_KEY = 'badges:definitions:v1';
const REDIS_TTL_S = 120;
const LOCAL_TTL_MS = 15_000;
// After a failed DB read, serve the fallback for this long before retrying.
const FAILURE_BACKOFF_MS = 5_000;

export interface BadgeRegistry {
  list: BadgeDefinition[];
  byId: Map<string, BadgeDefinition>;
  /** False when serving the built-in fallback because the DB read failed. */
  authoritative: boolean;
}

interface RegistryGlobal {
  __badgeRegistry?: { at: number; registry: BadgeRegistry };
  __badgeRegistryInflight?: Promise<BadgeRegistry> | null;
  __badgeTableEnsured?: Promise<void> | null;
}

// globalThis so Next dev HMR reloads don't drop the cache / re-run the ensure.
const g = globalThis as unknown as RegistryGlobal;

function rowToDefinition(row: IBadge): BadgeDefinition {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    icon: row.icon ?? null,
    iconUrl: row.iconUrl ?? null,
    color: row.color,
    priority: row.priority,
    automatic: row.automatic,
    hidden: row.hidden,
  };
}

function buildRegistry(list: BadgeDefinition[], authoritative: boolean): BadgeRegistry {
  return { list, byId: new Map(list.map((b) => [b.id, b])), authoritative };
}

// Built-in ids are load-bearing (admin auth checks 'admin' /
// 'serikacord_developer'; recalculateUserBadges drops ids it can't resolve), so
// a DB read that somehow lacks one (seed failed, row removed by hand) must not
// make it "unknown" — fill any gap from the constants.
function withBuiltins(list: BadgeDefinition[]): BadgeDefinition[] {
  const have = new Set(list.map((b) => b.id));
  const missing = DEFAULT_BADGES.filter((b) => !have.has(b.id));
  return missing.length === 0 ? list : [...list, ...missing.map((b) => ({ ...b }))];
}

const FALLBACK_REGISTRY = buildRegistry(DEFAULT_BADGES.map((b) => ({ ...b })), false);

async function loadFromDb(): Promise<BadgeRegistry> {
  try {
    const rows = await Badge.list();
    const list = withBuiltins(rows.map(rowToDefinition));
    await cache.set(REDIS_KEY, list, REDIS_TTL_S);
    return buildRegistry(list, true);
  } catch (err) {
    console.error('[badges] Failed to load badge definitions, using built-in fallback:', err);
    const stale = g.__badgeRegistry?.registry;
    return stale ?? FALLBACK_REGISTRY;
  }
}

/**
 * All badge definitions (including hidden ones), cached.
 * Pass `{ fresh: true }` to bypass both cache layers (admin writes/validation).
 */
export async function getBadgeRegistry(opts: { fresh?: boolean } = {}): Promise<BadgeRegistry> {
  const now = Date.now();
  const local = g.__badgeRegistry;
  if (!opts.fresh && local && now - local.at < LOCAL_TTL_MS) return local.registry;

  if (!opts.fresh) {
    if (g.__badgeRegistryInflight) return g.__badgeRegistryInflight;
  }

  const load = (async () => {
    if (!opts.fresh) {
      const cached = await cache.get<BadgeDefinition[]>(REDIS_KEY);
      if (Array.isArray(cached)) {
        const registry = buildRegistry(withBuiltins(cached), true);
        g.__badgeRegistry = { at: Date.now(), registry };
        return registry;
      }
    }
    const registry = await loadFromDb();
    // Cache failures only briefly so a recovered DB is picked up quickly.
    const at = registry.authoritative ? Date.now() : Date.now() - LOCAL_TTL_MS + FAILURE_BACKOFF_MS;
    g.__badgeRegistry = { at, registry };
    return registry;
  })();

  if (opts.fresh) return load;
  g.__badgeRegistryInflight = load;
  try {
    return await load;
  } finally {
    g.__badgeRegistryInflight = null;
  }
}

/** Drop both cache layers after a badge write. */
export async function invalidateBadgeCache(): Promise<void> {
  g.__badgeRegistry = undefined;
  await cache.del(REDIS_KEY);
}

// ─── Boot-time table ensure ───────────────────────────────────────────────────

// Mirrors schema.badges and drizzle/manual_badges.sql. Additive + idempotent.
const CREATE_BADGES_TABLE = sql`
  CREATE TABLE IF NOT EXISTS "badges" (
    "id" text PRIMARY KEY NOT NULL,
    "name" text NOT NULL,
    "description" text DEFAULT '' NOT NULL,
    "icon" text,
    "icon_url" text,
    "color" text DEFAULT '#8B5CF6' NOT NULL,
    "priority" integer DEFAULT 0 NOT NULL,
    "automatic" boolean DEFAULT false NOT NULL,
    "hidden" boolean DEFAULT false NOT NULL,
    "created_at" timestamp DEFAULT now(),
    "updated_at" timestamp DEFAULT now()
  )
`;

/**
 * Create the `badges` table if missing and insert any built-in badge that is
 * not there yet (ON CONFLICT DO NOTHING — rows edited by staff are never
 * touched). Runs once per process from initializeAPI(); never throws, so a
 * failure here can't take the API down (badges then use the fallback).
 */
export function ensureBadgesTable(): Promise<void> {
  if (g.__badgeTableEnsured) return g.__badgeTableEnsured;
  g.__badgeTableEnsured = (async () => {
    try {
      await db.execute(CREATE_BADGES_TABLE);
      await db
        .insert(schema.badges)
        .values(DEFAULT_BADGES.map((b) => ({
          id: b.id,
          name: b.name,
          description: b.description,
          icon: b.icon,
          iconUrl: b.iconUrl,
          color: b.color,
          priority: b.priority,
          automatic: b.automatic ?? false,
          hidden: b.hidden ?? false,
        })))
        .onConflictDoNothing({ target: schema.badges.id });
      // A previous failed read may have cached the fallback; start clean.
      await invalidateBadgeCache();
    } catch (err) {
      console.error('[badges] Failed to ensure badges table (continuing with fallback):', err);
      // Allow a later call (e.g. a retried initializeAPI) to try again.
      g.__badgeTableEnsured = null;
    }
  })();
  return g.__badgeTableEnsured;
}
