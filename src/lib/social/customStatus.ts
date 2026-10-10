/**
 * Discord-style custom status: optional emoji + text + "Clear after".
 *
 * Storage (no schema change): the text stays in `users.custom_status` (every
 * existing reader keeps working), the emoji and the expiry live in the public
 * `users.customization` JSON as `customStatusEmoji` / `customStatusExpiresAt`.
 * The server clears expired statuses (Redis-scheduled sweep + lazy check) and
 * clients also hide an expired one immediately with `activeCustomStatus`.
 *
 * Shared by server and client: keep this module free of server/browser APIs.
 */

export interface CustomStatusEmoji {
  /** Unicode emoji, or the custom emoji's name. */
  name: string;
  /** Custom emoji id (absent for unicode). */
  id?: string | null;
  /** Custom emoji image URL (CDN). */
  url?: string | null;
  animated?: boolean;
}

export interface CustomStatusView {
  text: string | null;
  emoji: CustomStatusEmoji | null;
  expiresAt: string | null;
}

export type ClearAfterChoice = "today" | "4h" | "1h" | "30m" | "never";

export const CLEAR_AFTER_CHOICES: readonly ClearAfterChoice[] = ["today", "4h", "1h", "30m", "never"];

/** Longest expiry the server accepts (the "today" choice is at most ~24h). */
export const MAX_CUSTOM_STATUS_TTL_MS = 25 * 60 * 60 * 1000;

const MAX_EMOJI_NAME = 64;
const UUIDish = /^[0-9a-zA-Z_-]{1,64}$/;

/** Validate an emoji coming from a client. Returns null for anything unusable. */
export function sanitizeStatusEmoji(raw: unknown, cdnBase?: string | null): CustomStatusEmoji | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === "string" ? r.name.trim().slice(0, MAX_EMOJI_NAME) : "";
  if (!name) return null;
  const id = typeof r.id === "string" && UUIDish.test(r.id) ? r.id : null;
  let url: string | null = null;
  if (id && typeof r.url === "string") {
    const u = r.url.trim();
    // Only our own media: the CDN, or a same-origin path.
    if ((cdnBase && u.startsWith(cdnBase.replace(/\/+$/, "") + "/")) || /^\/(?!\/)/.test(u)) url = u.slice(0, 512);
  }
  // A custom emoji without an image can't be drawn: fall back to nothing.
  if (id && !url) return null;
  // Unicode emoji: a short string with no markup.
  if (!id && (name.length > 32 || /[<>]/.test(name))) return null;
  return { name, ...(id ? { id, url, animated: Boolean(r.animated) } : {}) };
}

/**
 * When a "Clear after" choice ends. "today" = the viewer's next local midnight,
 * computed from their UTC offset (minutes, as `Date#getTimezoneOffset`).
 */
export function clearAfterToExpiry(choice: ClearAfterChoice, nowMs: number, tzOffsetMinutes = 0): string | null {
  switch (choice) {
    case "30m":
      return new Date(nowMs + 30 * 60_000).toISOString();
    case "1h":
      return new Date(nowMs + 60 * 60_000).toISOString();
    case "4h":
      return new Date(nowMs + 4 * 60 * 60_000).toISOString();
    case "today": {
      const local = nowMs - tzOffsetMinutes * 60_000;
      const day = 24 * 60 * 60_000;
      const nextLocalMidnight = Math.floor(local / day) * day + day;
      return new Date(nextLocalMidnight + tzOffsetMinutes * 60_000).toISOString();
    }
    default:
      return null;
  }
}

/** Server-side check of a client-computed expiry. Null = never clears. */
export function sanitizeExpiry(raw: unknown, nowMs: number): { ok: true; value: string | null } | { ok: false } {
  if (raw === null || raw === undefined || raw === "") return { ok: true, value: null };
  if (typeof raw !== "string" && typeof raw !== "number") return { ok: false };
  const ms = new Date(raw).getTime();
  if (!Number.isFinite(ms) || ms <= nowMs || ms - nowMs > MAX_CUSTOM_STATUS_TTL_MS) return { ok: false };
  return { ok: true, value: new Date(ms).toISOString() };
}

function readMeta(customization: unknown): { emoji: CustomStatusEmoji | null; expiresAt: string | null } {
  if (!customization || typeof customization !== "object") return { emoji: null, expiresAt: null };
  const c = customization as Record<string, unknown>;
  const e = c.customStatusEmoji;
  const emoji = e && typeof e === "object" && typeof (e as CustomStatusEmoji).name === "string"
    ? (e as CustomStatusEmoji)
    : null;
  const expiresAt = typeof c.customStatusExpiresAt === "string" ? c.customStatusExpiresAt : null;
  return { emoji, expiresAt };
}

export function isCustomStatusExpired(customization: unknown, nowMs: number = Date.now()): boolean {
  const { expiresAt } = readMeta(customization);
  if (!expiresAt) return false;
  const ms = new Date(expiresAt).getTime();
  return Number.isFinite(ms) && ms <= nowMs;
}

/** The status to show right now (both parts null when unset or expired). */
export function activeCustomStatus(
  text: string | null | undefined,
  customization: unknown,
  nowMs: number = Date.now(),
): CustomStatusView {
  const { emoji, expiresAt } = readMeta(customization);
  if (isCustomStatusExpired(customization, nowMs)) return { text: null, emoji: null, expiresAt: null };
  const t = typeof text === "string" && text.trim() ? text : null;
  if (!t && !emoji) return { text: null, emoji: null, expiresAt: null };
  return { text: t, emoji, expiresAt };
}

/** Whether any custom status (text or emoji) is set and not expired. */
export function hasCustomStatus(text: string | null | undefined, customization: unknown, nowMs: number = Date.now()): boolean {
  const v = activeCustomStatus(text, customization, nowMs);
  return Boolean(v.text || v.emoji);
}

/** Which "Clear after" choice an existing expiry most likely came from (for the editor). */
export function guessClearAfter(expiresAt: string | null | undefined, nowMs: number): ClearAfterChoice {
  if (!expiresAt) return "never";
  const left = new Date(expiresAt).getTime() - nowMs;
  if (!Number.isFinite(left) || left <= 0) return "never";
  if (left <= 30 * 60_000) return "30m";
  if (left <= 60 * 60_000) return "1h";
  if (left <= 4 * 60 * 60_000) return "4h";
  return "today";
}
