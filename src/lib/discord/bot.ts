import WebSocket from 'ws';

const BOT_ID = process.env.SERIKA_DISCORD_ID || '1524469730256355421';
const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://serika.chat').replace(/\/$/, '');

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
 * Map Discord embeds to Serika's embed shape. The field names line up almost
 * exactly (title/description/url/color/author/fields/image/thumbnail/video/
 * footer/timestamp), so this is mostly a pass-through that drops any keys the
 * renderer doesn't use and guards against malformed payloads.
 */
function mapEmbeds(d: any): any[] {
  if (!d.embeds || !Array.isArray(d.embeds)) return [];
  return d.embeds
    .filter((e: any) => e && typeof e === 'object')
    .map((e: any) => ({
      title: e.title,
      type: e.type,
      description: e.description,
      url: e.url,
      timestamp: e.timestamp,
      color: typeof e.color === 'number' ? e.color : undefined,
      footer: e.footer ? { text: e.footer.text, icon_url: e.footer.icon_url || e.footer.proxy_icon_url } : undefined,
      image: e.image ? { url: e.image.url || e.image.proxy_url, width: e.image.width, height: e.image.height } : undefined,
      thumbnail: e.thumbnail ? { url: e.thumbnail.url || e.thumbnail.proxy_url, width: e.thumbnail.width, height: e.thumbnail.height } : undefined,
      video: e.video ? { url: e.video.url || e.video.proxy_url, width: e.video.width, height: e.video.height } : undefined,
      author: e.author ? { name: e.author.name, url: e.author.url, icon_url: e.author.icon_url || e.author.proxy_icon_url } : undefined,
      fields: Array.isArray(e.fields) ? e.fields.map((f: any) => ({ name: f.name, value: f.value, inline: Boolean(f.inline) })) : undefined,
    }));
}

/**
 * Resolve a Discord reply (message_reference) to the matching Serika message so
 * the reply renders natively in Serika. Returns null if the referenced message
 * isn't bridged (e.g. it predates the bridge or was from an unconsented user).
 */
