// Pure helpers that turn the user's saved Voice & Video settings into what the
// voice service applies to a call (mic processing constraints, push-to-talk,
// input/output volume, input sensitivity). Shared with unit tests.

import { clampSensitivityDb } from "./voiceActivity";

export type MicProcessingConstraints = {
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
};

export type VoiceCallSettings = {
  constraints: MicProcessingConstraints;
  pushToTalk?: boolean;
  pushToTalkKey?: string;
  inputVolume?: number;
  outputVolume?: number;
  /** Automatically determine input sensitivity (voice activity threshold). */
  autoSensitivity?: boolean;
  /** Manual voice activity threshold, dBFS (-100..0). */
  inputSensitivity?: number;
};

export const DEFAULT_PTT_KEY = "V";

function clampPercent(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(Math.max(Math.round(value), 0), 200);
}

/** Normalise a single-character push-to-talk key ("v" -> "V"). */
export function normalizePttKey(key: unknown): string {
  if (typeof key !== "string") return DEFAULT_PTT_KEY;
  const trimmed = key.trim();
  if (!trimmed) return DEFAULT_PTT_KEY;
  return trimmed.slice(0, 1).toUpperCase();
}

/**
 * Pick the call-relevant fields out of a saved `voiceVideo` settings object.
 * Only fields with a usable value are returned, so a partial patch never
 * resets the others.
 */
export function readVoiceCallSettings(voiceVideo: unknown): VoiceCallSettings {
  const v = (voiceVideo && typeof voiceVideo === "object" ? voiceVideo : {}) as Record<string, unknown>;
  const constraints: MicProcessingConstraints = {};
  if (typeof v.echoCancellation === "boolean") constraints.echoCancellation = v.echoCancellation;
  if (typeof v.noiseSuppression === "boolean") constraints.noiseSuppression = v.noiseSuppression;
  if (typeof v.autoGainControl === "boolean") constraints.autoGainControl = v.autoGainControl;

  const out: VoiceCallSettings = { constraints };
  if (typeof v.pushToTalk === "boolean") out.pushToTalk = v.pushToTalk;
  if (v.pushToTalkKey !== undefined) out.pushToTalkKey = normalizePttKey(v.pushToTalkKey);
  const input = clampPercent(v.inputVolume);
  if (input !== undefined) out.inputVolume = input;
  const output = clampPercent(v.outputVolume);
  if (output !== undefined) out.outputVolume = output;
  if (typeof v.autoSensitivity === "boolean") out.autoSensitivity = v.autoSensitivity;
  if (typeof v.inputSensitivity === "number" && Number.isFinite(v.inputSensitivity)) {
    out.inputSensitivity = clampSensitivityDb(v.inputSensitivity);
  }
  return out;
}

/** Whether the local mic should be sending audio right now. */
export function shouldTransmit(state: {
  muted: boolean;
  pttEnabled: boolean;
  pttHeld: boolean;
  /** Muted by a moderator (Server Mute): overrides everything. */
  serverMuted?: boolean;
  /** Voice activity gate (input sensitivity); only applies outside push-to-talk. */
  voiceGateOpen?: boolean;
}): boolean {
  if (state.muted || state.serverMuted) return false;
  if (state.pttEnabled) return state.pttHeld;
  return state.voiceGateOpen !== false;
}

/**
 * Whether a keyboard event is the push-to-talk key. Matches on the produced
 * character and on the physical key code (so Shift or a different layout
 * still works for letters and digits).
 */
export function isPttKeyEvent(event: { key?: string; code?: string }, pttKey: string): boolean {
  const want = normalizePttKey(pttKey);
  if (typeof event.key === "string" && event.key.length === 1 && event.key.toUpperCase() === want) return true;
  if (typeof event.code === "string") {
    if (/^[A-Z]$/.test(want) && event.code === `Key${want}`) return true;
    if (/^[0-9]$/.test(want) && event.code === `Digit${want}`) return true;
  }
  return false;
}

/** Media-element volume (0..1) and extra Web Audio gain for an output percent (0..200). */
export function outputVolumeLevels(percent: number): { elementVolume: number; boostGain: number | null } {
  const p = clampPercent(percent) ?? 100;
  if (p <= 100) return { elementVolume: p / 100, boostGain: null };
  return { elementVolume: 1, boostGain: p / 100 };
}
