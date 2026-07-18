import { Elysia, t } from 'elysia';
import { getPlatformSettings } from '@/lib/models/PlatformSettings';

interface OEmbedResponse {
  title?: string;
  description?: string;
  thumbnail?: string;
  /** Thumbnail dimensions from og:image:width/height when present. */
  thumbnailWidth?: number;
  thumbnailHeight?: number;
  siteName?: string;
  url?: string;
  type?: string;
  /** Direct playable video URL (og:video / twitter:player:stream). */
  video?: string;
  videoWidth?: number;
  videoHeight?: number;
  /** Content author (used for tweets, articles, etc.). */
  author?: string;
  authorUrl?: string;
  /** Extra provider metadata (e.g. tweet engagement counts). */
  provider?: string;
}

const FIRST_PARTY_DOMAINS = [
  'serika.dev',
  'serika.chat',
  'serika.cc',
  'waifu.ws',
  'gifs.serika.dev',
  'accounts.serika.dev',
  'music.serika.dev',
  'cdn.ado.wtf',
];

function isFirstPartyDomain(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return FIRST_PARTY_DOMAINS.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function isDirectMediaUrl(url: string): boolean {
  return /\.(gif|jpg|jpeg|png|webp|svg|bmp|mp4|webm)(\?.*)?$/i.test(url);
}

function decodeEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => {
      try { return String.fromCodePoint(Number(n)); } catch { return _; }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      try { return String.fromCodePoint(parseInt(n, 16)); } catch { return _; }
    });
}

/**
 * Read a `<meta>` tag's content for a given `property`/`name` regardless of
 * attribute order (content-first or property-first). Returns undefined if absent.
 */
