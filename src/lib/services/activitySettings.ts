/**
 * Activities (Embedded App SDK) settings of an application: storage for the
 * developer portal's Activities page, the EMBEDDED application flag and the
 * auto-created entry point command. Rules: src/lib/activities/settings.ts.
 * Design: docs/architecture/activities.md (CORD-92).
 *
 * The side table is created on first use (additive, idempotent, mirrors
 * drizzle/manual_activities.sql). Nothing that selects from `applications`
 * depends on it, so reads fall back to "Activities off" when it's missing.
 */
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { ensureSchema, withLockTimeout } from '@/lib/db/schemaGuard';
import { Application } from '@/lib/models';
import {
  APPLICATION_FLAG_EMBEDDED, settingsFromRow, type ActivitySettings, type ActivitySettingsPatch,
} from '@/lib/activities/settings';

const g = globalThis as unknown as { __activitySettingsSchema?: Promise<void> | null };

export function ensureActivitySettingsSchema(): Promise<void> {
  if (g.__activitySettingsSchema) return g.__activitySettingsSchema;
  g.__activitySettingsSchema = ensureSchema(
    'activity-settings',
    {
      tables: {
        application_activity_settings: [
          'application_id', 'enabled', 'url_mappings', 'supported_platforms', 'orientation_lock_phone',
          'orientation_lock_tablet', 'age_gated', 'display_name', 'image_url', 'created_at', 'updated_at',
        ],
      },
    },
    () => withLockTimeout([
      sql`CREATE TABLE IF NOT EXISTS application_activity_settings (
        application_id uuid PRIMARY KEY,
        enabled boolean NOT NULL DEFAULT false,
        url_mappings jsonb NOT NULL DEFAULT '[]'::jsonb,
        supported_platforms text[],
        orientation_lock_phone smallint NOT NULL DEFAULT 1,
        orientation_lock_tablet smallint NOT NULL DEFAULT 1,
        age_gated boolean NOT NULL DEFAULT false,
        display_name text,
        image_url text,
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now()
      )`,
      sql`CREATE INDEX IF NOT EXISTS application_activity_settings_enabled_idx ON application_activity_settings (enabled)`,
    ]),
    { attempts: 3 },
  ).catch((err) => {
    g.__activitySettingsSchema = null; // retry on the next call
    throw err;
  });
  return g.__activitySettingsSchema;
}

/** The app's Activity settings (defaults = off when there's no row). Throws on DB errors. */
export async function getActivitySettings(applicationId: string): Promise<ActivitySettings> {
  await ensureActivitySettingsSchema();
  const [row] = await db.select().from(schema.applicationActivitySettings)
    .where(eq(schema.applicationActivitySettings.applicationId, applicationId)).limit(1);
  return settingsFromRow(row as Record<string, unknown> | undefined);
}

/** True when the app has Activities enabled. False on any error (fail closed). */
export async function activitiesEnabled(applicationId: string): Promise<boolean> {
  try {
    return (await getActivitySettings(applicationId)).enabled;
  } catch (err) {
    console.error('[activities] settings read failed:', (err as Error)?.message ?? err);
    return false;
  }
}

/**
 * Save a validated patch (validateActivitySettingsPatch). Keeps the EMBEDDED
 * flag in step with `enabled`, and the first time Activities are switched on
 * creates the default entry point command, as Discord does.
 */
export async function updateActivitySettings(
  app: { id: string; name: string; flags?: number | null },
  patch: ActivitySettingsPatch,
): Promise<ActivitySettings> {
  await ensureActivitySettingsSchema();
  const { maxParticipants, ...fields } = patch;
  const set: Partial<typeof schema.applicationActivitySettings.$inferInsert> = {};
  if (fields.enabled !== undefined) set.enabled = fields.enabled;
  if (fields.urlMappings !== undefined) set.urlMappings = fields.urlMappings;
  if (fields.supportedPlatforms !== undefined) set.supportedPlatforms = fields.supportedPlatforms;
  if (fields.orientationLockPhone !== undefined) set.orientationLockPhone = fields.orientationLockPhone;
  if (fields.orientationLockTablet !== undefined) set.orientationLockTablet = fields.orientationLockTablet;
  if (fields.ageGated !== undefined) set.ageGated = fields.ageGated;
  if (fields.displayName !== undefined) set.displayName = fields.displayName;
  if (fields.imageUrl !== undefined) set.imageUrl = fields.imageUrl;
  if (Object.keys(set).length > 0) {
    const now = new Date();
    await db.insert(schema.applicationActivitySettings)
      .values({ applicationId: app.id, ...set, updatedAt: now })
      .onConflictDoUpdate({ target: schema.applicationActivitySettings.applicationId, set: { ...set, updatedAt: now } });
  }
  if (maxParticipants !== undefined) {
    // Discord's application `max_participants` (Activities) lives with the other API extras.
    const { updateAppApiExtras } = await import('@/lib/services/applicationApiSettings');
    await updateAppApiExtras(app.id, { maxParticipants });
  }
  if (fields.enabled !== undefined) {
    const flags = Number(app.flags) || 0;
    const next = fields.enabled ? flags | APPLICATION_FLAG_EMBEDDED : flags & ~APPLICATION_FLAG_EMBEDDED;
    if (next !== flags) await Application.updateById(app.id, { flags: next, updatedAt: new Date() });
    if (fields.enabled) await ensureDefaultEntryPointCommand(app);
  }
  return getActivitySettings(app.id);
}

/** Create the default `launch` entry point (handler 2) unless the app already has an entry point. */
export async function ensureDefaultEntryPointCommand(app: { id: string; name: string }): Promise<void> {
  const { listCommands, upsertCommand } = await import('@/lib/services/appCommands');
  const existing = await listCommands(app.id, null);
  if (existing.some((c) => c.type === 4)) return;
  const description = `Launch ${app.name}`.slice(0, 100).trim() || 'Launch';
  const res = await upsertCommand(app.id, null, {
    name: 'launch',
    description,
    type: 4,
    handler: 2,
    contexts: [0, 1, 2],
    integration_types: [0],
  });
  if (!res.ok) console.error('[activities] default entry point command failed:', JSON.stringify(res.body).slice(0, 300));
}
