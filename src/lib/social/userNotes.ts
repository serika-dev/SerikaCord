/** Discord caps notes at 256 characters. */
export const USER_NOTE_MAX = 256;

/**
 * Normalize a private note before storing it: strings only, control
 * characters (except newlines/tabs) removed, trimmed, capped. Empty = delete.
 */
export function normalizeUserNote(raw: unknown): string {
  if (typeof raw !== "string") return "";
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  return Array.from(cleaned).slice(0, USER_NOTE_MAX).join("");
}
