/**
 * Doodle Party backend (SerikaCord's built-in Activity, CORD-92). It is a
 * normal Activity backend that happens to run in this process: the app's URL
 * mapping points "/" at https://<FRONTEND>/api/activity-apps/doodle, so the
 * Activities proxy forwards the page, /token and the /ws WebSocket here.
 *
 *  GET  /api/activity-apps/doodle/          the page (client id baked in)
 *  GET  /api/activity-apps/doodle/app.js    the client bundle (Bun.build, cached)
 *  POST /api/activity-apps/doodle/token     OAuth2 code -> access token (the app's own secret)
 *  WS   /api/activity-apps/doodle/ws        the game; first message {t:'hello', token, instanceId}
 *
 * Rooms are per Activity instance, in this process (processShared). Players
 * prove who they are with the access token the SDK authenticated with, and
 * must be participants of that instance.
 */
import type { ServerWebSocket } from 'bun';
import { config } from '@/lib/config';
import { processShared } from '@/lib/realtime/processShared';
import { createRoom, draw, guess, join, leave, pick, recipients, start, tick, type Out, type Room } from './game';

export const DOODLE_BASE = '/api/activity-apps/doodle';
export const DOODLE_WS_PATH = `${DOODLE_BASE}/ws`;

/** The app that is Doodle Party (env DOODLE_ACTIVITY_APP_ID, an application UUID). */
export function doodleAppId(): string | null {
  const id = (process.env.DOODLE_ACTIVITY_APP_ID || '').trim().toLowerCase();
  return /^[0-9a-f-]{36}$/.test(id) ? id : null;
}

interface DoodleSocketState { userId: string | null; roomId: string | null; msgs: number; windowStart: number }
type WS = ServerWebSocket<{ doodle?: DoodleSocketState }>;

interface LiveRoom { room: Room; sockets: Map<string, Set<WS>>; emptySince: number | null; announced: boolean }

const rooms = processShared('doodle:rooms', () => new Map<string, LiveRoom>());
const rng = () => Math.random();

function send(ws: WS, msg: Record<string, unknown>) {
  try { ws.send(JSON.stringify(msg)); } catch { /* gone */ }
}

function deliver(live: LiveRoom, outs: Out[]) {
  // A finished game posts its results in the chat, once (like Wordle's status messages).
  if (live.room.phase === 'end' && !live.announced) { live.announced = true; void announceResults(live.room); }
  if (live.room.phase !== 'end') live.announced = false;
  for (const out of outs) {
    const text = JSON.stringify(out.msg);
    for (const id of recipients(live.room, out)) {
      for (const ws of live.sockets.get(id) ?? []) { try { ws.send(text); } catch { /* gone */ } }
    }
  }
}

processShared('doodle:ticker', () => {
  const t = setInterval(() => {
    const now = Date.now();
    for (const [id, live] of rooms) {
      if (live.sockets.size === 0) {
        live.emptySince ??= now;
        if (now - live.emptySince > 60_000) rooms.delete(id);
        continue;
      }
      live.emptySince = null;
      const outs = tick(live.room, now, rng);
      if (outs.length) deliver(live, outs);
    }
  }, 500);
  (t as { unref?: () => void }).unref?.();
  return t;
});

/**
 * The results message, from the app's bot in the chat the game was played in:
 * an ordinary bot message, the same thing any Activity can post through the
 * bot API (Wordle-style status messages).
 */
