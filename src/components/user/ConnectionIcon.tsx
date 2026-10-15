import {
  SiLastdotfm,
  SiSpotify,
  SiYoutube,
  SiTwitch,
  SiSteam,
  SiPlaystation,
  SiBattledotnet,
  SiRoblox,
  SiGithub,
  SiX,
  SiInstagram,
  SiDiscord,
} from '@icons-pack/react-simple-icons';
import { useState, type CSSProperties } from 'react';
import { Globe } from 'lucide-react';
import { faviconPath } from '@/lib/connections/favicon';

type IconProps = { size?: number; className?: string; style?: CSSProperties };

// Serika's own icon ships with the app (public/icons/serika-moe.png): no
// third-party request per render, and nothing to fall back from. The old
// hot-linked serika.moe/favicon.ico replaced its parent's innerHTML on error,
// which React then tripped over.
const SerikaIcon: React.FC<IconProps> = ({ size = 16, className, style }) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img
    src="/icons/serika-moe.png"
    alt=""
    aria-hidden
    width={size}
    height={size}
    className={className}
    style={{ ...style, width: size, height: size, objectFit: 'cover', borderRadius: Math.max(2, Math.round(size / 5)), display: 'inline-block', flexShrink: 0 }}
  />
);

/**
 * A website connection's real favicon, fetched and cached by our server
 * (GET /api/favicons/:domain) so viewers never contact the site. Falls back to
 * the globe while it's missing or for unverified / invalid domains.
 */
export function WebsiteFavicon({ domain, size = 16, className, style }: IconProps & { domain: string | null | undefined }) {
  const src = faviconPath(domain);
  // Remember which URL failed (not a boolean) so a new domain gets a fresh try
  // without resetting state in an effect.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) {
    return <Globe size={size} className={className} style={{ color: getConnectionColor('website'), ...style }} aria-hidden />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      aria-hidden
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailedSrc(src)}
      className={className}
      style={{ ...style, width: size, height: size, objectFit: 'contain', display: 'inline-block', flexShrink: 0 }}
    />
  );
}

const ICON_MAP: Record<string, React.ComponentType<IconProps>> = {
  lastfm:    SiLastdotfm,
  spotify:   SiSpotify,
  youtube:   SiYoutube,
  twitch:    SiTwitch,
  steam:     SiSteam,
  xbox:      SiPlaystation, // no Xbox icon in simple-icons; reuse a gaming icon as fallback
  psn:       SiPlaystation,
  battlenet: SiBattledotnet,
  roblox:    SiRoblox,
  github:    SiGithub,
  twitter:   SiX,
  instagram: SiInstagram,
  discord:   SiDiscord,
  serika:    SerikaIcon,
  website:   Globe,
};

const COLOR_MAP: Record<string, string> = {
  lastfm:    '#e4335a',
  spotify:   '#1db954',
  youtube:   '#ff0000',
  twitch:    '#9146ff',
  steam:     '#4a90d9',
  xbox:      '#107c10',
  psn:       '#00439c',
  battlenet: '#148eff',
  roblox:    '#e8000b',
  github:    '#c9d1d9',
  twitter:   '#1d9bf0',
  instagram: '#e1306c',
  discord:   '#5865f2',
  serika:    '#8B5CF6',
  website:   '#8B5CF6',
};

const HREF_MAP: Record<string, (id: string) => string> = {
  lastfm:    (id) => `https://www.last.fm/user/${id}`,
  spotify:   (id) => `https://open.spotify.com/user/${id}`,
  youtube:   (id) => id.startsWith('http') ? id : `https://youtube.com/@${id}`,
  twitch:    (id) => `https://twitch.tv/${id}`,
  steam:     (id) => id.startsWith('http') ? id : `https://steamcommunity.com/id/${id}`,
  xbox:      (id) => `https://account.xbox.com/en-US/profile?gamertag=${encodeURIComponent(id)}`,
  psn:       (id) => `https://psnprofiles.com/${id}`,
  battlenet: () => `https://battle.net`,
  roblox:    (id) => `https://www.roblox.com/users/profile?username=${id}`,
  github:    (id) => `https://github.com/${id}`,
  twitter:   (id) => `https://x.com/${id}`,
  instagram: (id) => `https://instagram.com/${id}`,
  discord:   (id) => id ? `https://discord.com/users/${id}` : `https://discord.com`,
  serika:    (id) => `https://serika.moe/u/${encodeURIComponent(id)}`,
  website:   (id) => id.startsWith('http') ? id : `https://${id}`,
};

export function getConnectionIcon(provider: string) {
  return ICON_MAP[provider] ?? Globe;
}

export function getConnectionColor(provider: string) {
  return COLOR_MAP[provider] ?? '#8B5CF6';
}

export function getConnectionHref(provider: string, accountId: string) {
  return HREF_MAP[provider]?.(accountId) ?? '#';
}

/**
 * A connection's icon. Pass `accountId` for website connections to show the
 * site's favicon (the domain) instead of the generic globe.
 */
export function ConnectionIcon({
  provider,
  accountId,
  size = 16,
  className,
  style,
}: {
  provider: string;
  accountId?: string | null;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  if (provider === 'website' && accountId) {
    return <WebsiteFavicon domain={accountId} size={size} className={className} style={style} />;
  }
  const Icon = getConnectionIcon(provider);
  const color = getConnectionColor(provider);
  return <Icon size={size} className={className} style={{ color, ...style }} />;
}

export { ICON_MAP, COLOR_MAP, HREF_MAP };
