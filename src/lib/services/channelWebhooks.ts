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
import { randomBytes, randomUUID } from 'crypto';
import { Channel, ChannelWebhook, type IChannel, type IMessage } from '@/lib/models';
import { config } from '@/lib/config';
import { checkRateLimit, isValidObjectId, sanitizeInput, secureCompare } from '@/lib/security';
import { FE, FormErrors, formError } from '@/lib/botapi/formErrors';
import { ButtonStyle, ComponentType, walkComponents, type MessageComponent } from '@/lib/botapi/components';
import {
  finalizeComponents, isEmptyOutgoing, parseOutgoingMessage, resolveEmbeds, uploadOutgoingFiles, type ApiFailure,
} from '@/lib/services/outgoingMessage';
import { createAppMessage, deleteAppMessage, editAppMessage, type AppAuthor } from '@/lib/services/appMessages';
import { discordMessageFromRow, loadLiveMessage } from '@/lib/services/interactionPayload';
import type { IncomingAttachment } from '@/lib/chat/attachmentPolicy';
import {
  MAX_WEBHOOKS_PER_CHANNEL, checkWebhookName, checkWebhookOverrides, classifyWebhookAvatar, randomWebhookName, webhookNameError,
} from '@/lib/chat/webhook';
export { webhookErrorMessage } from '@/lib/chat/webhook';
import { cdnKeyOf } from '@/lib/botapi/cdn';
import { decodeImageDataUri, type DecodedImage } from '@/lib/botapi/imageData';

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

/**
 * May `viewerAppId` see this webhook's token? An application-owned webhook's
 * token (which can send that app's interactive components) only goes to that
 * app; other webhooks' tokens go to whoever may manage them.
 */
