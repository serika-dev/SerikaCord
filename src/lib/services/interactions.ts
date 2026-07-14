import { Application, Message, User } from '@/lib/models';
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
 * registered application command with an HTTP interactions endpoint, build and
 * dispatch an APPLICATION_COMMAND interaction, then apply the bot's response.
 */
export async function maybeDispatchSlashInteraction(message: InternalMessageLike) {
  const content = (message.content ?? '').trim();
  if (!content.startsWith('/')) return;

  const tokens = tokenize(content.slice(1));
  const rawName = tokens.shift();
  const name = rawName?.toLowerCase();
  if (!name) return;

  // Prefer a guild-scoped command, then a global one.
  const query: Record<string, unknown> = { name };
  const cmds = await AppCommand.find(query);
  if (!cmds.length) return;

  const guildId = message.serverId ?? null;
  const cmd =
    cmds.find((c: any) => c.guildId && guildId && c.guildId === guildId) ??
    cmds.find((c: any) => !c.guildId);
  if (!cmd) return;

  const app = await Application.findById(cmd.applicationId);
  if (!app || !app.interactionsEndpointUrl || !app.botId) return;

  // Resolve trailing tokens against the declared option tree: subcommands,
  // subcommand groups, and named/positional typed leaf options.
  const declared = (cmd.options as AppCommandOption[]) ?? [];
  const optionValues = buildInteractionOptions(declared, tokens);

  const member = message.author
    ? { user: { id: message.author.id, username: message.author.username ?? '' }, roles: [] }
    : undefined;

  const interaction = {
    id: crypto.randomUUID(),
    application_id: app.clientId,
    type: INTERACTION_APPLICATION_COMMAND,
    token: `${message.id}.${Math.random().toString(36).slice(2)}`,
    version: 1,
    channel_id: message.channelId,
    guild_id: guildId ?? undefined,
    member,
    user: message.author ? { id: message.author.id, username: message.author.username ?? '' } : undefined,
    data: {
      id: cmd.id,
      name: cmd.name,
      type: cmd.type ?? 1,
      options: optionValues,
    },
  };

  const result = await postSignedInteraction(app, interaction);
  if (!result || !result.ok || !result.body) return;

  const cb = result.body;
  if (cb.type === CB_CHANNEL_MESSAGE && cb.data) {
    await sendBotResponse(app.botId, message.channelId, message.serverId ?? null, cb.data);
  }
  // CB_DEFERRED_CHANNEL_MESSAGE: bot will follow up via REST; nothing to do here.
  void CB_DEFERRED_CHANNEL_MESSAGE;
}

/** Create a message authored by the bot in response to an interaction. */
async function sendBotResponse(
  botId: string,
  channelId: string,
  serverId: string | null,
  data: { content?: string; embeds?: unknown[]; flags?: number },
) {
  if (!data.content && !(data.embeds && data.embeds.length)) return;

  const msg = await Message.create({
    channelId,
    serverId: serverId || null,
    authorId: botId,
    content: data.content ?? '',
    embeds: data.embeds ?? [],
    type: 'default',
  });

  const botUser = await User.findById(botId);
  const messageResponse = {
    id: msg.id,
    content: msg.content,
    authorId: botId,
    author: botUser ? {
      id: botId,
      username: (botUser as any).username,
      displayName: (botUser as any).displayName || (botUser as any).username,
      avatar: (botUser as any).avatar,
      isBot: true,
    } : null,
    channelId,
    serverId: serverId ?? undefined,
    createdAt: msg.createdAt,
    attachments: [],
    embeds: data.embeds ?? [],
    type: 0,
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
