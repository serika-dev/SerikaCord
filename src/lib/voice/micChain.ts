/**
 * The microphone's processing chain, in one AudioContext: optional RNNoise
 * noise suppression (a small neural network compiled to WASM, run in an
 * AudioWorklet by @sapphi-red/web-noise-suppressor; files in
 * public/vendor/rnnoise, copied by scripts/sync-rnnoise.ts), then the input
 * gain. The voice service sends `track`; the raw device track feeds the chain
 * and has to stay enabled while it runs. Browser only.
 */
// The package is imported on demand: it subclasses AudioWorkletNode at load
// time, which doesn't exist during server rendering, and most people never
// turn RNNoise on.
type NoiseSuppressorModule = typeof import("@sapphi-red/web-noise-suppressor");
type RnnoiseNode = InstanceType<NoiseSuppressorModule["RnnoiseWorkletNode"]>;
const loadModule = () => import("@sapphi-red/web-noise-suppressor");

const RNNOISE_BASE = "/vendor/rnnoise";

let rnnoiseWasm: Promise<ArrayBuffer> | null = null;

/** Fetch the RNNoise WASM once (picks the SIMD build when supported); call early so a join doesn't wait on it. */
export function preloadRnnoise(): Promise<ArrayBuffer> {
  rnnoiseWasm ??= loadModule().then(({ loadRnnoise }) => loadRnnoise({ url: `${RNNOISE_BASE}/rnnoise.wasm`, simdUrl: `${RNNOISE_BASE}/rnnoise_simd.wasm` })).catch((err) => {
    rnnoiseWasm = null;
    throw err;
  });
  return rnnoiseWasm;
}

export interface MicChain {
  /** The processed track to send. */
  track: MediaStreamTrack;
  /** Whether RNNoise is actually running (false if it was asked for but couldn't load). */
  rnnoise: boolean;
  setGain(gain: number): void;
  close(): void;
}

/**
 * Build the chain around a raw mic track, or return null when there is
 * nothing to do (no RNNoise and unity gain): then the raw track is sent as is.
 * If RNNoise can't load (no AudioWorklet, WASM blocked), the chain is built
 * without it and `rnnoise` is false.
 */
export async function buildMicChain(raw: MediaStreamTrack, opts: { gain: number; rnnoise: boolean }): Promise<MicChain | null> {
  if (!opts.rnnoise && opts.gain === 1) return null;
  // RNNoise works on 48 kHz audio.
  const ctx = new AudioContext(opts.rnnoise ? { sampleRate: 48000 } : undefined);
  let denoiser: RnnoiseNode | null = null;
  try {
    const source = ctx.createMediaStreamSource(new MediaStream([raw]));
    let tail: AudioNode = source;
    if (opts.rnnoise) {
      try {
        const [{ RnnoiseWorkletNode }, wasmBinary] = await Promise.all([
          loadModule(),
          preloadRnnoise(),
          ctx.audioWorklet.addModule(`${RNNOISE_BASE}/rnnoiseWorklet.js`),
        ]);
        denoiser = new RnnoiseWorkletNode(ctx, { maxChannels: 2, wasmBinary });
        tail.connect(denoiser);
        tail = denoiser;
      } catch (err) {
        console.warn("[voice] RNNoise unavailable, sending the mic without it", err);
        denoiser = null;
      }
    }
    const gain = ctx.createGain();
    gain.gain.value = opts.gain;
    tail.connect(gain);
    const dest = ctx.createMediaStreamDestination();
    gain.connect(dest);
    const track = dest.stream.getAudioTracks()[0];
    if (!track) throw new Error("no output track");
    resumeWhenAllowed(ctx);
    return {
      track,
      rnnoise: denoiser !== null,
      setGain: (value) => { gain.gain.value = value; },
      close: () => {
        try { denoiser?.destroy(); } catch { /* already gone */ }
        void ctx.close().catch(() => {});
      },
    };
  } catch {
    try { denoiser?.destroy(); } catch { /* already gone */ }
    void ctx.close().catch(() => {});
    return null;
  }
}

/**
 * A context created outside a user gesture can start suspended, which would
 * send silence; resume now, and again on the next tap or key press if needed.
 */
function resumeWhenAllowed(ctx: AudioContext) {
  void ctx.resume().catch(() => {});
  if (ctx.state === "running") return;
  const retry = () => {
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    window.removeEventListener("pointerdown", retry, true);
    window.removeEventListener("keydown", retry, true);
  };
  window.addEventListener("pointerdown", retry, true);
  window.addEventListener("keydown", retry, true);
}
