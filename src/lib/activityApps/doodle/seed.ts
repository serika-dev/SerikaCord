/**
 * Seed Doodle Party's Activity settings at boot (env DOODLE_ACTIVITY_APP_ID).
 * Only fills in what is missing: an app whose Activities were already set up
 * (enabled, or any URL mapping) is left exactly as its owner configured it.
 * Sets the root URL mapping to this server's game, the name, platforms and a
 * 12-player cap, and names the entry point command /doodle.
 */
import { DOODLE_ACTIVITY_NAME } from './meta';
import { doodleAppId, doodleMappingTarget } from './server';

export async function ensureDoodleActivity(): Promise<void> {
  const appId = doodleAppId();
  if (!appId) return;
  try {
    const { Application } = await import('@/lib/models');
    const app = await Application.findById(appId);
    if (!app) { console.warn('[doodle] DOODLE_ACTIVITY_APP_ID does not match an application'); return; }
    const { getActivitySettings, updateActivitySettings } = await import('@/lib/services/activitySettings');
    const current = await getActivitySettings(app.id);
    if (current.enabled || current.urlMappings.length > 0) return;
    if (!app.botId) {
      const { ensureBotProvisioned } = await import('@/lib/services/appIdentity');
      await ensureBotProvisioned(app);
    }
    await updateActivitySettings(app, {
      enabled: true,
      urlMappings: [{ prefix: '/', target: doodleMappingTarget() }],
      displayName: DOODLE_ACTIVITY_NAME,
      supportedPlatforms: ['web', 'desktop', 'ios', 'android'],
      maxParticipants: 12,
    });
    // The default entry point is "launch"; Doodle's is /doodle.
    const { listCommands, patchCommand } = await import('@/lib/services/appCommands');
    const entry = (await listCommands(app.id, null)).find((c) => c.type === 4);
    if (entry && entry.name !== 'doodle') {
      await patchCommand(app.id, null, entry.id, { name: 'doodle', description: 'Draw and guess with friends' });
    }
    console.log('[doodle] seeded Activity settings for', app.id);
  } catch (err) {
    console.error('[doodle] seeding failed:', (err as Error)?.message ?? err);
  }
}
