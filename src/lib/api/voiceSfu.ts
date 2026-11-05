/**
 * /api/voice/sfu/:roomId/* — the browser's side of an SFU room
 * (docs/architecture/voice-sfu.md). Every Cloudflare Realtime call goes
 * through here: the app token stays on the server, the caller must be in the
 * room, and pulls are checked against server mute / deafen / suppression and
 * the STREAM-checked video and screen flags (pullDecision).
 */
import { Elysia, t } from 'elysia';
import { authenticateRequest } from '@/lib/services/auth';
import { checkRateLimit } from '@/lib/security';
import { setParticipantSfu, voiceParticipantIn } from '@/lib/api/voice';
import { closeTracks, newSession, publishTracks, pullTracks, RealtimeError, renegotiate, sfuEnabledForRoom } from '@/lib/voice/realtime';
import { forgetPulls, isTrackKind, pullDecision, recordPull, trackNameFor, type TrackKind } from '@/lib/voice/sfu';

type Cookies = Record<string, { value?: unknown }>;

async function caller(headers: Record<string, string | undefined>, cookie: Cookies) {
  const token = cookie.auth_token?.value;
  return authenticateRequest(headers.authorization ?? null, typeof token === 'string' ? { auth_token: token } : {});
}

const SDP = t.Object({ type: t.Union([t.Literal('offer'), t.Literal('answer')]), sdp: t.String({ maxLength: 64 * 1024 }) });

/** The caller, in an SFU room they're part of; or the error to return. */
async function inRoom(headers: Record<string, string | undefined>, cookie: Cookies, roomId: string, set: { status?: number | string }) {
  const { user } = await caller(headers, cookie);
  if (!user) { set.status = 401; return { error: 'Unauthorized' } as const; }
  if (!sfuEnabledForRoom(roomId)) { set.status = 409; return { error: 'This room does not use the SFU' } as const; }
  const limit = await checkRateLimit('voiceSfu', user.id);
  if (!limit.success) { set.status = 429; return { error: 'Rate limited', retryAfter: limit.retryAfter } as const; }
  const me = voiceParticipantIn(roomId, user.id);
  if (!me) { set.status = 403; return { error: 'Join the room first' } as const; }
  return { user, me } as const;
}

function realtimeFailure(err: unknown, set: { status?: number | string }) {
  const e = err as RealtimeError;
  console.warn('[voice-sfu]', e?.message ?? err);
  set.status = e instanceof RealtimeError && e.status >= 400 && e.status < 500 ? 400 : 502;
  return { error: 'The voice server could not do that. Try again.' };
}

