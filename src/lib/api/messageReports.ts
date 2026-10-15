// Staff message report queue, mounted under /api by trustSafetyRoutes.
//
// Staff (reports.review; strike / restrict / suspend also need safety.review):
//   GET    /admin/trust-safety/message-reports          ?status=open|resolved|dismissed|all &category= &scope=all|server|dm
//                                                       &encrypted=any|yes|no &sort=newest|oldest &q= &page=
//   GET    /admin/trust-safety/message-reports/stats    open cases / reports
//   GET    /admin/trust-safety/message-reports/:id      the case (every report of that message)
//   PATCH  /admin/trust-safety/message-reports/:id      { status?: open|resolved|dismissed, note?: string|null }
//   POST   /admin/trust-safety/message-reports/:id/actions
//          { action: dismiss|resolve|reopen|delete_message|strike|restrict|suspend,
//            reason?, category?, expiresInDays?, hours?, deleteMessage?, notifyReporters? }
//
// Reports are filed by POST /api/channels/:id/messages/:mid/report (channels.ts).
// The reporter's identity is only ever returned to staff; the reporter
// notification is a neutral system DM that never says what was done.
import { Elysia, t } from 'elysia';
import { getStaffAuth } from '@/lib/services/staffAuth';
import { hasStaffPermission } from '@/lib/staff/permissions';
import { isValidObjectId, sanitizeInput } from '@/lib/security';
import { AdminLog } from '@/lib/models';
import {
  REPORT_NOTE_MAX,
  isAccountAction,
  isReportAction,
  isReportStatus,
  normalizeReportFilters,
  type ReportAction,
} from '@/lib/safety/messageReports';
import {
  actOnReportCase,
  getReportCase,
  listReportCases,
  messageReportStats,
  reportCaseTarget,
  setReportCaseNote,
  type ReportActionResult,
} from '@/lib/services/messageReports';

type Cookie = Record<string, { value?: unknown }>;

async function reviewer(headers: Record<string, string | undefined>, cookie: Cookie) {
  return getStaffAuth(headers, cookie, 'reports.review');
}

function audit(
  adminId: string,
  action: 'resolve_report' | 'dismiss_report' | 'delete_message' | 'ban_user' | 'update_settings',
  targetType: 'message' | 'user',
  targetId: string,
  details: Record<string, unknown>,
  reason?: string | null,
) {
  void AdminLog.create({ adminId, action, targetType, targetId, details: { messageReport: true, ...details }, reason: reason ?? undefined }).catch(() => {});
}

/**
 * Audit entries for one staff action on a case (the message side). Account
 * actions are audited by the service right after they succeed.
 */
function auditAction(adminId: string, action: ReportAction, target: { messageId: string; reportedUserId: string; reportIds: string[] }, result: Extract<ReportActionResult, { ok: true }>, reason: string | null) {
  const base = { reportIds: target.reportIds.slice(0, 50), reportAction: action, moved: result.moved };
  const messageAction = action === 'dismiss' ? 'dismiss_report' : action === 'delete_message' ? 'delete_message' : 'resolve_report';
  audit(adminId, messageAction, 'message', target.messageId, { ...base, reportedUserId: target.reportedUserId, messageDeleted: result.messageDeleted, notifiedReporters: result.notified }, reason);
  if (result.messageDeleted && action !== 'delete_message') {
    audit(adminId, 'delete_message', 'message', target.messageId, { ...base, reportedUserId: target.reportedUserId });
  }
}

const sameUser = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Staff never see or touch reports about their own messages (super admins may view them). */
function hiddenFrom(auth: { user: { id: string }; access?: { isSuperAdmin: boolean } | null }): string | null {
  return auth.access?.isSuperAdmin ? null : auth.user.id;
}

