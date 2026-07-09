"use client";

/**
 * Advanced client-side Text-to-Speech engine.
 *
 * Features:
 *  - Multi-speaker: inline [m], [f], [steven], [fish:xxx] tags throughout text
 *  - Speed control: [2x], [slow], [fast], [turbo]
 *  - Volume control: [vol:50], [vol:100]
 *  - Voice personas: [steven], [robot], [narrator]
 *  - Accent voices: [f-scottish], [m-dutch], [japanese]
 *  - FishAudio: [fish:miku], [fish:model-id] — high-quality AI voices via proxy
 *  - Firefox fallback: auto-uses FishAudio on Firefox (Web Speech is broken there)
 *  - Sound triggers: trigger words play sound effects mid-speech with auto-pause
 *
 * Everything runs in the browser (Web Speech + HTMLAudio + FishAudio proxy).
 */

export type TtsVoiceGender = "auto" | "female" | "male";

// ─── Voice persona system ───────────────────────────────────────────────────
// Users can stack inline modifiers anywhere in a /tts message:
//   /tts [f][2x] hello       → female voice at 2× speed
//   /tts [steven] hello       → Stephen Hawking style robotic voice
//   /tts [f-scottish] hello   → female Scottish-accented voice
//   /tts [m-dutch] hallo      → male Dutch-language voice
//   /tts [m] whoa nice day [f] ik right  → multi-speaker dialogue
//   /tts [fish:miku] hello    → FishAudio AI voice
//   /tts [vol:50] quiet       → 50% volume

interface VoicePersona {
  gender?: TtsVoiceGender;
  /** BCP-47 language prefix, e.g. "en-GB", "nl", "de". */
  lang?: string;
  /** Preferred voice-name substrings (highest priority match). */
  nameHints?: string[];
  /** Rate multiplier override. */
  rate?: number;
  /** Pitch override (0–2, default 1). */
  pitch?: number;
  description: string;
}

// Speed keywords: [2x], [1.5x], [slow], [fast], [double], etc.
const SPEED_KEYWORDS: Record<string, number> = {
  "0.25x": 0.25, "0.5x": 0.5, half: 0.5, slow: 0.75, "0.75x": 0.75,
  "1x": 1, normal: 1,
  "1.25x": 1.25, "1.5x": 1.5, fast: 1.5, "1.75x": 1.75,
  "2x": 2, double: 2, "2.5x": 2.5, "3x": 3, turbo: 3,
};

// Named personas — special voice characters.
const NAMED_PERSONAS: Record<string, VoicePersona> = {
  steven: {
    gender: "male",
    rate: 0.85,
    pitch: 0.3,
    nameHints: ["fred", "paul", "daniel", "david", "rishi"],
    description: "Stephen Hawking style robotic voice",
  },
  robot: {
    gender: "male",
    rate: 0.9,
    pitch: 0.2,
    nameHints: ["fred", "paul", "daniel"],
    description: "Robotic monotone voice",
  },
  narrator: {
    gender: "male",
    rate: 0.95,
    pitch: 0.9,
    nameHints: ["daniel", "david", "arthur", "oliver", "google uk english male"],
    description: "Deep narrator voice",
  },
};

// Accent → language code mapping for [gender-accent] and [accent] modifiers.
const ACCENT_MAP: Record<string, { lang: string; hints?: string[] }> = {
  scottish: { lang: "en-GB", hints: ["fiona", "moira"] },
  british: { lang: "en-GB", hints: ["daniel", "kate", "serena", "hazel"] },
  english: { lang: "en-GB" },
  uk: { lang: "en-GB" },
  american: { lang: "en-US", hints: ["samantha", "alex", "victoria", "aaron"] },
  us: { lang: "en-US" },
  australian: { lang: "en-AU", hints: ["karen", "catherine", "lee"] },
  aussie: { lang: "en-AU", hints: ["karen", "catherine", "lee"] },
  irish: { lang: "en-IE", hints: ["moira"] },
  indian: { lang: "en-IN", hints: ["heera", "raveena", "ishaan"] },
  dutch: { lang: "nl", hints: ["xander", "lotte", "ruben", "ellen"] },
  german: { lang: "de", hints: ["anna", "maximilian", "hans", "yannick"] },
  french: { lang: "fr", hints: ["amelie", "thomas", "julie", "paul"] },
  spanish: { lang: "es", hints: ["monica", "jorge", "lucia", "diego"] },
  italian: { lang: "it", hints: ["alice", "luca", "federica"] },
  japanese: { lang: "ja", hints: ["kyoko", "yuki", "otoya"] },
  korean: { lang: "ko", hints: ["yuna", "minji", "insuk"] },
  chinese: { lang: "zh", hints: ["tingting", "mei", "liang"] },
  portuguese: { lang: "pt", hints: ["luciana", "felipe", "joana"] },
  russian: { lang: "ru", hints: ["milena", "yuri", "dmitri"] },
  polish: { lang: "pl", hints: ["zosia", "krzysztof"] },
  swedish: { lang: "sv", hints: ["alva", "oskar"] },
  turkish: { lang: "tr", hints: ["filiz", "tolga"] },
  hindi: { lang: "hi", hints: ["heera", "swara", "hemant"] },
  arabic: { lang: "ar", hints: ["salma", "naayf"] },
};

