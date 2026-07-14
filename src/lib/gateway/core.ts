/**
 * Transport-agnostic Discord Gateway v10 core.
 *
 * The same protocol logic drives two transports:
 *   1. The integrated Next.js server (server.ts) via the `ws` package — this is
 *      the default: one process, one port, one Coolify/Docker app.
 *   2. An optional standalone Bun process (scripts/gateway.ts) via Bun.serve,
 *      for horizontal scale-out later.
 *
 * A "connection" is anything that can send text and be closed. Both transports
 * adapt their socket to the `Conn` interface below.
 */
import { Application, User, ServerMember, Channel } from '@/lib/models';
import { GATEWAY_CHANNEL, type GatewayDispatch } from '@/lib/services/gatewayEvents';
import { config } from '@/lib/config';

export const OP = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  RESUME: 6,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
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
}

export interface Conn {
  data: Session;
  sendText(text: string): void;
  close(code: number, reason: string): void;
}

export function newSession(): Session {
  return {
    authenticated: false,
    sessionId:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2),
    botId: null,
    applicationId: null,
    intents: 0,
    guildIds: new Set<string>(),
    dmChannelIds: new Set<string>(),
    seq: 0,
    lastHeartbeat: Date.now(),
  };
}

/** Verbose per-connection gateway logging (set GATEWAY_DEBUG=1). */
const GATEWAY_DEBUG =
  typeof process !== 'undefined' &&
  (process.env?.GATEWAY_DEBUG === '1' || process.env?.GATEWAY_DEBUG === 'true');

function gwlog(...args: unknown[]) {
  if (GATEWAY_DEBUG) console.log('[gateway]', ...args);
}

/** Registry of authenticated connections + Redis fan-out. */
export class GatewayHub {
  readonly connections = new Set<Conn>();

  send(conn: Conn, op: number, d: unknown, extra?: { t?: string; s?: number }) {
    try {
      conn.sendText(JSON.stringify({ op, d, s: extra?.s ?? null, t: extra?.t ?? null }));
    } catch {
      /* socket closing */
    }
  }

  hello(conn: Conn) {
    conn.data.lastHeartbeat = Date.now();
    this.send(conn, OP.HELLO, { heartbeat_interval: HEARTBEAT_INTERVAL });
  }

  async onFrame(conn: Conn, raw: string) {
    let frame: { op?: number; d?: unknown };
    try {
      frame = JSON.parse(raw);
    } catch {
      conn.close(4002, 'Decode error');
      return;
    }
    switch (frame.op) {
      case OP.HEARTBEAT:
        conn.data.lastHeartbeat = Date.now();
        this.send(conn, OP.HEARTBEAT_ACK, null);
        gwlog(conn.data.sessionId.slice(0, 8), 'heartbeat', conn.data.botId ?? '(unauth)');
        break;
      case OP.IDENTIFY:
        if (conn.data.authenticated) return;
        try {
          await this.identify(conn, frame.d as Record<string, unknown>);
        } catch (err) {
          console.error('Gateway: identify failed', err);
          conn.close(4000, 'Unknown error');
        }
        break;
      case OP.RESUME:
        // Minimal resume: re-authenticate from the token so the connection is
        // actually registered for dispatch (there is no event replay). Without
        // re-auth a resumed socket would silently receive nothing.
        if (!conn.data.authenticated) {
          try {
            await this.identify(conn, frame.d as Record<string, unknown>, { resumed: true });
          } catch (err) {
            console.error('Gateway: resume failed', err);
            conn.close(4000, 'Unknown error');
            break;
          }
        }
        if (conn.data.authenticated) {
          this.send(conn, OP.DISPATCH, {}, { t: 'RESUMED', s: ++conn.data.seq });
        }
        break;
      default:
        break;
    }
  }

  onClose(conn: Conn) {
    this.connections.delete(conn);
  }

