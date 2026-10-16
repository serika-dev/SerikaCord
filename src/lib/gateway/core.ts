/**
 * Transport-agnostic Discord Gateway v10 core.
 *
 * The same protocol logic drives every transport (server.ts, the optional
 * standalone scripts/gateway.ts and the bot-compat harness), all through
 * ./bunTransport.ts. A "connection" is anything that can send text (and,
 * for zlib-stream, binary) and be closed.
 *
 * Protocol (Discord v10): HELLO -> IDENTIFY -> READY + one GUILD_CREATE per
 * guild; HEARTBEAT/ACK; RESUME with a per-session replay buffer; op 3
 * presence (PRESENCE_UPDATE to bots with GUILD_PRESENCES); op 4 voice
 * (VOICE_SERVER_UPDATE endpoint null); op 8 -> GUILD_MEMBERS_CHUNK; op 31
 * soundboard (empty); op 7 RECONNECT on shutdown; Discord close codes
 * (./session.ts). Ids: payloads are built with internal UUIDs and translated
 * per connection for snowflake-format apps (src/lib/botapi/boundary.ts).
 */
import { User, ServerMember, Channel } from '@/lib/models';
import { GATEWAY_CHANNEL, type GatewayDispatch } from '@/lib/services/gatewayEvents';
import { config } from '@/lib/config';
import { allowedPrivilegedIntents, disallowedIntents, intentApplicationFlags, CLOSE_DISALLOWED_INTENTS, INTENT } from './intents';
import { messagePayloadFor, routeDecision } from './routing';
import {
  CLOSE, MAX_GUILDS_PER_SHARD, countPayload, framesAfter, newReplayBuffer, parseIdentify, presenceStatus,
  pushReplay, shardOfSnowflake, shardOfUuid, type RateWindow, type ReplayBuffer,
} from './session';
import { ZlibStreamCompressor, type GatewayCompression } from './compression';
import type { OutboundLookup } from '@/lib/botapi/idTranslate';

export const OP = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  PRESENCE_UPDATE: 3,
  VOICE_STATE_UPDATE: 4,
  RESUME: 6,
  RECONNECT: 7,
  REQUEST_GUILD_MEMBERS: 8,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
  REQUEST_SOUNDBOARD_SOUNDS: 31,
} as const;

export const HEARTBEAT_INTERVAL = 41250;

/**
 * How long we wait for a client heartbeat (OP 1) before treating the connection
 * as a zombie and closing it. Discord uses ~1.5x the interval; we allow a little
 * extra slack for slow networks. A client that misses this window gets a clean
 * 4009 close so it can RESUME/reconnect instead of hanging until TCP times out.
 */
export const HEARTBEAT_TIMEOUT = Math.ceil(HEARTBEAT_INTERVAL * 1.5);

/**
 * Cadence for the transport-level keepalive sweep. Each tick sends a WebSocket
 * PING (so proxies like Cloudflare/Traefik keep the connection open) and closes
 * any connection that hasn't heartbeated within HEARTBEAT_TIMEOUT.
 */
export const KEEPALIVE_SWEEP_INTERVAL = 15_000;

/** True if the connection has gone silent past the heartbeat timeout. */
export function isHeartbeatExpired(conn: Conn, now = Date.now()): boolean {
  return now - conn.data.lastHeartbeat > HEARTBEAT_TIMEOUT;
}

export type IdFormat = 'uuid' | 'snowflake';

export interface Session {
  authenticated: boolean;
  sessionId: string;
  botId: string | null;
  applicationId: string | null;
  intents: number;
  guildIds: Set<string>;
  dmChannelIds: Set<string>;
  seq: number;
  lastHeartbeat: number;
  /** Id format of the app's bot (snowflake apps get translated payloads). */
  idFormat: IdFormat;
  shard: [number, number] | null;
  largeThreshold: number;
  /** False while READY + GUILD_CREATEs are being sent; dispatches queue in `pending`. */
  ready: boolean;
  pending: Array<{ t: string; d: unknown }>;
  replay: ReplayBuffer;
  presence: { status: string; activities: unknown[]; since: number | null; afk: boolean } | null;
  /** Transport options from the connect URL. */
  compress: GatewayCompression;
  encoding: string;
  version: string | null;
  rate: RateWindow;
  /** Per-session dispatch ordering (a slow id lookup only delays this session). */
  chain?: Promise<void>;
  /** Op 8 requests are handled one at a time per session. */
  opChain?: Promise<void>;
  /** Last full member-list op 8 per guild (ms), for the 30 s throttle. */
  memberListAt?: Map<string, number>;
  /** Op 3 set a custom status (activity type 4) this session (cleared on last disconnect). */
  customStatusSet?: boolean;
  /** When the bot's activity rows were last extended (ms). */
  activityRefreshAt?: number;
}

export interface Conn {
  data: Session;
  sendText(text: string): void;
  /** Binary frames (needed for zlib-stream). */
  sendBinary?(data: Uint8Array): void;
  close(code: number, reason: string): void;
}

