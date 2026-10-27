/**
 * Guild join requests (Discord's member applications) <-> Serika's member
 * applications (`server_member_applications`: apply-to-join forms and rules
 * screening with manual approval). Pure; tested in
 * tests/guildparity-joinrequests.test.ts.
 *
 *   Serika status   Discord application_status
 *   pending         SUBMITTED
 *   interviewed     SUBMITTED (still waiting for a decision)
 *   approved        APPROVED
 *   rejected        REJECTED
 *
 * form_responses: the rules (TERMS, accepted) followed by one field per
 * answer, typed from the server's screening questions when the question still
 * exists (short -> TEXT_INPUT, paragraph -> PARAGRAPH, choice ->
 * MULTIPLE_CHOICE with the picked index), else TEXT_INPUT.
 */
import type { ApplicationQuestion } from '@/lib/servers/community';
import type { FieldError } from './guildSearchRules';

export type JoinRequestStatus = 'STARTED' | 'SUBMITTED' | 'REJECTED' | 'APPROVED';
export type SerikaApplicationStatus = 'pending' | 'approved' | 'rejected' | 'interviewed';

export const JOIN_REQUEST_STATUSES: readonly JoinRequestStatus[] = ['STARTED', 'SUBMITTED', 'REJECTED', 'APPROVED'];
export const REJECTION_REASON_MAX = 160;

export function toJoinRequestStatus(status: string | null | undefined): JoinRequestStatus {
  switch (status) {
    case 'approved': return 'APPROVED';
    case 'rejected': return 'REJECTED';
    default: return 'SUBMITTED';
  }
}

/** Serika statuses a Discord status filter selects ([] = none can match). */
export function serikaStatusesFor(status: JoinRequestStatus | null): SerikaApplicationStatus[] | null {
  switch (status) {
    case null: return null;
    case 'SUBMITTED': return ['pending', 'interviewed'];
    case 'APPROVED': return ['approved'];
    case 'REJECTED': return ['rejected'];
    case 'STARTED': return []; // Serika stores an application only once it is submitted
  }
}

export interface StoredAnswer { questionId?: unknown; question?: unknown; answer?: unknown }

export interface JoinRequestRow {
  id: string;
  serverId: string;
  userId: string;
  status: string | null;
  answers: unknown;
  rejectionReason: string | null;
  processedAt: Date | string | null;
  processedBy: string | null;
  createdAt: Date | string | null;
}

const iso = (d: Date | string | null | undefined): string | null => {
  if (!d) return null;
  const t = d instanceof Date ? d : new Date(d);
  return Number.isFinite(t.getTime()) ? t.toISOString() : null;
};

/** The applicant's answers as Discord form fields. `decode` undoes the HTML escaping of stored text. */
export function toFormResponses(
  answers: unknown,
  ctx: { rules: readonly string[]; questions: readonly ApplicationQuestion[]; decode?: (s: string) => string },
): Array<Record<string, unknown>> {
  const decode = ctx.decode ?? ((s: string) => s);
  const out: Array<Record<string, unknown>> = [];
  if (ctx.rules.length > 0) {
    out.push({ field_type: 'TERMS', label: 'Read and agree to the server rules', required: true, values: ctx.rules.map(decode), response: true });
  }
  const byId = new Map(ctx.questions.map((q) => [q.id, q]));
  for (const raw of Array.isArray(answers) ? answers : []) {
    if (!raw || typeof raw !== 'object') continue;
    const a = raw as StoredAnswer;
    const label = decode(typeof a.question === 'string' ? a.question : '');
    const answer = decode(typeof a.answer === 'string' ? a.answer : '');
    const q = typeof a.questionId === 'string' ? byId.get(a.questionId) : undefined;
    if (q?.type === 'choice') {
      const choices = q.choices.map(decode);
      const index = choices.indexOf(answer);
      out.push({ field_type: 'MULTIPLE_CHOICE', label, required: q.required, choices, ...(index >= 0 ? { response: index } : {}) });
    } else if (q?.type === 'paragraph') {
      out.push({ field_type: 'PARAGRAPH', label, required: q.required, response: answer });
    } else {
      out.push({ field_type: 'TEXT_INPUT', label, required: q?.required ?? false, response: answer });
    }
  }
  return out;
}

