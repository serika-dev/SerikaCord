/**
 * Voice messages (Discord-compatible): a message flagged IS_VOICE_MESSAGE
 * (1 << 13) with no text and exactly one audio attachment that carries
 * `durationSecs` and a `waveform` (base64 of up to 256 amplitude bytes, 0-255).
 *
 * Pure: shared by the send routes (validation + flag), the bot API / gateway
 * serializers (snake_case `duration_secs` / `waveform`), the composer recorder
 * (waveform encoding, recorder mime choice) and the player (decoding, duration
 * text). Tested in tests/voice-message.test.ts.
 */
import { applyChannelOverwrites, type ChannelOverwrite, type ChannelPermissionContext } from "@/lib/permissions/channelOverwrites";
import { PERMISSION_BITS } from "@/lib/permissions/bits";

export const IS_VOICE_MESSAGE = 1 << 13;
/** Longest accepted recording (Discord allows ~20 minutes). */
export const MAX_VOICE_MESSAGE_SECS = 20 * 60;
/** The recorder stops itself here. */
export const RECORDER_MAX_SECS = 10 * 60;
/** Discord stores at most 256 waveform samples. */
export const MAX_WAVEFORM_SAMPLES = 256;

export interface VoiceAttachmentMeta {
  durationSecs?: number;
  waveform?: string;
}

/** An uploaded recording, ready to send as a voice message. */
export interface VoiceMessageAttachment {
  id: string;
  url: string;
  filename: string;
  contentType: string;
  size?: number;
  durationSecs: number;
  waveform?: string;
}

export function isVoiceFlagRequested(flags: unknown): boolean {
  return typeof flags === "number" && Number.isInteger(flags) && (flags & IS_VOICE_MESSAGE) !== 0;
}

export function isVoiceMessage(flags: number | null | undefined): boolean {
  return typeof flags === "number" && (flags & IS_VOICE_MESSAGE) !== 0;
}

// ---- base64 (no Buffer/btoa so it runs the same on server, client and tests) ----

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function bytesToBase64(bytes: readonly number[]): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] & 255;
    const b = i + 1 < bytes.length ? bytes[i + 1] & 255 : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] & 255 : 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? B64[n & 63] : "=";
  }
  return out;
}

function base64ToBytes(text: string): number[] | null {
  if (!B64_RE.test(text)) return null;
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 4) {
    const chunk = text.slice(i, i + 4);
    const v = [0, 1, 2, 3].map((k) => (chunk[k] === "=" ? 0 : B64.indexOf(chunk[k])));
    const n = (v[0] << 18) | (v[1] << 12) | (v[2] << 6) | v[3];
    out.push((n >> 16) & 255);
    if (chunk[2] !== "=") out.push((n >> 8) & 255);
    if (chunk[3] !== "=") out.push(n & 255);
  }
  return out;
}

// ---- waveform ----

/**
 * Reduce live level readings (0..1, one per analyser tick) to `count` buckets
 * (peak per bucket), scaled so the loudest bucket is 1.
 */
export function downsampleWaveform(levels: readonly number[], count: number): number[] {
  const n = Math.max(1, Math.min(MAX_WAVEFORM_SAMPLES, Math.floor(count)));
  if (levels.length === 0) return new Array(n).fill(0);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const start = Math.floor((i * levels.length) / n);
    const end = Math.max(start + 1, Math.floor(((i + 1) * levels.length) / n));
    let peak = 0;
    for (let j = start; j < end && j < levels.length; j++) {
      const v = levels[j];
      if (Number.isFinite(v) && v > peak) peak = v;
    }
    out.push(peak);
  }
  const max = Math.max(...out);
  return max > 0 ? out.map((v) => Math.min(1, v / max)) : out;
}

