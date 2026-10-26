/**
 * Pure helpers for incoming channel webhooks (POST /api/webhooks/:channelId/:token).
 *
 * Webhook messages are stored with `authorId = webhook.id`, never the human who
 * created the webhook, so they never merge with (or masquerade as) a real
 * user's messages, and a reload shows the webhook rather than its creator.
 */

export interface WebhookIdentity {
  id: string;
  name: string;
  avatar?: string | null;
}

export interface WebhookAuthor {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  status: 'offline' | 'online';
  isBot: true;
  isSystem: false;
  isDiscord: boolean;
  isWebhook: true;
}

const MAX_WEBHOOK_USERNAME = 80;

// Control, zero-width and bidi-override characters: invisible in a name and
// used to fake other names ("Serika\u200bStaff").
const INVISIBLE_CHARS = /[\u0000-\u001F\u007F\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;

/**
 * Words a webhook name or per-message username may not contain: Discord's
 * ("clyde", "discord") plus ours, so a webhook can't pose as the platform or
 * its staff. Compared without spaces, dots, dashes and underscores.
 */
const BLOCKED_NAME_WORDS = ['clyde', 'discord', 'serika', 'system', 'staff', 'admin', 'moderator'];

/** A blocked word in `name` (after removing separators), or null. */
export function blockedWebhookWord(name: string): string | null {
  const flat = name.toLowerCase().replace(INVISIBLE_CHARS, '').replace(/[\s._\-'"`*~|]+/g, '');
  return BLOCKED_NAME_WORDS.find((w) => flat.includes(w)) ?? null;
}

/** Trimmed, invisible-character-free, length-capped name; null when unusable or blocked. */
export function cleanWebhookUsername(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(INVISIBLE_CHARS, '').trim();
  if (!trimmed) return null;
  const capped = trimmed.slice(0, MAX_WEBHOOK_USERNAME);
  return blockedWebhookWord(capped) ? null : capped;
}

/** Only absolute https URLs are accepted as an avatar override. */
export function cleanWebhookAvatarUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Longest webhook name or per-message username (Discord: 80). */
export const WEBHOOK_NAME_MAX = MAX_WEBHOOK_USERNAME;

/** Webhooks per channel (Discord: 15, error 30007 past it). */
export const MAX_WEBHOOKS_PER_CHANNEL = 15;

/** Words Discord itself rejects in webhook names and usernames (400, not a fallback). */
const DISCORD_BLOCKED_WORDS = new Set(['clyde', 'discord']);

export type WebhookNameCheck =
  | { ok: true; name: string }
  | { ok: false; reason: 'type' | 'length' | 'blocked'; word?: string };

/**
 * A webhook's own name (create / edit): invisible characters removed, trimmed,
 * NFC, 1-80 characters and no blocked word. Unlike per-message usernames a
 * long name is rejected rather than cut. Not HTML-escaped: names are always
 * rendered as text and go out unchanged on the Discord-compatible API.
 */
export function checkWebhookName(value: unknown): WebhookNameCheck {
  if (typeof value !== 'string') return { ok: false, reason: 'type' };
  const name = value.replace(INVISIBLE_CHARS, '').normalize('NFC').trim();
  if (!name || name.length > WEBHOOK_NAME_MAX) return { ok: false, reason: 'length' };
  const word = blockedWebhookWord(name);
  if (word) return { ok: false, reason: 'blocked', word };
  return { ok: true, name };
}

/** Plain-English message for a failed name check (API errors). */
export function webhookNameError(check: Extract<WebhookNameCheck, { ok: false }>): string {
  if (check.reason === 'blocked') return `Webhook names cannot contain "${check.word}"`;
  if (check.reason === 'type') return 'Name is required';
  return `Must be between 1 and ${WEBHOOK_NAME_MAX} in length.`;
}

/** Friendly default names for a webhook made with "New Webhook" (no name given). */
export const DEFAULT_WEBHOOK_NAMES = [
  'Captain Hook',
  'Spidey Bot',
  'Hookshot',
  'Ping Pong',
  'Courier Pigeon',
  'Signal Flare',
  'Message in a Bottle',
  'Paper Plane',
] as const;

export function randomWebhookName(random: () => number = Math.random): string {
  const i = Math.min(DEFAULT_WEBHOOK_NAMES.length - 1, Math.floor(random() * DEFAULT_WEBHOOK_NAMES.length));
  return DEFAULT_WEBHOOK_NAMES[Math.max(0, i)];
}

export type WebhookAvatarInput =
  | { kind: 'keep' }
  | { kind: 'clear' }
  | { kind: 'data'; value: string }
  | { kind: 'url'; url: string }
  | { kind: 'invalid'; message: string };

/**
 * What an `avatar` field on webhook create / edit asks for: undefined keeps
 * it, null or '' removes it, a base64 image data URI is uploaded (Discord's
 * format), and a URL is only kept when it is already on our own CDN
 * (`isOwnMedia`), so a webhook avatar never hotlinks another host.
 */
export function classifyWebhookAvatar(value: unknown, isOwnMedia: (url: string) => boolean): WebhookAvatarInput {
  if (value === undefined) return { kind: 'keep' };
  if (value === null || value === '') return { kind: 'clear' };
  if (typeof value !== 'string') return { kind: 'invalid', message: 'Avatar must be image data or null.' };
  if (/^data:/i.test(value)) return { kind: 'data', value };
  const url = cleanWebhookAvatarUrl(value);
  if (url && isOwnMedia(url)) return { kind: 'url', url };
  return { kind: 'invalid', message: 'Avatar must be image data (data:image/png;base64,...).' };
}

export type WebhookOverrideCheck =
  | { ok: true; username: string | null; avatarUrl: string | null }
  | { ok: false; field: 'username' | 'avatar_url'; code: string; message: string };

/**
 * Per-message `username` / `avatar_url` on execute. Discord's own rules are
 * errors (wrong type, over 80 characters, "clyde" / "discord", a malformed or
 * non-http(s) URL); our extra blocked words and empty values quietly fall
 * back to the webhook's own name, so relays keep posting. http avatars are
 * upgraded to https (the page is https; browsers would do the same).
 */
export function checkWebhookOverrides(input: { username?: unknown; avatarUrl?: unknown }): WebhookOverrideCheck {
  let username: string | null = null;
  if (input.username !== undefined && input.username !== null) {
    if (typeof input.username !== 'string') return { ok: false, field: 'username', code: 'BASE_TYPE_BAD_TYPE', message: 'Must be a string.' };
    const trimmed = input.username.replace(INVISIBLE_CHARS, '').trim();
    if (trimmed.length > WEBHOOK_NAME_MAX) {
      return { ok: false, field: 'username', code: 'BASE_TYPE_BAD_LENGTH', message: `Must be between 1 and ${WEBHOOK_NAME_MAX} in length.` };
    }
    const word = trimmed ? blockedWebhookWord(trimmed) : null;
    if (word && DISCORD_BLOCKED_WORDS.has(word)) {
      return { ok: false, field: 'username', code: 'USERNAME_INVALID_CONTAINS', message: `Username cannot contain "${word}"` };
    }
    username = cleanWebhookUsername(trimmed);
  }
  let avatarUrl: string | null = null;
  if (input.avatarUrl !== undefined && input.avatarUrl !== null && input.avatarUrl !== '') {
    if (typeof input.avatarUrl !== 'string') return { ok: false, field: 'avatar_url', code: 'BASE_TYPE_BAD_TYPE', message: 'Must be a string.' };
    let u: URL;
    try {
      u = new URL(input.avatarUrl.trim());
    } catch {
      return { ok: false, field: 'avatar_url', code: 'URL_TYPE_INVALID_URL', message: 'Not a well formed URL.' };
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      return { ok: false, field: 'avatar_url', code: 'URL_TYPE_INVALID_SCHEME', message: 'Scheme must be one of (http, https).' };
    }
    if (u.protocol === 'http:') u.protocol = 'https:';
    avatarUrl = cleanWebhookAvatarUrl(u.toString());
  }
  return { ok: true, username, avatarUrl };
}

/** One readable line from a webhook route error body (Discord form errors included), for the web app. */
export function webhookErrorMessage(body: unknown, fallback = 'Invalid webhook update'): string {
  if (!body || typeof body !== 'object') return fallback;
  const b = body as { message?: unknown; errors?: unknown };
  const walk = (node: unknown): string | null => {
    if (!node || typeof node !== 'object') return null;
    const leaves = (node as { _errors?: Array<{ message?: unknown }> })._errors;
    if (Array.isArray(leaves) && typeof leaves[0]?.message === 'string') return leaves[0].message;
    for (const [k, child] of Object.entries(node)) {
      if (k === '_errors') continue;
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(b.errors) ?? (typeof b.message === 'string' ? b.message : fallback);
}

/** The author object a webhook message is shown with (live and on fetch). */
export function buildWebhookAuthor(
  webhook: WebhookIdentity,
  overrides: { username?: unknown; avatarUrl?: unknown } = {},
  status: 'offline' | 'online' = 'offline',
): WebhookAuthor {
  const username = cleanWebhookUsername(overrides.username) ?? webhook.name;
  const avatar = cleanWebhookAvatarUrl(overrides.avatarUrl) ?? webhook.avatar ?? null;
  const isDiscord =
    username.toLowerCase().includes('discord') || webhook.name.toLowerCase().includes('discord');
  return {
    id: webhook.id,
    username,
    displayName: username,
    avatar,
    status,
    isBot: true,
    isSystem: false,
    isDiscord,
    isWebhook: true,
  };
}
