// Shared guard for boot-time additive DDL on the production database.
//
// ALTER TABLE ... ADD COLUMN IF NOT EXISTS still takes an ACCESS EXCLUSIVE
// lock on the table, even when the column is there: on `messages` that stalls
// every query behind it on each boot. So the guard asks information_schema
// first and only runs the DDL for what is missing, with a short lock timeout
// and retries. If the schema is still incomplete afterwards it throws, so the
// new instance fails to boot (the old one keeps serving) instead of serving
// queries that select columns that don't exist.
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/postgres';

type Row = Record<string, unknown>;
const rowsOf = (r: unknown): Row[] => ((r as { rows?: Row[] })?.rows ?? (Array.isArray(r) ? (r as Row[]) : []));

export interface SchemaRequirement {
  /** table name -> columns that must exist (an empty list = the table must exist). */
  tables: Record<string, string[]>;
}

/** What of `req` is missing, as "table" or "table.column" strings (empty = complete). */
export async function missingSchema(req: SchemaRequirement): Promise<string[]> {
  const names = Object.keys(req.tables);
  const rows = rowsOf(await db.execute(sql`
    SELECT table_name::text AS t, column_name::text AS c
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = ANY(${`{${names.join(',')}}`}::text[])
  `));
  const have = new Map<string, Set<string>>();
  for (const r of rows) {
    const t = String(r.t);
    if (!have.has(t)) have.set(t, new Set());
    have.get(t)!.add(String(r.c));
  }
  const out: string[] = [];
  for (const [table, cols] of Object.entries(req.tables)) {
    const found = have.get(table);
    if (!found) { out.push(table); continue; }
    for (const c of cols) if (!found.has(c)) out.push(`${table}.${c}`);
  }
  return out;
}

/**
 * Run `apply` (idempotent DDL) until `req` is satisfied: skips it entirely
 * when nothing is missing, retries with backoff, throws when still missing.
 */
export async function ensureSchema(
  label: string,
  req: SchemaRequirement,
  apply: (missing: string[]) => Promise<void>,
  opts: { attempts?: number; backoffMs?: (attempt: number) => number } = {},
): Promise<void> {
  const attempts = opts.attempts ?? 10;
  const backoff = opts.backoffMs ?? ((a: number) => Math.min(10_000, 1_000 * a));
  let missing: string[] = [];
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      missing = await missingSchema(req);
      if (missing.length === 0) return;
      await apply(missing);
      missing = await missingSchema(req);
      if (missing.length === 0) return;
    } catch (err) {
      console.error(`[${label}] schema ensure failed (attempt ${attempt}):`, (err as Error)?.message ?? err);
    }
    await new Promise((r) => setTimeout(r, backoff(attempt)));
  }
  throw new Error(`[${label}] schema still incomplete after ${attempts} attempts: ${missing.join(', ') || 'unknown'}`);
}

/** Run statements in one transaction with a short lock timeout. */
export async function withLockTimeout(statements: ReturnType<typeof sql>[], timeout = '3s'): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL lock_timeout = '${timeout.replace(/[^0-9a-z]/gi, '')}'`));
    for (const st of statements) await tx.execute(st);
  });
}