// Gender keywords for standalone [f], [m], etc.
const GENDER_KEYWORDS: Record<string, TtsVoiceGender> = {
  f: "female", female: "female", girl: "female", woman: "female", she: "female", her: "female",
  m: "male", male: "male", boy: "male", man: "male", he: "male", him: "male",
};

// ─── TTS voice presets (fetched from API) ───────────────────────────────────
// Admins configure custom voices in the DB. Clients fetch them via /api/tts-voices
// and resolve preset names like [fish:miku] or [se:Brian] to provider IDs.

interface TtsVoicePreset {
  name: string;
  provider: string; // "fish" | "streamelements" | "se"
  referenceId: string;
  isDefault: boolean;
}

let cachedVoices: TtsVoicePreset[] = [];
let voiceCacheAt = 0;
let voiceInflight: Promise<TtsVoicePreset[]> | null = null;
const VOICE_CACHE_TTL = 60_000;

async function getTtsVoices(force = false): Promise<TtsVoicePreset[]> {
  if (typeof window === "undefined") return [];
  const fresh = cachedVoices.length > 0 && Date.now() - voiceCacheAt < VOICE_CACHE_TTL;
  if (!force && fresh) return cachedVoices;
  if (voiceInflight) return voiceInflight;

  voiceInflight = (async () => {
    try {
      const res = await fetch("/api/tts-voices");
      if (!res.ok) return cachedVoices;
      const data = await res.json();
      const voices = (data.voices || []) as TtsVoicePreset[];
      cachedVoices = voices;
      voiceCacheAt = Date.now();
      return voices;
    } catch {
      return cachedVoices;
    } finally {
      voiceInflight = null;
    }
  })();
  return voiceInflight;
}

export function invalidateTtsVoices(): void {
  cachedVoices = [];
  voiceCacheAt = 0;
}

// ─── Firefox detection ──────────────────────────────────────────────────────
// Firefox's Web Speech implementation is buggy: it reads letters individually
// and only has low-quality system voices. We auto-fallback to a cloud TTS.
function isFirefox(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.userAgent.toLowerCase().includes("firefox");
}

// ─── Modifier parsing ───────────────────────────────────────────────────────

interface ParsedModifier {
  gender?: TtsVoiceGender;
  rate?: number;
  pitch?: number;
  volume?: number; // 0-5 (500%)
  bassBoost?: boolean;
  earRape?: boolean;
  persona?: VoicePersona;
  fishReferenceId?: string;
}

