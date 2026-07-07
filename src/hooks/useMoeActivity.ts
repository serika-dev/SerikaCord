"use client";

import { useEffect, useState } from "react";

export interface MoeActivity {
  titleName: string;
  episodeName: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  progressSeconds: number;
  durationSeconds: number | null;
  posterUrl: string | null;
  isPaused: boolean;
  startedAt: string;
  updatedAt: string;
}

export interface MusicActivity {
  name: string;
  artist: string;
  album: string | null;
  albumArt: string | null;
  url: string;
  nowPlaying: boolean;
}

export interface GameActivity {
  type: string;
  name: string;
  details: string | null;
  state: string | null;
  largeImageUrl: string | null;
  largeImageText: string | null;
  smallImageUrl: string | null;
  smallImageText: string | null;
  startedAt: string | null;
  endsAt: string | null;
}

export interface UserActivity {
  activity: MoeActivity | null;
  music: MusicActivity | null;
  game: GameActivity | null;
  activities: GameActivity[];
}

/**
 * Polls a user's combined live activity:
 *  - "now watching on serika.moe" (anime/media)
 *  - Last.fm "now scrobbling" music
 *  - Rich presence game/app status (from desktop app)
 *
 * Polls every `intervalMs` (default 5s) while `enabled`.
 */
export function useMoeActivity(
  userId: string | undefined | null,
  { enabled = true, intervalMs = 5_000 }: { enabled?: boolean; intervalMs?: number } = {}
): MoeActivity | null {
  const full = useUserActivity(userId, { enabled, intervalMs });
  return full?.activity ?? null;
}

export function useUserActivity(
  userId: string | undefined | null,
  { enabled = true, intervalMs = 5_000 }: { enabled?: boolean; intervalMs?: number } = {}
): UserActivity | null {
  const [data, setData] = useState<UserActivity | null>(null);

  useEffect(() => {
    if (!userId || !enabled) {
      setData(null);
      return;
    }

    let active = true;
    const controller = new AbortController();

    const load = async () => {
      try {
        const res = await fetch(`/api/users/${userId}/activity`, { signal: controller.signal });
        if (!active || !res.ok) return;
        const json = (await res.json()) as {
          activity?: MoeActivity | null;
          music?: MusicActivity | null;
          game?: GameActivity | null;
          activities?: GameActivity[];
        };
        const activities = json.activities ?? (json.game ? [json.game] : []);
        if (active) setData({
          activity: json.activity ?? null,
          music: json.music ?? null,
          game: activities[0] ?? json.game ?? null,
          activities,
        });
      } catch {
        // ignore transient errors; keep last known value
      }
    };

    void load();
    const timer = setInterval(load, intervalMs);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [userId, enabled, intervalMs]);

  return data;
}
