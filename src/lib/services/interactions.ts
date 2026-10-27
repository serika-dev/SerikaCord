/**
 * Interactions (Discord API v10): building and delivering them, applying the
 * app's response, and the token-authenticated webhook routes that edit it.
 *
 *   user ──▶ /api/interactions/* (command / autocomplete / component / modal)
 *          └▶ checks (channel access, command permissions, component exists
 *             and isn't disabled, modal fields) ─▶ state in Redis (15 min)
 *             ─▶ HTTP endpoint (Ed25519-signed, SSRF-guarded, 3 s, per-app
 *                concurrency cap) when the app set one, else INTERACTION_CREATE
 *                over the gateway
 *   app ──▶ POST /interactions/{id}/{token}/callback (or the HTTP response body)
 *          types 1 4 5 6 7 8 9; one acknowledgement within 3 s (40060 / 10062)
 *   app ──▶ /webhooks/{app}/{token}[/messages/@original|{id}] followups and edits
 *
 * Ephemeral responses go only to the invoker's activity stream (lib/services/
 * appMessages). The invoker's clients also get `interaction` events (ack,
 * failed, modal) so buttons stop spinning and modals open.
 */
import { randomUUID } from 'crypto';
import { Application, Channel, ChannelWebhook, ServerMember, User, type IChannel, type IMessage } from '@/lib/models';
import type { IAppCommand } from '@/lib/models/AppCommand';
import { getRedis } from '@/lib/db/redis';
import { processShared } from '@/lib/realtime/processShared';
import {
  ACK_DEADLINE_MS, ACK_GRACE_MS, CallbackType, InteractionStore, InteractionType, checkInitialCallback, checkTokenAlive,
  memoryKV, newInteractionToken, type InteractionKV, type InteractionResponseState, type InteractionState,
} from '@/lib/botapi/interactionState';
import {
  CommandType, DISCORD_LOCALES, OptionType, checkInvocationOptions, findDeclaredOption, stripMention, validateAutocompleteChoices,
  type CommandOption, type InvocationOption, type InvocationRefs,
} from '@/lib/botapi/commands';
import {
  ComponentType, buildModalSubmit, channelTypesAllowed, checkComponentClick, parseStoredComponents, validateModal, type Modal, type ModalSubmitValue,
} from '@/lib/botapi/components';
import { FormErrors, formError, FE } from '@/lib/botapi/formErrors';
import {
  FLAG_EPHEMERAL, FLAG_LOADING, finalizeComponents, isEmptyOutgoing, parseOutgoingPayload, prepareAppContent, resolveEmbeds,
  uploadOutgoingFiles, type ApiFailure, type OutgoingMessage,
} from '@/lib/services/outgoingMessage';
import {
  createAppMessage, deleteAppMessage, deleteEphemeral, editAppMessage, editEphemeral, ephemeralToDiscord, notifyInvoker,
  type AppAuthor, type EphemeralRecord, type InteractionRef,
} from '@/lib/services/appMessages';
import {
  attachmentSizeLimit, buildResolved, discordMember, discordMessageFromRow, discordPartialChannel, discordUser, loadLiveMessage,
} from '@/lib/services/interactionPayload';
import { DM_BOT_PERMISSIONS, applyTimeout } from '@/lib/permissions/botChannel';
import { parseBotMessageBody } from '@/lib/chat/botMultipart';
import type { IncomingAttachment } from '@/lib/chat/attachmentPolicy';
import { channelContext, resolveInvocableCommand, findUsableCommandsByName } from '@/lib/services/appCommands';

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

// ─── Store ──────────────────────────────────────────────────

function redisKV(): InteractionKV | null {
  const r = getRedis();
  if (!r) return null;
  return {
    get: (k) => r.get(k),
    set: async (k, v, ttl) => { await r.set(k, v, 'PX', ttl); },
    setNX: async (k, v, ttl) => (await r.set(k, v, 'PX', ttl, 'NX')) === 'OK',
    del: async (k) => { await r.del(k); },
  };
}

const memoryStore = processShared('interactionMemoryKV', () => memoryKV());

/** The interaction store: Redis (shared by instances, survives restarts), else in-process. */
export function interactionStore(): InteractionStore {
  return new InteractionStore(redisKV() ?? memoryStore);
}

// ─── Delivery to the app ────────────────────────────────────

type App = NonNullable<Awaited<ReturnType<typeof Application.findById>>>;

// ─── Id format (snowflake apps) ─────────────────────────────

const formatCache = processShared('interactionAppIdFormat', () => new Map<string, { at: number; fmt: 'uuid' | 'snowflake' }>());

/** The id format an application's bot uses (lib/botapi/boundary), cached briefly. */
export async function appIdFormat(applicationId: string | null | undefined): Promise<'uuid' | 'snowflake'> {
  if (!applicationId) return 'uuid';
  const hit = formatCache.get(applicationId);
  if (hit && Date.now() - hit.at < 30_000) return hit.fmt;
  const app = await Application.findById(applicationId).catch(() => null);
  const { idFormatOf } = await import('@/lib/botapi/boundary');
  const fmt = idFormatOf(app);
  if (formatCache.size > 2000) formatCache.clear();
  formatCache.set(applicationId, { at: Date.now(), fmt });
  return fmt;
}

/** Snowflakes → UUIDs in a token-route body (those routes carry no bot token, so the boundary skips them). */
export async function inboundForApp(applicationId: string | null | undefined, body: unknown): Promise<unknown> {
  if ((await appIdFormat(applicationId)) !== 'snowflake' || !body || typeof body !== 'object') return body;
  const { translateInbound, fromPublicView } = await import('@/lib/botapi/boundary');
  const res = await translateInbound({ body, reportUnknown: false });
  return fromPublicView(res.body !== undefined ? res.body : body);
}

/** UUIDs → snowflakes in what a token route (or HTTP delivery) sends to a snowflake app. */
export async function outboundForApp<T>(applicationId: string | null | undefined, value: T): Promise<T> {
  if ((await appIdFormat(applicationId)) !== 'snowflake' || !value || typeof value !== 'object') return value;
  const { toSnowflakes } = await import('@/lib/botapi/boundary');
  return toSnowflakes(value);
}

/** Run a token route for `applicationId`'s app with its id format on both sides. */
export async function withAppIds<R extends { status: number; body: unknown }>(
  applicationId: string | null | undefined,
  body: unknown,
  run: (body: unknown) => Promise<R>,
): Promise<R> {
  const result = await run(await inboundForApp(applicationId, body));
  return { ...result, body: await outboundForApp(applicationId, result.body) };
}

/** Largest JSON reply we read from an interactions endpoint. */
const MAX_RESPONSE_BYTES = 1024 * 1024;

/**
 * POST a signed interaction to an application's interactions endpoint and
 * return the parsed JSON response. Goes through the single SSRF-guarded path
 * in src/lib/botapi/endpointVerify.ts (https, public addresses re-checked on
 * every call, no redirects, 3 s, capped reply, per-app + global concurrency).
 */
export async function postSignedInteraction(
  app: { id?: string; interactionsEndpointUrl?: string | null; privateKeyPem?: string | null },
  payload: unknown,
): Promise<{ ok: boolean; status: number; body: unknown } | null> {
  if (!app.interactionsEndpointUrl || !app.privateKeyPem) return null;
  const { postSignedToEndpoint } = await import('@/lib/botapi/endpointVerify');
  return postSignedToEndpoint({
    url: app.interactionsEndpointUrl,
    privateKeyPem: app.privateKeyPem,
    payload,
    key: app.id ?? app.interactionsEndpointUrl,
    maxBytes: MAX_RESPONSE_BYTES,
  });
}

