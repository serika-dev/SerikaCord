// Trust & Safety routes, mounted at /api.
//
// Account Standing (the signed-in user; works while suspended):
//   GET    /users/@me/standing                         level, strikes, restrictions, appeals
//   POST   /users/@me/standing/appeals                 { targetType: strike|restriction|ban, targetId?, message }
//
// Staff (safety.review):
//   GET    /admin/trust-safety/overview                counters for the dashboard
//   GET    /admin/trust-safety/incidents               ?status=&kind=&userId=
//   PATCH  /admin/trust-safety/incidents/:id           { status?, notes?, ncmecReportId? }
//   GET    /admin/trust-safety/appeals                 ?status=
//   POST   /admin/trust-safety/appeals/:id/decision    { approve, note? }
//   GET    /admin/trust-safety/users/:userId           standing + incidents of one account
//   GET    /admin/trust-safety/users                   ?q= search accounts
//   POST   /admin/trust-safety/users/:userId/strikes   { category, reason, expiresInDays? }
//   POST   /admin/trust-safety/strikes/:id/revoke      { reason? }
//   POST   /admin/trust-safety/users/:userId/restrictions { hours, reason }
//   POST   /admin/trust-safety/restrictions/:id/lift
//   POST   /admin/trust-safety/users/:userId/suspend   { reason }
//   POST   /admin/trust-safety/users/:userId/unsuspend
//   GET    /admin/trust-safety/hashes                  scam image hash list
//   POST   /admin/trust-safety/hashes                  { hash, label, maxDistance? }
//   POST   /admin/trust-safety/hashes/from-image       multipart { file, label, maxDistance? }
//   PATCH  /admin/trust-safety/hashes/:id              { label?, maxDistance? }
//   DELETE /admin/trust-safety/hashes/:id
//   POST   /admin/trust-safety/scan-test               multipart { file }: dry-run both scanners, records nothing
import { Elysia, t } from 'elysia';
import { authenticateRequest } from '@/lib/services/auth';
import { getStaffAuth } from '@/lib/services/staffAuth';
import { checkRateLimit, isValidObjectId, rejectInvalidObjectIdParams, sanitizeInput } from '@/lib/security';
import { AdminLog, User } from '@/lib/models';
import { StaffRole } from '@/lib/models/StaffRole';
import { normalizeId } from '@/lib/db/normalizeId';
import {
  addRestriction,
  addScamHash,
  computeImageHash,
  createAppeal,
  decideAppeal,
  deleteScamHash,
  getStanding,
  isStaffAccount,
  liftRestriction,
  listAppeals,
  listIncidents,
  listScamHashes,
  issueStrike,
  recordOwner,
  revokeStrike,
  searchUsersForStaff,
  getAppeal,
  AppealDecisionError,
  suspendAccount,
  trustSafetyStats,
  updateIncident,
  updateScamHash,
  userCards,
} from '@/lib/services/trustSafety';
import { photoDnaConfigured, photoDnaMatch } from '@/lib/services/photoDnaClient';
import { normalizeAppealMessage, normalizeStrikeCategory, STRIKE_EXPIRY_DAYS } from '@/lib/safety/standing';
import { findClosestHash, normalizeHash, sniffImageType, DEFAULT_MATCH_DISTANCE } from '@/lib/safety/imageHash';

type Cookie = Record<string, { value?: unknown }>;

async function standingAuth(headers: Record<string, string | undefined>, cookie: Cookie) {
  const token = cookie.auth_token?.value;
  return authenticateRequest(headers.authorization ?? null, typeof token === 'string' ? { auth_token: token } : {}, { allowBanned: true });
}

async function staff(headers: Record<string, string | undefined>, cookie: Cookie) {
  return getStaffAuth(headers, cookie, 'safety.review');
}

/** Only a super admin may put strikes / restrictions on another staff account. */
async function canActOnStaffTarget(actorId: string, targetId: string): Promise<boolean> {
  if (!(await isStaffAccount(targetId))) return true;
  const actor = await User.findById(actorId).catch(() => null);
  if (!actor) return false;
  const { getUserStaffAccess } = await import('@/lib/services/staffAuth');
  return Boolean((await getUserStaffAccess(actor).catch(() => null))?.isSuperAdmin);
}

const same = (a: string | null | undefined, b: string | null | undefined) => Boolean(a && b && normalizeId(a) === normalizeId(b));

