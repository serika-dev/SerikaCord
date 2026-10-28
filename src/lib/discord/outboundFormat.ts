/**
 * Pure parts of the SerikaCord -> Discord half of the bridge (no DB, no
 * network), unit tested in tests/discord-bridge-outbound.test.ts:
 *
 * - turning SerikaCord mention markup (<@uuid>, <@&uuid>, <#uuid>, custom
 *   emoji) into text Discord shows properly: real names, a real Discord
 *   mention for people / bots that are in the Discord server, a real channel
 *   mention for bridged channels
 * - which Discord users the webhook may ping (allowed_mentions)
 * - whether a message is relayed at all (loops, bot toggle, linked bots)
 * - bot embeds and components in a shape Discord's webhook accepts
 *
 * I/O (name lookups, guild membership) lives in outboundMentions.ts and
 * outbound.ts.
 */

const UUID_SRC = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const SNOWFLAKE = /^\d{17,20}$/;

/** Stored content is HTML-escaped in a few older paths; mention markup survives as &lt;@id&gt;. */
function decodeMarkup(text: string): string {
  return text.includes('&lt;') ? text.replace(/&lt;/g, '<').replace(/&gt;/g, '>') : text;
}

export interface SerikaMentionIds {
  userIds: string[];
  roleIds: string[];
  channelIds: string[];
}

const MAX_MENTION_IDS = 50;

/** SerikaCord ids referenced by mention markup in `texts` (lowercased, deduplicated, capped). */
export function serikaMentionIds(texts: ReadonlyArray<string | null | undefined>): SerikaMentionIds {
  const users = new Set<string>();
  const roles = new Set<string>();
  const channels = new Set<string>();
  const userRe = new RegExp(`<@!?(${UUID_SRC})>`, 'g');
  const roleRe = new RegExp(`<@&(${UUID_SRC})>`, 'g');
  const channelRe = new RegExp(`<#(${UUID_SRC})>`, 'g');
  for (const raw of texts) {
    if (!raw) continue;
    const text = decodeMarkup(raw);
    for (const m of text.matchAll(userRe)) if (users.size < MAX_MENTION_IDS) users.add(m[1].toLowerCase());
    for (const m of text.matchAll(roleRe)) if (roles.size < MAX_MENTION_IDS) roles.add(m[1].toLowerCase());
    for (const m of text.matchAll(channelRe)) if (channels.size < MAX_MENTION_IDS) channels.add(m[1].toLowerCase());
  }
  return { userIds: [...users], roleIds: [...roles], channelIds: [...channels] };
}

/** What the outbound bridge knows about the ids a message mentions (keys lowercased). */
export interface OutboundMentionLookup {
  /** name: server nickname > display name > username. discordId: set only when a real Discord mention is safe (see outboundMentions.ts). */
  users?: Record<string, { name: string; discordId?: string | null }>;
  roles?: Record<string, string>;
  /** discordChannelId: set when that channel is bridged to this Discord server. */
  channels?: Record<string, { name: string; discordChannelId?: string | null }>;
}

