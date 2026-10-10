// Screen share ("Go Live") quality: resolution + frame rate, mapped to
// getDisplayMedia constraints and an RTCRtpSender bitrate cap. Pure; the
// voice service applies it and the picker remembers the last choice.

export const STREAM_RESOLUTIONS = [720, 1080, 1440, "source"] as const;
export const STREAM_FRAME_RATES = [15, 30, 60] as const;

export type StreamResolution = (typeof STREAM_RESOLUTIONS)[number];
export type StreamFrameRate = (typeof STREAM_FRAME_RATES)[number];

export interface StreamQuality {
  resolution: StreamResolution;
  frameRate: StreamFrameRate;
}

export const DEFAULT_STREAM_QUALITY: StreamQuality = { resolution: 720, frameRate: 30 };
export const STREAM_QUALITY_KEY = "serika-stream-quality";

export function normalizeStreamQuality(raw: unknown): StreamQuality {
  const v = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const resolution = (STREAM_RESOLUTIONS as readonly unknown[]).includes(v.resolution)
    ? (v.resolution as StreamResolution)
    : DEFAULT_STREAM_QUALITY.resolution;
  const frameRate = (STREAM_FRAME_RATES as readonly unknown[]).includes(v.frameRate)
    ? (v.frameRate as StreamFrameRate)
    : DEFAULT_STREAM_QUALITY.frameRate;
  return { resolution, frameRate };
}

/** Video constraints for getDisplayMedia / applyConstraints. */
export function displayMediaVideoConstraints(q: StreamQuality): MediaTrackConstraints {
  const out: MediaTrackConstraints & { cursor?: string } = {
    frameRate: { ideal: q.frameRate, max: q.frameRate },
    cursor: "always",
  };
  if (q.resolution !== "source") {
    const height = q.resolution;
    out.height = { ideal: height, max: height };
    out.width = { ideal: Math.round((height * 16) / 9), max: Math.round((height * 16) / 9) };
  }
  return out;
}

/**
 * Bitrate cap (bps) for the outgoing stream: enough for crisp text at the
 * chosen size without flooding a peer-to-peer uplink (each viewer gets its
 * own copy).
 */
export function streamMaxBitrate(q: StreamQuality): number {
  const pixels = q.resolution === "source" ? 1440 : q.resolution;
  const base = pixels >= 1440 ? 6_000_000 : pixels >= 1080 ? 4_000_000 : 2_500_000;
  const fpsFactor = q.frameRate >= 60 ? 1.5 : q.frameRate <= 15 ? 0.6 : 1;
  return Math.round(base * fpsFactor);
}

/** "detail" keeps text sharp; "motion" keeps 60 fps smooth (games, video). */
export function streamContentHint(q: StreamQuality): "detail" | "motion" {
  return q.frameRate >= 60 ? "motion" : "detail";
}

export function streamQualityLabel(q: StreamQuality, sourceLabel: string): string {
  const res = q.resolution === "source" ? sourceLabel : `${q.resolution}p`;
  return `${res} ${q.frameRate}fps`;
}

export function loadStreamQuality(): StreamQuality {
  try {
    if (typeof localStorage === "undefined") return DEFAULT_STREAM_QUALITY;
    return normalizeStreamQuality(JSON.parse(localStorage.getItem(STREAM_QUALITY_KEY) || "null"));
  } catch {
    return DEFAULT_STREAM_QUALITY;
  }
}

export function saveStreamQuality(q: StreamQuality) {
  try {
    localStorage.setItem(STREAM_QUALITY_KEY, JSON.stringify(normalizeStreamQuality(q)));
  } catch {
    // storage blocked
  }
}
