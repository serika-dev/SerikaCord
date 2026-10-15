/**
 * Channel (incoming) webhooks: the Discord webhook object, execute (wait,
 * thread_id, thread_name, with_components, username / avatar_url overrides,
 * multipart files, flags, embeds, components, allowed_mentions), and the
 * token-authenticated GET / PATCH / DELETE of the webhook and its messages.
 *
 * Tokens are compared in constant time after the row is loaded by id, so a
 * token never selects a webhook by itself. Messages are stored under the
 * webhook's own id (never the creator's), see lib/chat/webhook.
 */
import { Channel, ChannelWebhook, type IChannel, type IMessage } from '@/lib/models';
import { config } from '@/lib/config';
import { checkRateLimit, isValidObjectId, sanitizeInput, secureCompare } from '@/lib/security';
import { FE, FormErrors, formError } from '@/lib/botapi/formErrors';
import { ButtonStyle, ComponentType, walkComponents, type MessageComponent } from '@/lib/botapi/components';
import {
  finalizeComponents, isEmptyOutgoing, parseOutgoingMessage, uploadOutgoingFiles, type ApiFailure,
} from '@/lib/services/outgoingMessage';
import { createAppMessage, deleteAppMessage, editAppMessage, type AppAuthor } from '@/lib/services/appMessages';
import { discordMessageFromRow, loadLiveMessage } from '@/lib/services/interactionPayload';
import type { IncomingAttachment } from '@/lib/chat/attachmentPolicy';
import { cleanWebhookAvatarUrl, cleanWebhookUsername } from '@/lib/chat/webhook';

export type WebhookRow = NonNullable<Awaited<ReturnType<typeof ChannelWebhook.findById>>>;
export type WebhookResult = { status: number; body: unknown; headers?: Record<string, string> };

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const UNKNOWN_WEBHOOK: WebhookResult = { status: 404, body: { code: 10015, message: 'Unknown Webhook' } };
const UNKNOWN_MESSAGE: WebhookResult = { status: 404, body: { code: 10008, message: 'Unknown Message' } };

function applicationIdOf(w: WebhookRow): string | null {
  return (w as { applicationId?: string | null }).applicationId ?? null;
}

/** The webhook's execute URL (Discord shape: /webhooks/{id}/{token}). */
export function webhookUrl(w: Pick<WebhookRow, 'id' | 'token'>): string {
  return `${config.API_BASE_URL}/api/webhooks/${w.id}/${w.token}`;
}

/** Discord webhook object. `withToken` only for whoever may manage it (or used the token). */
export function serializeWebhook(w: WebhookRow, opts: { withToken: boolean; user?: unknown }) {
  return {
    id: w.id,
    type: 1,
    guild_id: w.serverId ?? null,
    channel_id: w.channelId,
    name: w.name,
    avatar: w.avatar ?? null,
    application_id: applicationIdOf(w),
    ...(opts.user ? { user: opts.user } : {}),
    ...(opts.withToken ? { token: w.token, url: webhookUrl(w) } : {}),
  };
}

/** The webhook with this id whose token matches (constant-time), or null. */
export async function findWebhookByToken(id: string, token: string): Promise<WebhookRow | null> {
  if (!token || token.length > 256 || !isValidObjectId(id)) return null;
  const w = await ChannelWebhook.findById(id).catch(() => null);
  if (!w || !w.token || !secureCompare(w.token, token)) return null;
  return w;
}

/**
 * Old URLs were /api/webhooks/{channel_id}/{token}; Discord-style ones are
 * /webhooks/{webhook_id}/{token}. Accept both.
 */
export async function findLegacyWebhook(first: string, token: string): Promise<WebhookRow | null> {
  const byId = await findWebhookByToken(first, token);
  if (byId) return byId;
  if (!token || token.length > 256 || !isValidObjectId(first)) return null;
  const w = await ChannelWebhook.findOne({ channelId: first, token }).catch(() => null);
  if (!w || !w.token || !secureCompare(w.token, token)) return null;
  return w;
}

