import { processShared } from '@/lib/realtime/processShared';

/**
 * Per-user registry of open channel SSE streams, so access can be re-checked
 * after membership or permission changes (kick, ban, leave, role edits).
 *
 * Each tracked stream carries a `revalidate` closure (built in channels.ts,
 * where checkChannelAccess lives) that re-runs the access check and closes the
 * stream when access is gone. Streams also revalidate themselves on a timer
 * (CHANNEL_STREAM_RECHECK_MS) as a backstop for mutation paths that don't
 * request a recheck explicitly.
 */
export interface TrackedChannelStream {
  channelId: string;
  revalidate: () => Promise<void>;
}

/** Backstop interval for re-checking access on an open channel stream. */
export const CHANNEL_STREAM_RECHECK_MS = 60_000;

/** Payload sent to a stream right before the server closes it for lost access. */
export const CHANNEL_STREAM_REVOKED_EVENT = 'data: {"type":"removed","error":"Access denied"}\n\n';

const streamsByUser = processShared(
  'channelStreamsByUser',
  () => new Map<string, Set<TrackedChannelStream>>(),
);

/** Track a user's open channel stream. Returns an untrack cleanup. */
export function trackUserChannelStream(userId: string, entry: TrackedChannelStream): () => void {
  let set = streamsByUser.get(userId);
  if (!set) {
    set = new Set();
    streamsByUser.set(userId, set);
  }
  set.add(entry);
  return () => {
    const current = streamsByUser.get(userId);
    if (!current) return;
    current.delete(entry);
    if (current.size === 0) streamsByUser.delete(userId);
  };
}

/** Re-check every channel stream this user has open on THIS process. */
export async function recheckLocalUserChannelStreams(userId: string): Promise<void> {
  const set = streamsByUser.get(userId);
  if (!set || set.size === 0) return;
  await Promise.all([...set].map((entry) => entry.revalidate().catch(() => { /* keep stream on transient errors */ })));
}

type RecheckPublisher = (userId: string) => void;
const recheckPublisher = processShared<{ fn: RecheckPublisher | null }>(
  'channelStreamRecheckPublisher',
  () => ({ fn: null }),
);

/** channels.ts registers the cross-instance fan-out (it owns the SSE Redis bus). */
export function setChannelStreamRecheckPublisher(fn: RecheckPublisher): void {
  recheckPublisher.fn = fn;
}

/**
 * Ask every instance to re-check this user's open channel streams now (call
 * after removing a member). Local streams are re-checked immediately; other
 * instances are reached over the channel SSE bus when it is available.
 */
export function requestUserChannelStreamRecheck(userId: string): void {
  void recheckLocalUserChannelStreams(userId);
  try {
    recheckPublisher.fn?.(userId);
  } catch {
    /* best-effort cross-instance fan-out */
  }
}

