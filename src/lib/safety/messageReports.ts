// Message reports (Trust & Safety review queue) as pure rules: filters,
// grouping duplicate reports of one message, status transitions, the strike
// category / default reason a report suggests, and the parser for reports
// filed before the queue existed (stored as bug reports). Storage + actions:
// src/lib/services/messageReports.ts. Routes: src/lib/api/messageReports.ts.
// Tests: tests/message-reports.test.ts.
import { MESSAGE_REPORT_REASONS, isMessageReportReason, type MessageReportReason } from '@/lib/chat/messageReport';
import type { StrikeCategory } from './standing';

export const REPORT_STATUSES = ['open', 'resolved', 'dismissed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_SCOPES = ['all', 'server', 'dm'] as const;
export type ReportScope = (typeof REPORT_SCOPES)[number];

export const REPORT_ENCRYPTED_FILTERS = ['any', 'yes', 'no'] as const;
export type ReportEncryptedFilter = (typeof REPORT_ENCRYPTED_FILTERS)[number];

export const REPORT_SORTS = ['newest', 'oldest'] as const;
export type ReportSort = (typeof REPORT_SORTS)[number];

export const REPORT_PAGE_SIZE = 25;
export const REPORT_DETAILS_MAX = 1000;
export const REPORT_CONTENT_MAX = 4000;
export const REPORT_NOTE_MAX = 2000;

/** Actions staff take on a reported message (all reports of that message). */
export const REPORT_ACTIONS = ['dismiss', 'resolve', 'reopen', 'delete_message', 'strike', 'restrict', 'suspend'] as const;
export type ReportAction = (typeof REPORT_ACTIONS)[number];

export interface ReportFilters {
  status: ReportStatus | 'all';
  category: MessageReportReason | 'all';
  scope: ReportScope;
  encrypted: ReportEncryptedFilter;
  sort: ReportSort;
  /** Username prefix or user id, matched against the reporter and the reported user. */
  q: string;
  page: number;
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function isReportStatus(value: unknown): value is ReportStatus {
  return typeof value === 'string' && (REPORT_STATUSES as readonly string[]).includes(value);
}

export function isReportAction(value: unknown): value is ReportAction {
  return typeof value === 'string' && (REPORT_ACTIONS as readonly string[]).includes(value);
}

/** Query string → filters; anything unknown falls back to the default view (open, newest). */
export function normalizeReportFilters(raw: Record<string, unknown>): ReportFilters {
  const page = Math.floor(Number(raw.page));
  return {
    status: pick(raw.status, [...REPORT_STATUSES, 'all'] as const, 'open'),
    category: pick(raw.category, [...MESSAGE_REPORT_REASONS, 'all'] as const, 'all'),
    scope: pick(raw.scope, REPORT_SCOPES, 'all'),
    encrypted: pick(raw.encrypted, REPORT_ENCRYPTED_FILTERS, 'any'),
    sort: pick(raw.sort, REPORT_SORTS, 'newest'),
    q: typeof raw.q === 'string' ? raw.q.trim().slice(0, 100) : '',
    page: Number.isFinite(page) && page >= 1 ? Math.min(page, 10_000) : 1,
  };
}

/**
 * Decisions are changed by reopening first: an open report can be resolved or
 * dismissed, a closed one can only be reopened.
 */
export function canTransitionReport(from: string, to: ReportStatus): boolean {
  if (from === to) return false;
  if (from === 'open') return to === 'resolved' || to === 'dismissed';
  return isReportStatus(from) && to === 'open';
}

/** Status an action moves the message's reports to (null: status unchanged). */
export function statusAfterAction(action: ReportAction): ReportStatus | null {
  switch (action) {
    case 'dismiss': return 'dismissed';
    case 'reopen': return 'open';
    case 'resolve':
    case 'delete_message':
    case 'strike':
    case 'restrict':
    case 'suspend':
      return 'resolved';
    default: return null;
  }
}

/** Actions that enforce something on the reported account or message. */
export function isEnforcementAction(action: ReportAction): boolean {
  return action === 'delete_message' || action === 'strike' || action === 'restrict' || action === 'suspend';
}

/** Account actions that need the Trust & Safety permission on top of report review. */
export function isAccountAction(action: ReportAction): boolean {
  return action === 'strike' || action === 'restrict' || action === 'suspend';
}

/** Which of `rows` an action moves (the others keep their status). */
export function reportsToTransition<T extends { id: string; status: string }>(rows: readonly T[], to: ReportStatus | null): T[] {
  if (!to) return [];
  return rows.filter((r) => canTransitionReport(r.status, to));
}

export function strikeCategoryForReport(reason: string): StrikeCategory {
  switch (reason) {
    case 'spam': return 'spam';
    case 'harassment': return 'harassment';
    case 'hate': return 'hate';
    case 'nsfw': return 'nsfw';
    case 'impersonation': return 'impersonation';
    default: return 'other';
  }
}

/**
 * Prefilled reason for a strike / restriction / suspension from a report. The
 * user sees it in Account Standing, so it names the rule, never the reporter
 * or their details. Stored data (English, like the system DMs).
 */
export function defaultActionReason(reason: string): string {
  switch (reason) {
    case 'spam': return 'Spam or scam content in a message';
    case 'harassment': return 'Harassment or bullying in a message';
    case 'hate': return 'Hateful conduct in a message';
    case 'nsfw': return 'Sexual or graphic content in a message';
    case 'self_harm': return 'Content promoting self-harm or suicide in a message';
    case 'illegal': return 'Illegal activity in a message';
    case 'impersonation': return 'Impersonation in a message';
    default: return 'A message that breaks the SerikaCord rules';
  }
}

/** Self-harm and illegal activity are surfaced first-class in the queue. */
export function isUrgentReason(reason: string): boolean {
  return reason === 'self_harm' || reason === 'illegal';
}

/** Images of these reports are blurred until staff click to reveal. */
export function shouldBlurReportMedia(reasons: readonly string[]): boolean {
  return reasons.some((r) => r === 'nsfw' || r === 'self_harm');
}

export function isDmChannelType(type: string | null | undefined): boolean {
  return type === 'dm' || type === 'group_dm';
}

/** One-line excerpt for the queue (whitespace collapsed). */
export function reportExcerpt(text: string | null | undefined, max = 140): string {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

// ─── Grouping ────────────────────────────────────────────────────────────────

export interface ReportRowLike {
  id: string;
  messageId: string;
  status: string;
  category: string;
  reporterId: string;
  createdAt: Date | string | null;
}

export interface ReportGroup<T extends ReportRowLike> {
  messageId: string;
  /** Newest first. */
  reports: T[];
  count: number;
  openCount: number;
  /** Distinct categories, most reported first. */
  categories: string[];
  reporterCount: number;
  latestAt: number;
  earliestAt: number;
  status: ReportStatus;
}

function ts(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const n = new Date(value).getTime();
  return Number.isFinite(n) ? n : 0;
}

/**
 * A message is open while any of its reports is, resolved once any report was
 * resolved, else dismissed. Mirrors the HAVING clauses of the queue query
 * (src/lib/services/messageReports.ts) so a status filter and the badge agree.
 */
export function groupStatus(rows: readonly Pick<ReportRowLike, 'status'>[]): ReportStatus {
  if (rows.length === 0 || rows.some((r) => r.status === 'open')) return 'open';
  if (rows.some((r) => r.status === 'resolved')) return 'resolved';
  return 'dismissed';
}

/** Duplicate reports of one message become one queue entry, ordered by `sort`. */
export function groupReportsByMessage<T extends ReportRowLike>(rows: readonly T[], sort: ReportSort = 'newest'): ReportGroup<T>[] {
  const byMessage = new Map<string, T[]>();
  for (const row of rows) {
    const key = row.messageId.toLowerCase();
    const list = byMessage.get(key);
    if (list) list.push(row);
    else byMessage.set(key, [row]);
  }
  const groups: ReportGroup<T>[] = [];
  for (const list of byMessage.values()) {
    const reports = [...list].sort((a, b) => ts(b.createdAt) - ts(a.createdAt));
    const tally = new Map<string, number>();
    for (const r of reports) tally.set(r.category, (tally.get(r.category) ?? 0) + 1);
    const categories = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c]) => c);
    groups.push({
      messageId: reports[0].messageId,
      reports,
      count: reports.length,
      openCount: reports.filter((r) => r.status === 'open').length,
      categories,
      reporterCount: new Set(reports.map((r) => r.reporterId.toLowerCase())).size,
      latestAt: ts(reports[0].createdAt),
      earliestAt: ts(reports[reports.length - 1].createdAt),
      status: groupStatus(reports),
    });
  }
  groups.sort((a, b) => (sort === 'oldest' ? a.earliestAt - b.earliestAt : b.latestAt - a.latestAt));
  return groups;
}

