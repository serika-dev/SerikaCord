/**
 * Allowlist for twitter:player iframe URLs shown in link previews.
 *
 * Deliberately separate from the oEmbed scrape whitelist: that one contains
 * user-content hosts (netlify.app, itch.io, github/gitlab subdomains, ...)
 * where anyone can publish a page with an arbitrary player URL. Only known
 * embed-player hosts may end up inside an iframe in chat.
 */
const PLAYER_HOST_SUFFIXES = [
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