function parseModifier(keyword: string, voices?: TtsVoicePreset[]): ParsedModifier | null {
  // Fish Audio: [fish:miku], [fish:model-id]
  const fishMatch = keyword.match(/^fish:(.+)$/);
  if (fishMatch) {
    const id = fishMatch[1].trim();
    const preset = voices?.find((v) => v.name === id.toLowerCase() && v.provider === "fish");
    return { fishReferenceId: preset?.referenceId || id };
  }

  // Volume: [vol:50], [vol:500], [vol:BASS], [volume:75]
  const volMatch = keyword.match(/^vol(?:ume)?:(.+)$/);
  if (volMatch) {
    const val = volMatch[1].trim().toUpperCase();
    if (val === "BASS") return { bassBoost: true, volume: 1 };
    if (val === "EAR") return { earRape: true, volume: 5 };
    const vol = parseInt(val);
    if (!isNaN(vol)) return { volume: Math.min(5, Math.max(0, vol / 100)) };
  }

  // Speed: [2x], [1.5x], [0.5x]
  const speedMatch = keyword.match(/^(\d+(?:\.\d+)?)x$/);
  if (speedMatch) {
    const speed = parseFloat(speedMatch[1]);
    if (speed >= 0.25 && speed <= 4) return { rate: speed };
  }

  // Speed keywords: [slow], [fast], [double], etc.
  if (keyword in SPEED_KEYWORDS) return { rate: SPEED_KEYWORDS[keyword] };

  // Named personas: [steven], [robot], [narrator]
  if (keyword in NAMED_PERSONAS) return { persona: NAMED_PERSONAS[keyword] };

  // Gender-accent: [f-scottish], [m-dutch], [female-british]
  const accentMatch = keyword.match(/^(?:female|male|[fm])-(.+)$/);
  if (accentMatch) {
    const genderRaw = keyword.split("-")[0];
    const gender: TtsVoiceGender = genderRaw === "f" || genderRaw === "female" ? "female" : "male";
    const accent = accentMatch[1];
    if (ACCENT_MAP[accent]) {
      const a = ACCENT_MAP[accent];
      return {
        gender,
        persona: {
          gender,
          lang: a.lang,
          nameHints: a.hints,
          description: `${gender} ${accent} voice`,
        },
      };
    }
  }

  // Standalone accent: [scottish], [dutch], [british]
  if (keyword in ACCENT_MAP) {
    const a = ACCENT_MAP[keyword];
    return {
      persona: {
        lang: a.lang,
        nameHints: a.hints,
        description: `${keyword} voice`,
      },
    };
  }

  // Gender keywords: [f], [m], [female], [male]
  if (keyword in GENDER_KEYWORDS) return { gender: GENDER_KEYWORDS[keyword] };

  return null;
}

export interface TtsSoundTrigger {
  triggerWord: string;
  path: string;
}

export interface PlayTtsOptions {
  /** Raw message content (may include mentions / emoji tokens / markdown). */
  content: string;
  /** Author display name, spoken as `<name> said "<text>"`. */
  authorName?: string;
  /** Reading speed 0.5–2.0 (SpeechSynthesis rate). Default 1. */
  rate?: number;
  /** Preferred voice gender. Default "auto". */
  voiceGender?: TtsVoiceGender;
  /** Speak the message text after any sound triggers. Default true. */
  speak?: boolean;
}

// ─── Sound-trigger cache ────────────────────────────────────────────────────
let cachedSounds: TtsSoundTrigger[] | null = null;
let cacheAt = 0;
let inflight: Promise<TtsSoundTrigger[]> | null = null;
const SOUND_CACHE_TTL = 60_000; // 1 minute

