/**
 * Discord snowflake codec (pure, no DB).
 *
 * Layout (Discord's): 42 bits of milliseconds since DISCORD_EPOCH, then 5 bits
 * worker, 5 bits process, 12 bits increment. We treat worker+process as one
 * 10-bit field. Libraries read `createdAt` from the top bits, so snowflakes
 * minted here carry the entity's real creation time (see snowflakeStore.ts).
 *
 * Snowflakes travel as decimal strings: they exceed 2^53, so a JS `number`
 * loses precision. Everything here works on bigint internally.
 */

/** 2015-01-01T00:00:00Z, Discord's epoch. */
export const DISCORD_EPOCH = 1420070400000;

const TIMESTAMP_SHIFT = 22n;
const WORKER_SHIFT = 12n;
const WORKER_MASK = 0x3ffn; // 10 bits
const SEQ_MASK = 0xfffn; // 12 bits
/** Largest timestamp offset that fits in a positive int64 (41 bits). */
const MAX_OFFSET = (1n << 41n) - 1n;

export interface SnowflakeParts {
  /** Unix time in ms. Clamped to [DISCORD_EPOCH, epoch + 2^41). */
  timestamp: number;
  /** 0..1023 (worker << 5 | process). */
  worker: number;
  /** 0..4095. */
  seq: number;
}

/** Encode a snowflake (decimal string). */
export function encodeSnowflake(p: SnowflakeParts): string {
  let offset = BigInt(Math.floor(Number.isFinite(p.timestamp) ? p.timestamp : DISCORD_EPOCH)) - BigInt(DISCORD_EPOCH);
  if (offset < 0n) offset = 0n;
  if (offset > MAX_OFFSET) offset = MAX_OFFSET;
  const worker = BigInt(Math.trunc(p.worker) >>> 0) & WORKER_MASK;
  const seq = BigInt(Math.trunc(p.seq) >>> 0) & SEQ_MASK;
  return ((offset << TIMESTAMP_SHIFT) | (worker << WORKER_SHIFT) | seq).toString();
}

/** Split a snowflake into its parts, or null when it isn't one. */
export function decodeSnowflake(sf: string | bigint): SnowflakeParts | null {
  const v = toBig(sf);
  if (v === null) return null;
  return {
    timestamp: Number(v >> TIMESTAMP_SHIFT) + DISCORD_EPOCH,
    worker: Number((v >> WORKER_SHIFT) & WORKER_MASK),
    seq: Number(v & SEQ_MASK),
  };
}

/** Creation time (Unix ms) encoded in a snowflake, or null. */
export function snowflakeTimestamp(sf: string | bigint): number | null {
  const v = toBig(sf);
  return v === null ? null : Number(v >> TIMESTAMP_SHIFT) + DISCORD_EPOCH;
}

/** -1 / 0 / 1 numeric order of two snowflakes (decimal strings compare wrong by length). */
export function compareSnowflakes(a: string | bigint, b: string | bigint): number {
  const x = toBig(a) ?? 0n;
  const y = toBig(b) ?? 0n;
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Smallest snowflake for a given time: Discord's `before/after: SnowflakeUtil.generate(date)` cursor. */
export function snowflakeForTime(timestampMs: number): string {
  return encodeSnowflake({ timestamp: timestampMs, worker: 0, seq: 0 });
}

const SNOWFLAKE_RE = /^\d{1,20}$/;

/** A decimal string that fits a positive int64 (what Discord accepts as an id). */
export function isSnowflake(value: unknown): value is string {
  if (typeof value !== 'string' || !SNOWFLAKE_RE.test(value)) return false;
  try {
    const v = BigInt(value);
    return v > 0n && v < (1n << 63n);
  } catch {
    return false;
  }
}

/**
 * Fewest digits a real public snowflake has (anything after ~6 hours past the
 * epoch has 15+). Inbound translation ignores shorter numbers, so counters,
 * colors and bitfields are never looked up.
 */
export const MIN_PUBLIC_SNOWFLAKE_DIGITS = 15;

/** A snowflake long enough to be a real public id (see MIN_PUBLIC_SNOWFLAKE_DIGITS). */
export function isPublicSnowflake(value: unknown): value is string {
  return typeof value === 'string' && value.length >= MIN_PUBLIC_SNOWFLAKE_DIGITS && isSnowflake(value);
}

function toBig(sf: string | bigint): bigint | null {
  if (typeof sf === 'bigint') return sf >= 0n ? sf : null;
  if (!isSnowflake(sf)) return null;
  return BigInt(sf);
}

/**
 * Deterministic worker/seq seed for a uuid (FNV-1a over its hex). Two app
 * instances that mint a snowflake for the same entity at the same time pick
 * the same value, and different entities created in the same millisecond
 * rarely collide (a collision just retries with seq + 1).
 */
export function seedFor(uuid: string): { worker: number; seq: number } {
  let h = 0x811c9dc5;
  const s = uuid.toLowerCase();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return { worker: h & 0x3ff, seq: (h >>> 10) & 0xfff };
}

/** The `attempt`-th candidate snowflake for an entity (attempt 0 = the seed). */
export function candidateSnowflake(uuid: string, timestampMs: number, attempt = 0): string {
  const { worker, seq } = seedFor(uuid);
  // Walk seq first, then worker, so retries stay in the same millisecond.
  const n = seq + attempt;
  return encodeSnowflake({ timestamp: timestampMs, worker: (worker + Math.floor(n / 4096)) & 0x3ff, seq: n & 0xfff });
}