function authorOf(w: WebhookRow, overrides?: { username?: unknown; avatarUrl?: unknown }): AppAuthor {
  return { kind: 'webhook', webhook: { id: w.id, name: w.name, avatar: w.avatar ?? null, applicationId: applicationIdOf(w) }, overrides };
}

const isThread = (c: Pick<IChannel, 'type'>) => c.type === 'public_thread' || c.type === 'private_thread';

/** Where a webhook message goes: its channel, or a thread under it (thread_id). */
async function targetChannel(w: WebhookRow, threadId: string | undefined): Promise<IChannel | WebhookResult> {
  const channel = await Channel.findById(w.channelId).catch(() => null);
  if (!channel) return UNKNOWN_WEBHOOK;
  if (!threadId) return channel;
  if (!isValidObjectId(threadId)) return { status: 400, body: formError(['thread_id'], FE.BAD_TYPE, 'Value is not snowflake.') };
  const thread = await Channel.findById(threadId).catch(() => null);
  if (!thread || !isThread(thread) || !same(thread.parentId, channel.id)) return { status: 404, body: { code: 10003, message: 'Unknown Channel' } };
  if (thread.locked) return { status: 403, body: { code: 50083, message: 'Thread is archived' } };
  return thread;
}

/** Non-owned webhooks may only send non-interactive components (Discord). */
function hasInteractive(components: MessageComponent[]): boolean {
  for (const c of walkComponents(components)) {
    if (c.type === ComponentType.BUTTON && c.style !== ButtonStyle.LINK) return true;
    if (c.custom_id) return true;
  }
  return false;
}

function apiFailure(f: ApiFailure): WebhookResult {
  return { status: f.status, body: f.body };
}

/** Execute a webhook. `legacy` keeps the old unversioned response when `wait` isn't given. */
export async function executeWebhook(
  w: WebhookRow,
  body: unknown,
  query: { wait?: string; thread_id?: string; with_components?: string },
  opts: { ip?: string; legacy?: boolean } = {},
): Promise<WebhookResult> {
  const limit = await checkRateLimit('webhookExecute', w.id);
  if (!limit.success) {
    const retry = limit.retryAfter ?? 1;
    return {
      status: 429,
      body: { message: 'You are being rate limited.', retry_after: retry, global: false },
      headers: { 'Retry-After': String(retry), 'X-RateLimit-Scope': 'shared', Via: '1.1 serika' },
    };
  }
  const parsed = parseOutgoingMessage(body, { mode: 'create', allowEphemeral: false });
  if (!parsed.ok) return apiFailure(parsed);
  const m = parsed.message;
  // Components count only with ?with_components=true, and interactive ones only for app-owned webhooks.
  let components = query.with_components === 'true' ? m.components : null;
  if (components && !applicationIdOf(w) && hasInteractive(components)) {
    return { status: 400, body: formError(['components'], FE.INVALID, 'Interactive components can only be sent by application-owned webhooks.') };
  }
  if (m.content) {
    const { validateMessageContent } = await import('@/lib/security');
    const v = validateMessageContent(m.content);
    if (!v.valid) return { status: 400, body: formError(['content'], FE.INVALID, v.error || 'Invalid message content') };
  }
  const { sanitizeMessageContent } = await import('@/lib/api/channels');
  const content = m.content ? sanitizeMessageContent(m.content) : '';

  let channel: IChannel;
  const threadName = typeof m.threadName === 'string' ? sanitizeInput(m.threadName).trim().slice(0, 100) : '';
  const base = await targetChannel(w, query.thread_id);
  if ('status' in base) return base;
  channel = base;
  if (threadName && !query.thread_id) {
    if (channel.type !== 'forum' || channel.forumMode === 'tickets') {
      return { status: 400, body: formError(['thread_name'], FE.INVALID, 'thread_name can only be used in a forum channel.') };
    }
  } else if (channel.type === 'forum' && !query.thread_id) {
    return { status: 400, body: { code: 220001, message: 'Webhooks posted to forum channels must have a thread_name or thread_id' } };
  }

  const uploaded = await uploadOutgoingFiles({ files: parsed.files, meta: parsed.fileMeta, uploaderId: w.id, channelId: channel.id, ip: opts.ip });
  if (!uploaded.ok) return apiFailure(uploaded);
  const fin = finalizeComponents(components, uploaded.attachments);
  if (!fin.ok) return apiFailure(fin);
  components = fin.components;
  if (isEmptyOutgoing({ ...m, content, components }, uploaded.attachments.length)) {
    return { status: 400, body: { code: 50006, message: 'Cannot send an empty message' } };
  }

  if (threadName && channel.type === 'forum') {
    const validTags = new Set(((channel.availableTags || []) as Array<{ id: string }>).map((t) => t.id));
    const rawTags = (body && typeof body === 'object' ? (body as { applied_tags?: unknown }).applied_tags : undefined);
    const tags = Array.isArray(rawTags) ? rawTags.filter((t): t is string => typeof t === 'string' && validTags.has(t)).slice(0, 5) : [];
    const forum = channel;
    channel = await Channel.create({
      serverId: forum.serverId,
      name: threadName,
      type: 'public_thread',
      parentId: forum.id,
      ownerId: w.id,
      position: 0,
      appliedTags: tags,
      threadMemberIds: [],
      messageCount: 0,
    });
    const { publishToChannel } = await import('@/lib/api/channels');
    publishToChannel(forum.id, { type: 'thread_create', threadId: channel.id });
  } else if (isThread(channel) && channel.archived) {
    const { setThreadArchived } = await import('@/lib/services/threads');
    await setThreadArchived(channel.id, false).catch(() => null);
  }

  const created = await createAppMessage({
    author: authorOf(w, { username: m.username, avatarUrl: m.avatarUrl }),
    channel,
    body: {
      content,
      embeds: m.embeds,
      components,
      attachments: uploaded.attachments,
      flags: m.flags,
      mentionedUserIds: m.allowedUserIds ?? [],
    },
  });
  if (isThread(channel)) {
    const { refreshThreadAfterMessage } = await import('@/lib/services/threads');
    refreshThreadAfterMessage(channel.id);
  }
  if (query.wait === 'true' || query.wait === '1') return { status: 200, body: created.discord };
  if (opts.legacy && query.wait === undefined) {
    return { status: 200, body: { id: created.id, channel_id: channel.id, content, webhook_id: w.id } };
  }
  return { status: 204, body: '' };
}

