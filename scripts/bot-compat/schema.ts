/**
 * Build the bot-compat database schema offline: diff src/lib/db/schema.ts
 * against an empty snapshot with drizzle-kit/api (no drizzle-kit push, no
 * env-read URL), apply the statements, then every drizzle/manual_*.sql.
 * The boot-time ensure*Schema() steps run later when serve.ts calls
 * initializeAPI(). Local stack only (see guard.ts).
 *
 *   bun --no-env-file --env-file=scripts/bot-compat/.env.test scripts/bot-compat/schema.ts
 */
import { assertLocalStack } from './guard';

assertLocalStack();

const { readdirSync, readFileSync } = await import('node:fs');
const { join } = await import('node:path');
const { Client } = await import('pg');
const { generateDrizzleJson, generateMigration } = await import('drizzle-kit/api');
const schema = await import('../../src/lib/db/schema');

const client = new Client({ connectionString: process.env.POSTGRES_URI });
await client.connect();

const { rows } = await client.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users'`);
if (rows[0].n > 0) {
  console.log('schema: users table exists; skipping generated DDL (manual SQL is idempotent and re-applied)');
} else {
  // schema.ts keeps its pgEnums module-private; collect them from the columns
  // so drizzle-kit emits the CREATE TYPE statements too.
  const { getTableConfig, PgTable } = await import('drizzle-orm/pg-core');
  const imports: Record<string, unknown> = { ...(schema as Record<string, unknown>) };
  for (const value of Object.values(schema)) {
    if (!(value instanceof PgTable)) continue;
    for (const col of getTableConfig(value).columns) {
      const e = (col as unknown as { enum?: { enumName: string } }).enum;
      if (e?.enumName) imports[`__enum_${e.enumName}`] = e;
    }
  }
  const empty = generateDrizzleJson({});
  const current = generateDrizzleJson(imports);
  const statements = await generateMigration(empty, current);
  let ok = 0;
  for (const stmt of statements) {
    try {
      await client.query(stmt);
      ok++;
    } catch (err) {
      console.warn('schema: statement failed:', (err as Error).message, '\n  ', stmt.slice(0, 160));
    }
  }
  console.log(`schema: applied ${ok}/${statements.length} generated statements`);
}

const dir = join(import.meta.dir, '../../drizzle');
const manual = readdirSync(dir).filter((f) => /^manual_.*\.sql$/.test(f)).sort();
let manualOk = 0;
for (const f of manual) {
  try {
    await client.query(readFileSync(join(dir, f), 'utf8'));
    manualOk++;
  } catch (err) {
    console.warn(`schema: ${f}:`, (err as Error).message);
  }
}
console.log(`schema: applied ${manualOk}/${manual.length} manual SQL files`);
await client.end();
