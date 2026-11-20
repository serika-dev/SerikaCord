/**
 * Allowlist for twitter:player iframe URLs shown in link previews.
 *
 * Deliberately separate from the oEmbed scrape whitelist: that one contains
 * user-content hosts (netlify.app, itch.io, github/gitlab subdomains, ...)
 * where anyone can publish a page with an arbitrary player URL. Only known
 * embed-player hosts may end up inside an iframe in chat.
 */
// next.config.ts builds the CSP frame-src from this list: keep it import-free.
export const PLAYER_HOST_SUFFIXES = [
  'open.spotify.com',
  'w.soundcloud.com',
  'bandcamp.com',
  'player.vimeo.com',
  'youtube.com',
  'youtube-nocookie.com',
  'player.twitch.tv',
  'clips.twitch.tv',
  'dailymotion.com',
  'streamable.com',
  'giphy.com',
  'tenor.com',
  'embed.nicovideo.jp',
  'player.bilibili.com',
  'music.serika.dev',
  'serika.video',
];

/** True when `hostname` is (a subdomain of) a known embed-player host. */
export function isAllowedPlayerHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return PLAYER_HOST_SUFFIXES.some((d) => host === d || host.endsWith(`.${d}`));
}

/** Returns the player URL if it is https: on an allowed host, else undefined. */
export function sanitizePlayerUrl(player: string | undefined): string | undefined {
  if (!player) return undefined;
  try {
    const u = new URL(player);
    if (u.protocol !== 'https:') return undefined;
    if (u.username || u.password) return undefined;
    return isAllowedPlayerHost(u.hostname) ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * True when `url` points at an actual video file a <video> element can play:
 * an http(s) URL whose path ends in a video extension, or our own twimg media
 * proxy. Iframe player pages (youtube.com/embed/..., player.vimeo.com/...)
 * have no video extension, so they never count.
 */
export function isDirectVideoUrl(url: string | undefined): boolean {
  if (!url) return false;
  if (url.startsWith('/api/oembed/media?')) return true;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    return /\.(mp4|webm|mov|m4v)$/i.test(u.pathname);
  } catch {
    return false;
  }
}

/**
 * True when `url` is an HTML player page (YouTube in any form, or a page on a
 * known embed-player host) rather than a media file: never a <video> src.
 */
export function isPlayerPageUrl(url: string | undefined): boolean {
  if (!url || isDirectVideoUrl(url)) return false;
  if (parseYouTubeVideoId(url)) return true;
  try {
    const u = new URL(url);
    return isAllowedPlayerHost(u.hostname) || /(^|\.)(youtube\.com|youtu\.be)$/i.test(u.hostname);
  } catch {
    return false;
  }
}

const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/**
 * The 11-character video id of a YouTube link: youtube.com/watch?v=,
 * music.youtube.com/watch?v=, m.youtube.com, youtu.be/<id>, /shorts/<id>,
 * /live/<id>, /embed/<id> and youtube-nocookie.com/embed/<id>.
 */
export function parseYouTubeVideoId(url: string | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  const segs = u.pathname.split('/').filter(Boolean);
  let id: string | null | undefined;
  if (host === 'youtu.be' || host === 'www.youtu.be') {
    id = segs[0];
  } else if (
    host === 'youtube.com' || host.endsWith('.youtube.com') ||
    host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com')
  ) {
    if (segs[0] === 'watch') id = u.searchParams.get('v');
    else if (segs[0] === 'shorts' || segs[0] === 'live' || segs[0] === 'embed' || segs[0] === 'v') id = segs[1];
  }
  // /embed/videoseries?list=... is a playlist player, not a video id.
  return id && id !== 'videoseries' && YOUTUBE_ID_RE.test(id) ? id : null;
}

/**
 * Iframe src for an embed's video when it is a provider player rather than a
 * media file: YouTube links (from either the video or the page URL) become the
 * same youtube.com/embed player the native link preview uses; any other
 * player URL must be https: on an allowed player host (the CSP frame-src).
 */
export function embedPlayerSrc(videoUrl: string | undefined, pageUrl?: string): string | undefined {
  const ytId = parseYouTubeVideoId(videoUrl) || parseYouTubeVideoId(pageUrl);
  if (ytId) return `https://www.youtube.com/embed/${ytId}?autoplay=1`;
  return sanitizePlayerUrl(videoUrl);
}
