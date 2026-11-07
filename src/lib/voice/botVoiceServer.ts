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
  /** For putting the bot back in the room when a session is resumed on a new instance. */
  selfMute?: boolean;
  /** The bot's gateway session id (the room participant's sessionId). */
  gatewaySessionId?: string;
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
  if (!config.VOICE_PUBLIC_HOST || !config.VOICE_UDP_HOST || !config.VOICE_UDP_PORT) return null;
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

// A session's state in Redis, so it survives a restart: after a deploy the
// bot's library resumes (op 7) on the new instance, which rebuilds the
// session (same SSRC, key and mode) instead of answering 4006 and making the
// bot rejoin through a gateway that is reconnecting at the same moment.
// Refreshed on every heartbeat; deleted when the session really ends.
const SESSION_TTL_S = 10 * 60;
/** Waits before retrying a bridge that failed to start. */
const BRIDGE_RETRY_MS = [2_000, 5_000, 10_000];
const sessionKey = (token: string) => `voice:botsess:${token}`;
interface PersistedSession {
  grant: VoiceGrant;
  ssrc: number;
  mode: VoiceMode;
  key: string; // base64
  remote: { address: string; port: number };
}

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
  private destroyed = false;
  /** Per speaker toward the bot: their SSRC there and RTP sequence. */
  private out = new Map<string, { ssrc: number; seq: number; announced: boolean }>();

  constructor(readonly token: string, readonly grant: VoiceGrant, ssrc?: number) {
    if (ssrc === undefined) {
      ssrc = randomInt(1, 2 ** 31);
      while (bySsrc.has(ssrc)) ssrc = randomInt(1, 2 ** 31);
    }
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
    this.persist();
    await this.startBridge();
  }

  /** Bridge into the SFU room, and end the voice connection when the bot leaves the channel. */
  async startBridge() {
    if (!this.bridge) {
      const { BotBridge } = await import('@/lib/voice/botBridge');
      // A failed start (a media server blip) is retried before giving up.
      const tryStart = (attempt: number) => {
        if (this.destroyed) return;
        this.bridge?.close();
        this.bridge = new BotBridge(this.grant, (userId, opus, timestamp) => this.toBot(userId, opus, timestamp), (userIds) => this.announceLeft(userIds));
        this.bridge.start().catch((err: unknown) => {
          console.warn(`[bot-voice] bridge failed (attempt ${attempt + 1}):`, (err as Error)?.message ?? err);
          if (attempt < BRIDGE_RETRY_MS.length) setTimeout(() => tryStart(attempt + 1), BRIDGE_RETRY_MS[attempt]);
          else this.close(4000, 'Voice server unavailable');
        });
      };
      tryStart(0);
      // The bot left the channel (op 4, a move, a kick): its voice connection ends.
      this.alive = setInterval(() => {
        void import('@/lib/api/voice').then(({ voiceParticipantIn }) => {
          if (!voiceParticipantIn(this.grant.roomId, this.grant.botId)) this.close(4014, 'Disconnected');
        });
      }, 2000);
    }
  }

  /**
   * Media from the bot (already matched to this session by SSRC). Packets
   * from a new address are accepted once they decrypt with the session key
   * (only the bot has it): after a restart or a NAT change the same bot shows
   * up from another port, and replies follow it there.
   */
  fromBot(packet: Uint8Array, address: string, port: number) {
    if (!this.mode || !this.key || !this.remote) return;
    const out = decryptRtp(this.mode, this.key, packet);
    if (!out || out.opus.length === 0) return;
    if (this.remote.address !== address || this.remote.port !== port) {
      this.remote = { address, port };
      this.persist();
    }
    this.bridge?.fromBot(out.opus, out.info.sequence, out.info.timestamp);
  }

  /** Save what a resume on another instance needs (after Select Protocol). */
  persist() {
    if (!this.mode || !this.key || !this.remote) return;
    const r = getRedis();
    if (!r) return;
    const rec: PersistedSession = { grant: this.grant, ssrc: this.ssrc, mode: this.mode, key: Buffer.from(this.key).toString('base64'), remote: this.remote };
    void r.set(sessionKey(this.token), JSON.stringify(rec), 'EX', SESSION_TTL_S).catch(() => {});
  }

  /** Heartbeat: keep the saved state as long as the connection lives. */
  touch() {
    if (!this.key) return;
    void getRedis()?.expire(sessionKey(this.token), SESSION_TTL_S).catch(() => {});
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
    this.destroyed = true;
    if (this.alive) clearInterval(this.alive);
    this.alive = null;
    this.bridge?.close();
    this.bridge = null;
    if (bySsrc.get(this.ssrc) === this) bySsrc.delete(this.ssrc);
    if (sessions.get(this.token) === this) sessions.delete(this.token);
    this.ws = null;
    // The session really ended (left, replaced, never resumed): nothing to resume.
    void getRedis()?.del(sessionKey(this.token)).catch(() => {});
  }
}

