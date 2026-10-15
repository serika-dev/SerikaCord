/**
 * OPTIONAL, opt-in backfill: encrypts sensitive values that were stored in
 * plaintext before field-level encryption existed (see
 * docs/architecture/security.md, "Encryption at rest"). The app already reads
 * both forms, so this is never required for correctness; it only shortens the
 * time old secrets sit in plaintext. Values are re-encrypted on their next
 * write anyway.
 *
 * Reports counts by default and writes ONLY with --apply. It never prints a
 * value. Each row is updated on its own, guarded by "column still equals what
 * was read", so a concurrent edit is never overwritten.
 *
 *   bun scripts/encrypt-legacy-fields.ts            # report only
 *   bun scripts/encrypt-legacy-fields.ts --apply    # encrypt legacy rows
 *
 * Key: the same keyring the app uses (platform_settings.encryption_key, plus
 * FIELD_ENCRYPTION_KEY when set). If you set FIELD_ENCRYPTION_KEY, deploy it
 * to the app BEFORE running this, or the app cannot read what this writes.
 *
 * Production data: take a backup first and run it deliberately.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import {
  deriveFieldKey,
  isSealedJson,
  looksSealed,
  makeKeyring,
  sealField,
  sealJson,
  sealKeys,
  sealLookupField,
  type FieldKeyring,
} from '../src/lib/security/fieldCrypto';
import { CONNECTION_SECRET_KEYS } from '../src/lib/connections/policy';

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

type Kind = 'text' | 'lookup' | 'json' | 'secretKeys';
interface Target {
  table: string;
  /** Primary key columns. */
  pk: string[];
  columns: Array<{ name: string; kind: Kind; keys?: readonly string[] }>;
  /** Unique column: on conflict, the legacy duplicate row is removed instead. */
  uniqueLookup?: string;
}

const TARGETS: Target[] = [
  { table: 'applications', pk: ['id'], columns: [
    { name: 'bot_token', kind: 'lookup' },
    { name: 'client_secret', kind: 'text' },
    { name: 'private_key_pem', kind: 'text' },
  ] },
  { table: 'channel_webhooks', pk: ['id'], columns: [
    { name: 'token', kind: 'lookup' },
    { name: 'url', kind: 'text' },
  ] },
  { table: 'app_webhooks', pk: ['id'], columns: [{ name: 'secret', kind: 'text' }] },
  { table: 'instances', pk: ['id'], columns: [{ name: 'secret_key', kind: 'text' }] },
  { table: 'user_connections', pk: ['id'], columns: [{ name: 'metadata', kind: 'secretKeys', keys: CONNECTION_SECRET_KEYS }] },
  { table: 'server_member_applications', pk: ['id'], columns: [
    { name: 'answers', kind: 'json' },
    { name: 'rejection_reason', kind: 'text' },
  ] },
  { table: 'user_notes', pk: ['owner_id', 'target_id'], columns: [{ name: 'note', kind: 'text' }] },
  { table: 'account_appeals', pk: ['id'], columns: [
    { name: 'message', kind: 'text' },
    { name: 'staff_note', kind: 'text' },
  ] },
  { table: 'safety_incidents', pk: ['id'], columns: [
    { name: 'ip', kind: 'text' },
    { name: 'notes', kind: 'text' },
  ] },
  { table: 'push_devices', pk: ['id'], columns: [{ name: 'token', kind: 'lookup' }], uniqueLookup: 'token' },
];