export const voiceSfuRoutes = new Elysia({ prefix: '/voice/sfu' })
  // A new Realtime session from the client's first offer.
  .post('/:roomId/session', async ({ headers, cookie, params, body, set }) => {
    const ctx = await inRoom(headers, cookie as Cookies, params.roomId, set);
    if ('error' in ctx) return ctx;
    try {
      const res = await newSession(body.offer);
      if (!res.sessionId || !res.sessionDescription) throw new RealtimeError('No session', 502);
      // A new session replaces whatever this member published before.
      setParticipantSfu(params.roomId, ctx.user.id, res.sessionId, {});
      return { sessionId: res.sessionId, answer: res.sessionDescription };
    } catch (err) {
      return realtimeFailure(err, set);
    }
  }, { body: t.Object({ offer: SDP }) })

  // Publish the client's tracks (by mid); the server names them.
  .post('/:roomId/publish', async ({ headers, cookie, params, body, set }) => {
    const ctx = await inRoom(headers, cookie as Cookies, params.roomId, set);
    if ('error' in ctx) return ctx;
    const session = ctx.me.sfuSession;
    if (!session) { set.status = 409; return { error: 'No session yet' }; }
    const tracks = body.tracks.filter((tr) => isTrackKind(tr.kind)) as Array<{ mid: string; kind: TrackKind }>;
    if (tracks.length === 0 || new Set(tracks.map((tr) => tr.kind)).size !== tracks.length) { set.status = 400; return { error: 'Invalid tracks' }; }
    const named = tracks.map((tr) => ({ ...tr, trackName: trackNameFor(ctx.user.id, tr.kind) }));
    try {
      const res = await publishTracks(session, body.offer, named.map(({ mid, trackName }) => ({ mid, trackName })));
      const failed = (res.tracks ?? []).filter((tr) => tr.errorCode);
      if (failed.length) throw new RealtimeError(failed[0].errorDescription || 'Track refused', 400);
      const next = { ...(ctx.me.tracks ?? {}) };
      for (const tr of named) next[tr.kind] = tr.trackName;
      setParticipantSfu(params.roomId, ctx.user.id, session, next);
      return { answer: res.sessionDescription, tracks: Object.fromEntries(named.map((tr) => [tr.kind, tr.trackName])) };
    } catch (err) {
      return realtimeFailure(err, set);
    }
  }, { body: t.Object({ offer: SDP, tracks: t.Array(t.Object({ mid: t.String({ maxLength: 16 }), kind: t.String({ maxLength: 16 }) }), { minItems: 1, maxItems: 4 }) }) })

  // Stop publishing some kinds (camera off, share stopped).
  .post('/:roomId/unpublish', async ({ headers, cookie, params, body, set }) => {
    const ctx = await inRoom(headers, cookie as Cookies, params.roomId, set);
    if ('error' in ctx) return ctx;
    const session = ctx.me.sfuSession;
    if (!session) return { answer: null };
    try {
      const res = body.mids.length ? await closeTracks(session, body.mids, body.offer) : null;
      const next = { ...(ctx.me.tracks ?? {}) };
      for (const kind of body.kinds) delete next[kind];
      setParticipantSfu(params.roomId, ctx.user.id, session, next);
      return { answer: res?.sessionDescription ?? null };
    } catch (err) {
      return realtimeFailure(err, set);
    }
  }, { body: t.Object({ offer: SDP, mids: t.Array(t.String({ maxLength: 16 }), { maxItems: 4 }), kinds: t.Array(t.String({ maxLength: 16 }), { maxItems: 4 }) }) })

  // Pull others' tracks into the caller's session (what's not allowed is skipped).
  .post('/:roomId/pull', async ({ headers, cookie, params, body, set }) => {
    const ctx = await inRoom(headers, cookie as Cookies, params.roomId, set);
    if ('error' in ctx) return ctx;
    const session = ctx.me.sfuSession;
    if (!session) { set.status = 409; return { error: 'No session yet' }; }
    const wanted: Array<{ userId: string; kind: TrackKind; sessionId: string; trackName: string }> = [];
    const refused: Array<{ userId: string; kind: string; reason: string }> = [];
    for (const req of body.tracks) {
      if (!isTrackKind(req.kind)) { refused.push({ ...req, reason: 'kind' }); continue; }
      const publisher = voiceParticipantIn(params.roomId, req.userId);
      const reason = publisher
        ? pullDecision(req.kind, { ...publisher, userId: req.userId }, { ...ctx.me, userId: ctx.user.id })
        : 'not_published';
      if (reason || !publisher?.sfuSession || !publisher.tracks?.[req.kind]) { refused.push({ ...req, reason: reason ?? 'not_published' }); continue; }
      wanted.push({ userId: req.userId, kind: req.kind, sessionId: publisher.sfuSession, trackName: publisher.tracks[req.kind] });
    }
    if (wanted.length === 0) return { offer: null, pulled: [], refused };
    try {
      const res = await pullTracks(session, wanted.map(({ sessionId, trackName }) => ({ sessionId, trackName })));
      const pulled: Array<{ userId: string; kind: TrackKind; mid: string }> = [];
      (res.tracks ?? []).forEach((tr, i) => {
        const w = wanted.find((x) => x.trackName === tr.trackName) ?? wanted[i];
        if (!w) return;
        if (tr.errorCode || !tr.mid) { refused.push({ userId: w.userId, kind: w.kind, reason: tr.errorCode ?? 'sfu' }); return; }
        pulled.push({ userId: w.userId, kind: w.kind, mid: tr.mid });
        void recordPull(params.roomId, ctx.user.id, w.userId, w.kind, session, tr.mid);
      });
      return {
        offer: res.requiresImmediateRenegotiation ? res.sessionDescription ?? null : null,
        pulled,
        refused,
      };
    } catch (err) {
      return realtimeFailure(err, set);
    }
  }, { body: t.Object({ tracks: t.Array(t.Object({ userId: t.String({ maxLength: 64 }), kind: t.String({ maxLength: 16 }) }), { minItems: 1, maxItems: 64 }) }) })

  // Stop pulling (someone left, a share ended): the client closes by mid.
  .post('/:roomId/drop', async ({ headers, cookie, params, body, set }) => {
    const ctx = await inRoom(headers, cookie as Cookies, params.roomId, set);
    if ('error' in ctx) return ctx;
    const session = ctx.me.sfuSession;
    if (!session) return { answer: null };
    try {
      const res = body.mids.length ? await closeTracks(session, body.mids, body.offer) : null;
      const pairs = body.tracks.filter((tr) => isTrackKind(tr.kind)) as Array<{ userId: string; kind: TrackKind }>;
      void forgetPulls(params.roomId, ctx.user.id, pairs.map((tr) => ({ publisherId: tr.userId, kind: tr.kind })));
      return { answer: res?.sessionDescription ?? null };
    } catch (err) {
      return realtimeFailure(err, set);
    }
  }, { body: t.Object({ offer: SDP, mids: t.Array(t.String({ maxLength: 16 }), { maxItems: 64 }), tracks: t.Array(t.Object({ userId: t.String({ maxLength: 64 }), kind: t.String({ maxLength: 16 }) }), { maxItems: 64 }) }) })

  // The client's answer to the SFU's offer (after a pull).
  .put('/:roomId/renegotiate', async ({ headers, cookie, params, body, set }) => {
    const ctx = await inRoom(headers, cookie as Cookies, params.roomId, set);
    if ('error' in ctx) return ctx;
    const session = ctx.me.sfuSession;
    if (!session) { set.status = 409; return { error: 'No session yet' }; }
    try {
      await renegotiate(session, body.answer);
      return { ok: true };
    } catch (err) {
      return realtimeFailure(err, set);
    }
  }, { body: t.Object({ answer: SDP }) });