/**
 * May `botId` still post an interaction response into this channel? DMs: it
 * must be a recipient. Servers: it must still be a member and the channel must
 * belong to that server. Checked on every callback / follow-up, so a token
 * can't be used after the bot left, nor point anywhere else.
 */
async function botMayRespond(botId: string, channelId: string, serverId: string | null): Promise<IChannel | null> {
  const channel = await Channel.findById(channelId).catch(() => null);
  if (!channel) return null;
  if (!serverId) {
    if (channel.serverId) return null;
    return ((channel.recipientIds || []) as string[]).some((r) => same(r, botId)) ? channel : null;
  }
  if (!same(channel.serverId, serverId)) return null;
  const member = await ServerMember.findOne({ serverId, userId: botId }).catch(() => null);
  return member ? channel : null;
}

function discordLocale(locale: unknown): string {
  if (typeof locale !== 'string' || !locale) return 'en-US';
  if (DISCORD_LOCALES.has(locale)) return locale;
  const map: Record<string, string> = { en: 'en-US', es: 'es-ES', pt: 'pt-BR', sv: 'sv-SE', zh: 'zh-CN', 'zh-Hans': 'zh-CN', 'zh-Hant': 'zh-TW', nb: 'no' };
  if (map[locale]) return map[locale];
  const base = locale.split('-')[0];
  return DISCORD_LOCALES.has(base) ? base : map[base] ?? 'en-US';
}

type UserRow = NonNullable<Awaited<ReturnType<typeof User.findById>>>;

interface InvokeContext {
  user: UserRow;
  channel: IChannel;
  membership: { roles?: string[] | null; communicationDisabledUntil?: Date | null } | null;
}

/** The shared envelope of every interaction payload. */
async function basePayload(opts: {
  id: string;
  token: string;
  type: number;
  app: App;
  ctx: InvokeContext;
  data?: unknown;
  message?: unknown;
}) {
  const { ctx, app } = opts;
  const channel = ctx.channel;
  const guildId = channel.serverId ?? null;
  let memberPerms: bigint | null = null;
  let appPerms: bigint = DM_BOT_PERMISSIONS;
  let member: unknown;
  if (guildId) {
    const { getMemberChannelPermissions } = await import('@/lib/api/channels');
    const [membership, botMembership] = await Promise.all([
      ServerMember.findOne({ serverId: guildId, userId: ctx.user.id }),
      ServerMember.findOne({ serverId: guildId, userId: app.botId! }),
    ]);
    memberPerms = await getMemberChannelPermissions(ctx.user.id, channel as IChannel & { serverId: string }, membership);
    const rawBotPerms = botMembership ? await getMemberChannelPermissions(app.botId!, channel as IChannel & { serverId: string }, botMembership) : 0n;
    appPerms = applyTimeout(rawBotPerms, botMembership?.communicationDisabledUntil ?? null);
    if (membership) member = discordMember(membership, ctx.user, memberPerms, true);
  }
  const context = channelContext(channel);
  return {
    id: opts.id,
    application_id: app.id,
    type: opts.type,
    ...(opts.data !== undefined ? { data: opts.data } : {}),
    ...(guildId ? { guild_id: guildId, guild: { id: guildId, locale: 'en-US', features: [] as string[] } } : {}),
    channel_id: channel.id,
    channel: discordPartialChannel(channel, memberPerms ?? (guildId ? 0n : null)),
    ...(member ? { member } : { user: discordUser(ctx.user) }),
    token: opts.token,
    version: 1,
    ...(opts.message ? { message: opts.message } : {}),
    app_permissions: appPerms.toString(),
    locale: discordLocale((ctx.user.settings as { locale?: unknown } | null)?.locale),
    ...(guildId ? { guild_locale: 'en-US' } : {}),
    entitlements: [] as unknown[],
    authorizing_integration_owners: { '0': guildId ?? '0' },
    context,
    attachment_size_limit: attachmentSizeLimit(),
  };
}

type DeliveryResult = { ok: true; interactionId: string } | { ok: false; status: number; error: string; code: string };

/**
 * Send an interaction to its app: HTTP endpoint when set (its response body is
 * applied as the callback), otherwise the gateway (the app answers on the
 * callback route). No acknowledgement in time → the invoker sees "failed".
 */
async function deliver(app: App, state: InteractionState, token: string, payload: unknown): Promise<DeliveryResult> {
  const store = interactionStore();
  await store.create(token, state);
  const quiet = state.type === InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE;
  if (app.interactionsEndpointUrl) {
    // Snowflake-format apps get snowflakes over HTTP too (the gateway translates per session).
    const res = await postSignedInteraction(app, await outboundForApp(app.id, payload));
    if (!res || !res.ok || !res.body || typeof res.body !== 'object') {
      if (!quiet) void notifyInvoker(state.invokerId, { event: 'failed', interactionId: state.id, channelId: state.channelId, reason: 'no_response' });
      return { ok: true, interactionId: state.id };
    }
    const answer = (await inboundForApp(app.id, res.body)) as Record<string, unknown>;
    const applied = await applyCallback(state, { payload: answer, files: [] }, { withResponse: false });
    if (applied.status >= 400 && !quiet) {
      void notifyInvoker(state.invokerId, { event: 'failed', interactionId: state.id, channelId: state.channelId, reason: 'invalid_response' });
    }
    return { ok: true, interactionId: state.id };
  }
  const { emitInteractionCreate } = await import('@/lib/services/gatewayEvents');
  await emitInteractionCreate({ botId: app.botId!, guildId: state.guildId, interaction: payload });
  if (!quiet) {
    const timer = setTimeout(() => {
      void store.isAcked(state.id).then((acked) => {
        if (!acked) void notifyInvoker(state.invokerId, { event: 'failed', interactionId: state.id, channelId: state.channelId, reason: 'no_response' });
      }).catch(() => {});
    }, ACK_DEADLINE_MS + ACK_GRACE_MS + 250);
    (timer as { unref?: () => void }).unref?.();
  }
  return { ok: true, interactionId: state.id };
}

// ─── Applying the app's response ────────────────────────────

export type CallbackResult = { status: number; body: unknown };

function interactionRef(state: InteractionState): InteractionRef {
  return { id: state.id, type: state.type, name: state.commandName ?? '', user: { id: state.invokerId, username: state.invokerName }, applicationId: state.applicationId };
}

function failure(f: ApiFailure): CallbackResult {
  return { status: f.status, body: f.body };
}

/** Upload files + resolve attachment:// for a parsed outgoing message. */
async function materialize(
  parsed: Extract<ReturnType<typeof parseOutgoingPayload>, { ok: true }>,
  uploaderId: string,
  channelId: string,
  keep: IncomingAttachment[],
): Promise<{ ok: true; attachments: IncomingAttachment[]; components: OutgoingMessage['components']; embeds: unknown[]; content: string } | ApiFailure> {
  const uploaded = await uploadOutgoingFiles({ files: parsed.files, meta: parsed.fileMeta, uploaderId, channelId });
  if (!uploaded.ok) return uploaded;
  const attachments = [...keep, ...uploaded.attachments];
  const fin = finalizeComponents(parsed.message.components, attachments);
  if (!fin.ok) return fin;
  const emb = resolveEmbeds(parsed.message, attachments);
  if (!emb.ok) return emb;
  const content = await prepareAppContent(parsed.message.content);
  return { ok: true, attachments, components: fin.components, embeds: emb.embeds, content };
}

function botAuthorOf(state: InteractionState): AppAuthor {
  return { kind: 'bot', botId: state.botId, applicationId: state.applicationId };
}

