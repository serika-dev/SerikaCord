/**
 * Deleted-content retention purge: report (default) or a one-off run.
 * The scheduled job lives in src/lib/services/retentionPurge.ts (server.ts).
 *
 *   bun scripts/retention-purge-report.ts                 # counts only (read-only)
 *   bun scripts/retention-purge-report.ts --simulate      # + dry-run a few batches: files that would go / stay
 *   bun scripts/retention-purge-report.ts --days 45       # another window than RETENTION_PURGE_DAYS
 *   bun scripts/retention-purge-report.ts --allow-slow    # report even before the indexes exist (scans `messages`)
 *
 * Destructive one-off run (deletes rows and files). Refused unless ALL of:
 *   --purge --confirm, RETENTION_PURGE_ENABLED=1, RETENTION_PURGE_DRY_RUN=0,
 *   drizzle/manual_retention_purge.sql applied, and Redis reachable (lock).
 *   RETENTION_PURGE_ENABLED=1 RETENTION_PURGE_DRY_RUN=0 bun scripts/retention-purge-report.ts --purge --confirm
 *
 * Production data: read it before running, and run it deliberately. It never
 * prints message content, only counts and timestamps.
 */
import { connectDB, disconnectDB, disconnectRedis } from '../src/lib/db';
import { parseRetentionConfig } from '../src/lib/privacy/retention';
import {
  ensureHoldSources,
  retentionPreflight,
  retentionReport,
  runRetentionPurge,
  withRetentionLock,
} from '../src/lib/services/retentionPurge';

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
function argValue(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<number> {
  const cfg = parseRetentionConfig({ ...process.env, ...(argValue('--days') ? { RETENTION_PURGE_DAYS: argValue('--days') } : {}) });
  const purge = has('--purge');

  if (purge) {
    const refusals: string[] = [];
    if (!has('--confirm')) refusals.push('--confirm is missing');
    if (!cfg.enabled) refusals.push('RETENTION_PURGE_ENABLED is not 1');
    if (cfg.dryRun) refusals.push('RETENTION_PURGE_DRY_RUN is not 0');
    if (refusals.length > 0) {
      console.error(`Refusing to purge: ${refusals.join('; ')}.`);
      return 2;
    }
  }

  await connectDB();
  // Destructive runs make sure every hold source is in place first (this may
  // create the report table or copy in legacy reports); reports stay read-only.
  if (purge && !(await ensureHoldSources())) {
    console.error('Refusing to purge: message reports are unavailable, so holds cannot be checked.');
    return 2;
  }
  const pre = await retentionPreflight();
  if (!pre.ok) {
    console.warn(`Missing: ${pre.missing.join(', ')}`);
    console.warn('Apply drizzle/manual_retention_purge.sql (and start the app once so it ensures the Trust & Safety tables).');
    if (purge || !has('--allow-slow')) {
      console.error(purge ? 'Refusing to purge without them.' : 'Not reporting without the indexes (it would scan the whole messages table). Pass --allow-slow to do it anyway.');
      return 2;
    }
  }

  const report = await retentionReport(cfg.days);
  console.log(`\nRetention window: ${report.days} days (deleted before ${report.cutoff})\n`);
  console.log('Due for purge, by where it was posted:');
  if (report.due.length === 0) console.log('  (nothing)');
  for (const d of report.due) {
    console.log(`  ${d.kind.padEnd(26)} ${String(d.count).padStart(9)} messages  ${String(d.withFiles).padStart(8)} with files  oldest ${d.oldest ?? 'n/a'}`);
  }
  console.log(`  ${'total'.padEnd(26)} ${String(report.dueTotal).padStart(9)} messages`);
  console.log('\nKept (Trust & Safety holds):');
  console.log(`  reported messages (any report status)   ${report.heldByReport}`);
  console.log(`  by held authors (${report.heldAuthors} account(s))          ${report.heldByAuthor}`);
  console.log(`\nDeleted, still inside the window:          ${report.notYetDue}`);
  console.log(`Deleted rows without deleted_at (dated by updated_at): ${report.withoutDeletedAt}`);

  if (has('--simulate') && !purge) {
    const sim = await runRetentionPurge({ dryRun: true, days: cfg.days, batchSize: cfg.batchSize, maxRunMs: 60_000, maxBatches: 20 });
    console.log(`\nSimulated ${sim.batches} batch(es) of up to ${cfg.batchSize} (${sim.scanned} messages, nothing deleted):`);
    console.log(`  would delete ${sim.messages} messages and ${sim.files} files; ${sim.filesKept} files kept (still used elsewhere); ${sim.held} held`);
    console.log(`  ${sim.done ? 'covered everything due' : 'more remains beyond the simulated batches'}`);
  }

  if (purge) {
    console.log(`\nPurging (time budget ${Math.round(cfg.maxRunMs / 1000)} s, batches of ${cfg.batchSize})...`);
    const result = await withRetentionLock(cfg.maxRunMs * 2 + 60_000, () => runRetentionPurge({
      dryRun: false, days: cfg.days, batchSize: cfg.batchSize, maxRunMs: cfg.maxRunMs,
    }));
    if (!result) {
      console.error('Could not take the purge lock (another instance is running it, or Redis is unavailable).');
      return 3;
    }
    console.log(`  deleted ${result.messages} messages and ${result.files} files; kept ${result.filesKept} files still in use; `
      + `${result.held} held; ${result.deferred} deferred (${result.fileErrors} file errors); ${result.done ? 'nothing more due' : 'more remaining, run again'}`);
  }
  return 0;
}

main()
  .then(async (code) => {
    await disconnectDB().catch(() => {});
    await disconnectRedis().catch(() => {});
    process.exit(code);
  })
  .catch(async (err) => {
    console.error('Failed:', (err as Error)?.message ?? err);
    await disconnectDB().catch(() => {});
    await disconnectRedis().catch(() => {});
    process.exit(1);
  });