/** Samples a waveform should have for a recording: ~10 per second, 1..256. */
export function waveformSampleCount(durationSecs: number): number {
  if (!Number.isFinite(durationSecs) || durationSecs <= 0) return 1;
  return Math.max(1, Math.min(MAX_WAVEFORM_SAMPLES, Math.round(durationSecs * 10)));
}

/** 0..1 amplitudes → Discord's base64 byte waveform. */
export function encodeWaveform(samples: readonly number[]): string {
  const bytes = samples
    .slice(0, MAX_WAVEFORM_SAMPLES)
    .map((v) => Math.round(Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0)) * 255));
  return bytesToBase64(bytes);
}

/** Base64 waveform → 0..1 amplitudes, or null when malformed / oversized. */
export function decodeWaveform(waveform: unknown): number[] | null {
  if (typeof waveform !== "string" || waveform.length === 0 || waveform.length > 400) return null;
  const bytes = base64ToBytes(waveform);
  if (!bytes || bytes.length === 0 || bytes.length > MAX_WAVEFORM_SAMPLES) return null;
  return bytes.map((b) => b / 255);
}

/**
 * Bars for the player: resample a decoded waveform to `bars` columns (falls
 * back to a flat line when the message has no waveform).
 */
export function waveformBars(samples: readonly number[] | null, bars: number): number[] {
  const n = Math.max(1, Math.floor(bars));
  if (!samples || samples.length === 0) return new Array(n).fill(0.15);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const pos = (i * samples.length) / n;
    const lo = Math.floor(pos);
    const hi = Math.min(samples.length - 1, lo + 1);
    const t = pos - lo;
    const v = samples[lo] * (1 - t) + samples[hi] * t;
    out.push(Math.max(0.08, Math.min(1, v)));
  }
  return out;
}

// ---- duration ----

