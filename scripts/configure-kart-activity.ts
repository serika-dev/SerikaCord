/**
 * One-shot setup for Super Serika Kart (Pikachubolk/super-serika-kart, https://kart.serika.dev) as an
 * Activity (CORD-92). kart.serika.dev keeps working on its own; inside an Activity it signs in and puts
 * everyone in one online room (src/net/activity.js in that repo). Run from the repo root with the
 * production .env:
 *
 *   bun scripts/configure-kart-activity.ts            # dry run: prints the plan
 *   bun scripts/configure-kart-activity.ts --apply    # does it
 *
 * Steps:
 *  1. Find the "Super Serika Kart" application of the owner (default: Doodle Party's owner), or create it
 *     (same fields as POST /api/developers/applications).
 *  2. Upload the icon and banner (../super-serika-kart/public/activity) as icon, cover and Activity art.
 *  3. Enable Activities: root URL mapping "/" -> kart.serika.dev, all platforms, 8 players; entry point /kart.
 *  4. Mark the application verified (staff decision, like Doodle Party).
 *  5. Copy the client id and secret into the kart server's Coolify env (never printed), then deploy it.
 *
 * Options: --owner <user uuid>, --coolify-app <uuid>, --dir <kart checkout>, --target <host>.
 */
import crypto from 'crypto';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { and, eq } from 'drizzle-orm';

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const APPLY = args.includes('--apply');
const NAME = 'Super Serika Kart';
const DOODLE_APP = '71098c75-b0ec-4817-b611-c40651146f54';
const COOLIFY_APP = opt('coolify-app', 'nlriyjrzfapbddvhrwrcpajd');
const DIR = resolve(opt('dir', '../super-serika-kart'));
const TARGET = opt('target', 'kart.serika.dev');
const DESCRIPTION = 'Race Serika and the students of Kivotos in a kart racer: everyone in the Activity shares one room, with tournaments, items and CPU racers.';

const { Application } = await import('@/lib/models');
const { db, schema } = await import('@/lib/db/postgres');
const { config } = await import('@/lib/config');
const { validateUrlMappings } = await import('@/lib/activities/settings');

const ownerId = opt('owner', (await Application.findById(DOODLE_APP))?.ownerId ?? '');
if (!ownerId) throw new Error('No owner: pass --owner <user uuid>');
const mappings = validateUrlMappings([{ prefix: '/', target: TARGET }], { requireRoot: true, blockedHosts: [config.ACTIVITIES_DOMAIN].filter(Boolean) });
if (!mappings.ok) throw new Error(`Bad target: ${mappings.errors[0].message}`);
const icon = await readFile(`${DIR}/public/activity/icon.png`);
const banner = await readFile(`${DIR}/public/activity/banner.jpg`);

// Model find() only knows whitelisted keys, so look the app up by name directly.
const [existing] = await db.select({ id: schema.applications.id }).from(schema.applications)
  .where(and(eq(schema.applications.ownerId, ownerId), eq(schema.applications.name, NAME))).limit(1);

console.log(`Owner ${ownerId}; app ${existing ? `exists (${existing.id})` : 'will be created'}`);
console.log(`Plan: icon ${icon.length} B + banner ${banner.length} B, mapping / -> ${TARGET}, verified, entry point /kart, Coolify env + deploy of ${COOLIFY_APP}`);
if (!APPLY) {
  console.log('Dry run. Re-run with --apply to do it.');
  process.exit(0);
}

// 1. The application
let app = existing ? await Application.findById(existing.id) : null;
if (!app) {
  app = await Application.create({
    ownerId,
    name: NAME,
    description: DESCRIPTION,
    clientId: String(Date.now() * 2048 + Math.floor(Math.random() * 2048)),
    clientSecret: crypto.randomBytes(32).toString('hex'),
    botPublic: true,
    botRequireCodeGrant: false,
    redirectUris: [],
    scopes: ['identify'],
    installParams: { scopes: ['bot', 'applications.commands'], permissions: '0' },
    verified: false,
    verificationStatus: 'none',
    serverCount: 0,
    tags: [],
    flags: 0,
    apiIdFormat: 'snowflake',
  });
  console.log(`✓ created ${app.id} (client id ${app.clientId})`);
}
if (!app) throw new Error('Could not create the application');

