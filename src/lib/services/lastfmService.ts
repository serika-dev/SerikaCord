/**
 * Last.fm "now scrobbling" fetcher.
 *
 * Last.fm has a public API endpoint (user.getRecentTracks) that requires
 * only an API key (no user auth) — perfect for showing "Currently Listening"
 * on profile cards from a manually-linked Last.fm username.
 *
 * Results are cached per-username for CACHE_TTL_MS to keep load low even when
 * many profile cards are open at once.
 */

import { config } from '../config';

export interface LastFmTrack {
  name: string;
  artist: string;
  album: string | null;
  albumArt: string | null;
  url: string;
  nowPlaying: boolean;
}

interface CacheEntry {
  value: LastFmTrack | null;
  expiresAt: number;
}

const CACHE_TTL_MS = 30_000;
const REQUEST_TIMEOUT_MS = 5_000;
const cache = new Map<string, CacheEntry>();

export async function getLastFmNowPlaying(username: string): Promise<LastFmTrack | null> {
  const apiKey = config.LASTFM_API_KEY;
  if (!username || !apiKey) return null;

  const key = username.toLowerCase();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const url = `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${encodeURIComponent(username)}&api_key=${apiKey}&format=json&limit=1`;
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });

    if (!res.ok) {
      cache.set(key, { value: null, expiresAt: Date.now() + CACHE_TTL_MS });
      return null;
    }

    const data = await res.json() as Record<string, unknown>;
    const tracks = (data as any)?.recenttracks?.track;
    if (!tracks) {
      cache.set(key, { value: null, expiresAt: Date.now() + CACHE_TTL_MS });
      return null;
    }

    const track = Array.isArray(tracks) ? tracks[0] : tracks;
    if (!track) {
      cache.set(key, { value: null, expiresAt: Date.now() + CACHE_TTL_MS });
      return null;
    }

    const isNowPlaying = track['@attr']?.nowplaying === 'true';

    // Only return if actually scrobbling right now
    if (!isNowPlaying) {
      cache.set(key, { value: null, expiresAt: Date.now() + CACHE_TTL_MS });
      return null;
    }

    const images: Array<{ '#text': string; size: string }> = track.image || [];
    const albumArt = images.find(img => img.size === 'extralarge')?.['#text']
      || images.find(img => img.size === 'large')?.['#text']
      || null;

    const value: LastFmTrack = {
      name: track.name || 'Unknown Track',
      artist: track.artist?.['#text'] || track.artist?.name || 'Unknown Artist',
      album: track.album?.['#text'] || null,
      albumArt: albumArt || null,
      url: track.url || `https://www.last.fm/user/${username}`,
      nowPlaying: true,
    };

    cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  } catch {
    cache.set(key, { value: null, expiresAt: Date.now() + CACHE_TTL_MS });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
