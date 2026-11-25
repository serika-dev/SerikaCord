/**
 * Two-way sync between SerikaCord friends and the Serika Accounts friend
 * graph. Rules (id mapping, three-way merge) live in
 * src/lib/social/friendGraphSync.ts; this module does the I/O.
 *
 * Everything here is best-effort: a graph outage never fails or slows a
 * friend action. Mirroring runs after the transaction committed and is not
 * awaited; reconciling is throttled per user and the friends route only waits
 * for it briefly.
 */
import { normalizeId } from '@/lib/db/normalizeId';
import { getRedis } from '@/lib/db/redis';
import { User, type IUser } from '@/lib/models';
import { BoundedMap } from '@/lib/utils/boundedMap';
import {
  accountsGraphDeleteFriend,
  accountsGraphFriends,
  accountsGraphUpsertFriend,
} from '@/lib/services/accountsClient';
import {
  FRIEND_GRAPH_BASE_TTL_SECONDS,
  accountsIdFromUserId,
  eitherBlocked,
  friendGraphBaseKey,
  graphOpFor,
  graphPeerStates,
  invertState,
  localPeerState,
  localPeerStates,
  mirrorOp,
  pairPatches,
  reconcilePeer,
  type GraphOp,
  type PeerState,
} from '@/lib/social/friendGraphSync';

/** A user's graph view is pulled at most this often (per user, across instances). */
const RECONCILE_INTERVAL_SECONDS = 60;
/** Graph/local writes run this many at a time during one reconcile. */
const RECONCILE_CONCURRENCY = 4;

const syncedKey = (userId: string) => `friendgraph:synced:${normalizeId(userId)}`;
const VALID_STATES = new Set<PeerState>(['friend', 'incoming', 'outgoing']);

/** Run one graph write. Never throws; logs failures. */
export async function applyGraphOp(op: GraphOp): Promise<{ ok: boolean; status: number; result?: string }> {
  try {
    const res = op.kind === 'delete'
      ? await accountsGraphDeleteFriend(op.a, op.b)
      : await accountsGraphUpsertFriend({ a: op.a, b: op.b, requestedBy: op.requestedBy, ...(op.status ? { status: op.status } : {}) });
    // The graph answers 200 with { error } for a refused pair (e.g. self).
    const ok = res.ok && !res.data?.error;
    if (!ok) console.warn(`[FriendGraph] ${op.kind} ${op.a}/${op.b} failed: ${res.status} ${res.data?.error ?? ''}`.trim());
    return { ok, status: res.status, result: typeof res.data?.status === 'string' ? res.data.status : undefined };
  } catch (error) {
    console.warn(`[FriendGraph] ${op.kind} ${op.a}/${op.b} failed:`, error instanceof Error ? error.message : error);
    return { ok: false, status: 0 };
  }
}

/** Record that the pair agrees on `state` (from `meId`'s side) in both users' bases. */
export async function recordAgreed(meId: string, peerId: string, state: PeerState): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const me = normalizeId(meId);
  const peer = normalizeId(peerId);
  const tx = redis.multi();
  for (const [owner, other, s] of [[me, peer, state], [peer, me, invertState(state)]] as const) {
    const key = friendGraphBaseKey(owner);
    if (s === 'none') tx.hdel(key, other);
    else tx.hset(key, other, s).expire(key, FRIEND_GRAPH_BASE_TTL_SECONDS);
  }
  await tx.exec().catch(() => {});
}

/**
 * Mirror a committed change of `meId`'s relation to `peerId` to the graph.
 * Fire-and-forget: callers don't await it. Skips users without an accounts id.
 */
export function mirrorFriendChange(meId: string, peerId: string, before: PeerState, after: PeerState): void {
  const op = mirrorOp(meId, peerId, before, after);
  if (!op) return;
  void (async () => {
    const res = await applyGraphOp(op);
    // On success the pair is known to match the graph, so a later change made
    // elsewhere (declined in SerikaTrack, say) is imported rather than undone.
    if (res.ok) await recordAgreed(meId, peerId, after);
  })().catch((error) => console.warn('[FriendGraph] mirror error:', error));
}

async function readBase(userId: string): Promise<Map<string, PeerState>> {
  const redis = getRedis();
  const out = new Map<string, PeerState>();
  if (!redis) return out;
  const raw = await redis.hgetall(friendGraphBaseKey(userId)).catch(() => ({} as Record<string, string>));
  for (const [peer, state] of Object.entries(raw)) {
    if (VALID_STATES.has(state as PeerState)) out.set(normalizeId(peer), state as PeerState);
  }
  return out;
}

