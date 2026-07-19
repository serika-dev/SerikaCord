/**
 * Last.fm "now scrobbling" fetcher.
 *
 * Last.fm has a public API endpoint (user.getRecentTracks) that requires
 * only an API key (no user auth) — perfect for showing "Currently Listening"
 * on profile cards from a manually-linked Last.fm username.
 *
 * Album cover art prefers Last.fm's own image URLs. When Last.fm returns no
 * art (or only its grey placeholder star), we try track.getInfo (which often
 * has art that getrecenttracks lacks), then fall back to the Cover Art
 * Archive (https://coverartarchive.org): first via any MusicBrainz MBID
 * Last.fm supplied, then by resolving the release-group MBID from the artist +
 * album name through the MusicBrainz search API.
 *
 * Results are cached per-username for CACHE_TTL_MS to keep load low even when
 * many profile cards are open at once.
 */

import { config } from '../config';
import { BoundedMap } from '../utils/boundedMap';

// Last.fm serves this exact image hash as its "no cover art" placeholder.
const LASTFM_PLACEHOLDER_HASH = '2a96cbd8b46e442fc41c2b86b821562f';
// Identify ourselves to MusicBrainz per their API etiquette requirements.
const MUSICBRAINZ_UA = 'SerikaCord/1.0 (https://serika.chat)';

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
  refreshing: boolean;
}

const CACHE_TTL_MS = 30_000;
const REQUEST_TIMEOUT_MS = 5_000;
const COVER_ART_TIMEOUT_MS = 6_000;
const cache = new BoundedMap<string, CacheEntry>(2000);

/**
 * Fetch the front-cover thumbnail (500px) URL from the Cover Art Archive
 * for a given MusicBrainz release-group or release MBID.
 *
 * The Cover Art Archive responds with a 307 redirect to the actual image
 * on archive.org. We use `redirect: 'follow'` and read `res.url` (the final
 * URL after all redirects) to avoid the opaque-redirect issue that
 * `redirect: 'manual'` causes in Node.js (status 0, inaccessible headers).
 */
async function fetchCoverArtUrl(mbid: string, signal: AbortSignal): Promise<string | null> {
  // Try release-group first — Last.fm album MBIDs are typically release-group IDs.
  for (const kind of ['release-group', 'release'] as const) {
    try {
      const res = await fetch(
        `https://coverartarchive.org/${kind}/${mbid}/front-500`,
        { redirect: 'follow', signal, cache: 'no-store', headers: { 'User-Agent': MUSICBRAINZ_UA } },
      );
      if (res.ok && res.url) {
        try { await res.body?.cancel(); } catch {}
        const finalUrl = res.url;
        return finalUrl.startsWith('http://') ? 'https://' + finalUrl.slice(7) : finalUrl;
      }
      try { await res.body?.cancel(); } catch {}
    } catch {
      // try the next endpoint / give up
    }
  }
  return null;
}

/**
 * Resolve a MusicBrainz release-group MBID from an artist + album name via the
 * MusicBrainz search API — used when Last.fm didn't supply an mbid itself.
 */
async function lookupReleaseGroupMbid(artist: string, album: string, signal: AbortSignal): Promise<string | null> {
  try {
    const query = encodeURIComponent(`release:"${album}" AND artist:"${artist}"`);
    const res = await fetch(
      `https://musicbrainz.org/ws/2/release-group/?query=${query}&fmt=json&limit=1`,
      { signal, cache: 'no-store', headers: { 'User-Agent': MUSICBRAINZ_UA } },
    );
    if (!res.ok) return null;
    const data = await res.json() as { 'release-groups'?: Array<{ id?: string }> };
    return data['release-groups']?.[0]?.id || null;
  } catch {
    return null;
  }
}