export function mayShowWebhookToken(w: WebhookRow, viewerAppId: string | null): boolean {
  const owner = applicationIdOf(w);
  return !owner || (!!viewerAppId && same(owner, viewerAppId));
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

export interface WebhookCreator { id: string; username: string; displayName: string | null; avatar: string | null }

/**
 * The webhook as the web app's settings see it (user routes): the Discord
 * fields plus creator and creation time. `withToken` only for whoever may
 * manage it; an application's own webhook token never goes to users.
 */
export function serializeWebhookForUser(w: WebhookRow, opts: { withToken: boolean; creator?: WebhookCreator | null }) {
  return {
    id: w.id,
    type: 1,
    guild_id: w.serverId ?? null,
    channel_id: w.channelId,
    name: w.name,
    avatar: w.avatar ?? null,
    application_id: applicationIdOf(w),
    creator_id: w.creatorId ?? null,
    created_at: w.createdAt ? new Date(w.createdAt).toISOString() : null,
    ...(opts.creator ? { user: opts.creator } : {}),
    ...(opts.withToken && !applicationIdOf(w) ? { token: w.token, url: webhookUrl(w) } : {}),
  };
}

/** Creators of these webhooks (one query), keyed by lower-cased id. */
export async function loadWebhookCreators(rows: WebhookRow[]): Promise<Map<string, WebhookCreator>> {
  const ids = [...new Set(rows.map((w) => w.creatorId).filter((id): id is string => !!id))];
  const out = new Map<string, WebhookCreator>();
  if (ids.length === 0) return out;
  const { User } = await import('@/lib/models');
  const users = await User.find({ id: { in: ids } }).catch(() => []);
  for (const u of users as Array<{ id: string; username: string; displayName?: string | null; avatar?: string | null }>) {
    out.set(u.id.toLowerCase(), { id: u.id, username: u.username, displayName: u.displayName ?? null, avatar: u.avatar ?? null });
  }
  return out;
}

/** A file on our own CDN (or its legacy B2 hosts), never another host. */
export function isOwnMediaUrl(url: string): boolean {
  return cdnKeyOf(url, config.CDN_URL, config.B2_BUCKET_NAME) !== null;
}

/** Decode a webhook avatar data URI (type sniffed, at most MAX_AVATAR_SIZE). */
export function decodeWebhookAvatar(dataUri: string): DecodedImage {
  return decodeImageDataUri(dataUri, config.MAX_AVATAR_SIZE);
}

const AVATAR_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

/**
 * Store a webhook avatar under webhook-avatars/<webhookId>/ through
 * storage.upload (type and size checks, Trust & Safety scan attributed to
 * `actorId` in `channelId`).
 */
export async function uploadWebhookAvatar(
  webhookId: string,
  image: { contentType: string; data: Buffer },
  ctx: { channelId: string; actorId: string; ip?: string },
): Promise<{ ok: true; url: string } | { ok: false; status: number; message: string }> {
  const { storage, ContentBlockedError } = await import('@/lib/services/storage');
  try {
    const result = await storage.upload({
      category: 'webhook-avatars',
      contentType: image.contentType,
      data: image.data,
      size: image.data.length,
      filename: `avatar.${AVATAR_EXT[image.contentType] ?? 'png'}`,
      channelId: webhookId,
      scanChannelId: ctx.channelId,
      scanUserId: ctx.actorId,
      ip: ctx.ip,
    });
    return { ok: true, url: result.url };
  } catch (err) {
    if (err instanceof ContentBlockedError) return { ok: false, status: 403, message: 'This image cannot be used' };
    console.error('[webhooks] avatar upload failed:', (err as Error)?.message);
    return { ok: false, status: 500, message: 'Avatar upload failed' };
  }
}

/** Best-effort delete of a replaced webhook avatar (only our own webhook-avatars/<id>/ objects). */
export function cleanupWebhookAvatar(webhookId: string, oldUrl: string | null | undefined, newUrl: string | null | undefined): void {
  if (!oldUrl || oldUrl === newUrl || !isOwnMediaUrl(oldUrl)) return;
  void (async () => {
    const { storage, keyFromUrl } = await import('@/lib/services/storage');
    const { isOwnedMediaKey } = await import('@/lib/utils/ownedMedia');
    const key = keyFromUrl(oldUrl);
    if (isOwnedMediaKey(key, `webhook-avatars/${webhookId}/`)) await storage.delete(key);
  })().catch(() => {});
}

/** WEBHOOKS_UPDATE for bots in the server (best-effort). */
export function notifyWebhooksUpdate(serverId: string | null | undefined, channelId: string): void {
  if (!serverId) return;
  void import('@/lib/services/gatewayEvents')
    .then(({ emitWebhooksUpdate }) => emitWebhooksUpdate({ guildId: serverId, channelId }))
    .catch(() => {});
}

export type CreateWebhookResult =
  | { ok: true; webhook: WebhookRow }
  | { ok: false; status: number; body: unknown; message: string };

/**
 * Create a channel webhook (bot API and the web app). `name` follows
 * checkWebhookName; with `defaultName` a missing name gets a friendly random
 * one ("New Webhook" in settings). `avatar` is a data URI (uploaded after the
 * row exists, the row is removed again if that fails), one of our CDN URLs,
 * or null. Callers check MANAGE_WEBHOOKS first.
 */
export async function createChannelWebhook(opts: {
  channel: { id: string; serverId: string };
  body: { name?: unknown; avatar?: unknown };
  creatorId: string;
  applicationId?: string | null;
  defaultName?: boolean;
  ip?: string;
}): Promise<CreateWebhookResult> {
  const fail = (status: number, body: unknown, message: string): CreateWebhookResult => ({ ok: false, status, body, message });
  const existing = await ChannelWebhook.find({ channelId: opts.channel.id });
  if (existing.length >= MAX_WEBHOOKS_PER_CHANNEL) {
    const message = `Maximum number of webhooks reached (${MAX_WEBHOOKS_PER_CHANNEL})`;
    return fail(400, { code: 30007, message }, message);
  }
  const rawName = opts.body.name === undefined && opts.defaultName ? randomWebhookName() : opts.body.name;
  const name = checkWebhookName(rawName);
  if (!name.ok) {
    const message = webhookNameError(name);
    return fail(400, formError(['name'], name.reason === 'blocked' ? 'USERNAME_INVALID_CONTAINS' : name.reason === 'type' ? FE.REQUIRED : FE.BAD_LENGTH, message), message);
  }
  const avatar = classifyWebhookAvatar(opts.body.avatar, isOwnMediaUrl);
  if (avatar.kind === 'invalid') return fail(400, formError(['avatar'], 'IMAGE_INVALID', avatar.message), avatar.message);
  let image: Extract<DecodedImage, { ok: true }> | null = null;
  if (avatar.kind === 'data') {
    const decoded = decodeWebhookAvatar(avatar.value);
    if (!decoded.ok) return fail(400, formError(['avatar'], 'IMAGE_INVALID', decoded.message), decoded.message);
    const uploadLimit = await checkRateLimit('upload', `webhook-create:${opts.creatorId}`);
    if (!uploadLimit.success) {
      const message = 'You are being rate limited.';
      return fail(429, { message, retry_after: uploadLimit.retryAfter ?? 1, global: false }, message);
    }
    image = decoded;
  }

  const id = randomUUID();
  const token = randomBytes(34).toString('base64url');
  let webhook = await ChannelWebhook.create({
    id,
    channelId: opts.channel.id,
    serverId: opts.channel.serverId,
    name: name.name,
    avatar: avatar.kind === 'url' ? avatar.url : null,
    token,
    url: webhookUrl({ id, token }),
    creatorId: opts.creatorId,
    ...(opts.applicationId ? { applicationId: opts.applicationId } : {}),
  });
  if (image) {
    const stored = await uploadWebhookAvatar(webhook.id, image, { channelId: opts.channel.id, actorId: opts.creatorId, ip: opts.ip });
    if (!stored.ok) {
      await ChannelWebhook.deleteById(webhook.id).catch(() => {});
      return fail(stored.status === 403 ? 400 : stored.status, formError(['avatar'], 'IMAGE_INVALID', stored.message), stored.message);
    }
    webhook = (await ChannelWebhook.updateById(webhook.id, { avatar: stored.url })) ?? webhook;
  }
  notifyWebhooksUpdate(webhook.serverId, webhook.channelId);
  return { ok: true, webhook };
}

/** The webhook with this id whose token matches (constant-time), or null. */
const TOKEN_SHAPE = /^[A-Za-z0-9._~-]{1,256}$/;

export async function findWebhookByToken(id: string, token: string): Promise<WebhookRow | null> {
  // ASCII only: secureCompare compares bytes, and odd input must never throw.
  if (!token || !TOKEN_SHAPE.test(token) || !isValidObjectId(id)) return null;
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
  if (!token || !TOKEN_SHAPE.test(token) || !isValidObjectId(first)) return null;
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
  // Server channels only: a DM webhook would outlive its creator's membership.
  if (!channel || !channel.serverId) return UNKNOWN_WEBHOOK;
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
  // username / avatar_url overrides: Discord's rules are 400s, see checkWebhookOverrides.
  const overrides = checkWebhookOverrides({ username: m.username, avatarUrl: m.avatarUrl });
  if (!overrides.ok) return { status: 400, body: formError([overrides.field], overrides.code, overrides.message) };
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
  const emb = resolveEmbeds(m, uploaded.attachments);
  if (!emb.ok) return apiFailure(emb);
  if (isEmptyOutgoing({ ...m, content, components, embeds: emb.embeds }, uploaded.attachments.length)) {
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
    // Bots: THREAD_CREATE before the post's MESSAGE_CREATE.
    const { emitThreadCreate } = await import('@/lib/services/gatewayEvents');
    await emitThreadCreate(channel);
  } else if (isThread(channel) && channel.archived) {
    const { setThreadArchived } = await import('@/lib/services/threads');
    const reopened = await setThreadArchived(channel.id, false).catch(() => null);
    if (reopened) void import('@/lib/services/gatewayEvents').then(({ emitThreadUpdate }) => emitThreadUpdate(reopened)).catch(() => {});
  }

  const created = await createAppMessage({
    author: authorOf(w, { username: overrides.username, avatarUrl: overrides.avatarUrl }),
    channel,
    body: {
      content,
      embeds: emb.embeds,
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

/**
 * PATCH a webhook (by token: name / avatar; by a manager: also channel_id).
 * `avatar` is a data URI (uploaded), one of our CDN URLs, or null to remove
 * it; a replaced uploaded avatar is deleted from storage.
 */
export async function patchWebhook(
  w: WebhookRow,
  body: unknown,
  opts: {
    allowChannel?: (channelId: string) => Promise<boolean>;
    /** Bot route: the calling app (the token is shown only when mayShowWebhookToken allows). Token routes omit it. */
    viewerAppId?: string | null;
    /** Who is editing (Trust & Safety attribution of an uploaded avatar); defaults to the creator. */
    actorId?: string;
    ip?: string;
  } = {},
): Promise<WebhookResult> {
  const withToken = opts.viewerAppId === undefined ? true : mayShowWebhookToken(w, opts.viewerAppId);
  const input = (body && typeof body === 'object' ? body : {}) as { name?: unknown; avatar?: unknown; channel_id?: unknown };
  const errors = new FormErrors();
  const updates: { name?: string; avatar?: string | null; channelId?: string; url?: string } = {};
  let image: Extract<DecodedImage, { ok: true }> | null = null;
  if (input.name !== undefined) {
    const name = checkWebhookName(input.name);
    if (name.ok) updates.name = name.name;
    else errors.add(['name'], name.reason === 'blocked' ? 'USERNAME_INVALID_CONTAINS' : FE.BAD_LENGTH, webhookNameError(name));
  }
  const avatar = classifyWebhookAvatar(input.avatar, isOwnMediaUrl);
  if (avatar.kind === 'clear') updates.avatar = null;
  else if (avatar.kind === 'url') updates.avatar = avatar.url;
  else if (avatar.kind === 'invalid') errors.add(['avatar'], 'IMAGE_INVALID', avatar.message);
  else if (avatar.kind === 'data') {
    const decoded = decodeWebhookAvatar(avatar.value);
    if (decoded.ok) image = decoded;
    else errors.add(['avatar'], 'IMAGE_INVALID', decoded.message);
  }
  if (input.channel_id !== undefined) {
    if (!opts.allowChannel) errors.add(['channel_id'], FE.INVALID, 'The channel can only be changed with a bot token.');
    else if (typeof input.channel_id !== 'string' || !isValidObjectId(input.channel_id)) errors.add(['channel_id'], FE.BAD_TYPE, 'Value is not snowflake.');
    else if (!(await opts.allowChannel(input.channel_id))) return { status: 403, body: { code: 50013, message: 'Missing Permissions' } };
    else if (!same(input.channel_id, w.channelId)) updates.channelId = input.channel_id;
  }
  if (!errors.ok) return { status: 400, body: errors.toBody() };
  if (updates.channelId) {
    const taken = await ChannelWebhook.find({ channelId: updates.channelId });
    if (taken.length >= MAX_WEBHOOKS_PER_CHANNEL) {
      return { status: 400, body: { code: 30007, message: `Maximum number of webhooks reached (${MAX_WEBHOOKS_PER_CHANNEL})` } };
    }
  }
  if (image) {
    // Uploads (and their image scan) get the upload budget, per webhook.
    const uploadLimit = await checkRateLimit('upload', `webhook:${w.id}`);
    if (!uploadLimit.success) {
      const retry = uploadLimit.retryAfter ?? 1;
      return { status: 429, body: { message: 'You are being rate limited.', retry_after: retry, global: false }, headers: { 'Retry-After': String(retry) } };
    }
    const stored = await uploadWebhookAvatar(w.id, image, { channelId: updates.channelId ?? w.channelId, actorId: opts.actorId ?? w.creatorId, ip: opts.ip });
    if (!stored.ok) return { status: stored.status === 403 ? 400 : stored.status, body: formError(['avatar'], 'IMAGE_INVALID', stored.message) };
    updates.avatar = stored.url;
  }
  if (Object.keys(updates).length === 0) return { status: 200, body: serializeWebhook(w, { withToken }) };
  if (updates.channelId) updates.url = webhookUrl(w);
  const next = (await ChannelWebhook.updateById(w.id, updates)) ?? w;
  if (updates.avatar !== undefined) cleanupWebhookAvatar(w.id, w.avatar, updates.avatar);
  notifyWebhooksUpdate(w.serverId, w.channelId);
  if (updates.channelId) notifyWebhooksUpdate(w.serverId, updates.channelId);
  return { status: 200, body: serializeWebhook(next, { withToken }) };
}

/**
 * Run a token-authenticated webhook route: per-webhook rate limit (execute has
 * its own bucket), and for application-owned webhooks the app's id format on
 * both sides (snowflake apps send and get snowflakes; these routes carry no
 * bot token, so the API boundary can't tell).
 */
export async function runWebhookTokenRoute(
  w: WebhookRow,
  kind: 'execute' | 'manage',
  input: { body?: unknown; threadId?: string },
  run: (body: unknown, threadId: string | undefined) => Promise<WebhookResult>,
): Promise<WebhookResult> {
  if (kind === 'manage') {
    const limit = await checkRateLimit('webhookToken', w.id);
    if (!limit.success) {
      const retry = limit.retryAfter ?? 1;
      return { status: 429, body: { message: 'You are being rate limited.', retry_after: retry, global: false }, headers: { 'Retry-After': String(retry), Via: '1.1 serika' } };
    }
  }
  const appId = applicationIdOf(w);
  if (!appId) return run(input.body, input.threadId);
  const { inboundForApp, outboundForApp } = await import('@/lib/services/interactions');
  const body = input.body === undefined || input.body === null ? input.body : await inboundForApp(appId, input.body);
  const ids = input.threadId ? (await inboundForApp(appId, { thread_id: input.threadId })) as { thread_id?: string } : null;
  const result = await run(body, ids?.thread_id ?? input.threadId);
  return { ...result, body: await outboundForApp(appId, result.body) };
}

export async function deleteWebhook(w: WebhookRow): Promise<WebhookResult> {
  await removeWebhook(w);
  return { status: 204, body: '' };
}

/** Delete a webhook row, its uploaded avatar, and tell bots (every delete route). */
export async function removeWebhook(w: WebhookRow): Promise<void> {
  await ChannelWebhook.deleteById(w.id);
  cleanupWebhookAvatar(w.id, w.avatar, null);
  notifyWebhooksUpdate(w.serverId, w.channelId);
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
  const parsed = parseOutgoingMessage(body, { mode: 'edit', existingAttachmentIds: existing.map((a) => String(a.id)), existingAttachmentNames: existing.map((a) => a.filename), existingFlags: found.message.flags ?? 0 });
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
  const emb = resolveEmbeds(m, attachments);
  if (!emb.ok) return apiFailure(emb);
  const { sanitizeMessageContent } = await import('@/lib/api/channels');
  const r = await editAppMessage({
    channel: found.channel,
    message: found.message,
    author: authorOf(w),
    patch: {
      ...(m.has.content ? { content: m.content ? sanitizeMessageContent(m.content) : '', mentionedUserIds: m.allowedUserIds ?? [] } : {}),
      ...(m.has.embeds ? { embeds: emb.embeds } : {}),
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
