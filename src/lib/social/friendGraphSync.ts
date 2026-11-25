/**
 * Pure rules for syncing SerikaCord friends with the Serika Accounts friend
 * graph (`/internal/graph/friends`), which SerikaTrack, Social and serika.dev
 * already share.
 *
 * SerikaCord keeps its own copy on `users` (friends uuid[], pending jsonb).
 * Two things keep the two in step:
 *
 *  - Mirroring: every committed friend mutation pushes the pair's new state to
 *    the graph (see friendPairLock.ts / services/friendGraph.ts).
 *  - Reconciling: when a user's friend list is read, their graph view is
 *    merged with their local view as a three-way merge against the state both
 *    sides last agreed on (the "base", kept per user in Redis). The base is
 *    what tells "made elsewhere, import it" apart from "removed here, the
 *    mirror failed, push the removal again".
 *
 * Ids: SerikaCord ids of accounts users are the accounts ObjectId right-padded
 * with zeros into a UUID. Users whose id isn't derived that way (legacy local
 * rows, bots, Discord-created users) have no accounts id and are never synced.
 *
 * No db / redis / fetch here: shared by the service, the backfill script and
 * unit tests.
 */
import { normalizeId } from '@/lib/db/normalizeId';
import { hasId, removeId, addId } from '@/lib/social/friendLists';
import { accountsIdFromUserId } from '@/lib/serikaWishlist';

export { accountsIdFromUserId };

/** One user's view of their relation to a peer. */
export type PeerState = 'friend' | 'incoming' | 'outgoing' | 'none';

/** The graph's GET /internal/graph/friends/:id response. */
export interface GraphFriends {
  friends: string[];
  incoming: string[];
  outgoing: string[];
}

/** The friend-related columns of a `users` row. */
export interface FriendRow {
  id: string;
  friends?: string[] | null;
  blockedUsers?: string[] | null;
  pendingFriendRequests?: unknown;
}

/** Redis hash holding `<peer local id> → PeerState` as last agreed with the graph. */
export const friendGraphBaseKey = (userId: string) => `friendgraph:base:${normalizeId(userId)}`;
/** Bases are refreshed on every write; a lapsed one just falls back to "no base" rules. */
export const FRIEND_GRAPH_BASE_TTL_SECONDS = 180 * 24 * 60 * 60;

/** The local id an accounts id maps to, or null when it isn't an ObjectId. */
export function userIdFromAccountsId(accountsId: string): string | null {
  return typeof accountsId === 'string' && /^[0-9a-f]{24}$/i.test(accountsId) ? normalizeId(accountsId) : null;
}

/** The same relation seen from the peer's side. */
export function invertState(state: PeerState): PeerState {
  if (state === 'incoming') return 'outgoing';
  if (state === 'outgoing') return 'incoming';
  return state;
}

function pending(row: FriendRow): { incoming: string[]; outgoing: string[] } {
  const p = (row.pendingFriendRequests ?? {}) as { incoming?: unknown; outgoing?: unknown };
  return {
    incoming: Array.isArray(p.incoming) ? (p.incoming as string[]) : [],
    outgoing: Array.isArray(p.outgoing) ? (p.outgoing as string[]) : [],
  };
}

/** `me`'s relation to `peerId` according to `me`'s own row. Friends win over stale pending rows. */
export function localPeerState(me: FriendRow, peerId: string): PeerState {
  if (hasId(me.friends, peerId)) return 'friend';
  const p = pending(me);
  if (hasId(p.outgoing, peerId)) return 'outgoing';
  if (hasId(p.incoming, peerId)) return 'incoming';
  return 'none';
}

/** Every peer on `me`'s row (friends and pending), as local ids → state. */
export function localPeerStates(me: FriendRow): Map<string, PeerState> {
  const out = new Map<string, PeerState>();
  const p = pending(me);
  for (const id of p.incoming) out.set(normalizeId(id), 'incoming');
  for (const id of p.outgoing) out.set(normalizeId(id), 'outgoing');
  for (const id of me.friends || []) out.set(normalizeId(id), 'friend');
  return out;
}

