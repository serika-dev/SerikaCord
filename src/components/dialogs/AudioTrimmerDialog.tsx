"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Play, Square, Scissors } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [isDecoding, setIsDecoding] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [selStart, setSelStart] = useState(0);
  const [selEnd, setSelEnd] = useState(maxDuration);
  const [isPlaying, setIsPlaying] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playbackRef = useRef<{ ctx: AudioContext; source: AudioBufferSourceNode } | null>(null);
  const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const duration = audioBuffer?.duration ?? 0;

  const stopPreview = useCallback(() => {
    if (stopTimeoutRef.current) {
      clearTimeout(stopTimeoutRef.current);
      stopTimeoutRef.current = null;
    }
    if (playbackRef.current) {
      try { playbackRef.current.source.stop(); } catch { /* already stopped */ }
      void playbackRef.current.ctx.close().catch(() => {});
      playbackRef.current = null;
    }
    setIsPlaying(false);
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
          toast.error("Could not decode this audio file");
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

  // Draw waveform + selection overlay
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

    // Peaks
    const data = audioBuffer.getChannelData(0);
    const samplesPerPixel = Math.max(1, Math.floor(data.length / width));
    ctx.fillStyle = "#3f3f5a";
    for (let x = 0; x < width; x++) {
      let peak = 0;
      const start = x * samplesPerPixel;
      const end = Math.min(start + samplesPerPixel, data.length);
      for (let i = start; i < end; i += 16) {
        const v = Math.abs(data[i]);
        if (v > peak) peak = v;
      }
      const barHeight = Math.max(1, peak * height * 0.9);
      ctx.fillRect(x, (height - barHeight) / 2, 1, barHeight);
    }

    // Selection highlight
    const startX = (selStart / audioBuffer.duration) * width;
    const endX = (selEnd / audioBuffer.duration) * width;
    ctx.fillStyle = "rgba(139, 92, 246, 0.25)";
    ctx.fillRect(startX, 0, endX - startX, height);
    ctx.fillStyle = "#8B5CF6";
    ctx.fillRect(startX, 0, 2, height);
    ctx.fillRect(endX - 2, 0, 2, height);
  }, [audioBuffer, selStart, selEnd]);

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
    source.start(0, selStart, selEnd - selStart);
    playbackRef.current = { ctx, source };
    setIsPlaying(true);
    stopTimeoutRef.current = setTimeout(stopPreview, (selEnd - selStart) * 1000 + 100);
  };

  const handleConfirm = () => {
    if (!audioBuffer || !file) return;
    setIsExporting(true);
    try {
      const blob = encodeWav(audioBuffer, selStart, selEnd);
      if (blob.size > 20 * 1024 * 1024) {
        toast.error("Trimmed audio is still over 20MB — select a shorter clip");
        return;
      }
      stopPreview();
      onTrimmed(blob, file.name.replace(/\.[^/.]+$/, ""));
      onOpenChange(false);
    } catch {
      toast.error("Failed to trim audio");
    } finally {
      setIsExporting(false);
    }
  };

  if (!open) return null;

  const selectionLength = selEnd - selStart;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={() => onOpenChange(false)} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Trim audio"
        className="relative w-full max-w-lg mx-4 bg-[#111111] border border-[#222222] rounded-lg shadow-xl p-5"
      >
        <div className="flex items-center gap-2 mb-1">
          <Scissors className="w-5 h-5 text-[#8B5CF6]" />
          <h2 className="text-white font-semibold">Trim Sound</h2>
        </div>
        <p className="text-sm text-[#888888] mb-4">
          Sounds can be at most {maxDuration} seconds. Drag the handles to pick which part to keep.
        </p>

        {isDecoding ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-[#8B5CF6] animate-spin" />
          </div>
        ) : audioBuffer ? (
          <>
            <canvas ref={canvasRef} className="w-full h-24 rounded-md bg-[#0a0a0a] border border-[#222222]" />

            <div className="mt-4 space-y-3">
              <div>
                <div className="flex items-center justify-between text-xs text-[#888888] mb-1">
                  <span>Start: {formatTime(selStart)}</span>
                  <span
                    className={cn(
                      "font-medium",
                      selectionLength > maxDuration ? "text-red-400" : "text-[#8B5CF6]"
                    )}
                  >
                    Selection: {selectionLength.toFixed(1)}s / {maxDuration}s
                  </span>
                  <span>End: {formatTime(selEnd)}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={duration}
                  step={0.1}
                  value={selStart}
                  onChange={(e) => handleStartChange(Number(e.target.value))}
                  aria-label="Selection start"
                  className="w-full accent-[#8B5CF6]"
                />
                <input
                  type="range"
                  min={0}
                  max={duration}
                  step={0.1}
                  value={selEnd}
                  onChange={(e) => handleEndChange(Number(e.target.value))}
                  aria-label="Selection end"
                  className="w-full accent-[#8B5CF6]"
                />
              </div>

              <div className="flex items-center justify-between gap-3">
                <button
                  onClick={handlePreview}
                  className="flex items-center gap-2 px-4 py-2 rounded-md bg-[#1a1a1a] hover:bg-[#222222] border border-[#222222] text-white text-sm transition-colors"
                >
                  {isPlaying ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  {isPlaying ? "Stop" : "Preview"}
                </button>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onOpenChange(false)}
                    className="px-4 py-2 rounded-md text-sm text-[#d5d9e8] hover:bg-[#1a1a1a] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConfirm}
                    disabled={isExporting || selectionLength <= 0}
                    className="flex items-center gap-2 px-4 py-2 rounded-md bg-[#8B5CF6] hover:bg-[#7C3AED] active:scale-[0.97] text-white text-sm font-medium transition-all disabled:opacity-50"
                  >
                    {isExporting && <Loader2 className="w-4 h-4 animate-spin" />}
                    Use This Clip
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
