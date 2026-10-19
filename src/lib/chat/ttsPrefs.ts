/**
 * Per-user text-to-speech preferences (user settings, accessibility section),
 * kept pure so the gating rules are unit-testable (CORD-35).
 *
 *  - `tts`             read every incoming message aloud (off by default)
 *  - `ttsFromOthers`   play /tts messages other people send (on by default)
 *  - `ttsSoundEffects` sound triggers and loud modifiers like [vol:EAR] /
 *                      [vol:BASS] (on by default); off speaks the trigger word
 *                      and caps the volume at 100%
 */

export type TtsVoiceGenderPref = "auto" | "female" | "male";

export interface TtsPrefs {
  tts?: boolean;
  ttsRate?: number;
  ttsVoice?: TtsVoiceGenderPref;
  ttsFromOthers?: boolean;
  ttsSoundEffects?: boolean;
}

/** True when the message was sent with the /tts prefix. */
export function isTtsPrefixed(content: unknown): boolean {
  return typeof content === "string" && content.startsWith("/tts ");
}

/**
 * Whether an incoming message from someone else should be spoken: always when
 * the listener reads all messages aloud, otherwise only /tts messages unless
 * they turned those off.
 */
export function shouldAutoPlayTts(prefs: TtsPrefs | null | undefined, content: unknown): boolean {
  if (typeof content !== "string" || !content) return false;
  if (prefs?.tts === true) return true;
  return isTtsPrefixed(content) && prefs?.ttsFromOthers !== false;
}

/** Sound effects (trigger sounds, ear-rape and bass modifiers) are allowed. */
export function ttsSoundEffectsEnabled(prefs: TtsPrefs | null | undefined): boolean {
  return prefs?.ttsSoundEffects !== false;
}

/** The playTts options that come from the listener settings. */
export function ttsPlaybackOptions(prefs: TtsPrefs | null | undefined): {
  rate?: number;
  voiceGender?: TtsVoiceGenderPref;
  soundEffects: boolean;
} {
  return { rate: prefs?.ttsRate, voiceGender: prefs?.ttsVoice, soundEffects: ttsSoundEffectsEnabled(prefs) };
}

/** With sound effects off, a segment plays at no more than 100% with no bass boost or ear rape. */
export function tameSegmentEffects(
  segment: { volume?: number | null; bassBoost?: boolean | null; earRape?: boolean | null },
  soundEffects: boolean,
): { volume: number; bassBoost: boolean; earRape: boolean } {
  const volume = segment.volume ?? 1;
  if (soundEffects) return { volume, bassBoost: Boolean(segment.bassBoost), earRape: Boolean(segment.earRape) };
  return { volume: Math.min(1, Math.max(0, volume)), bassBoost: false, earRape: false };
}