function metaContent(html: string, key: string, attr: 'property' | 'name' = 'property'): string | undefined {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const forward = new RegExp(`<meta[^>]*${attr}=["']${esc}["'][^>]*content=["']([^"']*)["']`, 'i');
  const reverse = new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*${attr}=["']${esc}["']`, 'i');
  const raw = html.match(forward)?.[1] ?? html.match(reverse)?.[1];
  return raw !== undefined ? decodeEntities(raw) : undefined;
}

function toInt(v?: string): number | undefined {
  if (!v) return undefined;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

// Extract Open Graph / Twitter Card / standard meta tags from HTML.
function extractMetaTags(html: string): OEmbedResponse {
  const data: OEmbedResponse = {};

  const ogTitle = metaContent(html, 'og:title');
  const ogDesc = metaContent(html, 'og:description');
  const ogImage = metaContent(html, 'og:image:secure_url') || metaContent(html, 'og:image:url') || metaContent(html, 'og:image');
  const ogSiteName = metaContent(html, 'og:site_name');
  const ogType = metaContent(html, 'og:type');
  const ogUrl = metaContent(html, 'og:url');

  // og:video (many sites expose an mp4 here). Prefer secure_url, then a
  // direct video URL, and only fall back to iframe player URLs last.
  const ogVideo = metaContent(html, 'og:video:secure_url') || metaContent(html, 'og:video:url') || metaContent(html, 'og:video');
  const ogVideoType = metaContent(html, 'og:video:type');
  const twitterStream = metaContent(html, 'twitter:player:stream', 'name');

  // Twitter Card tags (fallback / richer author info).
  const twitterTitle = metaContent(html, 'twitter:title', 'name');
  const twitterDesc = metaContent(html, 'twitter:description', 'name');
  const twitterImage = metaContent(html, 'twitter:image', 'name') || metaContent(html, 'twitter:image:src', 'name');
  const twitterCreator = metaContent(html, 'twitter:creator', 'name');

  // Standard meta tags (last resort).
  const metaTitle = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
  const metaDesc = metaContent(html, 'description', 'name');
  const articleAuthor = metaContent(html, 'article:author') || metaContent(html, 'author', 'name');

  data.title = ogTitle || twitterTitle || (metaTitle ? decodeEntities(metaTitle) : undefined);
  data.description = ogDesc || twitterDesc || metaDesc;
  data.thumbnail = ogImage || twitterImage;
  data.thumbnailWidth = toInt(metaContent(html, 'og:image:width'));
  data.thumbnailHeight = toInt(metaContent(html, 'og:image:height'));
  data.siteName = ogSiteName;
  data.type = ogType;
  data.url = ogUrl;
  data.author = articleAuthor || twitterCreator;

  // Only surface a playable video when it looks like a direct media file, not
  // an HTML iframe player (those are handled by dedicated provider embeds).
  const candidateVideo = twitterStream || ogVideo;
  const looksLikeFile = candidateVideo && (/\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(candidateVideo) || /video\/(mp4|webm)/i.test(ogVideoType || ''));
  if (looksLikeFile) {
    data.video = candidateVideo;
    data.videoWidth = toInt(metaContent(html, 'og:video:width'));
    data.videoHeight = toInt(metaContent(html, 'og:video:height'));
  }

  return data;
}

// Blocked domains (malware, adult content, etc.)
const BLOCKED_DOMAINS = [
  'grabify.link',
  'iplogger.org',
];

// Whitelist of domains allowed for oembed meta tag fetching.
// Domains not on this list will still be fetched but with stricter limits.
const OEMBED_WHITELIST = [
  'github.com',
  'gitlab.com',
  'stackoverflow.com',
  'reddit.com',
  'medium.com',
  'dev.to',
  'npmjs.com',
  'pypi.org',
  'crates.io',
  'wikipedia.org',
  'youtube.com',
  'youtu.be',
  'open.spotify.com',
  'soundcloud.com',
  'bandcamp.com',
  'twitch.tv',
  'vimeo.com',
  'dailymotion.com',
  'streamable.com',
  'giphy.com',
  'tenor.com',
  'klipy.com',
  'klipy.dev',
  'imgur.com',
  'gfycat.com',
  'x.com',
  'twitter.com',
  'fixvx.com',
  'fixupx.com',
  'vxtwitter.com',
  'fxtwitter.com',
  'twittpr.com',
  'bsky.app',
  'mastodon.social',
  'threads.net',
  'instagram.com',
  'tiktok.com',
  'linkedin.com',
  'facebook.com',
  'steamcommunity.com',
  'store.steampowered.com',
  'itch.io',
  'newgrounds.com',
  'apple.com',
  'developer.apple.com',
  'apps.apple.com',
  'play.google.com',
  'amazon.com',
  'ebay.com',
  'etsy.com',
  'walmart.com',
  'target.com',
  'bestbuy.com',
  'newegg.com',
  'bilibili.com',
  'nicovideo.jp',
  'nico.ms',
  'serika.video',
  'pixiv.net',
  'artstation.com',
  'behance.net',
  'dribbble.com',
  'figma.com',
  'dribbble.com',
  'notion.so',
  'linear.app',
  'vercel.com',
  'netlify.app',
  'cloudflare.com',
  'discord.com',
  'discord.gg',
  'serika.dev',
  'serika.chat',
  'serika.cc',
  'music.serika.dev',
  'waifu.ws',
];

function isBlockedDomain(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return BLOCKED_DOMAINS.some(blocked => hostname === blocked || hostname.endsWith(`.${blocked}`));
  } catch {
    return true;
  }
}

// Use the official YouTube oEmbed endpoint for YouTube / YouTube Music links.
// Regular HTML meta scraping returns a "browser not supported" description,
// while the provider oEmbed returns a clean title + thumbnail for playlists,
// albums and videos.
async function fetchYouTubeProviderOEmbed(url: string): Promise<OEmbedResponse | null> {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname !== 'youtube.com' &&
      hostname !== 'www.youtube.com' &&
      hostname !== 'youtu.be' &&
      hostname !== 'music.youtube.com' &&
      !hostname.endsWith('.youtube.com')
    ) {
      return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      }
    );
    clearTimeout(timeout);

    if (!response.ok) return null;
    const data = await response.json() as {
      title?: string;
      author_name?: string;
      provider_name?: string;
      thumbnail_url?: string;
      type?: string;
    };

    const isYouTubeMusic = hostname === 'music.youtube.com' || url.includes('music.youtube.com');
    return {
      url,
      title: data.title,
      description: isYouTubeMusic
        ? 'Listen on YouTube Music'
        : (data.author_name || data.provider_name || 'YouTube'),
      thumbnail: data.thumbnail_url,
      siteName: isYouTubeMusic ? 'YouTube Music' : (data.provider_name || 'YouTube'),
      type: data.type || 'video',
    };
  } catch {
    return null;
  }
}

