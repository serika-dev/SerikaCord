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

/** Trimmed, length-capped override name, or null when the override is unusable. */
export function cleanWebhookUsername(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/[\x00-\x1F\x7F]/g, '').trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_WEBHOOK_USERNAME);
}

/** Only absolute http(s) URLs are accepted as an avatar override. */
export function cleanWebhookAvatarUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
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