async function resolveReply(d: any): Promise<{ referencedMessageId: string; referencedMessage: any } | null> {
  const refId: string | undefined = d.message_reference?.message_id || d.referenced_message?.id;
  if (!refId) return null;
  const { Message } = await import('@/lib/models');
  const serikaRef = await Message.findByDiscordMessageId(refId);
  if (!serikaRef) return null;

  // Best-effort author snapshot for the inline reply preview.
  let refAuthor: any = { id: serikaRef.authorId, username: 'user', displayName: 'User' };
  try {
    const { User, DiscordUser } = await import('@/lib/models');
    const u = await User.findById(serikaRef.authorId);
    if (u) {
      refAuthor = { id: u.id, username: u.username, displayName: u.displayName, avatar: u.avatar };
    } else {
      const du = await DiscordUser.findById(serikaRef.authorId);
      if (du) refAuthor = { id: du.id, username: du.username, displayName: du.displayName, avatar: du.avatar };
    }
  } catch { /* fall back to placeholder author */ }

  let refContent = '';
  try {
    const { decryptFromStorage } = await import('@/lib/security');
    refContent = serikaRef.content ? await decryptFromStorage(serikaRef.content) : '';
  } catch { /* leave empty */ }

  return {
    referencedMessageId: serikaRef.id,
    referencedMessage: {
      id: serikaRef.id,
      content: refContent,
      authorId: serikaRef.authorId,
      author: refAuthor,
      attachments: serikaRef.attachments || [],
    },
  };
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

type ConsentStatus = 'pending' | 'granted' | 'denied';

async function getOrCreateDiscordUser(discordAuthor: any): Promise<{ id: string; username: string; displayName: string | null; avatar: string | null; isBot: boolean; isLinked: boolean; consentStatus: ConsentStatus; discordId: string }> {
  const { User } = await import('@/lib/models');
  const { UserConnection } = await import('@/lib/models/UserConnection');
  const { DiscordUser } = await import('@/lib/models/DiscordUser');

  // 1. Check if there's a Serika user with discordId matching this Discord user
  if (discordAuthor.id) {
    const linkedUser = await User.findOne({ discordId: discordAuthor.id });
    if (linkedUser) {
      // Only update discordUsername — NEVER overwrite the user's displayName or avatar
      if (linkedUser.discordUsername !== discordAuthor.username) {
        const updated = await User.updateById(linkedUser.id, {
          discordUsername: discordAuthor.username,
        });
        return {
          id: (updated || linkedUser).id,
          username: (updated || linkedUser).username,
          displayName: (updated || linkedUser).displayName,
          avatar: (updated || linkedUser).avatar || null,
          isBot: (updated || linkedUser).isBot || false,
          isLinked: true,
          consentStatus: 'granted',
          discordId: discordAuthor.id,
        };
      }
      return {
        id: linkedUser.id,
        username: linkedUser.username,
        displayName: linkedUser.displayName,
        avatar: linkedUser.avatar || null,
        isBot: linkedUser.isBot || false,
        isLinked: true,
        consentStatus: 'granted',
        discordId: discordAuthor.id,
      };
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
        return {
          id: linkedUser.id,
          username: linkedUser.username,
          displayName: linkedUser.displayName,
          avatar: linkedUser.avatar || null,
          isBot: linkedUser.isBot || false,
          isLinked: true,
          consentStatus: 'granted',
          discordId: discordAuthor.id,
        };
      }
    }
  }

  // 3. Fall back to creating/updating a DiscordUser entry (separate from User table)
  // Bots can't press consent buttons or run slash commands, so auto-grant them.
  const isBot = discordAuthor.bot || false;
  const newDisplayName = buildDisplayName(discordAuthor);
  const newAvatar = getAvatarUrl(discordAuthor);
  const discordUser = await DiscordUser.upsertByDiscordId(discordAuthor.id, {
    username: discordAuthor.username,
    displayName: newDisplayName,
    avatar: newAvatar,
    isBot,
    ...(isBot ? { consentStatus: 'granted', consentUpdatedAt: new Date() } : {}),
  });

  return {
    id: discordUser.id,
    username: discordUser.username || discordAuthor.username,
    displayName: discordUser.displayName,
    avatar: discordUser.avatar,
    isBot: discordUser.isBot || false,
    isLinked: false,
    consentStatus: isBot ? 'granted' : ((discordUser.consentStatus as ConsentStatus) || 'pending'),
    discordId: discordAuthor.id,
  };
}

// ── Discord REST helpers (bridge bot) ──────────────────────────────────────
const DISCORD_API = 'https://discord.com/api/v10';

