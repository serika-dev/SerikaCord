/**
 * Bot voice (docs/architecture/voice-sfu.md, phases 3–4): Discord's voice
 * gateway and UDP media for bots (@discordjs/voice, discord.py), bridged into
 * the SFU room every person in the channel is connected to.
 *
 *   gateway op 4 ─▶ joinVoiceAsBot + grant ─▶ VOICE_SERVER_UPDATE { token, endpoint }
 *   bot ─wss─▶ voice WS: Hello(8) · Identify(0) → Ready(2) · Select Protocol(1) → Session Description(4)
 *   bot ─udp─▶ IP discovery, RTP/Opus (aead_aes256_gcm_rtpsize | aead_xchacha20_poly1305_rtpsize)
 *          ─▶ werift peer ─▶ Cloudflare Realtime (published as the bot's audio, people pull it)
 *   people's audio ─▶ werift pulls ─▶ re-SSRC'd per speaker, op 5 Speaking ─▶ encrypted UDP ─▶ bot
 *
 * No DAVE (dave_protocol_version 0). One process owns a bot's voice
 * connection: the one its WebSocket landed on.
 */
import { randomBytes, randomInt } from 'node:crypto';
import type { ServerWebSocket } from 'bun';
import { config } from '@/lib/config';
import { getRedis } from '@/lib/db/redis';
import { processShared } from '@/lib/realtime/processShared';
import { decryptRtp, encryptRtp, ipDiscoveryResponse, isVoiceMode, parseIpDiscoveryRequest, rtpHeader, VOICE_MODES, type VoiceMode } from '@/lib/voice/discordVoice';

// ─── Grants ─────────────────────────────────────────────────

export interface VoiceGrant {
  botId: string;
  serverId: string;
  roomId: string;
  /** The bot's voice session id (as in its VOICE_STATE_UPDATE). */
  sessionId: string;
  idFormat: 'uuid' | 'snowflake';
  selfDeaf: boolean;
}

const GRANT_TTL_S = 24 * 60 * 60;
const grantKey = (token: string) => `voice:botgrant:${token}`;

/** A short-lived voice token for (bot, room), sent in VOICE_SERVER_UPDATE. */
export async function createVoiceGrant(grant: VoiceGrant): Promise<string> {
  const token = randomBytes(16).toString('hex');
  const r = getRedis();
  if (r) await r.set(grantKey(token), JSON.stringify(grant), 'EX', GRANT_TTL_S);
  else localGrants.set(token, grant);
  return token;
}

const localGrants = processShared('voice:botGrantsLocal', () => new Map<string, VoiceGrant>());

async function readGrant(token: unknown): Promise<VoiceGrant | null> {
  if (typeof token !== 'string' || !/^[0-9a-f]{32}$/.test(token)) return null;
  const r = getRedis();
  if (!r) return localGrants.get(token) ?? null;
  const raw = await r.get(grantKey(token)).catch(() => null);
  if (!raw) return null;
  try { return JSON.parse(raw) as VoiceGrant; } catch { return null; }
}

/** What VOICE_SERVER_UPDATE carries as `endpoint`; null while bot voice isn't set up. */
export function voiceEndpoint(): string | null {
  if (!config.VOICE_PUBLIC_HOST || !config.VOICE_UDP_PORT) return null;
  return config.VOICE_PUBLIC_HOST.includes(':') ? config.VOICE_PUBLIC_HOST : `${config.VOICE_PUBLIC_HOST}:443`;
}

/** The voice WS: any path on the voice host, or /voice-gateway on any host (dev). */
export function isVoiceGatewayRequest(req: Request, pathname: string): boolean {
  if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') return false;
  const host = (req.headers.get('host') ?? '').split(':')[0].toLowerCase();
  const voiceHost = config.VOICE_PUBLIC_HOST.split(':')[0].toLowerCase();
  return (voiceHost !== '' && host === voiceHost) || pathname === '/voice-gateway' || pathname === '/voice-gateway/';
}

// ─── Voice sessions ─────────────────────────────────────────