/**
 * Apply an initial response (callback route or HTTP endpoint body). Checks the
 * 3 s deadline, claims the single acknowledgement, then applies the type.
 */
async function applyCallback(
  state: InteractionState,
  input: { payload: Record<string, unknown>; files: Parameters<typeof parseOutgoingPayload>[1] },
  opts: { withResponse: boolean },
): Promise<CallbackResult> {
  const store = interactionStore();
  const type = input.payload.type;
  const pre = checkInitialCallback(state, type, false);
  if (!pre.ok) return { status: pre.status, body: { code: pre.code, message: pre.message, ...(pre.errors ? { errors: pre.errors } : {}) } };
  const cbType = type as number;

  // Validate before claiming, so a malformed body doesn't burn the acknowledgement.
  const data = input.payload.data;
  let parsed: ReturnType<typeof parseOutgoingPayload> | null = null;
  let modal: Modal | null = null;
  let choices: ReturnType<typeof validateAutocompleteChoices> = null;
  if (cbType === CallbackType.CHANNEL_MESSAGE_WITH_SOURCE || cbType === CallbackType.UPDATE_MESSAGE) {
    // UPDATE_MESSAGE edits the component's message: its IS_COMPONENTS_V2 flag
    // stays on (and its components validate as v2) even when data omits flags.
    const source = cbType === CallbackType.UPDATE_MESSAGE ? await sourceMessageShape(state) : null;
    parsed = parseOutgoingPayload(data ?? {}, input.files, {
      mode: cbType === CallbackType.UPDATE_MESSAGE ? 'edit' : 'create',
      allowEphemeral: cbType === CallbackType.CHANNEL_MESSAGE_WITH_SOURCE,
      ...(source ? { existingFlags: source.flags, existingContent: source.content, existingEmbeds: source.embeds } : {}),
    });
    if (!parsed.ok) return failure(parsed);
  } else if (cbType === CallbackType.MODAL) {
    const errors = new FormErrors();
    modal = validateModal(data, errors);
    if (!modal) return { status: 400, body: errors.toBody() };
  } else if (cbType === CallbackType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT) {
    choices = validateAutocompleteChoices(data ?? {}, state.focusedType ?? OptionType.STRING);
    if (!choices) return { status: 400, body: formError(['data', 'choices'], FE.INVALID, 'Invalid autocomplete choices for the focused option') };
  }

  const channel = await botMayRespond(state.botId, state.channelId, state.guildId);
  if (!channel) return { status: 404, body: { code: 10003, message: 'Unknown Channel' } };

  if (!(await store.claimAck(state.id, cbType))) {
    return { status: 400, body: { code: 40060, message: 'Interaction has already been acknowledged.' } };
  }

  try {
    let response: InteractionResponseState = { type: cbType };
    let resourceMessage: unknown = null;
    switch (cbType) {
      case CallbackType.PONG:
        break;
      case CallbackType.CHANNEL_MESSAGE_WITH_SOURCE: {
        const p = parsed as Extract<typeof parsed, { ok: true }>;
        const mat = await materialize(p, state.botId, state.channelId, []);
        if (!mat.ok) { await store.releaseAck(state.id); return failure(mat); }
        if (isEmptyOutgoing(p.message, mat.attachments.length)) {
          await store.releaseAck(state.id);
          return { status: 400, body: { code: 50006, message: 'Cannot send an empty message' } };
        }
        const created = await createAppMessage({
          author: botAuthorOf(state),
          channel,
          body: { content: mat.content, embeds: mat.embeds, components: mat.components, attachments: mat.attachments, flags: p.message.flags, mentionedUserIds: p.message.ephemeral ? [] : p.message.allowedUserIds ?? [] },
          interaction: interactionRef(state),
          ephemeralFor: p.message.ephemeral ? { userId: state.invokerId, store, interactionId: state.id, applicationId: state.applicationId, botId: state.botId } : null,
        });
        response = { type: cbType, messageId: created.id, ephemeral: created.ephemeral };
        resourceMessage = created.discord;
        break;
      }
      case CallbackType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: {
        const flags = typeof (data as { flags?: unknown } | undefined)?.flags === 'number' ? (data as { flags: number }).flags : 0;
        const ephemeral = (flags & FLAG_EPHEMERAL) !== 0;
        const created = await createAppMessage({
          author: botAuthorOf(state),
          channel,
          body: { content: '', embeds: [], components: null, attachments: [], flags: 0, mentionedUserIds: [] },
          interaction: interactionRef(state),
          ephemeralFor: ephemeral ? { userId: state.invokerId, store, interactionId: state.id, applicationId: state.applicationId, botId: state.botId } : null,
          loading: true,
        });
        response = { type: cbType, messageId: created.id, ephemeral, loading: true };
        resourceMessage = created.discord;
        break;
      }
      case CallbackType.DEFERRED_UPDATE_MESSAGE:
        response = { type: cbType, messageId: state.sourceMessageId ?? null, ephemeral: Boolean(state.sourceEphemeral) };
        break;
      case CallbackType.UPDATE_MESSAGE: {
        const p = parsed as Extract<typeof parsed, { ok: true }>;
        const updated = await updateSourceMessage(state, channel, p);
        if ('status' in updated) { await store.releaseAck(state.id); return updated; }
        response = { type: cbType, messageId: state.sourceMessageId ?? null, ephemeral: Boolean(state.sourceEphemeral) };
        resourceMessage = updated.discord;
        break;
      }
      case CallbackType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT:
        await store.setAutocomplete(state.id, choices ?? []);
        announceAutocomplete(state.id);
        break;
      case CallbackType.MODAL: {
        const modalId = randomUUID().replace(/-/g, '');
        await store.putRecord('modal', modalId, {
          modal,
          applicationId: state.applicationId,
          botId: state.botId,
          userId: state.invokerId,
          channelId: state.channelId,
          guildId: state.guildId,
          sourceMessageId: state.sourceMessageId ?? null,
          sourceEphemeral: Boolean(state.sourceEphemeral),
          commandName: state.commandName ?? '',
        } satisfies ModalRecord);
        const app = await Application.findById(state.applicationId);
        void notifyInvoker(state.invokerId, {
          event: 'modal',
          interactionId: state.id,
          channelId: state.channelId,
          modalId,
          modal,
          application: { id: state.applicationId, name: app?.name ?? '', icon: app?.icon ?? null },
        });
        break;
      }
    }
    await store.setResponse(state.id, response);
    void notifyInvoker(state.invokerId, { event: 'ack', interactionId: state.id, channelId: state.channelId, callbackType: cbType });
    if (!opts.withResponse) return { status: 204, body: '' };
    return {
      status: 200,
      body: {
        interaction: {
          id: state.id,
          type: state.type,
          ...(response.messageId ? { response_message_id: response.messageId } : {}),
          ...(cbType === CallbackType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE ? { response_message_loading: true } : {}),
          ...(response.messageId ? { response_message_ephemeral: Boolean(response.ephemeral) } : {}),
          channel_id: state.channelId,
          ...(state.guildId ? { guild_id: state.guildId } : {}),
        },
        ...(resourceMessage && (cbType === CallbackType.CHANNEL_MESSAGE_WITH_SOURCE || cbType === CallbackType.UPDATE_MESSAGE || cbType === CallbackType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE)
          ? { resource: { type: cbType === CallbackType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE ? CallbackType.CHANNEL_MESSAGE_WITH_SOURCE : cbType, message: resourceMessage } }
          : {}),
      },
    };
  } catch (err) {
    console.error('[interactions] applying callback failed:', (err as Error)?.message ?? err);
    await store.releaseAck(state.id).catch(() => {});
    return { status: 500, body: { code: 0, message: '500: Internal Server Error' } };
  }
}

