/**
 * UDP relay for bot voice (docs/architecture/voice-sfu.md, "Hosting").
 *
 * The app containers can't publish the voice UDP ports themselves: Coolify
 * can't do rolling (zero-downtime) deploys for an app with host ports, and
 * every deploy then dropped bots and calls for half a minute. This relay is a
 * separate, long-lived service that owns the host ports (where the playit.gg
 * tunnel delivers bot voice) and forwards to whichever app instances are
 * running:
 *
 *   playit ─▶ 127.0.0.1:<port> (this relay) ─▶ every live app instance's voice UDP
 *
 * App instances announce themselves from their voice UDP socket every 2 s
 * ("SRLY1 <secret>", VOICE_UDP_RELAY in the app) and are forgotten 6 s after
 * they stop. A bot's packets go to every live instance (normally one; two for
 * a moment during a deploy) and only the instance that owns the bot's session
 * answers. Each bot flow gets its own upstream socket, so replies find their
 * way back.
 *
 * Env: RELAY_PORTS ("50000,50001"), RELAY_SECRET (shared with the apps).
 * Run: bun scripts/voice-udp-relay.ts
 */

type UdpSock = {
  send(data: Uint8Array, port: number, address: string): boolean;
  close(): void;
  port: number;
};
type UdpOpts = {
  port?: number;
  socket: { data(sock: UdpSock, buf: Buffer, port: number, address: string): void; error?(sock: UdpSock, err: Error): void };
};
const udpSocket = (opts: UdpOpts) => (globalThis as unknown as { Bun: { udpSocket(o: UdpOpts): Promise<UdpSock> } }).Bun.udpSocket(opts);

const SECRET = process.env.RELAY_SECRET ?? '';
const PORTS = (process.env.RELAY_PORTS ?? '50000').split(',').map((p) => Number(p.trim())).filter((p) => Number.isInteger(p) && p > 0 && p < 65536);
const MAGIC = 'SRLY1 ';
const UPSTREAM_TTL_MS = 6_000;
const CLIENT_IDLE_MS = 120_000;
const MAX_CLIENTS = 2_000;
const MAX_QUEUE = 64;

if (SECRET.length < 16) throw new Error('RELAY_SECRET (16+ characters) is required');
if (PORTS.length === 0) throw new Error('RELAY_PORTS is empty');

const registration = Buffer.from(MAGIC + SECRET);

interface Upstream { address: string; port: number; seen: number }
/**
 * One socket per (bot flow, app instance). Not one per flow: after an
 * instance is removed by a deploy, ICMP "port unreachable" leaves an error
 * pending on the socket that sent to it, and Linux then fails the next send
 * on that socket whatever its destination, which would silence the new
 * instance too.
 */
interface Pair { sock: UdpSock | null; queue: Uint8Array[] }
interface Client { address: string; port: number; seen: number; pairs: Map<string, Pair> }

async function relay(listenPort: number) {
  const upstreams = new Map<string, Upstream>();
  const clients = new Map<string, Client>();
  const live = () => {
    const now = Date.now();
    return [...upstreams.values()].filter((u) => now - u.seen < UPSTREAM_TTL_MS);
  };

  const openPair = (c: Client, upKey: string, pair: Pair) => {
    void udpSocket({
      socket: {
        data(_s, reply, upPort, upAddress) {
          if (`${upAddress}:${upPort}` !== upKey) return;
          c.seen = Date.now();
          try { listen.send(new Uint8Array(reply), c.port, c.address); } catch { /* the bot's side went away */ }
        },
        // ICMP errors from a removed instance: only this pair is affected.
        error() {},
      },
    }).then((sock) => {
      if (c.pairs.get(upKey) !== pair) return sock.close();
      pair.sock = sock;
      const u = upstreams.get(upKey);
      if (u) for (const queued of pair.queue) send(pair, u, queued);
      pair.queue = [];
    }, (err) => {
      console.warn(`[relay:${listenPort}] socket failed:`, (err as Error)?.message ?? err);
      c.pairs.delete(upKey);
    });
  };
  const send = (pair: Pair, u: Upstream, data: Uint8Array) => {
    try { pair.sock?.send(data, u.port, u.address); } catch { /* a pending ICMP error from a removed instance */ }
  };
  const forward = (c: Client, data: Uint8Array) => {
    for (const u of live()) {
      const upKey = `${u.address}:${u.port}`;
      let pair = c.pairs.get(upKey);
      if (!pair) {
        pair = { sock: null, queue: [data] };
        c.pairs.set(upKey, pair);
        openPair(c, upKey, pair);
      } else if (pair.sock) send(pair, u, data);
      else if (pair.queue.length < MAX_QUEUE) pair.queue.push(data);
    }
  };

  const listen = await udpSocket({
    port: listenPort,
    socket: {
      data(_sock, buf, port, address) {
        const key = `${address}:${port}`;
        // An app instance announcing itself.
        if (buf.length === registration.length && buf.equals(registration)) {
          const known = upstreams.get(key);
          if (known) known.seen = Date.now();
          else {
            upstreams.set(key, { address, port, seen: Date.now() });
            console.log(`[relay:${listenPort}] upstream ${key} up (${live().length} live)`);
          }
          return;
        }
        let c = clients.get(key);
        if (!c) {
          if (clients.size >= MAX_CLIENTS) return;
          c = { address, port, seen: Date.now(), pairs: new Map() };
          clients.set(key, c);
        }
        c.seen = Date.now();
        forward(c, new Uint8Array(buf));
      },
      error() {},
    },
  });

  setInterval(() => {
    const now = Date.now();
    for (const [key, u] of upstreams) {
      if (now - u.seen >= UPSTREAM_TTL_MS) {
        upstreams.delete(key);
        console.log(`[relay:${listenPort}] upstream ${key} gone (${live().length} live)`);
      }
    }
    for (const [key, c] of clients) {
      const idle = now - c.seen >= CLIENT_IDLE_MS;
      for (const [upKey, pair] of c.pairs) {
        if (idle || !upstreams.has(upKey)) {
          pair.sock?.close();
          c.pairs.delete(upKey);
        }
      }
      if (idle) clients.delete(key);
    }
  }, 2_000);

  console.log(`[relay] listening on udp :${listenPort}`);
}

// Last line of defence: log and keep relaying rather than exit mid-call.
process.on('uncaughtException', (err) => console.warn('[relay] uncaught:', err?.message ?? err));
process.on('unhandledRejection', (err) => console.warn('[relay] unhandled:', (err as Error)?.message ?? err));

await Promise.all(PORTS.map(relay));
