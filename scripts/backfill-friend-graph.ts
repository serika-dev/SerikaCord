/**
 * One-off: push existing SerikaCord friendships and pending friend requests
 * to the Serika Accounts friend graph (/internal/graph/friends), so they show
 * up in SerikaTrack, Social and serika.dev. New changes are mirrored live by
 * mutateFriendPair; this covers everything from before that.
 *
 * Dry run by default (reads Postgres, and the graph unless --offline; writes
 * nothing). Writes only with --apply.
 *   bun scripts/backfill-friend-graph.ts                # plan, compare with the graph
 *   bun scripts/backfill-friend-graph.ts --offline      # plan from Postgres only
 *   bun scripts/backfill-friend-graph.ts --apply        # push to the graph
 *
 * Idempotent: pairs the graph already has are left alone, a graph friendship
 * is never downgraded to a request, and graph upserts/deletes are themselves
 * idempotent, so re-running only retries what failed.
 *
 * Skipped: users without an accounts id (local ids not derived from an
 * accounts ObjectId), bots and system users, blocked pairs, and pairs whose
 * two rows disagree. Postgres is only read (one SELECT).
 *
 * With --apply and REDIS_URL set, each pushed or already-matching pair is
 * also recorded as the merge base (friendgraph:base:<id>), so a request later
 * declined in another app is removed here instead of being pushed back.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import Redis from 'ioredis';
import {
  FRIEND_GRAPH_BASE_TTL_SECONDS,
  accountsIdFromUserId,
  backfillAction,
  friendGraphBaseKey,
  graphOpFor,
  graphPeerStates,
  invertState,
  planBackfill,
  type BackfillRow,
  type GraphOp,
  type PeerState,
} from '../src/lib/social/friendGraphSync';

const ROOT = path.resolve(import.meta.dirname, '..');
const env: Record<string, string> = { ...process.env } as Record<string, string>;
try {
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {
  /* no .env file — rely on process.env */
}

const APPLY = process.argv.includes('--apply');
const OFFLINE = process.argv.includes('--offline');
if (APPLY && OFFLINE) {
  console.error('--apply needs to read the graph first; drop --offline.');
  process.exit(1);
}

const ACCOUNTS_URL = (env.ACCOUNTS_URL || 'https://accounts.serika.dev').replace(/\/+$/, '');
const SERVICE_KEY = env.AUTH_INTERNAL_KEY || env.AUTH_SERVICE_INTERNAL_KEY || '';
const CONCURRENCY = 4;

