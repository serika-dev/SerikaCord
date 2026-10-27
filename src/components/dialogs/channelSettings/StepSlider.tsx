"use client";

import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

/**
 * Discord's stepped settings slider: a track over `0…max` with labelled
 * ticks under it and the current value in a pill on the right.
 */
export function StepSlider({
  value,
  max,
  onChange,
  ticks,
  valueLabel,
  ariaLabel,
  ariaValueText,
  disabled,
}: {
  value: number;
  max: number;
  onChange: (value: number) => void;
  /** Positions (0…max) with their labels. */
  ticks: ReadonlyArray<{ at: number; label: string; minor?: boolean }>;
  valueLabel: string;
  ariaLabel: string;
  ariaValueText?: string;
  disabled?: boolean;
}) {
  return (
    <div className={cn("flex items-start gap-4", disabled && "opacity-60")}>
      <div className="min-w-0 flex-1 pt-1.5">
        <Slider
          min={0}
          max={max}
          step={1}
          value={[value]}
          onValueChange={(v) => onChange(v[0] ?? 0)}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-valuetext={ariaValueText ?? valueLabel}
          className="cursor-pointer data-[disabled]:cursor-not-allowed"
        />
        <div aria-hidden className="relative mt-2 h-4 select-none">
          {ticks.map((tick) => {
            const pct = max > 0 ? (tick.at / max) * 100 : 0;
            return (
              <span
                key={tick.at}
                className={cn(
                  "absolute top-0 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium tabular-nums",
                  tick.at === value ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]",
                  // Every other label hides on phones so they never overlap.
                  tick.minor && "max-sm:hidden",
                )}
                style={{ left: `calc(${pct}% + ${8 - (pct / 100) * 16}px)` }}
              >
                {tick.label}
              </span>
            );
          })}
        </div>
      </div>
      <span className="mt-0.5 min-w-[64px] shrink-0 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-input)] px-2.5 py-1 text-center text-xs font-semibold tabular-nums text-[var(--text-primary)]">
        {valueLabel}
      </span>
    </div>
  );
}