export function resultsText(players: Array<{ name: string; score: number }>): string {
  const ranked = [...players].sort((a, b) => b.score - a.score).slice(0, 8);
  const medals = ['👑', '🥈', '🥉'];
  const clean = (s: string) => s.replace(/[\\*_~`|>#@[\]()]/g, '').slice(0, 32) || 'Player';
  const lines = ranked.map((p, i) => `${medals[i] ?? `${i + 1}.`} **${clean(p.name)}**: ${p.score} points`);
  return ['🎨 **Doodle Party results**', ...lines].join('\n');
}

async function announceResults(room: Room): Promise<void> {
  try {
    if (room.players.length < 2) return;
    const appId = doodleAppId();
    const { getInstance } = await import('@/lib/services/activityInstances');
    const rec = await getInstance(room.id);
    if (!appId || !rec) return;
    const { Application, Channel } = await import('@/lib/models');
    const [app, channel] = await Promise.all([Application.findById(appId), Channel.findById(rec.location.channelId)]);
    if (!app?.botId || !channel) return;
    const { createAppMessage } = await import('@/lib/services/appMessages');
    await createAppMessage({
      author: { kind: 'bot', botId: app.botId, applicationId: app.id },
      channel,
      body: { content: resultsText(room.players), embeds: [], components: null, attachments: [], flags: 0, mentionedUserIds: [] },
    });
  } catch (err) {
    console.error('[doodle] results message failed:', (err as Error)?.message ?? err);
  }
}

// ─── Static page + bundle ───────────────────────────────────

let bundle: Promise<string> | null = null;

async function buildBundle(): Promise<string> {
  const entry = `${process.cwd()}/src/activity-apps/doodle/client.ts`;
  // The repo's Bun typings only declare serve(); build() is part of the runtime.
  type BuildResult = { success: boolean; outputs: Array<{ text(): Promise<string> }>; logs: unknown[] };
  const bun = Bun as unknown as { build(opts: { entrypoints: string[]; target: string; minify: boolean; format: string }): Promise<BuildResult> };
  const result = await bun.build({ entrypoints: [entry], target: 'browser', minify: true, format: 'esm' });
  if (!result.success || !result.outputs[0]) throw new Error(result.logs.map((l) => String(l)).join('\n').slice(0, 500) || 'build failed');
  return result.outputs[0].text();
}

export async function doodleBundle(): Promise<string> {
  if (!bundle) bundle = buildBundle().catch((err) => { bundle = null; throw err; });
  return bundle;
}

export function doodlePage(clientId: string): string {
  const cid = JSON.stringify(clientId);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover">
<title>Doodle Party</title>
<script>window.DOODLE_CLIENT_ID=${cid};</script>
</head><body><div id="app"></div><script type="module" src="./app.js"></script></body></html>`;
}

// ─── Token exchange ─────────────────────────────────────────

export async function exchangeDoodleCode(code: unknown): Promise<{ status: number; body: unknown }> {
  const appId = doodleAppId();
  if (!appId || typeof code !== 'string' || code.length > 200) return { status: 400, body: { error: 'invalid_request' } };
  const { Application } = await import('@/lib/models');
  const app = await Application.findById(appId);
  if (!app?.clientSecret) return { status: 503, body: { error: 'not_configured' } };
  const { handleTokenRequest } = await import('@/lib/services/oauth2Tokens');
  const { VALID_OAUTH_SCOPES } = await import('@/lib/api/developers');
  const r = await handleTokenRequest({ grant_type: 'authorization_code', code, client_id: app.clientId, client_secret: app.clientSecret }, null, VALID_OAUTH_SCOPES);
  const body = r.body as { access_token?: string; error?: string };
  return r.status === 200 && body.access_token ? { status: 200, body: { access_token: body.access_token } } : { status: r.status, body: { error: body.error ?? 'invalid_grant' } };
}

// ─── WebSocket ──────────────────────────────────────────────

type UpgradeServer = { upgrade: (req: Request, options?: { data?: { conn: null; compress: null; encoding: string; version: null; doodle: DoodleSocketState } }) => boolean };

export function upgradeDoodle(req: Request, server: UpgradeServer): Response | undefined {
  if (!doodleAppId()) return new Response('Not found', { status: 404 });
  const ok = server.upgrade(req, { data: { conn: null, compress: null, encoding: 'json', version: null, doodle: { userId: null, roomId: null, msgs: 0, windowStart: Date.now() } } });
  return ok ? undefined : new Response('Upgrade failed', { status: 426 });
}

async function hello(ws: WS, st: DoodleSocketState, msg: Record<string, unknown>) {
  const token = typeof msg.token === 'string' ? msg.token : '';
  const instanceId = typeof msg.instanceId === 'string' ? msg.instanceId : '';
  const appId = doodleAppId();
  const { resolveBearerToken } = await import('@/lib/services/oauth2Tokens');
  const grant = token ? await resolveBearerToken(token) : null;
  if (!appId || !grant || grant.applicationId.toLowerCase() !== appId) { send(ws, { t: 'error', code: 'auth' }); ws.close(4001, 'auth'); return; }
  const { getInstance, instanceParticipants } = await import('@/lib/services/activityInstances');
  const { isInstanceId } = await import('@/lib/activities/instances');
  const rec = isInstanceId(instanceId) ? await getInstance(instanceId) : null;
  const inIt = rec && !rec.endedAt && rec.applicationId.toLowerCase() === appId
    && (await instanceParticipants(rec.id)).some((u) => u.toLowerCase() === grant.userId.toLowerCase());
  if (!rec || !inIt) { send(ws, { t: 'error', code: 'not_in_instance' }); ws.close(4003, 'instance'); return; }
  const { User } = await import('@/lib/models');
  const user = await User.findById(grant.userId);
  if (!user) { ws.close(4001, 'auth'); return; }
  st.userId = user.id;
  st.roomId = rec.id;
  let live = rooms.get(rec.id);
  if (!live) { live = { room: createRoom(rec.id), sockets: new Map(), emptySince: null, announced: false }; rooms.set(rec.id, live); }
  const set = live.sockets.get(user.id) ?? new Set<WS>();
  set.add(ws);
  live.sockets.set(user.id, set);
  const { cdnImage } = await import('@/lib/utils');
  const avatar = user.avatar ? cdnImage(user.avatar) : null;
  deliver(live, join(live.room, { id: user.id, name: user.displayName || user.username, avatar }, Date.now()));
}

function rateOk(st: DoodleSocketState): boolean {
  const now = Date.now();
  if (now - st.windowStart > 1000) { st.windowStart = now; st.msgs = 0; }
  st.msgs += 1;
  return st.msgs <= 80;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = Record<string, any>;

/** Wrap the server's WebSocket handler: sockets upgraded by upgradeDoodle run the game. */
export function withDoodleSockets<H extends Handler>(base: H): H {
  return {
    ...base,
    open(ws: WS) {
      if (!ws.data.doodle) return base.open?.(ws);
    },
    message(ws: WS, raw: string | Buffer) {
      const st = ws.data.doodle;
      if (!st) return base.message?.(ws, raw);
      if (!rateOk(st)) return;
      const text = typeof raw === 'string' ? raw : raw.toString('utf8');
      if (text.length > 64_000) return;
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(text); } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'hello') { if (!st.userId) void hello(ws, st, msg); return; }
      if (!st.userId || !st.roomId) return;
      const live = rooms.get(st.roomId);
      if (!live) return;
      const now = Date.now();
      let outs: Out[] = [];
      switch (msg.t) {
        case 'start': outs = start(live.room, st.userId, { rounds: msg.rounds, drawTime: msg.drawTime }, now, rng); break;
        case 'pick': outs = pick(live.room, st.userId, msg.index, now); break;
        case 'draw': outs = draw(live.room, st.userId, { ops: msg.ops, begin: msg.begin, action: msg.action }); break;
        case 'guess': outs = guess(live.room, st.userId, msg.text, now, rng); break;
        case 'ping': send(ws, { t: 'pong', now }); return;
        default: return;
      }
      deliver(live, outs);
    },
    pong(ws: WS, data?: Buffer) {
      if (ws.data.doodle) return;
      return base.pong?.(ws, data);
    },
    close(ws: WS, code: number, reason: string) {
      const st = ws.data.doodle;
      if (!st) return base.close?.(ws, code, reason);
      if (!st.userId || !st.roomId) return;
      const live = rooms.get(st.roomId);
      if (!live) return;
      const set = live.sockets.get(st.userId);
      set?.delete(ws);
      if (set && set.size === 0) {
        live.sockets.delete(st.userId);
        deliver(live, leave(live.room, st.userId, Date.now(), rng));
      }
    },
  } as unknown as H;
}

/** Where the app's root URL mapping points (the production host serves the game). */
export function doodleMappingTarget(): string {
  const host = (process.env.DOODLE_ACTIVITY_HOST || '').trim() || (() => {
    try { return new URL(config.FRONTEND_URL || 'https://serika.chat').host; } catch { return 'serika.chat'; }
  })();
  return `${host}${DOODLE_BASE}`;
}