interface ModalRecord {
  modal: Modal | null;
  applicationId: string;
  botId: string;
  userId: string;
  channelId: string;
  guildId: string | null;
  sourceMessageId: string | null;
  sourceEphemeral: boolean;
  commandName: string;
}

/** Callback 7: edit the message the component is on (only the app's own messages). */
async function updateSourceMessage(
  state: InteractionState,
  channel: IChannel,
  p: Extract<ReturnType<typeof parseOutgoingPayload>, { ok: true }>,
): Promise<{ discord: unknown } | CallbackResult> {
  const store = interactionStore();
  if (!state.sourceMessageId) return { status: 400, body: { code: 50035, message: 'Invalid Form Body (type: there is no message to update)' } };
  if (state.sourceEphemeral) {
    const record = await store.getRecord<EphemeralRecord>('eph', state.sourceMessageId);
    if (!record || !same(record.botId, state.botId) || !same(record.invokerId, state.invokerId)) return { status: 404, body: { code: 10008, message: 'Unknown Message' } };
    const keep = keepAttachments(record.attachments, p.message.keepAttachmentIds);
    const mat = await materialize(p, state.botId, state.channelId, keep);
    if (!mat.ok) return failure(mat);
    const r = await editEphemeral(store, record, patchFrom(p.message, mat));
    return { discord: r.discord };
  }
  const msg = await loadLiveMessage(state.channelId, state.sourceMessageId);
  if (!msg) return { status: 404, body: { code: 10008, message: 'Unknown Message' } };
  const author = await sourceAuthor(msg, state);
  if (!author) return { status: 403, body: { code: 50005, message: 'Cannot edit a message authored by another user' } };
  const keep = keepAttachments((msg.attachments ?? []) as IncomingAttachment[], p.message.keepAttachmentIds);
  const mat = await materialize(p, state.botId, state.channelId, keep);
  if (!mat.ok) return failure(mat);
  const r = await editAppMessage({ channel, message: msg, patch: patchFrom(p.message, mat), author });
  return { discord: r.discord };
}

/** Flags and whether text / embeds are set, for the message a component interaction came from. */
async function sourceMessageShape(state: InteractionState): Promise<{ flags: number; content: boolean; embeds: boolean } | null> {
  if (!state.sourceMessageId) return null;
  const shape = (m: { flags?: number | null; content?: unknown; embeds?: unknown } | null) => m
    ? { flags: (m.flags ?? 0) & ~FLAG_LOADING, content: Boolean(m.content), embeds: Array.isArray(m.embeds) && m.embeds.length > 0 }
    : null;
  if (state.sourceEphemeral) return shape(await interactionStore().getRecord<EphemeralRecord>('eph', state.sourceMessageId).catch(() => null));
  return shape(await loadLiveMessage(state.channelId, state.sourceMessageId).catch(() => null));
}

/** The author an interaction may edit a message as: the app's bot or an app-owned webhook. */
async function sourceAuthor(msg: IMessage, state: InteractionState): Promise<AppAuthor | null> {
  if (same(msg.authorId, state.botId)) return botAuthorOf(state);
  const hook = await ChannelWebhook.findById(msg.authorId).catch(() => null);
  if (hook && same((hook as { applicationId?: string | null }).applicationId, state.applicationId)) {
    return { kind: 'webhook', webhook: { id: hook.id, name: hook.name, avatar: hook.avatar, applicationId: state.applicationId } };
  }
  return null;
}

function keepAttachments(existing: IncomingAttachment[], keepIds: string[] | null): IncomingAttachment[] {
  if (keepIds === null) return existing;
  return existing.filter((a) => keepIds.includes(String(a.id)));
}

function patchFrom(m: OutgoingMessage, mat: { attachments: IncomingAttachment[]; components: OutgoingMessage['components']; embeds: unknown[]; content: string }) {
  return {
    ...(m.has.content ? { content: mat.content } : {}),
    ...(m.has.embeds ? { embeds: mat.embeds } : {}),
    ...(m.has.components ? { components: mat.components ?? [] } : {}),
    ...(m.has.attachments ? { attachments: mat.attachments } : {}),
    ...(m.has.flags ? { flags: m.flags } : {}),
    ...(m.has.content ? { mentionedUserIds: m.allowedUserIds ?? [] } : {}),
  };
}

/**
 * POST /interactions/{id}/{token}/callback. `body` is JSON or multipart
 * (payload_json = { type, data } + files[n]).
 */
export async function handleInteractionCallback(
  interactionId: string,
  token: string,
  body: unknown,
  opts: { withResponse?: boolean } = {},
): Promise<CallbackResult> {
  const store = interactionStore();
  const state = await store.getByToken(token);
  if (!state || !same(state.id, interactionId)) return { status: 404, body: { code: 10062, message: 'Unknown interaction' } };
  const limited = await tokenRateLimited(state);
  if (limited) return limited;
  return withAppIds(state.applicationId, body, async (translated) => {
    const parsed = parseBotMessageBody(translated);
    if (!parsed.ok) return { status: 400, body: { code: parsed.code, message: parsed.error } };
    return applyCallback(state, { payload: parsed.payload, files: parsed.files }, { withResponse: Boolean(opts.withResponse) });
  });
}

// ─── Webhook-token routes (followups, @original) ────────────

/** Resolve an interaction token for /webhooks/{application_id}/{token}…; null when it isn't one. */
export async function resolveInteractionWebhook(applicationId: string, token: string): Promise<InteractionState | null> {
  const state = await interactionStore().getByToken(token);
  if (!state || !checkTokenAlive(state).ok) return null;
  // Autocomplete and PING tokens never get messages (a type-8 answer isn't a
  // reply the user asked for).
  if (state.type === InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE || state.type === InteractionType.PING) return null;
  if (same(state.applicationId, applicationId)) return state;
  // clientId alias for the application id.
  const app = await Application.findById(state.applicationId).catch(() => null);
  return app && same(app.clientId, applicationId) ? state : null;
}

const UNKNOWN_MESSAGE = { status: 404, body: { code: 10008, message: 'Unknown Message' } };
const UNKNOWN_WEBHOOK = { status: 404, body: { code: 10015, message: 'Unknown Webhook' } };

type Target =
  | { kind: 'ephemeral'; record: EphemeralRecord; original: boolean }
  | { kind: 'message'; message: IMessage; author: AppAuthor; original: boolean };

async function findTarget(state: InteractionState, messageId: string): Promise<Target | null> {
  const store = interactionStore();
  const response = await store.getResponse(state.id);
  const isOriginal = messageId === '@original';
  const id = isOriginal ? response?.messageId ?? null : messageId;
  if (!id) return null;
  const ephemeral = isOriginal ? Boolean(response?.ephemeral) : false;
  const record = await store.getRecord<EphemeralRecord>('eph', id);
  if (record) {
    if (!same(record.botId, state.botId) || !same(record.channelId, state.channelId)) return null;
    if (!isOriginal && !same(record.interactionId, state.id)) return null;
    return { kind: 'ephemeral', record, original: isOriginal || same(id, response?.messageId) };
  }
  if (ephemeral) return null;
  const msg = await loadLiveMessage(state.channelId, id);
  if (!msg) return null;
  const ref = msg.interaction as { id?: string } | null;
  const belongs = (isOriginal || same(id, response?.messageId)) || same(ref?.id, state.id);
  if (!belongs) return null;
  const author = await sourceAuthor(msg, state);
  if (!author) return null;
  return { kind: 'message', message: msg, author, original: isOriginal || same(id, response?.messageId) };
}