/**
 * Fallback: search MusicBrainz for recordings by track name + artist name,
 * then extract a release MBID whose title matches the album.
 *
 * Uses an unqualified Lucene query (no field qualifiers) so that artist names
 * with extra suffixes (e.g. "大原ゆい子Official YouTube") still fuzzy-match
 * the canonical MusicBrainz artist ("大原ゆい子").
 */
async function lookupReleaseMbidByRecording(
  artist: string,
  trackName: string,
  album: string,
  signal: AbortSignal,
): Promise<{ releaseMbid: string; releaseGroupMbid: string } | null> {
  try {
    const query = encodeURIComponent(`"${trackName}" ${artist}`);
    const res = await fetch(
      `https://musicbrainz.org/ws/2/recording/?query=${query}&fmt=json&limit=5`,
      { signal, cache: 'no-store', headers: { 'User-Agent': MUSICBRAINZ_UA } },
    );
    if (!res.ok) return null;
    const data = await res.json() as {
      recordings?: Array<{
        releases?: Array<{
          id?: string;
          title?: string;
          'release-group'?: { id?: string };
        }>;
      }>;
    };
    for (const rec of data.recordings || []) {
      for (const rel of rec.releases || []) {
        if (rel.title === album && rel.id && rel['release-group']?.id) {
          return { releaseMbid: rel.id, releaseGroupMbid: rel['release-group'].id };
        }
      }
    }
    // No exact album match — take the first release from the first recording.
    const firstRec = data.recordings?.[0];
    const firstRel = firstRec?.releases?.[0];
    if (firstRel?.id && firstRel['release-group']?.id) {
      return { releaseMbid: firstRel.id, releaseGroupMbid: firstRel['release-group'].id };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch album art via Last.fm's track.getInfo API — often returns real art
 * even when user.getrecenttracks only had the placeholder.
 */
async function fetchTrackInfoImage(artist: string, trackName: string, signal: AbortSignal): Promise<string | null> {
  try {
    const apiKey = config.LASTFM_API_KEY;
    const url = `https://ws.audioscrobbler.com/2.0/?method=track.getInfo&artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(trackName)}&api_key=${apiKey}&format=json`;
    const res = await fetch(url, { signal, cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json() as Record<string, unknown>;
    const images = (data as any)?.track?.album?.image;
    if (!Array.isArray(images)) return null;
    return pickLastFmImage(images);
  } catch {
    return null;
  }
}

/** Best real Last.fm cover image, ignoring the grey placeholder star. */
function pickLastFmImage(images: Array<{ '#text': string; size: string }>): string | null {
  // Prefer larger sizes, but accept any non-placeholder image as fallback.
  const sizeOrder = ['extralarge', 'large', 'medium', 'small'];
  for (const size of sizeOrder) {
    const url = images.find(img => img.size === size)?.['#text'];
    if (url && !url.includes(LASTFM_PLACEHOLDER_HASH)) return url;
  }
  // Last resort: any non-placeholder image of any size.
  for (const img of images) {
    if (img['#text'] && !img['#text'].includes(LASTFM_PLACEHOLDER_HASH)) return img['#text'];
  }
  return null;
}

/**
 * Stale-while-revalidate wrapper: returns cached data immediately (even if
 * expired) and refreshes in the background. Only the very first fetch for a
 * new user blocks until the data arrives.
 */
export async function getLastFmNowPlaying(username: string): Promise<LastFmTrack | null> {
  const apiKey = config.LASTFM_API_KEY;
  if (!username || !apiKey) return null;

  const key = username.toLowerCase();
  const cached = cache.get(key);
  const now = Date.now();

  // Fresh cache — return immediately.
  if (cached && cached.expiresAt > now) return cached.value;

  // Stale cache — return immediately, refresh in the background.
  if (cached && !cached.refreshing) {
    cached.refreshing = true;
    void refreshCache(key, username).finally(() => {
      const entry = cache.get(key);
      if (entry) entry.refreshing = false;
    });
    return cached.value;
  }

  // No cache at all — must block on the first fetch.
  return refreshCache(key, username);
}

async function refreshCache(key: string, username: string): Promise<LastFmTrack | null> {
  const apiKey = config.LASTFM_API_KEY;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const url = `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${encodeURIComponent(username)}&api_key=${apiKey}&format=json&limit=1`;
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });

    if (!res.ok) {
      cache.set(key, { value: null, expiresAt: Date.now() + CACHE_TTL_MS, refreshing: false });
      return null;
    }

    const data = await res.json() as Record<string, unknown>;
    const tracks = (data as any)?.recenttracks?.track;
    if (!tracks) {
      cache.set(key, { value: null, expiresAt: Date.now() + CACHE_TTL_MS, refreshing: false });
      return null;
    }

    const track = Array.isArray(tracks) ? tracks[0] : tracks;
    if (!track) {
      cache.set(key, { value: null, expiresAt: Date.now() + CACHE_TTL_MS, refreshing: false });
      return null;
    }

    const isNowPlaying = track['@attr']?.nowplaying === 'true';

    // Only return if actually scrobbling right now
    if (!isNowPlaying) {
      cache.set(key, { value: null, expiresAt: Date.now() + CACHE_TTL_MS, refreshing: false });
      return null;
    }

    // Prefer Last.fm's own art from the recenttracks response.
    let albumArt: string | null = pickLastFmImage(track.image || []);

    if (!albumArt) {
      const coverController = new AbortController();
      const coverTimeout = setTimeout(() => coverController.abort(), COVER_ART_TIMEOUT_MS);
      try {
        // user.getrecenttracks often returns the placeholder even when Last.fm
        // actually has art for the track. Try track.getInfo which frequently
        // includes the real album images.
        const artist = track.artist?.['#text'] || track.artist?.name;
        const trackName = track.name;
        if (artist && trackName) {
          albumArt = await fetchTrackInfoImage(artist, trackName, coverController.signal);
        }

        // Still no art — try the Cover Art Archive via MBID or MusicBrainz lookup.
        if (!albumArt) {
          const albumMbid: string | undefined = track.album?.mbid;
          if (albumMbid) {
            albumArt = await fetchCoverArtUrl(albumMbid, coverController.signal);
          }
          // No mbid from Last.fm (common) — resolve one from artist + album.
          if (!albumArt) {
            const album = track.album?.['#text'];
            if (artist && album) {
              const rgMbid = await lookupReleaseGroupMbid(artist, album, coverController.signal);
              if (rgMbid) albumArt = await fetchCoverArtUrl(rgMbid, coverController.signal);
            }
          }
          // Release-group search failed (e.g. scrobbled artist name doesn't
          // match MusicBrainz's canonical name). Try a recording search which
          // uses unqualified Lucene matching and can find releases through
          // the track name even with variant artist names.
          if (!albumArt && artist && trackName) {
            const album = track.album?.['#text'] || trackName;
            const recResult = await lookupReleaseMbidByRecording(artist, trackName, album, coverController.signal);
            if (recResult) {
              albumArt = await fetchCoverArtUrl(recResult.releaseMbid, coverController.signal);
              if (!albumArt) {
                albumArt = await fetchCoverArtUrl(recResult.releaseGroupMbid, coverController.signal);
              }
            }
          }
        }
      } finally {
        clearTimeout(coverTimeout);
      }
    }

    const value: LastFmTrack = {
      name: track.name || 'Unknown Track',
      artist: track.artist?.['#text'] || track.artist?.name || 'Unknown Artist',
      album: track.album?.['#text'] || null,
      albumArt: albumArt || null,
      url: track.url || `https://www.last.fm/user/${username}`,
      nowPlaying: true,
    };

    cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS, refreshing: false });
    return value;
  } catch {
    cache.set(key, { value: null, expiresAt: Date.now() + CACHE_TTL_MS, refreshing: false });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