type Sock = ServerWebSocket<{ voice?: VoiceSocketState }>;
export interface VoiceSocketState { version: number; session?: VoiceSession }

const HEARTBEAT_MS = 13_750;
const sessions = processShared('voice:botSessions', () => new Map<string, VoiceSession>()); // token → session
const bySsrc = processShared('voice:botSessionsBySsrc', () => new Map<number, VoiceSession>());

class VoiceSession {
  ws: Sock | null = null;
  readonly ssrc: number;
  mode: VoiceMode | null = null;
  key: Uint8Array | null = null;
  remote: { address: string; port: number } | null = null;
  seq = -1; // v8: last sequence number sent to the bot
  private nonce = randomInt(0, 2 ** 31);
  bridge: import('@/lib/voice/botBridge').BotBridge | null = null;
  private alive: ReturnType<typeof setInterval> | null = null;
  private closedAt = 0;
  /** Per speaker toward the bot: their SSRC there and RTP sequence. */
  private out = new Map<string, { ssrc: number; seq: number; announced: boolean }>();

  constructor(readonly token: string, readonly grant: VoiceGrant) {
    let ssrc = randomInt(1, 2 ** 31);
    while (bySsrc.has(ssrc)) ssrc = randomInt(1, 2 ** 31);
    this.ssrc = ssrc;
    bySsrc.set(ssrc, this);
    sessions.set(token, this);
  }

  send(op: number, d: unknown, sequenced = false) {
    if (!this.ws) return;
    const msg: Record<string, unknown> = { op, d };
    if (sequenced && (this.ws.data.voice?.version ?? 4) >= 8) msg.seq = ++this.seq;
    try { this.ws.send(JSON.stringify(msg)); } catch { /* socket gone */ }
  }

  /** Session Description: the key and mode; then media flows. */
  async select(address: string, port: number, mode: VoiceMode) {
    this.mode = mode;
    this.key = new Uint8Array(randomBytes(32));
    this.remote = { address, port };
    this.send(4, {
      mode,
      secret_key: Array.from(this.key),
      audio_codec: 'opus',
      video_codec: null,
      media_session_id: randomBytes(16).toString('hex'),
      dave_protocol_version: 0,
    });
    if (!this.bridge) {
      const { BotBridge } = await import('@/lib/voice/botBridge');
      this.bridge = new BotBridge(this.grant, (userId, opus, timestamp) => this.toBot(userId, opus, timestamp), (userIds) => this.announceLeft(userIds));
      void this.bridge.start().catch((err: unknown) => {
        console.warn('[bot-voice] bridge failed:', (err as Error)?.message ?? err);
        this.close(4000, 'Voice server unavailable');
      });
      // The bot left the channel (op 4, a move, a kick): its voice connection ends.
      this.alive = setInterval(() => {
        void import('@/lib/api/voice').then(({ voiceParticipantIn }) => {
          if (!voiceParticipantIn(this.grant.roomId, this.grant.botId)) this.close(4014, 'Disconnected');
        });
      }, 2000);
    }
  }

  /** Media from the bot (already matched to this session by SSRC). */
  fromBot(packet: Uint8Array, address: string, port: number) {
    if (!this.mode || !this.key || !this.remote) return;
    if (this.remote.address !== address || this.remote.port !== port) return;
    const out = decryptRtp(this.mode, this.key, packet);
    if (!out || out.opus.length === 0) return;
    this.bridge?.fromBot(out.opus, out.info.sequence, out.info.timestamp);
  }

  /** Someone's audio toward the bot, on their own SSRC (announced with op 5 first). */
  private toBot(userId: string, opus: Uint8Array, timestamp: number) {
    if (!this.mode || !this.key || !this.remote || this.grant.selfDeaf) return;
    let o = this.out.get(userId);
    if (!o) {
      let ssrc = randomInt(1, 2 ** 31);
      while (ssrc === this.ssrc) ssrc = randomInt(1, 2 ** 31);
      o = { ssrc, seq: randomInt(0, 65535), announced: false };
      this.out.set(userId, o);
    }
    if (!o.announced) {
      o.announced = true;
      void this.publicId(userId).then((id) => this.send(5, { user_id: id, ssrc: o!.ssrc, speaking: 1 }, true));
    }
    o.seq = (o.seq + 1) & 0xffff;
    this.nonce = (this.nonce + 1) >>> 0;
    const packet = encryptRtp(this.mode, this.key, rtpHeader(o.seq, timestamp, o.ssrc), opus, this.nonce);
    udp?.send(packet, this.remote.port, this.remote.address);
  }

