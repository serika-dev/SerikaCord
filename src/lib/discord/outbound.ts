import { Channel, Message, Server, User, type IServerSettings, type IUserSettings } from '@/lib/models';
import { decryptFromStorage } from '@/lib/security';
import { processShared } from '@/lib/realtime/processShared';
import { applyAffixes, isOutboundActive, normalizeBridge, resolveLinkOptions } from './bridgeConfig';
import { recordBridgeError, recordBridgeSuccess } from './bridgeHealth';
import { BRIDGE_BOT_ID, webhookIdFromUrl } from './rest';
import { resolveGuildBridge } from './bridgeStore';
import {
  bridgeAllowedMentions, bridgeAvatarUrl, bridgeWebhookUsername, cameFromDiscord, decideOutboundRelay,
  discordSafeName, formatSerikaContentForDiscord, interactionLine, toDiscordEmbeds,
} from './outboundFormat';

export { formatSerikaContentForDiscord } from './outboundFormat';

const WEBHOOK_TIMEOUT_MS = 10_000;
const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://serika.chat').replace(/\/$/, '');

/**
 * SerikaCord -> Discord half of the bridge: mirrors a message sent in a linked
 * SerikaCord channel to the Discord channel through that link's webhook,
 * honouring the link's options (direction, pause, edits, deletes,
 * attachments, bot messages, author identity, prefix/suffix).
 *
 * Callers: the user send / edit / delete routes (channels.ts), the bot API
 * message routes (botApi.ts) and app messages (interaction responses and
 * channel webhooks, services/appMessages.ts). Messages the bridge relayed in
 * from Discord are never sent back (bridgeOrigin).
 */

const DISCORD_CONTENT_MAX = 2000;

/** Webhook HTTP failure -> stored health error (404/401 means the webhook is gone). */
function noteWebhookFailure(serverId: string, channelId: string, status: number): void {
  if (status === 404 || status === 401) void recordBridgeError(serverId, channelId, 'webhook_missing', status);
  else if (status === 403) void recordBridgeError(serverId, channelId, 'missing_permissions', status);
  else if (status === 429) void recordBridgeError(serverId, channelId, 'rate_limited', status);
  else if (status >= 400) void recordBridgeError(serverId, channelId, 'discord_error', status);
}

