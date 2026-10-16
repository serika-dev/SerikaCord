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