async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item).catch((error) => console.warn('[FriendGraph] reconcile step failed:', error instanceof Error ? error.message : error));
    }
  });
  await Promise.all(workers);
}

/**
 * Set the local pair to `target` (from `meId`'s side) under the pair lock, if
 * the local state is still `expected` and neither side blocked the other.
 * Never mirrors back: the change came from the graph.
 */
async function applyLocal(meId: string, peerId: string, expected: PeerState, target: PeerState): Promise<'changed' | 'skipped'> {
  const { mutateFriendPair } = await import('@/lib/services/friendPairLock');
  const outcome = await mutateFriendPair(meId, peerId, async (me, peer, save) => {
    if (localPeerState(me, peer.id) !== expected) return { body: { skipped: 'moved' } };
    if (target !== 'none' && (eitherBlocked(me, peer) || peer.isSystem || peer.isBot || me.isSystem || me.isBot)) {
      return { body: { skipped: 'blocked' } };
    }
    const patches = pairPatches(me, peer, target);
    await save(me.id, patches.me);
    await save(peer.id, patches.peer);
    return { changed: true, body: {} };
  }, { mirror: false });
  return outcome?.changed ? 'changed' : 'skipped';
}

export interface ReconcileOptions {
  /** Called with every local user id whose friend lists changed (me + peers). */
  onLocalChange?: (userIds: string[]) => void;
  /** Ignore the per-user interval (backfill / tests). */
  force?: boolean;
}

const inflight = new BoundedMap<string, Promise<void>>(5000);

/**
 * Merge `userId`'s graph view into SerikaCord and push local-only state to
 * the graph. Throttled to once a minute per user; no-op for users without an
 * accounts id or when Redis (which holds the merge base) is unavailable.
 */
export function reconcileFriendGraph(userId: string, opts: ReconcileOptions = {}): Promise<void> {
  const me = normalizeId(userId);
  const running = inflight.get(me);
  if (running) return running;
  const p = doReconcile(me, opts)
    .catch((error) => console.warn('[FriendGraph] reconcile failed:', error instanceof Error ? error.message : error))
    .finally(() => inflight.delete(me));
  inflight.set(me, p);
  return p;
}

async function doReconcile(me: string, opts: ReconcileOptions): Promise<void> {
  const accountsId = accountsIdFromUserId(me);
  const redis = getRedis();
  if (!accountsId || !redis) return;
  if (!opts.force) {
    const claimed = await redis.set(syncedKey(me), '1', 'EX', RECONCILE_INTERVAL_SECONDS, 'NX').catch(() => null);
    if (claimed !== 'OK') return;
  }

  const graphRes = await accountsGraphFriends(accountsId);
  if (!graphRes.ok) {
    console.warn(`[FriendGraph] could not read graph for ${accountsId}: ${graphRes.status}`);
    return;
  }

  const [row, base] = await Promise.all([User.findById(me), readBase(me)]);
  if (!row) return;
  const local = new Map([...localPeerStates(row)].filter(([peer]) => accountsIdFromUserId(peer)));
  const graph = graphPeerStates(graphRes.data);
  graph.delete(me);

  const peers = [...new Set([...local.keys(), ...graph.keys(), ...base.keys()])];

  // Graph-only peers must exist locally (someone who never opened SerikaCord
  // has no row to befriend yet; they're picked up once they do).
  const unknown = peers.filter((p) => !local.has(p) && graph.has(p));
  const known = new Set<string>(local.keys());
  if (unknown.length) {
    const rows = (await User.find({ id: { in: unknown } })) as IUser[];
    for (const r of rows) known.add(normalizeId(r.id));
  }

  const changed = new Set<string>();
  await runPool(peers, RECONCILE_CONCURRENCY, async (peer) => {
    const l = local.get(peer) ?? 'none';
    const g = graph.get(peer) ?? 'none';
    const b = base.get(peer) ?? 'none';
    const step = reconcilePeer(l, g, b);

    if (step.local === undefined && step.graph === undefined) {
      if (step.agreed !== b) await recordAgreed(me, peer, step.agreed);
      return;
    }
    if (step.local !== undefined) {
      if (!known.has(peer)) return;
      const res = await applyLocal(me, peer, l, step.local);
      if (res === 'skipped') return; // blocked or moved: leave the base so it's retried later
      changed.add(peer);
    }
    if (step.graph !== undefined) {
      const op = graphOpFor(me, peer, step.graph, l);
      if (!op || !(await applyGraphOp(op)).ok) return;
    }
    await recordAgreed(me, peer, step.agreed);
  });

  if (changed.size) {
    console.log(`[FriendGraph] imported ${changed.size} relation(s) from the graph for ${me}`);
    opts.onLocalChange?.([me, ...changed]);
  }
}
