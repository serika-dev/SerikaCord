/**
 * YouTube / Twitch notification helpers (pure, no I/O): channel input
 * parsing, the YouTube Atom feed parser, Twitch thumbnail templates, the
 * per-integration settings reader, and the message builder (content line with
 * the chosen ping, embed, link button) shared by real and test posts.
 *
 * The network side lives in `./sources.ts`, posting in `./post.ts` and the
 * background checks in `./poller.ts`.
 */

export type IntegrationKind = 'youtube' | 'twitch';
export const INTEGRATION_KINDS: readonly IntegrationKind[] = ['youtube', 'twitch'];

export function isIntegrationKind(value: unknown): value is IntegrationKind {
  return value === 'youtube' || value === 'twitch';
}

// ─── Channel input ────────────────────────────────────────────────────────

export type YouTubeChannelRef =
  | { kind: 'id'; id: string }
  | { kind: 'handle'; handle: string }
  | { kind: 'path'; path: string };

const YT_CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const YT_HANDLE = /^[A-Za-z0-9._-]{3,30}$/;
const YT_LEGACY_NAME = /^[A-Za-z0-9._-]{1,100}$/;
const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);

function decodeBasicEntities(input: string): string {
  if (!input.includes('&')) return input;
  return input
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&#x0*27;|&apos;/gi, "'")
    .replace(/&#x0*2f;|&#0*47;/gi, '/')
    .replace(/&amp;/g, '&');
}

/**
 * What the owner typed in "YouTube channel": a channel URL
 * (youtube.com/channel/UC..., /@handle, /c/name, /user/name), an @handle, a
 * bare channel id (UC...), or a bare handle. Null when it can't be a channel.
 */
export function parseYouTubeChannelInput(raw: string | null | undefined): YouTubeChannelRef | null {
  if (typeof raw !== 'string') return null;
  const input = decodeBasicEntities(raw).trim();
  if (!input || input.length > 300) return null;
  if (YT_CHANNEL_ID.test(input)) return { kind: 'id', id: input };
  if (input.startsWith('@')) {
    const handle = input.slice(1);
    return YT_HANDLE.test(handle) ? { kind: 'handle', handle } : null;
  }
  const looksLikeUrl = /^(https?:\/\/)?([a-z0-9-]+\.)*youtube\.com(\/|$)/i.test(input);
  if (looksLikeUrl) {
    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    } catch {
      return null;
    }
    if (!YT_HOSTS.has(url.hostname.toLowerCase())) return null;
    const parts = url.pathname.split('/').filter(Boolean).map((p) => {
      try { return decodeURIComponent(p); } catch { return p; }
    });
    if (parts.length === 0) return null;
    const [first, second] = parts;
    if (first === 'channel' && second && YT_CHANNEL_ID.test(second)) return { kind: 'id', id: second };
    if (first.startsWith('@')) {
      const handle = first.slice(1);
      return YT_HANDLE.test(handle) ? { kind: 'handle', handle } : null;
    }
    if ((first === 'c' || first === 'user') && second && YT_LEGACY_NAME.test(second)) return { kind: 'path', path: `${first}/${second}` };
    // youtube.com/<customname> (legacy vanity URLs)
    const reserved = new Set(['watch', 'shorts', 'playlist', 'results', 'feed', 'live', 'embed', 'channel', 'c', 'user', 'redirect', 'about']);
    if (parts.length === 1 && !reserved.has(first) && YT_LEGACY_NAME.test(first)) return { kind: 'path', path: first };
    return null;
  }
  // A bare name: treat it as a handle (the common case today).
  if (YT_HANDLE.test(input)) return { kind: 'handle', handle: input };
  return null;
}

/** The youtube.com page to read a channel id from (handles and legacy names). */
export function youTubeChannelPageUrl(ref: YouTubeChannelRef): string {
  if (ref.kind === 'id') return `https://www.youtube.com/channel/${ref.id}`;
  if (ref.kind === 'handle') return `https://www.youtube.com/@${encodeURIComponent(ref.handle)}`;
  return `https://www.youtube.com/${ref.path.split('/').map(encodeURIComponent).join('/')}`;
}