export function newSession(opts?: { compress?: GatewayCompression; encoding?: string; version?: string | null }): Session {
  return {
    authenticated: false,
    sessionId:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID().replace(/-/g, '')
        : Math.random().toString(36).slice(2),
    botId: null,
    applicationId: null,
    intents: 0,
    guildIds: new Set<string>(),
    dmChannelIds: new Set<string>(),
    seq: 0,
    lastHeartbeat: Date.now(),
    idFormat: 'uuid',
    shard: null,
    largeThreshold: 50,
    ready: false,
    pending: [],
    replay: newReplayBuffer(),
    presence: null,
    compress: opts?.compress ?? null,
    encoding: opts?.encoding ?? 'json',
    version: opts?.version ?? null,
    rate: { start: Date.now(), count: 0 },
  };
}

/** Verbose per-connection gateway logging (set GATEWAY_DEBUG=1). */
const GATEWAY_DEBUG =
  typeof process !== 'undefined' &&
  (process.env?.GATEWAY_DEBUG === '1' || process.env?.GATEWAY_DEBUG === 'true');

function gwlog(...args: unknown[]) {
  if (GATEWAY_DEBUG) console.log('[gateway]', ...args);
}

/** How long a closed session can be resumed (its state and replay buffer are kept). */
const RESUME_WINDOW_MS = 5 * 60_000;
const MAX_DETACHED = 2_000;
/** Resumable sessions kept per bot, and live + resumable sessions per bot. */
export const MAX_DETACHED_PER_BOT = 8;
export const MAX_SESSIONS_PER_BOT = 16;
/** A socket that has not identified (or resumed) by then is closed. */
export const IDENTIFY_TIMEOUT_MS = 20_000;
/** Id lookups for one dispatch may take this long before cached ids are used. */
const DISPATCH_LOOKUP_TIMEOUT_MS = 2_000;
/** Ids per op 8 / op 31 request. */
export const MAX_REQUEST_IDS = 100;
/** One full member list per guild per session in this window (else RATE_LIMITED). */
export const MEMBER_LIST_INTERVAL_MS = 30_000;

export type IdentifyLimit = 'ok' | 'too_fast' | 'daily';

/** Discord's identify budget per bot: 1 per 5 s (max_concurrency 1) and 1000 per day (Redis). */
async function defaultIdentifyLimiter(botId: string): Promise<IdentifyLimit> {
  const { checkRateLimit } = await import('@/lib/security');
  const fast = await checkRateLimit('gatewayIdentify', botId);
  if (!fast.success) return 'too_fast';
  const daily = await checkRateLimit('gatewayIdentifyDaily', botId);
  return daily.success ? 'ok' : 'daily';
}

async function toSnowflakes<T>(payload: T): Promise<T> {
  const { toSnowflakes: translate } = await import('@/lib/botapi/boundary');
  return translate(payload);
}

/** Registry of authenticated connections + Redis fan-out. */
export class GatewayHub {
  readonly connections = new Set<Conn>();
  /** Closed sessions that may RESUME: sessionId -> session (still buffering dispatches). */
  private readonly detached = new Map<string, { session: Session; expiresAt: number }>();
  private readonly compressors = new WeakMap<Conn, ZlibStreamCompressor>();
  private readonly identifyTimers = new WeakMap<Conn, ReturnType<typeof setTimeout>>();
  /** The live socket of a session (none while detached). */
  private readonly sessionConn = new WeakMap<Session, Conn>();
  private shuttingDown = false;
  /** Write bot presence to the users table (off in unit tests: no DB). */
  private readonly persistPresence: boolean;
  private readonly identifyLimiter: (botId: string) => Promise<IdentifyLimit>;
  private readonly identifyTimeoutMs: number;

  constructor(opts?: {
    persistPresence?: boolean;
    identifyLimiter?: (botId: string) => Promise<IdentifyLimit>;
    identifyTimeoutMs?: number;
  }) {
    this.persistPresence = opts?.persistPresence ?? true;
    this.identifyLimiter = opts?.identifyLimiter ?? defaultIdentifyLimiter;
    this.identifyTimeoutMs = opts?.identifyTimeoutMs ?? IDENTIFY_TIMEOUT_MS;
  }

  /** Run `fn` after everything queued for this session (keeps its events in order). */
  private enqueue(session: Session, fn: () => Promise<void> | void): Promise<void> {
    const next = (session.chain ?? Promise.resolve()).then(fn).catch((err) => {
      console.error('Gateway: dispatch failed', (err as Error)?.message ?? err);
    });
    session.chain = next;
    return next;
  }

  /** Register an authenticated connection as its session's live socket. */
  adopt(conn: Conn) {
    this.sessionConn.set(conn.data, conn);
    this.connections.add(conn);
  }

  private clearIdentifyTimer(conn: Conn) {
    const t = this.identifyTimers.get(conn);
    if (t) { clearTimeout(t); this.identifyTimers.delete(conn); }
  }

  // ─── Frames ──────────────────────────────────────────────

  private write(conn: Conn, text: string) {
    try {
      const z = this.compressors.get(conn);
      if (z) z.send(text);
      else conn.sendText(text);
    } catch {
      /* socket closing */
    }
  }

  /** Send a non-dispatch frame (HELLO, ACK, op 7, op 9). */
  send(conn: Conn, op: number, d: unknown) {
    this.write(conn, JSON.stringify({ op, d, s: null, t: null }));
  }

  /** Send (or, for a detached session, only buffer) one dispatch with the next seq. */
  private emit(session: Session, conn: Conn | null, t: string, dJson: string) {
    const s = ++session.seq;
    const text = `{"op":${OP.DISPATCH},"d":${dJson},"s":${s},"t":${JSON.stringify(t)}}`;
    pushReplay(session.replay, s, text);
    if (conn) this.write(conn, text);
  }

