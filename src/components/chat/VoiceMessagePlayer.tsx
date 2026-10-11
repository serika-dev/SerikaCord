"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { useChatGt } from "./ChatGtContext";
import {
  decodeWaveform,
  formatVoiceDuration,
  nextPlaybackRate,
  waveformBars,
} from "@/lib/chat/voiceMessage";

const BAR_COUNT = 40;

/** Only one voice message plays at a time (like Discord). */
let activeAudio: HTMLAudioElement | null = null;

interface VoiceMessagePlayerProps {
  src: string;
  durationSecs: number;
  waveform?: string;
  className?: string;
}

/**
 * Discord-style voice message bubble: play/pause, the recorded waveform as a
 * seekable progress bar, time left and a 1x/1.5x/2x speed toggle. The audio is
 * fetched only when first played (`preload="none"`); the bubble's length comes
 * from the attachment's `durationSecs`.
 */
export function VoiceMessagePlayer({ src, durationSecs, waveform, className }: VoiceMessagePlayerProps) {
  const gt = useChatGt();
  const audioRef = useRef<HTMLAudioElement>(null);
  const rafRef = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [rate, setRate] = useState(1);
  const [mediaDuration, setMediaDuration] = useState<number | null>(null);

  const bars = useMemo(() => waveformBars(decodeWaveform(waveform), BAR_COUNT), [waveform]);
  // WebM from MediaRecorder often reports Infinity until fully read: prefer
  // the stored duration, fall back to the element's when it is finite.
  const duration = durationSecs > 0 ? durationSecs : (mediaDuration ?? 0);
  const progress = duration > 0 ? Math.min(1, current / duration) : 0;

  const stopTicker = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  const startTicker = useCallback(() => {
    stopTicker();
    const tick = () => {
      const audio = audioRef.current;
      if (!audio) return;
      setCurrent(audio.currentTime);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [stopTicker]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      if (activeAudio && activeAudio !== audio) activeAudio.pause();
      activeAudio = audio;
      audio.playbackRate = rate;
      void audio.play().catch(() => setPlaying(false));
    } else {
      audio.pause();
    }
  }, [rate]);

  const cycleRate = useCallback(() => {
    const next = nextPlaybackRate(rate);
    setRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }, [rate]);

  const seekTo = useCallback(
    (fraction: number) => {
      const audio = audioRef.current;
      if (!audio || duration <= 0) return;
      const t = Math.max(0, Math.min(1, fraction)) * duration;
      audio.currentTime = t;
      setCurrent(t);
    },
    [duration],
  );

  const onBarPointer = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.type === "pointermove" && e.buttons !== 1) return;
      const rect = e.currentTarget.getBoundingClientRect();
      if (rect.width <= 0) return;
      seekTo((e.clientX - rect.left) / rect.width);
    },
    [seekTo],
  );

  const onBarKey = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (duration <= 0) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        seekTo((current + 5) / duration);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        seekTo((current - 5) / duration);
      }
    },
    [current, duration, seekTo],
  );

  const shown = playing || current > 0 ? current : duration;

  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-full bg-[var(--app-surface-alt)] border border-[var(--app-border)] py-1.5 pl-1.5 pr-3 w-full max-w-[340px]",
        className,
      )}
    >
      <audio
        ref={audioRef}
        src={src}
        preload="none"
        onPlay={() => {
          setPlaying(true);
          startTicker();
        }}
        onPause={() => {
          setPlaying(false);
          stopTicker();
          if (audioRef.current) setCurrent(audioRef.current.currentTime);
        }}
        onEnded={() => {
          setPlaying(false);
          stopTicker();
          setCurrent(0);
          if (activeAudio === audioRef.current) activeAudio = null;
        }}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setMediaDuration(d);
        }}
      />
      <button
        type="button"
        onClick={toggle}
        className="flex-shrink-0 w-9 h-9 rounded-full bg-[var(--app-accent)] text-white flex items-center justify-center hover:brightness-110 active:scale-95 transition"
        aria-label={playing ? gt("Pause voice message") : gt("Play voice message")}
      >
        {playing ? (
          <Pause className="w-4 h-4" fill="currentColor" />
        ) : (
          <Play className="w-4 h-4 ml-0.5" fill="currentColor" />
        )}
      </button>

      <div
        role="slider"
        tabIndex={0}
        aria-label={gt("Voice message")}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(current)}
        aria-valuetext={formatVoiceDuration(current)}
        onPointerDown={onBarPointer}
        onPointerMove={onBarPointer}
        onKeyDown={onBarKey}
        className="flex-1 min-w-0 h-8 flex items-center gap-[2px] cursor-pointer touch-none select-none"
      >
        {bars.map((v, i) => {
          const played = (i + 0.5) / bars.length <= progress;
          return (
            <span
              key={i}
              className={cn(
                "flex-1 min-w-[2px] max-w-[4px] rounded-full transition-colors",
                played ? "bg-[var(--app-accent)]" : "bg-[var(--app-muted)] opacity-50",
              )}
              style={{ height: `${Math.round(v * 100)}%` }}
            />
          );
        })}
      </div>

      <span className="flex-shrink-0 text-xs tabular-nums text-[var(--app-muted)] min-w-[2.5rem] text-right">
        {formatVoiceDuration(shown)}
      </span>
      <button
        type="button"
        onClick={cycleRate}
        className="flex-shrink-0 text-[11px] font-semibold tabular-nums rounded-full px-1.5 py-0.5 bg-[var(--app-border)] text-[var(--text-primary)] hover:brightness-110 transition"
        aria-label={gt("Playback speed")}
        title={gt("Playback speed")}
      >
        {rate}x
      </button>
    </div>
  );
}