// One relay at a time per message, so an edit (or delete) waits for the
// create that stores the Discord message id instead of posting a second copy
// (bots often edit right after sending). Entries drop out when they settle.
const relayChains = processShared('discordOutboundChains', () => new Map<string, Promise<void>>());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function replicateToDiscord(action: 'create' | 'edit' | 'delete', channelId: string, message: any): Promise<void> {
  const key = message?.id ? String(message.id).toLowerCase() : null;
  if (!key) return replicate(action, channelId, message);
  const previous = relayChains.get(key) ?? Promise.resolve();
  const next = previous.then(() => replicate(action, channelId, message), () => replicate(action, channelId, message));
  relayChains.set(key, next);
  void next.finally(() => {
    if (relayChains.get(key) === next) relayChains.delete(key);
  });
  return next;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function replicate(action: 'create' | 'edit' | 'delete', channelId: string, message: any): Promise<void> {
  try {
    const channel = await Channel.findById(channelId);
    if (!channel || !channel.serverId) return;
    const server = await Server.findById(channel.serverId);
    if (!server) return;
    const integrations = (server.settings as IServerSettings | undefined)?.integrations || {};
    if (!integrations.discord) return;

    const bridge = normalizeBridge(integrations);
    const link = bridge.links.find((l) => l.serikaChannelId === channel.id.toLowerCase());
    if (!link?.webhook || !bridge.guildId) return;
    const guildId = bridge.guildId;
    // Only the server that holds the guild's bridge (see pickGuildOwner) posts into it.
    const owner = await resolveGuildBridge(guildId);
    if (!owner || owner.server.id !== server.id) return;
    const options = resolveLinkOptions(bridge.defaults, link.overrides);
    if (!isOutboundActive(options)) return;
    if (action === 'edit' && !options.mirrorEdits) return;
    if (action === 'delete' && !options.mirrorDeletes) return;

    // The stored row is the source of truth for where the message came from
    // and its flags (the live payloads differ per send path).
    const stored = action !== 'delete' && message.id ? await Message.findById(message.id).catch(() => null) : null;
    if (action !== 'delete' && message.id && !stored) return;

    const authorId: string | undefined = message.authorId || message.author?.id || stored?.authorId;
    // Channel webhook posts: their author id is the webhook, not a user.
    const isWebhook = Boolean(message.author?.isWebhook || message.webhookId);
    const authorUser = action !== 'delete' && authorId && !isWebhook ? await User.findById(authorId).catch(() => null) : null;
    const isBot = Boolean(authorUser?.isBot);
    const isApp = isBot || isWebhook;

    const referencedMessageId: string | null = stored?.referencedMessageId ?? message.referencedMessageId ?? null;
    const refMsg = action !== 'delete' && referencedMessageId ? await Message.findById(referencedMessageId).catch(() => null) : null;

    // A SerikaCord bot linked to a Discord bot that is itself in this Discord
    // server answers Discord messages on Discord on its own.
    let linkedDiscordBotInGuild = false;
    if (isBot && authorId && refMsg && cameFromDiscord(refMsg.bridgeOrigin)) {
      const { linkedDiscordBotIds } = await import('@/lib/services/applicationDiscordLink');
      const discordBotId = (await linkedDiscordBotIds([authorId])).get(authorId.toLowerCase());
      // Linked to the bridge bot itself: its Discord side is the bridge, which
      // never answers on its own, so Discord only sees the reply through here.
      if (discordBotId && discordBotId !== BRIDGE_BOT_ID) {
        const { isGuildMember } = await import('./rest');
        linkedDiscordBotInGuild = (await isGuildMember(guildId, discordBotId)) !== false;
      }
    }

    const decision = decideOutboundRelay({
      action,
      bridgeOrigin: stored?.bridgeOrigin ?? message.bridgeOrigin,
      author: {
        isDiscordCopy: Boolean(message.author?.isDiscord || message.author?.username?.startsWith?.('discord-') || authorUser?.username?.startsWith('discord-')),
        isBot,
        isWebhook,
      },
      includeBots: options.includeBots,
      // Outbound consent gate: a person's messages go to Discord only once they
      // agreed to their content being processed by Discord.
      authorConsented: Boolean((authorUser?.settings as IUserSettings | undefined)?.dataPrivacy?.discordBridgeOutbound),
      flags: stored?.flags ?? message.flags,
      linkedDiscordBotInGuild,
      replyToBridgeOrigin: refMsg?.bridgeOrigin,
    });
    if (!decision.relay) return;

    // Stored encrypted (bridge link routes / discord sync); older servers hold plaintext.
    const { decryptField } = await import('@/lib/security/fieldEncryption');
    const webhookUrl = await decryptField(link.webhook);
    // Only ever fetch a real Discord webhook URL.
    if (typeof webhookUrl !== 'string' || !webhookIdFromUrl(webhookUrl)) return;

    // Delete needs no content: look up the Discord copy and remove it.
    if (action === 'delete') {
      const serikaMsg = message.id ? await Message.findById(message.id) : null;
      const discordMsgId = serikaMsg?.discordMessageId;
      if (!discordMsgId) return;
      // A message relayed in from Discord points at the Discord original,
      // which the webhook did not post and cannot delete (e.g. a linked bot
      // deleting its relayed copy through the bot API).
      if (cameFromDiscord(serikaMsg?.bridgeOrigin)) return;
      const res = await fetch(`${webhookUrl}/messages/${discordMsgId}`, { method: 'DELETE', signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS) }).catch(() => null);
      // 404 Unknown Message just means it is already gone on Discord.
      if (res && !res.ok && res.status !== 404) noteWebhookFailure(server.id, channel.id, res.status);
      return;
    }

    const username = message.author?.displayName || message.author?.username || authorUser?.displayName || authorUser?.username || 'User';
    const avatarUrl = bridgeAvatarUrl(message.author?.avatar ?? authorUser?.avatar, SITE_URL);

    // Text: the message content, plus what components carry (a components-v2
    // message has no content of its own; link buttons become "label: url").
    // Interactive components can't work across, so they are dropped.
    const { componentsToText, isComponentsV2 } = await import('@/lib/botapi/components');
    const components = (stored?.components ?? message.components ?? null) as Parameters<typeof componentsToText>[0];
    const componentText = isApp ? componentsToText(components, DISCORD_CONTENT_MAX) : '';
    const rawContent: string = typeof message.content === 'string' ? message.content : '';
    const rawText = isComponentsV2(stored?.flags ?? message.flags ?? 0)
      ? componentText
      : [rawContent, componentText].filter(Boolean).join('\n');
    const rawEmbeds = isApp ? (stored?.embeds ?? message.embeds ?? []) : [];

    // Webhooks can't create native replies, so a reply is rendered as a
    // Discord-style quote line naming the replied-to author + a snippet.
    let refName = '';
    let refText = '';
    if (refMsg && refMsg.channelId === (stored?.channelId ?? message.channelId) && !refMsg.isDeleted) {
      const refAuthor = await User.findById(refMsg.authorId).catch(() => null);
      refName = refAuthor?.displayName || refAuthor?.username || 'someone';
      try { refText = refMsg.content ? await decryptFromStorage(refMsg.content) : ''; } catch { /* ignore */ }
      refText = refText.replace(/\n/g, ' ').slice(0, 80);
    }

    // Mentions read as real names; people and bots in the Discord server
    // become real Discord mentions, bridged channels real channel mentions.
    const { resolveOutboundMentions } = await import('./outboundMentions');
    const mentionLookup = await resolveOutboundMentions({
      texts: [rawText, refText, rawEmbeds.length ? JSON.stringify(rawEmbeds) : null],
      serverId: server.id,
      guildId,
      links: bridge.links,
    });
    const format = (text: string) => formatSerikaContentForDiscord(text, mentionLookup);
    // Bridged messages never ping @everyone/@here or a role; only users the
    // message pinged on SerikaCord too. Applied to every webhook body.
    const allowedMentions = bridgeAllowedMentions({
      content: rawText,
      lookup: mentionLookup,
      mentionedUserIds: (stored?.mentionedUserIds ?? message.mentionedUserIds ?? null) as string[] | null,
      authorIsBot: isApp,
    });
    const webhookUserPart = options.showIdentity
      ? { username: bridgeWebhookUsername(username), avatar_url: avatarUrl, allowed_mentions: allowedMentions }
      : { allowed_mentions: allowedMentions };

    // The quoted snippet is shown by name only: its mentions are not in allowedMentions.
    const replyPrefix = refName ? `> **@${discordSafeName(refName, 'someone')}**${refText ? `: ${format(refText)}` : ''}\n` : '';
    const body = applyAffixes(format(rawText), options);
    // Without the author's own name on the webhook, name them inline.
    const namedBody = options.showIdentity || !body ? body : `**${discordSafeName(username, 'User')}:** ${body}`;
    const discordContent = `${interactionLine(stored?.interaction ?? message.interaction)}${replyPrefix}${namedBody}`;
    const appEmbeds = toDiscordEmbeds(rawEmbeds, format);

    // Build embeds from attachments — handle images, videos, and other files.
    // Spoilered images are returned as URLs to be appended to the content as
    // ||url|| (Discord renders this as a spoilered image), since embeds don't
    // support spoiler tags.
    const spoileredImageUrls: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buildAttachmentEmbeds = (attachments: any[]): any[] => {
      if (!options.attachments || !attachments || !Array.isArray(attachments)) return [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const embeds: any[] = [];
      for (const att of attachments) {
        const url = att.url || att;
        const contentType = att.contentType || '';
        const filename = att.filename || '';
        // Media flagged by the explicit content filter goes out spoilered too.
        const isSpoiler = att.spoiler === true || att.sensitive === true;
        if (contentType.startsWith('image/')) {
          if (isSpoiler) spoileredImageUrls.push(url);
          else embeds.push({ image: { url } });
        } else if (contentType.startsWith('video/')) {
          embeds.push({ video: { url } });
        } else if (contentType.startsWith('audio/')) {
          embeds.push({ title: filename || 'Audio file', description: `[${filename || 'Audio file'}](${url})`, color: 0x8B5CF6 });
        } else {
          // Other files (PDF, text, etc.) — link in description
          embeds.push({ title: filename || 'File', description: `[${filename || 'Download file'}](${url})`, color: 0x5865F2 });
        }
      }
      return embeds;
    };
    const spoilerSuffix = () => (spoileredImageUrls.length > 0 ? '\n' + spoileredImageUrls.map((u) => `||${u}||`).join('\n') : '');

    const post = async (content: string, embeds: unknown[]) => {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content.slice(0, DISCORD_CONTENT_MAX), ...webhookUserPart, ...(embeds.length > 0 ? { embeds: embeds.slice(0, 10) } : {}) }),
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      }).catch(() => null);
      if (!res) return null;
      if (!res.ok) {
        noteWebhookFailure(server.id, channel.id, res.status);
        return null;
      }
      recordBridgeSuccess(server.id, channel.id, 'outbound');
      return res;
    };

    if (action === 'create') {
      const embeds = [...appEmbeds, ...buildAttachmentEmbeds(message.attachments)];
      // Add sticker as embed if present
      if (options.attachments && message.sticker?.imageUrl) embeds.push({ image: { url: message.sticker.imageUrl } });
      const content = discordContent + spoilerSuffix();
      if (!content.trim() && embeds.length === 0) return;
      // ?wait=true makes Discord return the created message (else 204), so
      // its id can be stored for later edits and deletes.
      const res = await fetch(`${webhookUrl}?wait=true`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content.slice(0, DISCORD_CONTENT_MAX), ...webhookUserPart, ...(embeds.length > 0 ? { embeds: embeds.slice(0, 10) } : {}) }),
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      }).catch(() => null);
      if (!res) return;
      if (!res.ok) {
        noteWebhookFailure(server.id, channel.id, res.status);
        return;
      }
      recordBridgeSuccess(server.id, channel.id, 'outbound');
      // Store the Discord message ID for future edit/delete
      const discordMsg = await res.json().catch(() => null);
      if (discordMsg?.id && message.id) {
        await Message.updateById(message.id, { discordMessageId: discordMsg.id }).catch(() => {});
      }
      return;
    }

    if (action === 'edit') {
      // Look up the Discord message ID from the Serika message
      const serikaMsg = message.id ? await Message.findById(message.id) : null;
      const discordMsgId = serikaMsg?.discordMessageId;
      const embeds = [...appEmbeds, ...buildAttachmentEmbeds(message.attachments)];
      const content = discordContent + spoilerSuffix();
      // App messages are edited as a whole (removed embeds go away on Discord
      // too); a person's edit payload may not carry attachments, so theirs only
      // replaces embeds when there are any.
      const embedPart = isApp || embeds.length > 0 ? { embeds: embeds.slice(0, 10) } : {};

      if (discordMsgId) {
        // Edit the existing webhook message via PATCH
        const editUrl = `${webhookUrl}/messages/${discordMsgId}`;
        const res = await fetch(editUrl, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: content.slice(0, DISCORD_CONTENT_MAX), allowed_mentions: allowedMentions, ...embedPart }),
          signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
        }).catch(() => null);

        if (res && res.ok) {
          recordBridgeSuccess(server.id, channel.id, 'outbound');
        } else if (res && res.status === 404 && (await res.clone().json().catch(() => null))?.code === 10008) {
          // The Discord copy is gone (Unknown Message): repost it.
          const repost = await fetch(`${webhookUrl}?wait=true`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: content.slice(0, DISCORD_CONTENT_MAX), ...webhookUserPart, ...(embeds.length > 0 ? { embeds: embeds.slice(0, 10) } : {}) }),
            signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
          }).catch(() => null);
          if (repost && repost.ok) {
            recordBridgeSuccess(server.id, channel.id, 'outbound');
            const newDiscordMsg = await repost.json().catch(() => null);
            if (newDiscordMsg?.id && message.id) {
              await Message.updateById(message.id, { discordMessageId: newDiscordMsg.id }).catch(() => {});
            }
          } else if (repost) {
            noteWebhookFailure(server.id, channel.id, repost.status);
          }
        } else if (res) {
          noteWebhookFailure(server.id, channel.id, res.status);
        }
      } else {
        // No Discord message ID stored — post as new message with edit indicator
        await post(`*(edited)* ${content}`, embeds);
      }
      return;
    }
  } catch (err) {
    console.error('[Discord Bridge] Error in replicateToDiscord:', err);
  }
}