  /** Dispatch `d` (internal UUID ids) to one connection, translated for its id format. */
  private async dispatchTo(conn: Conn, t: string, d: unknown) {
    const out = conn.data.idFormat === 'snowflake' ? await toSnowflakes(d) : d;
    this.emit(conn.data, conn, t, JSON.stringify(out));
  }

  hello(conn: Conn) {
    conn.data.lastHeartbeat = Date.now();
    // Sockets that never identify are closed (the zlib context below can't be
    // deferred: HELLO itself must be compressed).
    const timer = setTimeout(() => {
      if (!conn.data.authenticated) conn.close(CLOSE.SESSION_TIMED_OUT, 'Session timed out');
    }, this.identifyTimeoutMs);
    (timer as { unref?: () => void }).unref?.();
    this.identifyTimers.set(conn, timer);
    if (conn.data.compress === 'zlib-stream' && conn.sendBinary) {
      const sendBinary = conn.sendBinary.bind(conn);
      this.compressors.set(conn, new ZlibStreamCompressor(sendBinary));
    }
    this.send(conn, OP.HELLO, { heartbeat_interval: HEARTBEAT_INTERVAL, _trace: ['["serika-gateway",{"micros":0}]'] });
    if (conn.data.encoding !== 'json') {
      conn.close(CLOSE.DECODE_ERROR, 'Unsupported encoding (use encoding=json)');
      return;
    }
    if (conn.data.version !== null && conn.data.version !== '' && conn.data.version !== '10' && conn.data.version !== '9') {
      conn.close(CLOSE.INVALID_API_VERSION, 'Invalid API version');
    }
  }

  async onFrame(conn: Conn, raw: string | Uint8Array) {
    if (!countPayload(conn.data.rate)) {
      conn.close(CLOSE.RATE_LIMITED, 'Rate limited.');
      return;
    }
    let frame: { op?: number; d?: unknown };
    try {
      frame = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      conn.close(CLOSE.DECODE_ERROR, 'Decode error');
      return;
    }
    if (!frame || typeof frame !== 'object') {
      conn.close(CLOSE.DECODE_ERROR, 'Decode error');
      return;
    }
    const op = frame.op;
    switch (op) {
      case OP.HEARTBEAT:
        conn.data.lastHeartbeat = Date.now();
        this.send(conn, OP.HEARTBEAT_ACK, null);
        gwlog(conn.data.sessionId.slice(0, 8), 'heartbeat', conn.data.botId ?? '(unauth)');
        // Keep the bot's presence fresh so it doesn't go stale/offline.
        if (conn.data.botId) {
          void this.setBotPresence(conn.data.botId, true, conn.data.presence?.status);
          this.refreshActivities(conn.data);
        }
        return;
      case OP.IDENTIFY:
        if (conn.data.authenticated) { conn.close(CLOSE.ALREADY_AUTHENTICATED, 'Already authenticated.'); return; }
        try {
          await this.identify(conn, frame.d);
        } catch (err) {
          console.error('Gateway: identify failed', err);
          conn.close(CLOSE.UNKNOWN_ERROR, 'Unknown error');
        }
        return;
      case OP.RESUME:
        if (conn.data.authenticated) { conn.close(CLOSE.ALREADY_AUTHENTICATED, 'Already authenticated.'); return; }
        try {
          await this.resume(conn, (frame.d ?? {}) as Record<string, unknown>);
        } catch (err) {
          console.error('Gateway: resume failed', err);
          conn.close(CLOSE.UNKNOWN_ERROR, 'Unknown error');
        }
        return;
      case OP.PRESENCE_UPDATE:
      case OP.VOICE_STATE_UPDATE:
      case OP.REQUEST_GUILD_MEMBERS:
      case OP.REQUEST_SOUNDBOARD_SOUNDS:
        break;
      default:
        conn.close(CLOSE.UNKNOWN_OPCODE, 'Unknown opcode.');
        return;
    }
    if (!conn.data.authenticated) { conn.close(CLOSE.NOT_AUTHENTICATED, 'Not authenticated.'); return; }
    try {
      if (op === OP.PRESENCE_UPDATE) this.updatePresence(conn, frame.d);
      else if (op === OP.REQUEST_GUILD_MEMBERS) {
        // One op 8 at a time per session.
        const d = (frame.d ?? {}) as Record<string, unknown>;
        const run = (conn.data.opChain ?? Promise.resolve()).then(() => this.requestGuildMembers(conn, d)).catch((err) => {
          console.error('Gateway: op 8 failed', err);
        });
        conn.data.opChain = run;
        await run;
      }
      else if (op === OP.REQUEST_SOUNDBOARD_SOUNDS) await this.requestSoundboardSounds(conn, (frame.d ?? {}) as Record<string, unknown>);
      // Op 4: bots can't carry voice media yet (WP7). Answer like Discord with
      // the bot's voice state and VOICE_SERVER_UPDATE endpoint null ("no
      // voice server available"), so library joins stop instead of hanging.
      else if (op === OP.VOICE_STATE_UPDATE) await this.voiceStateRequest(conn, (frame.d ?? {}) as Record<string, unknown>);
    } catch (err) {
      console.error(`Gateway: op ${op} failed`, err);
    }
  }