export const messageReportRoutes = new Elysia({ prefix: '/admin/trust-safety/message-reports' })
  // `:id` is a report id: malformed ids get a 400, not a DB error.
  .onBeforeHandle(({ params, set }) => {
    const id = (params as Record<string, string | undefined> | undefined)?.id;
    if (typeof id === 'string' && !isValidObjectId(id)) {
      set.status = 400;
      return { error: 'Invalid ID' };
    }
  })
  .get('/', async ({ headers, cookie, query, set }) => {
    const auth = await reviewer(headers, cookie as Cookie);
    if (!auth.user) { set.status = auth.status; return { error: auth.error }; }
    try {
      return await listReportCases(normalizeReportFilters(query as Record<string, unknown>), hiddenFrom(auth));
    } catch (err) {
      console.error('[message-reports] list failed:', (err as Error)?.message ?? err);
      set.status = 503;
      return { error: 'Message reports are unavailable right now' };
    }
  }, {
    query: t.Object({
      status: t.Optional(t.String({ maxLength: 20 })),
      category: t.Optional(t.String({ maxLength: 32 })),
      scope: t.Optional(t.String({ maxLength: 20 })),
      encrypted: t.Optional(t.String({ maxLength: 10 })),
      sort: t.Optional(t.String({ maxLength: 10 })),
      q: t.Optional(t.String({ maxLength: 100 })),
      page: t.Optional(t.String({ maxLength: 6 })),
    }),
  })
  .get('/stats', async ({ headers, cookie, set }) => {
    const auth = await reviewer(headers, cookie as Cookie);
    if (!auth.user) { set.status = auth.status; return { error: auth.error }; }
    return { stats: await messageReportStats(hiddenFrom(auth)) };
  })
  .get('/:id', async ({ headers, cookie, params, set }) => {
    const auth = await reviewer(headers, cookie as Cookie);
    if (!auth.user) { set.status = auth.status; return { error: auth.error }; }
    const target = await reportCaseTarget(params.id).catch(() => null);
    if (!target) { set.status = 404; return { error: 'Report not found' }; }
    const hidden = hiddenFrom(auth);
    if (hidden && sameUser(target.reportedUserId, hidden)) {
      set.status = 403;
      return { error: 'Another staff member has to review reports about your own messages' };
    }
    const detail = await getReportCase(params.id).catch((err) => {
      console.error('[message-reports] detail failed:', (err as Error)?.message ?? err);
      return null;
    });
    if (!detail) { set.status = 404; return { error: 'Report not found' }; }
    // Opening an encrypted case reveals disclosed plaintext: audited.
    if (detail.case.encrypted) {
      audit(auth.user.id, 'update_settings', 'message', target.messageId, { reportIds: target.reportIds.slice(0, 50), viewedEncryptedReport: true });
    }
    return {
      ...detail,
      permissions: {
        canActOnAccount: hasStaffPermission(auth.access ?? null, 'safety.review'),
        ownMessage: detail.reportedUser.id.toLowerCase() === auth.user.id.toLowerCase(),
      },
    };
  }, { params: t.Object({ id: t.String() }) })
  .patch('/:id', async ({ headers, cookie, params, body, set }) => {
    const auth = await reviewer(headers, cookie as Cookie);
    if (!auth.user) { set.status = auth.status; return { error: auth.error }; }
    if (body.status !== undefined && !isReportStatus(body.status)) { set.status = 400; return { error: 'Invalid status' }; }
    const target = await reportCaseTarget(params.id).catch(() => null);
    if (!target) { set.status = 404; return { error: 'Report not found' }; }
    // Checked before any write (the note included).
    if (sameUser(target.reportedUserId, auth.user.id)) {
      set.status = 403;
      return { error: 'Another staff member has to review reports about your own messages' };
    }
    const { canActOnStaffTarget } = await import('@/lib/services/trustSafety');
    if (!(await canActOnStaffTarget(auth.user.id, target.reportedUserId))) {
      set.status = 403;
      return { error: 'Only a super admin can review reports about a staff account' };
    }
    if (body.note !== undefined) {
      const note = body.note ? sanitizeInput(body.note).slice(0, REPORT_NOTE_MAX) : null;
      await setReportCaseNote(params.id, auth.user.id, note || null);
      audit(auth.user.id, 'update_settings', 'message', target.messageId, { reportIds: target.reportIds.slice(0, 50), noteUpdated: true });
    }
    if (body.status !== undefined) {
      const action: ReportAction = body.status === 'open' ? 'reopen' : body.status === 'dismissed' ? 'dismiss' : 'resolve';
      const result = await actOnReportCase({ reportId: params.id, staffId: auth.user.id, action, canActOnAccount: false });
      if (!result.ok) { set.status = result.status; return { error: result.error }; }
      auditAction(auth.user.id, action, target, result, null);
      return { success: true, status: result.status };
    }
    return { success: true };
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      status: t.Optional(t.String({ maxLength: 20 })),
      note: t.Optional(t.Union([t.String({ maxLength: REPORT_NOTE_MAX }), t.Null()])),
    }),
  })
  .post('/:id/actions', async ({ headers, cookie, params, body, set }) => {
    const auth = await reviewer(headers, cookie as Cookie);
    if (!auth.user) { set.status = auth.status; return { error: auth.error }; }
    if (!isReportAction(body.action)) { set.status = 400; return { error: 'Invalid action' }; }
    const action = body.action;
    const canActOnAccount = hasStaffPermission(auth.access ?? null, 'safety.review');
    if (isAccountAction(action) && !canActOnAccount) { set.status = 403; return { error: 'Trust & Safety permission required for account actions' }; }
    const target = await reportCaseTarget(params.id).catch(() => null);
    if (!target) { set.status = 404; return { error: 'Report not found' }; }
    const reason = body.reason !== undefined ? sanitizeInput(body.reason).trim().slice(0, 500) : '';
    const result = await actOnReportCase({
      reportId: params.id,
      staffId: auth.user.id,
      action,
      reason,
      strikeCategory: body.category,
      expiresInDays: body.expiresInDays,
      hours: body.hours,
      deleteMessage: body.deleteMessage === true,
      notifyReporters: body.notifyReporters === true,
      canActOnAccount,
    });
    if (!result.ok) { set.status = result.status; return { error: result.error }; }
    auditAction(auth.user.id, action, target, result, reason || null);
    return { success: true, ...result };
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      action: t.String({ maxLength: 20 }),
      reason: t.Optional(t.String({ maxLength: 500 })),
      category: t.Optional(t.String({ maxLength: 30 })),
      expiresInDays: t.Optional(t.Number({ minimum: 0, maximum: 3650 })),
      hours: t.Optional(t.Number({ minimum: 1, maximum: 24 * 90 })),
      deleteMessage: t.Optional(t.Boolean()),
      notifyReporters: t.Optional(t.Boolean()),
    }),
  });