function botHeaders(): Record<string, string> {
  return {
    Authorization: `Bot ${process.env.SERIKA_DISCORD_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

/** Open (or reuse) a DM channel with a Discord user. Returns the channel id. */
async function openDMChannel(discordUserId: string): Promise<string | null> {
  try {
    const res = await fetch(`${DISCORD_API}/users/@me/channels`, {
      method: 'POST',
      headers: botHeaders(),
      body: JSON.stringify({ recipient_id: discordUserId }),
    });
    if (!res.ok) {
      console.warn(`[Discord Consent] Failed to open DM channel for ${discordUserId}: ${res.status}`);
      return null;
    }
    const channel = await res.json().catch(() => null);
    return channel?.id || null;
  } catch (err) {
    console.error('[Discord Consent] openDMChannel error:', err);
    return null;
  }
}

/**
 * DM a Discord user asking them to consent to Serika processing their messages.
 * Includes Agree / Decline buttons handled via the INTERACTION_CREATE gateway
 * event. Rate-limited to once per 24h per user via `lastConsentDmAt`.
 */
async function sendConsentDM(discordUser: { discordId: string; lastConsentDmAt?: Date | null }, serverName: string): Promise<void> {
  const last = discordUser.lastConsentDmAt ? new Date(discordUser.lastConsentDmAt).getTime() : 0;
  if (Date.now() - last < 24 * 60 * 60 * 1000) return; // already asked recently

  const { DiscordUser } = await import('@/lib/models/DiscordUser');
  const channelId = await openDMChannel(discordUser.discordId);
  if (!channelId) return;

  try {
    await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: botHeaders(),
      body: JSON.stringify({
        embeds: [{
          title: 'Data processing consent required',
          description:
            `**You must allow data processing by Serika to chat in ${serverName}.**\n\n` +
            `This server is bridged to SerikaCord. Until you agree, your messages in the bridged ` +
            `channels will **not** be copied or forwarded, and the server may restrict you from chatting.\n\n` +
            `Serika will only store your username, avatar, and the message content you send in bridged ` +
            `channels, solely to relay it. You can withdraw consent at any time by pressing **Decline** ` +
            `or contacting the server admins, and your data will be deleted.`,
          color: 0x5865f2,
        }],
        components: [{
          type: 1,
          components: [
            { type: 2, style: 3, label: 'I agree', custom_id: 'serika_consent_grant' },
            { type: 2, style: 4, label: 'Decline', custom_id: 'serika_consent_deny' },
          ],
        }],
      }),
    });
    await DiscordUser.upsertByDiscordId(discordUser.discordId, { lastConsentDmAt: new Date() });
  } catch (err) {
    console.error('[Discord Consent] Failed to send consent DM:', err);
  }
}

/** Apply (or clear) a guild timeout via communication_disabled_until. */
async function setGuildTimeout(guildId: string, discordUserId: string, until: Date | null): Promise<void> {
  try {
    await fetch(`${DISCORD_API}/guilds/${guildId}/members/${discordUserId}`, {
      method: 'PATCH',
      headers: botHeaders(),
      body: JSON.stringify({ communication_disabled_until: until ? until.toISOString() : null }),
    });
  } catch (err) {
    console.error('[Discord Consent] Failed to set guild timeout:', err);
  }
}

/**
 * Lift every restriction timeout previously applied to a user across all
 * bridged guilds, then clear the bookkeeping. Called when a user consents —
 * the consent button/command fires in a DM, so the guild(s) they were
 * restricted in are read from `restrictedGuildIds` rather than the interaction.
 */
async function liftAllRestrictions(discordId: string): Promise<void> {
  const { DiscordUser } = await import('@/lib/models/DiscordUser');
  const row = await DiscordUser.findByDiscordId(discordId);
  const guildIds: string[] = (row?.restrictedGuildIds as string[] | null) || [];
  for (const guildId of guildIds) {
    await setGuildTimeout(guildId, discordId, null);
  }
  await DiscordUser.upsertByDiscordId(discordId, { restrictedGuildIds: [], lastTimeoutAt: null });
  if (guildIds.length) console.log(`[Discord Consent] Lifted restriction for ${discordId} in ${guildIds.length} guild(s).`);
}

/** Respond to a gateway-delivered interaction via the REST callback endpoint. */
async function respondInteraction(id: string, token: string, body: any): Promise<void> {
  try {
    await fetch(`${DISCORD_API}/interactions/${id}/${token}/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error('[Discord Consent] Failed to respond to interaction:', err);
  }
}

/**
 * Register the bridge bot's global slash commands. Idempotent — Discord upserts
 * by name, so running this on every startup is safe. Currently registers
 * `/forgetme` so any Discord user can erase their bridged data on demand.
 */
