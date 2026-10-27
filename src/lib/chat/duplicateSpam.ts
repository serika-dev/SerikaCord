/**
 * Duplicate-spam guard shared by channel and DM sends: block a message when
 * the sender's last `threshold` messages in the conversation are all the same
 * text AND were all sent recently. Old messages never count, so repeating a
 * word you last used months ago (or voting "smash" once per round) is fine.
 * Pure; tested in tests/duplicate-spam.test.ts.
 */
export const DUPLICATE_SPAM_WINDOW_MS = 60_000;

export function isDuplicateSpam(
  fingerprint: string,
  recent: ReadonlyArray<{ fingerprint: string; createdAt: Date | string | number | null | undefined }>,
  threshold: number,
  now: number = Date.now(),
): boolean {
  if (!fingerprint || recent.length < threshold) return false;
  return recent.slice(0, threshold).every((m) => {
    const at = m.createdAt == null ? NaN : new Date(m.createdAt).getTime();
    return Number.isFinite(at) && now - at <= DUPLICATE_SPAM_WINDOW_MS && m.fingerprint === fingerprint;
  });
}
