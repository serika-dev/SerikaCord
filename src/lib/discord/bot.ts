import WebSocket from 'ws';

const BOT_ID = process.env.SERIKA_DISCORD_ID || '1524469730256355421';

// Gateway intents: Guilds (1) + Guild Messages (512) + Message Content (32768)
const GATEWAY_INTENTS = 1 | 512 | 32768;

function buildDisplayName(discordAuthor: any): string {
  const globalName = discordAuthor.global_name || discordAuthor.username;
  const discriminator = discordAuthor.discriminator;
  if (discriminator && discriminator !== '0') {
    return `${globalName} (#${discriminator})`;
  }
  return `${globalName} (Discord)`;
}

function getAvatarUrl(author: any): string {
  if (author.avatar) {
    const ext = author.avatar.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${author.id}/${author.avatar}.${ext}`;
  }
  return `https://cdn.discordapp.com/embed/avatars/${parseInt(author.discriminator || '0') % 5}.png`;
}

function mapAttachments(d: any): any[] {
  if (!d.attachments || !Array.isArray(d.attachments)) return [];
  return d.attachments.map((att: any) => ({
    id: att.id,
    url: att.url,
    proxyUrl: att.proxy_url,
    filename: att.filename,
    contentType: att.content_type || att.filename?.split('.').pop() || 'application/octet-stream',
    size: att.size,
    width: att.width || null,
    height: att.height || null,
  }));
}

/**
 * Convert Discord-formatted content to Serika-friendly text.
 * Discord uses snowflake-based mention tokens (<@snowflake>, <@&snowflake>, <#snowflake>)
 * and snowflake-based custom emoji tokens (<:name:snowflake>). Serika can't resolve
 * Discord snowflakes, so we convert them to readable text fallbacks.
 *
 * Also converts Discord markdown where needed and strips Discord-specific formatting.
 */
function formatDiscordContentForSerika(content: string): string {
  if (!content) return '';
  let result = content;
  // User mentions: <@123> or <@!123> → @username (we don't have the lookup, so just @user)
  result = result.replace(/<@!?\d+>/g, (match) => {
    // We could look up the user, but for now use a readable fallback
    return '@user';
  });
  // Role mentions: <@&123> → @rolename
  result = result.replace(/<@&\d+>/g, '@role');
  // Channel mentions: <#123> → #channel
  result = result.replace(/<#\d+>/g, '#channel');
  // Custom emoji: <:name:123> or <a:name:123> → :name: (Serika can't resolve Discord emoji IDs)
  result = result.replace(/<a?:([a-zA-Z0-9_]+):\d+>/g, ':$1:');
  // @everyone / @here pass through as-is
  return result;
}

async function findBridgedChannel(guildId: string, discordChannelId: string): Promise<{ server: any; serikaChannelId: string } | null> {
  const { Server } = await import('@/lib/models');
  const servers = await Server.find({});
  for (const server of servers) {
    const integrations = (server.settings as any)?.integrations || {};
    if (!integrations.discord || integrations.discordGuildId !== guildId) continue;
    const channelsMap = integrations.discordChannelsMap || {};
    const serikaChannelId = channelsMap[discordChannelId];
    if (serikaChannelId) return { server, serikaChannelId };
  }
  return null;
}

async function getOrCreateDiscordUser(discordAuthor: any): Promise<any> {
  const { User } = await import('@/lib/models');
  const { UserConnection } = await import('@/lib/models/UserConnection');

  // 1. Check if there's a Serika user with discordId matching this Discord user
  if (discordAuthor.id) {
    const linkedUser = await User.findOne({ discordId: discordAuthor.id });
    if (linkedUser) {
      // Only update discordUsername — NEVER overwrite the user's displayName or avatar
      if (linkedUser.discordUsername !== discordAuthor.username) {
        const updated = await User.updateById(linkedUser.id, {
          discordUsername: discordAuthor.username,
        });
        return updated || linkedUser;
      }
      return linkedUser;
    }
  }

  // 2. Check UserConnection table for a linked Discord account
  if (discordAuthor.id) {
    const connection = await UserConnection.findOne({ provider: 'discord', accountId: discordAuthor.id });
    if (connection) {
      const linkedUser = await User.findById(connection.userId);
      if (linkedUser) {
        // Update discordId on the user if not set
        if (!linkedUser.discordId) {
          await User.updateById(linkedUser.id, { discordId: discordAuthor.id, discordUsername: discordAuthor.username });
        }
        return linkedUser;
      }
    }
  }

  // 3. Fall back to creating a discord- prefixed bot user
  const username = `discord-${discordAuthor.id}`;
  let serikaUser = await User.findOne({ username });
  if (!serikaUser) {
    serikaUser = await User.create({
      username,
      displayName: buildDisplayName(discordAuthor),
      avatar: getAvatarUrl(discordAuthor),
      isBot: discordAuthor.bot || false,
      isSystem: false,
    });
  } else {
    const newDisplayName = buildDisplayName(discordAuthor);
    const newAvatar = getAvatarUrl(discordAuthor);
    if (serikaUser.displayName !== newDisplayName || serikaUser.avatar !== newAvatar) {
      serikaUser = await User.updateById(serikaUser.id, {
        displayName: newDisplayName,
        avatar: newAvatar,
      }) || serikaUser;
    }
  }
  return serikaUser;
}

export async function startDiscordBot() {
  const botToken = process.env.SERIKA_DISCORD_TOKEN;
  if (!botToken) {
    console.log('[Discord Bot] No SERIKA_DISCORD_TOKEN found in environment. Bot listener disabled.');
    return;
  }

  console.log('[Discord Bot] Initializing Discord Gateway listener...');

  let ws: WebSocket | null = null;
  let heartbeatInterval: any = null;
  let lastSequence: number | null = null;
  let sessionID: string | null = null;
  let resumeURL: string | null = null;

  function connect(url?: string) {
    const gatewayUrl = url || resumeURL || 'wss://gateway.discord.gg/?v=10&encoding=json';
    console.log(`[Discord Bot] Connecting to Discord Gateway: ${gatewayUrl}`);
    ws = new WebSocket(gatewayUrl);

    ws.on('open', () => {
      console.log('[Discord Bot] WebSocket connection opened.');
    });

    ws.on('message', async (data: any) => {
      try {
        const payload = JSON.parse(data.toString());
        const { op, d, t, s } = payload;

        if (s !== undefined) lastSequence = s;

        // Hello Opcode
        if (op === 10) {
          const interval = d.heartbeat_interval;
          console.log(`[Discord Bot] Hello received. Heartbeat interval: ${interval}ms`);

          if (heartbeatInterval) clearInterval(heartbeatInterval);
          heartbeatInterval = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ op: 1, d: lastSequence }));
            }
          }, interval);

          // Resume if we have a session, otherwise Identify
          if (sessionID && lastSequence !== null) {
            console.log('[Discord Bot] Resuming session...');
            ws?.send(JSON.stringify({
              op: 6,
              d: { token: botToken, session_id: sessionID, seq: lastSequence },
            }));
          } else {
            const identifyPayload = {
              op: 2,
              d: {
                token: botToken,
                intents: GATEWAY_INTENTS,
                properties: {
                  os: 'linux',
                  browser: 'serikacord',
                  device: 'serikacord',
                },
              },
            };
            ws?.send(JSON.stringify(identifyPayload));
          }
        }

        // Resumed
        if (op === 7) {
          console.log('[Discord Bot] Session resumed successfully.');
        }

        // Invalid Session
        if (op === 9) {
          console.log(`[Discord Bot] Invalid session. Resumable: ${d}. Reconnecting...`);
          if (!d) {
            sessionID = null;
            lastSequence = null;
          }
          if (heartbeatInterval) clearInterval(heartbeatInterval);
          setTimeout(() => connect(), 2000);
          return;
        }

        // Dispatch Event
        if (op === 0) {
          if (t === 'READY') {
            sessionID = d.session_id;
            resumeURL = d.resume_gateway_url || null;
            console.log(`[Discord Bot] Bot ready! Logged in as ${d.user.username}#${d.user.discriminator}`);
          }

          if (t === 'RESUMED') {
            console.log('[Discord Bot] Session resumed — replaying missed events.');
          }

          if (t === 'MESSAGE_CREATE') {
            // Ignore messages from our own bot or webhooks (feedback loop prevention)
            if (d.author.id === BOT_ID || d.webhook_id) return;
            // Also skip messages that look like they came from our bridge (username ends with (Serika))
            if (d.author.username && d.author.username.endsWith(' (Serika)')) return;

            const { Channel, Message } = await import('@/lib/models');
            const { encryptForStorage } = await import('@/lib/security');
            const { publishToChannel } = await import('@/lib/api/channels');

            const bridge = await findBridgedChannel(d.guild_id, d.channel_id);
            if (!bridge) return;
            const { server, serikaChannelId } = bridge;

            const chan = await Channel.findById(serikaChannelId);
            if (!chan) return;

            const serikaUser = await getOrCreateDiscordUser(d.author);
            const isLinkedAccount = !serikaUser.username.startsWith('discord-');

            // Convert Discord content to Serika-friendly format
            const rawContent = d.content || '';
            const content = formatDiscordContentForSerika(rawContent);
            const attachments = mapAttachments(d);

            // Also include embeds from Discord (e.g., link previews) as attachments-like objects
            const embeds = (d.embeds && Array.isArray(d.embeds)) ? d.embeds : [];

            if (!content && attachments.length === 0 && embeds.length === 0) {
              console.warn('[Discord Bot] ⚠️ MESSAGE_CREATE has empty content and no attachments — skipping.');
              console.warn('[Discord Bot] ⚠️ This usually means the MESSAGE CONTENT INTENT is not enabled.');
              console.warn('[Discord Bot] ⚠️ Enable it at: Discord Developer Portal → Your App → Bot → Privileged Gateway Intents → MESSAGE CONTENT INTENT');
              return;
            }

            const encryptedContent = await encryptForStorage(content);

            const msg = await Message.create({
              channelId: serikaChannelId,
              serverId: server.id,
              authorId: serikaUser.id,
              content: encryptedContent,
              type: 'default',
              attachments,
              discordMessageId: d.id,
            });

            await Channel.updateById(serikaChannelId, { lastMessageId: msg.id, updatedAt: new Date() });

            const messageResponse = {
              id: msg.id,
              content,
              authorId: serikaUser.id,
              author: {
                id: serikaUser.id,
                username: serikaUser.username,
                displayName: serikaUser.displayName,
                avatar: serikaUser.avatar,
                status: 'online',
                isBot: serikaUser.isBot,
                isSystem: false,
                isDiscord: !isLinkedAccount,
              },
              channelId: serikaChannelId,
              serverId: server.id,
              createdAt: msg.createdAt ? new Date(msg.createdAt).toISOString() : new Date().toISOString(),
              updatedAt: msg.updatedAt ? new Date(msg.updatedAt).toISOString() : new Date().toISOString(),
              attachments,
              edited: false,
              type: 'default',
              pinned: false,
              reactions: [],
            };

            publishToChannel(serikaChannelId, { type: 'message', message: messageResponse });
            console.log(`[Discord Bot] Forwarded message from ${d.author.username} (content: "${content.slice(0, 50)}") to Serika channel #${chan.name}`);
          }

          if (t === 'MESSAGE_UPDATE') {
            // Ignore bot/webhook edits
            if (d.author?.id === BOT_ID || d.webhook_id) return;

            const { Message } = await import('@/lib/models');
            const { encryptForStorage } = await import('@/lib/security');
            const { publishToChannel } = await import('@/lib/api/channels');

            const bridge = await findBridgedChannel(d.guild_id, d.channel_id);
            if (!bridge) return;
            const { serikaChannelId } = bridge;

            // Use the Discord message ID to find the corresponding Serika message
            const serikaMsg = await Message.findByDiscordMessageId(d.id);
            if (!serikaMsg) {
              console.log(`[Discord Bot] Message update for Discord msg ${d.id} — no matching Serika message found, skipping.`);
              return;
            }

            // The edit payload may only contain partial content
            if (!d.content) return;

            const newContent = formatDiscordContentForSerika(d.content);
            const encryptedNew = await encryptForStorage(newContent);

            await Message.updateById(serikaMsg.id, {
              content: encryptedNew,
              edited: true,
              editedTimestamp: new Date(),
            });

            // Update attachments if provided
            if (d.attachments) {
              const newAttachments = mapAttachments(d);
              await Message.updateById(serikaMsg.id, { attachments: newAttachments });
            }

            publishToChannel(serikaChannelId, {
              type: 'edit',
              messageId: serikaMsg.id,
              content: newContent,
              channelId: serikaChannelId,
              edited: true,
              updatedAt: new Date().toISOString(),
            });
            console.log(`[Discord Bot] Forwarded message edit for Discord msg ${d.id} → Serika msg ${serikaMsg.id}`);
          }

          if (t === 'MESSAGE_DELETE') {
            const { Message } = await import('@/lib/models');
            const { publishToChannel } = await import('@/lib/api/channels');

            const bridge = await findBridgedChannel(d.guild_id, d.channel_id);
            if (!bridge) return;
            const { serikaChannelId } = bridge;

            // Use the Discord message ID to find the corresponding Serika message
            const serikaMsg = await Message.findByDiscordMessageId(d.id);
            if (!serikaMsg) {
              console.log(`[Discord Bot] Message delete for Discord msg ${d.id} — no matching Serika message found.`);
              return;
            }

            // Soft delete the Serika message
            await Message.updateById(serikaMsg.id, { isDeleted: true, deletedAt: new Date() });

            publishToChannel(serikaChannelId, {
              type: 'delete',
              messageId: serikaMsg.id,
            });
            console.log(`[Discord Bot] Forwarded message delete for Discord msg ${d.id} → Serika msg ${serikaMsg.id}`);
          }
        }
      } catch (err) {
        console.error('[Discord Bot] Error handling message:', err);
      }
    });

    ws.on('close', (code, reason) => {
      console.log(`[Discord Bot] Connection closed (${code}): ${reason || 'no reason'}. Reconnecting in 5s...`);
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      setTimeout(() => connect(), 5000);
    });

    ws.on('error', (err) => {
      console.error('[Discord Bot] Connection error:', err);
    });
  }

  connect();
}