function logSafetyAction(adminId: string, action: 'ban_user' | 'unban_user' | 'update_settings', targetId: string, details: Record<string, unknown>, reason?: string | null) {
  void AdminLog.create({ adminId, action, targetType: 'user', targetId, details: { trustSafety: true, ...details }, reason: reason ?? undefined }).catch(() => {});
}

const INCIDENT_STATUSES = new Set(['open', 'actioned', 'reviewed', 'dismissed', 'test', 'reported']);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

async function fileBuffer(file: File): Promise<Buffer | null> {
  if (!file || file.size > MAX_IMAGE_BYTES) return null;
  const buf = Buffer.from(await file.arrayBuffer());
  return sniffImageType(buf) ? buf : null;
}

export const trustSafetyRoutes = new Elysia()
  .onBeforeHandle(rejectInvalidObjectIdParams)
  // `:id` isn't in the global id-param guard: bad ids get a 400, not a DB error.
  .onBeforeHandle(({ params, query, body, set }) => {
    const p = (params ?? {}) as Record<string, string | undefined>;
    const q = (query ?? {}) as Record<string, string | undefined>;
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const ids = [p.id, q.userId, typeof b.targetId === 'string' ? b.targetId : undefined].filter((v): v is string => typeof v === 'string' && v.length > 0);
    if (ids.some((v) => !isValidObjectId(v))) {
      set.status = 400;
      return { error: 'Invalid ID' };
    }
  })
  // ─── Account Standing ──────────────────────────────────────────────────────
  .get('/users/@me/standing', async ({ headers, cookie, set }) => {
    const { user, error } = await standingAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const standing = await getStanding(user.id);
    return {
      user: { id: user.id, username: user.username, displayName: user.displayName ?? null, avatar: user.avatar ?? null },
      ...standing,
    };
  })
  .post('/users/@me/standing/appeals', async ({ headers, cookie, body, set }) => {
    const { user, error } = await standingAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const limit = await checkRateLimit('appeal', user.id);
    if (!limit.success) { set.status = 429; return { error: 'You are sending appeals too quickly', retryAfter: limit.retryAfter }; }
    const message = normalizeAppealMessage(body.message);
    if (!message) { set.status = 400; return { error: 'Tell us a bit more (at least 10 characters)' }; }
    const result = await createAppeal(user.id, body.targetType, body.targetId ?? null, sanitizeInput(message));
    if ('error' in result) { set.status = result.status; return { error: result.error }; }
    return { appeal: { id: result.appeal.id, status: result.appeal.status, targetType: result.appeal.targetType, targetId: result.appeal.targetId } };
  }, {
    body: t.Object({
      targetType: t.Union([t.Literal('strike'), t.Literal('restriction'), t.Literal('ban')]),
      targetId: t.Optional(t.String({ maxLength: 64 })),
      message: t.String({ maxLength: 4000 }),
    }),
  })
  // ─── Staff: overview + incidents ───────────────────────────────────────────
  .get('/admin/trust-safety/overview', async ({ headers, cookie, set }) => {
    const auth = await staff(headers, cookie as Cookie);
    if (!auth.user) { set.status = auth.status; return { error: auth.error }; }
    return { stats: await trustSafetyStats() };
  })
  .get('/admin/trust-safety/incidents', async ({ headers, cookie, query, set }) => {
    const auth = await staff(headers, cookie as Cookie);
    if (!auth.user) { set.status = auth.status; return { error: auth.error }; }
    const incidents = await listIncidents({ status: query.status, kind: query.kind, userId: query.userId, limit: 150 });
    const users = await userCards(incidents.flatMap((i) => [i.userId, i.reviewedBy ?? '']));
    return {
      incidents: incidents.map((i) => ({
        ...i,
        user: users.get(normalizeId(i.userId)) ?? null,
        reviewer: i.reviewedBy ? users.get(normalizeId(i.reviewedBy)) ?? null : null,
      })),
    };
  }, { query: t.Object({ status: t.Optional(t.String()), kind: t.Optional(t.String()), userId: t.Optional(t.String()) }) })
  .patch('/admin/trust-safety/incidents/:id', async ({ headers, cookie, params, body, set }) => {
    const auth = await staff(headers, cookie as Cookie);
    if (!auth.user) { set.status = auth.status; return { error: auth.error }; }
    if (body.status && !INCIDENT_STATUSES.has(body.status)) { set.status = 400; return { error: 'Invalid status' }; }
    const row = await updateIncident(params.id, auth.user.id, {
      status: body.status,
      notes: body.notes !== undefined ? (body.notes ? sanitizeInput(body.notes) : null) : undefined,
      ncmecReportId: body.ncmecReportId !== undefined ? (body.ncmecReportId ? sanitizeInput(body.ncmecReportId) : null) : undefined,
    });
    if (!row) { set.status = 404; return { error: 'Incident not found' }; }
    return { incident: row };
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      status: t.Optional(t.String({ maxLength: 20 })),
      notes: t.Optional(t.Union([t.String({ maxLength: 2000 }), t.Null()])),
      ncmecReportId: t.Optional(t.Union([t.String({ maxLength: 100 }), t.Null()])),
    }),
  })
  // ─── Staff: appeals ────────────────────────────────────────────────────────
  .get('/admin/trust-safety/appeals', async ({ headers, cookie, query, set }) => {
    const auth = await staff(headers, cookie as Cookie);
    if (!auth.user) { set.status = auth.status; return { error: auth.error }; }
    const appeals = await listAppeals(query.status || 'open');
    const users = await userCards(appeals.flatMap((a) => [a.userId, a.reviewedBy ?? '']));
    // What each appeal is about, so staff decide without opening the account.
    const standingByUser = new Map<string, Awaited<ReturnType<typeof getStanding>>>();
    for (const uid of [...new Set(appeals.map((a) => a.userId))].slice(0, 50)) {
      standingByUser.set(uid, await getStanding(uid).catch(() => null as never));
    }
    return {
      appeals: appeals.map((a) => {
        const standing = standingByUser.get(a.userId);
        const target = a.targetType === 'strike'
          ? standing?.strikes.find((s) => s.id === a.targetId) ?? null
          : a.targetType === 'restriction'
            ? standing?.restrictions.find((r) => r.id === a.targetId) ?? null
            : standing ? { banReason: standing.banReason } : null;
        return {
          ...a,
          user: users.get(normalizeId(a.userId)) ?? null,
          reviewer: a.reviewedBy ? users.get(normalizeId(a.reviewedBy)) ?? null : null,
          target,
          activeStrikes: standing?.activeStrikes ?? null,
        };
      }),
    };
  }, { query: t.Object({ status: t.Optional(t.String()) }) })
  .post('/admin/trust-safety/appeals/:id/decision', async ({ headers, cookie, params, body, set }) => {
    const auth = await staff(headers, cookie as Cookie);
    if (!auth.user) { set.status = auth.status; return { error: auth.error }; }
    const existing = await getAppeal(params.id);
    if (existing && same(existing.userId, auth.user.id)) { set.status = 403; return { error: 'You cannot decide your own appeal' }; }
    let row;
    try {
      row = await decideAppeal(params.id, body.approve, auth.user.id, body.note ? sanitizeInput(body.note) : null);
    } catch (err) {
      if (err instanceof AppealDecisionError) { set.status = err.status; return { error: err.message }; }
      throw err;
    }
    if (!row) { set.status = 404; return { error: 'Appeal not found or already decided' }; }
    logSafetyAction(auth.user.id, row.targetType === 'ban' && body.approve ? 'unban_user' : 'update_settings', row.userId, { appeal: row.id, approve: body.approve, targetType: row.targetType }, body.note);
    return { appeal: row };
  }, { params: t.Object({ id: t.String() }), body: t.Object({ approve: t.Boolean(), note: t.Optional(t.String({ maxLength: 1000 })) }) })
  // ─── Staff: accounts ───────────────────────────────────────────────────────
  .get('/admin/trust-safety/users', async ({ headers, cookie, query, set }) => {
    const auth = await staff(headers, cookie as Cookie);
    if (!auth.user) { set.status = auth.status; return { error: auth.error }; }
    const q = (query.q || '').trim();
    if (q.length < 2) return { users: [] };
    if (isValidObjectId(q)) {
      const u = await User.findById(q).catch(() => null);
      return { users: u ? [{ id: u.id, username: u.username, displayName: u.displayName ?? null, avatar: u.avatar ?? null, isBanned: Boolean(u.isBanned) }] : [] };
    }
    const rows = await searchUsersForStaff(q).catch(() => []);
    return { users: rows.map((u) => ({ id: u.id, username: u.username, displayName: u.displayName ?? null, avatar: u.avatar ?? null, isBanned: Boolean(u.isBanned) })) };
  }, { query: t.Object({ q: t.Optional(t.String({ maxLength: 100 })) }) })
  .get('/admin/trust-safety/users/:userId', async ({ headers, cookie, params, set }) => {
    const auth = await staff(headers, cookie as Cookie);
    if (!auth.user) { set.status = auth.status; return { error: auth.error }; }
    const target = await User.findById(params.userId);
    if (!target) { set.status = 404; return { error: 'User not found' }; }
    const [standing, incidents, isStaff] = await Promise.all([
      getStanding(target.id),
      listIncidents({ userId: target.id, limit: 50 }),
      isStaffAccount(target.id),
    ]);
    return {
      user: { id: target.id, username: target.username, displayName: target.displayName ?? null, avatar: target.avatar ?? null, createdAt: target.createdAt ?? null, isBanned: Boolean(target.isBanned), isStaff },
      standing,
      incidents,
    };
  }, { params: t.Object({ userId: t.String() }) })
  .post('/admin/trust-safety/users/:userId/strikes', async ({ headers, cookie, params, body, set }) => {
    const auth = await staff(headers, cookie as Cookie);
    if (!auth.user) { set.status = auth.status; return { error: auth.error }; }
    const target = await User.findById(params.userId);
    if (!target) { set.status = 404; return { error: 'User not found' }; }
    if (normalizeId(target.id) === normalizeId(auth.user.id)) { set.status = 400; return { error: 'You cannot strike yourself' }; }
    if (!(await canActOnStaffTarget(auth.user.id, target.id))) { set.status = 403; return { error: 'Only a super admin can strike a staff account' }; }
    const reason = sanitizeInput(body.reason).trim();
    if (reason.length < 3) { set.status = 400; return { error: 'Give a reason' }; }
    const days = body.expiresInDays === 0 ? null : Math.max(1, Math.min(3650, Math.round(body.expiresInDays ?? STRIKE_EXPIRY_DAYS)));
    const result = await issueStrike({ userId: target.id, category: normalizeStrikeCategory(body.category), reason, source: 'staff', issuedBy: auth.user.id, expiresInDays: days });
    logSafetyAction(auth.user.id, result.suspended ? 'ban_user' : 'update_settings', target.id, { strike: result.strike.id, activeStrikes: result.activeStrikes }, reason);
    const { sendSystemDM } = await import('@/lib/services/systemNotify');
    if (!result.suspended) {
      void sendSystemDM(target.id, `**⚠️ Your account received a strike**\n\n**Reason:** ${reason}\n\nYou can review this and appeal in **User Settings → Account Standing**.`, { kind: 'safety' }).catch(() => {});
    }
    return result;
  }, {
    params: t.Object({ userId: t.String() }),
    body: t.Object({ category: t.String({ maxLength: 30 }), reason: t.String({ maxLength: 500 }), expiresInDays: t.Optional(t.Number()) }),
  })
  .post('/admin/trust-safety/strikes/:id/revoke', async ({ headers, cookie, params, body, set }) => {
    const auth = await staff(headers, cookie as Cookie);
    if (!auth.user) { set.status = auth.status; return { error: auth.error }; }
    if (same(await recordOwner('strike', params.id), auth.user.id)) { set.status = 403; return { error: 'You cannot remove your own strikes' }; }
    const row = await revokeStrike(params.id, auth.user.id, body.reason ? sanitizeInput(body.reason) : null);
    if (!row) { set.status = 404; return { error: 'Strike not found or already removed' }; }
    logSafetyAction(auth.user.id, 'update_settings', row.userId, { revokedStrike: row.id }, body.reason);
    return { strike: row };
  }, { params: t.Object({ id: t.String() }), body: t.Object({ reason: t.Optional(t.String({ maxLength: 500 })) }) })
  .post('/admin/trust-safety/users/:userId/restrictions', async ({ headers, cookie, params, body, set }) => {
    const auth = await staff(headers, cookie as Cookie);
    if (!auth.user) { set.status = auth.status; return { error: auth.error }; }
    const target = await User.findById(params.userId);
    if (!target) { set.status = 404; return { error: 'User not found' }; }
    if (same(target.id, auth.user.id)) { set.status = 400; return { error: 'You cannot restrict yourself' }; }
    if (!(await canActOnStaffTarget(auth.user.id, target.id))) { set.status = 403; return { error: 'Only a super admin can restrict a staff account' }; }
    const reason = sanitizeInput(body.reason).trim();
    if (reason.length < 3) { set.status = 400; return { error: 'Give a reason' }; }
    const row = await addRestriction({ userId: target.id, type: 'chat', reason, hours: Math.max(1, Math.min(24 * 90, Math.round(body.hours))), source: 'staff', issuedBy: auth.user.id });
    logSafetyAction(auth.user.id, 'update_settings', target.id, { restriction: row.id, hours: body.hours }, reason);
    return { restriction: row };
  }, { params: t.Object({ userId: t.String() }), body: t.Object({ hours: t.Number(), reason: t.String({ maxLength: 500 }) }) })
  .post('/admin/trust-safety/restrictions/:id/lift', async ({ headers, cookie, params, set }) => {
    const auth = await staff(headers, cookie as Cookie);
    if (!auth.user) { set.status = auth.status; return { error: auth.error }; }
    if (same(await recordOwner('restriction', params.id), auth.user.id)) { set.status = 403; return { error: 'You cannot lift your own restrictions' }; }
    const row = await liftRestriction(params.id, auth.user.id);
    if (!row) { set.status = 404; return { error: 'Restriction not found or already lifted' }; }
    logSafetyAction(auth.user.id, 'update_settings', row.userId, { liftedRestriction: row.id });
    return { restriction: row };
  }, { params: t.Object({ id: t.String() }) })
  .post('/admin/trust-safety/users/:userId/suspend', async ({ headers, cookie, params, body, set }) => {
    const auth = await staff(headers, cookie as Cookie);
    if (!auth.user) { set.status = auth.status; return { error: auth.error }; }
    const target = await User.findById(params.userId);
    if (!target) { set.status = 404; return { error: 'User not found' }; }
    if (normalizeId(target.id) === normalizeId(auth.user.id) || await isStaffAccount(target.id)) {
      set.status = 400;
      return { error: 'Cannot suspend staff members' };
    }
    const reason = sanitizeInput(body.reason).trim() || 'No reason provided';
    await suspendAccount(target.id, reason);
    logSafetyAction(auth.user.id, 'ban_user', target.id, { username: target.username }, reason);
    return { success: true };
  }, { params: t.Object({ userId: t.String() }), body: t.Object({ reason: t.String({ maxLength: 500 }) }) })
  .post('/admin/trust-safety/users/:userId/unsuspend', async ({ headers, cookie, params, set }) => {
    const auth = await staff(headers, cookie as Cookie);
    if (!auth.user) { set.status = auth.status; return { error: auth.error }; }
    const target = await User.findById(params.userId);
    if (!target) { set.status = 404; return { error: 'User not found' }; }
    try {
      await StaffRole.unban(auth.user.id, target.id);
    } catch (err) {
      set.status = (err as { status?: number }).status ?? 400;
      return { error: (err as Error).message || 'Could not restore the account' };
    }
    const { cache } = await import('@/lib/db');
    await cache.del(`user:${target.id}`).catch(() => {});
    logSafetyAction(auth.user.id, 'unban_user', target.id, { username: target.username });
    return { success: true };
  }, { params: t.Object({ userId: t.String() }) })
  // ─── Staff: scam image hashes ──────────────────────────────────────────────
  .get('/admin/trust-safety/hashes', async ({ headers, cookie, set }) => {
    const auth = await staff(headers, cookie as Cookie);
    if (!auth.user) { set.status = auth.status; return { error: auth.error }; }
    const hashes = await listScamHashes();
    const users = await userCards(hashes.map((h) => h.addedBy ?? ''));
    return { hashes: hashes.map((h) => ({ ...h, addedByUser: h.addedBy ? users.get(normalizeId(h.addedBy)) ?? null : null })) };
  })
  .post('/admin/trust-safety/hashes', async ({ headers, cookie, body, set }) => {
    const auth = await staff(headers, cookie as Cookie);
    if (!auth.user) { set.status = auth.status; return { error: auth.error }; }
    const hash = normalizeHash(body.hash);
    if (!hash) { set.status = 400; return { error: 'A hash is 16 hexadecimal characters' }; }
    const label = sanitizeInput(body.label).trim();
    if (!label) { set.status = 400; return { error: 'Give the hash a label' }; }
    const row = await addScamHash({ hash, label, maxDistance: body.maxDistance, addedBy: auth.user.id });
    if (!row) { set.status = 409; return { error: 'That hash is already on the list' }; }
    logSafetyAction(auth.user.id, 'update_settings', auth.user.id, { addedScamHash: row.id, label });
    return { hash: row };
  }, { body: t.Object({ hash: t.String({ maxLength: 40 }), label: t.String({ maxLength: 200 }), maxDistance: t.Optional(t.Number()) }) })
  .post('/admin/trust-safety/hashes/from-image', async ({ headers, cookie, body, set }) => {
    const auth = await staff(headers, cookie as Cookie);
    if (!auth.user) { set.status = auth.status; return { error: auth.error }; }
    const buf = await fileBuffer(body.file);
    if (!buf) { set.status = 400; return { error: 'Upload an image (max 20 MB)' }; }
    const hash = await computeImageHash(buf);
    if (!hash) { set.status = 400; return { error: 'That image could not be read' }; }
    const label = sanitizeInput(body.label || body.file.name || 'Scam image').trim().slice(0, 200) || 'Scam image';
    const maxDistance = body.maxDistance ? Number(body.maxDistance) : DEFAULT_MATCH_DISTANCE;
    const row = await addScamHash({ hash, label, maxDistance: Number.isFinite(maxDistance) ? maxDistance : DEFAULT_MATCH_DISTANCE, addedBy: auth.user.id });
    if (!row) { set.status = 409; return { error: 'That image is already on the list', hash }; }
    logSafetyAction(auth.user.id, 'update_settings', auth.user.id, { addedScamHash: row.id, label });
    return { hash: row };
  }, { body: t.Object({ file: t.File(), label: t.Optional(t.String({ maxLength: 200 })), maxDistance: t.Optional(t.String({ maxLength: 4 })) }) })
  .patch('/admin/trust-safety/hashes/:id', async ({ headers, cookie, params, body, set }) => {
    const auth = await staff(headers, cookie as Cookie);
    if (!auth.user) { set.status = auth.status; return { error: auth.error }; }
    const row = await updateScamHash(params.id, { label: body.label !== undefined ? sanitizeInput(body.label) : undefined, maxDistance: body.maxDistance });
    if (!row) { set.status = 404; return { error: 'Hash not found' }; }
    return { hash: row };
  }, { params: t.Object({ id: t.String() }), body: t.Object({ label: t.Optional(t.String({ maxLength: 200 })), maxDistance: t.Optional(t.Number()) }) })
  .delete('/admin/trust-safety/hashes/:id', async ({ headers, cookie, params, set }) => {
    const auth = await staff(headers, cookie as Cookie);
    if (!auth.user) { set.status = auth.status; return { error: auth.error }; }
    if (!(await deleteScamHash(params.id))) { set.status = 404; return { error: 'Hash not found' }; }
    logSafetyAction(auth.user.id, 'update_settings', auth.user.id, { removedScamHash: params.id });
    return { success: true };
  }, { params: t.Object({ id: t.String() }) })
  // Dry run: what would happen to this image? Records and punishes nothing.
  .post('/admin/trust-safety/scan-test', async ({ headers, cookie, body, set }) => {
    const auth = await staff(headers, cookie as Cookie);
    if (!auth.user) { set.status = auth.status; return { error: auth.error }; }
    const buf = await fileBuffer(body.file);
    if (!buf) { set.status = 400; return { error: 'Upload an image (max 20 MB)' }; }
    const type = sniffImageType(buf) || 'image/jpeg';
    const [hash, hashes, pdna] = await Promise.all([
      computeImageHash(buf),
      listScamHashes(),
      photoDnaConfigured() ? photoDnaMatch(buf, type) : Promise.resolve(null),
    ]);
    let scamMatch: { id: string; label: string; distance: number } | null = null;
    if (hash) {
      for (const entry of hashes) {
        const m = findClosestHash(hash, [entry], entry.maxDistance);
        if (m && (!scamMatch || m.distance < scamMatch.distance)) scamMatch = { id: entry.id, label: entry.label, distance: m.distance };
      }
    }
    return { hash, scamMatch, photoDna: pdna, photoDnaEnabled: photoDnaConfigured() };
  }, { body: t.Object({ file: t.File() }) });
