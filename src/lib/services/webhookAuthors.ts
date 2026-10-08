import { buildWebhookAuthor, type WebhookAuthor } from '@/lib/chat/webhook';

/**
 * Resolve message author ids that belong to channel webhooks (webhook
 * messages are stored with `authorId = webhook.id`). Ids that are not
 * webhooks are simply absent from the result.
 */
export async function loadWebhookAuthors(ids: string[]): Promise<WebhookAuthor[]> {
  if (ids.length === 0) return [];
  const { ChannelWebhook } = await import('@/lib/models');
  const rows = await ChannelWebhook.find({ id: { in: ids } });
  return rows.map((w) => buildWebhookAuthor({ id: w.id, name: w.name, avatar: w.avatar }));
}
