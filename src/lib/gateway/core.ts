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
        // Minimal resume: acknowledge and continue (no event replay).
        this.send(conn, OP.DISPATCH, {}, { t: 'RESUMED', s: ++conn.data.seq });
        break;
      default:
        break;
    }
  }

  onClose(conn: Conn) {
    this.connections.delete(conn);
  }

  private async identify(conn: Conn, d: Record<string, unknown>) {
    const rawToken = String(d?.token ?? '');
    const token = rawToken.startsWith('Bot ') ? rawToken.slice(4) : rawToken;
    const intents = Number(d?.intents) || 0;

    const app = await Application.findOne({ botToken: token }).lean();
    if (!app || !app.botId) {
      this.send(conn, OP.INVALID_SESSION, false);
      conn.close(4004, 'Authentication failed');
      return;
    }

    const botUser = await User.findById(app.botId).lean();
    if (!botUser) {
      this.send(conn, OP.INVALID_SESSION, false);
      conn.close(4004, 'Authentication failed');
      return;
    }

    const memberships = await ServerMember.find({ userId: app.botId }).select('serverId').lean();
    const guildIds = memberships.map((m: { serverId: { toString(): string } }) => m.serverId.toString());

    const dmChannels = await Channel.find({ type: { $in: ['dm', 'group_dm'] }, recipientIds: app.botId })
      .select('_id').lean();

    conn.data.authenticated = true;
    conn.data.botId = app.botId.toString();
    conn.data.applicationId = app._id.toString();
    conn.data.intents = intents;
    conn.data.guildIds = new Set(guildIds);
    conn.data.dmChannelIds = new Set(dmChannels.map((c: { _id: { toString(): string } }) => c._id.toString()));
    this.connections.add(conn);

    const u = botUser as unknown as { _id: { toString(): string }; username: string; displayName?: string; avatar?: string | null };
    const user = {
      id: u._id.toString(),
      username: u.username,
      global_name: u.displayName || u.username,
      avatar: u.avatar ?? null,
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
      application: { id: app._id.toString(), flags: app.flags ?? 0 },
    }, { t: 'READY', s: ++conn.data.seq });
  }

  routeDispatch(dispatch: GatewayDispatch) {
    for (const conn of this.connections) {
      if (!conn.data.authenticated) continue;
      if (dispatch.intent && (conn.data.intents & dispatch.intent) === 0) continue;

      if (dispatch.guildId) {
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