/** The graph response as local ids → state. Ids that don't map to a local id are dropped. */
export function graphPeerStates(graph: Partial<GraphFriends> | null | undefined): Map<string, PeerState> {
  const out = new Map<string, PeerState>();
  const put = (ids: unknown, state: PeerState) => {
    if (!Array.isArray(ids)) return;
    for (const raw of ids) {
      const id = typeof raw === 'string' ? userIdFromAccountsId(raw) : null;
      if (id) out.set(id, state);
    }
  };
  put(graph?.incoming, 'incoming');
  put(graph?.outgoing, 'outgoing');
  put(graph?.friends, 'friend');
  return out;
}

/** Whether either side blocked the other. */
export function eitherBlocked(a: FriendRow, b: FriendRow): boolean {
  return hasId(a.blockedUsers, b.id) || hasId(b.blockedUsers, a.id);
}

/** A write to the graph for one pair. */
export type GraphOp =
  | { kind: 'upsert'; a: string; b: string; requestedBy: string; status?: 1 }
  | { kind: 'delete'; a: string; b: string };

/**
 * The graph write that makes the pair (me, peer) read `state` from `me`'s
 * side, or null when either user has no accounts id.
 */
export function graphOpFor(meId: string, peerId: string, state: PeerState, previous: PeerState = 'none'): GraphOp | null {
  const a = accountsIdFromUserId(normalizeId(meId));
  const b = accountsIdFromUserId(normalizeId(peerId));
  if (!a || !b || a === b) return null;
  switch (state) {
    case 'none':
      return { kind: 'delete', a, b };
    case 'outgoing':
      return { kind: 'upsert', a, b, requestedBy: a };
    case 'incoming':
      return { kind: 'upsert', a, b, requestedBy: b };
    case 'friend':
      // requestedBy only matters when the row is created: whoever asked first.
      return { kind: 'upsert', a, b, requestedBy: previous === 'incoming' ? b : a, status: 1 };
  }
}

/**
 * What to mirror after a committed mutation changed `me`'s relation to the
 * peer from `before` to `after`. Null when nothing changed (or no accounts id).
 */
export function mirrorOp(meId: string, peerId: string, before: PeerState, after: PeerState): GraphOp | null {
  if (before === after) return null;
  return graphOpFor(meId, peerId, after, before);
}

export interface ReconcileStep {
  /** Set the local pair to this (from `me`'s side). */
  local?: PeerState;
  /** Write this to the graph (from `me`'s side). */
  graph?: PeerState;
  /** The state both sides agree on afterwards (the new base). */
  agreed: PeerState;
}

const isPending = (s: PeerState) => s === 'incoming' || s === 'outgoing';

/**
 * Three-way merge of one pair: `local` and `graph` are the two current views
 * from `me`'s side, `base` what they last agreed on ('none' when unknown).
 *
 *  - Equal: nothing to do.
 *  - Opposite pending requests (each side thinks the other asked): both asked,
 *    so they're friends everywhere, like the graph's own auto-accept.
 *  - Only the graph moved since the base: import it.
 *  - Only the local side moved: push it (a mirror that failed, or a pair from
 *    before mirroring existed).
 *  - Both moved: an existing relation beats "none" (a request or friendship
 *    made on either side is kept), and friend beats pending.
 */
export function reconcilePeer(local: PeerState, graph: PeerState, base: PeerState): ReconcileStep {
  if (local === graph) return { agreed: local };
  if (isPending(local) && isPending(graph)) return { local: 'friend', graph: 'friend', agreed: 'friend' };
  if (base === local) return { local: graph, agreed: graph };
  if (base === graph) return { graph: local, agreed: local };
  if (local === 'none') return { local: graph, agreed: graph };
  if (graph === 'none') return { graph: local, agreed: local };
  return { local: 'friend', graph: 'friend', agreed: 'friend' };
}

type Patch = { friends: string[]; pendingFriendRequests: { incoming: string[]; outgoing: string[] } };

