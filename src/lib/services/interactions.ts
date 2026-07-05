import { Types } from 'mongoose';
import { Application, Message, User } from '@/lib/models';
import { AppCommand } from '@/lib/models/AppCommand';
import { signInteraction } from '@/lib/services/appIdentity';

// Interaction types (Discord)
const INTERACTION_PING = 1;
const INTERACTION_APPLICATION_COMMAND = 2;

// Interaction callback types (Discord)
const CB_PONG = 1;
const CB_CHANNEL_MESSAGE = 4;
const CB_DEFERRED_CHANNEL_MESSAGE = 5;

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
    id: new Types.ObjectId().toString(),
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

  const [rawName, ...rest] = content.slice(1).split(/\s+/);
  const name = rawName?.toLowerCase();
  if (!name) return;

  // Prefer a guild-scoped command, then a global one.
  const query: Record<string, unknown> = { name };
  const cmds = await AppCommand.find(query).lean();
  if (!cmds.length) return;

  const guildId = message.serverId ?? null;
  const cmd =
    cmds.find((c: any) => c.guildId && guildId && c.guildId.toString() === guildId) ??
    cmds.find((c: any) => !c.guildId);
  if (!cmd) return;

  const app = await Application.findById(cmd.applicationId).select('+privateKeyPem');
  if (!app || !app.interactionsEndpointUrl || !app.botId) return;

  // Map trailing words to the declared options positionally (STRING values only,
  // which covers the common slash-command case).
  const options = (cmd.options as any[]) ?? [];
  const optionValues = options.map((opt, i) => ({
    name: opt.name,
    type: opt.type ?? 3,
    value: rest[i] ?? '',
  }));

  const member = message.author
    ? { user: { id: message.author.id, username: message.author.username ?? '' }, roles: [] }
    : undefined;

  const interaction = {
    id: new Types.ObjectId().toString(),
    application_id: app.clientId,
    type: INTERACTION_APPLICATION_COMMAND,
    token: `${message.id}.${Math.random().toString(36).slice(2)}`,
    version: 1,
    channel_id: message.channelId,
    guild_id: guildId ?? undefined,
    member,
    user: message.author ? { id: message.author.id, username: message.author.username ?? '' } : undefined,
    data: {
      id: cmd._id.toString(),
      name: cmd.name,
      type: cmd.type ?? 1,
      options: optionValues,
    },
  };

  const result = await postSignedInteraction(app, interaction);
  if (!result || !result.ok || !result.body) return;

  const cb = result.body;
  if (cb.type === CB_CHANNEL_MESSAGE && cb.data) {
    await sendBotResponse(app.botId.toString(), message.channelId, message.serverId ?? null, cb.data);
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
    channelId: new Types.ObjectId(channelId),
    serverId: serverId ? new Types.ObjectId(serverId) : null,
    authorId: new Types.ObjectId(botId),
    content: data.content ?? '',
    embeds: data.embeds ?? [],
    type: 'default',
  });

  const botUser = await User.findById(botId).lean();
  const messageResponse = {
    id: msg._id.toString(),
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
    createdAt: (msg as any).createdAt,
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
