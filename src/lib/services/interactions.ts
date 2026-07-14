import { Application, Message, User, ServerMember } from '@/lib/models';
import { AppCommand } from '@/lib/models/AppCommand';
import { signInteraction } from '@/lib/services/appIdentity';
import { OPTION_TYPES, type AppCommandOption } from '@/lib/services/appCommands';

// Interaction types (Discord)
const INTERACTION_PING = 1;
const INTERACTION_APPLICATION_COMMAND = 2;

// Interaction callback types (Discord)
const CB_PONG = 1;
const CB_CHANNEL_MESSAGE = 4;
const CB_DEFERRED_CHANNEL_MESSAGE = 5;

// Message flags
const FLAG_EPHEMERAL = 64;

// In-memory store of interaction metadata for followup callbacks.
// Keyed by interaction token. Entry expires after 15 minutes.
interface InteractionMeta {
  botId: string;
  channelId: string;
  serverId: string | null;
  invokerId: string;
  /** Command name + invoker, so the client can show "X used /name". */
  commandName: string;
  invokerName: string;
  expiresAt: number;
}

/** Interaction reference attached to a bot response for the "used /cmd" header. */
interface InteractionRef {
  name: string;
  user: { id: string; username: string };
}
const interactionStore = new Map<string, InteractionMeta>();
const INTERACTION_TTL_MS = 15 * 60 * 1000;

function storeInteraction(token: string, meta: Omit<InteractionMeta, 'expiresAt'>) {
  interactionStore.set(token, { ...meta, expiresAt: Date.now() + INTERACTION_TTL_MS });
}

function getInteraction(token: string): InteractionMeta | null {
  const meta = interactionStore.get(token);
  if (!meta) return null;
  if (Date.now() > meta.expiresAt) {
    interactionStore.delete(token);
    return null;
  }
  return meta;
}

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

/** Coerce a raw string value to the JSON type implied by a Discord option type. */
function coerceOptionValue(type: number, raw: string): string | number | boolean {
  switch (type) {
    case OPTION_TYPES.INTEGER: {
      const n = parseInt(raw, 10);
      return Number.isNaN(n) ? raw : n;
    }
    case OPTION_TYPES.NUMBER: {
      const n = parseFloat(raw);
      return Number.isNaN(n) ? raw : n;
    }
    case OPTION_TYPES.BOOLEAN:
      return raw.toLowerCase() === 'true' || raw === '1' || raw.toLowerCase() === 'yes';
    default:
      return raw;
  }
}

/**
 * Resolve a flat token list against a command's declared leaf options into
 * Discord-style option values. Supports `name:value` named options in any order
 * plus positional fallback for anything not explicitly named.
 */
function resolveLeafOptions(
  declared: AppCommandOption[],
  tokens: string[],
): { name: string; type: number; value: string | number | boolean }[] {
  const leaves = declared.filter(
    (o) => o.type !== OPTION_TYPES.SUB_COMMAND && o.type !== OPTION_TYPES.SUB_COMMAND_GROUP,
  );
  const byName = new Map(leaves.map((o) => [o.name.toLowerCase(), o]));
  const named = new Map<string, string>();
  const positional: string[] = [];

  for (const token of tokens) {
    const sep = token.indexOf(':');
    if (sep > 0) {
      const key = token.slice(0, sep).toLowerCase();
      if (byName.has(key)) {
        named.set(key, token.slice(sep + 1));
        continue;
      }
    }
    positional.push(token);
  }

  const result: { name: string; type: number; value: string | number | boolean }[] = [];
  let posIdx = 0;
  for (const opt of leaves) {
    const key = opt.name.toLowerCase();
    let raw: string | undefined;
    if (named.has(key)) {
      raw = named.get(key);
    } else if (posIdx < positional.length) {
      // A free-text final option (e.g. a message/reason) greedily takes the rest.
      const isLast = opt === leaves[leaves.length - 1];
      raw = isLast && opt.type === OPTION_TYPES.STRING
        ? positional.slice(posIdx).join(' ')
        : positional[posIdx];
      posIdx += isLast && opt.type === OPTION_TYPES.STRING ? positional.length - posIdx : 1;
    }
    if (raw === undefined || raw === '') {
      if (opt.required) result.push({ name: opt.name, type: opt.type, value: '' });
      continue;
    }
    result.push({ name: opt.name, type: opt.type, value: coerceOptionValue(opt.type, raw) });
  }
  return result;
}

