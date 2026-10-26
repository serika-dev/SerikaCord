import { Channel, Message, Server, User, type IServerSettings, type IUserSettings } from '@/lib/models';
import { decryptFromStorage } from '@/lib/security';
import { applyAffixes, isOutboundActive, normalizeBridge, resolveLinkOptions } from './bridgeConfig';
import { recordBridgeError, recordBridgeSuccess } from './bridgeHealth';
import { webhookIdFromUrl } from './rest';
import { resolveGuildBridge } from './bridgeStore';

const WEBHOOK_TIMEOUT_MS = 10_000;

/**
 * SerikaCord -> Discord half of the bridge: mirrors a message sent in a linked
 * SerikaCord channel to the Discord channel through that link's webhook,
 * honouring the link's options (direction, pause, edits, deletes,
 * attachments, author identity, prefix/suffix).
 */

const DISCORD_CONTENT_MAX = 2000;
const UUID_SRC = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

/**
 * Convert Serika-formatted content to Discord-friendly text.
 * Serika uses UUID-based mention tokens (<@uuid>, <@&uuid>, <#uuid>) and
 * UUID-based custom emoji tokens (<:name:uuid>). Discord can't resolve these,
 * so we convert them to readable text fallbacks.
 */
export function formatSerikaContentForDiscord(content: string): string {
  if (!content) return '';
  return content
    .replace(new RegExp(`<@!?${UUID_SRC}>`, 'g'), '@user')
    .replace(new RegExp(`<@&${UUID_SRC}>`, 'g'), '@role')
    .replace(new RegExp(`<#${UUID_SRC}>`, 'g'), '#channel')
    .replace(new RegExp(`<a?:([a-zA-Z0-9_]+):${UUID_SRC}>`, 'g'), ':$1:');
}

/** Webhook HTTP failure -> stored health error (404/401 means the webhook is gone). */
function noteWebhookFailure(serverId: string, channelId: string, status: number): void {
  if (status === 404 || status === 401) void recordBridgeError(serverId, channelId, 'webhook_missing', status);
  else if (status === 403) void recordBridgeError(serverId, channelId, 'missing_permissions', status);
  else if (status === 429) void recordBridgeError(serverId, channelId, 'rate_limited', status);
  else if (status >= 400) void recordBridgeError(serverId, channelId, 'discord_error', status);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function replicateToDiscord(action: 'create' | 'edit' | 'delete', channelId: string, message: any): Promise<void> {
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
    // Only the server that holds the guild's bridge (see pickGuildOwner) posts into it.
    const owner = await resolveGuildBridge(bridge.guildId);
    if (!owner || owner.server.id !== server.id) return;
    const options = resolveLinkOptions(bridge.defaults, link.overrides);
    if (!isOutboundActive(options)) return;
    if (action === 'edit' && !options.mirrorEdits) return;
    if (action === 'delete' && !options.mirrorDeletes) return;

    // Avoid feedback loops from Discord-bridged users
    if (message.author?.isDiscord || message.author?.username?.startsWith('discord-')) {
      return;
    }

    // Outbound consent gate: only forward a Serika user's messages to Discord if
    // they have explicitly agreed to their content being processed by Discord.
    // If not agreed, NEVER sync this user. (Deletes are allowed through so a
    // previously-synced message can still be removed from Discord.)
    if (action !== 'delete') {
      const authorId = message.authorId || message.author?.id;
      if (authorId) {
        const author = await User.findById(authorId);
        const consented = Boolean((author?.settings as IUserSettings | undefined)?.dataPrivacy?.discordBridgeOutbound);
        if (!consented) return;
      }
    }

    // Stored encrypted (bridge link routes / discord sync); older servers hold plaintext.
    const { decryptField } = await import('@/lib/security/fieldEncryption');
    const webhookUrl = await decryptField(link.webhook);
    // Only ever fetch a real Discord webhook URL.
    if (typeof webhookUrl !== 'string' || !webhookIdFromUrl(webhookUrl)) return;

    const username = message.author?.displayName || message.author?.username || 'User';
    const avatarUrl = message.author?.avatar || undefined;
    // Bridged messages may never ping @everyone/@here or any role. Allow only
    // direct user mentions to resolve. This is applied to every webhook body.
    const allowedMentions = { parse: ['users'] as string[] };
    const webhookUserPart = options.showIdentity
      ? { username: `${username} (Serika)`.slice(0, 80), avatar_url: avatarUrl, allowed_mentions: allowedMentions }
      : { allowed_mentions: allowedMentions };

    // Build Discord-friendly content from Serika content. Webhooks can't create
    // native replies, so a Serika reply is rendered as a Discord-style quote line
    // referencing the replied-to author + a snippet of their message.
    let replyPrefix = '';
    if (action === 'create' && message.referencedMessageId) {
      try {
        const refMsg = await Message.findById(message.referencedMessageId);
        // Only quote a live message from this same channel.
        if (refMsg && refMsg.channelId === message.channelId && !refMsg.isDeleted) {
          const refAuthor = await User.findById(refMsg.authorId);
          const refName = refAuthor?.displayName || refAuthor?.username || 'someone';
          let refText = '';
          try { refText = refMsg.content ? await decryptFromStorage(refMsg.content) : ''; } catch { /* ignore */ }
          refText = refText.replace(/\n/g, ' ').slice(0, 80);
          replyPrefix = `> **@${refName}**${refText ? `: ${refText}` : ''}\n`;
        }
      } catch { /* best-effort reply quoting */ }
    }
    const body = applyAffixes(formatSerikaContentForDiscord(message.content || ''), options);
    // Without the author's own name on the webhook, name them inline.
    const namedBody = options.showIdentity || !body ? body : `**${username}:** ${body}`;
    const discordContent = `${replyPrefix}${namedBody}`;

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
      const embeds = buildAttachmentEmbeds(message.attachments);
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
      const embeds = buildAttachmentEmbeds(message.attachments);
      const content = discordContent + spoilerSuffix();

      if (discordMsgId) {
        // Edit the existing webhook message via PATCH
        const editUrl = `${webhookUrl}/messages/${discordMsgId}`;
        const res = await fetch(editUrl, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: content.slice(0, DISCORD_CONTENT_MAX), allowed_mentions: allowedMentions, ...(embeds.length > 0 ? { embeds: embeds.slice(0, 10) } : {}) }),
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

    if (action === 'delete') {
      const serikaMsg = message.id ? await Message.findById(message.id) : null;
      const discordMsgId = serikaMsg?.discordMessageId;
      if (!discordMsgId) return;
      const res = await fetch(`${webhookUrl}/messages/${discordMsgId}`, { method: 'DELETE', signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS) }).catch(() => null);
      // 404 Unknown Message just means it is already gone on Discord.
      if (res && !res.ok && res.status !== 404) noteWebhookFailure(server.id, channel.id, res.status);
    }
  } catch (err) {
    console.error('[Discord Bridge] Error in replicateToDiscord:', err);
  }
}