async function graphCall(method: 'GET' | 'POST' | 'DELETE', urlPath: string, body?: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch(`${ACCOUNTS_URL}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-service-key': SERVICE_KEY },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok && !data.error, status: res.status, data };
}

function runOp(op: GraphOp) {
  return op.kind === 'delete'
    ? graphCall('DELETE', '/internal/graph/friends', { a: op.a, b: op.b })
    : graphCall('POST', '/internal/graph/friends', { a: op.a, b: op.b, requestedBy: op.requestedBy, ...(op.status ? { status: op.status } : {}) });
}

async function pool<T>(items: T[], fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

async function main() {
  if (!env.POSTGRES_URI) throw new Error('POSTGRES_URI is not set');
  if (!OFFLINE && !SERVICE_KEY) throw new Error('AUTH_INTERNAL_KEY is not set (needed to read the graph); use --offline for a Postgres-only plan');

  const client = new Client({ connectionString: env.POSTGRES_URI });
  await client.connect();
  let rows: BackfillRow[];
  try {
    const res = await client.query(`
      SELECT id, friends, blocked_users, pending_friend_requests, is_bot, is_system
      FROM users
      WHERE coalesce(cardinality(friends), 0) > 0
         OR jsonb_array_length(coalesce(pending_friend_requests->'incoming', '[]'::jsonb)) > 0
         OR jsonb_array_length(coalesce(pending_friend_requests->'outgoing', '[]'::jsonb)) > 0`);
    rows = res.rows.map((r) => ({
      id: r.id,
      friends: r.friends ?? [],
      blockedUsers: r.blocked_users ?? [],
      pendingFriendRequests: r.pending_friend_requests ?? {},
      isBot: r.is_bot,
      isSystem: r.is_system,
    }));
  } finally {
    await client.end();
  }

  // Peers referenced by these rows but without friends/pending of their own
  // (e.g. only blocked lists) are not in the result; that only happens for
  // one-sided rows, which the planner reports as inconsistent/missing.
  const plan = planBackfill(rows);
  const counts = { friend: 0, outgoing: 0, incoming: 0 };
  for (const p of plan.pairs) counts[p.state]++;
  console.log(`${rows.length} users with friends/requests; ${plan.pairs.length} pairs to sync (${counts.friend} friendships, ${counts.outgoing + counts.incoming} pending requests)`);
  console.log('skipped:', plan.skipped);

  if (OFFLINE) {
    console.log('\n--offline: graph not read, nothing written.');
    return;
  }

  // One graph read per user that starts a pair.
  const graphByUser = new Map<string, Map<string, PeerState>>();
  const owners = [...new Set(plan.pairs.map((p) => p.me))];
  let readFailures = 0;
  await pool(owners, async (me) => {
    const accountsId = accountsIdFromUserId(me)!;
    try {
      const res = await graphCall('GET', `/internal/graph/friends/${accountsId}`);
      if (res.ok) graphByUser.set(me, graphPeerStates(res.data as never));
      else readFailures++;
    } catch {
      readFailures++;
    }
  });

  const tally = { in_sync: 0, graph_ahead: 0, push: 0, unread: 0 };
  const toPush: Array<{ me: string; peer: string; state: PeerState; graph: PeerState }> = [];
  const agreed: Array<{ me: string; peer: string; state: PeerState }> = [];
  for (const p of plan.pairs) {
    const graph = graphByUser.get(p.me);
    if (!graph) { tally.unread++; continue; }
    const g = graph.get(p.peer) ?? 'none';
    const action = backfillAction(p.state, g);
    tally[action]++;
    if (action === 'push') toPush.push({ ...p, graph: g });
    else if (action === 'in_sync') agreed.push(p);
  }
  console.log(`graph reads failed for ${readFailures} users`);
  console.log('against the graph:', tally, '(graph_ahead = graph already has them as friends; left for the live merge to import)');

  if (!APPLY) {
    for (const p of toPush.slice(0, 20)) console.log(`  would push ${p.me} → ${p.peer}: ${p.state} (graph: ${p.graph})`);
    if (toPush.length > 20) console.log(`  … and ${toPush.length - 20} more`);
    console.log('\nDry run: nothing written. Re-run with --apply to push.');
    return;
  }

  let pushed = 0;
  let failed = 0;
  await pool(toPush, async (p) => {
    const op = graphOpFor(p.me, p.peer, p.state);
    if (!op) return;
    try {
      const res = await runOp(op);
      if (res.ok) { pushed++; agreed.push(p); }
      else { failed++; console.warn(`  failed ${op.a}/${op.b}: ${res.status} ${String(res.data.error ?? '')}`); }
    } catch (error) {
      failed++;
      console.warn(`  failed ${op.a}/${op.b}:`, error instanceof Error ? error.message : error);
    }
  });
  console.log(`pushed ${pushed}, failed ${failed} (re-run to retry failures)`);

  if (env.REDIS_URL && agreed.length) {
    const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });
    try {
      for (let i = 0; i < agreed.length; i += 200) {
        const tx = redis.multi();
        for (const p of agreed.slice(i, i + 200)) {
          for (const [owner, other, s] of [[p.me, p.peer, p.state], [p.peer, p.me, invertState(p.state)]] as const) {
            tx.hset(friendGraphBaseKey(owner), other, s).expire(friendGraphBaseKey(owner), FRIEND_GRAPH_BASE_TTL_SECONDS);
          }
        }
        await tx.exec();
      }
      console.log(`recorded ${agreed.length} pairs as the merge base`);
    } finally {
      redis.disconnect();
    }
  } else if (!env.REDIS_URL) {
    console.log('REDIS_URL not set: merge base not recorded (the live merge fills it in on next read).');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
