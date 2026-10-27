/**
 * Invite target users (Discord: "users allowed to see and accept this
 * invite"): request parsing, the CSV format and the job-status object. Pure,
 * no I/O; storage in src/lib/services/inviteTargets.ts, routes in
 * src/lib/api/botApi/social.ts. Unit tested in tests/socialparity-invite-targets.test.ts.
 */
import { FormErrors, FE } from './formErrors';
import { isUuid } from './idTranslate';
import { isPublicSnowflake } from './snowflake';

export const INVITE_TARGET_LIMITS = {
  /** user_ids in one bulk-add / bulk-delete (Discord: 1000). */
  bulk: 1000,
  /** Users on one invite's allowlist (Discord does not document one). */
  perInvite: 10_000,
  /** target_users_file size. */
  fileBytes: 512 * 1024,
} as const;

/** Discord's job status codes. */
export const TARGET_JOB_STATUS = { UNSPECIFIED: 0, PROCESSING: 1, COMPLETED: 2, FAILED: 3 } as const;

/** What the invite row's `metadata.target_users` records about the allowlist. */
export interface TargetUsersMarker {
  count: number;
  updated_at: string;
}

/** The allowlist marker on an invite's metadata jsonb, or null when the invite has none. */
export function targetUsersMarker(metadata: unknown): TargetUsersMarker | null {
  const m = (metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>).target_users : null) as Partial<TargetUsersMarker> | null | undefined;
  if (!m || typeof m !== 'object' || typeof m.count !== 'number' || m.count <= 0) return null;
  return { count: m.count, updated_at: typeof m.updated_at === 'string' ? m.updated_at : new Date(0).toISOString() };
}

/** Invite metadata with the marker set (count > 0) or removed. */
export function withTargetUsersMarker(metadata: unknown, count: number, now: Date = new Date()): Record<string, unknown> {
  const base = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? { ...(metadata as Record<string, unknown>) } : {};
  if (count > 0) base.target_users = { count, updated_at: now.toISOString() };
  else delete base.target_users;
  return base;
}

/** `user_ids` of bulk-add / bulk-delete: 1-1000 user ids (UUIDs after the id boundary). */
export function parseUserIdList(raw: unknown): { ok: true; ids: string[] } | { ok: false; errors: FormErrors } {
  const errors = new FormErrors();
  if (raw === undefined || raw === null) { errors.add(['user_ids'], FE.REQUIRED, 'This field is required'); return { ok: false, errors }; }
  if (!Array.isArray(raw)) { errors.add(['user_ids'], FE.BAD_TYPE, 'Only iterables may be used in a ListType'); return { ok: false, errors }; }
  if (raw.length < 1) { errors.add(['user_ids'], FE.MIN_LENGTH, 'Must be 1 or more in length.'); return { ok: false, errors }; }
  if (raw.length > INVITE_TARGET_LIMITS.bulk) { errors.add(['user_ids'], FE.MAX_LENGTH, `Must be ${INVITE_TARGET_LIMITS.bulk} or fewer in length.`); return { ok: false, errors }; }
  const out = new Set<string>();
  raw.forEach((v, i) => {
    const s = typeof v === 'number' ? String(v) : v;
    if (typeof s === 'string' && isUuid(s)) out.add(s.toLowerCase());
    else errors.add(['user_ids', i], 'NUMBER_TYPE_COERCE', `Value "${String(v).slice(0, 40)}" is not snowflake.`);
  });
  return errors.ok ? { ok: true, ids: [...out] } : { ok: false, errors };
}

export interface CsvParse {
  /** Raw id tokens in file order (snowflakes or lower-cased UUIDs), de-duplicated, with their line numbers. */
  entries: Array<{ id: string; line: number }>;
  /** Discord-style per-line problems ("Line 5: invalid user ID format"). */
  errors: string[];
}

/**
 * A target users CSV: one column of user ids, an optional `user_id` header,
 * blank lines ignored. Ids may be snowflakes or UUIDs (translated by the caller).
 */
export function parseTargetUsersCsv(text: string): CsvParse {
  const entries: Array<{ id: string; line: number }> = [];
  const seen = new Set<string>();
  const errors: string[] = [];
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  lines.forEach((line, idx) => {
    const lineNo = idx + 1;
    const cell = line.split(',')[0]?.trim().replace(/^"(.*)"$/, '$1').trim() ?? '';
    if (!cell) return;
    if (idx === 0 && cell.toLowerCase() === 'user_id') return;
    if (isUuid(cell)) {
      const k = cell.toLowerCase();
      if (!seen.has(k)) { seen.add(k); entries.push({ id: k, line: lineNo }); }
      return;
    }
    if (/^\d+$/.test(cell)) {
      if (!isPublicSnowflake(cell)) { errors.push(`Line ${lineNo}: invalid user ID - must be a valid Discord snowflake`); return; }
      if (!seen.has(cell)) { seen.add(cell); entries.push({ id: cell, line: lineNo }); }
      return;
    }
    errors.push(`Line ${lineNo}: invalid user ID format`);
  });
  return { entries, errors: errors.slice(0, 100) };
}

/** GET target-users body: `user_id` header, one id per line. */
export function buildTargetUsersCsv(ids: readonly string[]): string {
  return ['user_id', ...ids].join('\n') + '\n';
}

/** GET target-users/job-status. Allowlist writes are applied synchronously, so a job is always completed. */
export function targetUsersJobStatus(marker: TargetUsersMarker | null) {
  if (!marker) {
    return { status: TARGET_JOB_STATUS.UNSPECIFIED, total_users: 0, processed_users: 0, created_at: null, completed_at: null, error_message: null };
  }
  return {
    status: TARGET_JOB_STATUS.COMPLETED,
    total_users: marker.count,
    processed_users: marker.count,
    created_at: marker.updated_at,
    completed_at: marker.updated_at,
    error_message: null,
  };
}