/** Cache / dedupe key for a channel reference (case-insensitive for names). */
export function youTubeRefKey(ref: YouTubeChannelRef): string {
  if (ref.kind === 'id') return `id:${ref.id}`;
  if (ref.kind === 'handle') return `handle:${ref.handle.toLowerCase()}`;
  return `path:${ref.path.toLowerCase()}`;
}

export interface YouTubeChannelPageInfo {
  channelId: string;
  name: string | null;
  avatarUrl: string | null;
}

function metaContent(html: string, attr: 'property' | 'itemprop' | 'name', key: string): string | null {
  const re = new RegExp(`<meta\\s+${attr}="${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s+content="([^"]*)"`, 'i');
  const m = html.match(re);
  return m ? decodeBasicEntities(m[1]) : null;
}

/** Channel id, name and avatar from a youtube.com channel page (canonical link / meta tags). */
export function extractYouTubeChannelFromHtml(html: string): YouTubeChannelPageInfo | null {
  if (!html) return null;
  let channelId: string | null = null;
  const canonical = html.match(/<link\s+rel="canonical"\s+href="https:\/\/www\.youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})"/i);
  if (canonical) channelId = canonical[1];
  if (!channelId) {
    const ident = metaContent(html, 'itemprop', 'identifier');
    if (ident && YT_CHANNEL_ID.test(ident)) channelId = ident;
  }
  if (!channelId) {
    const ext = html.match(/"externalId":"(UC[A-Za-z0-9_-]{22})"/) || html.match(/"channelId":"(UC[A-Za-z0-9_-]{22})"/);
    if (ext) channelId = ext[1];
  }
  if (!channelId) return null;
  const name = metaContent(html, 'property', 'og:title');
  const avatar = metaContent(html, 'property', 'og:image');
  return {
    channelId,
    name: name ? name.slice(0, 200) : null,
    avatarUrl: avatar && /^https:\/\/[a-z0-9.-]+\.(ggpht|googleusercontent|ytimg)\.com\//i.test(avatar) ? avatar : null,
  };
}

