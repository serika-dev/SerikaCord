// Picking local media for a call. Pure (no browser APIs) so it is unit tested;
// voiceService does the actual getUserMedia calls.
//
// Not having a microphone (none plugged in, permission refused, held by another
// app) no longer stops you from joining: you join "listen-only" and can still
// hear and see everyone. Only failures that make the call itself impossible
// (an insecure page, a broken browser API) are real errors.

export type MediaRequest = { audio: boolean; video: boolean };

/**
 * getUserMedia requests to try, best first. With video: mic + camera, then mic
 * only, then camera only. Without: mic only. If every one fails with a device
 * error, the join goes ahead with no local media (listen-only).
 */
export function mediaAttempts(withVideo: boolean): MediaRequest[] {
  return withVideo
    ? [{ audio: true, video: true }, { audio: true, video: false }, { audio: false, video: true }]
    : [{ audio: true, video: false }];
}

const DEVICE_ERRORS = new Set([
  // No such device / constraints can't be met.
  "NotFoundError",
  "DevicesNotFoundError",
  "OverconstrainedError",
  "ConstraintNotSatisfiedError",
  // Permission refused (by the user or the browser).
  "NotAllowedError",
  "PermissionDeniedError",
  // Device busy or failed to start.
  "NotReadableError",
  "TrackStartError",
  "AbortError",
]);

/** A getUserMedia failure you can still join a call after (listen-only). */
export function isListenOnlyError(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name;
  return typeof name === "string" && DEVICE_ERRORS.has(name);
}

export type MicIssue = "mic-missing" | "mic-busy" | "mic-denied";

/** Why there's no mic, for the listen-only notice. */
export function micIssue(err: unknown): MicIssue {
  const name = (err as { name?: unknown } | null)?.name;
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
    return "mic-missing";
  }
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") return "mic-busy";
  return "mic-denied";
}

/**
 * What to tell the user after picking media: whether they're listen-only, and
 * whether the camera they asked for is missing (only worth saying when the mic
 * worked; otherwise the listen-only notice covers it).
 */
export function mediaOutcome(opts: { wantVideo: boolean; gotAudio: boolean; gotVideo: boolean }): {
  listenOnly: boolean;
  cameraMissing: boolean;
} {
  return {
    listenOnly: !opts.gotAudio,
    cameraMissing: opts.wantVideo && !opts.gotVideo && opts.gotAudio,
  };
}
