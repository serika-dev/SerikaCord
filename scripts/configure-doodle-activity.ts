/**
 * One-shot setup for Doodle Party (serika-dev/DoodleParty, https://doodle.waifu.ws),
 * a separately hosted Activity (CORD-92). Run from the repo root with the
 * production .env:
 *
 *   bun scripts/configure-doodle-activity.ts            # dry run: prints the plan
 *   bun scripts/configure-doodle-activity.ts --apply    # does it
 *
 * Steps:
 *  1. Upload the icon and banner (from ../DoodleParty/public) as the app's
 *     icon, cover image and Activity art.
 *  2. Enable Activities: root URL mapping "/" -> doodle.waifu.ws, name, all
 *     platforms, 12 players. The entry point command becomes /doodle.
 *  3. Mark the application verified (staff decision).
 *  4. Copy the app's client secret and bot token into the Doodle server's
 *     Coolify env (never printed), then deploy it.
 *
 * Options: --app <uuid>, --coolify-app <uuid>, --dir <DoodleParty checkout>, --target <host>.
 */
import { readFile } from 'fs/promises';
import { resolve } from 'path';

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const APPLY = args.includes('--apply');
const APP_ID = opt('app', '71098c75-b0ec-4817-b611-c40651146f54');
const COOLIFY_APP = opt('coolify-app', 'exyg1wnwahqcb3wcoxipi1lm');
const DIR = resolve(opt('dir', '../DoodleParty'));
const TARGET = opt('target', 'doodle.waifu.ws');

const { Application } = await import('@/lib/models');
const { config } = await import('@/lib/config');
const { validateUrlMappings } = await import('@/lib/activities/settings');

const app = await Application.findById(APP_ID);
if (!app) throw new Error(`No application ${APP_ID}`);
const mappings = validateUrlMappings([{ prefix: '/', target: TARGET }], { requireRoot: true, blockedHosts: [config.ACTIVITIES_DOMAIN].filter(Boolean) });
if (!mappings.ok) throw new Error(`Bad target: ${mappings.errors[0].message}`);
const icon = await readFile(`${DIR}/public/icon.png`);
const banner = await readFile(`${DIR}/public/banner.png`);

console.log(`App: ${app.name} (${app.id}), client id ${app.clientId}, owner ${app.ownerId}`);
console.log(`Plan: icon ${icon.length} B + banner ${banner.length} B upload, mapping / -> ${TARGET}, name "Doodle Party", verified, entry point /doodle, Coolify env + deploy of ${COOLIFY_APP}`);
if (!APPLY) {
  console.log('Dry run. Re-run with --apply to do it.');
  process.exit(0);
}

// 1. Images
const { storage } = await import('@/lib/services/storage');
const up = (category: 'app-icons' | 'app-covers', data: Buffer, filename: string) => storage.upload({
  category, contentType: 'image/png', data, size: data.length, filename, keyScope: app.id.toLowerCase(), scanUserId: app.ownerId, ip: '127.0.0.1',
});
const iconUrl = (await up('app-icons', icon, 'icon.png')).url;
const bannerUrl = (await up('app-covers', banner, 'cover.png')).url;
await Application.updateById(app.id, {
  icon: iconUrl,
  coverImage: bannerUrl,
  description: app.description || 'Draw and guess with friends: take turns drawing a word while everyone races to guess it.',
  updatedAt: new Date(),
});
console.log('✓ icon + banner uploaded');

// 2. Activities
const { ensureBotProvisioned } = await import('@/lib/services/appIdentity');
if (!app.botId) await ensureBotProvisioned(app);
const { updateActivitySettings } = await import('@/lib/services/activitySettings');
const fresh = (await Application.findById(app.id))!;
await updateActivitySettings(fresh, {
  enabled: true,
  urlMappings: mappings.mappings,
  displayName: 'Doodle Party',
  imageUrl: bannerUrl,
  supportedPlatforms: ['web', 'desktop', 'ios', 'android'],
  maxParticipants: 12,
});
const { listCommands, patchCommand } = await import('@/lib/services/appCommands');
const entry = (await listCommands(app.id, null)).find((c) => c.type === 4);
if (entry && entry.name !== 'doodle') await patchCommand(app.id, null, entry.id, { name: 'doodle', description: 'Draw and guess with friends' });
console.log('✓ Activities enabled, /doodle');

// 3. Verified
await Application.updateById(app.id, { verified: true, verificationStatus: 'approved', verificationReviewedAt: new Date(), updatedAt: new Date() });
try {
  const { invalidateAppDirectory } = await import('@/lib/services/appDirectory');
  invalidateAppDirectory();
} catch { /* other processes refresh on their own */ }
console.log('✓ verified');

// 4. Doodle server secrets (Coolify), then deploy
const withSecrets = (await Application.findById(app.id))!;
const coolify = (process.env.COOLIFY_URL || '').replace(/\/+$/, '');
const token = process.env.COOLIFY_TOKEN || '';
if (!coolify || !token) throw new Error('COOLIFY_URL / COOLIFY_TOKEN missing from .env');
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const envs = await (await fetch(`${coolify}/api/v1/applications/${COOLIFY_APP}/envs`, { headers: H })).json() as Array<{ key: string }>;
for (const [key, value] of [['CLIENT_ID', withSecrets.clientId], ['CLIENT_SECRET', withSecrets.clientSecret], ['BOT_TOKEN', withSecrets.botToken]] as const) {
  if (!value) throw new Error(`${key} is empty on the application`);
  const exists = envs.some((e) => e.key === key);
  const res = await fetch(`${coolify}/api/v1/applications/${COOLIFY_APP}/envs`, { method: exists ? 'PATCH' : 'POST', headers: H, body: JSON.stringify({ key, value, is_preview: false }) });
  if (!res.ok) throw new Error(`Coolify ${key}: HTTP ${res.status}`);
}
const deploy = await fetch(`${coolify}/api/v1/deploy?uuid=${COOLIFY_APP}&force=false`, { method: 'POST', headers: H });
console.log(`✓ Coolify env set; deploy ${deploy.ok ? 'queued' : `failed (HTTP ${deploy.status})`}`);
process.exit(0);
