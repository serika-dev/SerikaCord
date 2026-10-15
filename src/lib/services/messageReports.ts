// Message reports: storage and staff actions for the Trust & Safety review
// queue (Settings → Admin → Trust & Safety → Reports).
//
//   POST /api/channels/:id/messages/:mid/report  → fileMessageReport (ordinary
//     and end-to-end encrypted messages; E2EE content is the franking-verified
//     plaintext, see docs/architecture/e2ee.md)
//   Staff routes: src/lib/api/messageReports.ts. Pure rules (filters, grouping,
//   status transitions): src/lib/safety/messageReports.ts.
//
// Reports of one message are one "case" in the queue. Staff actions apply to
// every report of that message: status changes move the reports that can make
// the transition, the action log and the internal note are written to all.
// Storage: drizzle/manual_message_reports.sql (also ensured here). Reports
// filed before this table existed (bug_reports "Message report: ..." rows) are
// copied in once per process on first use.
import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, inArray, isNull, like, ne, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { normalizeId } from '@/lib/db/normalizeId';
import { AdminLog, Channel, Message, User } from '@/lib/models';
import { sanitizeInput } from '@/lib/security';
import { decodeHtmlEntities } from '@/lib/chat/messages';
import { decryptRows, encryptField, encryptRow, type FieldSpec } from '@/lib/security/fieldEncryption';
import {
  REPORT_CONTENT_MAX,
  REPORT_DETAILS_MAX,
  REPORT_NOTE_MAX,
  REPORT_PAGE_SIZE,
  defaultActionReason,
  groupReportsByMessage,
  groupStatus,
  isAccountAction,
  isDmChannelType,
  isEnforcementAction,
  isLegacyMessageReportRow,
  isUrgentReason,
  legacyReportStatus,
  parseLegacyMessageReport,
  reportExcerpt,
  reportsToTransition,
  shouldBlurReportMedia,
  statusAfterAction,
  strikeCategoryForReport,
  type ReportAction,
  type ReportFilters,
  type ReportStatus,
} from '@/lib/safety/messageReports';
import { MAX_STRIKES, STRIKE_EXPIRY_DAYS, normalizeStrikeCategory } from '@/lib/safety/standing';

const T = schema.messageReports;
type ReportRow = typeof T.$inferSelect;

// Encrypted at rest: the reporter's details, the reported content, the staff
// note, and (sealed JSON) the attachment snapshot + scan notes.
const REPORT_FIELDS: FieldSpec = { text: ['details', 'content', 'staffNote'], json: ['attachments', 'attachmentNotes'] };

export interface ReportAttachment {
  url: string;
  type: string;
  name: string;
}

export interface ReportActionEntry {
  id: string;
  type: ReportAction | 'note';
  by: string;
  at: string;
  /** Non-secret facts only (ids, counts, durations); never the note text. */
  detail?: Record<string, string | number | boolean | null>;
}

// ─── Schema ──────────────────────────────────────────────────────────────────

const g = globalThis as unknown as {
  __messageReportsSchema?: Promise<boolean> | null;
  __messageReportsLegacy?: Promise<void> | null;
};