/** Twitch login from a name, @name or twitch.tv URL. Null when invalid. */
export function parseTwitchLogin(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  let input = decodeBasicEntities(raw).trim();
  if (!input || input.length > 200) return null;
  const urlMatch = input.match(/^(?:https?:\/\/)?(?:www\.|m\.)?twitch\.tv\/([^/?#]+)/i);
  if (urlMatch) input = urlMatch[1];
  else if (/[/:]/.test(input)) return null;
  input = input.replace(/^@/, '').toLowerCase();
  return /^[a-z0-9_]{2,25}$/.test(input) ? input : null;
}

// ─── YouTube feed ─────────────────────────────────────────────────────────

export interface YouTubeFeedEntry {
  videoId: string;
  title: string;
  url: string;
  publishedAt: string | null;
  thumbnailUrl: string;
  isShort: boolean;
}

export interface YouTubeFeed {
  channelId: string | null;
  channelName: string | null;
  channelUrl: string | null;
  entries: YouTubeFeedEntry[];
}

function decodeXml(input: string): string {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function safeCodePoint(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return '';
  try { return String.fromCodePoint(n); } catch { return ''; }
}

function tag(xml: string, name: string): string | null {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`);
  const m = xml.match(re);
  return m ? decodeXml(m[1]).trim() : null;
}

function isoOrNull(value: string | null): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** The standard hqdefault thumbnail (always exists, unlike maxresdefault). */
export function youTubeThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
}

/**
 * Parse https://www.youtube.com/feeds/videos.xml?channel_id=... (Atom).
 * Entries come back newest first, as YouTube sends them.
 */
export function parseYouTubeFeed(xml: string): YouTubeFeed {
  const feed: YouTubeFeed = { channelId: null, channelName: null, channelUrl: null, entries: [] };
  if (!xml || typeof xml !== 'string') return feed;
  const firstEntry = xml.indexOf('<entry');
  const head = firstEntry >= 0 ? xml.slice(0, firstEntry) : xml;
  const altLink = head.match(/<link\s+rel="alternate"\s+href="([^"]+)"/);
  feed.channelUrl = altLink ? decodeXml(altLink[1]) : null;
  const linkId = feed.channelUrl?.match(/\/channel\/(UC[A-Za-z0-9_-]{22})/)?.[1] ?? null;
  const rawId = tag(head, 'yt:channelId');
  feed.channelId = linkId ?? (rawId ? (rawId.startsWith('UC') ? rawId : `UC${rawId}`) : null);
  feed.channelName = tag(head, 'title') ?? tag(tag(head, 'author') ?? '', 'name');

  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(xml)) !== null) {
    const body = m[1];
    const videoId = tag(body, 'yt:videoId');
    if (!videoId || !/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) continue;
    const link = body.match(/<link\s+rel="alternate"\s+href="([^"]+)"/);
    const href = link ? decodeXml(link[1]) : '';
    const isShort = /\/shorts\//.test(href);
    feed.entries.push({
      videoId,
      title: (tag(body, 'title') ?? tag(body, 'media:title') ?? '').slice(0, 300),
      url: isShort ? `https://www.youtube.com/shorts/${videoId}` : `https://www.youtube.com/watch?v=${videoId}`,
      publishedAt: isoOrNull(tag(body, 'published')),
      thumbnailUrl: youTubeThumbnailUrl(videoId),
      isShort,
    });
    if (!feed.channelName) feed.channelName = tag(tag(body, 'author') ?? '', 'name');
  }
  return feed;
}

// ─── Twitch ───────────────────────────────────────────────────────────────

/**
 * Twitch thumbnail templates: live previews use `{width}x{height}`, VODs use
 * `%{width}x%{height}`. Returns null for anything that isn't a Twitch CDN URL.
 */
export function twitchThumbnailUrl(template: string | null | undefined, width = 1280, height = 720): string | null {
  if (!template || typeof template !== 'string') return null;
  const url = template
    .replace(/%?\{width\}/g, String(width))
    .replace(/%?\{height\}/g, String(height));
  return /^https:\/\/(static-cdn\.jtvnw\.net|vod-secure\.twitch\.tv|[a-z0-9-]+\.cloudfront\.net)\//i.test(url) ? url : null;
}

/** The public live preview image for a login (works without API credentials). */
export function twitchPreviewUrl(login: string, width = 1280, height = 720): string {
  return `https://static-cdn.jtvnw.net/previews-ttv/live_user_${encodeURIComponent(login)}-${width}x${height}.jpg`;
}

// ─── Settings ─────────────────────────────────────────────────────────────

export type MentionType = 'none' | 'everyone' | 'here' | 'role';
export const MENTION_TYPES: readonly MentionType[] = ['none', 'everyone', 'here', 'role'];

export interface MentionSetting {
  type: MentionType;
  roleId?: string | null;
}

export const MESSAGE_TEMPLATE_MAX = 300;

export interface IntegrationConfig {
  enabled: boolean;
  channelInput: string;
  notifyChannelId: string | null;
  mention: MentionSetting;
  template: string;
}

/** Settings keys of one integration inside `settings.integrations`. */
export function integrationKeys(kind: IntegrationKind) {
  return {
    enabled: kind,
    channel: `${kind}Channel`,
    notifyChannel: `${kind}NotificationChannelId`,
    mention: `${kind}Mention`,
    mentionRoleId: `${kind}MentionRoleId`,
    message: `${kind}Message`,
  } as const;
}

export function normalizeMention(type: unknown, roleId: unknown): MentionSetting {
  const t = MENTION_TYPES.includes(type as MentionType) ? (type as MentionType) : 'none';
  if (t !== 'role') return { type: t };
  const id = typeof roleId === 'string' ? roleId.trim() : '';
  return id ? { type: 'role', roleId: id } : { type: 'none' };
}

/** One integration's config from `settings.integrations` (missing keys → defaults). */
export function readIntegrationConfig(integrations: unknown, kind: IntegrationKind): IntegrationConfig {
  const src = (integrations && typeof integrations === 'object' ? integrations : {}) as Record<string, unknown>;
  const keys = integrationKeys(kind);
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    enabled: src[keys.enabled] === true,
    channelInput: decodeBasicEntities(str(src[keys.channel])).trim(),
    notifyChannelId: str(src[keys.notifyChannel]).trim() || null,
    mention: normalizeMention(src[keys.mention], src[keys.mentionRoleId]),
    template: decodeBasicEntities(str(src[keys.message])).trim().slice(0, MESSAGE_TEMPLATE_MAX),
  };
}