/**
 * Build the nested `data.options` for an interaction, walking subcommand and
 * subcommand-group paths declared on the command before resolving leaf options.
 */
function buildInteractionOptions(
  declared: AppCommandOption[],
  tokens: string[],
): any[] {
  const first = tokens[0]?.toLowerCase();

  const group = declared.find(
    (o) => o.type === OPTION_TYPES.SUB_COMMAND_GROUP && o.name.toLowerCase() === first,
  );
  if (group) {
    return [{
      name: group.name,
      type: OPTION_TYPES.SUB_COMMAND_GROUP,
      options: buildInteractionOptions(group.options ?? [], tokens.slice(1)),
    }];
  }

  const sub = declared.find(
    (o) => o.type === OPTION_TYPES.SUB_COMMAND && o.name.toLowerCase() === first,
  );
  if (sub) {
    return [{
      name: sub.name,
      type: OPTION_TYPES.SUB_COMMAND,
      options: resolveLeafOptions(sub.options ?? [], tokens.slice(1)),
    }];
  }

  return resolveLeafOptions(declared, tokens);
}

interface InternalMessageLike {
  id: string;
  content?: string;
  channelId: string;
  serverId?: string | null;
  author?: { id: string; username?: string; displayName?: string; avatar?: string | null } | null;
}

/**
 * POST a signed interaction to an application's interactions endpoint and return
 * the parsed JSON response. Signs `timestamp + body` with the app's Ed25519 key,
 * exactly like Discord, so the bot can verify it with the shared public key.
 */
export async function postSignedInteraction(
  app: { interactionsEndpointUrl?: string | null; privateKeyPem?: string | null },
  payload: unknown,
): Promise<{ ok: boolean; status: number; body: any } | null> {
  if (!app.interactionsEndpointUrl || !app.privateKeyPem) return null;

  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signInteraction(app.privateKeyPem, timestamp + body);

  try {
    const res = await fetch(app.interactionsEndpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'SerikaCord-Interactions/1.0',
        'X-Signature-Ed25519': signature,
        'X-Signature-Timestamp': timestamp,
      },
      body,
      signal: AbortSignal.timeout(3000),
    });
    let json: any = null;
    try { json = await res.json(); } catch { /* empty/no body */ }
    return { ok: res.ok, status: res.status, body: json };
  } catch {
    return null;
  }
}

/**
 * Verify an interactions endpoint URL by sending a PING. Discord requires the
 * endpoint to respond to a signed PING with `{ type: 1 }` before it will accept
 * the URL. Returns true only if the endpoint responds correctly.
 */
export async function verifyInteractionEndpoint(app: {
  interactionsEndpointUrl?: string | null;
  privateKeyPem?: string | null;
  clientId?: string;
}): Promise<boolean> {
  const result = await postSignedInteraction(app, {
    id: crypto.randomUUID(),
    application_id: app.clientId ?? '',
    type: INTERACTION_PING,
    token: 'ping',
    version: 1,
  });
  return !!result && result.ok && result.body?.type === CB_PONG;
}

/**
 * If a user message is a slash-command invocation (`/name ...`) that maps to a
 * registered application command, build and dispatch an APPLICATION_COMMAND
 * interaction, then apply the bot's response.
 *
 * Returns `true` when the content was a *recognized* application command (so the
 * caller should treat it as consumed and NOT post it as a plain message), and
 * `false` when it isn't a command at all.
 */