/** Fetch (and cache) the configured sound triggers. Best-effort. */
export async function getTtsSounds(force = false): Promise<TtsSoundTrigger[]> {
  if (typeof window === "undefined") return [];
  const fresh = cachedSounds && Date.now() - cacheAt < SOUND_CACHE_TTL;
  if (!force && fresh) return cachedSounds!;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch("/api/tts-sounds");
      if (!res.ok) return cachedSounds ?? [];
      const data = await res.json();
      const sounds = (data.sounds || []) as TtsSoundTrigger[];
      cachedSounds = sounds;
      cacheAt = Date.now();
      return sounds;
    } catch {
      return cachedSounds ?? [];
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Invalidate the cache (call after admin edits so changes apply immediately). */
export function invalidateTtsSounds(): void {
  cachedSounds = null;
  cacheAt = 0;
}

// ─── Fish Audio client ──────────────────────────────────────────────────────

/**
 * Generate speech via the Fish Audio proxy and play it.
 * Falls back to Web Speech if the proxy fails.
 */
async function playFishAudio(
  text: string,
  referenceId: string,
  speed?: number,
  volume?: number,
  bassBoost?: boolean,
  earRape?: boolean,
): Promise<void> {
  try {
    const res = await fetch("/api/tts/fish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        reference_id: referenceId,
        speed: speed ?? 1,
        volume: 0,
      }),
    });
    if (!res.ok) throw new Error(`Fish Audio error: ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    await playSingleSound(url, volume ?? 1, bassBoost ?? false, earRape ?? false);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("Fish Audio playback failed, falling back to Web Speech:", err);
    await speakSegment(text, speed ?? 1, null, 1, volume ?? 1, bassBoost ?? false, earRape ?? false);
  }
}

// ─── Voice selection ────────────────────────────────────────────────────────
// getVoices() is often empty until the async "voiceschanged" event fires, so
// resolve voices via a short promise on first use.
function getVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      resolve([]);
      return;
    }
    const existing = window.speechSynthesis.getVoices();
    if (existing.length > 0) {
      resolve(existing);
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener("voiceschanged", finish, { once: true });
    // Fallback in case the event never fires.
    setTimeout(finish, 500);
  });
}

// Comprehensive voice-name hints for gender matching (English-only voices).
const FEMALE_HINTS = [
  "female", "woman", "samantha", "victoria", "karen", "moira", "tessa", "fiona",
  "zira", "hazel", "susan", "allison", "ava", "catherine", "celine", "ellen",
  "google uk english female", "google us english", "serena", "kate", "sally",
  "joanna", "kendra", "sage", "jenny", "aria", "nancy", "amber",
];
const MALE_HINTS = [
  "male", "man", "daniel", "alex", "fred", "david", "george", "james", "guy",
  "mark", "oliver", "arthur", "thomas", "google uk english male",
  "brian", "matthew", "justin", "ryan", "ethan", "guy", "reed",
];

async function pickVoice(
  gender: TtsVoiceGender,
  persona?: VoicePersona | null,
): Promise<SpeechSynthesisVoice | null> {
  const voices = await getVoices();
  if (voices.length === 0) return null;

  // Determine language filter from persona, otherwise default to English.
  const langFilter = persona?.lang?.toLowerCase();
  let pool = langFilter
    ? voices.filter((v) => v.lang?.toLowerCase().startsWith(langFilter))
    : voices.filter((v) => v.lang?.toLowerCase().startsWith("en"));

  // Fallback to all voices if the language filter yields nothing.
  // If a specific language was requested (persona.lang), return null so the
  // caller can fall back to FishAudio instead of using the wrong language.
  if (pool.length === 0) {
    if (langFilter) return null;
    pool = voices;
  }

  // If the persona has explicit name hints, try exact-match first. This gives
  // deterministic results across users with the same voice set.
  if (persona?.nameHints && persona.nameHints.length > 0) {
    // Sort pool by name for deterministic selection.
    const sorted = [...pool].sort((a, b) => a.name.localeCompare(b.name));
    for (const hint of persona.nameHints) {
      const match = sorted.find((v) => v.name.toLowerCase().includes(hint));
      if (match) return match;
    }
  }

  // Determine effective gender for scoring.
  const effectiveGender = persona?.gender ?? gender;

  if (effectiveGender === "auto") {
    // Deterministic: prefer default voice, then first by name.
    const sorted = [...pool].sort((a, b) => a.name.localeCompare(b.name));
    return sorted.find((v) => v.default) ?? sorted[0] ?? null;
  }

  const hints = effectiveGender === "female" ? FEMALE_HINTS : MALE_HINTS;
  const oppositeHints = effectiveGender === "female" ? MALE_HINTS : FEMALE_HINTS;

  // Deterministic scoring: sort by name first so ties break consistently.
  // This ensures all users with the same voice set hear the same voice.
  const sortedPool = [...pool].sort((a, b) => a.name.localeCompare(b.name));

  const scored = sortedPool
    .map((v) => {
      const name = v.name.toLowerCase();
      const matchesHint = hints.some((h) => name.includes(h));
      const matchesOpposite = oppositeHints.some((h) => name.includes(h));
      const isLocal = v.localService;
      // Strongly prefer high-quality voices: Google, Microsoft Natural,
      // Apple Enhanced/Premium — these sound far better than basic system voices.
      const isHighQuality =
        name.includes("natural") || name.includes("premium") ||
        name.includes("enhanced") || name.includes("google") ||
        name.includes("microsoft") || name.includes("neural");
      let score = 0;
      if (matchesHint) score += 5;
      if (matchesOpposite) score -= 3;
      if (isLocal) score += 1;
      if (isHighQuality) score += 3;
      return { v, score };
    })
    .sort((a, b) => b.score - a.score);

  // Use the best match if it has a positive score, otherwise fall back deterministically.
  return scored[0]?.score > 0
    ? scored[0].v
    : sortedPool.find((v) => v.default) ?? sortedPool[0] ?? null;
}

// ─── Multi-speaker content parsing ──────────────────────────────────────────

export interface SpeechSegment {
  text: string;
  gender: TtsVoiceGender | null;
  rate: number | null;
  pitch: number | null;
  volume: number | null;
  bassBoost: boolean;
  earRape: boolean;
  persona: VoicePersona | null;
  fishReferenceId: string | null;
}

function cleanText(text: string): string {
  return text
    .replace(/<(a)?:[a-zA-Z0-9_]+:[a-f0-9-]+>/gi, "")
    .replace(/<@!?[a-f0-9-]+>/gi, "")
    .replace(/<@&[a-f0-9-]+>/gi, "")
    .replace(/<#[a-f0-9-]+>/gi, "")
    .replace(/<t:[^>]+>/gi, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[*_~`#>|]/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/**
 * Parse a /tts message into multi-speaker segments.
 *
 * Leading [xxx] modifiers set defaults. Inline [xxx] tags throughout the text
 * change the speaker/speed/volume for subsequent text.
 *
 * Example:
 *   /tts [m] whoa what a nice day [f] ik right its amazing
 *   → [
 *       { text: "whoa what a nice day", gender: "male", ... },
 *       { text: "ik right its amazing", gender: "female", ... },
 *     ]
 */
export function parseTtsContent(raw: string, voices?: TtsVoicePreset[]): SpeechSegment[] {
  let withoutPrefix = raw.startsWith("/tts ") ? raw.slice(5) : raw;

  // Defaults from leading modifiers.
  let defGender: TtsVoiceGender | null = null;
  let defRate: number | null = null;
  let defPitch: number | null = null;
  let defVolume: number | null = null;
  let defPersona: VoicePersona | null = null;
  let defFishId: string | null = null;
  let defBassBoost = false;
  let defEarRape = false;

  let modMatch: RegExpMatchArray | null;
  while ((modMatch = withoutPrefix.match(/^\s*\[([^\]]+)\]\s*/))) {
    const keyword = modMatch[1].toLowerCase().trim();
    const mod = parseModifier(keyword, voices);
    if (!mod) break;
    if (mod.gender) defGender = mod.gender;
    if (mod.rate !== undefined) defRate = mod.rate;
    if (mod.pitch !== undefined) defPitch = mod.pitch;
    if (mod.volume !== undefined) defVolume = mod.volume;
    if (mod.persona) {
      defPersona = mod.persona;
      if (mod.persona.gender && !defGender) defGender = mod.persona.gender;
      if (mod.persona.rate !== undefined && defRate === null) defRate = mod.persona.rate;
      if (mod.persona.pitch !== undefined && defPitch === null) defPitch = mod.persona.pitch;
    }
    if (mod.fishReferenceId) defFishId = mod.fishReferenceId;
    if (mod.bassBoost) defBassBoost = true;
    if (mod.earRape) defEarRape = true;
    withoutPrefix = withoutPrefix.slice(modMatch[0].length);
  }

  // Current state (starts with defaults, updated by inline tags).
  let curGender = defGender;
  let curRate = defRate;
  let curPitch = defPitch;
  let curVolume = defVolume;
  let curPersona = defPersona;
  let curFishId = defFishId;
  let curBassBoost = defBassBoost;
  let curEarRape = defEarRape;

  const segments: SpeechSegment[] = [];
  let cursor = 0;
  const inlineRe = /\[([^\]]+)\]/g;
  let inlineMatch: RegExpExecArray | null;

  while ((inlineMatch = inlineRe.exec(withoutPrefix)) !== null) {
    const keyword = inlineMatch[1].toLowerCase().trim();
    const mod = parseModifier(keyword, voices);
    if (!mod) continue;

    const textBefore = withoutPrefix.slice(cursor, inlineMatch.index);
    const cleaned = cleanText(textBefore);
    segments.push({
      text: cleaned,
      gender: curGender,
      rate: curRate,
      pitch: curPitch,
      volume: curVolume,
      persona: curPersona,
      fishReferenceId: curFishId,
      bassBoost: curBassBoost,
      earRape: curEarRape,
    });

    if (mod.gender) curGender = mod.gender;
    if (mod.rate !== undefined) curRate = mod.rate;
    if (mod.pitch !== undefined) curPitch = mod.pitch;
    if (mod.volume !== undefined) curVolume = mod.volume;
    if (mod.persona) {
      curPersona = mod.persona;
      if (mod.persona.gender) curGender = mod.persona.gender;
      if (mod.persona.rate !== undefined) curRate = mod.persona.rate;
      if (mod.persona.pitch !== undefined) curPitch = mod.persona.pitch;
    }
    if (mod.fishReferenceId) {
      curFishId = mod.fishReferenceId;
      curPersona = null;
    }
    if (mod.bassBoost) curBassBoost = true;
    if (mod.earRape) curEarRape = true;

    cursor = inlineMatch.index + inlineMatch[0].length;
  }

  const remaining = withoutPrefix.slice(cursor);
  const cleanedRemaining = cleanText(remaining);
  segments.push({
    text: cleanedRemaining,
    gender: curGender,
    rate: curRate,
    pitch: curPitch,
    volume: curVolume,
    persona: curPersona,
    fishReferenceId: curFishId,
    bassBoost: curBassBoost,
    earRape: curEarRape,
  });

  const nonEmpty = segments.filter((s) => s.text);
  if (nonEmpty.length === 0) return [];
  return nonEmpty;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Find the sound-trigger groups present in `text`. Returns one random sound
 * path per OCCURRENCE of each trigger word (so "meow meow" plays TWO random
 * meows — each independently picked from the meow group, so you can get
 * meow1+meow3, meow2+meow2, etc.). "meow woof" plays one meow + one woof.
 */