/** PATCH a webhook (by token: name / avatar; by a manager: also channel_id). */
export async function patchWebhook(
  w: WebhookRow,
  body: unknown,
  opts: { allowChannel?: (channelId: string) => Promise<boolean> } = {},
): Promise<WebhookResult> {
  const input = (body && typeof body === 'object' ? body : {}) as { name?: unknown; avatar?: unknown; channel_id?: unknown };
  const errors = new FormErrors();
  const updates: { name?: string; avatar?: string | null; channelId?: string; url?: string } = {};
  if (input.name !== undefined) {
    const name = cleanWebhookUsername(input.name);
    if (!name) errors.add(['name'], FE.BAD_LENGTH, 'Must be between 1 and 80 in length.');
    else if (/clyde|discord/i.test(name)) errors.add(['name'], 'USERNAME_INVALID_CONTAINS', 'Username cannot contain "clyde" or "discord"');
    else updates.name = name;
  }
  if (input.avatar !== undefined) {
    if (input.avatar === null) updates.avatar = null;
    else {
      const url = cleanWebhookAvatarUrl(input.avatar);
      if (!url || !url.startsWith('https://')) errors.add(['avatar'], FE.INVALID, 'Avatar must be an https image URL (image data is not supported here).');
      else updates.avatar = url;
    }
  }
  if (input.channel_id !== undefined) {
    if (!opts.allowChannel) errors.add(['channel_id'], FE.INVALID, 'The channel can only be changed with a bot token.');
    else if (typeof input.channel_id !== 'string' || !isValidObjectId(input.channel_id)) errors.add(['channel_id'], FE.BAD_TYPE, 'Value is not snowflake.');
    else if (!(await opts.allowChannel(input.channel_id))) return { status: 403, body: { code: 50013, message: 'Missing Permissions' } };
    else updates.channelId = input.channel_id;
  }
  if (!errors.ok) return { status: 400, body: errors.toBody() };
  if (Object.keys(updates).length === 0) return { status: 200, body: serializeWebhook(w, { withToken: true }) };
  if (updates.channelId) updates.url = `${config.API_BASE_URL}/api/webhooks/${w.id}/${w.token}`;
  const next = (await ChannelWebhook.updateById(w.id, updates)) ?? w;
  return { status: 200, body: serializeWebhook(next, { withToken: true }) };
}

