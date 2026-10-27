/**
 * Slack- and GitHub-compatible webhook execution (POST
 * /webhooks/{id}/{token}/slack and /github, versioned and unversioned). The
 * payload is converted by src/lib/botapi/webhookCompat.ts, then posted
 * through the normal execute path (rate limit, validation, thread_id, wait).
 */
import { githubWebhookMessage, slackWebhookMessage, type GithubPayload } from '@/lib/botapi/webhookCompat';
import type { WebhookResult } from './channelWebhooks';

const UNKNOWN_WEBHOOK: WebhookResult = { status: 404, body: { code: 10015, message: 'Unknown Webhook' } };

interface CompatQuery { wait?: string; thread_id?: string }

async function run(webhookId: string, token: string, message: Record<string, unknown>, q: CompatQuery, ip?: string): Promise<WebhookResult> {
  const { findWebhookByToken, executeWebhook, runWebhookTokenRoute } = await import('./channelWebhooks');
  const webhook = await findWebhookByToken(webhookId, token);
  if (!webhook) return UNKNOWN_WEBHOOK;
  return runWebhookTokenRoute(webhook, 'execute', { body: message, threadId: q.thread_id }, (b, threadId) =>
    executeWebhook(webhook, b, { wait: q.wait, thread_id: threadId }, { ip }));
}

/** Slack incoming-webhook payload. Answers `ok` (200, text) like Slack, or the message with ?wait=true. */
export async function executeSlackWebhook(
  webhookId: string,
  token: string,
  input: { text?: unknown; username?: unknown; icon_url?: unknown; attachments?: unknown },
  q: CompatQuery,
  ip?: string,
): Promise<WebhookResult> {
  const result = await run(webhookId, token, { ...slackWebhookMessage(input) }, q, ip);
  if (result.status === 204) return { status: 200, body: 'ok', headers: { 'content-type': 'text/plain; charset=utf-8' } };
  return result;
}

/** A GitHub delivery (`event` = X-GitHub-Event). Ignored events still answer 204. */
export async function executeGithubWebhook(
  webhookId: string,
  token: string,
  event: string | null,
  input: GithubPayload,
  q: CompatQuery,
  ip?: string,
): Promise<WebhookResult> {
  const message = githubWebhookMessage(event, input);
  if (!message) {
    // Still a 404 for a wrong id / token, so a misconfigured hook shows up in GitHub's delivery log.
    const { findWebhookByToken } = await import('./channelWebhooks');
    return (await findWebhookByToken(webhookId, token)) ? { status: 204, body: '' } : UNKNOWN_WEBHOOK;
  }
  return run(webhookId, token, { ...message }, q, ip);
}
