// Deleted-content retention purge: permanently erases soft-deleted messages
// (and the uploaded files only they used) once they have been deleted for
// longer than the retention window (30 days by default), as the Privacy Policy
// promises. Pure rules: src/lib/privacy/retention.ts.
//
// Safety:
//   - Off unless RETENTION_PURGE_ENABLED=1, and a dry run (counts + logs only)
//     unless RETENTION_PURGE_DRY_RUN=0 as well. See .env.example.
//   - Never runs until drizzle/manual_retention_purge.sql (indexes) is applied
//     and the Trust & Safety tables exist, so it can't table-scan `messages`
//     or miss a hold.
//   - One instance at a time (Redis lock); without Redis it doesn't run.
//   - Small batches inside a time budget. Every step is idempotent: deleting a
//     file that is already gone succeeds, and a message row is only removed
//     after all of its own files were deleted, so a crash or a failed file
//     delete simply leaves the row for the next run.
//   - Trust & Safety holds (reported messages, authors with an open or recent
//     CSAM incident or an open appeal) are excluded in SQL and checked again
//     in code, and the final DELETE repeats every condition.
import { randomUUID } from 'node:crypto';
import { and, asc, inArray, notInArray, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { getRedis } from '@/lib/db/redis';
import { config } from '@/lib/config';
import { missingSchema } from '@/lib/db/schemaGuard';
import {
  CSAM_PRESERVATION_DAYS,
  heldAuthorIdsFrom,
  keysFromAttachmentLists,
  messagesBlockedByFailedFiles,
  parseRetentionConfig,
  partitionBatch,
  planFileDeletions,
  purgeableFileKey,
  retentionCutoff,
  urlVariants,
  attachmentUrlsOf,
  type RetentionConfig,
  type RetentionHolds,
} from '@/lib/privacy/retention';

const M = schema.messages;

/** Indexes from drizzle/manual_retention_purge.sql the purge depends on. */
export const RETENTION_INDEXES = [
  'messages_retention_purge_idx',
  'messages_attachments_gin_idx',
  'messages_snapshot_attachments_gin_idx',
] as const;

const LOCK_KEY = 'retention:purge:lock';
const LAST_RUN_KEY = 'retention:purge:last';
const DRY_RUN_MAX_BATCHES = 5;
const PAUSE_BETWEEN_BATCHES_MS = 250;

type Row = Record<string, unknown>;
const rowsOf = (r: unknown): Row[] => ((r as { rows?: Row[] })?.rows ?? (Array.isArray(r) ? (r as Row[]) : []));

const purgeAt = sql`coalesce(${M.deletedAt}, ${M.updatedAt}, ${M.createdAt})`;
// A literal (not a bound parameter) so the planner can match the partial index.
const isDeletedRow = sql`${M.isDeleted} = true`;
const notReported = sql`NOT EXISTS (SELECT 1 FROM message_reports r WHERE r.message_id = ${M.id})`;

function fileOpts() {
  return { cdnUrl: config.CDN_URL, bucket: config.B2_BUCKET_NAME };
}

// ─── Preflight ───────────────────────────────────────────────────────────────

export interface Preflight { ok: boolean; missing: string[] }

/** Tables the holds come from, plus the purge indexes (present and valid). */
export async function retentionPreflight(): Promise<Preflight> {
  const missing = await missingSchema({
    tables: {
      messages: ['is_deleted', 'deleted_at', 'attachments', 'message_snapshot'],
      message_reports: ['message_id'],
      safety_incidents: ['user_id', 'kind', 'status', 'is_test', 'created_at'],
      account_appeals: ['user_id', 'status'],
      bug_reports: ['attachments'],
    },
  });
  const found = rowsOf(await db.execute(sql`
    SELECT c.relname::text AS name, i.indisvalid AS valid
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = ANY(${`{${RETENTION_INDEXES.join(',')}}`}::text[])
  `));
  const valid = new Set(found.filter((r) => r.valid === true).map((r) => String(r.name)));
  for (const name of RETENTION_INDEXES) {
    if (!valid.has(name)) missing.push(found.some((r) => String(r.name) === name) ? `index ${name} (INVALID, rebuild it)` : `index ${name}`);
  }
  return { ok: missing.length === 0, missing };
}

// ─── Holds ───────────────────────────────────────────────────────────────────

/**
 * Before a destructive run: the hold tables exist (the same idempotent
 * ensures the report queue and T&S panel run) and reports filed before the
 * report queue existed have been copied in, so they hold too.
 */
export async function ensureHoldSources(): Promise<boolean> {
  const reports = await import('@/lib/services/messageReports');
  if (!(await reports.ensureMessageReportsSchema())) return false;
  await reports.importLegacyMessageReports();
  await import('@/lib/services/trustSafety').then((m) => m.ensureTrustSafetySchema()).catch(() => {});
  return true;
}

/** Authors under a hold (open/recent CSAM incident, open appeal). Reported messages are excluded per row in SQL. */
export async function loadHeldAuthorIds(now: Date): Promise<Set<string>> {
  const since = new Date(now.getTime() - CSAM_PRESERVATION_DAYS * 24 * 60 * 60 * 1000);
  const [incidents, appeals] = await Promise.all([
    db.select({
      userId: schema.safetyIncidents.userId,
      kind: schema.safetyIncidents.kind,
      status: schema.safetyIncidents.status,
      isTest: schema.safetyIncidents.isTest,
      createdAt: schema.safetyIncidents.createdAt,
    })
      .from(schema.safetyIncidents)
      .where(sql`${schema.safetyIncidents.status} = 'open' OR (${schema.safetyIncidents.kind} = 'csam' AND ${schema.safetyIncidents.createdAt} >= ${since.toISOString()}::timestamp)`),
    db.select({ userId: schema.accountAppeals.userId, status: schema.accountAppeals.status })
      .from(schema.accountAppeals)
      .where(inArray(schema.accountAppeals.status, ['open', 'deciding'])),
  ]);
  return heldAuthorIdsFrom(incidents, appeals, now);
}

/** Holds for a batch: which of these ids have a message report (any status). */
async function reportedAmong(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db.select({ id: schema.messageReports.messageId })
    .from(schema.messageReports)
    .where(inArray(schema.messageReports.messageId, ids));
  return new Set(rows.map((r) => r.id.toLowerCase()));
}

// ─── Batches ─────────────────────────────────────────────────────────────────

interface Cursor { at: string; id: string }

async function fetchBatch(cutoff: Date, heldAuthors: string[], limit: number, after: Cursor | null) {
  const conds: (SQL | undefined)[] = [
    isDeletedRow,
    sql`${purgeAt} < ${cutoff.toISOString()}::timestamp`,
    notReported,
    heldAuthors.length > 0 ? notInArray(M.authorId, heldAuthors) : undefined,
    after ? sql`(${purgeAt}, ${M.id}) > (${after.at}::timestamp, ${after.id}::uuid)` : undefined,
  ];
  return db.select({
    id: M.id,
    authorId: M.authorId,
    isDeleted: M.isDeleted,
    deletedAt: M.deletedAt,
    updatedAt: M.updatedAt,
    createdAt: M.createdAt,
    attachments: M.attachments,
    messageSnapshot: M.messageSnapshot,
    // Exact (microsecond) sort key for the keyset cursor.
    cursorAt: sql<string>`${purgeAt}::text`,
  })
    .from(M)
    .where(and(...conds))
    .orderBy(purgeAt, asc(M.id))
    .limit(limit);
}

/** Keys (of `keys`) that some message outside `excludeIds` still shows. */
async function keysStillReferenced(
  files: Array<{ key: string; url: string }>,
  excludeIds: string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  const cdn = config.CDN_URL;
  for (const { key, url } of files) {
    if (out.has(key)) continue;
    const variants = urlVariants(url, key, cdn);
    const attachmentMatch = sql.join(variants.flatMap((u) => [
      sql`${M.attachments} @> ${JSON.stringify([{ url: u }])}::jsonb`,
      sql`${M.attachments} @> ${JSON.stringify([u])}::jsonb`,
    ]), sql` OR `);
    const snapshotMatch = sql.join(variants.map((u) => sql`(${M.messageSnapshot} -> 'attachments') @> ${JSON.stringify([{ url: u }])}::jsonb`), sql` OR `);
    const rows = await db.select({ id: M.id }).from(M).where(and(
      excludeIds.length > 0 ? notInArray(M.id, excludeIds) : undefined,
      sql`(
        (${M.attachments} IS NOT NULL AND ${M.attachments} <> '[]'::jsonb AND (${attachmentMatch}))
        OR (${M.messageSnapshot} IS NOT NULL AND (${snapshotMatch}))
      )`,
    )).limit(1);
    if (rows.length > 0) out.add(key);
  }
  return out;
}

async function bugReportKeys(): Promise<Set<string>> {
  const rows = await db.select({ attachments: schema.bugReports.attachments })
    .from(schema.bugReports)
    .where(sql`${schema.bugReports.attachments} IS NOT NULL AND ${schema.bugReports.attachments} <> '[]'::jsonb`);
  return keysFromAttachmentLists(rows.map((r) => r.attachments), fileOpts());
}

async function deleteSideRows(ids: string[]): Promise<void> {
  // Each table is boot-created or hand-applied; a missing one is skipped.
  await db.delete(schema.pollVotes).where(inArray(schema.pollVotes.messageId, ids)).catch(() => {});
  await db.delete(schema.messageSearchIndex).where(inArray(schema.messageSearchIndex.messageId, ids)).catch(() => {});
  await db.delete(schema.e2eeEnvelopeHistory).where(inArray(schema.e2eeEnvelopeHistory.messageId, ids)).catch(() => {});
  await db.delete(schema.appMessageModeration).where(inArray(schema.appMessageModeration.messageId, ids)).catch(() => {});
}

// ─── Run ─────────────────────────────────────────────────────────────────────

export interface PurgeRunResult {
  mode: 'dry-run' | 'purge';
  cutoff: string;
  batches: number;
  scanned: number;
  /** Rows removed (purge) or that would be removed (dry run) in the scanned batches. */
  messages: number;
  /** Files deleted (purge) or that would be deleted (dry run). */
  files: number;
  filesKept: number;
  fileErrors: number;
  /** Rows left for the next run because one of their files couldn't be deleted. */
  deferred: number;
  held: number;
  /** Oldest deletion moment in the scanned batches (UTC, Postgres text). */
  oldest: string | null;
  /** True when the scan reached the end (nothing more due right now). */
  done: boolean;
  durationMs: number;
}

export async function runRetentionPurge(opts: {
  dryRun: boolean;
  days: number;
  batchSize: number;
  maxRunMs: number;
  maxBatches?: number;
  now?: Date;
}): Promise<PurgeRunResult> {
  const started = Date.now();
  const now = opts.now ?? new Date();
  const cutoff = retentionCutoff(now, opts.days);
  const deadline = started + opts.maxRunMs;
  const hardDeadline = started + opts.maxRunMs * 2;
  const maxBatches = opts.maxBatches ?? (opts.dryRun ? DRY_RUN_MAX_BATCHES : Number.POSITIVE_INFINITY);
  const result: PurgeRunResult = {
    mode: opts.dryRun ? 'dry-run' : 'purge',
    cutoff: cutoff.toISOString(),
    batches: 0, scanned: 0, messages: 0, files: 0, filesKept: 0, fileErrors: 0, deferred: 0, held: 0,
    oldest: null, done: false, durationMs: 0,
  };

  const heldAuthors = await loadHeldAuthorIds(now);
  const heldAuthorList = [...heldAuthors];
  const protectedKeys = await bugReportKeys();
  const { storage } = opts.dryRun ? { storage: null } : await import('@/lib/services/storage');
  let cursor: Cursor | null = null;

  while (Date.now() < deadline && result.batches < maxBatches) {
    const rows = await fetchBatch(cutoff, heldAuthorList, opts.batchSize, cursor);
    if (rows.length === 0) { result.done = true; break; }
    result.batches++;
    result.scanned += rows.length;
    const last = rows[rows.length - 1];
    cursor = { at: last.cursorAt, id: last.id };
    if (!result.oldest) result.oldest = rows[0].cursorAt;

    // Defense in depth: re-check due + holds in code with a fresh report lookup.
    const holds: RetentionHolds = { reportedMessageIds: await reportedAmong(rows.map((r) => r.id)), heldAuthorIds: heldAuthors };
    const { purge, held } = partitionBatch(rows, cutoff, holds);
    result.held += held.length;
    if (purge.length === 0) continue;

    const purgeIds = purge.map((r) => r.id);
    const files = new Map<string, string>();
    for (const row of purge) {
      for (const url of attachmentUrlsOf(row)) {
        const key = purgeableFileKey(url, fileOpts());
        if (key && !files.has(key) && !protectedKeys.has(key)) files.set(key, url);
      }
    }
    const referenced = await keysStillReferenced([...files].map(([key, url]) => ({ key, url })), purgeIds);
    for (const k of protectedKeys) referenced.add(k);
    const plan = planFileDeletions(purge, referenced, fileOpts());
    result.filesKept += plan.keep.size;

    if (opts.dryRun || !storage) {
      result.files += plan.delete.size;
      result.messages += purge.length;
    } else {
      const failed: string[] = [];
      for (const key of plan.delete.keys()) {
        // Well past the budget (slow storage): leave the rest, and the
        // messages that hold it, for the next run. Stays inside the lock TTL.
        if (Date.now() > hardDeadline) { failed.push(key); continue; }
        try {
          await storage.delete(key);
          result.files++;
        } catch (err) {
          failed.push(key);
          result.fileErrors++;
          console.warn('[retention] Could not delete a file; its message waits for the next run:', (err as Error)?.name ?? 'error');
        }
      }
      const blocked = messagesBlockedByFailedFiles(plan, failed);
      result.deferred += blocked.size;
      const ready = purgeIds.filter((id) => !blocked.has(id));
      if (ready.length > 0) {
        await deleteSideRows(ready);
        // Every condition again, in the statement that deletes.
        const removed = await db.delete(M).where(and(
          inArray(M.id, ready),
          isDeletedRow,
          sql`${purgeAt} < ${cutoff.toISOString()}::timestamp`,
          notReported,
          heldAuthorList.length > 0 ? notInArray(M.authorId, heldAuthorList) : undefined,
        )).returning({ id: M.id });
        result.messages += removed.length;
      }
    }
    if (rows.length < opts.batchSize) { result.done = true; break; }
    await new Promise((r) => setTimeout(r, PAUSE_BETWEEN_BATCHES_MS));
  }

  result.durationMs = Date.now() - started;
  return result;
}

// ─── Report (dry-run counts for staff / the script) ─────────────────────────

export interface RetentionReport {
  cutoff: string;
  days: number;
  /** Deleted messages past the window, by where they were posted. */
  due: Array<{ kind: string; count: number; withFiles: number; oldest: string | null }>;
  dueTotal: number;
  heldByReport: number;
  heldByAuthor: number;
  heldAuthors: number;
  /** Deleted but still inside the window. */
  notYetDue: number;
  /** Soft-deleted rows without deleted_at (dated by updated_at instead). */
  withoutDeletedAt: number;
}

/** Counts only; reads, never writes. */
export async function retentionReport(days: number, now = new Date()): Promise<RetentionReport> {
  const cutoff = retentionCutoff(now, days);
  const cutoffSql = sql`${cutoff.toISOString()}::timestamp`;
  const heldAuthors = [...(await loadHeldAuthorIds(now))];
  const heldSql = heldAuthors.length > 0
    ? sql`m.author_id = ANY(${`{${heldAuthors.join(',')}}`}::uuid[])`
    : sql`false`;

  const dueRows = rowsOf(await db.execute(sql`
    SELECT
      CASE
        WHEN c.id IS NULL THEN 'deleted_channel_or_server'
        WHEN c.type = 'dm' THEN 'dm'
        WHEN c.type = 'group_dm' THEN 'group_dm'
        WHEN c.type IN ('public_thread', 'private_thread') THEN 'thread'
        ELSE 'server_channel'
      END AS kind,
      count(*)::int AS count,
      count(*) FILTER (WHERE (m.attachments IS NOT NULL AND m.attachments <> '[]'::jsonb) OR m.message_snapshot IS NOT NULL)::int AS with_files,
      min(coalesce(m.deleted_at, m.updated_at, m.created_at))::text AS oldest
    FROM messages m
    LEFT JOIN channels c ON c.id = m.channel_id
    WHERE m.is_deleted = true
      AND coalesce(m.deleted_at, m.updated_at, m.created_at) < ${cutoffSql}
      AND NOT EXISTS (SELECT 1 FROM message_reports r WHERE r.message_id = m.id)
      AND NOT (${heldSql})
    GROUP BY 1
    ORDER BY 2 DESC
  `));
  const [counts] = rowsOf(await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE coalesce(m.deleted_at, m.updated_at, m.created_at) < ${cutoffSql}
        AND EXISTS (SELECT 1 FROM message_reports r WHERE r.message_id = m.id))::int AS held_report,
      count(*) FILTER (WHERE coalesce(m.deleted_at, m.updated_at, m.created_at) < ${cutoffSql}
        AND NOT EXISTS (SELECT 1 FROM message_reports r WHERE r.message_id = m.id) AND (${heldSql}))::int AS held_author,
      count(*) FILTER (WHERE coalesce(m.deleted_at, m.updated_at, m.created_at) >= ${cutoffSql})::int AS not_yet_due,
      count(*) FILTER (WHERE m.deleted_at IS NULL)::int AS without_deleted_at
    FROM messages m
    WHERE m.is_deleted = true
  `));
  const due = dueRows.map((r) => ({
    kind: String(r.kind),
    count: Number(r.count) || 0,
    withFiles: Number(r.with_files) || 0,
    oldest: r.oldest ? String(r.oldest) : null,
  }));
  return {
    cutoff: cutoff.toISOString(),
    days,
    due,
    dueTotal: due.reduce((n, d) => n + d.count, 0),
    heldByReport: Number(counts?.held_report) || 0,
    heldByAuthor: Number(counts?.held_author) || 0,
    heldAuthors: heldAuthors.length,
    notYetDue: Number(counts?.not_yet_due) || 0,
    withoutDeletedAt: Number(counts?.without_deleted_at) || 0,
  };
}

// ─── Lock + scheduler ────────────────────────────────────────────────────────

/**
 * Run `fn` while holding the purge lock. Returns null (without running) when
 * another instance holds it or Redis is unavailable: destructive work never
 * runs without the lock.
 */
export async function withRetentionLock<T>(ttlMs: number, fn: () => Promise<T>): Promise<T | null> {
  const redis = getRedis();
  if (!redis) return null;
  const token = randomUUID();
  const got = await redis.set(LOCK_KEY, token, 'PX', Math.max(10_000, Math.floor(ttlMs)), 'NX').catch(() => null);
  if (got !== 'OK') return null;
  try {
    return await fn();
  } finally {
    // Release only our own lock.
    await redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1, LOCK_KEY, token,
    ).catch(() => {});
  }
}

function describe(r: PurgeRunResult): string {
  const verb = r.mode === 'dry-run' ? 'would purge' : 'purged';
  return `[retention] ${r.mode}: ${verb} ${r.messages} deleted message(s) and ${r.files} file(s) `
    + `(files kept because still used: ${r.filesKept}, held for Trust & Safety: ${r.held}`
    + `${r.mode === 'purge' ? `, deferred: ${r.deferred}, file errors: ${r.fileErrors}` : ''}) `
    + `in ${r.batches} batch(es), oldest ${r.oldest ?? 'n/a'}, cutoff ${r.cutoff}, `
    + `${r.done ? 'nothing more due' : 'more remaining'}, ${r.durationMs} ms`;
}

const g = globalThis as unknown as { __retentionPurgeStarted?: boolean; __retentionPurgeRunning?: boolean };

/** One scheduled tick: preflight, lock, run, log. Never throws. */
export async function retentionPurgeTick(cfg: RetentionConfig = parseRetentionConfig(process.env)): Promise<PurgeRunResult | null> {
  if (!cfg.enabled || g.__retentionPurgeRunning) return null;
  g.__retentionPurgeRunning = true;
  try {
    if (!(await ensureHoldSources())) {
      console.warn('[retention] Skipped: message reports are unavailable, so holds cannot be checked.');
      return null;
    }
    const pre = await retentionPreflight();
    if (!pre.ok) {
      console.warn(`[retention] Skipped: missing ${pre.missing.join(', ')}. Apply drizzle/manual_retention_purge.sql (and let the app ensure the Trust & Safety tables).`);
      return null;
    }
    const result = await withRetentionLock(cfg.maxRunMs * 2 + 60_000, () => runRetentionPurge({
      dryRun: cfg.dryRun,
      days: cfg.days,
      batchSize: cfg.batchSize,
      maxRunMs: cfg.maxRunMs,
    }));
    if (!result) return null;
    console.log(describe(result));
    const redis = getRedis();
    if (redis) await redis.set(LAST_RUN_KEY, JSON.stringify({ ...result, at: new Date().toISOString() }), 'EX', 7 * 24 * 3600).catch(() => {});
    return result;
  } catch (err) {
    console.error('[retention] Run failed:', (err as Error)?.message ?? err);
    return null;
  } finally {
    g.__retentionPurgeRunning = false;
  }
}

/**
 * Called once from server.ts. Does nothing unless RETENTION_PURGE_ENABLED is
 * on. The first run waits 10-15 minutes after boot so deploys stay light.
 */
export function startRetentionPurgeScheduler(env: Record<string, string | undefined> = process.env): void {
  if (g.__retentionPurgeStarted) return;
  g.__retentionPurgeStarted = true;
  const cfg = parseRetentionConfig(env);
  if (!cfg.enabled) {
    console.log('[retention] Deleted-content purge is off (RETENTION_PURGE_ENABLED is not set).');
    return;
  }
  console.log(`[retention] Deleted-content purge on: ${cfg.dryRun ? 'DRY RUN (nothing is deleted)' : 'DELETING'}, `
    + `after ${cfg.days} days, every ${Math.round(cfg.intervalMs / 60_000)} min, batches of ${cfg.batchSize}, ${Math.round(cfg.maxRunMs / 1000)} s per run.`);
  const first = setTimeout(() => {
    void retentionPurgeTick(cfg);
    const timer = setInterval(() => { void retentionPurgeTick(cfg); }, cfg.intervalMs);
    (timer as { unref?: () => void }).unref?.();
  }, 10 * 60_000 + Math.floor(Math.random() * 5 * 60_000));
  (first as { unref?: () => void }).unref?.();
}