export async function maybeDispatchSlashInteraction(message: InternalMessageLike): Promise<boolean> {
  const content = (message.content ?? '').trim();
  if (!content.startsWith('/')) return false;

  const tokens = tokenize(content.slice(1));
  const rawName = tokens.shift();
  const name = rawName?.toLowerCase();
  if (!name) return false;

  const guildId = message.serverId ?? null;

  // Find every command registered under this name. Filter by name in-process too,
  // in case the model's find doesn't apply the name filter.
  const allCmds = (await AppCommand.find({ name })) as any[];
  const matching = allCmds.filter((c) => (c.name ?? '').toLowerCase() === name);
  if (matching.length === 0) return false;

  // Collapse to ONE command per application: prefer a guild-scoped command for
  // this guild, otherwise the app's global command. This is what lets two
  // different bots expose the same command name — each is dispatched its own
  // interaction independently.
  const perApp = new Map<string, any>();
  for (const c of matching) {
    const appId = String(c.applicationId);
    const isGuildMatch = !!(c.guildId && guildId && c.guildId === guildId);
    const isGlobal = !c.guildId;
    if (!isGuildMatch && !isGlobal) continue; // guild command for a different guild
    const existing = perApp.get(appId);
    const existingIsGuild = !!(existing && existing.guildId && guildId && existing.guildId === guildId);
    if (!existing || (isGuildMatch && !existingIsGuild)) perApp.set(appId, c);
  }
  if (perApp.size === 0) return false;

  const invokerId = message.author?.id ?? '';
  const member = message.author
    ? { user: { id: message.author.id, username: message.author.username ?? '' }, roles: [] }
    : undefined;

  let dispatchedAny = false;

  await Promise.all(
    [...perApp.values()].map(async (cmd) => {
      const app = await Application.findById(cmd.applicationId);
      if (!app || !app.botId) return;

      // Only dispatch to bots actually present where the command was invoked, so
      // a global command from an unrelated server's bot doesn't fire here.
      if (guildId) {
        const isMember = await ServerMember.findOne({ serverId: guildId, userId: app.botId });
        if (!isMember) return;
      }

      const declared = (cmd.options as AppCommandOption[]) ?? [];
      const optionValues = buildInteractionOptions(declared, tokens);
      // Token is unique per (message, app) so two bots' responses don't collide.
      const interactionToken = `${message.id}.${app.botId}.${Math.random().toString(36).slice(2)}`;

      const interaction = {
        id: crypto.randomUUID(),
        application_id: app.clientId,
        type: INTERACTION_APPLICATION_COMMAND,
        token: interactionToken,
        version: 1,
        channel_id: message.channelId,
        guild_id: guildId ?? undefined,
        member,
        user: message.author ? { id: message.author.id, username: message.author.username ?? '' } : undefined,
        data: { id: cmd.id, name: cmd.name, type: cmd.type ?? 1, options: optionValues },
      };

      const invokerName = message.author?.username ?? '';
      storeInteraction(interactionToken, {
        botId: app.botId,
        channelId: message.channelId,
        serverId: message.serverId ?? null,
        invokerId,
        commandName: cmd.name,
        invokerName,
      });

      dispatchedAny = true;
      const interactionRef: InteractionRef = { name: cmd.name, user: { id: invokerId, username: invokerName } };

      if (app.interactionsEndpointUrl) {
        // HTTP interactions endpoint (Discord-style signed webhook).
        const result = await postSignedInteraction(app, interaction);
        if (result && result.ok && result.body?.type === CB_CHANNEL_MESSAGE && result.body.data) {
          await sendBotResponse(app.botId, message.channelId, message.serverId ?? null, result.body.data, invokerId, interactionRef);
        }
        void CB_DEFERRED_CHANNEL_MESSAGE; // deferred: bot follows up via the callback endpoint
      } else {
        // Gateway-connected bot with no HTTP endpoint: deliver the interaction
        // over the gateway. The bot replies via POST /interactions/:id/:token/callback.
        const { emitInteractionCreate } = await import('@/lib/services/gatewayEvents');
        await emitInteractionCreate({ botId: app.botId, guildId, interaction });
      }
    }),
  );

  return dispatchedAny;
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
}): Promise<boolean> {
  return maybeDispatchSlashInteraction({
    id: crypto.randomUUID(),
    content: input.content,
    channelId: input.channelId,
    serverId: input.serverId,
    author: input.author,
  });
}