async function registerSlashCommands(appId: string): Promise<void> {
  try {
    const res = await fetch(`${DISCORD_API}/applications/${appId}/commands`, {
      method: 'PUT',
      headers: botHeaders(),
      body: JSON.stringify([
        {
          name: 'forgetme',
          description: 'Erase all of your data that SerikaCord has stored from bridged channels.',
          type: 1,
          dm_permission: true,
        },
        {
          name: 'opt-in',
          description: 'Allow SerikaCord to sync your messages from bridged channels (grants consent).',
          type: 1,
          dm_permission: true,
          options: [{
            name: 'server',
            description: 'Server ID to opt in for (optional — applies to all bridged servers if omitted).',
            type: 3, // STRING
            required: false,
          }],
        },
        {
          name: 'opt-out',
          description: 'Stop SerikaCord from syncing your messages and erase your bridged data.',
          type: 1,
          dm_permission: true,
          options: [{
            name: 'server',
            description: 'Server ID to opt out from (optional — applies to all bridged servers if omitted).',
            type: 3, // STRING
            required: false,
          }],
        },
      ]),
    });
    if (res.ok) console.log('[Discord Bot] Slash commands registered (/forgetme).');
    else console.warn(`[Discord Bot] Failed to register slash commands: ${res.status}`);
  } catch (err) {
    console.error('[Discord Bot] Error registering slash commands:', err);
  }
}

/**
 * Called when a Discord user without granted consent posts in a bridged channel.
 * Never syncs their message. DMs a consent request (rate-limited), and — if the
 * server opted into restriction — applies a 1-week timeout, re-applied weekly.
 */
async function handleUnconsentedMessage(server: any, discordUser: { discordId: string; consentStatus: ConsentStatus }): Promise<void> {
  const integrations = server.settings?.integrations || {};
  const guildId: string | undefined = integrations.discordGuildId;

  const { DiscordUser } = await import('@/lib/models/DiscordUser');
  const row = await DiscordUser.findByDiscordId(discordUser.discordId);

  // A prior explicit "Decline" is respected; we don't re-DM decliners, but the
  // server may still choose to restrict them below.
  if (row?.consentStatus !== 'denied') {
    await sendConsentDM({ discordId: discordUser.discordId, lastConsentDmAt: row?.lastConsentDmAt }, server.name || 'this server');
  }

  if (integrations.discordRestrictUnconsented && guildId) {
    const lastTimeout = row?.lastTimeoutAt ? new Date(row.lastTimeoutAt).getTime() : 0;
    // Re-apply at most once per week so we don't hammer the API on every message.
    if (Date.now() - lastTimeout >= 7 * 24 * 60 * 60 * 1000) {
      const until = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await setGuildTimeout(guildId, discordUser.discordId, until);
      // Remember the guild so the timeout can be lifted on consent (union).
      const existingGuilds: string[] = (row?.restrictedGuildIds as string[] | null) || [];
      const nextGuilds = existingGuilds.includes(guildId) ? existingGuilds : [...existingGuilds, guildId];
      await DiscordUser.upsertByDiscordId(discordUser.discordId, { lastTimeoutAt: new Date(), restrictedGuildIds: nextGuilds });
      console.log(`[Discord Consent] Applied 1-week restriction timeout to ${discordUser.discordId} in guild ${guildId}`);
    }
  }
}

/**
 * Apply a 1-week restriction timeout to a Discord user in every bridged guild
 * that has `discordRestrictUnconsented` enabled. Called on explicit opt-out,
 * consent deny, and during the startup restriction sweep.
 *
 * If `specificGuildId` is provided, only that guild is targeted (used when the
 * interaction fires inside a known guild). Otherwise all bridged guilds are
 * scanned.
 */
async function applyRestrictionTimeouts(discordId: string, opts?: { specificGuildId?: string }): Promise<void> {
  const { DiscordUser } = await import('@/lib/models/DiscordUser');
  const { Server } = await import('@/lib/models');
  const row = await DiscordUser.findByDiscordId(discordId);

  // If a specific guild is given, check only that server's settings.
  // Otherwise scan all bridged servers.
  const servers = await Server.find({});
  const targetGuilds: string[] = [];
  for (const server of servers) {
    const integrations = (server.settings as any)?.integrations || {};
    if (!integrations.discord || !integrations.discordGuildId) continue;
    if (!integrations.discordRestrictUnconsented) continue;
    if (opts?.specificGuildId && integrations.discordGuildId !== opts.specificGuildId) continue;
    targetGuilds.push(integrations.discordGuildId);
  }

  if (targetGuilds.length === 0) return;

  const until = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const existingGuilds: string[] = (row?.restrictedGuildIds as string[] | null) || [];
  const nextGuilds = [...new Set([...existingGuilds, ...targetGuilds])];

  for (const guildId of targetGuilds) {
    await setGuildTimeout(guildId, discordId, until);
  }
  await DiscordUser.upsertByDiscordId(discordId, { lastTimeoutAt: new Date(), restrictedGuildIds: nextGuilds });
  console.log(`[Discord Consent] Applied restriction timeouts to ${discordId} in ${targetGuilds.length} guild(s).`);
}