/**
 * Token routes carry no bot token, so the per-bot limits don't apply: limit
 * per interaction and per application here instead (Discord-shaped 429).
 */
async function tokenRateLimited(state: InteractionState): Promise<CallbackResult | null> {
  const { checkRateLimit } = await import('@/lib/security');
  for (const [limiter, key] of [['interactionToken', state.id], ['interactionApp', state.applicationId]] as const) {
    const r = await checkRateLimit(limiter, key);
    if (!r.success) {
      const retry = Math.max(0.001, (r.resetAfterMs ?? (r.retryAfter ?? 1) * 1000) / 1000);
      return { status: 429, body: { message: 'You are being rate limited.', retry_after: retry, global: false } };
    }
  }
  return null;
}

/** POST /webhooks/{app}/{token}: a followup message. */
export async function createFollowup(state: InteractionState, body: unknown): Promise<CallbackResult> {
  const limited = await tokenRateLimited(state);
  if (limited) return limited;
  const store = interactionStore();
  if (!(await store.isAcked(state.id))) return UNKNOWN_WEBHOOK;
  const ack = await store.getResponse(state.id);
  // A modal or autocomplete answer isn't a message to follow up on.
  if (ack && (ack.type === CallbackType.MODAL || ack.type === CallbackType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT)) return UNKNOWN_WEBHOOK;
  const parsedBody = parseBotMessageBody(body);
  if (!parsedBody.ok) return { status: 400, body: { code: parsedBody.code, message: parsedBody.error } };
  const p = parseOutgoingPayload(parsedBody.payload, parsedBody.files, { mode: 'create', allowEphemeral: true });
  if (!p.ok) return failure(p);
  const channel = await botMayRespond(state.botId, state.channelId, state.guildId);
  if (!channel) return { status: 404, body: { code: 10003, message: 'Unknown Channel' } };
  const response = await store.getResponse(state.id);
  // After a deferred response, the first followup completes the "thinking…" message.
  if (response?.loading && response.messageId) {
    const target = await findTarget(state, '@original');
    if (target) {
      const r = await editTarget(state, target, p, channel);
      if ('discord' in r) {
        await store.setResponse(state.id, { ...response, loading: false });
        return { status: 200, body: r.discord };
      }
      return r;
    }
  }
  const mat = await materialize(p, state.botId, state.channelId, []);
  if (!mat.ok) return failure(mat);
  if (isEmptyOutgoing(p.message, mat.attachments.length)) return { status: 400, body: { code: 50006, message: 'Cannot send an empty message' } };
  const created = await createAppMessage({
    author: botAuthorOf(state),
    channel,
    body: { content: mat.content, embeds: mat.embeds, components: mat.components, attachments: mat.attachments, flags: p.message.flags, mentionedUserIds: p.message.ephemeral ? [] : p.message.allowedUserIds ?? [] },
    interaction: interactionRef(state),
    ephemeralFor: p.message.ephemeral ? { userId: state.invokerId, store, interactionId: state.id, applicationId: state.applicationId, botId: state.botId } : null,
  });
  return { status: 200, body: created.discord };
}

async function editTarget(
  state: InteractionState,
  target: Target,
  p: Extract<ReturnType<typeof parseOutgoingPayload>, { ok: true }>,
  channel: IChannel,
): Promise<{ discord: unknown } | CallbackResult> {
  const store = interactionStore();
  if (target.kind === 'ephemeral') {
    const mat = await materialize(p, state.botId, state.channelId, keepAttachments(target.record.attachments, p.message.keepAttachmentIds));
    if (!mat.ok) return failure(mat);
    const r = await editEphemeral(store, target.record, patchFrom(p.message, mat));
    return { discord: r.discord };
  }
  const mat = await materialize(p, state.botId, state.channelId, keepAttachments((target.message.attachments ?? []) as IncomingAttachment[], p.message.keepAttachmentIds));
  if (!mat.ok) return failure(mat);
  const r = await editAppMessage({ channel, message: target.message, patch: patchFrom(p.message, mat), author: target.author });
  return { discord: r.discord };
}

/** GET /webhooks/{app}/{token}/messages/{@original|id}. */
export async function getInteractionMessage(state: InteractionState, messageId: string): Promise<CallbackResult> {
  const target = await findTarget(state, messageId);
  if (!target) return UNKNOWN_MESSAGE;
  if (target.kind === 'ephemeral') return { status: 200, body: await ephemeralToDiscord(target.record) };
  return { status: 200, body: await discordMessageFromRow(target.message) };
}

/** PATCH /webhooks/{app}/{token}/messages/{@original|id}. */
export async function editInteractionMessage(state: InteractionState, messageId: string, body: unknown): Promise<CallbackResult> {
  const limited = await tokenRateLimited(state);
  if (limited) return limited;
  const store = interactionStore();
  const target = await findTarget(state, messageId);
  if (!target) return UNKNOWN_MESSAGE;
  const parsedBody = parseBotMessageBody(body);
  if (!parsedBody.ok) return { status: 400, body: { code: parsedBody.code, message: parsedBody.error } };
  const existing = target.kind === 'ephemeral' ? target.record : target.message;
  const p = parseOutgoingPayload(parsedBody.payload, parsedBody.files, {
    mode: 'edit',
    existingAttachmentIds: ((existing.attachments ?? []) as IncomingAttachment[]).map((a) => String(a.id)),
    existingAttachmentNames: ((existing.attachments ?? []) as IncomingAttachment[]).map((a) => a.filename),
    existingFlags: (existing.flags ?? 0) & ~FLAG_LOADING,
    existingContent: Boolean(existing.content),
    existingEmbeds: Array.isArray(existing.embeds) && existing.embeds.length > 0,
  });
  if (!p.ok) return failure(p);
  const channel = await botMayRespond(state.botId, state.channelId, state.guildId);
  if (!channel) return { status: 404, body: { code: 10003, message: 'Unknown Channel' } };
  const r = await editTarget(state, target, p, channel);
  if (!('discord' in r)) return r;
  if (target.original) {
    const response = await store.getResponse(state.id);
    if (response?.loading) await store.setResponse(state.id, { ...response, loading: false });
  }
  return { status: 200, body: r.discord };
}

/** DELETE /webhooks/{app}/{token}/messages/{@original|id}. */
export async function deleteInteractionMessage(state: InteractionState, messageId: string): Promise<CallbackResult> {
  const limited = await tokenRateLimited(state);
  if (limited) return limited;
  const target = await findTarget(state, messageId);
  if (!target) return UNKNOWN_MESSAGE;
  if (target.kind === 'ephemeral') {
    await deleteEphemeral(interactionStore(), target.record);
    return { status: 204, body: '' };
  }
  const channel = await Channel.findById(state.channelId);
  if (!channel) return UNKNOWN_MESSAGE;
  await deleteAppMessage(channel, target.message);
  return { status: 204, body: '' };
}

// ─── User → interaction ─────────────────────────────────────

export type InvokeError = { ok: false; status: number; error: string; code: string };

/** Channel access + timeout / send gate for the invoker (same as sending a message). */
async function invokerContext(user: UserRow, channelId: string, opts: { requireSend: boolean }): Promise<{ ok: true; ctx: InvokeContext } | InvokeError> {
  const { checkChannelAccess, checkCanSpeak, checkCanPostInChannel } = await import('@/lib/api/channels');
  const access = await checkChannelAccess(user.id, channelId);
  if (!access.hasAccess || !access.channel) return { ok: false, status: 403, error: access.error || 'Access denied', code: 'no_access' };
  const channel = access.channel as IChannel;
  const membership = access.membership ?? null;
  if (opts.requireSend) {
    const speak = await checkCanSpeak(channel, membership, user.id, ['send']);
    if (speak) return { ok: false, status: speak.status, error: String(speak.body.error ?? 'Forbidden'), code: 'cannot_send' };
  }
  const denied = await checkCanPostInChannel(channel, user as never, membership, { checkSendPermission: false });
  if (denied) return { ok: false, status: denied.status, error: String(denied.body.error ?? 'Forbidden'), code: 'cannot_send' };
  return { ok: true, ctx: { user, channel, membership } };
}