  private async identify(conn: Conn, d: Record<string, unknown>, opts?: { resumed?: boolean }) {
    const rawToken = String(d?.token ?? '');
    const token = rawToken.startsWith('Bot ') ? rawToken.slice(4) : rawToken;
    const intents = Number(d?.intents) || 0;

    if (!token) {
      gwlog(conn.data.sessionId.slice(0, 8), 'identify rejected: missing token');
      this.send(conn, OP.INVALID_SESSION, false);
      conn.close(4004, 'Authentication failed');
      return;
    }

    const app = await Application.findOne({ botToken: token });
    if (!app || !app.botId) {
      gwlog(conn.data.sessionId.slice(0, 8), 'identify rejected: unknown token');
      this.send(conn, OP.INVALID_SESSION, false);
      conn.close(4004, 'Authentication failed');
      return;
    }

    // Fetch bot user, memberships, and DM channels in parallel
    const [botUser, memberships, dmChannels] = await Promise.all([
      User.findById(app.botId),
      ServerMember.find({ userId: app.botId }),
      Channel.find({ type: { in: ['dm', 'group_dm'] }, recipientIds: app.botId }),
    ]);
    if (!botUser) {
      this.send(conn, OP.INVALID_SESSION, false);
      conn.close(4004, 'Authentication failed');
      return;
    }

    const guildIds = memberships.map((m: { serverId: string }) => m.serverId);

    conn.data.authenticated = true;
    conn.data.botId = app.botId;
    conn.data.applicationId = app.id;
    conn.data.intents = intents;
    conn.data.guildIds = new Set(guildIds);
    conn.data.dmChannelIds = new Set(dmChannels.map((c: { id: string }) => c.id));
    conn.data.lastHeartbeat = Date.now();
    this.connections.add(conn);
    gwlog(
      conn.data.sessionId.slice(0, 8),
      `${opts?.resumed ? 'RESUMED' : 'READY'} bot=${app.botId} guilds=${guildIds.length} dms=${conn.data.dmChannelIds.size}`,
    );

    // On resume the caller emits RESUMED; skip the READY payload.
    if (opts?.resumed) return;

    const user = {
      id: botUser.id,
      username: botUser.username,
      global_name: botUser.displayName || botUser.username,
      avatar: botUser.avatar ?? null,
      bot: true,
      discriminator: '0',
      verified: true,
      flags: 0,
    };

    this.send(conn, OP.DISPATCH, {
      v: 10,
      user,
      guilds: guildIds.map((id) => ({ id, unavailable: true })),
      session_id: conn.data.sessionId,
      resume_gateway_url: config.GATEWAY_URL,
      application: { id: app.id, flags: app.flags ?? 0 },
    }, { t: 'READY', s: ++conn.data.seq });
  }

  routeDispatch(dispatch: GatewayDispatch) {
    for (const conn of this.connections) {
      if (!conn.data.authenticated) continue;

      // If targetBotId is specified, only deliver to that bot connection.
      if (dispatch.targetBotId && conn.data.botId !== dispatch.targetBotId) continue;

      if (dispatch.intent && (conn.data.intents & dispatch.intent) === 0) continue;

      if (dispatch.guildId) {
        // If this is a GUILD_CREATE for this bot, or a GUILD_MEMBER_ADD for this bot, add to guildIds
        const isBotJoin = (dispatch.t === 'GUILD_MEMBER_ADD' && (dispatch.d as any)?.user?.id === conn.data.botId) ||
                          (dispatch.t === 'GUILD_CREATE' && dispatch.targetBotId === conn.data.botId);
        if (isBotJoin) {
          conn.data.guildIds.add(dispatch.guildId);
        }

        if (!conn.data.guildIds.has(dispatch.guildId)) continue;
      } else {
        const channelId = (dispatch.d as { channel_id?: string })?.channel_id;
        if (channelId && conn.data.dmChannelIds.size && !conn.data.dmChannelIds.has(channelId)) continue;
      }

      // Don't echo a bot's own message back to itself.
      const authorId = (dispatch.d as { author?: { id?: string } })?.author?.id;
      if (dispatch.t === 'MESSAGE_CREATE' && authorId && authorId === conn.data.botId) continue;

      this.send(conn, OP.DISPATCH, dispatch.d, { t: dispatch.t, s: ++conn.data.seq });
    }
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
      hub.routeDispatch(JSON.parse(payload) as GatewayDispatch);
    } catch (err) {
      console.error('Gateway: bad dispatch payload', err);
    }
  });
  console.log(`✅ Gateway hub subscribed to ${GATEWAY_CHANNEL}`);
  return () => { void sub.quit().catch(() => {}); };
}

export const GATEWAY_PATH = '/api/v10/gateway';