/**
 * On bot startup, sweep all Discord users with consentStatus 'denied' and
 * re-apply restriction timeouts in any bridged guild that has
 * discordRestrictUnconsented enabled. This ensures opted-out users remain
 * restricted even if the bot was offline when they opted out.
 */
async function startupRestrictionSweep(): Promise<void> {
  try {
    const { DiscordUser } = await import('@/lib/models/DiscordUser');
    const deniedUsers = await DiscordUser.findAllByConsent('denied');
    if (deniedUsers.length === 0) return;
    console.log(`[Discord Consent] Startup sweep: checking ${deniedUsers.length} opted-out user(s) for restriction enforcement.`);
    for (const user of deniedUsers) {
      // Skip bots — they can't be timed out and are always auto-granted.
      if (user.isBot) continue;
      // Only re-apply if the last timeout was >6 days ago (avoid hammering API).
      const lastTimeout = user.lastTimeoutAt ? new Date(user.lastTimeoutAt).getTime() : 0;
      if (Date.now() - lastTimeout < 6 * 24 * 60 * 60 * 1000) continue;
      await applyRestrictionTimeouts(user.discordId);
    }
    console.log('[Discord Consent] Startup restriction sweep complete.');
  } catch (err) {
    console.error('[Discord Consent] Startup restriction sweep failed:', err);
  }
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
            // Register slash commands. application id === bot user id.
            void registerSlashCommands(d.application?.id || d.user.id);
            // Sweep all opted-out users and re-apply restriction timeouts in
            // bridged guilds that have discordRestrictUnconsented enabled.
            void startupRestrictionSweep();
          }

          if (t === 'RESUMED') {
            console.log('[Discord Bot] Session resumed — replaying missed events.');
          }

          // Slash commands. type 2 = APPLICATION_COMMAND.
          if (t === 'INTERACTION_CREATE' && d.type === 2 && d.data?.name === 'forgetme') {
            const discordId = d.user?.id || d.member?.user?.id;
            if (discordId) {
              let deletedMessages = 0;
              try {
                const { deleteBridgedUserData } = await import('@/lib/discord/consent');
                const { DiscordUser } = await import('@/lib/models/DiscordUser');
                // Record a 'denied' decision, then fully erase the profile + messages.
                await DiscordUser.setConsent(discordId, 'denied');
                const result = await deleteBridgedUserData(discordId, { forgetProfile: true });
                deletedMessages = result.deletedMessages;
              } catch (err) {
                console.error('[Discord Consent] /forgetme failed:', err);
              }
              await respondInteraction(d.id, d.token, {
                type: 4,
                data: {
                  flags: 64, // ephemeral
                  embeds: [{
                    title: 'Your data has been erased',
                    description:
                      `We deleted **${deletedMessages}** message${deletedMessages === 1 ? '' : 's'} and your bridged ` +
                      `profile from SerikaCord. Your consent is now set to declined, so nothing further will be ` +
                      `stored unless you opt back in. You can also manage this at ${SITE_URL}/forgetme.`,
                    color: 0x22c55e,
                  }],
                },
              });
              console.log(`[Discord Consent] /forgetme erased data for ${discordId} (${deletedMessages} messages).`);
            }
          }

          // /opt-in — grant consent and lift any restriction timeouts.
          if (t === 'INTERACTION_CREATE' && d.type === 2 && d.data?.name === 'opt-in') {
            const discordId = d.user?.id || d.member?.user?.id;
            const author = d.user || d.member?.user;
            const serverIdParam: string | undefined = d.data?.options?.find((o: any) => o.name === 'server')?.value;
            if (discordId) {
              try {
                const { DiscordUser } = await import('@/lib/models/DiscordUser');
                await DiscordUser.setConsent(discordId, 'granted', {
                  username: author?.username,
                  displayName: buildDisplayName(author || { username: 'unknown' }),
                  avatar: author ? getAvatarUrl(author) : undefined,
                });
                await liftAllRestrictions(discordId);
              } catch (err) {
                console.error('[Discord Consent] /opt-in failed:', err);
              }
              await respondInteraction(d.id, d.token, {
                type: 4,
                data: {
                  flags: 64,
                  embeds: [{
                    title: "You're opted in ✅",
                    description: serverIdParam
                      ? `Your messages in bridged channels will now sync to SerikaCord, and any restriction has been lifted. You can opt out anytime with /opt-out.`
                      : 'Your messages in bridged channels will now sync to SerikaCord, and any restriction has been lifted. You can opt out anytime with /opt-out.',
                    color: 0x22c55e,
                  }],
                },
              });
              console.log(`[Discord Consent] /opt-in granted for ${discordId}${serverIdParam ? ` (server: ${serverIdParam})` : ''}.`);
            }
          }

          // /opt-out — withdraw consent, erase bridged data, and apply restriction
          // timeouts in bridged guilds that have discordRestrictUnconsented enabled.
          if (t === 'INTERACTION_CREATE' && d.type === 2 && d.data?.name === 'opt-out') {
            const discordId = d.user?.id || d.member?.user?.id;
            const serverIdParam: string | undefined = d.data?.options?.find((o: any) => o.name === 'server')?.value;
            if (discordId) {
              let deletedMessages = 0;
              try {
                const { deleteBridgedUserData } = await import('@/lib/discord/consent');
                const { DiscordUser } = await import('@/lib/models/DiscordUser');
                await DiscordUser.setConsent(discordId, 'denied');
                const result = await deleteBridgedUserData(discordId);
                deletedMessages = result.deletedMessages;
                // Apply restriction timeouts in bridged guilds with restrict enabled.
                // If a specific server ID was provided, only target that guild.
                await applyRestrictionTimeouts(discordId, serverIdParam ? { specificGuildId: serverIdParam } : undefined);
              } catch (err) {
                console.error('[Discord Consent] /opt-out failed:', err);
              }
              await respondInteraction(d.id, d.token, {
                type: 4,
                data: {
                  flags: 64,
                  embeds: [{
                    title: "You're opted out",
                    description:
                      `Your messages will no longer be synced, and we deleted **${deletedMessages}** stored ` +
                      `message${deletedMessages === 1 ? '' : 's'}. If the server requires opt-in, you will be timed out until you opt back in with /opt-in.`,
                    color: 0x6b7280,
                  }],
                },
              });
              console.log(`[Discord Consent] /opt-out for ${discordId} (${deletedMessages} messages)${serverIdParam ? ` (server: ${serverIdParam})` : ''}.`);
            }
          }

          // Consent buttons (delivered over the gateway since no interactions
          // endpoint URL is configured). type 3 = MESSAGE_COMPONENT.
          if (t === 'INTERACTION_CREATE' && d.type === 3) {
            const customId: string = d.data?.custom_id || '';
            if (customId === 'serika_consent_grant' || customId === 'serika_consent_deny') {
              const discordId = d.user?.id || d.member?.user?.id;
              const author = d.user || d.member?.user;
              if (discordId) {
                const { DiscordUser } = await import('@/lib/models/DiscordUser');
                const granted = customId === 'serika_consent_grant';
                await DiscordUser.setConsent(discordId, granted ? 'granted' : 'denied', {
                  username: author?.username,
                  displayName: buildDisplayName(author || { username: 'unknown' }),
                  avatar: author ? getAvatarUrl(author) : undefined,
                });
                // On consent, lift every restriction timeout we applied (the
                // button fires in a DM, so use the stored guild list, not d.guild_id).
                if (granted) {
                  await liftAllRestrictions(discordId);
                }
                // Update the DM message in place (type 7 = UPDATE_MESSAGE).
                await respondInteraction(d.id, d.token, {
                  type: 7,
                  data: {
                    embeds: [{
                      title: granted ? 'Consent granted ✅' : 'Consent declined',
                      description: granted
                        ? 'Thank you — your messages in bridged channels will now sync to SerikaCord. You can withdraw consent at any time by contacting the server admins.'
                        : 'Understood. Your messages will not be processed or synced by Serika. Any data previously stored will be removed. You can re-enable this later if you change your mind.',
                      color: granted ? 0x22c55e : 0x6b7280,
                    }],
                    components: [],
                  },
                });
                // On decline, purge any previously-stored bridged messages/profile
                // and apply restriction timeouts in bridged guilds that enforce opt-in.
                if (!granted) {
                  try {
                    const { deleteBridgedUserData } = await import('@/lib/discord/consent');
                    await deleteBridgedUserData(discordId);
                    await applyRestrictionTimeouts(discordId);
                  } catch (err) {
                    console.error('[Discord Consent] Failed to purge data on decline:', err);
                  }
                }
                console.log(`[Discord Consent] User ${discordId} ${granted ? 'granted' : 'declined'} consent.`);
              }
            }
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
            const isLinkedAccount = serikaUser.isLinked;

            // Consent gate: never store or forward messages from a Discord user
            // who has not granted data-processing consent. Ask for it (and
            // optionally restrict them) instead.
            if (serikaUser.consentStatus !== 'granted') {
              console.log(`[Discord Consent] Skipping message from unconsented user ${d.author.username} (${d.author.id}).`);
              await handleUnconsentedMessage(server, { discordId: serikaUser.discordId, consentStatus: serikaUser.consentStatus });
              return;
            }

            // Convert Discord content to Serika-friendly format
            const rawContent = d.content || '';
            const content = formatDiscordContentForSerika(rawContent);
            const attachments = mapAttachments(d);
            const embeds = mapEmbeds(d);
            const reply = await resolveReply(d);

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
              type: reply ? 'reply' : 'default',
              attachments,
              embeds,
              referencedMessageId: reply?.referencedMessageId ?? null,
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
              embeds,
              referencedMessageId: reply?.referencedMessageId ?? null,
              referencedMessage: reply?.referencedMessage ?? null,
              edited: false,
              type: reply ? 'reply' : 'default',
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

            // MESSAGE_UPDATE fires for content edits AND for embed-only changes
            // (e.g. Discord unfurling a link a moment after the message posts).
            // Only skip if there's genuinely nothing we track in the payload.
            const hasContent = typeof d.content === 'string';
            const hasEmbeds = Array.isArray(d.embeds);
            const hasAttachments = Array.isArray(d.attachments);
            if (!hasContent && !hasEmbeds && !hasAttachments) return;

            const update: Record<string, any> = { updatedAt: new Date() };
            let newContent: string | undefined;
            if (hasContent) {
              newContent = formatDiscordContentForSerika(d.content);
              update.content = await encryptForStorage(newContent);
              update.edited = true;
              update.editedTimestamp = new Date();
            }
            const newEmbeds = hasEmbeds ? mapEmbeds(d) : undefined;
            if (newEmbeds) update.embeds = newEmbeds;
            const newAttachments = hasAttachments ? mapAttachments(d) : undefined;
            if (newAttachments) update.attachments = newAttachments;

            await Message.updateById(serikaMsg.id, update);

            publishToChannel(serikaChannelId, {
              type: 'edit',
              messageId: serikaMsg.id,
              channelId: serikaChannelId,
              ...(newContent !== undefined ? { content: newContent, edited: true } : {}),
              ...(newEmbeds !== undefined ? { embeds: newEmbeds } : {}),
              ...(newAttachments !== undefined ? { attachments: newAttachments } : {}),
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
