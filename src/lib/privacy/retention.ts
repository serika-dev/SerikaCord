// Pure rules for the deleted-content retention purge (no DB, Redis or network).
// The service that applies them is src/lib/services/retentionPurge.ts; the
// Privacy Policy promise it keeps is "things you delete: gone from our live
// systems within 30 days" (src/app/(legal)/privacy/page.tsx).
//
// What a purge does to a soft-deleted message (is_deleted = true) once it has
// been deleted for longer than the retention window:
//   - its uploaded files are deleted from storage, unless another message row
//     (a forward, a reused upload) or a bug report still points at them;
//   - the row and its side rows (poll votes, search index, E2EE edit history,
//     app moderation metadata) are hard-deleted. Replies to it already render
//     "original message deleted" for a deleted or a missing message, so no
//     tombstone is needed.
// Content under a Trust & Safety hold is never touched (see RetentionHolds).

export const DEFAULT_RETENTION_DAYS = 30;
const MIN_RETENTION_DAYS = 1;
const MAX_RETENTION_DAYS = 3650;
const DAY_MS = 24 * 60 * 60 * 1000;

/** How long a CSAM incident keeps the uploader's deleted content (18 U.S.C. § 2258A(h): one year). */
export const CSAM_PRESERVATION_DAYS = 365;

export interface RetentionConfig {
  /** RETENTION_PURGE_ENABLED: the hourly job runs at all (default off). */
  enabled: boolean;
  /** RETENTION_PURGE_DRY_RUN: log what would be purged, delete nothing (default on). */
  dryRun: boolean;
  /** RETENTION_PURGE_DAYS: deleted for longer than this many days (default 30). */
  days: number;
  /** RETENTION_PURGE_BATCH_SIZE: messages per batch (default 100). */
  batchSize: number;
  /** RETENTION_PURGE_MAX_SECONDS: time budget of one run (default 60). */
  maxRunMs: number;
  /** RETENTION_PURGE_INTERVAL_MINUTES: time between runs (default 60). */
  intervalMs: number;
}

type Env = Record<string, string | undefined>;

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const v = value.trim().toLowerCase();
  if (v === '') return fallback;
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return fallback;
}