function needsSeal(kind: Kind, value: unknown, keys?: readonly string[]): boolean {
  if (value === null || value === undefined || value === '') return false;
  if (kind === 'text' || kind === 'lookup') return typeof value === 'string' && !looksSealed(value);
  if (kind === 'json') return !isSealedJson(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return (keys ?? []).some((k) => {
    const v = (value as Record<string, unknown>)[k];
    return v !== null && v !== undefined && v !== '' && !looksSealed(v) && !isSealedJson(v);
  });
}

function seal(ring: FieldKeyring, kind: Kind, value: unknown, keys?: readonly string[]): unknown {
  if (kind === 'text') return sealField(ring, value as string);
  if (kind === 'lookup') return sealLookupField(ring, value as string);
  if (kind === 'json') return sealJson(ring, value);
  return sealKeys(ring, value, keys ?? []);
}

async function loadKeyring(client: Client): Promise<FieldKeyring> {
  const { rows } = await client.query<{ encryption_key: string }>(`SELECT encryption_key FROM platform_settings WHERE id = 'settings' LIMIT 1`);
  const platformKey = rows[0]?.encryption_key;
  if (!platformKey) throw new Error('platform_settings.encryption_key not found');
  // Same derivation as src/lib/security/encryption.ts getFastKey + fieldEncryption.ts.
  const platform = deriveFieldKey('p', createHash('sha256').update(platformKey).digest());
  const raw = env.FIELD_ENCRYPTION_KEY?.trim();
  if (raw && raw.length < 32) throw new Error('FIELD_ENCRYPTION_KEY is shorter than 32 characters (the app ignores it); fix it first');
  return raw ? makeKeyring(deriveFieldKey('e1', raw), platform) : makeKeyring(platform);
}

async function processTarget(client: Client, ring: FieldKeyring, t: Target): Promise<void> {
  const cols = t.columns.map((c) => `"${c.name}"`).join(', ');
  const pks = t.pk.map((c) => `"${c}"`).join(', ');
  let rows: Record<string, unknown>[];
  try {
    ({ rows } = await client.query(`SELECT ${pks}, ${cols} FROM "${t.table}"`));
  } catch (err) {
    if ((err as { code?: string }).code === '42P01') {
      console.log(`${t.table}: table does not exist, skipped`);
      return;
    }
    throw err;
  }

  let pending = 0;
  let updated = 0;
  let removedDuplicates = 0;
  let skipped = 0;
  for (const row of rows) {
    const changes = t.columns.filter((c) => needsSeal(c.kind, row[c.name], c.keys));
    if (changes.length === 0) continue;
    pending++;
    if (!APPLY) continue;

    const params: unknown[] = [];
    const sets: string[] = [];
    const guards: string[] = [];
    for (const c of changes) {
      const isJson = c.kind === 'json' || c.kind === 'secretKeys';
      params.push(isJson ? JSON.stringify(seal(ring, c.kind, row[c.name], c.keys)) : seal(ring, c.kind, row[c.name], c.keys));
      sets.push(`"${c.name}" = $${params.length}${isJson ? '::jsonb' : ''}`);
      params.push(isJson ? JSON.stringify(row[c.name]) : row[c.name]);
      guards.push(`"${c.name}" = $${params.length}${isJson ? '::jsonb' : ''}`);
    }
    for (const k of t.pk) {
      params.push(row[k]);
      guards.push(`"${k}" = $${params.length}`);
    }
    try {
      const res = await client.query(`UPDATE "${t.table}" SET ${sets.join(', ')} WHERE ${guards.join(' AND ')}`, params);
      if (res.rowCount) updated++;
      else skipped++;
    } catch (err) {
      if ((err as { code?: string }).code === '23505' && t.uniqueLookup) {
        // The device already re-registered with its encrypted token: this
        // plaintext row is a duplicate of it.
        const del = await client.query(
          `DELETE FROM "${t.table}" WHERE ${t.pk.map((k, i) => `"${k}" = $${i + 1}`).join(' AND ')} AND "${t.uniqueLookup}" = $${t.pk.length + 1}`,
          [...t.pk.map((k) => row[k]), row[t.uniqueLookup]],
        );
        if (del.rowCount) removedDuplicates++;
      } else {
        throw err;
      }
    }
  }
  console.log(
    APPLY
      ? `${t.table}: ${updated} rows encrypted, ${removedDuplicates} duplicate legacy rows removed, ${skipped} changed concurrently and skipped (of ${pending} legacy)`
      : `${t.table}: ${pending} rows with plaintext values (of ${rows.length})`,
  );
}

async function main() {
  const uri = env.POSTGRES_URI;
  if (!uri) throw new Error('POSTGRES_URI is not set');
  const client = new Client({ connectionString: uri });
  await client.connect();
  try {
    const ring = await loadKeyring(client);
    console.log(APPLY ? `Encrypting legacy values with key "${ring.primary.id}"...` : 'Report only (pass --apply to write):');
    for (const t of TARGETS) await processTarget(client, ring, t);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error((err as Error).message ?? err);
  process.exit(1);
});