/** Discord's guild join request object (users are serialized by the caller). */
export function toDiscordJoinRequest(
  row: JoinRequestRow,
  extras: { user?: unknown; actionedBy?: unknown; formResponses?: Array<Record<string, unknown>> | null },
) {
  const status = toJoinRequestStatus(row.status);
  const reviewed = status === 'APPROVED' || status === 'REJECTED';
  return {
    id: row.id,
    created_at: iso(row.createdAt) ?? new Date(0).toISOString(),
    reviewed_at: reviewed ? iso(row.processedAt) : null,
    application_status: status,
    rejection_reason: status === 'REJECTED' ? row.rejectionReason ?? null : null,
    guild_id: row.serverId,
    user_id: row.userId,
    user: extras.user ?? null,
    form_responses: extras.formResponses ?? null,
    actioned_by_user: reviewed ? extras.actionedBy ?? null : null,
  };
}

/** GET /guilds/{id}/requests query: status, limit (1-100, default 100), before / after (request ids). */
export function parseJoinRequestListQuery(q: Record<string, unknown>):
  { ok: true; status: JoinRequestStatus | null; limit: number; before: string | null; after: string | null } | { ok: false; errors: FieldError[] } {
  const errors: FieldError[] = [];
  const one = (v: unknown) => (v === undefined || v === null || v === '' ? null : String(Array.isArray(v) ? v[v.length - 1] : v));
  const rawStatus = one(q.status);
  let status: JoinRequestStatus | null = null;
  if (rawStatus !== null) {
    const s = rawStatus.toUpperCase() as JoinRequestStatus;
    if (!JOIN_REQUEST_STATUSES.includes(s)) errors.push({ path: 'status', code: 'BASE_TYPE_CHOICES', message: `Value must be one of {${JOIN_REQUEST_STATUSES.map((x) => `'${x}'`).join(', ')}}.` });
    else status = s;
  }
  let limit = 100;
  const rawLimit = one(q.limit);
  if (rawLimit !== null) {
    if (!/^\d+$/.test(rawLimit)) errors.push({ path: 'limit', code: 'NUMBER_TYPE_COERCE', message: `Value "${rawLimit}" is not int.` });
    else if (Number(rawLimit) < 1) errors.push({ path: 'limit', code: 'NUMBER_TYPE_MIN', message: 'int value should be greater than or equal to 1.' });
    else if (Number(rawLimit) > 100) errors.push({ path: 'limit', code: 'NUMBER_TYPE_MAX', message: 'int value should be less than or equal to 100.' });
    else limit = Number(rawLimit);
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, status, limit, before: one(q.before), after: one(q.after) };
}

/** PATCH /guilds/{id}/requests/{request_id} body: action APPROVED | REJECTED, optional rejection_reason. */
export function parseJoinRequestAction(body: unknown):
  { ok: true; action: 'APPROVED' | 'REJECTED'; rejectionReason: string | null } | { ok: false; errors: FieldError[] } {
  const b = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  const errors: FieldError[] = [];
  const action = typeof b.action === 'string' ? b.action.toUpperCase() : b.action;
  if (action === undefined || action === null) errors.push({ path: 'action', code: 'BASE_TYPE_REQUIRED', message: 'This field is required' });
  else if (action !== 'APPROVED' && action !== 'REJECTED') errors.push({ path: 'action', code: 'BASE_TYPE_CHOICES', message: "Value must be one of {'APPROVED', 'REJECTED'}." });
  let rejectionReason: string | null = null;
  if (b.rejection_reason !== undefined && b.rejection_reason !== null) {
    if (typeof b.rejection_reason !== 'string') errors.push({ path: 'rejection_reason', code: 'BASE_TYPE_STRING', message: 'Must be a string.' });
    else if (b.rejection_reason.length > REJECTION_REASON_MAX) errors.push({ path: 'rejection_reason', code: 'BASE_TYPE_MAX_LENGTH', message: `Must be ${REJECTION_REASON_MAX} or fewer in length.` });
    else rejectionReason = b.rejection_reason.trim() || null;
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, action: action as 'APPROVED' | 'REJECTED', rejectionReason: action === 'REJECTED' ? rejectionReason : null };
}
