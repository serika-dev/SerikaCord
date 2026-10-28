/**
 * Fetches the real latest item for the YouTube / Twitch server integrations.
 *
 * - YouTube: the channel input resolves to a channel id (a channel page read
 *   for @handles and legacy names, cached a day), then the public Atom feed
 *   (no API key) gives the latest uploads.
 * - Twitch: Helix with the app's client credentials (TWITCH_CLIENT_ID /
 *   TWITCH_CLIENT_SECRET, the same ones IGDB uses): the live stream when live,
 *   otherwise the latest broadcast. Without credentials only a clearly
 *   labelled sample is possible.
 *
 * Every request goes through safeFetch (public addresses only, every redirect
 * re-checked) with a strict host allowlist, a timeout and a body size cap.
 * Results are cached in Redis for a few minutes per channel.
 */
import { cache } from '@/lib/db';
import { config } from '@/lib/config';
import { safeFetch } from '@/lib/security/ssrf';
import {
  extractYouTubeChannelFromHtml,
  parseTwitchLogin,
  parseYouTubeChannelInput,
  parseYouTubeFeed,
  twitchPreviewUrl,
  twitchThumbnailUrl,
  youTubeChannelPageUrl,
  youTubeRefKey,
  type IntegrationItem,
  type YouTubeFeed,
} from './notifications';

const FETCH_TIMEOUT_MS = 8000;
const MAX_FEED_BYTES = 1_000_000;
const MAX_PAGE_BYTES = 3_000_000;
const FEED_CACHE_SECONDS = 300;
const CHANNEL_ID_CACHE_SECONDS = 24 * 3600;
const TWITCH_CACHE_SECONDS = 120;

const YOUTUBE_HOSTS = new Set(['www.youtube.com', 'youtube.com', 'm.youtube.com']);
const TWITCH_HOSTS = new Set(['api.twitch.tv', 'id.twitch.tv']);

