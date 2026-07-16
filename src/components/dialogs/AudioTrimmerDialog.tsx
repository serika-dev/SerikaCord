"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Pause, Scissors, Check, X } from "lucide-react";
import { toast } from "sonner";
import { useGT } from "gt-next";
import { cn } from "@/lib/utils";
import { Loader } from "@/components/ui/Loader";

interface AudioTrimmerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The audio file to trim; decoded when the dialog opens */
  file: File | null;
  /** Maximum allowed selection length in seconds */
  maxDuration?: number;
  /** Called with the trimmed audio (16-bit WAV) when the user confirms */
  onTrimmed: (blob: Blob, name: string) => void;
}

function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = (s % 60).toFixed(1).padStart(4, "0");
  return `${m}:${rest}`;
}

/** Encode an AudioBuffer slice as a 16-bit PCM WAV blob. */
function encodeWav(buffer: AudioBuffer, startSec: number, endSec: number): Blob {
  const sampleRate = buffer.sampleRate;
  const channels = Math.min(buffer.numberOfChannels, 2);
  const startFrame = Math.floor(startSec * sampleRate);
  const endFrame = Math.min(Math.floor(endSec * sampleRate), buffer.length);
  const frameCount = Math.max(0, endFrame - startFrame);

  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataSize = frameCount * blockAlign;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  const channelData: Float32Array[] = [];
  for (let ch = 0; ch < channels; ch++) {
    channelData.push(buffer.getChannelData(ch));
  }
  for (let frame = startFrame; frame < endFrame; frame++) {
    for (let ch = 0; ch < channels; ch++) {
      const sample = Math.max(-1, Math.min(1, channelData[ch][frame]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}

/**
 * Trim dialog for soundboard uploads longer than the allowed duration.
 * Shows a waveform, lets the user drag a selection window (capped at
 * maxDuration), preview it, and exports the slice as WAV.
 */
export function AudioTrimmerDialog({
  open,
  onOpenChange,
  file,
  maxDuration = 30,
  onTrimmed,
}: AudioTrimmerDialogProps) {
  const gt = useGT();
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [isDecoding, setIsDecoding] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [selStart, setSelStart] = useState(0);
  const [selEnd, setSelEnd] = useState(maxDuration);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackPos, setPlaybackPos] = useState(0);
  const [dragging, setDragging] = useState<"start" | "end" | "move" | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const playbackRef = useRef<{ ctx: AudioContext; source: AudioBufferSourceNode; startTime: number } | null>(null);
  const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);

  const duration = audioBuffer?.duration ?? 0;
  const selectionLength = selEnd - selStart;

  const stopPreview = useCallback(() => {
    if (stopTimeoutRef.current) {
      clearTimeout(stopTimeoutRef.current);
      stopTimeoutRef.current = null;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (playbackRef.current) {
      try { playbackRef.current.source.stop(); } catch { /* already stopped */ }
      void playbackRef.current.ctx.close().catch(() => {});
      playbackRef.current = null;
    }
    setIsPlaying(false);
    setPlaybackPos(0);
  }, []);

  // Decode when opened with a file
  useEffect(() => {
    if (!open || !file) return;
    let cancelled = false;
    setIsDecoding(true);
    setAudioBuffer(null);

    const decode = async () => {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const ctx = new AudioContext();
        const decoded = await ctx.decodeAudioData(arrayBuffer);
        await ctx.close().catch(() => {});
        if (cancelled) return;
        setAudioBuffer(decoded);
        setSelStart(0);
        setSelEnd(Math.min(maxDuration, decoded.duration));
      } catch {
        if (!cancelled) {
          toast.error(gt("Could not decode this audio file"));
          onOpenChange(false);
        }
      } finally {
        if (!cancelled) setIsDecoding(false);
      }
    };
    void decode();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, file, maxDuration]);

  // Stop any preview when closing
  useEffect(() => {
    if (!open) stopPreview();
  }, [open, stopPreview]);

  // Draw waveform + selection overlay + playback progress
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !audioBuffer) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const data = audioBuffer.getChannelData(0);
    const samplesPerPixel = Math.max(1, Math.floor(data.length / width));
    const startX = (selStart / audioBuffer.duration) * width;
    const endX = (selEnd / audioBuffer.duration) * width;
    const progressX = isPlaying ? (playbackPos / audioBuffer.duration) * width : -1;

    // Draw waveform bars
    for (let x = 0; x < width; x++) {
      let peak = 0;
      const s = x * samplesPerPixel;
      const e = Math.min(s + samplesPerPixel, data.length);
      for (let i = s; i < e; i += 16) {
        const v = Math.abs(data[i]);
        if (v > peak) peak = v;
      }
      const barHeight = Math.max(1.5, peak * height * 0.85);
      const inSelection = x >= startX && x <= endX;
      const isPastProgress = progressX >= 0 && x <= progressX && x >= startX;

      if (isPastProgress) {
        // Played portion — bright purple/white
        ctx.fillStyle = "#a78bfa";
      } else if (inSelection) {
        // Selected but not yet played — medium purple
        ctx.fillStyle = "#8B5CF6";
      } else {
        // Outside selection — dark gray
        ctx.fillStyle = "#2a2a3a";
      }
      ctx.fillRect(x, (height - barHeight) / 2, 1, barHeight);
    }

    // Selection overlay glow
    const gradient = ctx.createLinearGradient(startX, 0, endX, 0);
    gradient.addColorStop(0, "rgba(139, 92, 246, 0.08)");
    gradient.addColorStop(0.5, "rgba(139, 92, 246, 0.04)");
    gradient.addColorStop(1, "rgba(139, 92, 246, 0.08)");
    ctx.fillStyle = gradient;
    ctx.fillRect(startX, 0, endX - startX, height);

    // Selection border lines
    ctx.fillStyle = "#8B5CF6";
    ctx.fillRect(startX - 0.5, 0, 2, height);
    ctx.fillRect(endX - 1.5, 0, 2, height);

    // Playback progress line
    if (progressX >= 0 && progressX >= startX && progressX <= endX) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(progressX - 0.5, 0, 2, height);
      // Glow effect
      ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
      ctx.fillRect(progressX - 3, 0, 6, height);
    }
  }, [audioBuffer, selStart, selEnd, playbackPos, isPlaying]);

  const handleStartChange = (value: number) => {
    const next = Math.min(value, selEnd - 0.5);
    setSelStart(Math.max(0, next));
    if (selEnd - next > maxDuration) {
      setSelEnd(next + maxDuration);
    }
    stopPreview();
  };

  const handleEndChange = (value: number) => {
    const next = Math.max(value, selStart + 0.5);
    setSelEnd(Math.min(duration, next));
    if (next - selStart > maxDuration) {
      setSelStart(next - maxDuration);
    }
    stopPreview();
  };

  const handlePreview = () => {
    if (!audioBuffer) return;
    if (isPlaying) {
      stopPreview();
      return;
    }
    const ctx = new AudioContext();
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    const playStartOffset = selStart;
    source.start(0, selStart, selEnd - selStart);
    const startTime = ctx.currentTime;
    playbackRef.current = { ctx, source, startTime };
    setIsPlaying(true);

    // Animate playback progress
    const animate = () => {
      if (!playbackRef.current) return;
      const elapsed = playbackRef.current.ctx.currentTime - playbackRef.current.startTime;
      const pos = playStartOffset + elapsed;
      if (pos >= selEnd) {
        stopPreview();
        return;
      }
      setPlaybackPos(pos);
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);

    stopTimeoutRef.current = setTimeout(stopPreview, (selEnd - selStart) * 1000 + 200);
  };

  const handleConfirm = () => {
    if (!audioBuffer || !file) return;
    setIsExporting(true);
    try {
      const blob = encodeWav(audioBuffer, selStart, selEnd);
      stopPreview();
      onTrimmed(blob, file.name.replace(/\.[^/.]+$/, ""));
      onOpenChange(false);
    } catch {
      toast.error(gt("Failed to trim audio"));
    } finally {
      setIsExporting(false);
    }
  };

  // Mouse interaction on waveform
  const getPosFromMouse = (clientX: number): number => {
    const canvas = canvasRef.current;
    if (!canvas || !audioBuffer) return 0;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * audioBuffer.duration;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!audioBuffer) return;
    const pos = getPosFromMouse(e.clientX);
    const startX = (selStart / duration) * (canvasRef.current?.clientWidth || 1);
    const endX = (selEnd / duration) * (canvasRef.current?.clientWidth || 1);
    const mouseX = e.clientX - (canvasRef.current?.getBoundingClientRect().left || 0);

    // Check if near a handle (within 8px)
    if (Math.abs(mouseX - startX) < 12) {
      setDragging("start");
    } else if (Math.abs(mouseX - endX) < 12) {
      setDragging("end");
    } else if (pos >= selStart && pos <= selEnd) {
      // Click inside selection — start moving
      setDragging("move");
    } else {
      // Click outside — set start handle to this position
      setDragging("start");
      handleStartChange(pos);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging || !audioBuffer) return;
    const pos = getPosFromMouse(e.clientX);

    if (dragging === "start") {
      handleStartChange(pos);
    } else if (dragging === "end") {
      handleEndChange(pos);
    } else if (dragging === "move") {
      const len = selectionLength;
      const newStart = Math.max(0, Math.min(pos - len / 2, duration - len));
      setSelStart(newStart);
      setSelEnd(newStart + len);
      stopPreview();
    }
  };

  const handleMouseUp = () => {
    setDragging(null);
  };

  // Global mouse up listener
  useEffect(() => {
    if (!dragging) return;
    const handler = () => setDragging(null);
    window.addEventListener("mouseup", handler);
    return () => window.removeEventListener("mouseup", handler);
  }, [dragging]);

  // Handle escape key
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true } as EventListenerOptions);
  }, [open, onOpenChange]);

  if (!open) return null;

  const selPercent = duration > 0 ? (selectionLength / maxDuration) * 100 : 0;
  const isOverMax = selectionLength > maxDuration;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => onOpenChange(false)} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={gt("Trim audio")}
        className="relative w-full max-w-xl mx-4 bg-[#111114] border border-[#222230] rounded-2xl shadow-2xl p-6"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2.5">
            <div className="size-8 rounded-lg bg-[#8B5CF6]/15 flex items-center justify-center">
              <Scissors className="w-4.5 h-4.5 text-[#8B5CF6]" />
            </div>
            <h2 className="text-white font-semibold text-lg">{gt("Trim Sound")}</h2>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="p-1.5 rounded-lg text-[#666] hover:text-white hover:bg-white/5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-sm text-[#777] mb-5">
          {gt("Select up to {max}s. Drag the handles or use the sliders.", { max: maxDuration })}
        </p>

        {isDecoding ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader size={32} />
            <p className="text-xs text-[#666]">{gt("Decoding audio...")}</p>
          </div>
        ) : audioBuffer ? (
          <>
            {/* Waveform with interactive selection */}
            <div
              ref={containerRef}
              className="relative"
            >
              <canvas
                ref={canvasRef}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                className={cn(
                  "w-full h-28 rounded-xl bg-[#0a0a0d] border border-[#1a1a22] cursor-pointer",
                  dragging === "start" && "cursor-ew-resize",
                  dragging === "end" && "cursor-ew-resize",
                  dragging === "move" && "cursor-grabbing",
                )}
              />

              {/* Time labels on waveform */}
              <div className="absolute bottom-1.5 left-2 text-[10px] text-[#555] font-mono pointer-events-none">
                0:00
              </div>
              <div className="absolute bottom-1.5 right-2 text-[10px] text-[#555] font-mono pointer-events-none">
                {formatTime(duration)}
              </div>
            </div>

            {/* Selection info bar */}
            <div className="flex items-center justify-between mt-4 mb-3">
              <div className="flex items-center gap-3">
                <span className="text-xs text-[#888] font-mono">
                  {formatTime(selStart)}
                </span>
                <div className="h-3 w-px bg-[#333]" />
                <span className="text-xs text-[#888] font-mono">
                  {formatTime(selEnd)}
                </span>
              </div>
              <span
                className={cn(
                  "text-xs font-semibold px-2.5 py-1 rounded-full",
                  isOverMax
                    ? "bg-red-500/10 text-red-400"
                    : "bg-[#8B5CF6]/10 text-[#a78bfa]",
                )}
              >
                {selectionLength.toFixed(1)}s / {maxDuration}s
              </span>
            </div>

            {/* Selection length progress bar */}
            <div className="relative h-1.5 bg-[#1a1a22] rounded-full overflow-hidden mb-5">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-150",
                  isOverMax
                    ? "bg-red-500"
                    : "bg-gradient-to-r from-[#8B5CF6] to-[#a78bfa]",
                )}
                style={{ width: `${Math.min(selPercent, 100)}%` }}
              />
            </div>

            {/* Sliders */}
            <div className="space-y-3 mb-5">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[#555] font-semibold mb-1.5 block">
                  {gt("Start")}
                </label>
                <input
                  type="range"
                  min={0}
                  max={duration}
                  step={0.1}
                  value={selStart}
                  onChange={(e) => handleStartChange(Number(e.target.value))}
                  aria-label={gt("Selection start")}
                  className="w-full accent-[#8B5CF6]"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[#555] font-semibold mb-1.5 block">
                  {gt("End")}
                </label>
                <input
                  type="range"
                  min={0}
                  max={duration}
                  step={0.1}
                  value={selEnd}
                  onChange={(e) => handleEndChange(Number(e.target.value))}
                  aria-label={gt("Selection end")}
                  className="w-full accent-[#8B5CF6]"
                />
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center justify-between gap-3">
              <button
                onClick={handlePreview}
                className={cn(
                  "flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all active:scale-95",
                  isPlaying
                    ? "bg-[#8B5CF6]/15 text-[#a78bfa] border border-[#8B5CF6]/30"
                    : "bg-[#1a1a22] hover:bg-[#222230] border border-[#222230] text-white",
                )}
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                {isPlaying ? gt("Stop") : gt("Preview")}
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => onOpenChange(false)}
                  className="px-4 py-2.5 rounded-xl text-sm text-[#888] hover:text-white hover:bg-white/5 transition-colors"
                >
                  {gt("Cancel")}
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={isExporting || selectionLength <= 0 || isOverMax}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#8B5CF6] hover:bg-[#7C3AED] active:scale-95 text-white text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isExporting ? (
                    <Loader size={16} />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  {gt("Use This Clip")}
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
