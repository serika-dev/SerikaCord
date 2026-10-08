// Incoming-call ringtone: the intro plays once, then the loop repeats until the
// call is answered, declined or missed; a missed/cancelled call ends on the
// outro. Played through Web Audio so the loop repeats sample-accurately (an
// <audio loop> leaves a gap at every repeat). Files: public/sounds/<set>/.
import { getNotificationVolume, isDndActive, isNotificationSoundEnabled } from "./notificationUX";

type Part = "intro" | "loop" | "outro";

let ctx: AudioContext | null = null;
let playing: { gain: GainNode; sources: AudioBufferSourceNode[] } | null = null;
let generation = 0; // invalidates a start that is still loading when stop() is called
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
  if (!ctx && typeof window !== "undefined") {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
  }
  return ctx;
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

function output(ac: AudioContext): GainNode {
  const gain = ac.createGain();
  gain.gain.value = 0.8 * getNotificationVolume();
  gain.connect(ac.destination);
  return gain;
}

export async function startRingtone(): Promise<void> {
  stopRingtone();
  if (!isNotificationSoundEnabled() || isDndActive()) return;
  const ac = getCtx();
  if (!ac) return;
  const gen = ++generation;
  if (ac.state === "suspended") await ac.resume().catch(() => {});
  const [intro, loop] = await Promise.all([load(ac, "intro"), load(ac, "loop")]);
  void load(ac, "outro");
  if (gen !== generation || !intro || !loop) return;

  const gain = output(ac);
  const at = ac.currentTime + 0.05;
  const introSrc = ac.createBufferSource();
  introSrc.buffer = intro;
  introSrc.connect(gain);
  introSrc.start(at);
  const loopSrc = ac.createBufferSource();
  loopSrc.buffer = loop;
  loopSrc.loop = true;
  loopSrc.connect(gain);
  loopSrc.start(at + intro.duration);
  playing = { gain, sources: [introSrc, loopSrc] };
}

/**
 * Stop ringing. With `outro` (missed call / caller hung up) the closing phrase
 * plays; otherwise (answered / declined) it just fades out quickly.
 */
export function stopRingtone(outro = false): void {
  generation++;
  const current = playing;
  playing = null;
  const ac = ctx;
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

  if (outro) {
    void load(ac, "outro").then((buffer) => {
      if (!buffer || playing) return;
      const gain = output(ac);
      const src = ac.createBufferSource();
      src.buffer = buffer;
      src.connect(gain);
      src.onended = () => gain.disconnect();
      src.start();
    });
  }
}