/** Create a message authored by the bot in response to an interaction. */
async function sendBotResponse(
  botId: string,
  channelId: string,
  serverId: string | null,
  data: { content?: string; embeds?: unknown[]; flags?: number },
  invokerId?: string,
  interactionRef?: InteractionRef,
) {
  if (!data.content && !(data.embeds && data.embeds.length)) return;

  const isEphemeral = (data.flags ?? 0) & FLAG_EPHEMERAL;

  const botUser = await User.findById(botId);
  const authorObj = botUser ? {
    id: botId,
    username: (botUser as any).username,
    displayName: (botUser as any).displayName || (botUser as any).username,
    avatar: (botUser as any).avatar,
    isBot: true,
  } : null;

  if (isEphemeral && invokerId) {
    // Ephemeral messages are NOT persisted — they exist only in the SSE stream
    // for the invoking user. Use a synthetic ID so the client can track it.
    const ephemeralId = `eph_${crypto.randomUUID()}`;
    const messageResponse = {
      id: ephemeralId,
      content: data.content ?? '',
      authorId: botId,
      author: authorObj,
      channelId,
      serverId: serverId ?? undefined,
      createdAt: new Date().toISOString(),
      attachments: [],
      embeds: data.embeds ?? [],
      type: 'default',
      ephemeral: true,
      interaction: interactionRef,
    };

    try {
      const { publishToChannel } = await import('@/lib/api/channels');
      publishToChannel(channelId, {
        type: 'ephemeral',
        userId: invokerId,
        message: messageResponse,
      });
    } catch {}
    return;
  }

  // Normal (non-ephemeral) response: persist to DB and broadcast.
  const msg = await Message.create({
    channelId,
    serverId: serverId || null,
    authorId: botId,
    content: data.content ?? '',
    embeds: data.embeds ?? [],
    type: 'default',
    interaction: interactionRef ?? null,
  });

  const messageResponse = {
    id: msg.id,
    content: msg.content,
    authorId: botId,
    author: authorObj,
    channelId,
    serverId: serverId ?? undefined,
    createdAt: msg.createdAt,
    attachments: [],
    embeds: data.embeds ?? [],
    type: 'default',
    interaction: interactionRef,
  };

  try {
    const { publishToChannel } = await import('@/lib/api/channels');
    publishToChannel(channelId, { type: 'message', message: messageResponse });
  } catch {}
  try {
    const { emitMessageCreate } = await import('@/lib/services/gatewayEvents');
    await emitMessageCreate(messageResponse as never);
  } catch {}
}

/**
 * Handle a followup callback from the bot's interaction callback endpoint.
 * Looks up stored interaction metadata by token and creates a message.
 * Returns the created message ID, or null if the token is unknown / no content.
 */
export async function handleInteractionCallback(
  interactionToken: string,
  body: { type?: number; data?: { content?: string; embeds?: unknown[]; flags?: number } },
): Promise<{ ok: boolean; messageId?: string }> {
  const meta = getInteraction(interactionToken);
  if (!meta) return { ok: false };

  const data = body.data;
  if (!data || (!data.content && !(data.embeds && data.embeds.length))) {
    return { ok: true };
  }

  const interactionRef: InteractionRef = {
    name: meta.commandName,
    user: { id: meta.invokerId, username: meta.invokerName },
  };
  await sendBotResponse(meta.botId, meta.channelId, meta.serverId, data, meta.invokerId, interactionRef);
  return { ok: true };
}