/**
 * Row patches that make the pair read `state` from `me`'s side (and the
 * inverse from `peer`'s). Every other entry on both rows is kept.
 */
export function pairPatches(me: FriendRow, peer: FriendRow, state: PeerState): { me: Patch; peer: Patch } {
  const side = (row: FriendRow, otherId: string, s: PeerState): Patch => {
    const p = pending(row);
    return {
      friends: s === 'friend' ? addId(row.friends, otherId) : removeId(row.friends, otherId),
      pendingFriendRequests: {
        incoming: s === 'incoming' ? addId(p.incoming, otherId) : removeId(p.incoming, otherId),
        outgoing: s === 'outgoing' ? addId(p.outgoing, otherId) : removeId(p.outgoing, otherId),
      },
    };
  };
  return { me: side(me, peer.id, state), peer: side(peer, me.id, invertState(state)) };
}

/** Apply a `users` patch to a row copy (used to see a mutation's result before commit). */
export function applyFriendPatch<T extends FriendRow>(row: T, patch: Partial<FriendRow>): T {
  const next = { ...row };
  if ('friends' in patch) next.friends = patch.friends ?? null;
  if ('blockedUsers' in patch) next.blockedUsers = patch.blockedUsers ?? null;
  if ('pendingFriendRequests' in patch) next.pendingFriendRequests = patch.pendingFriendRequests;
  return next;
}

/** One deduplicated entry per unordered pair: `[low, high]` of normalized ids. */
export function pairKey(a: string, b: string): string {
  const [x, y] = [normalizeId(a), normalizeId(b)].sort();
  return `${x}|${y}`;
}

// ── Backfill ──────────────────────────────────────────────────────────────────

export interface BackfillRow extends FriendRow {
  isBot?: boolean | null;
  isSystem?: boolean | null;
}

export interface BackfillPlan {
  /** One entry per pair, state from `me`'s side. */
  pairs: Array<{ me: string; peer: string; state: Exclude<PeerState, 'none'> }>;
  skipped: { noAccountsId: number; missingPeer: number; botOrSystem: number; blocked: number; inconsistent: number };
}

/**
 * Every SerikaCord friendship / pending request that can go to the graph,
 * once per pair. A pair is only pushed when both rows agree on it (a
 * one-sided row left by an old race is reported, not guessed at).
 */
export function planBackfill(rows: readonly BackfillRow[]): BackfillPlan {
  const byId = new Map(rows.map((r) => [normalizeId(r.id), r]));
  const seen = new Set<string>();
  const plan: BackfillPlan = { pairs: [], skipped: { noAccountsId: 0, missingPeer: 0, botOrSystem: 0, blocked: 0, inconsistent: 0 } };
  for (const row of rows) {
    const me = normalizeId(row.id);
    for (const [peer, state] of localPeerStates(row)) {
      if (peer === me || state === 'none') continue;
      const key = pairKey(me, peer);
      if (seen.has(key)) continue;
      seen.add(key);
      if (!accountsIdFromUserId(me) || !accountsIdFromUserId(peer)) { plan.skipped.noAccountsId++; continue; }
      const other = byId.get(peer);
      if (!other) { plan.skipped.missingPeer++; continue; }
      if (row.isBot || row.isSystem || other.isBot || other.isSystem) { plan.skipped.botOrSystem++; continue; }
      if (eitherBlocked(row, other)) { plan.skipped.blocked++; continue; }
      if (localPeerState(other, me) !== invertState(state)) { plan.skipped.inconsistent++; continue; }
      plan.pairs.push({ me, peer, state });
    }
  }
  return plan;
}

/**
 * What the backfill does with one pair given the graph's current view (from
 * the same side). Never downgrades a graph friendship to a request.
 */
export function backfillAction(local: PeerState, graph: PeerState): 'in_sync' | 'graph_ahead' | 'push' {
  if (local === graph) return 'in_sync';
  if (graph === 'friend') return 'graph_ahead';
  return 'push';
}