/**
 * Rebuild a session another instance ran (it restarted or was replaced by a
 * deploy) from its saved state: same SSRC, key and mode, so the bot carries
 * on without new IP discovery. The bot is put back in the room if this
 * instance doesn't have it, and a new bridge publishes its audio.
 */
async function restoreSession(token: string, sessionId: string): Promise<VoiceSession | null> {
  if (!/^[0-9a-f]{32}$/.test(token)) return null;
  const raw = await getRedis()?.get(sessionKey(token)).catch(() => null);
  if (!raw) return null;
  let rec: PersistedSession;
  try { rec = JSON.parse(raw) as PersistedSession; } catch { return null; }
  if (!rec?.grant || rec.grant.sessionId !== sessionId || !isVoiceMode(rec.mode)) return null;
  const existing = sessions.get(token);
  if (existing) return existing; // a parallel resume got here first
  if (bySsrc.has(rec.ssrc)) return null;
  const voice = await import('@/lib/api/voice');
  if (!voice.voiceParticipantIn(rec.grant.roomId, rec.grant.botId)) {
    if (!rec.grant.gatewaySessionId) return null;
    const { User } = await import('@/lib/models');
    const bot = await User.findById(rec.grant.botId).catch(() => null);
    const joined = await voice.joinVoiceAsBot({
      botId: rec.grant.botId,
      username: bot?.username ?? 'bot',
      displayName: bot?.displayName ?? null,
      avatar: bot?.avatar ?? null,
      serverId: rec.grant.serverId,
      channelId: rec.grant.roomId.slice('channel-'.length),
      sessionId: rec.grant.gatewaySessionId,
      selfMute: rec.grant.selfMute === true,
      selfDeaf: rec.grant.selfDeaf,
    });
    if (!joined.ok) return null;
  }
  if (sessions.get(token)) return sessions.get(token)!;
  const session = new VoiceSession(token, rec.grant, rec.ssrc);
  session.mode = rec.mode;
  session.key = new Uint8Array(Buffer.from(rec.key, 'base64'));
  session.remote = rec.remote;
  session.persist();
  void session.startBridge();
  return session;
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
        // Where to send UDP: never the WebSocket host (it's behind Cloudflare's proxy).
        const host = config.VOICE_UDP_HOST || '127.0.0.1';
        session.send(2, { ssrc: session.ssrc, ip: host, port: config.VOICE_UDP_PUBLIC_PORT, modes: [...VOICE_MODES], experiments: [], heartbeat_interval: HEARTBEAT_MS });
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
      state.session?.touch();
      const nonce = typeof msg.d === 'object' && msg.d ? (msg.d as { t?: unknown }).t : msg.d;
      try { ws.send(JSON.stringify({ op: 6, d: state.version >= 8 ? { t: nonce } : nonce })); } catch { /* gone */ }
      return;
    }
    case 5: // Speaking (the bot's own): people hear it through the SFU, nothing to relay
      return;
    case 7: { // Resume
      if (state.session) return;
      const token = String(d.token ?? '');
      const sessionId = String(d.session_id ?? '');
      const adopt = (session: VoiceSession | null) => {
        if (!session || sessionId !== session.grant.sessionId) {
          try { ws.close(4006, 'Session no longer valid'); } catch { /* gone */ }
          return;
        }
        session.ws = ws;
        state.session = session;
        session.send(9, null);
      };
      const local = sessions.get(token);
      if (local) return adopt(local);
      // Not this instance's: a restart or deploy moved it here.
      void restoreSession(token, sessionId).then(adopt, (err: unknown) => {
        console.warn('[bot-voice] resume failed:', (err as Error)?.message ?? err);
        adopt(null);
      });
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