/** "0:07", "1:05", "12:30". */
export function formatVoiceDuration(secs: number): string {
  const total = Number.isFinite(secs) && secs > 0 ? Math.floor(secs) : 0;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export const PLAYBACK_RATES = [1, 1.5, 2] as const;

/** Next speed in the 1x → 1.5x → 2x → 1x cycle. */
export function nextPlaybackRate(rate: number): number {
  const i = PLAYBACK_RATES.indexOf(rate as (typeof PLAYBACK_RATES)[number]);
  return PLAYBACK_RATES[(i + 1) % PLAYBACK_RATES.length];
}

// ---- recorder ----

export interface RecorderFormat {
  /** What MediaRecorder is asked for. */
  mimeType: string;
  /** The upload's content type (no codec parameters; matches the upload whitelist). */
  fileType: string;
  extension: string;
}

const RECORDER_FORMATS: RecorderFormat[] = [
  { mimeType: "audio/ogg;codecs=opus", fileType: "audio/ogg", extension: "ogg" },
  { mimeType: "audio/webm;codecs=opus", fileType: "audio/webm", extension: "webm" },
  { mimeType: "audio/webm", fileType: "audio/webm", extension: "webm" },
  { mimeType: "audio/mp4", fileType: "audio/mp4", extension: "m4a" },
  { mimeType: "audio/mp4;codecs=mp4a.40.2", fileType: "audio/mp4", extension: "m4a" },
];

/** First format this browser's MediaRecorder supports: opus first, m4a (Safari) last. */
export function pickRecorderFormat(isTypeSupported: (type: string) => boolean): RecorderFormat | null {
  for (const f of RECORDER_FORMATS) {
    try {
      if (isTypeSupported(f.mimeType)) return f;
    } catch {
      // Some webviews throw for unknown types.
    }
  }
  return null;
}

/** Map a recorded blob's type back to an upload type (Safari may report "audio/mp4;codecs=..."). */
export function recorderFormatForBlobType(type: string, fallback: RecorderFormat): RecorderFormat {
  const base = type.split(";")[0].trim().toLowerCase();
  const match = RECORDER_FORMATS.find((f) => f.fileType === base);
  return match ? { ...match, mimeType: type } : fallback;
}

// ---- server-side validation ----

export interface VoiceCapableAttachment extends VoiceAttachmentMeta {
  contentType: string;
}

/**
 * The stored attachments + extra flag for a send. With IS_VOICE_MESSAGE
 * requested: exactly one audio attachment, no text or sticker, a valid
 * duration; the waveform is kept only when well-formed. Without it, any
 * `durationSecs` / `waveform` the client sent is dropped so normal files
 * can't pose as voice messages.
 */
export function normalizeVoiceMessage<A extends VoiceCapableAttachment>(input: {
  requestedFlags: unknown;
  content?: string | null;
  hasSticker?: boolean;
  attachments: readonly A[];
}): { error: string } | { flag: number; attachments: A[] } {
  const strip = (a: A): A => {
    if (a.durationSecs === undefined && a.waveform === undefined) return a;
    const copy = { ...a };
    delete copy.durationSecs;
    delete copy.waveform;
    return copy;
  };
  if (!isVoiceFlagRequested(input.requestedFlags)) {
    return { flag: 0, attachments: input.attachments.map(strip) };
  }
  const invalid = { error: "Voice messages must have exactly one audio attachment and no text" };
  if ((input.content ?? "").trim() || input.hasSticker) return invalid;
  if (input.attachments.length !== 1) return invalid;
  const att = input.attachments[0];
  if (typeof att.contentType !== "string" || !att.contentType.toLowerCase().startsWith("audio/")) return invalid;
  const d = att.durationSecs;
  if (typeof d !== "number" || !Number.isFinite(d) || d <= 0 || d > MAX_VOICE_MESSAGE_SECS) {
    return { error: "Invalid voice message duration" };
  }
  const out = { ...att, durationSecs: Math.round(d * 100) / 100 };
  if (decodeWaveform(att.waveform) === null) delete out.waveform;
  return { flag: IS_VOICE_MESSAGE, attachments: [out] };
}

/** Accept Discord's snake_case `duration_secs` on bot-sent attachments. */
export function fromDiscordVoiceAttachment<A extends Record<string, unknown>>(att: A): A & VoiceAttachmentMeta {
  const out: A & VoiceAttachmentMeta = { ...att };
  if (out.durationSecs === undefined && typeof att.duration_secs === "number") out.durationSecs = att.duration_secs;
  if (out.contentType === undefined && typeof att.content_type === "string") (out as Record<string, unknown>).contentType = att.content_type;
  return out;
}

/** Discord attachment fields for a stored voice attachment (empty for other files). */
export function toDiscordVoiceFields(att: VoiceAttachmentMeta | null | undefined): { duration_secs?: number; waveform?: string } {
  if (!att || typeof att.durationSecs !== "number") return {};
  return {
    duration_secs: att.durationSecs,
    ...(typeof att.waveform === "string" ? { waveform: att.waveform } : {}),
  };
}

/** Client: does this attachment render as a voice-message player? */
export function isVoiceAttachment(att: { contentType?: string | null; durationSecs?: unknown } | null | undefined): boolean {
  return (
    !!att &&
    typeof att.durationSecs === "number" &&
    typeof att.contentType === "string" &&
    att.contentType.toLowerCase().startsWith("audio/")
  );
}

/**
 * SEND_VOICE_MESSAGES gate. Legacy @everyone bitfields predate the bit, so a
 * member may send voice messages when they hold it, or when no channel
 * overwrite that applies to them denies it (Discord grants it by default).
 */
export function canSendVoiceMessages(
  perms: bigint,
  overwrites: readonly ChannelOverwrite[] | null | undefined,
  ctx: ChannelPermissionContext,
): boolean {
  const bit = PERMISSION_BITS.SEND_VOICE_MESSAGES;
  if ((perms & bit) === bit) return true;
  return (applyChannelOverwrites(bit, overwrites, ctx) & bit) === bit;
}