export function resolveTriggeredSounds(text: string, sounds: TtsSoundTrigger[]): string[] {
  if (!text || sounds.length === 0) return [];
  const lower = text.toLowerCase();

  // Build trigger → paths map once.
  const groups = new Map<string, string[]>();
  for (const s of sounds) {
    const trigger = s.triggerWord.toLowerCase();
    if (!trigger) continue;
    if (!groups.has(trigger)) groups.set(trigger, []);
    groups.get(trigger)!.push(s.path);
  }

  const chosen: string[] = [];
  for (const [trigger, paths] of groups) {
    // Find ALL occurrences of this trigger word in the text.
    const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(trigger)}([^a-z0-9]|$)`, "gi");
    let match: RegExpExecArray | null;
    while ((match = re.exec(lower)) !== null) {
      // Pick a random sound from this group for each occurrence.
      chosen.push(paths[Math.floor(Math.random() * paths.length)]);
      // Avoid zero-length loop on overlapping matches.
      if (match.index === re.lastIndex) re.lastIndex++;
    }
  }
  return chosen;
}

// ─── Segment-based playback ──────────────────────────────────────────────────
// The advanced engine splits the text at sound-trigger positions so that each
// sound effect plays at the exact moment its trigger word would be spoken.
// Speech is paused for the duration of the sound, then resumes seamlessly.

interface TtsSegment {
  /** Text to speak (may be empty if this segment is only a sound). */
  text: string;
  /** Sound path to play AFTER speaking `text` (null = no sound). */
  soundPath: string | null;
}

/**
 * Split `text` into ordered segments around trigger-word occurrences.
 * Each trigger word is replaced by a sound segment — the word itself is not
 * spoken, the sound effect takes its place.
 *
 *   "hello meow world" → [
 *     { text: "hello ",       soundPath: null },
 *     { text: "",             soundPath: "/meow1.mp3" },
 *     { text: " world",       soundPath: null },
 *   ]
 */
function splitTextByTriggers(text: string, sounds: TtsSoundTrigger[]): TtsSegment[] {
  if (!text || sounds.length === 0) return [{ text, soundPath: null }];

  const lower = text.toLowerCase();

  // Build trigger → paths map.
  const groups = new Map<string, string[]>();
  for (const s of sounds) {
    const trigger = s.triggerWord.toLowerCase();
    if (!trigger) continue;
    if (!groups.has(trigger)) groups.set(trigger, []);
    groups.get(trigger)!.push(s.path);
  }

  // Find all trigger occurrences with precise word boundaries.
  interface Hit { start: number; end: number; soundPath: string; }
  const hits: Hit[] = [];

  for (const [trigger, paths] of groups) {
    const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(trigger)}([^a-z0-9]|$)`, "gi");
    let match: RegExpExecArray | null;
    while ((match = re.exec(lower)) !== null) {
      const wordStart = match.index + match[1].length;
      const wordEnd = wordStart + trigger.length;
      hits.push({
        start: wordStart,
        end: wordEnd,
        soundPath: paths[Math.floor(Math.random() * paths.length)],
      });
      if (match.index === re.lastIndex) re.lastIndex++;
    }
  }

  if (hits.length === 0) return [{ text, soundPath: null }];

  // Sort by position and remove overlaps (keep earliest).
  hits.sort((a, b) => a.start - b.start);
  const nonOverlapping: Hit[] = [];
  let lastEnd = 0;
  for (const hit of hits) {
    if (hit.start >= lastEnd) {
      nonOverlapping.push(hit);
      lastEnd = hit.end;
    }
  }

  // Build segments.
  const segments: TtsSegment[] = [];
  let cursor = 0;
  for (const hit of nonOverlapping) {
    if (hit.start > cursor) {
      segments.push({ text: text.slice(cursor, hit.start), soundPath: null });
    }
    segments.push({ text: "", soundPath: hit.soundPath });
    cursor = hit.end;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), soundPath: null });
  }

  return segments;
}