// 2. Images
const { storage } = await import('@/lib/services/storage');
const up = (category: 'app-icons' | 'app-covers', data: Buffer, filename: string, contentType: string) => storage.upload({
  category, contentType, data, size: data.length, filename, keyScope: app.id.toLowerCase(), scanUserId: app.ownerId, ip: '127.0.0.1',
});
const iconUrl = (await up('app-icons', icon, 'icon.png', 'image/png')).url;
const bannerUrl = (await up('app-covers', banner, 'cover.jpg', 'image/jpeg')).url;
await Application.updateById(app.id, { icon: iconUrl, coverImage: bannerUrl, description: app.description || DESCRIPTION, updatedAt: new Date() });
console.log('✓ icon + banner uploaded');

// 3. Activities
const { ensureBotProvisioned } = await import('@/lib/services/appIdentity');
await ensureBotProvisioned((await Application.findById(app.id))!);
const { updateActivitySettings } = await import('@/lib/services/activitySettings');
await updateActivitySettings((await Application.findById(app.id))!, {
  enabled: true,
  urlMappings: mappings.mappings,
  displayName: NAME,
  imageUrl: bannerUrl,
  supportedPlatforms: ['web', 'desktop', 'ios', 'android'],
  maxParticipants: 8,
});
const { listCommands, patchCommand } = await import('@/lib/services/appCommands');
const entry = (await listCommands(app.id, null)).find((c) => c.type === 4);
if (entry && entry.name !== 'kart') await patchCommand(app.id, null, entry.id, { name: 'kart', description: 'Race your friends in Super Serika Kart' });
console.log('✓ Activities enabled, /kart');

// 4. Verified (also ticks the bot's BOT tag)
await Application.updateById(app.id, { verified: true, verificationStatus: 'approved', verificationReviewedAt: new Date(), updatedAt: new Date() });
const fresh = (await Application.findById(app.id))!;
if (fresh.botId) {
  const { User } = await import('@/lib/models');
  await User.updateById(fresh.botId, { isVerified: true });
}
try {
  const { invalidateAppDirectory } = await import('@/lib/services/appDirectory');
  invalidateAppDirectory();
} catch { /* other processes refresh on their own */ }
console.log('✓ verified');

// 5. Kart server secrets (Coolify), then deploy
const coolify = (process.env.COOLIFY_URL || '').replace(/\/+$/, '');
const token = process.env.COOLIFY_TOKEN || '';
if (!coolify || !token) throw new Error('COOLIFY_URL / COOLIFY_TOKEN missing from .env');
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const envs = await (await fetch(`${coolify}/api/v1/applications/${COOLIFY_APP}/envs`, { headers: H })).json() as Array<{ key: string }>;
for (const [key, value] of [['CLIENT_ID', fresh.clientId], ['CLIENT_SECRET', fresh.clientSecret]] as const) {
  if (!value) throw new Error(`${key} is empty on the application`);
  const exists = envs.some((e) => e.key === key);
  const res = await fetch(`${coolify}/api/v1/applications/${COOLIFY_APP}/envs`, { method: exists ? 'PATCH' : 'POST', headers: H, body: JSON.stringify({ key, value, is_preview: false }) });
  if (!res.ok) throw new Error(`Coolify ${key}: HTTP ${res.status}`);
}
const deploy = await fetch(`${coolify}/api/v1/deploy?uuid=${COOLIFY_APP}&force=false`, { method: 'POST', headers: H });
console.log(`✓ Coolify env set; deploy ${deploy.ok ? 'queued' : `failed (HTTP ${deploy.status})`}`);
console.log(`App id: ${fresh.id}  client id: ${fresh.clientId}  -> https://${fresh.clientId}.${config.ACTIVITIES_DOMAIN}`);
process.exit(0);
