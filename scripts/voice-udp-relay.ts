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
type UdpOpts = { port?: number; socket: { data(sock: UdpSock, buf: Buffer, port: number, address: string): void } };
const udpSocket = (opts: UdpOpts) => (globalThis as unknown as { Bun: { udpSocket(o: UdpOpts): Promise<UdpSock> } }).Bun.udpSocket(opts);

const SECRET = process.env.RELAY_SECRET ?? '';
const PORTS = (process.env.RELAY_PORTS ?? '50000').split(',').map((p) => Number(p.trim())).filter((p) => Number.isInteger(p) && p > 0 && p < 65536);
const MAGIC = 'SRLY1 ';
const UPSTREAM_TTL_MS = 6_000;
const CLIENT_IDLE_MS = 120_000;
const MAX_CLIENTS = 2_000;

if (SECRET.length < 16) throw new Error('RELAY_SECRET (16+ characters) is required');
if (PORTS.length === 0) throw new Error('RELAY_PORTS is empty');

const registration = Buffer.from(MAGIC + SECRET);

interface Upstream { address: string; port: number; seen: number }
interface Client { address: string; port: number; seen: number; sock: UdpSock | null; queue: Uint8Array[] }

async function relay(listenPort: number) {
  const upstreams = new Map<string, Upstream>();
  const clients = new Map<string, Client>();
  const live = () => {
    const now = Date.now();
    return [...upstreams.values()].filter((u) => now - u.seen < UPSTREAM_TTL_MS);
  };
  const forward = (c: Client, data: Uint8Array) => {
    for (const u of live()) c.sock?.send(data, u.port, u.address);
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
        const data = new Uint8Array(buf);
        let c = clients.get(key);
        if (c) {
          c.seen = Date.now();
          if (c.sock) forward(c, data);
          else if (c.queue.length < 64) c.queue.push(data);
          return;
        }
        if (clients.size >= MAX_CLIENTS) return;
        c = { address, port, seen: Date.now(), sock: null, queue: [data] };
        clients.set(key, c);
        const client = c;
        // Replies from a live upstream go back to this client.
        void udpSocket({
          socket: {
            data(_s, reply, upPort, upAddress) {
              if (!upstreams.has(`${upAddress}:${upPort}`)) return;
              client.seen = Date.now();
              listen.send(new Uint8Array(reply), client.port, client.address);
            },
          },
        }).then((sock) => {
          if (clients.get(key) !== client) return sock.close();
          client.sock = sock;
          for (const queued of client.queue) forward(client, queued);
          client.queue = [];
        }, (err) => {
          console.warn(`[relay:${listenPort}] socket for ${key} failed:`, (err as Error)?.message ?? err);
          clients.delete(key);
        });
      },
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
      if (now - c.seen >= CLIENT_IDLE_MS) {
        c.sock?.close();
        clients.delete(key);
      }
    }
  }, 2_000);

  console.log(`[relay] listening on udp :${listenPort}`);
}

await Promise.all(PORTS.map(relay));
