/**
 * Bun.serve WebSocket transport for GatewayHub, shared by server.ts, the
 * optional standalone scripts/gateway.ts and the bot-compat test harness.
 *
 *  - `upgrade(req, server)`: reads `?v=`, `encoding=` and `compress=` and
 *    upgrades the request.
 *  - `websocket`: the Bun websocket handlers (text and binary frames,
 *    zlib-stream via Conn.sendBinary).
 *  - a keepalive sweep that closes zombie sessions with 4009.
 *  - `installShutdown()`: on SIGTERM/SIGINT every bot gets op 7 RECONNECT
 *    before the process exits (deploys).
 */
import type { ServerWebSocket } from 'bun';
import { GatewayHub, newSession, isHeartbeatExpired, KEEPALIVE_SWEEP_INTERVAL, type Conn } from './core';
import { parseCompression } from './compression';
import { CLOSE } from './session';

export interface GatewaySocketData {
  conn: Conn | null;
  compress: string | null;
  encoding: string;
  version: string | null;
}

type WS = ServerWebSocket<GatewaySocketData>;
/** The part of Bun's server object the upgrade needs. */
type UpgradeServer = { upgrade: (req: Request, options?: { data?: GatewaySocketData }) => boolean };
type WebSocketHandler = NonNullable<BunServeOptions<GatewaySocketData>['websocket']>;

export interface BunGatewayTransport {
  upgrade(req: Request, server: UpgradeServer): Response | undefined;
  websocket: WebSocketHandler;
  liveSockets: Set<WS>;
  /** Send op 7 to every bot (deploy/shutdown). */
  reconnectAll(): number;
  installShutdown(opts?: { exit?: boolean }): void;
}

export function createBunGatewayTransport(hub: GatewayHub): BunGatewayTransport {
  const liveSockets = new Set<WS>();

  const sweep = setInterval(() => {
    for (const ws of liveSockets) {
      const conn = ws.data.conn;
      if (!conn || ws.readyState !== 1) continue;
      if (conn.data.authenticated && isHeartbeatExpired(conn)) {
        try { ws.close(CLOSE.SESSION_TIMED_OUT, 'Session timed out'); } catch { ws.terminate(); }
      }
    }
  }, KEEPALIVE_SWEEP_INTERVAL);
  (sweep as { unref?: () => void }).unref?.();

  const websocket: WebSocketHandler = {
    sendPings: true,
    maxPayloadLength: 1 << 20,
    open(ws: WS) {
      const session = newSession({
        compress: parseCompression(ws.data.compress),
        encoding: ws.data.encoding,
        version: ws.data.version,
      });
      const conn: Conn = {
        data: session,
        sendText: (text) => { ws.send(text); },
        sendBinary: (data) => { ws.send(data); },
        close: (code, reason) => ws.close(code, reason),
      };
      ws.data.conn = conn;
      liveSockets.add(ws);
      hub.hello(conn);
    },
    async message(ws: WS, raw: string | Buffer) {
      if (!ws.data.conn) return;
      await hub.onFrame(ws.data.conn, typeof raw === 'string' ? raw : new Uint8Array(raw));
    },
    pong(ws: WS) {
      if (ws.data.conn) ws.data.conn.data.lastHeartbeat = Date.now();
    },
    close(ws: WS, code: number) {
      liveSockets.delete(ws);
      const conn = ws.data.conn;
      if (!conn) return;
      if (process.env.GATEWAY_DEBUG === '1' || process.env.GATEWAY_DEBUG === 'true') {
        console.log(`[gateway] closed session=${conn.data.sessionId.slice(0, 8)} bot=${conn.data.botId ?? '(unauth)'} code=${code}`);
      }
      hub.onClose(conn);
    },
  };

  function upgrade(req: Request, server: UpgradeServer): Response | undefined {
    const url = new URL(req.url);
    const ok = server.upgrade(req, {
      data: {
        conn: null,
        compress: url.searchParams.get('compress'),
        encoding: url.searchParams.get('encoding') ?? 'json',
        version: url.searchParams.get('v'),
      },
    });
    return ok ? undefined : new Response('Upgrade failed', { status: 426 });
  }

  let installed = false;
  function installShutdown(opts?: { exit?: boolean }) {
    if (installed) return;
    installed = true;
    const onSignal = (signal: string) => {
      const n = hub.reconnectAll();
      console.log(`[gateway] ${signal}: sent RECONNECT to ${n} bot connection(s)`);
      if (opts?.exit !== false) {
        const t = setTimeout(() => process.exit(0), 1500);
        (t as { unref?: () => void }).unref?.();
      }
    };
    process.once('SIGTERM', () => onSignal('SIGTERM'));
    process.once('SIGINT', () => onSignal('SIGINT'));
  }

  return { upgrade, websocket, liveSockets, reconnectAll: () => hub.reconnectAll(), installShutdown };
}
