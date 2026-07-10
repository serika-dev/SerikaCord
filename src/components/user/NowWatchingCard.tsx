"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Play, Pause, CheckCircle2 } from "lucide-react";
import type { MoeActivity } from "@/hooks/useMoeActivity";
import { useGT } from "gt-next";

function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return h > 0 ? `${h}:${mm}:${String(sec).padStart(2, "0")}` : `${mm}:${String(sec).padStart(2, "0")}`;
}

function subtitle(activity: MoeActivity, gt: (key: string, vars?: Record<string, unknown>) => string): string {
  const parts: string[] = [];
  if (activity.seasonNumber != null && activity.episodeNumber != null) {
    parts.push(gt("S{season} · E{episode}", { season: activity.seasonNumber, episode: activity.episodeNumber }));
  } else if (activity.episodeNumber != null) {
    parts.push(gt("Episode {episode}", { episode: activity.episodeNumber }));
  }
  if (activity.episodeName) parts.push(activity.episodeName);
  return parts.join("  ·  ");
}

type PlaybackState = "playing" | "paused" | "finished";

/**
 * Discord-Spotify-style "Watching on serika.moe" activity card.
 *
 * Ticks the progress bar locally between server polls so it feels live, and
 * pauses ticking when the stream is paused. Derives a discrete playback state
 * (playing / paused / finished) for a clearer, nicer status presentation.
 */
export function NowWatchingCard({ activity }: { activity: MoeActivity }) {
  const gt = useGT();
  const duration = activity.durationSeconds ?? 0;

  // Estimate current progress: server progress + elapsed since last update
  // (unless paused). Recomputed whenever a fresh activity arrives.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => setElapsed(0), [activity.updatedAt, activity.progressSeconds]);

  useEffect(() => {
    if (activity.isPaused) return;
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timer);
  }, [activity.isPaused, activity.updatedAt]);

  const current = Math.min(
    activity.progressSeconds + (activity.isPaused ? 0 : elapsed),
    duration || Number.MAX_SAFE_INTEGER
  );
  const pct = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;
  const line2 = subtitle(activity, gt);

  // Consider the episode finished once we're within a few seconds of the end.
  const isFinished = duration > 0 && current >= duration - 2;
  const state: PlaybackState = isFinished ? "finished" : activity.isPaused ? "paused" : "playing";

  const stateConfig: Record<PlaybackState, { label: string; icon: ReactNode; dot: string }> = {
    playing: {
      label: gt("Playing"),
      icon: <Play className="w-3 h-3 fill-[#8B5CF6] text-[#8B5CF6]" />,
      dot: "bg-[#8B5CF6] animate-pulse",
    },
    paused: {
      label: gt("Paused"),
      icon: <Pause className="w-3 h-3 fill-[#9a9aad] text-[#9a9aad]" />,
      dot: "bg-[#9a9aad]",
    },
    finished: {
      label: gt("Finished"),
      icon: <CheckCircle2 className="w-3 h-3 text-[#22c55e]" />,
      dot: "bg-[#22c55e]",
    },
  };
  const cfg = stateConfig[state];

  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-gradient-to-b from-white/[0.05] to-white/[0.02] shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-2.5 pb-2">
        <h4 className="text-[11px] font-bold uppercase tracking-wide text-[#9a9aad]">
          {gt("Watching on serika.moe")}
        </h4>
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#c8c8d8]">
          <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
          {cfg.label}
        </span>
      </div>

      {/* 16:9 wide thumbnail */}
      <div className="relative mx-3 aspect-video overflow-hidden rounded-lg border border-white/[0.06]">
        {activity.posterUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={activity.posterUrl}
            alt={activity.titleName}
            className={`h-full w-full object-cover transition-[filter,opacity] duration-300 ${
              state === "paused" ? "brightness-[0.6] saturate-50" : ""
            }`}
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-[#8B5CF6] to-[#4F46E5]" />
        )}

        {/* Bottom gradient + title overlay */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-2.5 pt-8">
          <p className="truncate text-sm font-semibold text-white drop-shadow" title={activity.titleName}>
            {activity.titleName}
          </p>
          {line2 && (
            <p className="truncate text-[11px] text-white/75" title={line2}>
              {line2}
            </p>
          )}
        </div>

        {/* Center play/pause state badge */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className={`flex items-center justify-center rounded-full bg-black/45 backdrop-blur-sm transition-opacity duration-300 ${
              state === "playing" ? "h-9 w-9 opacity-0" : "h-11 w-11 opacity-100"
            }`}
          >
            {state === "finished" ? (
              <CheckCircle2 className="h-6 w-6 text-[#22c55e]" />
            ) : (
              <Pause className="h-5 w-5 fill-white text-white" />
            )}
          </div>
        </div>
      </div>

      {/* Progress */}
      <div className="px-3 pb-3 pt-2.5">
        {duration > 0 ? (
          <>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className={`h-full rounded-full transition-[width] duration-1000 ease-linear ${
                  state === "finished" ? "bg-[#22c55e]" : state === "paused" ? "bg-[#9a9aad]" : "bg-[#8B5CF6]"
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="mt-1.5 flex justify-between text-[10px] tabular-nums text-[#9a9aad]">
              <span>{formatTime(current)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-1.5 text-[11px] text-[#9a9aad]">
            {cfg.icon}
            {cfg.label}
          </div>
        )}
      </div>
    </div>
  );
}