// Use the official niconico oEmbed endpoint for reliable thumbnails.
// HTML meta scraping on nicovideo.jp often fails due to JS-rendered content.
async function fetchNiconicoProviderOEmbed(url: string): Promise<OEmbedResponse | null> {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname !== 'www.nicovideo.jp' &&
      hostname !== 'nicovideo.jp' &&
      hostname !== 'nico.ms'
    ) {
      return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(
      `https://www.nicovideo.jp/oembed?url=${encodeURIComponent(url)}`,
      {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      }
    );
    clearTimeout(timeout);

    if (!response.ok) return null;
    const data = await response.json() as {
      title?: string;
      author_name?: string;
      provider_name?: string;
      thumbnail_url?: string;
      type?: string;
    };

    return {
      url,
      title: data.title,
      description: data.author_name || 'niconico',
      thumbnail: data.thumbnail_url,
      siteName: 'niconico',
      type: data.type || 'video',
    };
  } catch {
    return null;
  }
}

// Fetch bilibili video info via their public API for reliable thumbnails.
// bilibili's OG image URLs (i1.hdslb.com) block external referrers, so we
// proxy the cover through our oEmbed endpoint and let the client use referrerPolicy.
async function fetchBilibiliProviderOEmbed(url: string): Promise<OEmbedResponse | null> {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname !== 'www.bilibili.com' &&
      hostname !== 'bilibili.com' &&
      hostname !== 'b23.tv'
    ) {
      return null;
    }

    // Extract BV id
    const bvMatch = url.match(/bilibili\.com\/video\/(BV[a-zA-Z0-9]+)/);
    const avMatch = url.match(/bilibili\.com\/video\/av(\d+)/);
    const bvid = bvMatch?.[1];
    const aid = avMatch?.[1];
    if (!bvid && !aid) return null;

    const apiUrl = bvid
      ? `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`
      : `https://api.bilibili.com/x/web-interface/view?aid=${aid}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(apiUrl, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'SerikaCord/1.0 (Link Preview Bot)',
      },
    });
    clearTimeout(timeout);

    if (!response.ok) return null;
    const data = await response.json() as {
      code?: number;
      data?: {
        title?: string;
        pic?: string;
        owner?: { name?: string };
      };
    };

    if (data.code !== 0 || !data.data) return null;

    return {
      url,
      title: data.data.title,
      description: data.data.owner?.name || 'bilibili',
      thumbnail: data.data.pic,
      siteName: 'bilibili',
      type: 'video',
    };
  } catch {
    return null;
  }
}

// Twitter / X links (and the fix* proxy domains) get a rich card with the
// actual media via the fxtwitter API — this reliably returns a direct mp4 for
// videos, all photos, the author, and engagement counts, none of which are
// available by scraping x.com (which is JS-rendered and blocks bots).
const TWITTER_HOSTS = new Set([
  'twitter.com', 'www.twitter.com', 'mobile.twitter.com',
  'x.com', 'www.x.com',
  'fixvx.com', 'www.fixvx.com',
  'fixupx.com', 'www.fixupx.com',
  'vxtwitter.com', 'www.vxtwitter.com',
  'fxtwitter.com', 'www.fxtwitter.com',
  'twittpr.com', 'www.twittpr.com',
]);

// twimg CDNs block browser requests (Sec-Fetch / TLS fingerprinting), so we
// stream their media through our own /oembed/media proxy — which fetches
// server-side where the request succeeds. Only these hosts may be proxied.
const MEDIA_PROXY_HOSTS = new Set([
  'video.twimg.com',
  'video-ft.twimg.com',
  'pbs.twimg.com',
  'pbs-ft.twimg.com',
  'ton.twimg.com',
]);

function isProxyableMediaHost(url: string): boolean {
  try {
    return MEDIA_PROXY_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Rewrite a hotlink-protected media URL to go through our media proxy. */
function proxyMediaUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  return isProxyableMediaHost(url) ? `/api/oembed/media?url=${encodeURIComponent(url)}` : url;
}

function parseTweetRef(url: string): { screenName: string; id: string } | null {
  // Matches /{user}/status/{id} and the fix* /i/status/{id} shorthand.
  const m = url.match(/(?:^|\/)([^/]+)\/status(?:es)?\/(\d+)/);
  if (m) return { screenName: m[1] === 'i' ? '_' : m[1], id: m[2] };
  const short = url.match(/\/i\/status\/(\d+)/);
  if (short) return { screenName: '_', id: short[1] };
  return null;
}

interface FxTweet {
  code?: number;
  tweet?: {
    url?: string;
    text?: string;
    created_at?: string;
    author?: { name?: string; screen_name?: string; avatar_url?: string; url?: string };
    replies?: number;
    retweets?: number;
    likes?: number;
    views?: number;
    media?: {
      videos?: { url?: string; thumbnail_url?: string; width?: number; height?: number; type?: string }[];
      photos?: { url?: string; width?: number; height?: number }[];
    };
  };
}

async function fetchTwitterProviderOEmbed(url: string): Promise<OEmbedResponse | null> {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!TWITTER_HOSTS.has(hostname)) return null;

  const ref = parseTweetRef(url);
  if (!ref) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const apiUrl = `https://api.fxtwitter.com/${encodeURIComponent(ref.screenName)}/status/${ref.id}`;
    const response = await fetch(apiUrl, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'SerikaCord/1.0 (Link Preview Bot)' },
    });
    clearTimeout(timeout);
    if (!response.ok) return null;

    const json = (await response.json()) as FxTweet;
    const tweet = json.tweet;
    if (!tweet) return null;

    const author = tweet.author;
    const displayName = author?.name || author?.screen_name || 'Twitter';
    const handle = author?.screen_name ? `@${author.screen_name}` : undefined;
    const video = tweet.media?.videos?.[0];
    const photo = tweet.media?.photos?.[0];

    // Compose engagement line for the provider/description area.
    const stats: string[] = [];
    if (typeof tweet.likes === 'number') stats.push(`❤️ ${tweet.likes.toLocaleString()}`);
    if (typeof tweet.retweets === 'number') stats.push(`🔁 ${tweet.retweets.toLocaleString()}`);
    if (typeof tweet.replies === 'number') stats.push(`💬 ${tweet.replies.toLocaleString()}`);

    return {
      url: tweet.url || url,
      title: handle ? `${displayName} (${handle})` : displayName,
      description: tweet.text || '',
      thumbnail: proxyMediaUrl(video?.thumbnail_url || photo?.url),
      thumbnailWidth: photo?.width,
      thumbnailHeight: photo?.height,
      siteName: hostname.includes('x.com') ? 'X' : 'Twitter',
      type: video ? 'video' : (photo ? 'image' : 'article'),
      video: proxyMediaUrl(video?.url),
      videoWidth: video?.width,
      videoHeight: video?.height,
      author: displayName,
      authorUrl: author?.url,
      provider: stats.length ? stats.join('   ') : undefined,
    };
  } catch {
    return null;
  }
}

