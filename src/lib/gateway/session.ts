/**
 * Pure gateway session rules (no DB, no sockets): IDENTIFY validation, close
 * codes, sharding math, the RESUME replay buffer and the per-connection send
 * rate limit. Used by GatewayHub (./core.ts) and unit tested.
 */

/** Discord gateway close codes. */
export const CLOSE = {
  UNKNOWN_ERROR: 4000,
  UNKNOWN_OPCODE: 4001,
  DECODE_ERROR: 4002,
  NOT_AUTHENTICATED: 4003,
  AUTHENTICATION_FAILED: 4004,
  ALREADY_AUTHENTICATED: 4005,
  INVALID_SEQ: 4007,
  RATE_LIMITED: 4008,
  SESSION_TIMED_OUT: 4009,
  INVALID_SHARD: 4010,
  SHARDING_REQUIRED: 4011,
  INVALID_API_VERSION: 4012,
  INVALID_INTENTS: 4013,
  DISALLOWED_INTENTS: 4014,
} as const;

/** Highest intent bit Discord defines (DIRECT_MESSAGE_POLLS = 1 << 25). */
export const ALL_INTENTS = (1 << 26) - 1;
/** Guilds per shard above which an unsharded IDENTIFY is refused (Discord: 2500). */
export const MAX_GUILDS_PER_SHARD = 2500;
/** Gateway payloads a client may send per window (Discord: 120 / 60 s). */
export const SEND_LIMIT = 120;
export const SEND_WINDOW_MS = 60_000;

export interface IdentifyOptions {
  token: string;
  intents: number;
  shard: [number, number] | null;
  largeThreshold?: unknown;
  presence?: unknown;
}

/** Parse an IDENTIFY payload, or the close code to answer it with. */
export function parseIdentify(d: unknown): { ok: true; value: IdentifyOptions } | { ok: false; close: number; reason: string } {
  const p = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>;
  const raw = typeof p.token === 'string' ? p.token : '';
  const token = raw.startsWith('Bot ') ? raw.slice(4) : raw;
  if (!token) return { ok: false, close: CLOSE.AUTHENTICATION_FAILED, reason: 'Authentication failed' };
  const intents = p.intents === undefined ? 0 : Number(p.intents);
  if (!Number.isInteger(intents) || intents < 0 || (intents & ~ALL_INTENTS) !== 0) {
    return { ok: false, close: CLOSE.INVALID_INTENTS, reason: 'Invalid intent(s)' };
  }
  let shard: [number, number] | null = null;
  if (p.shard !== undefined && p.shard !== null) {
    const s = p.shard;
    if (!Array.isArray(s) || s.length !== 2 || !s.every((n) => Number.isInteger(n)) || s[1] < 1 || s[0] < 0 || s[0] >= s[1]) {
      return { ok: false, close: CLOSE.INVALID_SHARD, reason: 'Invalid shard' };
    }
    shard = [s[0], s[1]];
  }
  return { ok: true, value: { token, intents, shard, largeThreshold: p.large_threshold, presence: p.presence } };
}

/** Shard of a guild from its snowflake: (guild_id >> 22) % num_shards. */
export function shardOfSnowflake(guildSnowflake: string, numShards: number): number {
  if (numShards <= 1) return 0;
  try {
    return Number((BigInt(guildSnowflake) >> 22n) % BigInt(numShards));
  } catch {
    return 0;
  }
}

/** Stable shard of a UUID guild (legacy UUID-format apps). */
export function shardOfUuid(guildId: string, numShards: number): number {
  if (numShards <= 1) return 0;
  let h = 0x811c9dc5;
  for (const ch of guildId.toLowerCase()) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % numShards;
}

/** Supported `?v=` values (missing = current). */
export function isSupportedVersion(v: string | null | undefined): boolean {
  return v === null || v === undefined || v === '' || v === '10' || v === '9';
}

// ─── Replay buffer ────────────────────────────────────────────────────────────

export const REPLAY_MAX_FRAMES = 1000;
export const REPLAY_MAX_BYTES = 1024 * 1024;

export interface ReplayBuffer {
  frames: Array<{ s: number; text: string }>;
  bytes: number;
}

export function newReplayBuffer(): ReplayBuffer {
  return { frames: [], bytes: 0 };
}

/** Remember a sent dispatch frame, dropping the oldest past the caps. */
export function pushReplay(buf: ReplayBuffer, s: number, text: string) {
  buf.frames.push({ s, text });
  buf.bytes += text.length;
  while (buf.frames.length > REPLAY_MAX_FRAMES || (buf.bytes > REPLAY_MAX_BYTES && buf.frames.length > 1)) {
    const old = buf.frames.shift()!;
    buf.bytes -= old.text.length;
  }
}

/**
 * Frames a client that saw up to `clientSeq` missed, or null when they can't
 * all be replayed (the buffer dropped some, or the seq is ahead of the session).
 */
export function framesAfter(buf: ReplayBuffer, sessionSeq: number, clientSeq: number): string[] | null {
  if (!Number.isInteger(clientSeq) || clientSeq < 0 || clientSeq > sessionSeq) return null;
  if (clientSeq === sessionSeq) return [];
  const first = buf.frames[0];
  if (!first || first.s > clientSeq + 1) return null;
  return buf.frames.filter((f) => f.s > clientSeq).map((f) => f.text);
}

// ─── Send rate limit ──────────────────────────────────────────────────────────

export interface RateWindow { start: number; count: number }

/** Count one client payload; false when the client exceeded SEND_LIMIT in the window (close 4008). */
export function countPayload(w: RateWindow, now = Date.now()): boolean {
  if (now - w.start >= SEND_WINDOW_MS) { w.start = now; w.count = 0; }
  w.count++;
  return w.count <= SEND_LIMIT;
}

/** Map an op 3 / IDENTIFY presence status to a stored user status. */
export function presenceStatus(status: unknown): 'online' | 'idle' | 'dnd' | 'invisible' | null {
  return status === 'online' || status === 'idle' || status === 'dnd' || status === 'invisible' ? status : null;
}