  onClose(conn: Conn) {
    this.clearIdentifyTimer(conn);
    this.connections.delete(conn);
    if (this.sessionConn.get(conn.data) === conn) this.sessionConn.delete(conn.data);
    this.compressors.get(conn)?.close();
    this.compressors.delete(conn);
    if (conn.data.authenticated && conn.data.botId && !this.shuttingDown) {
      const now = Date.now();
      for (const [id, r] of this.detached) if (r.expiresAt < now) this.detached.delete(id);
      if (this.detached.size < MAX_DETACHED) {
        conn.data.ready = true;
        conn.data.pending = [];
        this.detached.set(conn.data.sessionId, { session: conn.data, expiresAt: now + RESUME_WINDOW_MS });
        this.trimDetached(conn.data.botId, MAX_DETACHED_PER_BOT);
      }
    }
    // Mark the bot offline when its last connection drops. If the same bot has
    // another live connection, leave it online.
    const botId = conn.data.botId;
    if (botId && !this.botHasOtherConnection(conn, botId)) {
      void this.setBotPresence(botId, false);
      void this.publishBotOffline(botId, conn.data.customStatusSet === true);
    }
  }

  /**
   * Shutdown/deploy: tell every bot to reconnect (op 7) so it resumes or
   * re-identifies against the next instance, then close the sockets.
   */
  reconnectAll(closeDelayMs = 1000) {
    this.shuttingDown = true;
    const conns = [...this.connections];
    for (const conn of conns) this.send(conn, OP.RECONNECT, null);
    const t = setTimeout(() => {
      for (const conn of conns) {
        try { conn.close(CLOSE.UNKNOWN_ERROR, 'Reconnect'); } catch { /* closed */ }
      }
    }, closeDelayMs);
    (t as { unref?: () => void }).unref?.();
    return conns.length;
  }

  /** Drop a bot's oldest resumable sessions beyond `keep`. */
  private trimDetached(botId: string, keep: number) {
    const mine = [...this.detached.entries()].filter(([, e]) => e.session.botId === botId);
    mine.sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    for (let i = 0; i < mine.length - keep; i++) this.detached.delete(mine[i][0]);
  }

  /** Live + resumable sessions of a bot. */
  sessionCount(botId: string): { live: number; detached: number } {
    let live = 0;
    let detached = 0;
    for (const c of this.connections) if (c.data.botId === botId) live++;
    for (const e of this.detached.values()) if (e.session.botId === botId) detached++;
    return { live, detached };
  }

  private botHasOtherConnection(except: Conn, botId: string): boolean {
    for (const c of this.connections) {
      if (c !== except && c.data.botId === botId) return true;
    }
    return false;
  }

  /**
   * Reflect a bot's gateway connection state into its presence so it shows as
   * online in member lists (a user is "online" only while status is online AND
   * presenceLastHeartbeatAt is fresh). Refreshed on every heartbeat. Best-effort.
   */
  private async setBotPresence(botId: string, online: boolean, status?: string | null) {
    if (!this.persistPresence) return;
    try {
      const s = presenceStatus(status) ?? 'online';
      await User.updateById(
        botId,
        online
          ? { status: s, presenceLastHeartbeatAt: new Date(), presenceLastDisconnectAt: null }
          : { status: 'offline', presenceLastDisconnectAt: new Date() },
      );
    } catch (err) {
      gwlog('presence update failed for', botId, (err as Error)?.message);
    }
  }

  /** Op 3 (and IDENTIFY `presence`): store the bot's status/activities. */
  private updatePresence(conn: Conn, d: unknown) {
    const p = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>;
    const status = presenceStatus(p.status) ?? 'online';
    const activities = Array.isArray(p.activities) ? p.activities.slice(0, 5) : [];
    const prev = conn.data.presence;
    conn.data.presence = { status, activities, since: typeof p.since === 'number' ? p.since : null, afk: p.afk === true };
    if (conn.data.botId) {
      void this.setBotPresence(conn.data.botId, true, status);
      void this.publishBotPresence(conn.data, prev);
    }
  }

  /**
   * A bot's presence changed: show its activities in the web UI (rich
   * presence rows, custom status) and send PRESENCE_UPDATE to bots with
   * GUILD_PRESENCES in shared guilds (src/lib/services/botPresence.ts).
   */
  private async publishBotPresence(session: Session, prev: Session['presence']) {
    const botId = session.botId;
    const p = session.presence;
    if (!this.persistPresence || !botId || !p) return;
    const same = prev && prev.status === p.status && JSON.stringify(prev.activities) === JSON.stringify(p.activities);
    if (same) return;
    try {
      const { setBotActivities, customStatusOf, sanitizeActivities } = await import('@/lib/services/botPresence');
      const visible = p.status !== 'invisible';
      const custom = visible ? customStatusOf(p.activities) : null;
      const prevCustom = prev && prev.status !== 'invisible' ? customStatusOf(prev.activities) : null;
      await setBotActivities(botId, visible ? p.activities : [], { customStatusChanged: custom !== prevCustom || (!prev && session.customStatusSet === true) });
      if (custom) session.customStatusSet = true;
      session.activityRefreshAt = Date.now();
      const { emitPresenceUpdate } = await import('@/lib/services/gatewayEvents');
      await emitPresenceUpdate(botId, { status: visible ? p.status : 'offline', activities: visible ? sanitizeActivities(p.activities) : [] });
    } catch (err) {
      gwlog('presence publish failed for', botId, (err as Error)?.message);
    }
  }

