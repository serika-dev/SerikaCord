"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Download,
} from "lucide-react";
import { useGT } from "gt-next";

// Dynamically import VideoPlayer with ssr: false to avoid "self is not defined" error
// from hls.js/dashjs which reference browser-only globals
const VideoPlayer = dynamic(
  () => import("serika-dev-player").then((mod) => mod.VideoPlayer),
  { ssr: false }
);

// Import the player CSS (safe in client components)
// @ts-ignore — CSS module has no type declaration
import "serika-dev-player/dist/index.css";

interface MediaPlayerProps {
  src: string;
  filename?: string;
  contentType?: string;
  className?: string;
  onMediaClick?: (media: { src: string; alt?: string; messageId?: string }) => void;
  messageId?: string;
}

function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function VideoMediaPlayer({
  src,
  filename,
  className,
}: MediaPlayerProps) {
  return (
    <div className={className}>
      <VideoPlayer
        src={src}
        width="100%"
        height="auto"
        controls
        preload="metadata"
        className="serika-chat-player rounded-lg overflow-hidden max-w-sm"
      />
      <style>{`
        .serika-chat-player {
          min-height: 120px !important;
          border-radius: 8px !important;
        }
        /* Shrink the big center play button */
        .serika-chat-player .serika-video-player-center-button {
          width: 48px !important;
          height: 48px !important;
        }
        .serika-chat-player .serika-video-player-center-button svg {
          width: 20px !important;
          height: 20px !important;
        }
        /* Auto-hide controls when not hovering or paused */
        .serika-chat-player .serika-video-player-controls {
          padding: 10px 8px 8px !important;
          opacity: 0 !important;
          transition: opacity 0.3s ease !important;
          pointer-events: none !important;
        }
        .serika-chat-player:hover .serika-video-player-controls {
          opacity: 1 !important;
          pointer-events: auto !important;
        }
        .serika-chat-player .serika-video-player-controls-row {
          gap: 4px !important;
        }
        .serika-chat-player .serika-video-player-control-button {
          min-width: 28px !important;
          height: 28px !important;
          padding: 4px !important;
        }
        .serika-chat-player .serika-video-player-control-button svg {
          width: 16px !important;
          height: 16px !important;
        }
        .serika-chat-player .serika-video-player-play-button svg {
          width: 18px !important;
          height: 18px !important;
        }
        /* Hide skip backward (2nd button) and skip forward (3rd button) */
        .serika-chat-player .serika-video-player-controls-row > .serika-video-player-control-button:nth-of-type(2),
        .serika-chat-player .serika-video-player-controls-row > .serika-video-player-control-button:nth-of-type(3) {
          display: none !important;
        }
        /* Compact volume slider */
        .serika-chat-player .serika-video-player-volume-slider {
          width: 50px !important;
        }
        /* Smaller time display */
        .serika-chat-player .serika-video-player-time-display {
          font-size: 11px !important;
        }
        /* Smaller progress bar */
        .serika-chat-player .serika-video-player-progress-container {
          height: 4px !important;
          margin-bottom: 6px !important;
        }
        /* Smaller settings menu */
        .serika-chat-player .serika-video-player-settings-menu {
          bottom: 38px !important;
          min-width: 140px !important;
          padding: 6px !important;
        }
        .serika-chat-player .serika-video-player-settings-item {
          padding: 6px 8px !important;
          font-size: 12px !important;
        }
      `}</style>
    </div>
  );
}

export function AudioMediaPlayer({
  src,
  filename,
  className,
}: MediaPlayerProps) {
  const gt = useGT();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      if (audio.duration) {
        setProgress((audio.currentTime / audio.duration) * 100);
      }
    };
    const onLoadedMetadata = () => setDuration(audio.duration);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      setProgress(0);
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
    };
  }, []);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch(() => {});
    }
  }, [isPlaying]);

  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !audio.muted;
    setIsMuted(audio.muted);
  }, []);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const v = parseFloat(e.target.value);
    audio.volume = v;
    setVolume(v);
    if (v === 0) {
      audio.muted = true;
      setIsMuted(true);
    } else if (isMuted) {
      audio.muted = false;
      setIsMuted(false);
    }
  }, [isMuted]);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    audio.currentTime = pct * audio.duration;
  }, []);

  return (
    <div className={className}>
      <audio ref={audioRef} src={src} preload="metadata" />
      <div className="flex items-center gap-3 p-3 bg-[var(--app-surface-alt)] rounded-lg max-w-sm transition-colors">
        <button
          onClick={togglePlay}
          className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-[#8B5CF6] to-[#7C3AED] flex items-center justify-center hover:from-[#7C3AED] hover:to-[#6D28D9] transition-all shadow-lg shadow-purple-500/20"
          aria-label={isPlaying ? gt("Pause") : gt("Play")}
        >
          {isPlaying ? (
            <Pause className="w-5 h-5 text-white" fill="white" />
          ) : (
            <Play className="w-5 h-5 text-white ml-0.5" fill="white" />
          )}
        </button>

        <div className="flex-1 min-w-0">
          <div className="text-sm text-[var(--text-primary)] truncate mb-1">
            {filename || gt("Audio file")}
          </div>

          <div
            className="relative h-1.5 bg-[var(--app-border)] rounded-full cursor-pointer group/bar"
            onClick={handleSeek}
          >
            <div
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-[#8B5CF6] to-[#7C3AED] rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow opacity-0 group-hover/bar:opacity-100 transition-opacity"
              style={{ left: `calc(${progress}% - 6px)` }}
            />
          </div>

          <div className="flex items-center justify-between mt-1">
            <span className="text-[10px] text-[var(--app-muted)] tabular-nums">
              {formatTime(currentTime)}
            </span>
            <span className="text-[10px] text-[var(--app-muted)] tabular-nums">
              {formatTime(duration)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={toggleMute}
            className="text-[var(--app-muted)] hover:text-[var(--text-primary)] transition-colors"
            aria-label={isMuted ? gt("Unmute") : gt("Mute")}
          >
            {isMuted || volume === 0 ? (
              <VolumeX className="w-4 h-4" />
            ) : (
              <Volume2 className="w-4 h-4" />
            )}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={isMuted ? 0 : volume}
            onChange={handleVolumeChange}
            className="w-16 h-1 accent-[#8B5CF6] cursor-pointer"
            aria-label={gt("Volume")}
          />
          <a
            href={src}
            download={filename}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--app-muted)] hover:text-[var(--text-primary)] transition-colors"
            aria-label={gt("Download")}
          >
            <Download className="w-4 h-4" />
          </a>
        </div>
      </div>
    </div>
  );
}
