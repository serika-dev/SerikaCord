// Welcome Screen + Rules Screening storage (rules in src/lib/servers/community.ts).
//
//   servers.welcome_screen   the welcome screen JSON (WelcomeScreen)
//   server_screening         one row per server with the rules screening config
//   server_members.pending   true while a member who joined during screening
//                            hasn't accepted the rules yet
//
// The screening config is cached briefly in Redis because the gate in
// serverGate.ts reads it on every send / reaction / voice join of a pending
// member.
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { cache } from '@/lib/db';
import { normalizeId } from '@/lib/db/normalizeId';
import {
  EMPTY_SCREENING,
  normalizeScreeningConfig,
  normalizeWelcomeScreen,
  type ScreeningConfig,
  type WelcomeScreen,
} from '@/lib/servers/community';

// ─── Boot-time schema ensure ──────────────────────────────────────────────────
// Mirrors drizzle/manual_server_community.sql. Additive + idempotent; each
// attempt gives up quickly instead of queueing behind a long lock on a shared
// production table, and is retried.
const g = globalThis as unknown as { __communitySchema?: Promise<void> | null };

export function ensureCommunitySchema(): Promise<void> {
  if (g.__communitySchema) return g.__communitySchema;
  g.__communitySchema = (async () => {
    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        await db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
          await tx.execute(sql`ALTER TABLE servers ADD COLUMN IF NOT EXISTS welcome_screen jsonb`);
          await tx.execute(sql`ALTER TABLE server_members ADD COLUMN IF NOT EXISTS pending boolean DEFAULT false`);
          await tx.execute(sql`CREATE TABLE IF NOT EXISTS server_screening (
            server_id uuid PRIMARY KEY,
            enabled boolean NOT NULL DEFAULT false,
            description text,
            rules jsonb NOT NULL DEFAULT '[]'::jsonb,
            updated_at timestamp DEFAULT now()
          )`);
          await tx.execute(sql`CREATE TABLE IF NOT EXISTS server_templates (
            code text PRIMARY KEY,
            server_id uuid NOT NULL,
            creator_id uuid NOT NULL,
            name text NOT NULL,
            description text,
            usage_count integer NOT NULL DEFAULT 0,
            serialized jsonb NOT NULL,
            created_at timestamp DEFAULT now(),
            updated_at timestamp DEFAULT now()
          )`);
          await tx.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS server_templates_server_id_unique ON server_templates (server_id)`);
        });
        return;
      } catch (err) {
        console.error(`[community] Ensuring community schema failed (attempt ${attempt}):`, (err as Error)?.message ?? err);
        await new Promise((r) => setTimeout(r, Math.min(30_000, 2_000 * attempt)));
      }
    }
    g.__communitySchema = null;
  })();
  return g.__communitySchema;
}

// ─── Rules screening ──────────────────────────────────────────────────────────

const screeningKey = (serverId: string) => `server:screening:${serverId}`;

export async function getScreeningConfig(serverId: string): Promise<ScreeningConfig> {
  const cached = await cache.get<ScreeningConfig>(screeningKey(serverId)).catch(() => null);
  if (cached) return cached;
  let config: ScreeningConfig = { ...EMPTY_SCREENING, rules: [] };
  try {
    const [row] = await db
      .select()
      .from(schema.serverScreening)
      .where(eq(schema.serverScreening.serverId, normalizeId(serverId)))
      .limit(1);
    if (row) config = normalizeScreeningConfig({ enabled: row.enabled, description: row.description, rules: row.rules });
  } catch {
    // Table not there yet (boot DDL pending): screening is simply off.
    return config;
  }
  await cache.set(screeningKey(serverId), config, 60).catch(() => {});
  return config;
}

export async function saveScreeningConfig(serverId: string, input: unknown): Promise<ScreeningConfig> {
  const config = normalizeScreeningConfig(input);
  const values = {
    serverId: normalizeId(serverId),
    enabled: config.enabled,
    description: config.description || null,
    rules: config.rules,
    updatedAt: new Date(),
  };
  await db
    .insert(schema.serverScreening)
    .values(values)
    .onConflictDoUpdate({
      target: schema.serverScreening.serverId,
      set: { enabled: values.enabled, description: values.description, rules: values.rules, updatedAt: values.updatedAt },
    });
  await cache.del(screeningKey(serverId)).catch(() => {});
  return config;
}

/** Whether someone joining now starts out pending (screening on). */
export async function joinsAsPending(serverId: string): Promise<boolean> {
  const config = await getScreeningConfig(serverId).catch(() => null);
  return Boolean(config?.enabled);
}

/** Clears the member's pending flag. False when they aren't a member. */
export async function acceptScreening(serverId: string, userId: string): Promise<boolean> {
  const rows = await db
    .update(schema.serverMembers)
    .set({ pending: false, updatedAt: new Date() })
    .where(and(
      eq(schema.serverMembers.serverId, normalizeId(serverId)),
      eq(schema.serverMembers.userId, normalizeId(userId)),
    ))
    .returning({ id: schema.serverMembers.id });
  return rows.length > 0;
}

// ─── Welcome screen ───────────────────────────────────────────────────────────

export async function getWelcomeScreen(serverId: string): Promise<WelcomeScreen> {
  const [row] = await db
    .select({ welcomeScreen: schema.servers.welcomeScreen })
    .from(schema.servers)
    .where(eq(schema.servers.id, normalizeId(serverId)))
    .limit(1);
  return normalizeWelcomeScreen(row?.welcomeScreen ?? null);
}

export async function saveWelcomeScreen(serverId: string, screen: WelcomeScreen): Promise<void> {
  await db
    .update(schema.servers)
    .set({ welcomeScreen: screen, updatedAt: new Date() })
    .where(eq(schema.servers.id, normalizeId(serverId)));
  await cache.del(`server:${serverId}`).catch(() => {});
}
