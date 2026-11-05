/**
 * SFU rooms (docs/architecture/voice-sfu.md): who may pull which track, a
 * ledger of every pull (so the server can cut it), and the cuts themselves
 * when someone is server muted, deafened or suppressed.
 *
 * The ledger lives in Redis (`voice:sfu:pulls:<roomId>`, field
 * `<pullerId>|<publisherId>|<kind>` → `<puller session>|<mid>`) because a pull
 * and the moderation that has to cut it can land on different instances.
 */
import { getRedis } from '@/lib/db/redis';
import { closeTracks } from '@/lib/voice/realtime';

export const TRACK_KINDS = ['audio', 'video', 'screen', 'screenAudio'] as const;
export type TrackKind = (typeof TRACK_KINDS)[number];

export function isTrackKind(v: unknown): v is TrackKind {
  return typeof v === 'string' && (TRACK_KINDS as readonly string[]).includes(v);
}

const AUDIO_KINDS: ReadonlySet<TrackKind> = new Set(['audio', 'screenAudio']);

export interface SfuParticipantView {
  userId: string;
  audio?: boolean;
  video?: boolean;
  screenShare?: boolean;
  serverMute?: boolean;
  serverDeaf?: boolean;
  suppress?: boolean;
  sfuSession?: string;
  tracks?: Record<string, string>;
}

export type PullRefusal = 'not_published' | 'publisher_muted' | 'puller_deafened' | 'not_live' | 'self';

/**
 * May `puller` pull `publisher`'s `kind` track? The server decides (the SFU
 * forwards whatever it is asked to), so this is where server mute, deafen,
 * stage suppression and the STREAM-checked video / screen flags hold.
 */
export function pullDecision(kind: TrackKind, publisher: SfuParticipantView, puller: SfuParticipantView): PullRefusal | null {
  if (publisher.userId === puller.userId) return 'self';
  if (!publisher.sfuSession || !publisher.tracks?.[kind]) return 'not_published';
  if (AUDIO_KINDS.has(kind)) {
    if (kind === 'audio' && (publisher.serverMute || publisher.suppress)) return 'publisher_muted';
    if (puller.serverDeaf) return 'puller_deafened';
  }
  if (kind === 'video' && !publisher.video) return 'not_live';
  if ((kind === 'screen' || kind === 'screenAudio') && !publisher.screenShare) return 'not_live';
  return null;
}

/** Server-chosen track names: `<userId>:<kind>:<nonce>` (unique per publish). */
export function trackNameFor(userId: string, kind: TrackKind): string {
  return `${userId.toLowerCase()}:${kind}:${crypto.randomUUID().slice(0, 8)}`;
}

const LEDGER_TTL_S = 6 * 60 * 60;
const ledgerKey = (roomId: string) => `voice:sfu:pulls:${roomId}`;
const field = (pullerId: string, publisherId: string, kind: TrackKind) => `${pullerId.toLowerCase()}|${publisherId.toLowerCase()}|${kind}`;

/** Remember that `pullerId`'s session pulled a track into `mid`. */
export async function recordPull(roomId: string, pullerId: string, publisherId: string, kind: TrackKind, pullerSession: string, mid: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  await r.multi().hset(ledgerKey(roomId), field(pullerId, publisherId, kind), `${pullerSession}|${mid}`).expire(ledgerKey(roomId), LEDGER_TTL_S).exec().catch(() => {});
}

export async function forgetPulls(roomId: string, pullerId: string, fields: Array<{ publisherId: string; kind: TrackKind }>): Promise<void> {
  const r = getRedis();
  if (!r || fields.length === 0) return;
  await r.hdel(ledgerKey(roomId), ...fields.map((f) => field(pullerId, f.publisherId, f.kind))).catch(() => {});
}

/** Someone left: drop every ledger entry that involves them. */
export async function forgetSfuParticipant(roomId: string, userId: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  const all = await r.hgetall(ledgerKey(roomId)).catch(() => ({} as Record<string, string>));
  const id = userId.toLowerCase();
  const gone = Object.keys(all).filter((f) => {
    const [puller, publisher] = f.split('|');
    return puller === id || publisher === id;
  });
  if (gone.length) await r.hdel(ledgerKey(roomId), ...gone).catch(() => {});
}

/**
 * Close every pull the room's state no longer allows: `userId`'s audio for
 * everyone (server muted / suppressed) and everyone's audio for `userId`
 * (server deafened). Pullers' clients just see the track end.
 */
export async function enforceSfuCuts(roomId: string, userId: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  const { voiceParticipantIn } = await import('@/lib/api/voice');
  const all = await r.hgetall(ledgerKey(roomId)).catch(() => ({} as Record<string, string>));
  const id = userId.toLowerCase();
  const bySession = new Map<string, string[]>();
  const dropped: string[] = [];
  for (const [f, v] of Object.entries(all)) {
    const [pullerId, publisherId, kind] = f.split('|');
    if (pullerId !== id && publisherId !== id) continue;
    if (!isTrackKind(kind)) continue;
    const publisher = voiceParticipantIn(roomId, publisherId);
    const puller = voiceParticipantIn(roomId, pullerId);
    const still = publisher && puller ? pullDecision(kind, { ...publisher, userId: publisherId }, { ...puller, userId: pullerId }) === null : false;
    if (still) continue;
    const [session, mid] = v.split('|');
    if (!session || !mid) continue;
    bySession.set(session, [...(bySession.get(session) ?? []), mid]);
    dropped.push(f);
  }
  for (const [session, mids] of bySession) {
    await closeTracks(session, mids).catch((err: unknown) => console.warn('[voice-sfu] cut failed:', (err as Error)?.message ?? err));
  }
  if (dropped.length) await r.hdel(ledgerKey(roomId), ...dropped).catch(() => {});
}