// ─── Message builder ──────────────────────────────────────────────────────

export interface IntegrationItem {
  kind: IntegrationKind;
  /** video / short (YouTube), live / vod (Twitch), sample (no API access). */
  type: 'video' | 'short' | 'live' | 'vod' | 'sample';
  id: string;
  title: string;
  url: string;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  channelName: string;
  channelUrl: string;
  channelAvatarUrl: string | null;
  game?: string | null;
  viewerCount?: number | null;
}

export const YOUTUBE_COLOR = 0xff0000;
export const TWITCH_COLOR = 0x9146ff;

export function defaultTemplate(item: Pick<IntegrationItem, 'kind' | 'type'>): string {
  if (item.kind === 'youtube') return item.type === 'short' ? '**{channel}** just posted a new Short!' : '**{channel}** just uploaded a new video!';
  return item.type === 'vod' ? '**{channel}** streamed on Twitch: **{title}**' : '**{channel}** is now live on Twitch!';
}

/**
 * Stop text we didn't choose from pinging anyone: @everyone / @here and
 * `<@...>` / `<@&...>` tokens in templates, video titles or channel names.
 */
export function neutralizeMentions(text: string): string {
  return text
    .replace(/@(everyone|here)\b/gi, '@​$1')
    .replace(/<@/g, '<​@');
}

/** The mention token for a setting ('' for none). */
export function mentionToken(mention: MentionSetting): string {
  switch (mention.type) {
    case 'everyone': return '@everyone';
    case 'here': return '@here';
    case 'role': return mention.roleId ? `<@&${mention.roleId}>` : '';
    default: return '';
  }
}

export function renderTemplate(template: string, item: IntegrationItem): string {
  const vars: Record<string, string> = {
    channel: item.channelName,
    title: item.title,
    url: item.url,
    game: item.game ?? '',
  };
  return template.replace(/\{(channel|title|url|game)\}/g, (_, key: string) => vars[key] ?? '');
}

export interface NotificationContent {
  content: string;
  mentionEveryone: boolean;
  mentionedRoleIds: string[];
}

/**
 * The text line of a notification: the chosen ping first (the only mention
 * that pings), then the template with {channel} / {title} / {url} / {game}.
 */
export function buildNotificationContent(opts: { item: IntegrationItem; mention: MentionSetting; template?: string | null }): NotificationContent {
  const template = (opts.template ?? '').trim().slice(0, MESSAGE_TEMPLATE_MAX) || defaultTemplate(opts.item);
  const text = neutralizeMentions(renderTemplate(template, opts.item)).trim();
  const ping = mentionToken(opts.mention);
  const content = [ping, text].filter(Boolean).join(' ').slice(0, 2000);
  return {
    content,
    mentionEveryone: opts.mention.type === 'everyone' || opts.mention.type === 'here',
    mentionedRoleIds: opts.mention.type === 'role' && opts.mention.roleId ? [opts.mention.roleId] : [],
  };
}

