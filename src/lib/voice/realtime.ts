/**
 * Cloudflare Realtime SFU API (docs/architecture/voice-sfu.md). Server only:
 * the app token is a bearer secret and never reaches a browser or a bot.
 *
 * A session is one PeerConnection. It publishes tracks (`location: 'local'`,
 * by mid) and pulls other sessions' tracks (`location: 'remote'`, by session
 * id + track name); pulls usually come back with an SFU offer the client must
 * answer through `renegotiate`.
 */
import { config } from '@/lib/config';

const BASE = 'https://rtc.live.cloudflare.com/v1/apps';

export type SessionDescription = { type: 'offer' | 'answer'; sdp: string };

export interface RealtimeTrackResult {
  trackName?: string;
  mid?: string;
  sessionId?: string;
  errorCode?: string;
  errorDescription?: string;
}

export interface RealtimeResponse {
  sessionId?: string;
  sessionDescription?: SessionDescription;
  requiresImmediateRenegotiation?: boolean;
  tracks?: RealtimeTrackResult[];
  errorCode?: string;
  errorDescription?: string;
}

export class RealtimeError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

export function realtimeConfigured(): boolean {
  return Boolean(config.CF_REALTIME_APP_ID && config.CF_REALTIME_APP_TOKEN);
}

/** Server voice / stage channels use the SFU (DM and group calls never do). */
export function sfuEnabledForRoom(roomId: string): boolean {
  return config.VOICE_SFU && realtimeConfigured() && roomId.startsWith('channel-');
}

async function call(path: string, body: unknown, method: 'POST' | 'PUT' | 'GET' = 'POST'): Promise<RealtimeResponse> {
  if (!realtimeConfigured()) throw new RealtimeError('Realtime is not configured', 503);
  const res = await fetch(`${BASE}/${config.CF_REALTIME_APP_ID}${path}`, {
    method,
    headers: { Authorization: `Bearer ${config.CF_REALTIME_APP_TOKEN}`, 'content-type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(10_000),
  }).catch((err: unknown) => {
    throw new RealtimeError(`Realtime unreachable: ${(err as Error)?.message ?? err}`, 502);
  });
  const data = (await res.json().catch(() => ({}))) as RealtimeResponse;
  if (!res.ok || data.errorCode) {
    throw new RealtimeError(data.errorDescription || `Realtime HTTP ${res.status}`, res.ok ? 400 : res.status, data.errorCode);
  }
  return data;
}

/** A new session from the client's first offer. */
export function newSession(offer: SessionDescription): Promise<RealtimeResponse> {
  return call('/sessions/new', { sessionDescription: offer });
}

/** Publish the client's tracks (by mid) under the given names. */
export function publishTracks(sessionId: string, offer: SessionDescription, tracks: Array<{ mid: string; trackName: string }>): Promise<RealtimeResponse> {
  return call(`/sessions/${encodeURIComponent(sessionId)}/tracks/new`, {
    sessionDescription: offer,
    tracks: tracks.map((t) => ({ location: 'local', mid: t.mid, trackName: t.trackName })),
  });
}

/** Pull other sessions' tracks into this one. */
export function pullTracks(sessionId: string, tracks: Array<{ sessionId: string; trackName: string }>): Promise<RealtimeResponse> {
  return call(`/sessions/${encodeURIComponent(sessionId)}/tracks/new`, {
    tracks: tracks.map((t) => ({ location: 'remote', sessionId: t.sessionId, trackName: t.trackName })),
  });
}

export function renegotiate(sessionId: string, answer: SessionDescription): Promise<RealtimeResponse> {
  return call(`/sessions/${encodeURIComponent(sessionId)}/renegotiate`, { sessionDescription: answer }, 'PUT');
}

/**
 * Close tracks (published or pulled) of a session by mid. Without an offer
 * the SFU closes them on its side (`force`), which is how the server cuts a
 * pull (server mute / deafen / stage suppression).
 */
export function closeTracks(sessionId: string, mids: string[], offer?: SessionDescription): Promise<RealtimeResponse> {
  return call(`/sessions/${encodeURIComponent(sessionId)}/tracks/close`, {
    tracks: mids.map((mid) => ({ mid })),
    ...(offer ? { sessionDescription: offer } : { force: true }),
  }, 'PUT');
}