  private announceLeft(userIds: string[]) {
    for (const userId of userIds) {
      this.out.delete(userId);
      void this.publicId(userId).then((id) => this.send(13, { user_id: id }, true));
    }
  }

  /** A user id the way this bot's app sees ids (snowflakes for most apps). */
  private async publicId(userId: string): Promise<string> {
    if (this.grant.idFormat !== 'snowflake') return userId;
    const { toSnowflakes } = await import('@/lib/botapi/boundary');
    const out = await toSnowflakes({ user_id: userId }).catch(() => ({ user_id: userId }));
    return String((out as { user_id: unknown }).user_id ?? userId);
  }

  /** The socket dropped: keep the session a while for a Resume (op 7). */
  detach() {
    this.ws = null;
    this.closedAt = Date.now();
    setTimeout(() => { if (!this.ws && Date.now() - this.closedAt >= 59_000) this.destroy(); }, 60_000);
  }

  close(code: number, reason: string) {
    try { this.ws?.close(code, reason); } catch { /* gone */ }
    this.destroy();
  }

  destroy() {
    if (this.alive) clearInterval(this.alive);
    this.alive = null;
    this.bridge?.close();
    this.bridge = null;
    bySsrc.delete(this.ssrc);
    sessions.delete(this.token);
    this.ws = null;
  }
}

// ─── UDP ────────────────────────────────────────────────────

let udp: { send(data: Uint8Array, port: number, address: string): boolean } | null = null;

/** Bind the voice UDP port (once per process). No-op without VOICE_UDP_PORT. */
export async function startVoiceUdp(): Promise<void> {
  if (udp || !config.VOICE_UDP_PORT) return;
  type UdpSock = { send(data: Uint8Array, port: number, address: string): boolean };
  const bun = (globalThis as unknown as {
    Bun: { udpSocket(o: { port: number; socket: { data(sock: UdpSock, buf: Buffer, port: number, address: string): void } }): Promise<UdpSock> };
  }).Bun;
  const socket = await bun.udpSocket({
    port: config.VOICE_UDP_PORT,
    socket: {
      data(sock, buf, port, address) {
        const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        const discovery = parseIpDiscoveryRequest(bytes);
        if (discovery !== null) {
          if (!bySsrc.has(discovery)) return;
          sock.send(ipDiscoveryResponse(discovery, address, port), port, address);
          return;
        }
        if (bytes.length < 12) return;
        const ssrc = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8);
        bySsrc.get(ssrc)?.fromBot(bytes, address, port);
      },
    },
  });
  udp = socket;
  console.log(`[bot-voice] UDP on :${config.VOICE_UDP_PORT}`);
}

// ─── WebSocket ──────────────────────────────────────────────

