import { Elysia, t } from 'elysia';

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
  'serikacord.com',
  'serika.chat',
  'serika.cc',
  'waifu.ws',
  'gifs.serika.dev',
  'accounts.serika.dev',
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

function isBlockedDomain(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return BLOCKED_DOMAINS.some(blocked => hostname === blocked || hostname.endsWith(`.${blocked}`));
  } catch {
    return true;
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
    
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      
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
      const maxBytes = 50 * 1024;
      
      while (bytesRead < maxBytes) {
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