async function rateLimited(kind: 'interactionCreate' | 'interactionAutocomplete', userId: string): Promise<InvokeError | null> {
  const { checkRateLimit } = await import('@/lib/security');
  const r = await checkRateLimit(kind, userId);
  return r.success ? null : { ok: false, status: 429, error: 'You are doing that too fast', code: 'rate_limited' };
}

function newState(app: App, ctx: InvokeContext, type: number, extra: Partial<InteractionState> = {}): InteractionState {
  return {
    id: randomUUID(),
    type,
    applicationId: app.id,
    botId: app.botId!,
    channelId: ctx.channel.id,
    guildId: ctx.channel.serverId ?? null,
    invokerId: ctx.user.id,
    invokerName: ctx.user.username,
    createdAt: Date.now(),
    ...extra,
  };
}

const INVALID_OPTIONS = (option?: string): InvokeError => ({ ok: false, status: 400, error: option ? `Invalid value for option "${option}"` : 'Invalid command options', code: 'invalid_options' });

/** Run an already-permitted command (shared by the picker route and the text fallback). */
async function dispatchCommand(opts: {
  ctx: InvokeContext;
  command: IAppCommand;
  app: App;
  options?: unknown;
  targetId?: string | null;
  attachments?: IncomingAttachment[];
}): Promise<DeliveryResult> {
  const { ctx, command, app } = opts;
  const type = command.type ?? CommandType.CHAT_INPUT;
  const declared = (Array.isArray(command.options) ? command.options : []) as CommandOption[];
  let options: InvocationOption[] = [];
  let refs: InvocationRefs & { messages?: string[] } = { users: [], roles: [], channels: [], mentionables: [], attachments: [] };
  let path: string[] = [];
  let targetMessage: IMessage | null = null;
  let targetId: string | undefined;
  if (type === CommandType.CHAT_INPUT) {
    const check = checkInvocationOptions(declared, opts.options);
    if (!check.ok) return INVALID_OPTIONS(check.option);
    options = check.options;
    refs = check.refs;
    path = check.path;
  } else if (type === CommandType.USER) {
    if (typeof opts.targetId !== 'string') return INVALID_OPTIONS();
    targetId = stripMention(opts.targetId, 'user');
    refs.users = [targetId];
  } else if (type === CommandType.MESSAGE) {
    if (typeof opts.targetId !== 'string') return INVALID_OPTIONS();
    targetMessage = await loadLiveMessage(ctx.channel.id, opts.targetId);
    if (!targetMessage) return { ok: false, status: 404, error: 'Unknown message', code: 'unknown_message' };
    targetId = targetMessage.id;
  } else {
    return { ok: false, status: 400, error: 'Unsupported command type', code: 'unknown_command' };
  }
  const resolved = await buildResolved({ invokerId: ctx.user.id, channel: ctx.channel, attachments: opts.attachments, targetMessage }, refs);
  if (!resolved.ok) return INVALID_OPTIONS();
  const state = newState(app, ctx, InteractionType.APPLICATION_COMMAND, {
    commandId: command.id,
    commandType: type,
    commandName: [command.name, ...path].join(' '),
  });
  const token = newInteractionToken();
  const data = {
    id: command.id,
    name: command.name,
    type,
    ...(command.guildId ? { guild_id: command.guildId } : {}),
    ...(options.length ? { options } : {}),
    ...(Object.keys(resolved.resolved).length ? { resolved: resolved.resolved } : {}),
    ...(targetId ? { target_id: targetId } : {}),
  };
  const payload = await basePayload({ id: state.id, token, type: InteractionType.APPLICATION_COMMAND, app, ctx, data });
  return deliver(app, state, token, payload);
}

/** Picker / context menu: run command `commandId` (typed options or a target). */
export async function invokeApplicationCommand(input: {
  user: UserRow;
  channelId: string;
  commandId: string;
  options?: unknown;
  targetId?: string | null;
  attachments?: IncomingAttachment[];
}): Promise<DeliveryResult> {
  const limited = await rateLimited('interactionCreate', input.user.id);
  if (limited) return limited;
  const c = await invokerContext(input.user, input.channelId, { requireSend: true });
  if (!c.ok) return c;
  const resolved = await resolveInvocableCommand({ userId: input.user.id, channel: c.ctx.channel, membership: c.ctx.membership }, input.commandId);
  if (!resolved.ok) return resolved;
  return dispatchCommand({ ctx: c.ctx, command: resolved.command, app: resolved.app, options: input.options, targetId: input.targetId, attachments: input.attachments });
}

/** Autocomplete while typing an option: returns the app's choices (or [] after ~2.5 s). */
export async function invokeAutocomplete(input: {
  user: UserRow;
  channelId: string;
  commandId: string;
  options: unknown;
}): Promise<{ ok: true; choices: unknown[] } | InvokeError> {
  const limited = await rateLimited('interactionAutocomplete', input.user.id);
  if (limited) return limited;
  const c = await invokerContext(input.user, input.channelId, { requireSend: true });
  if (!c.ok) return c;
  const resolved = await resolveInvocableCommand({ userId: input.user.id, channel: c.ctx.channel, membership: c.ctx.membership }, input.commandId, CommandType.CHAT_INPUT);
  if (!resolved.ok) return resolved;
  const declared = (Array.isArray(resolved.command.options) ? resolved.command.options : []) as CommandOption[];
  const check = checkInvocationOptions(declared, input.options, { autocomplete: true });
  if (!check.ok || !check.focused) return INVALID_OPTIONS(check.ok ? undefined : check.option);
  const focusedDecl = findDeclaredOption(declared, check.path, check.focused.name);
  const state = newState(resolved.app, c.ctx, InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE, {
    commandId: resolved.command.id,
    commandType: CommandType.CHAT_INPUT,
    commandName: resolved.command.name,
    focusedType: focusedDecl?.type ?? OptionType.STRING,
  });
  const token = newInteractionToken();
  const data = {
    id: resolved.command.id,
    name: resolved.command.name,
    type: CommandType.CHAT_INPUT,
    ...(resolved.command.guildId ? { guild_id: resolved.command.guildId } : {}),
    options: check.options,
  };
  const payload = await basePayload({ id: state.id, token, type: InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE, app: resolved.app, ctx: c.ctx, data });
  const delivered = await deliver(resolved.app, state, token, payload);
  if (!delivered.ok) return delivered;
  const store = interactionStore();
  // Woken by the callback (this instance, or another one via Redis pub/sub)
  // instead of polling; a last read at the deadline catches a missed wake-up.
  const woke = waitForAutocomplete(state.id, ACK_DEADLINE_MS + ACK_GRACE_MS);
  const early = await store.takeAutocomplete(state.id);
  if (early) { cancelAutocompleteWait(state.id); return { ok: true, choices: early }; }
  await woke;
  return { ok: true, choices: (await store.takeAutocomplete(state.id)) ?? [] };
}

// ─── Autocomplete wake-ups ──────────────────────────────────

const AC_CHANNEL = 'ix:autocomplete';
const acWaiters = processShared('interactionAcWaiters', () => new Map<string, () => void>());
const acBus = processShared('interactionAcBus', () => ({ started: false }));