// ─── Reports filed before the queue (bug_reports, category "security") ──────

export interface LegacyMessageReport {
  reason: MessageReportReason;
  details: string | null;
  messageId: string;
  channelId: string;
  channelName: string | null;
  channelType: string | null;
  serverId: string | null;
  authorId: string;
  sentAt: string | null;
  encrypted: boolean;
  attachmentNotes: string[];
  content: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parses the description the old report route wrote, strictly by position:
 * Reason, optional Details, Message, Channel, optional Server, Author, Sent,
 * optional franking lines, a blank line, "Content:", then the content.
 * Returns null for anything else, including reports whose (unsanitized,
 * reporter-written) details spanned several lines, and any description whose
 * content repeats the header block (a details field forging the fields that
 * follow it). Callers still validate the result against the database.
 */
export function parseLegacyMessageReport(title: string, description: string): LegacyMessageReport | null {
  if (!title.startsWith('Message report:')) return null;
  const lines = description.split('\n');
  let i = 0;
  const take = (name: string): string | null => {
    const line = lines[i];
    if (typeof line !== 'string' || !line.startsWith(`${name}: `)) return null;
    i++;
    return line.slice(name.length + 2);
  };
  const reasonRaw = take('Reason');
  if (reasonRaw === null) return null;
  const details = take('Details');
  const messageId = take('Message');
  const channelLine = take('Channel');
  const serverId = take('Server');
  const authorLine = take('Author');
  const sent = take('Sent');
  if (!messageId || !UUID.test(messageId) || !channelLine || !authorLine || sent === null) return null;
  const channelMatch = /^([0-9a-f-]{36})(?: \(#(.*)\))? \[([a-z_]+)\]$/i.exec(channelLine);
  const authorId = authorLine.split(' ')[0];
  if (!channelMatch || !UUID.test(channelMatch[1]) || !UUID.test(authorId)) return null;
  if (serverId !== null && !UUID.test(serverId)) return null;
  let encrypted = false;
  if (lines[i]?.startsWith('End-to-end encrypted message:')) {
    encrypted = true;
    i++;
  }
  const attachmentNotes: string[] = [];
  while (lines[i]?.startsWith('Encrypted attachment: ')) attachmentNotes.push(lines[i++].slice('Encrypted attachment: '.length));
  if (lines[i] !== '' || lines[i + 1] !== 'Content:') return null;
  const tail = lines.slice(i + 2);
  // A second header block after "Content:" means the first one was forged.
  if (tail.some((l) => /^Message: [0-9a-f-]{36}$/i.test(l)) && tail.includes('Content:')) return null;
  const content = tail.join('\n');
  return {
    reason: isMessageReportReason(reasonRaw) ? reasonRaw : 'other',
    details,
    messageId,
    channelId: channelMatch[1],
    channelName: channelMatch[2] ?? null,
    channelType: channelMatch[3] ?? null,
    serverId,
    authorId,
    sentAt: sent !== 'unknown' && Number.isFinite(new Date(sent).getTime()) ? sent : null,
    encrypted,
    attachmentNotes,
    content: content === '(no text)' ? '' : content,
  };
}

/**
 * Bug-report rows written by the old message report route: kind "bug",
 * category "security", a "Message report:" title and priority medium / high
 * (ordinary bug reports were always filed as low, so a user-written bug
 * report with that title is not one).
 */
export function isLegacyMessageReportRow(row: { kind?: string | null; category?: string | null; title?: string | null; priority?: string | null }): boolean {
  return row.kind === 'bug' && row.category === 'security' && typeof row.title === 'string' && row.title.startsWith('Message report:')
    && (row.priority === 'medium' || row.priority === 'high');
}

/** Old bug-report status → queue status. */
export function legacyReportStatus(status: string | null | undefined): ReportStatus {
  if (status === 'resolved') return 'resolved';
  if (status === 'wont_fix') return 'dismissed';
  return 'open';
}
