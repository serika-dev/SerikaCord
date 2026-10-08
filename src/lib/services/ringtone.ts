// Call ringtones.
//
// Incoming: the intro plays once, then the loop repeats until the call is
// answered, declined or missed; a missed/cancelled call ends on the outro.
// Outgoing (the caller's "ringback" while waiting for an answer): the same
// loop, quieter, with no intro or outro.
//
// Played through Web Audio so the loop repeats sample-accurately (an
// <audio loop> leaves a gap at every repeat). Files: public/sounds/<set>/.
// Like Discord, an incoming call rings even with message sounds off: only Do
// Not Disturb / quiet hours and the "Incoming call ringtone" switch silence it.
// The outgoing ringback always plays (it's feedback, not a notification).
// Loudness follows the notification volume with a floor (ringVolume).
//
// Audio goes through the app's shared AudioContext (notificationUX), which is
// unlocked by the first click/key press anywhere. A tab that was never
// interacted with can't play sound at all: startRingtone then reports it was
// blocked and starts ringing as soon as the user touches the page.
import {
  getAudioContext,
  getNotificationVolume,
  isCallRingtoneEnabled,
  isDndActive,
  onAudioUnlocked,
} from "./notificationUX";
import { ringAllowed, ringVolume, type RingKind } from "@/lib/voice/callState";

type Part = "intro" | "loop" | "outro";
export type { RingKind };

const KIND_GAIN: Record<RingKind, number> = { incoming: 0.8, outgoing: 0.4 };

const playing = new Map<RingKind, { gain: GainNode; sources: AudioBufferSourceNode[] }>();
// Invalidates a start that is still loading when stop() is called.
const generation: Record<RingKind, number> = { incoming: 0, outgoing: 0 };
const buffers = new Map<string, Promise<AudioBuffer | null>>();

/** The Halloween ringtone plays through October. */
function ringtoneSet(): string {
  return new Date().getMonth() === 9 ? "ringtone-halloween" : "ringtone";
}

// Ogg Vorbis loops gaplessly; MP3 carries encoder padding, so it's only the
// fallback for browsers that can't decode Vorbis.
function extension(): "ogg" | "mp3" {
  if (typeof Audio === "undefined") return "mp3";
  return new Audio().canPlayType('audio/ogg; codecs="vorbis"') ? "ogg" : "mp3";
}

function getCtx(): AudioContext | null {
  return getAudioContext();
}

// A ring that's waiting for the page to be clicked before it can be heard.
const pendingUnlock: Partial<Record<RingKind, () => void>> = {};

/** resume() never settles in some browsers without a gesture: don't wait forever. */
async function tryResume(ac: AudioContext): Promise<boolean> {
  if (ac.state === "running") return true;
  await Promise.race([ac.resume().catch(() => {}), new Promise((r) => setTimeout(r, 300))]);
  return (ac.state as AudioContextState) === "running";
}

function load(ac: AudioContext, part: Part): Promise<AudioBuffer | null> {
  const url = `/sounds/${ringtoneSet()}/${part}.${extension()}`;
  let buffer = buffers.get(url);
  if (!buffer) {
    buffer = fetch(url)
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(`${res.status}`))))
      .then((data) => ac.decodeAudioData(data))
      .catch(() => {
        buffers.delete(url); // let a later ring retry
        return null;
      });
    buffers.set(url, buffer);
  }
  return buffer;
}

function output(ac: AudioContext, kind: RingKind): GainNode {
  const gain = ac.createGain();
  gain.gain.value = KIND_GAIN[kind] * ringVolume(getNotificationVolume());
  gain.connect(ac.destination);
  return gain;
}

export function isRinging(kind: RingKind = "incoming"): boolean {
  return playing.has(kind);
}

export type RingResult = "playing" | "silent" | "blocked";

/**
 * Start ringing. Resolves "playing", "silent" (DND / turned off — not an
 * error) or "blocked" (the browser won't play sound until the page is
 * clicked; the ring then starts on that click if it's still wanted).
 */
export async function startRingtone(kind: RingKind = "incoming"): Promise<RingResult> {
  stopRingtone(false, kind);
  if (!ringAllowed(kind, { ringtoneEnabled: isCallRingtoneEnabled(), dnd: isDndActive() })) return "silent";
  const ac = getCtx();
  if (!ac) return "blocked";
  const gen = ++generation[kind];
  const withIntro = kind === "incoming";
  // Start fetching while we find out whether we may play.
  const parts = Promise.all([withIntro ? load(ac, "intro") : Promise.resolve(null), load(ac, "loop")]);
  if (!(await tryResume(ac))) {
    if (gen !== generation[kind]) return "silent";
    pendingUnlock[kind] = onAudioUnlocked(() => {
      delete pendingUnlock[kind];
      if (gen === generation[kind]) void play(ac, kind, gen, withIntro, parts);
    });
    return "blocked";
  }
  return (await play(ac, kind, gen, withIntro, parts)) ? "playing" : "silent";
}

async function play(
  ac: AudioContext,
  kind: RingKind,
  gen: number,
  withIntro: boolean,
  parts: Promise<[AudioBuffer | null, AudioBuffer | null]>,
): Promise<boolean> {
  const [intro, loop] = await parts;
  if (withIntro) void load(ac, "outro");
  if (gen !== generation[kind] || !loop || (withIntro && !intro)) return false;

  const gain = output(ac, kind);
  const at = ac.currentTime + 0.05;
  const sources: AudioBufferSourceNode[] = [];
  let loopAt = at;
  if (intro) {
    const introSrc = ac.createBufferSource();
    introSrc.buffer = intro;
    introSrc.connect(gain);
    introSrc.start(at);
    sources.push(introSrc);
    loopAt = at + intro.duration;
  }
  const loopSrc = ac.createBufferSource();
  loopSrc.buffer = loop;
  loopSrc.loop = true;
  loopSrc.connect(gain);
  loopSrc.start(loopAt);
  sources.push(loopSrc);
  playing.set(kind, { gain, sources });
  return true;
}

/**
 * Stop ringing. With `outro` (missed call / caller hung up) the closing phrase
 * plays; otherwise (answered / declined) it just fades out quickly.
 */
export function stopRingtone(outro = false, kind: RingKind = "incoming"): void {
  generation[kind]++;
  pendingUnlock[kind]?.();
  delete pendingUnlock[kind];
  const current = playing.get(kind);
  playing.delete(kind);
  const ac = current ? getCtx() : null;
  if (!current || !ac) return;

  const now = ac.currentTime;
  const fade = outro ? 0.6 : 0.25;
  current.gain.gain.setValueAtTime(current.gain.gain.value, now);
  current.gain.gain.linearRampToValueAtTime(0, now + fade);
  for (const src of current.sources) {
    try {
      src.stop(now + fade + 0.05);
    } catch {
      // already stopped
    }
  }
  setTimeout(() => current.gain.disconnect(), (fade + 0.2) * 1000);

  if (outro && kind === "incoming") {
    void load(ac, "outro").then((buffer) => {
      if (!buffer || playing.has(kind)) return;
      const gain = output(ac, kind);
      const src = ac.createBufferSource();
      src.buffer = buffer;
      src.connect(gain);
      src.onended = () => gain.disconnect();
      src.start();
    });
  }
}