function int(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/**
 * Reads the purge settings. Unknown or malformed values fall back to the safe
 * default: a typo in RETENTION_PURGE_DRY_RUN keeps dry run on, a typo in
 * RETENTION_PURGE_ENABLED keeps the job off.
 */
export function parseRetentionConfig(env: Env): RetentionConfig {
  return {
    enabled: flag(env.RETENTION_PURGE_ENABLED, false),
    dryRun: flag(env.RETENTION_PURGE_DRY_RUN, true),
    days: int(env.RETENTION_PURGE_DAYS, DEFAULT_RETENTION_DAYS, MIN_RETENTION_DAYS, MAX_RETENTION_DAYS),
    batchSize: int(env.RETENTION_PURGE_BATCH_SIZE, 100, 1, 500),
    maxRunMs: int(env.RETENTION_PURGE_MAX_SECONDS, 60, 5, 15 * 60) * 1000,
    intervalMs: int(env.RETENTION_PURGE_INTERVAL_MINUTES, 60, 5, 24 * 60) * 60_000,
  };
}

/** Anything deleted before this moment is due. Days are clamped like the env value. */
export function retentionCutoff(now: Date, days: number): Date {
  const d = Number.isFinite(days) ? Math.min(MAX_RETENTION_DAYS, Math.max(MIN_RETENTION_DAYS, Math.floor(days))) : DEFAULT_RETENTION_DAYS;
  return new Date(now.getTime() - d * DAY_MS);
}

/**
 * When a message counts as deleted: deleted_at, else (older rows soft-deleted
 * before deleted_at was written) the last update, else its creation. Mirrors
 * the SQL expression COALESCE(deleted_at, updated_at, created_at) the purge
 * index is built on.
 */
export function deletedMoment(row: { deletedAt?: Date | string | null; updatedAt?: Date | string | null; createdAt?: Date | string | null }): Date | null {
  for (const v of [row.deletedAt, row.updatedAt, row.createdAt]) {
    if (v === null || v === undefined) continue;
    const d = v instanceof Date ? v : new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

// ─── Trust & Safety holds ────────────────────────────────────────────────────

/**
 * Content the purge must keep. There is no separate legal-hold table, so a
 * hold is derived from the Trust & Safety records:
 *   - reportedMessageIds: every message with a row in message_reports, in any
 *     status (open, resolved or dismissed). Reports keep their own snapshot
 *     but point at the message's files, and resolved ones are strike evidence;
 *     they are kept for as long as the report exists.
 *   - heldAuthorIds: authors with an open safety incident, a (non-test) CSAM
 *     incident in the last CSAM_PRESERVATION_DAYS, or an open appeal. All of
 *     their deleted messages are kept while that lasts.
 */
export interface RetentionHolds {
  reportedMessageIds: Set<string>;
  heldAuthorIds: Set<string>;
}

export type HoldReason = 'report' | 'author';

const lower = (id: string) => id.toLowerCase();

export function holdReason(row: { id: string; authorId: string }, holds: RetentionHolds): HoldReason | null {
  if (holds.reportedMessageIds.has(lower(row.id))) return 'report';
  if (holds.heldAuthorIds.has(lower(row.authorId))) return 'author';
  return null;
}

export interface IncidentFact { userId: string; kind: string; status: string; isTest: boolean; createdAt: Date | string }
export interface AppealFact { userId: string; status: string }

/** Authors whose deleted content is kept (see RetentionHolds). Ids lower-cased. */
export function heldAuthorIdsFrom(incidents: IncidentFact[], appeals: AppealFact[], now: Date): Set<string> {
  const out = new Set<string>();
  const csamSince = now.getTime() - CSAM_PRESERVATION_DAYS * DAY_MS;
  for (const i of incidents) {
    if (!i.userId) continue;
    if (i.status === 'open') { out.add(lower(i.userId)); continue; }
    const at = new Date(i.createdAt).getTime();
    if (i.kind === 'csam' && !i.isTest && Number.isFinite(at) && at >= csamSince) out.add(lower(i.userId));
  }
  for (const a of appeals) {
    if (a.userId && (a.status === 'open' || a.status === 'deciding')) out.add(lower(a.userId));
  }
  return out;
}

// ─── Batch selection ─────────────────────────────────────────────────────────

export interface CandidateRow {
  id: string;
  authorId: string;
  isDeleted: boolean | null;
  deletedAt?: Date | string | null;
  updatedAt?: Date | string | null;
  createdAt?: Date | string | null;
  attachments?: unknown;
  messageSnapshot?: unknown;
}

/**
 * Splits a batch the SQL query returned into what to purge and what to skip.
 * The query already filters on all of this; checking again here means a
 * query mistake can only make the purge do less, never delete live, recent
 * or held content.
 */
export function partitionBatch<T extends CandidateRow>(rows: T[], cutoff: Date, holds: RetentionHolds): {
  purge: T[];
  held: Array<{ row: T; reason: HoldReason }>;
  skipped: T[];
} {
  const purge: T[] = [];
  const held: Array<{ row: T; reason: HoldReason }> = [];
  const skipped: T[] = [];
  for (const row of rows) {
    const at = deletedMoment(row);
    if (row.isDeleted !== true || !at || at.getTime() >= cutoff.getTime()) { skipped.push(row); continue; }
    const reason = holdReason(row, holds);
    if (reason) { held.push({ row, reason }); continue; }
    purge.push(row);
  }
  return { purge, held, skipped };
}

// ─── Files ───────────────────────────────────────────────────────────────────

/** URLs of the files a message row shows: its attachments and a forward's copied attachments. */
export function attachmentUrlsOf(row: { attachments?: unknown; messageSnapshot?: unknown }): string[] {
  const out: string[] = [];
  const collect = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const a of list) {
      const url = typeof a === 'string' ? a : a && typeof a === 'object' ? (a as { url?: unknown }).url : null;
      if (typeof url === 'string' && url.length > 0 && url.length <= 2048) out.push(url);
    }
  };
  collect(row.attachments);
  const snap = row.messageSnapshot;
  if (snap && typeof snap === 'object') collect((snap as { attachments?: unknown }).attachments);
  return [...new Set(out)];
}

// Upload keys are always attachments/<owner segments>/<random name>.
const KEY_RE = /^attachments\/[A-Za-z0-9._-]+\/[A-Za-z0-9._\-/]+$/;

/**
 * The storage key of a message file we may delete, or null. Only files on our
 * CDN (or a legacy Backblaze URL of our bucket) under `attachments/` qualify;
 * Discord-bridged files, external links and other upload categories (avatars,
 * emojis, ...) are never touched.
 */
export function purgeableFileKey(url: string, opts: { cdnUrl: string; bucket: string }): string | null {
  let parsed: URL;
  let cdn: URL;
  try {
    parsed = new URL(url);
    cdn = new URL(opts.cdnUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (parsed.username || parsed.password) return null;
  let path = parsed.pathname.replace(/^\/+/, '');
  const host = parsed.host.toLowerCase();
  const bucket = opts.bucket;
  if (host === cdn.host.toLowerCase()) {
    const base = cdn.pathname.replace(/^\/+|\/+$/g, '');
    if (base) {
      if (!path.startsWith(`${base}/`)) return null;
      path = path.slice(base.length + 1);
    }
  } else if (host === `${bucket}.s3.eu-central-003.backblazeb2.com`.toLowerCase()) {
    // virtual-host style: key is the whole path
  } else if (host === 's3.eu-central-003.backblazeb2.com' && path.startsWith(`${bucket}/`)) {
    path = path.slice(bucket.length + 1);
  } else if (host === 'f003.backblazeb2.com' && path.startsWith(`file/${bucket}/`)) {
    path = path.slice(`file/${bucket}/`.length);
  } else {
    return null;
  }
  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (!KEY_RE.test(path) || path.includes('..') || path.includes('//')) return null;
  return path;
}

export interface FilePlan {
  /** Storage keys to delete, each with the ids of the purged messages that held it. */
  delete: Map<string, string[]>;
  /** Keys still referenced elsewhere (kept). */
  keep: Set<string>;
  /** URLs that are not ours to delete (external, other categories). */
  foreign: number;
}

/**
 * Which files of the messages being purged can go. `referencedKeys` are keys
 * still used by any other message row (outside this batch) or a bug report;
 * those stay. A key held by two purged messages is deleted once.
 */
export function planFileDeletions(
  rows: Array<{ id: string; attachments?: unknown; messageSnapshot?: unknown }>,
  referencedKeys: Set<string>,
  opts: { cdnUrl: string; bucket: string },
): FilePlan {
  const del = new Map<string, string[]>();
  const keep = new Set<string>();
  let foreign = 0;
  for (const row of rows) {
    for (const url of attachmentUrlsOf(row)) {
      const key = purgeableFileKey(url, opts);
      if (!key) { foreign++; continue; }
      if (referencedKeys.has(key)) { keep.add(key); continue; }
      const owners = del.get(key) ?? [];
      if (!owners.includes(row.id)) owners.push(row.id);
      del.set(key, owners);
    }
  }
  return { delete: del, keep, foreign };
}

/**
 * The URL spellings a key may be stored under (exact stored URL plus the
 * current CDN form), for the "is this file used anywhere else" lookup.
 */
export function urlVariants(url: string, key: string, cdnUrl: string): string[] {
  return [...new Set([url, `${cdnUrl.replace(/\/+$/, '')}/${key}`])];
}

/** Keys referenced by bug report attachments (`[{ url }]` or `[url]`), for the keep list. */
export function keysFromAttachmentLists(lists: unknown[], opts: { cdnUrl: string; bucket: string }): Set<string> {
  const out = new Set<string>();
  for (const list of lists) {
    for (const url of attachmentUrlsOf({ attachments: list })) {
      const key = purgeableFileKey(url, opts);
      if (key) out.add(key);
    }
  }
  return out;
}

/** Message ids whose files could not all be deleted: their rows wait for the next run. */
export function messagesBlockedByFailedFiles(plan: FilePlan, failedKeys: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const key of failedKeys) for (const id of plan.delete.get(key) ?? []) out.add(id);
  return out;
}