  /** Extend the bot's activity rows every few minutes while it heartbeats. */
  private refreshActivities(session: Session) {
    if (!this.persistPresence || !session.botId || !session.presence?.activities.length) return;
    const now = Date.now();
    if (session.activityRefreshAt && now - session.activityRefreshAt < 4 * 60_000) return;
    session.activityRefreshAt = now;
    const botId = session.botId;
    void import('@/lib/services/botPresence')
      .then(({ refreshBotActivities }) => refreshBotActivities(botId))
      .catch(() => {});
  }

  /** The bot's last connection closed: offline everywhere, activities cleared. */
  private async publishBotOffline(botId: string, customStatus: boolean) {
    if (!this.persistPresence) return;
    try {
      const { clearBotActivities } = await import('@/lib/services/botPresence');
      await clearBotActivities(botId, { customStatus });
      const { emitPresenceUpdate } = await import('@/lib/services/gatewayEvents');
      await emitPresenceUpdate(botId, { status: 'offline', activities: [] });
    } catch (err) {
      gwlog('offline presence failed for', botId, (err as Error)?.message);
    }
  }

  // ─── IDENTIFY / READY ────────────────────────────────────

  private async loadApp(token: string) {
    const { resolveBotToken } = await import('@/lib/services/botTokens');
    return resolveBotToken(token);
  }

  /** Guild shard for a session (Discord formula on the guild's public id). */
  private async guildInShard(session: Session, guildId: string): Promise<boolean> {
    const shard = session.shard;
    if (!shard || shard[1] <= 1) return true;
    if (session.idFormat !== 'snowflake') return shardOfUuid(guildId, shard[1]) === shard[0];
    const { snowflakesForUuids } = await import('@/lib/botapi/snowflakeStore');
    const { map } = await snowflakesForUuids([guildId]);
    const sf = map.get(guildId.toLowerCase());
    return sf ? shardOfSnowflake(sf, shard[1]) === shard[0] : shard[0] === 0;
  }