function wakeAutocomplete(id: string) {
  const wake = acWaiters.get(id);
  if (wake) { acWaiters.delete(id); wake(); }
}

function cancelAutocompleteWait(id: string) {
  wakeAutocomplete(id);
}

/** Subscribe this process to autocomplete wake-ups from other instances (once, dedicated connection). */
async function startAutocompleteBus() {
  if (acBus.started) return;
  acBus.started = true;
  try {
    const { config } = await import('@/lib/config');
    if (!config.REDIS_URL) return;
    const Redis = (await import('ioredis')).default;
    const sub = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: null });
    sub.on('error', (err: Error) => console.error('[interactions] autocomplete bus error:', err.message));
    await sub.connect();
    await sub.subscribe(AC_CHANNEL);
    sub.on('message', (_ch: string, id: string) => wakeAutocomplete(id));
  } catch (err) {
    acBus.started = false;
    console.error('[interactions] autocomplete bus failed:', (err as Error)?.message ?? err);
  }
}

function waitForAutocomplete(id: string, timeoutMs: number): Promise<void> {
  void startAutocompleteBus();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => { acWaiters.delete(id); resolve(); }, timeoutMs);
    acWaiters.set(id, () => { clearTimeout(timer); resolve(); });
  });
}

/** The app answered an autocomplete: wake the waiting request wherever it is. */
function announceAutocomplete(id: string) {
  wakeAutocomplete(id);
  try {
    const pub = getRedis();
    if (pub) void pub.publish(AC_CHANNEL, id).catch(() => {});
  } catch { /* the waiter's deadline read still picks it up */ }
}

/** The app that owns a message's components (its bot, or an app-owned webhook). */
async function componentOwner(authorId: string): Promise<App | null> {
  const byBot = await Application.findOne({ botId: authorId }).catch(() => null);
  if (byBot) return byBot;
  const hook = await ChannelWebhook.findById(authorId).catch(() => null);
  const appId = (hook as { applicationId?: string | null } | null)?.applicationId;
  return appId ? Application.findById(appId).catch(() => null) : null;
}

/** A button click or select choice on a message → MESSAGE_COMPONENT interaction. */
export async function invokeComponent(input: {
  user: UserRow;
  channelId: string;
  messageId: string;
  customId: string;
  componentType: number;
  values?: unknown;
}): Promise<DeliveryResult> {
  const limited = await rateLimited('interactionCreate', input.user.id);
  if (limited) return limited;
  const c = await invokerContext(input.user, input.channelId, { requireSend: false });
  if (!c.ok) return c;
  const store = interactionStore();
  let components: ReturnType<typeof parseStoredComponents> = null;
  let ownerId: string;
  let message: unknown;
  let ephemeral = false;
  const record = await store.getRecord<EphemeralRecord>('eph', input.messageId);
  if (record) {
    // Only the invoker ever saw an ephemeral message.
    if (!same(record.invokerId, input.user.id) || !same(record.channelId, input.channelId)) return { ok: false, status: 404, error: 'Unknown message', code: 'unknown_message' };
    components = record.components;
    ownerId = record.botId;
    message = await ephemeralToDiscord(record);
    ephemeral = true;
  } else {
    const msg = await loadLiveMessage(input.channelId, input.messageId);
    if (!msg) return { ok: false, status: 404, error: 'Unknown message', code: 'unknown_message' };
    components = parseStoredComponents(msg.components);
    ownerId = msg.authorId;
    message = await discordMessageFromRow(msg);
  }
  const click = checkComponentClick(components, { customId: input.customId, componentType: input.componentType, values: input.values });
  if (!click.ok) return { ok: false, status: 400, error: 'This component is not available', code: `component_${click.reason}` };
  const app = await componentOwner(ownerId);
  if (!app || !app.botId) return { ok: false, status: 404, error: 'Unknown application', code: 'unknown_application' };
  if (!(await botMayRespond(app.botId, c.ctx.channel.id, c.ctx.channel.serverId ?? null))) {
    return { ok: false, status: 404, error: 'The application is no longer here', code: 'unknown_application' };
  }
  // Entity selects: the picked users / roles / channels must be real and visible.
  let resolved: Record<string, unknown> | null = null;
  if (click.values && click.component.type !== ComponentType.STRING_SELECT) {
    const refs: InvocationRefs = { users: [], roles: [], channels: [], mentionables: [], attachments: [] };
    if (click.component.type === ComponentType.USER_SELECT) refs.users = click.values.map((v) => v.toLowerCase());
    else if (click.component.type === ComponentType.ROLE_SELECT) refs.roles = click.values.map((v) => v.toLowerCase());
    else if (click.component.type === ComponentType.CHANNEL_SELECT) refs.channels = click.values.map((v) => v.toLowerCase());
    else refs.mentionables = click.values.map((v) => v.toLowerCase());
    const r = await buildResolved({ invokerId: input.user.id, channel: c.ctx.channel }, refs);
    if (!r.ok) return { ok: false, status: 400, error: 'This selection is not available', code: 'component_values' };
    // Channel selects: only the channel types the app asked for.
    if (click.component.type === ComponentType.CHANNEL_SELECT && click.component.channel_types?.length
      && !channelTypesAllowed([{ values: click.values, types: click.component.channel_types }], r.resolved.channels)) {
      return { ok: false, status: 400, error: 'This selection is not available', code: 'component_values' };
    }
    resolved = r.resolved;
  }
  const state = newState(app, c.ctx, InteractionType.MESSAGE_COMPONENT, {
    sourceMessageId: input.messageId,
    sourceEphemeral: ephemeral,
    commandName: '',
  });
  const token = newInteractionToken();
  const data = {
    custom_id: click.component.custom_id,
    component_type: click.component.type,
    ...(click.component.id !== undefined ? { id: click.component.id } : {}),
    ...(click.values ? { values: click.values } : {}),
    ...(resolved && Object.keys(resolved).length ? { resolved } : {}),
  };
  const payload = await basePayload({ id: state.id, token, type: InteractionType.MESSAGE_COMPONENT, app, ctx: c.ctx, data, message });
  return deliver(app, state, token, payload);
}

