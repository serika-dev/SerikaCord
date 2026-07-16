/**
 * One-shot migration: rewrite legacy Backblaze media URLs to the CDN.
 *
 * The B2 bucket `serikacord-media` is now fronted by a CDN at cdn.serika.chat,
 * which maps to the bucket root. Older DB rows still hold the raw B2 URLs in a
 * few different shapes; this script rewrites every text/jsonb column in the
 * public schema so they all point at the CDN.
 *
 *   https://serikacord-media.s3.eu-central-003.backblazeb2.com/<key>  (virtual-host)
 *   https://s3.eu-central-003.backblazeb2.com/serikacord-media/<key>  (path style)
 *   https://f003.backblazeb2.com/file/serikacord-media/<key>          (B2 friendly)
 *     →  https://cdn.serika.chat/<key>
 *
 * Idempotent: URLs already on cdn.serika.chat are left untouched. Run with:
 *   bun run scripts/migrate-media-urls.ts          # apply
 *   bun run scripts/migrate-media-urls.ts --dry     # count only, no writes
 */
import { getClient, disconnectDB } from '../src/lib/db/postgres';
import { config } from '../src/lib/config';

const CDN = (process.env.CDN_URL || config.CDN_URL).replace(/\/+$/, '');
const BUCKET = config.B2_BUCKET_NAME;

// old-prefix → replacement. Order doesn't matter; each is applied independently.
const REPLACEMENTS: Array<[string, string]> = [
  [`https://${BUCKET}.s3.eu-central-003.backblazeb2.com`, CDN],
  [`https://s3.eu-central-003.backblazeb2.com/${BUCKET}`, CDN],
  [`https://f003.backblazeb2.com/file/${BUCKET}`, CDN],
];

const DRY = process.argv.includes('--dry');

async function main() {
  const client = await getClient();
  console.log(`${DRY ? '🔍 DRY RUN — ' : ''}Rewriting legacy B2 URLs → ${CDN}\n`);

  // Every text-ish / jsonb column in user tables.
  const { rows: columns } = await client.query<{
    table_name: string;
    column_name: string;
    data_type: string;
  }>(`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type IN ('text', 'character varying', 'jsonb')
    ORDER BY table_name, column_name
  `);

  let totalRows = 0;

  for (const col of columns) {
    const { table_name: t, column_name: c, data_type: dt } = col;
    const qt = `"${t}"`;
    const qc = `"${c}"`;
    const isJson = dt === 'jsonb';

    for (const [oldPrefix, newPrefix] of REPLACEMENTS) {
      // LIKE match against the text representation; safe for both text and jsonb.
      const likeExpr = isJson ? `${qc}::text` : qc;
      const like = `%${oldPrefix}%`;

      if (DRY) {
        const { rows } = await client.query(
          `SELECT count(*)::int AS n FROM ${qt} WHERE ${likeExpr} LIKE $1`,
          [like]
        );
        const n = rows[0]?.n ?? 0;
        if (n > 0) {
          totalRows += n;
          console.log(`  ${t}.${c}  ${n} row(s) contain ${oldPrefix}`);
        }
        continue;
      }

      // REPLACE on the text form; cast back to jsonb where needed.
      const setExpr = isJson
        ? `REPLACE(${qc}::text, $1, $2)::jsonb`
        : `REPLACE(${qc}, $1, $2)`;
      const res = await client.query(
        `UPDATE ${qt} SET ${qc} = ${setExpr} WHERE ${likeExpr} LIKE $3`,
        [oldPrefix, newPrefix, like]
      );
      if (res.rowCount && res.rowCount > 0) {
        totalRows += res.rowCount;
        console.log(`  ✅ ${t}.${c}  ${res.rowCount} row(s)  (${oldPrefix} → ${newPrefix})`);
      }
    }
  }

  client.release();
  console.log(
    `\n${DRY ? '🔍 Would update' : '✅ Updated'} ${totalRows} row-column match(es).`
  );
  await disconnectDB();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('❌ Migration failed:', err);
  await disconnectDB().catch(() => {});
  process.exit(1);
});
