/**
 * One-off cleanup for rows left behind by the old server/account deletion
 * paths (admin delete only removed the server row; owner delete skipped
 * messages, emojis, stickers, bans, webhooks; account delete only removed the
 * users row). The schema has no foreign keys, so these orphans kept granting
 * channel access and counting toward the per-user server limit.
 *
 * Reports by default. Writes ONLY with --apply, inside one transaction.
 *   bun scripts/cleanup-orphaned-server-rows.ts           # report only
 *   bun scripts/cleanup-orphaned-server-rows.ts --apply   # delete orphans
 *
 * Only rows whose server (or user, for memberships) no longer exists are
 * touched. DM / group-DM channels (server_id IS NULL) are never matched.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

const ROOT = path.resolve(import.meta.dirname, '..');
const env: Record<string, string> = { ...process.env } as Record<string, string>;
try {
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {
  /* no .env file — rely on process.env */
}

const APPLY = process.argv.includes('--apply');
const NO_SERVER = (alias: string) => `${alias}.server_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM servers s WHERE s.id = ${alias}.server_id)`;

// Order matters: messages/webhooks are matched through orphaned channels too,
// so they go before the channels themselves.
const STEPS: Array<{ label: string; where: string; table: string }> = [
  { label: 'messages in orphaned channels', table: 'messages m', where: `m.channel_id IN (SELECT c.id FROM channels c WHERE ${NO_SERVER('c')}) OR (${NO_SERVER('m')})` },
  { label: 'channel_webhooks', table: 'channel_webhooks w', where: `w.channel_id IN (SELECT c.id FROM channels c WHERE ${NO_SERVER('c')}) OR (${NO_SERVER('w')})` },
  { label: 'invites', table: 'invites x', where: NO_SERVER('x') },
  { label: 'server_bans', table: 'server_bans x', where: NO_SERVER('x') },
  { label: 'server_emojis', table: 'server_emojis x', where: NO_SERVER('x') },
  { label: 'server_stickers', table: 'server_stickers x', where: NO_SERVER('x') },
  { label: 'server_member_applications', table: 'server_member_applications x', where: NO_SERVER('x') },
  { label: 'roles', table: 'roles x', where: NO_SERVER('x') },
  { label: 'server_members (missing server)', table: 'server_members x', where: NO_SERVER('x') },
  { label: 'server_members (missing user)', table: 'server_members x', where: 'NOT EXISTS (SELECT 1 FROM users u WHERE u.id = x.user_id)' },
  { label: 'channels', table: 'channels c', where: NO_SERVER('c') },
];

async function main() {
  const uri = env.POSTGRES_URI;
  if (!uri) throw new Error('POSTGRES_URI is not set');
  const client = new Client({ connectionString: uri });
  await client.connect();
  try {
    await client.query('BEGIN');
    for (const step of STEPS) {
      const sqlText = APPLY
        ? `DELETE FROM ${step.table} WHERE ${step.where}`
        : `SELECT count(*)::int AS n FROM ${step.table} WHERE ${step.where}`;
      const res = await client.query(sqlText);
      const n = APPLY ? res.rowCount : res.rows[0].n;
      console.log(`${APPLY ? 'deleted' : 'would delete'} ${n} ${step.label}`);
    }
    await client.query(APPLY ? 'COMMIT' : 'ROLLBACK');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
  if (!APPLY) console.log('Report only. Re-run with --apply to delete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
