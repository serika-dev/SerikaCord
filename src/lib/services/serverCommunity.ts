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
import { and, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { cache } from '@/lib/db';
import { normalizeId } from '@/lib/db/normalizeId';
import {
  normalizeScreeningConfig,
  normalizeWelcomeScreen,
  type ScreeningConfig,
  type WelcomeScreen,
} from '@/lib/servers/community';
import {
  applyOnboardingRoles,
  isSafeOnboardingRole,
  normalizeLinkedConnectionIds,
  normalizeOnboardingConfig,
  onboardingRoleChanges,
  rolesWithUnsafeChannelGrants,
  type OnboardingConfig,
} from '@/lib/servers/onboarding';
import { Channel, Role, ServerMember } from '@/lib/models';
import { invalidateServerMemberCache } from '@/lib/api/activity';
import { requestUserChannelStreamRecheck } from '@/lib/realtime/channelStreams';
import { audit } from '@/lib/services/auditLog';
import { AuditLogEvent, diffMemberRoles } from '@/lib/audit/auditLog';

// ─── Boot-time schema ensure ──────────────────────────────────────────────────
// Mirrors drizzle/manual_server_community.sql,
// drizzle/manual_server_onboarding.sql and
// drizzle/manual_server_owned_connections.sql. Additive + idempotent; each
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
          // drizzle/manual_server_onboarding.sql
          await tx.execute(sql`ALTER TABLE server_screening ADD COLUMN IF NOT EXISTS restrict_channels boolean NOT NULL DEFAULT false`);
          await tx.execute(sql`ALTER TABLE server_screening ADD COLUMN IF NOT EXISTS accessible_channel_ids jsonb NOT NULL DEFAULT '[]'::jsonb`);
          await tx.execute(sql`ALTER TABLE server_screening ADD COLUMN IF NOT EXISTS manual_approval boolean NOT NULL DEFAULT false`);
          await tx.execute(sql`ALTER TABLE server_screening ADD COLUMN IF NOT EXISTS questions jsonb NOT NULL DEFAULT '[]'::jsonb`);
          await tx.execute(sql`CREATE TABLE IF NOT EXISTS server_onboarding (
            server_id uuid PRIMARY KEY,
            config jsonb NOT NULL DEFAULT '{}'::jsonb,
            linked_connection_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
            updated_at timestamp DEFAULT now()
          )`);
          await tx.execute(sql`CREATE TABLE IF NOT EXISTS server_onboarding_responses (
            server_id uuid NOT NULL,
            user_id uuid NOT NULL,
            option_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
            completed_at timestamp,
            roles_applied boolean NOT NULL DEFAULT false,
            todos_done jsonb NOT NULL DEFAULT '[]'::jsonb,
            updated_at timestamp DEFAULT now(),
            PRIMARY KEY (server_id, user_id)
          )`);
          // drizzle/manual_server_owned_connections.sql
          await tx.execute(sql`CREATE TABLE IF NOT EXISTS server_owned_connections (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            server_id uuid NOT NULL,
            provider text NOT NULL,
            account_id text NOT NULL,
            username text,
            display_name text,
            avatar text,
            metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
            verified boolean NOT NULL DEFAULT false,
            visible boolean NOT NULL DEFAULT true,
            created_by uuid,
            created_at timestamp DEFAULT now(),
            updated_at timestamp DEFAULT now()
          )`);
          await tx.execute(sql`CREATE INDEX IF NOT EXISTS server_owned_connections_server_id_idx ON server_owned_connections (server_id)`);
          await tx.execute(sql`CREATE INDEX IF NOT EXISTS server_owned_connections_provider_account_idx ON server_owned_connections (provider, account_id)`);
          await tx.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS server_owned_connections_server_provider_account_unique ON server_owned_connections (server_id, provider, account_id)`);
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
  // Entries cached before the newer fields existed are filled with defaults.
  if (cached) return { ...normalizeScreeningConfig(cached), enabled: cached.enabled === true && (cached.rules?.length ?? 0) > 0 };
  let config: ScreeningConfig = normalizeScreeningConfig(null);
  const sid = normalizeId(serverId);
  try {
    const [row] = await db
      .select()
      .from(schema.serverScreening)
      .where(eq(schema.serverScreening.serverId, sid))
      .limit(1);
    if (row) config = normalizeScreeningConfig(row);
  } catch {
    // Newer columns not added yet (boot DDL pending): read the original ones so
    // screening never silently switches off.
    try {
      const [row] = await db
        .select({ enabled: schema.serverScreening.enabled, description: schema.serverScreening.description, rules: schema.serverScreening.rules })
        .from(schema.serverScreening)
        .where(eq(schema.serverScreening.serverId, sid))
        .limit(1);
      if (row) config = normalizeScreeningConfig(row);
    } catch {
      // Table not there yet either: screening is simply off.
    }
    return config;
  }
  await cache.set(screeningKey(serverId), config, 60).catch(() => {});
  return config;
}

export async function saveScreeningConfig(serverId: string, input: unknown, validChannelIds?: ReadonlySet<string>): Promise<ScreeningConfig> {
  const config = normalizeScreeningConfig(input, validChannelIds);
  const values = {
    serverId: normalizeId(serverId),
    enabled: config.enabled,
    description: config.description || null,
    rules: config.rules,
    restrictChannels: config.restrictChannels,
    accessibleChannelIds: config.accessibleChannelIds,
    manualApproval: config.manualApproval,
    questions: config.questions,
    updatedAt: new Date(),
  };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { serverId: _sid, ...update } = values;
  await db
    .insert(schema.serverScreening)
    .values(values)
    .onConflictDoUpdate({ target: schema.serverScreening.serverId, set: update });
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

// ─── Onboarding + Server Guide ────────────────────────────────────────────────

const onboardingKey = (serverId: string) => `server:onboarding:${serverId}`;

interface StoredOnboarding {
  config: OnboardingConfig;
  linkedConnectionIds: string[];
}

async function readOnboardingRow(serverId: string): Promise<StoredOnboarding> {
  const cached = await cache.get<StoredOnboarding>(onboardingKey(serverId)).catch(() => null);
  if (cached) return { config: normalizeOnboardingConfig(cached.config), linkedConnectionIds: normalizeLinkedConnectionIds(cached.linkedConnectionIds) };
  let stored: StoredOnboarding = { config: normalizeOnboardingConfig(null), linkedConnectionIds: [] };
  try {
    const [row] = await db
      .select()
      .from(schema.serverOnboarding)
      .where(eq(schema.serverOnboarding.serverId, normalizeId(serverId)))
      .limit(1);
    if (row) stored = { config: normalizeOnboardingConfig(row.config), linkedConnectionIds: normalizeLinkedConnectionIds(row.linkedConnectionIds) };
  } catch {
    return stored; // table not there yet
  }
  await cache.set(onboardingKey(serverId), stored, 60).catch(() => {});
  return stored;
}

export async function getOnboardingConfig(serverId: string): Promise<OnboardingConfig> {
  return (await readOnboardingRow(serverId)).config;
}

export async function getLinkedConnectionIds(serverId: string): Promise<string[]> {
  return (await readOnboardingRow(serverId)).linkedConnectionIds;
}

export async function saveOnboardingConfig(serverId: string, config: OnboardingConfig): Promise<void> {
  const sid = normalizeId(serverId);
  await db
    .insert(schema.serverOnboarding)
    .values({ serverId: sid, config, updatedAt: new Date() })
    .onConflictDoUpdate({ target: schema.serverOnboarding.serverId, set: { config, updatedAt: new Date() } });
  await cache.del(onboardingKey(serverId)).catch(() => {});
}

export async function saveLinkedConnectionIds(serverId: string, ids: string[]): Promise<void> {
  const sid = normalizeId(serverId);
  const linkedConnectionIds = normalizeLinkedConnectionIds(ids);
  await db
    .insert(schema.serverOnboarding)
    .values({ serverId: sid, linkedConnectionIds, updatedAt: new Date() })
    .onConflictDoUpdate({ target: schema.serverOnboarding.serverId, set: { linkedConnectionIds, updatedAt: new Date() } });
  await cache.del(onboardingKey(serverId)).catch(() => {});
}

export interface OnboardingResponse {
  optionIds: string[];
  completedAt: Date | null;
  rolesApplied: boolean;
  todosDone: string[];
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export async function getOnboardingResponse(serverId: string, userId: string): Promise<OnboardingResponse | null> {
  try {
    const [row] = await db
      .select()
      .from(schema.serverOnboardingResponses)
      .where(and(
        eq(schema.serverOnboardingResponses.serverId, normalizeId(serverId)),
        eq(schema.serverOnboardingResponses.userId, normalizeId(userId)),
      ))
      .limit(1);
    if (!row) return null;
    return { optionIds: strings(row.optionIds), completedAt: row.completedAt ?? null, rolesApplied: row.rolesApplied, todosDone: strings(row.todosDone) };
  } catch {
    return null;
  }
}

async function upsertResponse(serverId: string, userId: string, set: Partial<typeof schema.serverOnboardingResponses.$inferInsert>): Promise<void> {
  const key = { serverId: normalizeId(serverId), userId: normalizeId(userId) };
  await db
    .insert(schema.serverOnboardingResponses)
    .values({ ...key, ...set, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [schema.serverOnboardingResponses.serverId, schema.serverOnboardingResponses.userId],
      set: { ...set, updatedAt: new Date() },
    });
}

/** Saves a member's (already validated) picks; roles are applied separately. */
export async function saveOnboardingSelection(serverId: string, userId: string, optionIds: string[]): Promise<void> {
  await upsertResponse(serverId, userId, { optionIds, completedAt: new Date(), rolesApplied: false });
}

export async function markGuideTodoDone(serverId: string, userId: string, todoId: string): Promise<string[]> {
  const current = await getOnboardingResponse(serverId, userId);
  const todosDone = [...new Set([...(current?.todosDone ?? []), todoId])].slice(0, 20);
  await upsertResponse(serverId, userId, { todosDone });
  return todosDone;
}

/**
 * Gives a member the roles their onboarding picks grant (and takes away
 * onboarding roles they no longer picked). Only roles that are still safe to
 * self-assign are granted. Call only once rules screening no longer blocks
 * them: any role exempts a member from screening and the verification level.
 */
export async function applyMemberOnboardingRoles(serverId: string, userId: string): Promise<boolean> {
  const [config, response] = await Promise.all([getOnboardingConfig(serverId), getOnboardingResponse(serverId, userId)]);
  if (!response || response.rolesApplied) return false;
  const member = await ServerMember.findOne({ serverId, userId });
  if (!member) return false;
  // Any role lifts the server's verification level too, so wait until the
  // member meets it (email / account age / member age / verified connection).
  // The member view retries on the next load.
  const { memberVerificationState } = await import('@/lib/services/serverGate');
  const verification = await memberVerificationState(serverId, userId, member).catch(() => null);
  if (!verification || verification.blocked) return false;
  const [serverRoles, channels] = await Promise.all([Role.find({ serverId }), Channel.find({ serverId })]);
  const viaChannels = rolesWithUnsafeChannelGrants(channels);
  const safe = new Set(serverRoles.filter((r) => isSafeOnboardingRole(r) && !viaChannels.has(r.id)).map((r) => r.id));
  const changes = onboardingRoleChanges(config, response.optionIds);
  const grant = new Set([...changes.grant].filter((r) => safe.has(r)));
  const current = (member.roles || []) as string[];
  const next = applyOnboardingRoles(current, { grant, managed: changes.managed });
  const changed = next.length !== current.length || next.some((r) => !current.includes(r));
  if (changed) {
    await ServerMember.updateById(member.id, { roles: next });
    invalidateServerMemberCache(serverId);
    requestUserChannelStreamRecheck(normalizeId(userId));
    const everyone = serverRoles.find((r) => r.isDefault)?.id;
    const names = new Map(serverRoles.map((r) => [r.id, r.name] as const));
    const roleChanges = diffMemberRoles(current.filter((r) => r !== everyone), next.filter((r) => r !== everyone), names);
    if (roleChanges.length > 0) {
      audit({ serverId, userId, actionType: AuditLogEvent.MEMBER_ROLE_UPDATE, targetId: userId, changes: roleChanges, reason: 'Server onboarding' });
    }
  }
  await upsertResponse(serverId, userId, { rolesApplied: true });
  return changed;
}

/**
 * Lets a member in past rules screening (they accepted, or a moderator
 * approved them) and hands out any onboarding roles they picked meanwhile.
 */
export async function admitScreenedMember(serverId: string, userId: string): Promise<boolean> {
  const ok = await acceptScreening(serverId, userId);
  if (!ok) return false;
  invalidateServerMemberCache(serverId);
  requestUserChannelStreamRecheck(normalizeId(userId));
  await applyMemberOnboardingRoles(serverId, userId).catch(() => false);
  return true;
}

export interface PendingMemberRow {
  userId: string;
  joinedAt: Date | null;
  roles: string[];
}

/** Members still waiting in rules screening (pending = true), newest first. */
export async function listPendingMembers(serverId: string, limit = 100): Promise<PendingMemberRow[]> {
  const rows = await db
    .select({ userId: schema.serverMembers.userId, joinedAt: schema.serverMembers.joinedAt, roles: schema.serverMembers.roles })
    .from(schema.serverMembers)
    .where(and(eq(schema.serverMembers.serverId, normalizeId(serverId)), eq(schema.serverMembers.pending, true)))
    .orderBy(desc(schema.serverMembers.joinedAt))
    .limit(limit);
  return rows.map((r) => ({ userId: r.userId, joinedAt: r.joinedAt ?? null, roles: (r.roles || []) as string[] }));
}