  private async identify(conn: Conn, d: unknown) {
    const parsed = parseIdentify(d);
    if (!parsed.ok) {
      gwlog(conn.data.sessionId.slice(0, 8), 'identify rejected:', parsed.reason);
      if (parsed.close === CLOSE.AUTHENTICATION_FAILED) this.send(conn, OP.INVALID_SESSION, false);
      conn.close(parsed.close, parsed.reason);
      return;
    }
    const { token, intents, shard } = parsed.value;

    const app = await this.loadApp(token);
    if (!app || !app.botId) {
      gwlog(conn.data.sessionId.slice(0, 8), 'identify rejected: unknown token');
      conn.close(CLOSE.AUTHENTICATION_FAILED, 'Authentication failed');
      return;
    }

    // Privileged intents (GUILD_MEMBERS, GUILD_PRESENCES, MESSAGE_CONTENT) must
    // be enabled for the app in the Developer Portal, like Discord (close 4014).
    const allowedPrivileged = allowedPrivilegedIntents(app);
    if (disallowedIntents(intents, allowedPrivileged) !== 0) {
      gwlog(conn.data.sessionId.slice(0, 8), 'identify rejected: disallowed intents', intents);
      conn.close(CLOSE_DISALLOWED_INTENTS, 'Disallowed intent(s)');
      return;
    }

    // Session budget: at most MAX_SESSIONS_PER_BOT live + resumable sessions.
    const counts = this.sessionCount(app.botId);
    if (counts.live >= MAX_SESSIONS_PER_BOT) {
      conn.close(CLOSE.RATE_LIMITED, 'Too many sessions.');
      return;
    }
    if (counts.live + counts.detached >= MAX_SESSIONS_PER_BOT) this.trimDetached(app.botId, Math.max(0, MAX_SESSIONS_PER_BOT - counts.live - 1));
    // Discord's identify limits: one per 5 s per bot (op 9, the client retries)
    // and 1000 per day (close).
    const limit = await this.identifyLimiter(app.botId);
    if (limit === 'too_fast') { this.send(conn, OP.INVALID_SESSION, false); return; }
    if (limit === 'daily') { conn.close(CLOSE.RATE_LIMITED, 'Daily identify limit reached.'); return; }

    // Fetch bot user, memberships, and DM channels in parallel
    const [botUser, memberships, dmChannels] = await Promise.all([
      User.findById(app.botId),
      ServerMember.find({ userId: app.botId }),
      Channel.find({ type: { in: ['dm', 'group_dm'] }, recipientId: app.botId }),
    ]);
    if (!botUser) {
      conn.close(CLOSE.AUTHENTICATION_FAILED, 'Authentication failed');
      return;
    }
    const allGuildIds = memberships.map((m: { serverId: string }) => m.serverId);
    if ((!shard || shard[1] === 1) && allGuildIds.length > MAX_GUILDS_PER_SHARD) {
      conn.close(CLOSE.SHARDING_REQUIRED, 'Sharding required.');
      return;
    }

    const { idFormatOf } = await import('@/lib/botapi/boundary');
    const { clampLargeThreshold } = await import('./guildPayload');
    conn.data.botId = app.botId;
    conn.data.applicationId = app.id;
    conn.data.intents = intents;
    conn.data.idFormat = idFormatOf(app);
    conn.data.shard = shard;
    conn.data.largeThreshold = clampLargeThreshold(parsed.value.largeThreshold);
    conn.data.dmChannelIds = new Set(dmChannels.map((c: { id: string }) => c.id));
    const inShard = await Promise.all(allGuildIds.map((g) => this.guildInShard(conn.data, g)));
    const guildIds = allGuildIds.filter((_, i) => inShard[i]);
    conn.data.guildIds = new Set(guildIds);
    conn.data.lastHeartbeat = Date.now();
    conn.data.ready = false;
    conn.data.pending = [];
    if (parsed.value.presence) this.updatePresence(conn, parsed.value.presence);
    // Registered now so dispatches published while READY is built queue up.
    conn.data.authenticated = true;
    this.clearIdentifyTimer(conn);
    this.adopt(conn);
    gwlog(conn.data.sessionId.slice(0, 8), `READY bot=${app.botId} guilds=${guildIds.length} dms=${conn.data.dmChannelIds.size} format=${conn.data.idFormat}`);

    // Reflect the connection into presence so the bot shows online.
    void this.setBotPresence(app.botId, true, conn.data.presence?.status);
    if (!parsed.value.presence && !this.botHasOtherConnection(conn, app.botId)) {
      conn.data.presence = { status: 'online', activities: [], since: null, afk: false };
      void this.publishBotPresence(conn.data, null);
    }

    const user = {
      id: botUser.id,
      username: botUser.username,
      discriminator: '0',
      global_name: botUser.displayName || null,
      avatar: botUser.avatar ?? null,
      banner: botUser.banner ?? null,
      accent_color: null,
      bot: true,
      system: false,
      verified: true,
      mfa_enabled: false,
      email: null,
      flags: 0,
      public_flags: 0,
      premium_type: 0,
      locale: 'en-US',
      avatar_decoration_data: null,
    };
    await this.dispatchTo(conn, 'READY', {
      v: 10,
      user,
      user_settings: {},
      guilds: guildIds.map((id) => ({ id, unavailable: true })),
      relationships: [],
      private_channels: [],
      presences: [],
      guild_join_requests: [],
      geo_ordered_rtc_regions: [],
      session_id: conn.data.sessionId,
      session_type: 'normal',
      resume_gateway_url: config.GATEWAY_URL,
      ...(shard ? { shard } : {}),
      application: { id: app.id, flags: (app.flags ?? 0) | intentApplicationFlags(allowedPrivileged) },
      auth: {},
      _trace: ['["serika-gateway",{"micros":0}]'],
    });

    // One GUILD_CREATE per guild, built a few at a time, sent in order.
    const { buildGuildCreate } = await import('./guildPayload');
    const BATCH = 4;
    for (let i = 0; i < guildIds.length; i += BATCH) {
      const batch = guildIds.slice(i, i + BATCH);
      const payloads = await Promise.all(batch.map((g) =>
        buildGuildCreate(g, { botId: app.botId!, intents, largeThreshold: conn.data.largeThreshold })
          .catch((err) => { console.error('Gateway: GUILD_CREATE build failed', g, (err as Error)?.message); return null; })));
      for (let j = 0; j < batch.length; j++) {
        if (!this.connections.has(conn)) return;
        const p = payloads[j];
        if (p) await this.dispatchTo(conn, 'GUILD_CREATE', p);
        else conn.data.guildIds.delete(batch[j]);
      }
    }
    // Flush what arrived while READY was being built.
    conn.data.ready = true;
    const pending = conn.data.pending;
    conn.data.pending = [];
    for (const e of pending) this.emit(conn.data, conn, e.t, JSON.stringify(e.d));
  }

  // ─── RESUME ──────────────────────────────────────────────

  private async resume(conn: Conn, d: Record<string, unknown>) {
    const rawToken = String(d?.token ?? '');
    const token = rawToken.startsWith('Bot ') ? rawToken.slice(4) : rawToken;
    const app = token ? await this.loadApp(token) : null;
    if (!app || !app.botId) {
      conn.close(CLOSE.AUTHENTICATION_FAILED, 'Authentication failed');
      return;
    }
    const sessionId = String(d?.session_id ?? '');
    const entry = this.detached.get(sessionId);
    if (!entry || entry.expiresAt < Date.now() || entry.session.botId !== app.botId) {
      gwlog(conn.data.sessionId.slice(0, 8), 'resume rejected: unknown session');
      this.send(conn, OP.INVALID_SESSION, false);
      return;
    }
    const prev = entry.session;
    const clientSeq = Number(d?.seq ?? 0);
    if (!Number.isInteger(clientSeq) || clientSeq > prev.seq) {
      this.detached.delete(sessionId);
      conn.close(CLOSE.INVALID_SEQ, 'Invalid seq');
      return;
    }
    const missed = framesAfter(prev.replay, prev.seq, clientSeq);
    if (!missed) {
      this.detached.delete(sessionId);
      this.send(conn, OP.INVALID_SESSION, false);
      return;
    }
    // Privileged intents may have been switched off since IDENTIFY.
    if (disallowedIntents(prev.intents, allowedPrivilegedIntents(app)) !== 0) {
      this.detached.delete(sessionId);
      conn.close(CLOSE_DISALLOWED_INTENTS, 'Disallowed intent(s)');
      return;
    }
    this.detached.delete(sessionId);
    this.clearIdentifyTimer(conn);
    // Adopt the old session; keep this socket's transport options.
    // The session object itself moves to this socket, so dispatches still
    // queued for it (its chain) are delivered here with the right seq.
    const { compress, encoding, version, rate } = conn.data;
    Object.assign(prev, { compress, encoding, version, rate, authenticated: true, ready: true, pending: [], lastHeartbeat: Date.now() });
    conn.data = prev;
    this.adopt(conn);
    gwlog(conn.data.sessionId.slice(0, 8), `RESUMED bot=${app.botId} replay=${missed.length}`);
    for (const text of missed) this.write(conn, text);
    this.emit(conn.data, conn, 'RESUMED', JSON.stringify({ _trace: ['["serika-gateway",{"micros":0}]'] }));
    void this.setBotPresence(app.botId, true, conn.data.presence?.status);
  }