/** Mirrors drizzle/manual_message_reports.sql. Additive + idempotent, never throws. */
export function ensureMessageReportsSchema(): Promise<boolean> {
  if (g.__messageReportsSchema) return g.__messageReportsSchema;
  const run = (async () => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
          await tx.execute(sql`CREATE TABLE IF NOT EXISTS message_reports (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(), message_id uuid NOT NULL, channel_id uuid NOT NULL, server_id uuid,
            channel_type text, channel_name text, reporter_id uuid NOT NULL, reported_user_id uuid NOT NULL,
            category text NOT NULL DEFAULT 'other', details text, content text,
            attachments jsonb NOT NULL DEFAULT '[]'::jsonb, attachment_notes jsonb NOT NULL DEFAULT '[]'::jsonb,
            encrypted boolean NOT NULL DEFAULT false, franking_verified boolean NOT NULL DEFAULT false, message_sent_at timestamp,
            status text NOT NULL DEFAULT 'open', staff_note text, actions jsonb NOT NULL DEFAULT '[]'::jsonb,
            reviewed_by uuid, reviewed_at timestamp, reporter_notified_at timestamp, legacy_bug_report_id uuid,
            created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now())`);
          await tx.execute(sql`CREATE INDEX IF NOT EXISTS message_reports_status_idx ON message_reports (status, created_at)`);
          await tx.execute(sql`CREATE INDEX IF NOT EXISTS message_reports_message_id_idx ON message_reports (message_id)`);
          await tx.execute(sql`CREATE INDEX IF NOT EXISTS message_reports_reporter_id_idx ON message_reports (reporter_id)`);
          await tx.execute(sql`CREATE INDEX IF NOT EXISTS message_reports_reported_user_id_idx ON message_reports (reported_user_id)`);
          await tx.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS message_reports_legacy_bug_report_unique ON message_reports (legacy_bug_report_id)`);
        });
        return true;
      } catch (err) {
        console.error(`[message-reports] Ensuring schema failed (attempt ${attempt}):`, (err as Error)?.message ?? err);
        await new Promise((r) => setTimeout(r, 1_000 * attempt));
      }
    }
    g.__messageReportsSchema = null;
    return false;
  })();
  g.__messageReportsSchema = run;
  return run;
}

async function ready(): Promise<void> {
  if (!(await ensureMessageReportsSchema())) throw new Error('Message reports are unavailable right now');
}

function attachmentList(value: unknown): ReportAttachment[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object' && typeof (a as { url?: unknown }).url === 'string')
    .slice(0, 10)
    .map((a) => ({
      url: String(a.url),
      type: typeof a.type === 'string' ? a.type : typeof a.contentType === 'string' ? a.contentType : 'file',
      name: typeof a.name === 'string' ? a.name : typeof a.filename === 'string' ? a.filename : 'attachment',
    }));
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').slice(0, 20) : [];
}

function actionList(value: unknown): ReportActionEntry[] {
  return Array.isArray(value) ? (value as ReportActionEntry[]).filter((a) => a && typeof a.id === 'string') : [];
}

/** Stored text is HTML-escaped (sanitizeInput) for ordinary messages; E2EE content is the raw verified plaintext. */
function readable(row: Pick<ReportRow, 'encrypted'>, value: string | null): string {
  if (!value) return '';
  return row.encrypted ? value : decodeHtmlEntities(value);
}

// ─── Filing ──────────────────────────────────────────────────────────────────

export interface NewMessageReport {
  messageId: string;
  channel: { id: string; serverId?: string | null; type?: string | null; name?: string | null };
  reporterId: string;
  reportedUserId: string;
  category: string;
  /** Already sanitized (escaped) by the route. */
  details: string | null;
  /** Escaped stored text for ordinary messages, raw verified plaintext for E2EE. */
  content: string;
  encrypted: boolean;
  frankingVerified: boolean;
  attachments: ReportAttachment[];
  attachmentNotes: string[];
  messageSentAt: Date | null;
}

/**
 * Files a report. A reporter re-reporting a message they already have an
 * open report on updates its category / details; the evidence (content,
 * attachments) is never overwritten: a different version gets its own row.
 */
export async function fileMessageReport(input: NewMessageReport): Promise<{ id: string; updated: boolean }> {
  await ready();
  const values = {
    category: input.category,
    details: input.details,
    content: input.content.slice(0, REPORT_CONTENT_MAX),
    encrypted: input.encrypted,
    frankingVerified: input.frankingVerified,
    attachments: input.attachments.slice(0, 10),
    attachmentNotes: input.attachmentNotes.slice(0, 20),
  };
  const existing = await decryptRows(REPORT_FIELDS, await db.select({ id: T.id, content: T.content, encrypted: T.encrypted }).from(T).where(and(
    eq(T.messageId, normalizeId(input.messageId)),
    eq(T.reporterId, normalizeId(input.reporterId)),
    eq(T.status, 'open'),
  )).limit(20));
  const same = existing.find((r) => (r.content ?? '') === values.content && r.encrypted === values.encrypted);
  if (same) {
    await db.update(T).set(await encryptRow(REPORT_FIELDS, { category: values.category, details: values.details, updatedAt: new Date() })).where(eq(T.id, same.id));
    return { id: same.id, updated: true };
  }
  const [row] = await db.insert(T).values(await encryptRow(REPORT_FIELDS, {
    ...values,
    messageId: normalizeId(input.messageId),
    channelId: normalizeId(input.channel.id),
    serverId: input.channel.serverId ? normalizeId(input.channel.serverId) : null,
    channelType: input.channel.type ?? null,
    channelName: input.channel.name ? input.channel.name.slice(0, 200) : null,
    reporterId: normalizeId(input.reporterId),
    reportedUserId: normalizeId(input.reportedUserId),
    messageSentAt: input.messageSentAt,
  })).returning({ id: T.id });
  return { id: row.id, updated: false };
}

// ─── Legacy reports (bug_reports) ────────────────────────────────────────────

/**
 * Copies reports filed before this table existed. Once per process,
 * idempotent. bug_reports text is not trusted: only rows the old report route
 * wrote (isLegacyMessageReportRow) whose strictly parsed fields match a real
 * message are copied; the reported user, server and channel come from the
 * database, attachments are kept only when they are on that message, and
 * none is marked franking-verified (that proof can't be re-checked now).
 */
export function importLegacyMessageReports(): Promise<void> {
  if (g.__messageReportsLegacy) return g.__messageReportsLegacy;
  const run = (async () => {
    const B = schema.bugReports;
    const { storedEnvelope } = await import('@/lib/e2ee/policy');
    let imported = 0;
    let lastId: string | null = null;
    // Keyset pages by id, skipping rows already copied, so nothing is dropped.
    for (let pageNo = 0; pageNo < 200; pageNo++) {
      const conds: SQL[] = [
        eq(B.kind, 'bug'),
        eq(B.category, 'security'),
        inArray(B.priority, ['medium', 'high']),
        like(B.title, 'Message report:%'),
        sql`NOT EXISTS (SELECT 1 FROM message_reports mr WHERE mr.legacy_bug_report_id = ${B.id})`,
      ];
      if (lastId) conds.push(gt(B.id, lastId));
      const rows = await db.select().from(B).where(and(...conds)).orderBy(asc(B.id)).limit(500);
      if (rows.length === 0) break;
      lastId = rows[rows.length - 1].id;
      for (const bug of rows) {
        if (!isLegacyMessageReportRow(bug)) continue;
        const parsed = parseLegacyMessageReport(bug.title, bug.description);
        if (!parsed) continue;
        const message = await Message.findById(parsed.messageId).catch(() => null);
        if (!message || normalizeId(message.channelId) !== normalizeId(parsed.channelId)) continue;
        if (normalizeId(message.authorId) !== normalizeId(parsed.authorId)) continue;
        if (normalizeId(message.authorId) === normalizeId(bug.reporterId)) continue;
        const channel = await Channel.findById(message.channelId).catch(() => null);
        if (!channel) continue;
        const encrypted = Boolean(storedEnvelope(message.e2ee));
        const onMessage = new Set(attachmentList(message.attachments).map((a) => a.url));
        const status = legacyReportStatus(bug.status);
        const inserted = await db.insert(T).values(await encryptRow(REPORT_FIELDS, {
          messageId: message.id,
          channelId: channel.id,
          serverId: channel.serverId ?? null,
          channelType: channel.type,
          channelName: channel.name ? channel.name.slice(0, 200) : null,
          reporterId: bug.reporterId,
          reportedUserId: message.authorId,
          category: parsed.reason,
          details: parsed.details ? sanitizeInput(parsed.details).slice(0, REPORT_DETAILS_MAX) : null,
          // The old route stored E2EE plaintext as-is and ordinary text escaped.
          content: parsed.content.slice(0, REPORT_CONTENT_MAX),
          attachments: encrypted ? [] : attachmentList(bug.attachments).filter((a) => onMessage.has(a.url)),
          attachmentNotes: encrypted ? parsed.attachmentNotes : [],
          encrypted,
          frankingVerified: false,
          messageSentAt: message.createdAt ? new Date(message.createdAt) : null,
          status,
          reviewedBy: status === 'open' ? null : bug.resolvedBy ?? null,
          reviewedAt: status === 'open' ? null : bug.resolvedAt ?? bug.updatedAt ?? null,
          legacyBugReportId: bug.id,
          createdAt: bug.createdAt ?? new Date(),
        })).onConflictDoNothing({ target: T.legacyBugReportId }).returning({ id: T.id });
        imported += inserted.length;
      }
      if (rows.length < 500) break;
    }
    if (imported > 0) console.log(`[message-reports] Imported ${imported} report(s) filed before the queue existed`);
  })().catch((err) => {
    console.error('[message-reports] Legacy import failed:', (err as Error)?.message ?? err);
    g.__messageReportsLegacy = null;
  });
  g.__messageReportsLegacy = run;
  return run;
}

// ─── Queue ───────────────────────────────────────────────────────────────────

type UserCard = { id: string; username: string; displayName: string | null; avatar: string | null; isBanned: boolean };

async function cardsFor(ids: string[]): Promise<Map<string, UserCard>> {
  const { userCards } = await import('@/lib/services/trustSafety');
  return userCards(ids);
}

async function serverNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((v): v is string => !!v))];
  if (unique.length === 0) return new Map();
  const rows = await db.select({ id: schema.servers.id, name: schema.servers.name }).from(schema.servers).where(inArray(schema.servers.id, unique));
  return new Map(rows.map((r) => [normalizeId(r.id), r.name]));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function statusHaving(status: ReportFilters['status']): SQL | undefined {
  switch (status) {
    case 'open': return sql`bool_or(${T.status} = 'open')`;
    case 'resolved': return sql`NOT bool_or(${T.status} = 'open') AND bool_or(${T.status} = 'resolved')`;
    case 'dismissed': return sql`NOT bool_or(${T.status} IN ('open', 'resolved'))`;
    default: return undefined;
  }
}

export interface ReportCaseSummary {
  id: string;
  messageId: string;
  channelId: string;
  serverId: string | null;
  serverName: string | null;
  channelType: string | null;
  channelName: string | null;
  status: ReportStatus;
  count: number;
  openCount: number;
  reporterCount: number;
  categories: string[];
  urgent: boolean;
  latestAt: string;
  earliestAt: string;
  excerpt: string;
  attachmentCount: number;
  encrypted: boolean;
  frankingVerified: boolean;
  reportedUser: UserCard | null;
  reportedUserId: string;
  reporter: UserCard | null;
}

/**
 * The queue. `hideReportedUserId`: a staff member never sees reports about
 * their own messages (so never learns who reported them).
 */
export async function listReportCases(filters: ReportFilters, hideReportedUserId?: string | null): Promise<{ cases: ReportCaseSummary[]; total: number; page: number; pageSize: number }> {
  await ready();
  // First use in this process: bring in reports filed as bug reports (never throws).
  await importLegacyMessageReports();
  const conds: SQL[] = [];
  if (hideReportedUserId) conds.push(ne(T.reportedUserId, normalizeId(hideReportedUserId)));
  if (filters.category !== 'all') conds.push(eq(T.category, filters.category));
  if (filters.scope === 'dm') conds.push(inArray(T.channelType, ['dm', 'group_dm']));
  if (filters.scope === 'server') conds.push(sql`coalesce(${T.channelType}, '') NOT IN ('dm', 'group_dm')`);
  if (filters.encrypted !== 'any') conds.push(eq(T.encrypted, filters.encrypted === 'yes'));
  if (filters.q) {
    let ids: string[];
    if (UUID.test(filters.q)) ids = [normalizeId(filters.q)];
    else {
      const { searchUsersForStaff } = await import('@/lib/services/trustSafety');
      ids = filters.q.length >= 2 ? (await searchUsersForStaff(filters.q).catch(() => [])).map((u) => u.id) : [];
    }
    if (ids.length === 0) return { cases: [], total: 0, page: filters.page, pageSize: REPORT_PAGE_SIZE };
    conds.push(sql`(${inArray(T.reporterId, ids)} OR ${inArray(T.reportedUserId, ids)})`);
  }
  const where = conds.length ? and(...conds) : undefined;
  const having = statusHaving(filters.status);

  let grouped = db.select({ messageId: T.messageId }).from(T).$dynamic();
  if (where) grouped = grouped.where(where);
  grouped = grouped.groupBy(T.messageId);
  if (having) grouped = grouped.having(having);

  let paged = db.select({ messageId: T.messageId }).from(T).$dynamic();
  if (where) paged = paged.where(where);
  paged = paged.groupBy(T.messageId);
  if (having) paged = paged.having(having);
  const pageRows = await paged
    .orderBy(filters.sort === 'oldest' ? sql`min(${T.createdAt}) asc` : sql`max(${T.createdAt}) desc`)
    .limit(REPORT_PAGE_SIZE)
    .offset((filters.page - 1) * REPORT_PAGE_SIZE);
  const [{ n: total }] = await db.select({ n: sql<number>`count(*)::int` }).from(grouped.as('report_cases'));

  const order = pageRows.map((r) => r.messageId);
  if (order.length === 0) return { cases: [], total: Number(total) || 0, page: filters.page, pageSize: REPORT_PAGE_SIZE };
  // Every report of these messages, so counts show all duplicates.
  const rows = await decryptRows(REPORT_FIELDS, await db.select().from(T).where(inArray(T.messageId, order)));
  const groups = new Map(groupReportsByMessage(rows, filters.sort).map((grp) => [normalizeId(grp.messageId), grp]));
  const [cards, servers] = await Promise.all([
    cardsFor(rows.flatMap((r) => [r.reporterId, r.reportedUserId])),
    serverNames(rows.map((r) => r.serverId)),
  ]);

  const cases: ReportCaseSummary[] = [];
  for (const messageId of order) {
    const grp = groups.get(normalizeId(messageId));
    if (!grp) continue;
    const newest = grp.reports[0];
    cases.push({
      id: newest.id,
      messageId: newest.messageId,
      channelId: newest.channelId,
      serverId: newest.serverId,
      serverName: newest.serverId ? servers.get(normalizeId(newest.serverId)) ?? null : null,
      channelType: newest.channelType,
      channelName: newest.channelName,
      status: grp.status,
      count: grp.count,
      openCount: grp.openCount,
      reporterCount: grp.reporterCount,
      categories: grp.categories,
      urgent: grp.categories.some(isUrgentReason),
      latestAt: new Date(grp.latestAt).toISOString(),
      earliestAt: new Date(grp.earliestAt).toISOString(),
      excerpt: reportExcerpt(readable(newest, newest.content)),
      attachmentCount: Math.max(attachmentList(newest.attachments).length, stringList(newest.attachmentNotes).length),
      encrypted: grp.reports.some((r) => r.encrypted),
      frankingVerified: grp.reports.some((r) => r.encrypted && r.frankingVerified),
      reportedUser: cards.get(normalizeId(newest.reportedUserId)) ?? null,
      reportedUserId: newest.reportedUserId,
      reporter: cards.get(normalizeId(newest.reporterId)) ?? null,
    });
  }
  return { cases, total: Number(total) || 0, page: filters.page, pageSize: REPORT_PAGE_SIZE };
}

export async function messageReportStats(hideReportedUserId?: string | null): Promise<{ openCases: number; openReports: number }> {
  try {
    await ready();
    const where = hideReportedUserId
      ? and(eq(T.status, 'open'), ne(T.reportedUserId, normalizeId(hideReportedUserId)))
      : eq(T.status, 'open');
    const [row] = await db.select({
      cases: sql<number>`count(distinct ${T.messageId})::int`,
      reports: sql<number>`count(*)::int`,
    }).from(T).where(where);
    return { openCases: Number(row?.cases ?? 0), openReports: Number(row?.reports ?? 0) };
  } catch {
    return { openCases: 0, openReports: 0 };
  }
}

// ─── Case detail ─────────────────────────────────────────────────────────────

async function caseRows(reportId: string): Promise<ReportRow[] | null> {
  await ready();
  const [anchor] = await db.select({ messageId: T.messageId }).from(T).where(eq(T.id, normalizeId(reportId))).limit(1);
  if (!anchor) return null;
  const rows = await decryptRows(REPORT_FIELDS, await db.select().from(T).where(eq(T.messageId, anchor.messageId)));
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function getReportCase(reportId: string) {
  const rows = await caseRows(reportId);
  if (!rows || rows.length === 0) return null;
  const newest = rows[0];
  const primaryContent = readable(newest, newest.content);
  const reportedUserId = newest.reportedUserId;
  const reviewers = rows.map((r) => r.reviewedBy).filter((v): v is string => !!v);
  const actions = new Map<string, ReportActionEntry>();
  for (const r of rows) for (const a of actionList(r.actions)) actions.set(a.id, a);
  const actionLog = [...actions.values()].sort((a, b) => a.at.localeCompare(b.at));

  const { getStanding, isStaffAccount } = await import('@/lib/services/trustSafety');
  const [cards, servers, live, standing, targetIsStaff, target] = await Promise.all([
    cardsFor([...rows.map((r) => r.reporterId), reportedUserId, ...reviewers, ...actionLog.map((a) => a.by)]),
    serverNames([newest.serverId]),
    Message.findById(newest.messageId).catch(() => null),
    getStanding(reportedUserId).catch(() => null),
    isStaffAccount(reportedUserId).catch(() => false),
    User.findById(reportedUserId).catch(() => null),
  ]);
  const note = [...rows].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).find((r) => r.staffNote)?.staffNote ?? null;
  const reviewed = [...rows].filter((r) => r.reviewedAt).sort((a, b) => (b.reviewedAt?.getTime() ?? 0) - (a.reviewedAt?.getTime() ?? 0))[0];
  const categories = groupReportsByMessage(rows)[0]?.categories ?? [newest.category];
  const activeRestriction = standing?.restrictions.find((r) => r.active) ?? null;

  return {
    case: {
      id: newest.id,
      messageId: newest.messageId,
      channelId: newest.channelId,
      serverId: newest.serverId,
      serverName: newest.serverId ? servers.get(normalizeId(newest.serverId)) ?? null : null,
      channelType: newest.channelType,
      channelName: newest.channelName,
      messageSentAt: newest.messageSentAt?.toISOString() ?? null,
      status: groupStatus(rows),
      count: rows.length,
      openCount: rows.filter((r) => r.status === 'open').length,
      categories,
      urgent: categories.some(isUrgentReason),
      encrypted: rows.some((r) => r.encrypted),
      frankingVerified: rows.some((r) => r.encrypted && r.frankingVerified),
      blurMedia: shouldBlurReportMedia(categories),
      // Live state only (never the live content): deleted, or still there.
      messageDeleted: live ? Boolean(live.isDeleted) : null,
      staffNote: note,
      reviewer: reviewed?.reviewedBy ? cards.get(normalizeId(reviewed.reviewedBy)) ?? null : null,
      reviewedAt: reviewed?.reviewedAt?.toISOString() ?? null,
      actions: actionLog.map((a) => ({ ...a, staff: cards.get(normalizeId(a.by)) ?? null })),
      suggested: {
        strikeCategory: strikeCategoryForReport(categories[0] ?? 'other'),
        reason: defaultActionReason(categories[0] ?? 'other'),
        strikeExpiryDays: STRIKE_EXPIRY_DAYS,
      },
    },
    // The reported message as it was reported (never anything else from the conversation).
    message: {
      content: primaryContent,
      attachments: newest.encrypted ? [] : attachmentList(newest.attachments),
      attachmentNotes: stringList(newest.attachmentNotes),
    },
    reports: rows.map((r) => {
      const content = readable(r, r.content);
      return {
        id: r.id,
        reporterId: r.reporterId,
        reporter: cards.get(normalizeId(r.reporterId)) ?? null,
        category: r.category,
        details: r.details ? decodeHtmlEntities(r.details) : null,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        encrypted: r.encrypted,
        frankingVerified: r.frankingVerified,
        legacy: Boolean(r.legacyBugReportId),
        // An edited message: this reporter saw another version.
        otherVersion: content !== primaryContent ? content : null,
      };
    }),
    reportedUser: {
      id: reportedUserId,
      card: cards.get(normalizeId(reportedUserId)) ?? null,
      createdAt: target?.createdAt ? new Date(target.createdAt).toISOString() : null,
      isStaff: targetIsStaff,
      standing: standing
        ? {
          level: standing.level,
          banned: standing.banned,
          activeStrikes: standing.activeStrikes,
          maxStrikes: standing.maxStrikes ?? MAX_STRIKES,
          totalStrikes: standing.strikes.length,
          activeRestriction: activeRestriction ? { until: activeRestriction.until, reason: activeRestriction.reason } : null,
        }
        : null,
    },
  };
}

export type ReportCaseDetail = NonNullable<Awaited<ReturnType<typeof getReportCase>>>;

// ─── Staff actions ───────────────────────────────────────────────────────────

/** Soft-deletes the reported message through the normal channel / DM paths (live events included). */
async function deleteReportedMessage(messageId: string): Promise<'deleted' | 'already_deleted' | 'missing'> {
  const message = await Message.findById(messageId).catch(() => null);
  if (!message) return 'missing';
  if (message.isDeleted) return 'already_deleted';
  const channel = await Channel.findById(message.channelId).catch(() => null);
  if (!channel) return 'missing';
  if (isDmChannelType(channel.type)) {
    const { softDeleteDmMessage } = await import('@/lib/api/dms');
    await softDeleteDmMessage(channel, message, message.authorId);
  } else {
    const { softDeleteChannelMessage } = await import('@/lib/api/channels');
    await softDeleteChannelMessage(channel, message);
  }
  // Bots only hear about guild messages here: a guildId-less MESSAGE_DELETE
  // would reach bots that aren't in the DM (the DM delete paths emit none).
  if (channel.serverId) {
    const { emitMessageDelete } = await import('@/lib/services/gatewayEvents');
    void Promise.resolve(emitMessageDelete({ id: message.id, channelId: channel.id, guildId: channel.serverId })).catch(() => {});
  }
  return 'deleted';
}

const REPORTER_THANKS = [
  '**Thanks for your report**',
  '',
  'Our Trust & Safety team reviewed a message you reported and took action. To protect everyone involved, we don\'t share what action was taken.',
  '',
  'Thank you for helping keep SerikaCord safe.',
].join('\n');

export interface ReportActionInput {
  reportId: string;
  staffId: string;
  action: ReportAction;
  /** Already sanitized; required (≥ 3 chars) for strike / restrict / suspend. */
  reason?: string;
  strikeCategory?: string;
  /** 0 = never expires. */
  expiresInDays?: number;
  hours?: number;
  /** Also delete the message (strike / restrict / suspend). */
  deleteMessage?: boolean;
  notifyReporters?: boolean;
  /** The staff member holds safety.review (account actions). */
  canActOnAccount: boolean;
}

export type ReportActionResult =
  | { ok: true; status: ReportStatus; moved: number; messageDeleted: boolean | null; suspended: boolean; notified: number; activeStrikes?: number }
  | { ok: false; status: number; error: string };

/** Audit entry for an account action, written as soon as it succeeded. */
function auditAccountAction(staffId: string, targetId: string, action: ReportAction, messageId: string, reportIds: string[], detail: Record<string, unknown>, reason: string, suspended: boolean) {
  void AdminLog.create({
    adminId: staffId,
    action: suspended ? 'ban_user' : 'update_settings',
    targetType: 'user',
    targetId,
    details: { trustSafety: true, messageReport: true, reportAction: action, messageId, reportIds: reportIds.slice(0, 50), ...detail },
    reason,
  }).catch(() => {});
}

export async function actOnReportCase(input: ReportActionInput): Promise<ReportActionResult> {
  const rows = await caseRows(input.reportId);
  if (!rows || rows.length === 0) return { ok: false, status: 404, error: 'Report not found' };
  const newest = rows[0];
  const messageId = newest.messageId;
  const targetId = newest.reportedUserId;
  if (normalizeId(targetId) === normalizeId(input.staffId)) {
    return { ok: false, status: 403, error: 'Another staff member has to review reports about your own messages' };
  }
  const { action } = input;
  if (isAccountAction(action) && !input.canActOnAccount) {
    return { ok: false, status: 403, error: 'Trust & Safety permission required for account actions' };
  }
  const ts = await import('@/lib/services/trustSafety');
  // Reports about a staff account are decided by a super admin only.
  if (!(await ts.canActOnStaffTarget(input.staffId, targetId))) {
    return { ok: false, status: 403, error: 'Only a super admin can review reports about a staff account' };
  }
  const to = statusAfterAction(action);
  if (!isEnforcementAction(action) && reportsToTransition(rows, to).length === 0) {
    return { ok: false, status: 409, error: action === 'reopen' ? 'These reports are already open' : 'These reports are already closed' };
  }

  // Enforcement acts on the live message: it must still be the reported one.
  if (isEnforcementAction(action)) {
    const live = await Message.findById(messageId).catch(() => null);
    if (live && (normalizeId(live.channelId) !== normalizeId(newest.channelId) || normalizeId(live.authorId) !== normalizeId(targetId))) {
      return { ok: false, status: 409, error: "This report doesn't match the message" };
    }
    if (!live && action === 'delete_message') return { ok: false, status: 404, error: 'The message no longer exists' };
  }

  const reason = (input.reason ?? '').trim();
  const now = new Date();
  const staffId = normalizeId(input.staffId);
  const allIds = rows.map((r) => r.id);
  const detail: Record<string, string | number | boolean | null> = {};
  let suspended = false;
  let activeStrikes: number | undefined;
  let moved: string[] = [];

  if (isAccountAction(action)) {
    if (reason.length < 3) return { ok: false, status: 400, error: 'Give a reason' };
    const target = await User.findById(targetId).catch(() => null);
    if (!target) return { ok: false, status: 404, error: 'The reported account no longer exists' };
    if (action === 'suspend') {
      if (await ts.isStaffAccount(target.id)) return { ok: false, status: 400, error: 'Cannot suspend staff members' };
      if (target.isBanned) return { ok: false, status: 409, error: 'The account is already suspended' };
    }
    // Claim the open reports first: one account action per open case, so a
    // double click or two staff members can't strike twice.
    moved = (await db.update(T)
      .set({ status: 'resolved', reviewedBy: staffId, reviewedAt: now, updatedAt: now })
      .where(and(eq(T.messageId, messageId), eq(T.status, 'open')))
      .returning({ id: T.id })).map((r) => r.id);
    if (moved.length === 0) {
      return { ok: false, status: 409, error: 'These reports are already closed. Reopen them to take another account action.' };
    }
    try {
      if (action === 'suspend') {
        await ts.suspendAccount(target.id, reason);
        suspended = true;
      } else if (action === 'strike') {
        const days = input.expiresInDays === 0 ? null : Math.max(1, Math.min(3650, Math.round(input.expiresInDays ?? STRIKE_EXPIRY_DAYS)));
        const result = await ts.issueStrike({
          userId: target.id,
          category: normalizeStrikeCategory(input.strikeCategory ?? strikeCategoryForReport(newest.category)),
          reason,
          source: 'staff',
          issuedBy: staffId,
          expiresInDays: days,
        });
        suspended = result.suspended;
        activeStrikes = result.activeStrikes;
        detail.strike = result.strike.id;
        detail.activeStrikes = result.activeStrikes;
        if (!result.suspended) {
          const { sendSystemDM } = await import('@/lib/services/systemNotify');
          void sendSystemDM(target.id, `**⚠️ Your account received a strike**\n\n**Reason:** ${reason}\n\nYou can review this and appeal in **User Settings → Account Standing**.`, { kind: 'safety' }).catch(() => {});
        }
      } else {
        const hours = Math.max(1, Math.min(24 * 90, Math.round(input.hours ?? 24)));
        const row = await ts.addRestriction({ userId: target.id, type: 'chat', reason, hours, source: 'staff', issuedBy: staffId });
        detail.restriction = row.id;
        detail.hours = hours;
      }
    } catch (err) {
      console.error('[message-reports] Account action failed:', (err as Error)?.message ?? err);
      await db.update(T).set({ status: 'open', reviewedBy: null, reviewedAt: null, updatedAt: new Date() }).where(inArray(T.id, moved)).catch(() => {});
      return { ok: false, status: 500, error: 'Could not complete the action' };
    }
    if (suspended) detail.suspended = true;
    auditAccountAction(staffId, target.id, action, messageId, allIds, detail, reason, suspended);
  }

  let messageDeleted: boolean | null = null;
  if (action === 'delete_message' || (isAccountAction(action) && input.deleteMessage)) {
    try {
      const outcome = await deleteReportedMessage(messageId);
      if (action === 'delete_message' && outcome === 'missing') return { ok: false, status: 404, error: 'The message no longer exists' };
      messageDeleted = outcome !== 'missing';
      detail.messageDeleted = outcome;
    } catch (err) {
      console.error('[message-reports] Deleting the reported message failed:', (err as Error)?.message ?? err);
      if (action === 'delete_message') return { ok: false, status: 500, error: 'Could not delete the message' };
      // The account action stands; the case is still updated below.
      messageDeleted = false;
      detail.messageDeleted = 'failed';
    }
  }

  // Status: only reports that can make the transition move (conditional on
  // their current status, so concurrent decisions don't overwrite each other).
  if (!isAccountAction(action) && to) {
    const ids = reportsToTransition(rows, to).map((r) => r.id);
    if (ids.length > 0) {
      moved = (await db.update(T)
        .set(to === 'open'
          ? { status: 'open', reviewedBy: null, reviewedAt: null, updatedAt: now }
          : { status: to, reviewedBy: staffId, reviewedAt: now, updatedAt: now })
        .where(and(inArray(T.id, ids), to === 'open' ? ne(T.status, 'open') : eq(T.status, 'open')))
        .returning({ id: T.id })).map((r) => r.id);
    }
  }
  const entry: ReportActionEntry = { id: randomUUID(), type: action, by: staffId, at: now.toISOString(), ...(Object.keys(detail).length ? { detail } : {}) };
  await db.update(T).set({ actions: sql`${T.actions} || ${JSON.stringify([entry])}::jsonb`, updatedAt: now }).where(inArray(T.id, allIds));

  // "We took action" — the same neutral message whatever was done, never what.
  // Only reporters whose rows this update claimed get it (no double DMs).
  let notified = 0;
  if (input.notifyReporters && isEnforcementAction(action)) {
    const claimed = await db.update(T).set({ reporterNotifiedAt: now })
      .where(and(eq(T.messageId, messageId), isNull(T.reporterNotifiedAt)))
      .returning({ reporterId: T.reporterId });
    const reporters = [...new Set(claimed.map((r) => normalizeId(r.reporterId)))]
      .filter((id) => id !== normalizeId(targetId))
      .slice(0, 50);
    if (reporters.length) {
      const { sendSystemDM } = await import('@/lib/services/systemNotify');
      for (const reporterId of reporters) {
        void sendSystemDM(reporterId, REPORTER_THANKS, { kind: 'safety' }).catch(() => {});
        notified++;
      }
    }
  }

  const statuses = await db.select({ status: T.status }).from(T).where(eq(T.messageId, messageId));
  return { ok: true, status: groupStatus(statuses), moved: moved.length, messageDeleted, suspended, notified, activeStrikes };
}

/** Sets the internal staff note on every report of the case (encrypted at rest). */
export async function setReportCaseNote(reportId: string, staffId: string, note: string | null): Promise<{ messageId: string } | null> {
  const rows = await caseRows(reportId);
  if (!rows || rows.length === 0) return null;
  const now = new Date();
  const entry: ReportActionEntry = { id: randomUUID(), type: 'note', by: normalizeId(staffId), at: now.toISOString() };
  await db.update(T).set({
    staffNote: await encryptField(note ? note.slice(0, REPORT_NOTE_MAX) : null),
    actions: sql`${T.actions} || ${JSON.stringify([entry])}::jsonb`,
    updatedAt: now,
  }).where(inArray(T.id, rows.map((r) => r.id)));
  return { messageId: rows[0].messageId };
}

/** Message + reported account of a case (for audit entries). */
export async function reportCaseTarget(reportId: string): Promise<{ messageId: string; reportedUserId: string; reportIds: string[] } | null> {
  await ready();
  const [anchor] = await db.select({ messageId: T.messageId, reportedUserId: T.reportedUserId }).from(T).where(eq(T.id, normalizeId(reportId))).limit(1);
  if (!anchor) return null;
  const ids = await db.select({ id: T.id }).from(T).where(eq(T.messageId, anchor.messageId));
  return { ...anchor, reportIds: ids.map((r) => r.id) };
}
