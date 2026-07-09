import { Elysia, t } from 'elysia';
import { getPlatformSettings } from '@/lib/models/PlatformSettings';

interface OEmbedResponse {
  title?: string;
  description?: string;
  thumbnail?: string;
  siteName?: string;
  url?: string;
  type?: string;
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

// Extract meta tags from HTML
function extractMetaTags(html: string): OEmbedResponse {
  const data: OEmbedResponse = {};
  
  // Open Graph tags
  const ogTitle = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
                  html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i)?.[1];
  const ogDesc = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
                 html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:description["']/i)?.[1];
  const ogImage = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
                  html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i)?.[1];
  const ogSiteName = html.match(/<meta[^>]*property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
                     html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:site_name["']/i)?.[1];
  
  // Twitter tags (fallback)
  const twitterTitle = html.match(/<meta[^>]*name=["']twitter:title["'][^>]*content=["']([^"']+)["']/i)?.[1];
  const twitterDesc = html.match(/<meta[^>]*name=["']twitter:description["'][^>]*content=["']([^"']+)["']/i)?.[1];
  const twitterImage = html.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i)?.[1];
  
  // Standard meta tags (fallback)
  const metaTitle = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
  const metaDesc = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)?.[1];
  
  data.title = ogTitle || twitterTitle || metaTitle;
  data.description = ogDesc || twitterDesc || metaDesc;
  data.thumbnail = ogImage || twitterImage;
  data.siteName = ogSiteName;
  
  // Decode HTML entities
  if (data.title) {
    data.title = data.title
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'");
  }
  if (data.description) {
    data.description = data.description
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'");
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
  });
