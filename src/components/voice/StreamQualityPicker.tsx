"use client";

import { useEffect, useState } from "react";
import { useGT } from "gt-next";
import { ChevronUp, MonitorUp } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { voiceService } from "@/lib/services/voiceService";
import {
  STREAM_FRAME_RATES,
  STREAM_RESOLUTIONS,
  saveStreamQuality,
  type StreamQuality,
} from "@/lib/voice/streamQuality";

/**
 * Discord's stream quality picker: resolution (720p / 1080p / 1440p /
 * Source) and frame rate (15 / 30 / 60). Before sharing it ends in "Go Live";
 * while sharing, a change applies to the live stream at once. The choice is
 * remembered on this device.
 */
export function StreamQualityPicker({
  sharing,
  onStarted,
  className,
  side = "top",
}: {
  sharing: boolean;
  /** Called with the result of starting a share from the picker. */
  onStarted?: (started: boolean) => void;
  className?: string;
  side?: "top" | "bottom";
}) {
  const gt = useGT();
  const [open, setOpen] = useState(false);
  const [quality, setQuality] = useState<StreamQuality>(() => voiceService.screenShareQuality);

  useEffect(() => voiceService.subscribe((event) => {
    if (event.type === "stream_quality_changed") setQuality(event.quality);
  }), []);

  const choose = (patch: Partial<StreamQuality>) => {
    const next = { ...quality, ...patch };
    setQuality(next);
    saveStreamQuality(next);
    void voiceService.setScreenShareQuality(next);
  };

  const goLive = async () => {
    setOpen(false);
    const started = await voiceService.startScreenShare(quality);
    onStarted?.(started);
  };

  const option = (active: boolean) => cn(
    "flex-1 rounded-md px-2 py-1.5 text-xs font-semibold transition-colors",
    active
      ? "bg-[var(--app-accent)] text-[var(--text-on-accent)]"
      : "bg-[var(--bg-sidebar-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={gt("Stream Quality")}
          aria-label={gt("Stream Quality")}
          className={cn(
            "flex items-center justify-center rounded-full text-[var(--app-muted)] transition-colors hover:text-[var(--text-primary)]",
            className,
          )}
        >
          <ChevronUp className={cn("h-3.5 w-3.5", side === "bottom" && "rotate-180")} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        className="w-64 border-[var(--border-subtle)] bg-[var(--bg-card)] p-3 text-[var(--text-primary)]"
      >
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">{gt("Resolution")}</p>
        <div className="mb-3 flex gap-1" role="radiogroup" aria-label={gt("Resolution")}>
          {STREAM_RESOLUTIONS.map((r) => (
            <button
              key={String(r)}
              type="button"
              role="radio"
              aria-checked={quality.resolution === r}
              onClick={() => choose({ resolution: r })}
              className={option(quality.resolution === r)}
            >
              {r === "source" ? gt("Source") : `${r}p`}
            </button>
          ))}
        </div>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">{gt("Frame Rate")}</p>
        <div className="flex gap-1" role="radiogroup" aria-label={gt("Frame Rate")}>
          {STREAM_FRAME_RATES.map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={quality.frameRate === f}
              onClick={() => choose({ frameRate: f })}
              className={option(quality.frameRate === f)}
            >
              {gt("{fps} FPS", { fps: f })}
            </button>
          ))}
        </div>
        {!sharing && (
          <button
            type="button"
            onClick={() => void goLive()}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md bg-[var(--app-accent)] px-3 py-2 text-sm font-semibold text-[var(--text-on-accent)] hover:opacity-90"
          >
            <MonitorUp className="h-4 w-4" />
            {gt("Go Live")}
          </button>
        )}
        {sharing && (
          <p className="mt-3 text-xs text-[var(--text-muted)]">{gt("Changes apply to your stream right away.")}</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
