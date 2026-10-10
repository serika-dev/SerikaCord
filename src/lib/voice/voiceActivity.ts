// Voice activity ("input sensitivity") gate, Discord-style: the mic only
// transmits while its level is above a threshold, and stays open for a short
// hangover after you stop so word endings aren't clipped. The threshold is
// either set by hand (a dB slider, -100..0) or tracked automatically from the
// room's noise floor. Pure so the voice service, the settings meter and the
// unit tests share one implementation.

/** Bottom and top of the sensitivity slider / level meter, in dBFS. */
export const SENSITIVITY_MIN_DB = -100;
export const SENSITIVITY_MAX_DB = 0;
/** Discord's default manual threshold sits around here. */
export const DEFAULT_SENSITIVITY_DB = -60;
/** How long the gate stays open after the level drops below the threshold. */
export const GATE_HANGOVER_MS = 300;

/** Auto mode: open this far above the measured noise floor... */
const AUTO_MARGIN_DB = 16;
/** ...but never below/above these, so silence or a loud room stays sane. */
const AUTO_MIN_THRESHOLD_DB = -72;
const AUTO_MAX_THRESHOLD_DB = -28;
/** Noise floor follows a quieter level fast and a louder one slowly. */
const FLOOR_FALL_RATE = 0.25;
const FLOOR_RISE_RATE = 0.004;
const INITIAL_FLOOR_DB = -70;

export function clampSensitivityDb(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_SENSITIVITY_DB;
  return Math.min(Math.max(Math.round(value), SENSITIVITY_MIN_DB), SENSITIVITY_MAX_DB);
}

/**
 * Root-mean-square of an analyser's byte time-domain buffer (128 = silence),
 * as a 0..1 amplitude.
 */
export function rmsFromByteTimeDomain(data: ArrayLike<number>): number {
  if (!data.length) return 0;
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = (data[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / data.length);
}

/** Amplitude (0..1) to dBFS, floored at the slider minimum. */
export function amplitudeToDb(rms: number): number {
  if (!(rms > 0)) return SENSITIVITY_MIN_DB;
  const db = 20 * Math.log10(rms);
  return Math.min(Math.max(db, SENSITIVITY_MIN_DB), SENSITIVITY_MAX_DB);
}

/** Position (0..100) of a dB value on the meter / slider track. */
export function dbToMeterPercent(db: number): number {
  const clamped = Math.min(Math.max(db, SENSITIVITY_MIN_DB), SENSITIVITY_MAX_DB);
  return ((clamped - SENSITIVITY_MIN_DB) / (SENSITIVITY_MAX_DB - SENSITIVITY_MIN_DB)) * 100;
}

export interface VoiceGateState {
  open: boolean;
  /** When the level was last above the threshold (ms clock). */
  lastAboveAt: number;
  /** Tracked noise floor (auto mode), dBFS. */
  noiseFloorDb: number;
  /** Threshold the last step compared against, dBFS. */
  thresholdDb: number;
}

export function createVoiceGateState(): VoiceGateState {
  return { open: false, lastAboveAt: -Infinity, noiseFloorDb: INITIAL_FLOOR_DB, thresholdDb: DEFAULT_SENSITIVITY_DB };
}

export interface VoiceGateInput {
  levelDb: number;
  now: number;
  /** Automatically determine input sensitivity. */
  auto: boolean;
  /** Manual threshold (ignored in auto mode). */
  manualThresholdDb: number;
}

/** The threshold auto mode would use for a given noise floor. */
export function autoThresholdFor(noiseFloorDb: number): number {
  return Math.min(Math.max(noiseFloorDb + AUTO_MARGIN_DB, AUTO_MIN_THRESHOLD_DB), AUTO_MAX_THRESHOLD_DB);
}

/**
 * Advance the gate one meter tick. Returns a new state; `open` says whether
 * the mic should transmit right now.
 */
export function stepVoiceGate(state: VoiceGateState, input: VoiceGateInput): VoiceGateState {
  const level = Math.min(Math.max(input.levelDb, SENSITIVITY_MIN_DB), SENSITIVITY_MAX_DB);
  let noiseFloorDb = state.noiseFloorDb;
  // Only learn the floor from audio that isn't speech (gate closed or level
  // near the floor), so talking doesn't drag the threshold up.
  if (!state.open || level < noiseFloorDb + AUTO_MARGIN_DB / 2) {
    const rate = level < noiseFloorDb ? FLOOR_FALL_RATE : FLOOR_RISE_RATE;
    noiseFloorDb += (level - noiseFloorDb) * rate;
  }
  const thresholdDb = input.auto ? autoThresholdFor(noiseFloorDb) : clampSensitivityDb(input.manualThresholdDb);
  const above = level >= thresholdDb;
  const lastAboveAt = above ? input.now : state.lastAboveAt;
  const open = above || input.now - lastAboveAt < GATE_HANGOVER_MS;
  return { open, lastAboveAt, noiseFloorDb, thresholdDb };
}