/** A submitted modal → MODAL_SUBMIT interaction (each modal can be submitted once). */
export async function submitModal(input: {
  user: UserRow;
  modalId: string;
  components: unknown;
}): Promise<DeliveryResult> {
  const limited = await rateLimited('interactionCreate', input.user.id);
  if (limited) return limited;
  const store = interactionStore();
  const record = await store.getRecord<ModalRecord>('modal', input.modalId);
  if (!record || !record.modal || !same(record.userId, input.user.id)) return { ok: false, status: 404, error: 'This form has expired', code: 'unknown_modal' };
  const c = await invokerContext(input.user, record.channelId, { requireSend: false });
  if (!c.ok) return c;
  const submitted = Array.isArray(input.components) ? (input.components as ModalSubmitValue[]) : [];
  const built = buildModalSubmit(record.modal, submitted);
  if (!built.ok) return { ok: false, status: 400, error: 'Some fields are not valid', code: `modal_${built.reason}`, field: built.field } as InvokeError;
  const app = await Application.findById(record.applicationId);
  if (!app || !app.botId) return { ok: false, status: 404, error: 'Unknown application', code: 'unknown_application' };
  let resolved: Record<string, unknown> | null = null;
  const { users, roles, channels, mentionables, channelTypes } = built.entityIds;
  if (users.length || roles.length || channels.length || mentionables.length) {
    const r = await buildResolved({ invokerId: input.user.id, channel: c.ctx.channel }, {
      users, roles, channels, mentionables, attachments: [],
    });
    if (!r.ok) return { ok: false, status: 400, error: 'Some fields are not valid', code: 'modal_values' };
    if (!channelTypesAllowed(channelTypes, r.resolved.channels)) return { ok: false, status: 400, error: 'Some fields are not valid', code: 'modal_values' };
    resolved = r.resolved;
  }
  if (!(await store.claimOnce('modal', input.modalId))) return { ok: false, status: 409, error: 'This form was already submitted', code: 'modal_used' };
  let message: unknown;
  if (record.sourceMessageId) {
    if (record.sourceEphemeral) {
      const eph = await store.getRecord<EphemeralRecord>('eph', record.sourceMessageId);
      if (eph) message = await ephemeralToDiscord(eph);
    } else {
      const msg = await loadLiveMessage(record.channelId, record.sourceMessageId);
      if (msg) message = await discordMessageFromRow(msg);
    }
  }
  const state = newState(app, c.ctx, InteractionType.MODAL_SUBMIT, {
    sourceMessageId: message ? record.sourceMessageId : null,
    sourceEphemeral: record.sourceEphemeral,
    commandName: record.commandName,
  });
  const token = newInteractionToken();
  const data = {
    custom_id: record.modal.custom_id,
    components: built.components,
    ...(resolved && Object.keys(resolved).length ? { resolved } : {}),
  };
  const payload = await basePayload({ id: state.id, token, type: InteractionType.MODAL_SUBMIT, app, ctx: c.ctx, data, message });
  await store.deleteRecord('modal', input.modalId);
  return deliver(app, state, token, payload);
}

// ─── Text fallback ("/name args" typed in the composer) ─────

/** Split a command string into tokens, keeping `"quoted values"` together. */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const char of input) {
    if (char === '"') { inQuotes = !inQuotes; continue; }
    if (/\s/.test(char) && !inQuotes) {
      if (current) { tokens.push(current); current = ''; }
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

/** `name:value` named options in any order, plus positional fallback. */
function leafOptionsFromText(declared: CommandOption[], tokens: string[]): Array<{ name: string; type: number; value: unknown }> {
  const leaves = declared.filter((o) => o.type !== OptionType.SUB_COMMAND && o.type !== OptionType.SUB_COMMAND_GROUP);
  const byName = new Map(leaves.map((o) => [o.name.toLowerCase(), o]));
  const named = new Map<string, string>();
  const positional: string[] = [];
  for (const token of tokens) {
    const sep = token.indexOf(':');
    if (sep > 0 && byName.has(token.slice(0, sep).toLowerCase())) {
      named.set(token.slice(0, sep).toLowerCase(), token.slice(sep + 1));
      continue;
    }
    positional.push(token);
  }
  const out: Array<{ name: string; type: number; value: unknown }> = [];
  let pos = 0;
  for (const opt of leaves) {
    const key = opt.name.toLowerCase();
    let raw: string | undefined;
    if (named.has(key)) raw = named.get(key);
    else if (pos < positional.length) {
      // A free-text final option (e.g. a message/reason) greedily takes the rest.
      const greedy = opt === leaves[leaves.length - 1] && opt.type === OptionType.STRING;
      raw = greedy ? positional.slice(pos).join(' ') : positional[pos];
      pos += greedy ? positional.length - pos : 1;
    }
    if (raw === undefined || raw === '') continue;
    let value: unknown = raw;
    if (opt.type === OptionType.INTEGER || opt.type === OptionType.NUMBER) value = Number(raw);
    else if (opt.type === OptionType.BOOLEAN) value = ['true', '1', 'yes'].includes(raw.toLowerCase()) ? true : ['false', '0', 'no'].includes(raw.toLowerCase()) ? false : raw;
    out.push({ name: opt.name, type: opt.type, value });
  }
  return out;
}

function optionsFromText(declared: CommandOption[], tokens: string[]): unknown[] {
  const first = tokens[0]?.toLowerCase();
  const group = declared.find((o) => o.type === OptionType.SUB_COMMAND_GROUP && o.name.toLowerCase() === first);
  if (group) {
    const second = tokens[1]?.toLowerCase();
    const sub = (group.options ?? []).find((o) => o.type === OptionType.SUB_COMMAND && o.name.toLowerCase() === second);
    return [{ name: group.name, type: group.type, options: sub ? [{ name: sub.name, type: sub.type, options: leafOptionsFromText(sub.options ?? [], tokens.slice(2)) }] : [] }];
  }
  const sub = declared.find((o) => o.type === OptionType.SUB_COMMAND && o.name.toLowerCase() === first);
  if (sub) return [{ name: sub.name, type: sub.type, options: leafOptionsFromText(sub.options ?? [], tokens.slice(1)) }];
  return leafOptionsFromText(declared, tokens);
}

interface InternalMessageLike {
  id: string;
  content?: string;
  channelId: string;
  serverId?: string | null;
  author?: { id: string; username?: string; displayName?: string; avatar?: string | null } | null;
}

/**
 * If a user message is a slash-command invocation (`/name ...`) that maps to a
 * registered application command, dispatch it (same checks as the picker).
 * Returns `true` when the content was a recognized application command (the
 * caller then must NOT post it as a plain message). Invalid options get a
 * "failed" notice instead of reaching the bot.
 */
export async function maybeDispatchSlashInteraction(
  message: InternalMessageLike,
  // In a DM, only the bot on the other end should receive the command.
  restrictToBotId?: string | null,
): Promise<boolean> {
  const content = (message.content ?? '').trim();
  if (!content.startsWith('/') || !message.author?.id) return false;
  const tokens = tokenize(content.slice(1));
  const name = tokens.shift()?.toLowerCase();
  if (!name || name.length > 32) return false;

  const guildId = message.serverId ?? null;
  const user = await User.findById(message.author.id);
  if (!user) return false;
  const channel = await Channel.findById(message.channelId);
  if (!channel) return false;
  const membership = guildId ? await ServerMember.findOne({ serverId: guildId, userId: user.id }) : null;
  const usable = (await findUsableCommandsByName({ userId: user.id, channel, membership }, name))
    .filter(({ app }) => !restrictToBotId || same(app.botId, restrictToBotId));
  if (usable.length === 0) return false;
  if (await rateLimited('interactionCreate', user.id)) {
    void notifyInvoker(user.id, { event: 'failed', channelId: message.channelId, reason: 'rate_limited' });
    return true;
  }
  const ctx: InvokeContext = { user, channel, membership };
  await Promise.all(usable.map(async ({ command, app }) => {
    const declared = (Array.isArray(command.options) ? command.options : []) as CommandOption[];
    const result = await dispatchCommand({ ctx, command, app, options: optionsFromText(declared, tokens) });
    if (!result.ok) {
      void notifyInvoker(user.id, { event: 'failed', channelId: channel.id, reason: result.code, command: command.name });
    }
  }));
  return true;
}

/**
 * Dispatch a slash-command invocation that has NOT been persisted as a message
 * (the composer routes app-command sends here so the raw `/command` text is
 * never posted). Returns true when the content was a recognized command.
 */
export async function dispatchSlashCommand(input: {
  content: string;
  channelId: string;
  serverId: string | null;
  author: { id: string; username?: string; displayName?: string } | null;
  // Set for DMs: restrict dispatch to this (recipient) bot only.
  restrictToBotId?: string | null;
}): Promise<boolean> {
  return maybeDispatchSlashInteraction({
    id: randomUUID(),
    content: input.content,
    channelId: input.channelId,
    serverId: input.serverId,
    author: input.author,
  }, input.restrictToBotId);
}