  // ─── Op 8 / op 31 ────────────────────────────────────────

  private async requestGuildMembers(conn: Conn, d: Record<string, unknown>) {
    const rawIds = d.user_ids === undefined || d.user_ids === null
      ? undefined
      : (Array.isArray(d.user_ids) ? d.user_ids : [d.user_ids]).slice(0, MAX_REQUEST_IDS);
    const { translateInbound } = await import('@/lib/botapi/boundary');
    const body = { guild_id: d.guild_id, ...(rawIds ? { user_ids: rawIds.map(String) } : {}) };
    const res = await translateInbound({ body });
    const t = (res.body ?? body) as { guild_id?: unknown; user_ids?: string[] };
    const guildId = typeof t.guild_id === 'string' ? t.guild_id : '';
    const known = [...conn.data.guildIds].find((g) => g.toLowerCase() === guildId.toLowerCase());
    if (!known) return; // not in this guild (or not on this shard): ignored, like Discord
    const userIds = t.user_ids;
    const query = typeof d.query === 'string' ? d.query : '';
    const limit = Number.isInteger(d.limit) ? Number(d.limit) : 0;
    const canListAll = (conn.data.intents & INTENT.GUILD_MEMBERS) !== 0;
    const nonce = typeof d.nonce === 'string' ? d.nonce.slice(0, 32) : undefined;
    // Full member lists are expensive: one per guild per session every 30 s,
    // like Discord's op 8 rate limit (RATE_LIMITED dispatch).
    if (!userIds && !query && canListAll) {
      const now = Date.now();
      const seen = (conn.data.memberListAt ??= new Map());
      const last = seen.get(known) ?? 0;
      if (now - last < MEMBER_LIST_INTERVAL_MS) {
        await this.dispatchTo(conn, 'RATE_LIMITED', {
          opcode: OP.REQUEST_GUILD_MEMBERS,
          retry_after: Math.ceil((MEMBER_LIST_INTERVAL_MS - (now - last)) / 1000),
          meta: { guild_id: known, ...(nonce !== undefined ? { nonce } : {}) },
        });
        return;
      }
      seen.set(known, now);
    }
    const { buildMemberChunks } = await import('./guildPayload');
    const chunks = await buildMemberChunks(
      { guildId: known, query, limit, userIds, nonce },
      canListAll,
    );
    // Restore the ids the bot asked for in not_found (unknown snowflakes have no UUID).
    if (rawIds && chunks[0]?.not_found) {
      const back = new Map((t.user_ids ?? []).map((u, i) => [u, String(rawIds[i])]));
      chunks[0].not_found = (chunks[0].not_found as string[]).map((u) => back.get(u) ?? u);
    }
    for (const c of chunks) {
      if (!this.connections.has(conn)) return;
      await this.dispatchTo(conn, 'GUILD_MEMBERS_CHUNK', c);
    }
  }

  private async voiceStateRequest(conn: Conn, d: Record<string, unknown>) {
    const { translateInbound } = await import('@/lib/botapi/boundary');
    const body = { guild_id: d.guild_id, channel_id: d.channel_id ?? null };
    const res = await translateInbound({ body });
    const t = (res.body ?? body) as { guild_id?: unknown; channel_id?: unknown };
    const guildId = typeof t.guild_id === 'string' ? t.guild_id : '';
    const known = [...conn.data.guildIds].find((g) => g.toLowerCase() === guildId.toLowerCase());
    if (!known || !conn.data.botId) return; // not in this guild / shard: ignored, like Discord
    let channelId: string | null = null;
    if (t.channel_id !== null && t.channel_id !== undefined) {
      if (typeof t.channel_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(t.channel_id)) return;
      const channel = await Channel.findById(t.channel_id).catch(() => null);
      if (!channel || (channel.serverId ?? '').toLowerCase() !== known.toLowerCase()) return;
      if (channel.type !== 'voice' && channel.type !== 'stage') return;
      channelId = channel.id;
    }
    const { botVoiceState } = await import('@/lib/services/voiceStates');
    await this.dispatchTo(conn, 'VOICE_STATE_UPDATE', botVoiceState({
      guildId: known,
      channelId,
      botId: conn.data.botId,
      sessionId: conn.data.sessionId,
      selfMute: d.self_mute === true,
      selfDeaf: d.self_deaf === true,
    }));
    if (channelId) {
      await this.dispatchTo(conn, 'VOICE_SERVER_UPDATE', { token: conn.data.sessionId.slice(0, 16), guild_id: known, endpoint: null });
    }
  }

