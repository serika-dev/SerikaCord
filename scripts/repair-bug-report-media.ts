/**
 * Repair bug-report / feedback attachments that lost their `url`.
 *
 * A frontend bug (fixed in f2c7493 / 838037d) stored bug-report attachments as
 * `{ name, type }` with NO `url` — the upload succeeded and the file landed in
 * Backblaze B2, but the returned URL was dropped before submit. So the media is
 * on B2 but the DB rows can't render it.
 *
 * The B2 objects keep the original filename in their `original-filename`
 * metadata, so we can recover the mapping exactly: for each reporter we list
 * `attachments/<reporterId>/`, read each object's original filename, then match
 * every url-less attachment by filename (nearest upload time breaks ties when
 * the same file was uploaded more than once). The recovered CDN url is written
 * back into the attachments jsonb.
 *
 * Idempotent: attachments that already have a `url` are left untouched. Run:
 *   bunx tsx scripts/repair-bug-report-media.ts --dry   # report only, no writes
 *   bunx tsx scripts/repair-bug-report-media.ts         # apply
 */
import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import {
  S3Client,
  ListObjectsV2Command,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';

// --- env (manual .env parse so the script runs standalone) ---
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

const POSTGRES_URI = env.POSTGRES_URI;
const B2_ENDPOINT = env.B2_ENDPOINT || 's3.eu-central-003.backblazeb2.com';
const B2_REGION = env.B2_REGION || 'eu-central-003';
const B2_BUCKET_NAME = env.B2_BUCKET_NAME || 'serikacord-media';
const CDN_URL = (env.CDN_URL || 'https://cdn.serika.chat').replace(/\/+$/, '');
const DRY = process.argv.includes('--dry');

if (!POSTGRES_URI) {
  console.error('❌ POSTGRES_URI not set');
  process.exit(1);
}

const s3 = new S3Client({
  endpoint: `https://${B2_ENDPOINT}`,
  region: B2_REGION,
  credentials: { accessKeyId: env.B2_KEY_ID, secretAccessKey: env.B2_APPLICATION_KEY },
  forcePathStyle: true,
});

interface Attachment {
  name?: string;
  type?: string;
  url?: string;
  [k: string]: unknown;
}

interface B2Object {
  key: string;
  originalName: string;
  lastModified: number;
}

// Per-reporter cache of their B2 attachment objects (+ original filename).
const reporterObjects = new Map<string, B2Object[]>();

async function listReporterObjects(reporterId: string): Promise<B2Object[]> {
  const cached = reporterObjects.get(reporterId);
  if (cached) return cached;

  const prefix = `attachments/${reporterId}/`;
  const objects: B2Object[] = [];
  let token: string | undefined;
  do {
    const out = await s3.send(
      new ListObjectsV2Command({ Bucket: B2_BUCKET_NAME, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000 })
    );
    for (const o of out.Contents || []) {
      if (!o.Key) continue;
      let originalName = '';
      try {
        const head = await s3.send(new HeadObjectCommand({ Bucket: B2_BUCKET_NAME, Key: o.Key }));
        const raw = head.Metadata?.['original-filename'];
        originalName = raw ? decodeURIComponent(raw) : '';
      } catch {
        /* skip objects we can't head */
      }
      objects.push({ key: o.Key, originalName, lastModified: o.LastModified?.getTime() ?? 0 });
    }
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);

  reporterObjects.set(reporterId, objects);
  return objects;
}

/** Pick the B2 object whose original filename matches, nearest to `whenMs`. */
function matchObject(objects: B2Object[], name: string, whenMs: number): B2Object | null {
  const candidates = objects.filter((o) => o.originalName === name);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  // Same file uploaded multiple times — nearest upload time wins.
  return candidates.reduce((best, cur) =>
    Math.abs(cur.lastModified - whenMs) < Math.abs(best.lastModified - whenMs) ? cur : best
  );
}

async function main() {
  const pg = new Client({ connectionString: POSTGRES_URI });
  await pg.connect();

  const { rows } = await pg.query<{
    id: string;
    reporter_id: string;
    created_at: Date;
    attachments: Attachment[];
  }>(
    `SELECT id, reporter_id, created_at, attachments
       FROM bug_reports
      WHERE attachments IS NOT NULL AND jsonb_array_length(attachments) > 0`
  );

  console.log(`${DRY ? '🔍 DRY RUN — ' : ''}Scanning ${rows.length} report(s) with attachments\n`);

  let reportsFixed = 0;
  let attFixed = 0;
  let attAlready = 0;
  let attUnmatched = 0;

  for (const r of rows) {
    const whenMs = r.created_at instanceof Date ? r.created_at.getTime() : new Date(r.created_at).getTime();
    let changed = false;
    const next: Attachment[] = [];

    for (const att of r.attachments) {
      if (att.url) {
        attAlready++;
        next.push(att);
        continue;
      }
      if (!att.name) {
        attUnmatched++;
        next.push(att);
        continue;
      }
      const objects = await listReporterObjects(r.reporter_id);
      const match = matchObject(objects, att.name, whenMs);
      if (!match) {
        attUnmatched++;
        console.warn(`  ⚠️  no B2 match for "${att.name}" (report ${r.id})`);
        next.push(att);
        continue;
      }
      const url = `${CDN_URL}/${match.key}`;
      next.push({ ...att, url });
      changed = true;
      attFixed++;
      console.log(`  ✅ ${r.id}  "${att.name}" → ${url}`);
    }

    if (changed) {
      reportsFixed++;
      if (!DRY) {
        await pg.query(`UPDATE bug_reports SET attachments = $1::jsonb, updated_at = now() WHERE id = $2`, [
          JSON.stringify(next),
          r.id,
        ]);
      }
    }
  }

  console.log(
    `\n${DRY ? '🔍 Would fix' : '✅ Fixed'} ${attFixed} attachment(s) across ${reportsFixed} report(s).` +
      `  (${attAlready} already had urls, ${attUnmatched} unmatched)`
  );
  await pg.end();
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Repair failed:', err);
  process.exit(1);
});