export class IntegrationSourceError extends Error {
  constructor(public code: 'invalid_channel' | 'not_found' | 'unavailable', message: string) {
    super(message);
    this.name = 'IntegrationSourceError';
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      // Keep what fits: the parts we read (meta tags, first entries) come first.
      chunks.push(value.subarray(0, Math.max(0, value.byteLength - (total - maxBytes))));
      try { await reader.cancel(); } catch { /* ignore */ }
      break;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

async function fetchText(url: string, hosts: Set<string>, maxBytes: number, headers: Record<string, string> = {}): Promise<{ status: number; text: string }> {
  const res = await safeFetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SerikaCord/1.0; +https://serika.chat)', 'Accept-Language': 'en', ...headers },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  }, { allowHost: (h) => hosts.has(h), maxRedirects: 3 });
  if (!res.ok) {
    try { await res.body?.cancel(); } catch { /* ignore */ }
    return { status: res.status, text: '' };
  }
  return { status: res.status, text: await readCapped(res, maxBytes) };
}

// ─── YouTube ──────────────────────────────────────────────────────────────

interface ResolvedYouTubeChannel {
  channelId: string;
  name: string | null;
  avatarUrl: string | null;
}

/** A YouTube channel input → channel id (+ name / avatar when a page was read). */
export async function resolveYouTubeChannel(input: string): Promise<ResolvedYouTubeChannel> {
  const ref = parseYouTubeChannelInput(input);
  if (!ref) throw new IntegrationSourceError('invalid_channel', 'Enter a YouTube channel URL, @handle or channel ID');
  const key = `integrations:yt:channel:${youTubeRefKey(ref)}`;
  const cached = await cache.get<ResolvedYouTubeChannel>(key);
  if (cached?.channelId) return cached;
  // Channel ids work without a page read; the page only adds the avatar.
  let resolved: ResolvedYouTubeChannel | null = ref.kind === 'id' ? { channelId: ref.id, name: null, avatarUrl: null } : null;
  try {
    // The consent cookie skips the EU consent interstitial (consent.youtube.com).
    const page = await fetchText(youTubeChannelPageUrl(ref), YOUTUBE_HOSTS, MAX_PAGE_BYTES, { Cookie: 'CONSENT=YES+cb; SOCS=CAI' });
    if (page.status === 404 && !resolved) throw new IntegrationSourceError('not_found', 'That YouTube channel was not found');
    const info = extractYouTubeChannelFromHtml(page.text);
    if (info && (!resolved || info.channelId === resolved.channelId)) resolved = info;
  } catch (err) {
    if (err instanceof IntegrationSourceError) throw err;
    if (!resolved) throw new IntegrationSourceError('unavailable', 'YouTube could not be reached. Try again in a moment.');
  }
  if (!resolved) throw new IntegrationSourceError('not_found', 'That YouTube channel was not found');
  await cache.set(key, resolved, CHANNEL_ID_CACHE_SECONDS);
  return resolved;
}

/** The channel's public upload feed (cached 5 minutes). */
export async function fetchYouTubeFeed(channelId: string, opts: { fresh?: boolean } = {}): Promise<YouTubeFeed> {
  const key = `integrations:yt:feed:${channelId}`;
  if (!opts.fresh) {
    const cached = await cache.get<YouTubeFeed>(key);
    if (cached) return cached;
  }
  let res: { status: number; text: string };
  try {
    res = await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`, YOUTUBE_HOSTS, MAX_FEED_BYTES);
  } catch {
    throw new IntegrationSourceError('unavailable', 'YouTube could not be reached. Try again in a moment.');
  }
  if (res.status === 404) throw new IntegrationSourceError('not_found', 'That YouTube channel was not found');
  if (res.status !== 200) throw new IntegrationSourceError('unavailable', 'YouTube could not be reached. Try again in a moment.');
  const feed = parseYouTubeFeed(res.text);
  await cache.set(key, feed, FEED_CACHE_SECONDS);
  return feed;
}

/** Latest upload of a YouTube channel as a notification item. */
export async function fetchLatestYouTubeItem(input: string, opts: { fresh?: boolean } = {}): Promise<{ item: IntegrationItem; feed: YouTubeFeed; channelId: string; channel: ResolvedYouTubeChannel }> {
  const channel = await resolveYouTubeChannel(input);
  const feed = await fetchYouTubeFeed(channel.channelId, opts);
  const latest = feed.entries[0];
  if (!latest) throw new IntegrationSourceError('not_found', 'This channel has no public videos yet');
  return { item: youTubeItem(latest, feed, channel), feed, channelId: channel.channelId, channel };
}

export function youTubeItem(entry: YouTubeFeed['entries'][number], feed: YouTubeFeed, channel: ResolvedYouTubeChannel): IntegrationItem {
  return {
    kind: 'youtube',
    type: entry.isShort ? 'short' : 'video',
    id: entry.videoId,
    title: entry.title,
    url: entry.url,
    thumbnailUrl: entry.thumbnailUrl,
    publishedAt: entry.publishedAt,
    channelName: feed.channelName || channel.name || 'YouTube',
    channelUrl: `https://www.youtube.com/channel/${channel.channelId}`,
    channelAvatarUrl: channel.avatarUrl,
  };
}

// ─── Twitch ───────────────────────────────────────────────────────────────

export function twitchApiConfigured(): boolean {
  return Boolean(config.TWITCH_CLIENT_ID && config.TWITCH_CLIENT_SECRET);
}

async function helix<T>(path: string, retried = false): Promise<T> {
  const { getTwitchAppToken, invalidateTwitchAppToken } = await import('@/lib/services/igdbService');
  const token = await getTwitchAppToken();
  if (!token) throw new IntegrationSourceError('unavailable', 'Twitch could not be reached. Try again in a moment.');
  let res: Response;
  try {
    res = await safeFetch(`https://api.twitch.tv/helix/${path}`, {
      headers: { 'Client-Id': config.TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }, { allowHost: (h) => TWITCH_HOSTS.has(h), maxRedirects: 0 });
  } catch {
    throw new IntegrationSourceError('unavailable', 'Twitch could not be reached. Try again in a moment.');
  }
  if (res.status === 401 && !retried) {
    try { await res.body?.cancel(); } catch { /* ignore */ }
    invalidateTwitchAppToken();
    return helix<T>(path, true);
  }
  if (!res.ok) {
    try { await res.body?.cancel(); } catch { /* ignore */ }
    throw new IntegrationSourceError('unavailable', 'Twitch could not be reached. Try again in a moment.');
  }
  return JSON.parse(await readCapped(res, MAX_FEED_BYTES)) as T;
}

interface HelixUser { id: string; login: string; display_name: string; profile_image_url?: string }
export interface HelixStream { id: string; user_id: string; user_login: string; user_name: string; game_name?: string; title?: string; viewer_count?: number; started_at?: string; thumbnail_url?: string; type?: string }
interface HelixVideo { id: string; title?: string; url?: string; thumbnail_url?: string; created_at?: string; published_at?: string }

/** Twitch users by login (cached a few minutes each). */
export async function fetchTwitchUsers(logins: string[]): Promise<Map<string, HelixUser>> {
  const out = new Map<string, HelixUser>();
  const missing: string[] = [];
  for (const login of logins) {
    const hit = await cache.get<HelixUser>(`integrations:tw:user:${login}`);
    if (hit) out.set(login, hit);
    else missing.push(login);
  }
  for (let i = 0; i < missing.length; i += 100) {
    const batch = missing.slice(i, i + 100);
    const data = await helix<{ data?: HelixUser[] }>(`users?${batch.map((l) => `login=${encodeURIComponent(l)}`).join('&')}`);
    for (const u of data.data ?? []) {
      const login = u.login.toLowerCase();
      out.set(login, u);
      await cache.set(`integrations:tw:user:${login}`, u, 3600);
    }
  }
  return out;
}

/** Live streams for up to 100 logins per request (the poller batches these). */
export async function fetchTwitchStreams(logins: string[]): Promise<Map<string, HelixStream>> {
  const out = new Map<string, HelixStream>();
  for (let i = 0; i < logins.length; i += 100) {
    const batch = logins.slice(i, i + 100);
    const data = await helix<{ data?: HelixStream[] }>(`streams?first=100&${batch.map((l) => `user_login=${encodeURIComponent(l)}`).join('&')}`);
    for (const s of data.data ?? []) {
      if (s.type && s.type !== 'live') continue;
      out.set(s.user_login.toLowerCase(), s);
    }
  }
  return out;
}

export function twitchLiveItem(stream: HelixStream, user: HelixUser | undefined): IntegrationItem {
  const login = stream.user_login.toLowerCase();
  const thumb = twitchThumbnailUrl(stream.thumbnail_url);
  return {
    kind: 'twitch',
    type: 'live',
    id: stream.id,
    title: stream.title || 'Live on Twitch',
    url: `https://www.twitch.tv/${login}`,
    // Twitch caches previews; the timestamp keeps clients from showing an old frame.
    thumbnailUrl: thumb ? `${thumb}?t=${Math.floor(Date.now() / 60_000)}` : null,
    publishedAt: stream.started_at ?? null,
    channelName: stream.user_name || user?.display_name || login,
    channelUrl: `https://www.twitch.tv/${login}`,
    channelAvatarUrl: user?.profile_image_url || null,
    game: stream.game_name || null,
    viewerCount: typeof stream.viewer_count === 'number' ? stream.viewer_count : null,
  };
}

export interface TwitchLatest {
  item: IntegrationItem;
  /** live: streaming now; vod: offline, latest broadcast; offline: no broadcasts; sample: no API access. */
  source: 'live' | 'vod' | 'offline' | 'sample';
}

/** The live stream, else the latest broadcast, else a labelled sample (no credentials). */
export async function fetchLatestTwitchItem(input: string): Promise<TwitchLatest> {
  const login = parseTwitchLogin(input);
  if (!login) throw new IntegrationSourceError('invalid_channel', 'Enter a Twitch channel name or twitch.tv link');
  if (!twitchApiConfigured()) {
    return {
      source: 'sample',
      item: {
        kind: 'twitch',
        type: 'sample',
        id: `sample:${login}`,
        title: 'Sample stream title',
        url: `https://www.twitch.tv/${login}`,
        thumbnailUrl: twitchPreviewUrl(login),
        publishedAt: new Date().toISOString(),
        channelName: login,
        channelUrl: `https://www.twitch.tv/${login}`,
        channelAvatarUrl: null,
        game: null,
      },
    };
  }
  const key = `integrations:tw:latest:${login}`;
  const cached = await cache.get<TwitchLatest>(key);
  if (cached) return cached;
  const users = await fetchTwitchUsers([login]);
  const user = users.get(login);
  if (!user) throw new IntegrationSourceError('not_found', 'That Twitch channel was not found');
  const streams = await fetchTwitchStreams([login]);
  const stream = streams.get(login);
  let result: TwitchLatest;
  if (stream) {
    result = { source: 'live', item: twitchLiveItem(stream, user) };
  } else {
    let videos = await helix<{ data?: HelixVideo[] }>(`videos?user_id=${encodeURIComponent(user.id)}&type=archive&first=1`);
    if (!videos.data?.length) videos = await helix<{ data?: HelixVideo[] }>(`videos?user_id=${encodeURIComponent(user.id)}&first=1`);
    const video = videos.data?.[0];
    const channelUrl = `https://www.twitch.tv/${login}`;
    result = {
      source: video ? 'vod' : 'offline',
      item: {
        kind: 'twitch',
        type: video ? 'vod' : 'sample',
        id: video?.id ?? `offline:${login}`,
        title: video?.title || 'Sample stream title',
        url: video?.url && /^https:\/\/www\.twitch\.tv\//.test(video.url) ? video.url : channelUrl,
        thumbnailUrl: twitchThumbnailUrl(video?.thumbnail_url) ?? twitchPreviewUrl(login),
        publishedAt: video?.published_at || video?.created_at || null,
        channelName: user.display_name || login,
        channelUrl,
        channelAvatarUrl: user.profile_image_url || null,
        game: null,
      },
    };
  }
  await cache.set(key, result, TWITCH_CACHE_SECONDS);
  return result;
}