const CONTROL = /[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g;

/**
 * A SerikaCord name made safe to drop into Discord text: one line, no mention
 * or emoji markup (`<`/`>` removed, so a name like "<@123>" can't become a
 * ping), Discord markdown escaped, at most 64 characters.
 */
export function discordSafeName(name: string | null | undefined, fallback: string): string {
  const cleaned = String(name ?? '')
    .replace(CONTROL, ' ')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64)
    .trim();
  if (!cleaned) return fallback;
  return cleaned.replace(/([\\*_~|`])/g, '\\$1');
}

/**
 * Convert SerikaCord content to Discord text. Mentions read as real names
 * (`@Alice`, `@Moderators`, `#general`); a user or bot that is in the
 * Discord server becomes a real Discord mention (`<@snowflake>`, which
 * Discord shows as their name), and a bridged channel a real channel mention.
 * Ids the lookup doesn't know fall back to generic labels, so raw SerikaCord
 * ids never show. Custom emoji become `:name:`.
 */
export function formatSerikaContentForDiscord(content: string, lookup: OutboundMentionLookup = {}): string {
  if (!content) return '';
  return decodeMarkup(content)
    .replace(new RegExp(`<@!?(${UUID_SRC})>`, 'g'), (_m, id: string) => {
      const u = lookup.users?.[id.toLowerCase()];
      if (!u) return '@user';
      if (u.discordId && SNOWFLAKE.test(u.discordId)) return `<@${u.discordId}>`;
      return `@${discordSafeName(u.name, 'user')}`;
    })
    .replace(new RegExp(`<@&(${UUID_SRC})>`, 'g'), (_m, id: string) => {
      const name = lookup.roles?.[id.toLowerCase()];
      return `@${discordSafeName(name, 'role')}`;
    })
    .replace(new RegExp(`<#(${UUID_SRC})>`, 'g'), (_m, id: string) => {
      const c = lookup.channels?.[id.toLowerCase()];
      if (c?.discordChannelId && SNOWFLAKE.test(c.discordChannelId)) return `<#${c.discordChannelId}>`;
      return `#${discordSafeName(c?.name, 'channel')}`;
    })
    .replace(new RegExp(`<a?:([a-zA-Z0-9_]+):${UUID_SRC}>`, 'g'), ':$1:');
}

export interface DiscordAllowedMentions {
  parse: string[];
  users?: string[];
}

/**
 * allowed_mentions for a bridged webhook post. @everyone, @here and roles
 * never ping. Users ping only when the message pinged them on SerikaCord too
 * (`mentionedUserIds`, which already honours a bot's allowed_mentions) and
 * they resolved to a Discord account in the server. A person may still ping
 * a Discord user by typing their raw `<@snowflake>` (as before); a bot's raw
 * snowflakes never ping.
 */
export function bridgeAllowedMentions(opts: {
  content: string;
  lookup: OutboundMentionLookup;
  mentionedUserIds?: ReadonlyArray<string> | null;
  authorIsBot: boolean;
}): DiscordAllowedMentions {
  const users = new Set<string>();
  const pinged = Array.isArray(opts.mentionedUserIds) ? new Set(opts.mentionedUserIds.map((id) => String(id).toLowerCase())) : null;
  const text = decodeMarkup(opts.content || '');
  for (const m of text.matchAll(new RegExp(`<@!?(${UUID_SRC})>`, 'g'))) {
    const id = m[1].toLowerCase();
    const discordId = opts.lookup.users?.[id]?.discordId;
    if (!discordId || !SNOWFLAKE.test(discordId)) continue;
    if (pinged && !pinged.has(id)) continue;
    users.add(discordId);
  }
  if (!opts.authorIsBot) {
    for (const m of text.matchAll(/<@!?(\d{17,20})>/g)) users.add(m[1]);
  }
  // Discord accepts at most 100 ids.
  return { parse: [], users: [...users].slice(0, 100) };
}

// ── Whether a message goes out at all ───────────────────────────────────────

export type OutboundSkipReason =
  | 'from_discord'
  | 'discord_copy'
  | 'bots_off'
  | 'no_consent'
  | 'ephemeral'
  | 'loading'
  | 'linked_bot_native'
  | 'bot_chain';

export interface OutboundRelayInput {
  action: 'create' | 'edit' | 'delete';
  /** The stored message's bridge origin (bridgeOrigin column). */
  bridgeOrigin?: unknown;
  author: {
    /** A bridged Discord account (isDiscord / discord-* username). */
    isDiscordCopy?: boolean;
    isBot?: boolean;
    isWebhook?: boolean;
  };
  /** Link option "bot messages" (includeBots). */
  includeBots: boolean;
  /** People only: the author agreed to their messages going to Discord. */
  authorConsented?: boolean;
  /** Message flags (EPHEMERAL 1<<6, LOADING 1<<7). */
  flags?: number | null;
  /** The author is a SerikaCord bot linked to a Discord bot that is in this Discord server. */
  linkedDiscordBotInGuild?: boolean;
  /** Bridge origin of the message this one replies to, if any. */
  replyToBridgeOrigin?: unknown;
}

const FLAG_EPHEMERAL = 1 << 6;
const FLAG_LOADING = 1 << 7;

/** True when a stored bridgeOrigin says the message came in from Discord. */
export function cameFromDiscord(origin: unknown): boolean {
  return Boolean(origin && typeof origin === 'object' && (origin as { platform?: unknown }).platform === 'discord');
}

/**
 * Whether the outbound bridge relays this message, and why not. Deletes only
 * need the message not to have come from Discord (the webhook can't delete a
 * Discord original); everything else is checked for create and edit.
 */
export function decideOutboundRelay(input: OutboundRelayInput): { relay: true } | { relay: false; reason: OutboundSkipReason } {
  // Loop guard: never send a relayed-in Discord message back to Discord.
  if (cameFromDiscord(input.bridgeOrigin)) return { relay: false, reason: 'from_discord' };
  if (input.action === 'delete') return { relay: true };
  if (input.author.isDiscordCopy) return { relay: false, reason: 'discord_copy' };
  const flags = typeof input.flags === 'number' ? input.flags : 0;
  if ((flags & FLAG_EPHEMERAL) !== 0) return { relay: false, reason: 'ephemeral' };
  if ((flags & FLAG_LOADING) !== 0) return { relay: false, reason: 'loading' };
  const isApp = Boolean(input.author.isBot || input.author.isWebhook);
  if (isApp) {
    if (!input.includeBots) return { relay: false, reason: 'bots_off' };
    // A bot running on both platforms already answered on Discord itself
    // when the message it answers came from there.
    if (input.linkedDiscordBotInGuild && cameFromDiscord(input.replyToBridgeOrigin)) {
      return { relay: false, reason: 'linked_bot_native' };
    }
    // A bot answering a Discord bot: relaying it could start two bots
    // answering each other across the bridge forever.
    if (cameFromDiscord(input.replyToBridgeOrigin) && (input.replyToBridgeOrigin as { authorBot?: unknown }).authorBot === true) {
      return { relay: false, reason: 'bot_chain' };
    }
    return { relay: true };
  }
  // People: only with their outbound consent (bots and webhooks need none).
  if (!input.authorConsented) return { relay: false, reason: 'no_consent' };
  return { relay: true };
}

// ── Webhook identity ────────────────────────────────────────────────────────

/** The webhook username for a relayed message: "<name> (Serika)", within Discord's 80 characters. */
export function bridgeWebhookUsername(name: string | null | undefined): string {
  const base = String(name ?? '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim() || 'User';
  const suffix = ' (Serika)';
  return `${base.slice(0, 80 - suffix.length).trim()}${suffix}`;
}

/** An absolute http(s) avatar URL Discord can fetch, or undefined. Relative paths resolve against `siteUrl`. */
export function bridgeAvatarUrl(avatar: unknown, siteUrl: string): string | undefined {
  if (typeof avatar !== 'string' || !avatar) return undefined;
  const value = avatar.startsWith('/') && !avatar.startsWith('//') ? `${siteUrl.replace(/\/$/, '')}${avatar}` : avatar;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

// ── Bot embeds ──────────────────────────────────────────────────────────────

function httpUrl(v: unknown): string | undefined {
  if (typeof v !== 'string' || v.length > 2048) return undefined;
  try {
    const url = new URL(v);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function text(v: unknown, max: number, format: (s: string) => string = (s) => s): string | undefined {
  if (typeof v !== 'string' || !v) return undefined;
  const out = format(v).slice(0, max);
  return out || undefined;
}

/**
 * A message's stored embeds (bot / webhook embeds, already validated to
 * Discord's shape) as Discord webhook embeds: known fields only, http(s) URLs
 * only, Discord's limits, mention markup turned into names. Link-preview
 * embeds SerikaCord generated itself (type other than "rich") are skipped,
 * since Discord unfurls the link on its own.
 */
export function toDiscordEmbeds(embeds: unknown, format: (s: string) => string = (s) => s, max = 10): Array<Record<string, unknown>> {
  if (!Array.isArray(embeds)) return [];
  const out: Array<Record<string, unknown>> = [];
  let total = 0;
  for (const raw of embeds) {
    if (out.length >= max) break;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const e = raw as Record<string, unknown>;
    if (typeof e.type === 'string' && e.type !== 'rich') continue;
    const embed: Record<string, unknown> = {};
    const title = text(e.title, 256, format);
    const description = text(e.description, 4096, format);
    const url = httpUrl(e.url);
    if (title) embed.title = title;
    if (description) embed.description = description;
    if (url) embed.url = url;
    if (typeof e.color === 'number' && Number.isInteger(e.color) && e.color >= 0 && e.color <= 0xffffff) embed.color = e.color;
    if (typeof e.timestamp === 'string' && !Number.isNaN(Date.parse(e.timestamp))) embed.timestamp = new Date(e.timestamp).toISOString();
    const footer = e.footer as Record<string, unknown> | undefined;
    const footerText = text(footer?.text, 2048, format);
    if (footerText) embed.footer = { text: footerText, ...(httpUrl(footer?.icon_url ?? footer?.iconUrl) ? { icon_url: httpUrl(footer?.icon_url ?? footer?.iconUrl) } : {}) };
    const author = e.author as Record<string, unknown> | undefined;
    const authorName = text(author?.name, 256, format);
    if (authorName) {
      embed.author = {
        name: authorName,
        ...(httpUrl(author?.url) ? { url: httpUrl(author?.url) } : {}),
        ...(httpUrl(author?.icon_url ?? author?.iconUrl) ? { icon_url: httpUrl(author?.icon_url ?? author?.iconUrl) } : {}),
      };
    }
    const image = httpUrl((e.image as Record<string, unknown> | undefined)?.url);
    if (image) embed.image = { url: image };
    const thumbnail = httpUrl((e.thumbnail as Record<string, unknown> | undefined)?.url);
    if (thumbnail) embed.thumbnail = { url: thumbnail };
    if (Array.isArray(e.fields)) {
      const fields: Array<{ name: string; value: string; inline?: boolean }> = [];
      for (const f of e.fields.slice(0, 25)) {
        if (!f || typeof f !== 'object') continue;
        const fr = f as Record<string, unknown>;
        const name = text(fr.name, 256, format);
        const value = text(fr.value, 1024, format);
        if (!name || !value) continue;
        fields.push({ name, value, ...(fr.inline === true ? { inline: true } : {}) });
      }
      if (fields.length) embed.fields = fields;
    }
    if (Object.keys(embed).length === 0) continue;
    // Discord: all embeds of a message together at most 6000 characters.
    const size = [embed.title, embed.description, (embed.footer as { text?: string } | undefined)?.text, (embed.author as { name?: string } | undefined)?.name]
      .reduce<number>((n, s) => n + (typeof s === 'string' ? s.length : 0), 0)
      + ((embed.fields as Array<{ name: string; value: string }> | undefined) ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0);
    if (total + size > 6000) break;
    total += size;
    out.push(embed);
  }
  return out;
}

/** The "X used /cmd" line Discord shows above an interaction response, as Discord subtext. */
export function interactionLine(interaction: unknown): string {
  if (!interaction || typeof interaction !== 'object') return '';
  const i = interaction as { name?: unknown; user?: { username?: unknown; displayName?: unknown } };
  const name = typeof i.name === 'string' ? i.name.replace(/[^\w\- ]/g, '').trim().slice(0, 64) : '';
  if (!name) return '';
  const user = discordSafeName(typeof i.user?.username === 'string' ? i.user.username : '', 'someone');
  return `-# ${user} used /${name}\n`;
}