export interface NotificationEmbed {
  type: 'rich';
  title?: string;
  url?: string;
  description?: string;
  color: number;
  author?: { name: string; url?: string; icon_url?: string };
  image?: { url: string };
  fields?: Array<{ name: string; value: string; inline: boolean }>;
  timestamp?: string;
  footer: { text: string };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Embed + link button for an item. `test` marks it as a test notification. */
export function buildNotificationEmbed(item: IntegrationItem, opts: { test?: boolean; sampleNote?: string } = {}): {
  embed: NotificationEmbed;
  components: Array<{ type: 1; components: Array<{ type: 2; style: 5; label: string; url: string }> }>;
} {
  const brand = item.kind === 'youtube' ? 'YouTube' : 'Twitch';
  const footer = opts.test ? `${brand} · Test notification` : brand;
  const embed: NotificationEmbed = {
    type: 'rich',
    color: item.kind === 'youtube' ? YOUTUBE_COLOR : TWITCH_COLOR,
    title: clip(item.title || (item.kind === 'youtube' ? 'New video' : 'Live on Twitch'), 256),
    url: item.url,
    author: {
      name: clip(item.channelName || brand, 256),
      url: item.channelUrl,
      ...(item.channelAvatarUrl ? { icon_url: item.channelAvatarUrl } : {}),
    },
    ...(item.thumbnailUrl ? { image: { url: item.thumbnailUrl } } : {}),
    ...(item.publishedAt ? { timestamp: item.publishedAt } : {}),
    footer: { text: footer },
  };
  const fields: Array<{ name: string; value: string; inline: boolean }> = [];
  if (item.game) fields.push({ name: 'Game', value: clip(item.game, 1024), inline: true });
  if (item.type === 'live' && typeof item.viewerCount === 'number') fields.push({ name: 'Viewers', value: item.viewerCount.toLocaleString('en-US'), inline: true });
  if (fields.length) embed.fields = fields;
  if (opts.sampleNote) embed.description = clip(opts.sampleNote, 4096);
  const label = item.kind === 'twitch' && (item.type === 'live' || item.type === 'sample') ? 'Watch stream' : 'Watch';
  return {
    embed,
    components: [{ type: 1, components: [{ type: 2, style: 5, label, url: item.url }] }],
  };
}

// ─── Poller decisions ─────────────────────────────────────────────────────

export interface YouTubeSeenState {
  /** Which channel this state belongs to (a changed channel re-baselines). */
  channel: string;
  lastVideoId: string | null;
  lastPublishedAt: string | null;
}

/**
 * Which feed entries to announce since `state` (oldest first, at most `max`).
 * No state yet (or another channel) → nothing: the first look only records a
 * baseline, so enabling an integration never posts old uploads.
 */
export function newYouTubeEntries(entries: YouTubeFeedEntry[], state: YouTubeSeenState | null, channel: string, max = 3): YouTubeFeedEntry[] {
  if (!state || state.channel !== channel) return [];
  const since = state.lastPublishedAt ? Date.parse(state.lastPublishedAt) : NaN;
  const out: YouTubeFeedEntry[] = [];
  for (const e of entries) {
    if (e.videoId === state.lastVideoId) break;
    const t = e.publishedAt ? Date.parse(e.publishedAt) : NaN;
    if (Number.isFinite(since) && Number.isFinite(t) && t <= since) continue;
    out.push(e);
  }
  return out.slice(0, max).reverse();
}

export interface TwitchSeenState {
  channel: string;
  lastStreamId: string | null;
  notifiedAt: string | null;
}

/** Re-announcing the same channel within this window is skipped (stream restarts). */
export const TWITCH_RENOTIFY_COOLDOWN_MS = 30 * 60_000;

/** Whether a live stream should be announced given the stored state. */
export function shouldAnnounceTwitch(streamId: string, state: TwitchSeenState | null, channel: string, now = Date.now()): boolean {
  if (!state || state.channel !== channel) return false;
  if (state.lastStreamId === streamId) return false;
  const last = state.notifiedAt ? Date.parse(state.notifiedAt) : NaN;
  return !(Number.isFinite(last) && now - last < TWITCH_RENOTIFY_COOLDOWN_MS);
}
