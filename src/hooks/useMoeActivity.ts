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
  { enabled = true, intervalMs = 15_000 }: { enabled?: boolean; intervalMs?: number } = {}
): MoeActivity | null {
  const full = useUserActivity(userId, { enabled, intervalMs });
  return full?.activity ?? null;
}

// ── Shared, batched activity polling ─────────────────────────────────────
// Every mounted useUserActivity registers its user here; one ticker fetches
// all users that are due in a single /api/users/activity/batch request. A
// member list with 200 online rows used to send ~13 requests per second.

type Listener = (data: UserActivity) => void;
interface Subscription { listeners: Set<Listener>; intervals: number[]; lastFetched: number }

const subscriptions = new Map<string, Subscription>();
const lastKnown = new Map<string, UserActivity>();
const TICK_MS = 2500;
const BATCH_SIZE = 50;
let ticker: ReturnType<typeof setInterval> | null = null;
let flushQueued = false;
let inflight = false;

function normalize(json: {
  activity?: MoeActivity | null;
  music?: MusicActivity | null;
  game?: GameActivity | null;
  activities?: GameActivity[];
}): UserActivity {
  const activities = json.activities ?? (json.game ? [json.game] : []);
  return {
    activity: json.activity ?? null,
    music: json.music ?? null,
    game: activities[0] ?? json.game ?? null,
    activities,
  };
}

async function poll(force = false) {
  if (inflight) return;
  if (!force && typeof document !== "undefined" && document.visibilityState !== "visible") return;
  const now = Date.now();
  const due: string[] = [];
  subscriptions.forEach((sub, userId) => {
    const interval = Math.min(...sub.intervals);
    if (force ? sub.lastFetched === 0 : now - sub.lastFetched >= interval) due.push(userId);
  });
  if (due.length === 0) return;
  inflight = true;
  try {
    for (let i = 0; i < due.length; i += BATCH_SIZE) {
      const ids = due.slice(i, i + BATCH_SIZE);
      ids.forEach((id) => { const sub = subscriptions.get(id); if (sub) sub.lastFetched = Date.now(); });
      const res = await fetch(`/api/users/activity/batch?ids=${ids.join(",")}`).catch(() => null);
      if (!res?.ok) continue;
      const json = (await res.json().catch(() => null)) as { activities?: Record<string, Parameters<typeof normalize>[0]> } | null;
      for (const id of ids) {
        const raw = json?.activities?.[id];
        if (!raw) continue;
        const data = normalize(raw);
        lastKnown.set(id, data);
        subscriptions.get(id)?.listeners.forEach((fn) => fn(data));
      }
    }
  } finally {
    inflight = false;
  }
}

function ensureTicker() {
  if (ticker || typeof window === "undefined") return;
  ticker = setInterval(() => void poll(), TICK_MS);
  document.addEventListener("visibilitychange", onVisible);
}

function onVisible() {
  if (document.visibilityState === "visible") void poll();
}

function subscribe(userId: string, intervalMs: number, listener: Listener): () => void {
  let sub = subscriptions.get(userId);
  if (!sub) {
    sub = { listeners: new Set(), intervals: [], lastFetched: 0 };
    subscriptions.set(userId, sub);
  }
  sub.listeners.add(listener);
  sub.intervals.push(intervalMs);
  ensureTicker();
  // New users fetch right away, coalesced with everything mounting this tick.
  if (sub.lastFetched === 0 && !flushQueued) {
    flushQueued = true;
    setTimeout(() => { flushQueued = false; void poll(true); }, 0);
  }
  return () => {
    const current = subscriptions.get(userId);
    if (!current) return;
    current.listeners.delete(listener);
    const idx = current.intervals.indexOf(intervalMs);
    if (idx !== -1) current.intervals.splice(idx, 1);
    if (current.listeners.size === 0) subscriptions.delete(userId);
    if (subscriptions.size === 0 && ticker) {
      clearInterval(ticker);
      ticker = null;
      document.removeEventListener("visibilitychange", onVisible);
    }
  };
}

export function useUserActivity(
  userId: string | undefined | null,
  { enabled = true, intervalMs = 15_000 }: { enabled?: boolean; intervalMs?: number } = {}
): UserActivity | null {
  const [data, setData] = useState<UserActivity | null>(() => (userId ? lastKnown.get(userId) ?? null : null));

  useEffect(() => {
    if (!userId || !enabled) {
      setData(null);
      return;
    }
    setData(lastKnown.get(userId) ?? null);
    return subscribe(userId, intervalMs, setData);
  }, [userId, enabled, intervalMs]);

  return data;
}