/** Play a single audio file. Resolves when playback finishes (or fails).
 * Supports volume > 1 (amplification), bass boost, and ear rape via Web Audio API. */
function playSingleSound(path: string, volume: number = 1, bassBoost: boolean = false, earRape: boolean = false): Promise<void> {
  return new Promise<void>((resolve) => {
    if (volume <= 1 && !bassBoost && !earRape) {
      // Simple path — no Web Audio graph needed.
      try {
        const audio = new Audio(path);
        audio.volume = Math.min(1, Math.max(0, volume));
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
        const p = audio.play();
        if (p && typeof p.catch === "function") p.catch(() => resolve());
      } catch {
        resolve();
      }
      return;
    }

    // Web Audio API path: fetch → decode → AudioBufferSourceNode → filters → destination
    (async () => {
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioCtx();
        if (ctx.state === "suspended") {
          await ctx.resume().catch(() => {});
        }

        // Fetch and decode the audio data
        const res = await fetch(path);
        const arrayBuffer = await res.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;

        const gain = ctx.createGain();
        // Ear rape: very loud but still intelligible
        gain.gain.value = earRape ? 8 : volume;

        if (earRape) {
          // Heavy distortion via WaveShaperNode
          const distortion = ctx.createWaveShaper();
          const curve = new Float32Array(44100);
          for (let i = 0; i < curve.length; i++) {
            const x = (i * 2) / curve.length - 1;
            curve[i] = Math.tanh(x * 10); // strong clipping, not total destruction
          }
          distortion.curve = curve;
          distortion.oversample = "4x";

          // Aggressive bass boost
          const lowShelf = ctx.createBiquadFilter();
          lowShelf.type = "lowshelf";
          lowShelf.frequency.value = 100;
          lowShelf.gain.value = 25;

          // Treble boost for harshness
          const highShelf = ctx.createBiquadFilter();
          highShelf.type = "highshelf";
          highShelf.frequency.value = 3000;
          highShelf.gain.value = 10;

          source.connect(distortion);
          distortion.connect(lowShelf);
          lowShelf.connect(highShelf);
          highShelf.connect(gain);
          gain.connect(ctx.destination);
        } else if (bassBoost) {
          // Deep sub-bass boost
          const lowShelf = ctx.createBiquadFilter();
          lowShelf.type = "lowshelf";
          lowShelf.frequency.value = 80;
          lowShelf.gain.value = 25;

          // Mid-bass punch
          const bassPunch = ctx.createBiquadFilter();
          bassPunch.type = "peaking";
          bassPunch.frequency.value = 120;
          bassPunch.Q.value = 1.0;
          bassPunch.gain.value = 20;

          // Upper bass warmth
          const bassWarmth = ctx.createBiquadFilter();
          bassWarmth.type = "peaking";
          bassWarmth.frequency.value = 250;
          bassWarmth.Q.value = 0.7;
          bassWarmth.gain.value = 12;

          source.connect(lowShelf);
          lowShelf.connect(bassPunch);
          bassPunch.connect(bassWarmth);
          bassWarmth.connect(gain);
          gain.connect(ctx.destination);
        } else {
          source.connect(gain);
          gain.connect(ctx.destination);
        }

        source.onended = () => { ctx.close().catch(() => {}); resolve(); };
        source.start();
      } catch (err) {
        console.error("playSingleSound: Web Audio failed, falling back to plain audio", err);
        // Fallback to plain audio
        try {
          const audio = new Audio(path);
          audio.volume = Math.min(1, Math.max(0, volume));
          audio.onended = () => resolve();
          audio.onerror = () => resolve();
          const p = audio.play();
          if (p && typeof p.catch === "function") p.catch(() => resolve());
        } catch {
          resolve();
        }
      }
    })();
  });
}