function opcodeHandler(ws: Sock, state: VoiceSocketState, msg: { op?: unknown; d?: unknown; seq?: unknown }) {
  const d = (msg.d && typeof msg.d === 'object' ? msg.d : {}) as Record<string, unknown>;
  switch (msg.op) {
    case 0: { // Identify
      if (state.session) return;
      void (async () => {
        const grant = await readGrant(d.token);
        if (!grant || String(d.session_id ?? '') !== grant.sessionId) {
          try { ws.close(4004, 'Authentication failed'); } catch { /* gone */ }
          return;
        }
        sessions.get(String(d.token))?.destroy(); // a fresh connect replaces an old one
        const session = new VoiceSession(String(d.token), grant);
        session.ws = ws;
        state.session = session;
        const host = config.VOICE_PUBLIC_HOST.split(':')[0] || '127.0.0.1';
        session.send(2, { ssrc: session.ssrc, ip: host, port: config.VOICE_UDP_PORT, modes: [...VOICE_MODES], experiments: [], heartbeat_interval: HEARTBEAT_MS });
      })();
      return;
    }
    case 1: { // Select Protocol
      const session = state.session;
      const data = (d.data && typeof d.data === 'object' ? d.data : d) as Record<string, unknown>;
      const mode = data.mode ?? d.mode;
      if (!session || d.protocol !== 'udp' || !isVoiceMode(mode)) {
        try { ws.close(4016, 'Unknown encryption mode'); } catch { /* gone */ }
        return;
      }
      const port = Number(data.port);
      if (typeof data.address !== 'string' || !Number.isInteger(port) || port < 1 || port > 65535) {
        try { ws.close(4002, 'Failed to decode payload'); } catch { /* gone */ }
        return;
      }
      void session.select(data.address, port, mode);
      return;
    }
    case 3: { // Heartbeat → ACK
      const nonce = typeof msg.d === 'object' && msg.d ? (msg.d as { t?: unknown }).t : msg.d;
      try { ws.send(JSON.stringify({ op: 6, d: state.version >= 8 ? { t: nonce } : nonce })); } catch { /* gone */ }
      return;
    }
    case 5: // Speaking (the bot's own): people hear it through the SFU, nothing to relay
      return;
    case 7: { // Resume
      const session = sessions.get(String(d.token ?? ''));
      if (!session || String(d.session_id ?? '') !== session.grant.sessionId) {
        try { ws.close(4006, 'Session no longer valid'); } catch { /* gone */ }
        return;
      }
      session.ws = ws;
      state.session = session;
      session.send(9, null);
      return;
    }
    default:
      return; // DAVE (21–31), video (12) and unknown opcodes: not supported, ignored
  }
}

/** Wrap the server's WebSocket handler: sockets with `data.voice` are voice gateway connections. */
export function withVoiceSockets<H extends { open?: (ws: never) => void; message?: (ws: never, m: never) => void; close?: (ws: never, code: number, reason: string) => void }>(base: H): H {
  return {
    ...base,
    open(ws: Sock) {
      const state = ws.data.voice;
      if (!state) return (base.open as ((w: Sock) => void) | undefined)?.(ws);
      try { ws.send(JSON.stringify({ op: 8, d: { heartbeat_interval: HEARTBEAT_MS } })); } catch { /* gone */ }
    },
    message(ws: Sock, message: string | Buffer) {
      const state = ws.data.voice;
      if (!state) return (base.message as ((w: Sock, m: string | Buffer) => void) | undefined)?.(ws, message);
      if (typeof message !== 'string') return; // binary = DAVE, unsupported
      if (message.length > 16 * 1024) { try { ws.close(4002, 'Failed to decode payload'); } catch { /* gone */ } return; }
      let parsed: { op?: unknown; d?: unknown; seq?: unknown };
      try { parsed = JSON.parse(message); } catch { try { ws.close(4002, 'Failed to decode payload'); } catch { /* gone */ } return; }
      opcodeHandler(ws, state, parsed);
    },
    close(ws: Sock, code: number, reason: string) {
      const state = ws.data.voice;
      if (!state) return (base.close as ((w: Sock, c: number, r: string) => void) | undefined)?.(ws, code, reason);
      if (state.session?.ws === ws) state.session.detach();
    },
  } as H;
}

/** Upgrade a voice gateway request (`?v=` picks the protocol version, default 4). */
export function upgradeVoiceGateway<D>(req: Request, server: { upgrade(req: Request, opts?: { data?: D }): boolean }): Response | undefined {
  const v = Number(new URL(req.url).searchParams.get('v') ?? 4);
  const version = Number.isInteger(v) && v >= 1 && v <= 8 ? v : 4;
  // The gateway's socket data shape, with `voice` set (no gateway connection).
  const data = { conn: null, compress: null, encoding: 'json', version: null, voice: { version } satisfies VoiceSocketState } as unknown as D;
  if (server.upgrade(req, { data })) return undefined;
  return new Response('Upgrade failed', { status: 400 });
}
