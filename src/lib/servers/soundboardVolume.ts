/**
 * Per-sound soundboard volume (CORD-31). Each `servers.soundboard_sounds`
 * entry may carry `volume`, 0..1 like Discord's soundboard sound object
 * (missing = 1, full volume). Playback multiplies it with the server's
 * soundboard volume (percent) and then each listener's own preference.
 */

/** A stored or client-supplied sound volume as 0..1 (default 1), or null when not a number. */
export function parseSoundVolume(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(Math.min(Math.max(value, 0), 1) * 100) / 100;
}

/** The volume stored on a sound entry, defaulting to full volume. */
export function soundVolume(sound: { volume?: unknown } | null | undefined): number {
  return parseSoundVolume(sound?.volume) ?? 1;
}

/** Server volume (percent, 0–200) × sound volume (0..1), as a percent. */
export function effectiveSoundPercent(serverPercent: unknown, sound: { volume?: unknown } | null | undefined): number {
  const base = typeof serverPercent === 'number' && Number.isFinite(serverPercent) ? Math.min(Math.max(serverPercent, 0), 200) : 100;
  return Math.round(base * soundVolume(sound));
}