/**
 * Speak a text segment and resolve when finished.
 * Includes a timeout fallback so a stalled synthesizer never blocks playback.
 */
function speakSegment(
  text: string,
  rate: number,
  voice: SpeechSynthesisVoice | null,
  pitch: number = 1,
  volume: number = 1,
  bassBoost: boolean = false,
  earRape: boolean = false,
): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window) || !text.trim()) {
      resolve();
      return;
    }
    let resolved = false;
    const finish = () => { if (!resolved) { resolved = true; resolve(); } };

    const utterance = new SpeechSynthesisUtterance(text);
    // Ear rape: fast but still intelligible, extreme pitch
    if (earRape) {
      utterance.rate = 2;
      utterance.pitch = 0;
    } else {
      utterance.rate = Math.min(4, Math.max(0.25, rate || 1));
      // Bass boost on Web Speech: drop pitch for a deeper, bass-heavy tone.
      const effectivePitch = bassBoost ? Math.max(0.1, pitch * 0.4) : pitch;
      utterance.pitch = Math.min(2, Math.max(0, effectivePitch));
    }
    // Web Speech volume is capped at 1.0 by the browser — can't amplify beyond that.
    utterance.volume = Math.min(1, Math.max(0, volume));
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }
    utterance.onend = finish;
    utterance.onerror = finish;

    // Timeout: ~90ms per char + 5s buffer. Prevents engine hangs from blocking.
    const estimated = Math.max(3000, text.length * 90);
    setTimeout(finish, estimated + 5000);

    window.speechSynthesis.speak(utterance);
  });
}