// Combined whitelist: defaults + admin-configured custom domains
let cachedCustomWhitelist: string[] | null = null;
let cacheExpiry = 0;

async function getCustomWhitelist(): Promise<string[]> {
  if (cachedCustomWhitelist && Date.now() < cacheExpiry) return cachedCustomWhitelist;
  try {
    const settings = await getPlatformSettings();
    cachedCustomWhitelist = settings.oembedWhitelist || [];
    cacheExpiry = Date.now() + 60_000; // cache for 1 minute
    return cachedCustomWhitelist;
  } catch {
    return [];
  }
}

async function isWhitelistedDomainAsync(url: string): Promise<boolean> {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    const custom = await getCustomWhitelist();
    const all = [...OEMBED_WHITELIST, ...custom];
    return all.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

export const oembedRoutes = new Elysia({ prefix: '/oembed' })
  .get('/', async ({ query, set }) => {
    const url = query.url;
    
    if (!url) {
      set.status = 400;
      return { error: 'URL is required' };
    }
    
    // Validate URL
    try {
      new URL(url);
    } catch {
      set.status = 400;
      return { error: 'Invalid URL' };
    }
    
    // Check blocked domains
    if (isBlockedDomain(url)) {
      set.status = 403;
      return { error: 'Domain is blocked' };
    }

    // Skip first-party and direct-media URLs.
    // Link previews for these should be handled directly by the client renderer.
    if (isFirstPartyDomain(url) || isDirectMediaUrl(url)) {
      return {};
    }

    // Provider-specific oEmbed endpoints give much better previews than
    // scraping HTML meta tags (e.g. YouTube Music, niconico).
    const providerOEmbed = await fetchYouTubeProviderOEmbed(url);
    if (providerOEmbed) {
      return providerOEmbed;
    }

    const niconicoOEmbed = await fetchNiconicoProviderOEmbed(url);
    if (niconicoOEmbed) {
      return niconicoOEmbed;
    }

    const bilibiliOEmbed = await fetchBilibiliProviderOEmbed(url);
    if (bilibiliOEmbed) {
      return bilibiliOEmbed;
    }

    const twitterOEmbed = await fetchTwitterProviderOEmbed(url);
    if (twitterOEmbed) {
      return twitterOEmbed;
    }

    const whitelisted = await isWhitelistedDomainAsync(url);
    const fetchTimeout = whitelisted ? 5000 : 3000;
    const maxReadBytes = whitelisted ? 50 * 1024 : 20 * 1024;
    
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), fetchTimeout);
      
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'SerikaCord/1.0 (Link Preview Bot)',
          'Accept': 'text/html',
        },
        redirect: 'follow',
      });
      
      clearTimeout(timeout);
      
      if (!response.ok) {
        set.status = 404;
        return { error: 'Could not fetch URL' };
      }
      
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html')) {
        set.status = 400;
        return { error: 'URL does not return HTML' };
      }
      
      // Only read first 50KB to avoid memory issues
      const reader = response.body?.getReader();
      if (!reader) {
        set.status = 500;
        return { error: 'Could not read response' };
      }
      
      let html = '';
      const decoder = new TextDecoder();
      let bytesRead = 0;
      
      while (bytesRead < maxReadBytes) {
        const { done, value } = await reader.read();
        if (done) break;
        html += decoder.decode(value, { stream: true });
        bytesRead += value.length;
      }
      
      reader.cancel();
      
      const data = extractMetaTags(html);
      data.url = url;
      
      return data;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        set.status = 408;
        return { error: 'Request timeout' };
      }
      
      console.error('OEmbed fetch error:', error);
      set.status = 500;
      return { error: 'Failed to fetch URL' };
    }
  }, {
    query: t.Object({
      url: t.String(),
    }),
  })
  // Media proxy for hotlink-protected CDNs (twimg). Streams the upstream
  // response server-side, forwarding Range requests so video seeking works.
  .get('/media', async ({ query, set, request }) => {
    const url = query.url;
    if (!url || !isProxyableMediaHost(url)) {
      set.status = 400;
      return { error: 'Unsupported media host' };
    }

    try {
      const upstreamHeaders: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (compatible; SerikaCord/1.0)',
        Accept: '*/*',
      };
      const range = request.headers.get('range');
      if (range) upstreamHeaders.Range = range;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      const upstream = await fetch(url, { headers: upstreamHeaders, signal: controller.signal, redirect: 'follow' });
      clearTimeout(timeout);

      if (!upstream.ok && upstream.status !== 206) {
        set.status = 502;
        return { error: 'Upstream fetch failed' };
      }

      const headers = new Headers();
      const passthrough = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'];
      for (const h of passthrough) {
        const v = upstream.headers.get(h);
        if (v) headers.set(h, v);
      }
      if (!headers.has('accept-ranges')) headers.set('accept-ranges', 'bytes');
      headers.set('cache-control', 'public, max-age=86400');
      headers.set('access-control-allow-origin', '*');

      return new Response(upstream.body, { status: upstream.status, headers });
    } catch {
      set.status = 502;
      return { error: 'Media proxy error' };
    }
  }, {
    query: t.Object({
      url: t.String(),
    }),
  });