  private async requestSoundboardSounds(conn: Conn, d: Record<string, unknown>) {
    const ids = Array.isArray(d.guild_ids) ? d.guild_ids.slice(0, MAX_REQUEST_IDS).map(String) : [];
    const { translateInbound } = await import('@/lib/botapi/boundary');
    const res = await translateInbound({ body: { guild_ids: ids } });
    const translated = ((res.body ?? { guild_ids: ids }) as { guild_ids: string[] }).guild_ids;
    for (const g of translated) {
      const known = [...conn.data.guildIds].find((x) => x.toLowerCase() === g.toLowerCase());
      if (known) await this.dispatchTo(conn, 'SOUNDBOARD_SOUNDS', { guild_id: known, soundboard_sounds: [] });
    }
  }

  // ─── Fan-out ─────────────────────────────────────────────

  /**
   * Fan a dispatch out to the bot sessions allowed to see it (rules in
   * ./routing.ts): targeted dispatches reach only their bot, guild events only
   * bots in that guild (and, for channel events, only bots the emitter listed
   * in `audience`), DM events only the DM's recipients (default-deny). Message
   * payloads are blanked for bots without MESSAGE_CONTENT. Detached sessions
   * buffer the dispatch for RESUME. Each session sees dispatches in publish order.
   */
  routeDispatch(dispatch: GatewayDispatch): Promise<void> {
    // Routing decisions (and the session state they change) happen now, in
    // publish order; sending is queued per session, so a slow id lookup for
    // one dispatch only delays the sessions that receive it.
    const now = Date.now();
    const targets: Array<{ session: Session; joined?: string }> = [];
    const consider = (session: Session) => {
      if (!session.authenticated || !session.botId) return;
      const decision = routeDecision(session, dispatch);
      if (decision.addDmChannelId) session.dmChannelIds.add(decision.addDmChannelId);
      if (decision.removeGuildId) {
        const gone = decision.removeGuildId.toLowerCase();
        for (const id of session.guildIds) if (id.toLowerCase() === gone) session.guildIds.delete(id);
      }
      if (!decision.deliver) return;
      targets.push({ session, joined: decision.addGuildId });
    };
    for (const conn of this.connections) consider(conn.data);
    for (const [id, entry] of this.detached) {
      if (entry.expiresAt < now) { this.detached.delete(id); continue; }
      consider(entry.session);
    }
    if (targets.length === 0) return Promise.resolve();

    let lookupP: Promise<OutboundLookup | null> | null = null;
    const lookup = () => {
      lookupP ??= import('@/lib/botapi/boundary')
        .then(({ resolveOutbound }) => resolveOutbound(dispatch.d, { timeoutMs: DISPATCH_LOOKUP_TIMEOUT_MS }))
        .catch(() => null);
      return lookupP;
    };
    const cache = new Map<unknown, { uuid?: string; sf?: string }>();
    return Promise.all(targets.map(({ session, joined }) => this.enqueue(session, async () => {
      // A guild the bot just joined belongs to one shard only.
      if (joined) {
        if (!(await this.guildInShard(session, joined))) return;
        session.guildIds.add(joined);
      }
      const variant = messagePayloadFor(dispatch.t, dispatch.d, session.botId!, session.intents);
      const snowflake = session.idFormat === 'snowflake';
      const sf = snowflake ? await lookup() : null;
      const { rewriteOutbound } = await import('@/lib/botapi/idTranslate');
      // Snowflake-format apps also get Discord image hashes instead of CDN URLs.
      const { toPublicMedia } = await import('@/lib/botapi/boundary');
      const publicView = () => toPublicMedia(sf ? rewriteOutbound(variant, sf) : variant);
      if (!session.ready) {
        session.pending.push({ t: dispatch.t, d: snowflake ? publicView() : variant });
        return;
      }
      const entry = cache.get(variant) ?? {};
      cache.set(variant, entry);
      const json = snowflake
        ? (entry.sf ??= JSON.stringify(publicView()))
        : (entry.uuid ??= JSON.stringify(variant));
      // Live socket now (it may have closed or resumed since): else just buffer.
      this.emit(session, this.sessionConn.get(session) ?? null, dispatch.t, json);
    }))).then(() => {});
  }
}

/**
 * Subscribe a hub to the Redis dispatch bus. Uses a dedicated ioredis
 * connection (pub/sub can't share with the command client). Returns a cleanup
 * function. Safe to call once per process.
 */
export async function subscribeHubToRedis(hub: GatewayHub): Promise<() => void> {
  const Redis = (await import('ioredis')).default;
  const sub = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: null });
  sub.on('error', (err: Error) => console.error('Gateway Redis error:', err.message));
  await sub.connect().catch((err: Error) => console.error('Gateway Redis connect failed:', err.message));
  await sub.subscribe(GATEWAY_CHANNEL);
  sub.on('message', (_ch: string, payload: string) => {
    try {
      void hub.routeDispatch(JSON.parse(payload) as GatewayDispatch);
    } catch (err) {
      console.error('Gateway: bad dispatch payload', err);
    }
  });
  console.log(`✅ Gateway hub subscribed to ${GATEWAY_CHANNEL}`);
  return () => { void sub.quit().catch(() => {}); };
}

export const GATEWAY_PATH = '/api/v10/gateway';