export async function deleteWebhook(w: WebhookRow): Promise<WebhookResult> {
  await ChannelWebhook.deleteById(w.id);
  return { status: 204, body: '' };
}

/** A message this webhook posted (in its channel or a thread under it). */
async function webhookMessage(w: WebhookRow, messageId: string, threadId?: string): Promise<{ message: IMessage; channel: IChannel } | null> {
  if (!isValidObjectId(messageId)) return null;
  const target = await targetChannel(w, threadId);
  if ('status' in target) return null;
  const message = await loadLiveMessage(target.id, messageId);
  if (!message || !same(message.authorId, w.id)) return null;
  return { message, channel: target };
}

export async function getWebhookMessage(w: WebhookRow, messageId: string, threadId?: string): Promise<WebhookResult> {
  const found = await webhookMessage(w, messageId, threadId);
  if (!found) return UNKNOWN_MESSAGE;
  return { status: 200, body: await discordMessageFromRow(found.message) };
}

export async function editWebhookMessage(
  w: WebhookRow,
  messageId: string,
  body: unknown,
  query: { thread_id?: string; with_components?: string },
  opts: { ip?: string } = {},
): Promise<WebhookResult> {
  const found = await webhookMessage(w, messageId, query.thread_id);
  if (!found) return UNKNOWN_MESSAGE;
  const existing = (found.message.attachments ?? []) as IncomingAttachment[];
  const parsed = parseOutgoingMessage(body, { mode: 'edit', existingAttachmentIds: existing.map((a) => String(a.id)), existingFlags: found.message.flags ?? 0 });
  if (!parsed.ok) return apiFailure(parsed);
  const m = parsed.message;
  let components = m.has.components && (query.with_components === 'true' || applicationIdOf(w)) ? m.components : undefined;
  if (components && !applicationIdOf(w) && hasInteractive(components)) {
    return { status: 400, body: formError(['components'], FE.INVALID, 'Interactive components can only be sent by application-owned webhooks.') };
  }
  const uploaded = await uploadOutgoingFiles({ files: parsed.files, meta: parsed.fileMeta, uploaderId: w.id, channelId: found.channel.id, ip: opts.ip });
  if (!uploaded.ok) return apiFailure(uploaded);
  const kept = m.keepAttachmentIds === null ? existing : existing.filter((a) => m.keepAttachmentIds!.includes(String(a.id)));
  const attachments = [...kept, ...uploaded.attachments];
  if (components) {
    const fin = finalizeComponents(components, attachments);
    if (!fin.ok) return apiFailure(fin);
    components = fin.components;
  }
  const { sanitizeMessageContent } = await import('@/lib/api/channels');
  const r = await editAppMessage({
    channel: found.channel,
    message: found.message,
    author: authorOf(w),
    patch: {
      ...(m.has.content ? { content: m.content ? sanitizeMessageContent(m.content) : '', mentionedUserIds: m.allowedUserIds ?? [] } : {}),
      ...(m.has.embeds ? { embeds: m.embeds } : {}),
      ...(components !== undefined ? { components: components ?? [] } : {}),
      ...(m.has.attachments ? { attachments } : {}),
      ...(m.has.flags ? { flags: m.flags } : {}),
    },
  });
  return { status: 200, body: r.discord };
}

export async function deleteWebhookMessage(w: WebhookRow, messageId: string, threadId?: string): Promise<WebhookResult> {
  const found = await webhookMessage(w, messageId, threadId);
  if (!found) return UNKNOWN_MESSAGE;
  await deleteAppMessage(found.channel, found.message);
  return { status: 204, body: '' };
}
