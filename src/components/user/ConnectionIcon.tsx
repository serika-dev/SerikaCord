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
import { Globe } from 'lucide-react';

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>> = {
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
  discord:   () => `https://discord.com`,
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

export function ConnectionIcon({
  provider,
  size = 16,
  className,
  style,
}: {
  provider: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const Icon = getConnectionIcon(provider);
  const color = getConnectionColor(provider);
  return <Icon size={size} className={className} style={{ color, ...style }} />;
}

export { ICON_MAP, COLOR_MAP, HREF_MAP };