/** Brief pause between segments for natural pacing. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Main entry point — advanced multi-speaker TTS engine.
 *
 * Parses inline [m]/[f]/[steven]/[fish:xxx] tags to split the message
 * into speaker segments. Each segment is spoken with its own voice config.
 * Sound triggers pause speech mid-segment and resume after.
 *
 * On Firefox, auto-falls back to the admin-configured default voice because
 * Firefox's Web Speech is broken.
 *
 * Safe to call on every incoming/sent TTS message.
 */
export async function playTts(opts: PlayTtsOptions): Promise<void> {
  if (typeof window === "undefined") return;
  const { content, authorName, rate = 1, voiceGender = "auto", speak: shouldSpeak = true } = opts;

  // Fetch voice presets from API (cached for 1 min).
  const voices = await getTtsVoices();

  const segments = parseTtsContent(content, voices);
  if (segments.length === 0) return;

  // Cancel any in-progress speech so messages don't queue up and overlap.
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }

  // Fetch sound triggers (best-effort).
  const sounds = await getTtsSounds();

  // Find the admin-configured default voice (used for Firefox fallback and
  // language-not-found fallback).
  const defaultVoice = voices.find((v) => v.isDefault) || null;
  const useCloudFallback = isFirefox() && !!defaultVoice;

  // Cache voices per unique gender+persona combo (avoids re-picking per segment).
  const voiceCache = new Map<string, SpeechSynthesisVoice | null>();

  for (let segIdx = 0; segIdx < segments.length; segIdx++) {
    const segment = segments[segIdx];
    if (!segment.text.trim()) continue;

    const segRate = segment.rate ?? rate;
    const segPitch = segment.pitch ?? 1;
    const segVolume = segment.volume ?? 1;
    const segBass = segment.bassBoost;
    const segEar = segment.earRape;

    // Prepend author name to the first segment only.
    const text = segIdx === 0 && authorName
      ? `${authorName} said "${segment.text}"`
      : segment.text;

    // Split by sound triggers within this segment.
    const soundSegments = splitTextByTriggers(text, sounds);

    for (const ss of soundSegments) {
      if (ss.soundPath) {
        await delay(120);
        await playSingleSound(ss.soundPath, segVolume, segBass, segEar);
        await delay(100);
      } else if (shouldSpeak && ss.text.trim()) {
        if (segment.fishReferenceId) {
          // FishAudio AI voice.
          await playFishAudio(ss.text, segment.fishReferenceId, segRate, segVolume, segBass, segEar);
        } else if (useCloudFallback) {
          // Firefox fallback: use admin-configured default voice.
          await playFishAudio(ss.text, defaultVoice!.referenceId, segRate, segVolume, segBass, segEar);
        } else {
          // Web Speech API.
          const effectiveGender = segment.gender ?? voiceGender;
          const cacheKey = `${effectiveGender}:${segment.persona?.lang ?? ""}:${segment.persona?.nameHints?.join(",") ?? ""}`;
          if (!voiceCache.has(cacheKey)) {
            voiceCache.set(cacheKey, await pickVoice(effectiveGender, segment.persona));
          }
          const voice = voiceCache.get(cacheKey)!;
          if (!voice && defaultVoice) {
            // No matching voice for requested language — fall back to default voice.
            await playFishAudio(ss.text, defaultVoice.referenceId, segRate, segVolume, segBass, segEar);
          } else {
            await speakSegment(ss.text, segRate, voice, segPitch, segVolume, segBass, segEar);
          }
        }
      }
    }
  }
}
