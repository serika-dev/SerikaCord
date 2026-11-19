import { cn } from "@/lib/utils";

/**
 * An iPhone status bar for the homepage phones: time, the Dynamic Island,
 * full signal, Wi-Fi and a full battery. Sized in em, so set the font size on
 * the bar to scale it with the phone. Decorative.
 */
export function IosStatus({ time, className }: { time: string; className?: string }) {
  return (
    <div className={cn("relative flex shrink-0 items-center justify-between font-semibold tabular-nums", className)} aria-hidden>
      <span className="w-[4.6em] text-center tracking-[-0.01em]">{time}</span>
      <span className="absolute left-1/2 top-[0.5em] h-[2.1em] w-[7.4em] -translate-x-1/2 rounded-full bg-black" />
      <span className="flex w-[4.6em] items-center justify-center gap-[0.35em]">
        {/* Signal: four bars, all on. */}
        <svg viewBox="0 0 18 12" className="h-[0.85em] w-auto" fill="currentColor">
          <rect x="0" y="8" width="3" height="4" rx="1" />
          <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
          <rect x="10" y="3" width="3" height="9" rx="1" />
          <rect x="15" y="0" width="3" height="12" rx="1" />
        </svg>
        {/* Wi-Fi. */}
        <svg viewBox="0 0 16 12" className="h-[0.85em] w-auto" fill="currentColor">
          <path d="M8 2.2c2.4 0 4.6.9 6.3 2.5l1.2-1.3A10.8 10.8 0 0 0 8 .4C5.2.4 2.5 1.5.5 3.4l1.2 1.3A9 9 0 0 1 8 2.2Z" />
          <path d="M8 5.6c1.5 0 2.9.6 4 1.6l1.2-1.3A7.6 7.6 0 0 0 8 3.8c-2 0-3.8.8-5.2 2.1L4 7.2a5.8 5.8 0 0 1 4-1.6Z" />
          <path d="M8 9a2.4 2.4 0 0 1 1.7.7L8 11.6 6.3 9.7A2.4 2.4 0 0 1 8 9Z" />
        </svg>
        {/* Battery: full. */}
        <svg viewBox="0 0 27 13" className="h-[0.95em] w-auto">
          <rect x="0.5" y="0.5" width="23" height="12" rx="3.6" fill="none" stroke="currentColor" strokeOpacity="0.4" />
          <rect x="2" y="2" width="20" height="9" rx="2.2" fill="currentColor" />
          <path d="M25 4.3v4.4c.9-.3 1.5-1.2 1.5-2.2s-.6-1.9-1.5-2.2Z" fill="currentColor" fillOpacity="0.45" />
        </svg>
      </span>
    </div>
  );
}

/** The time on every device clock on the homepage (phones, the laptop's taskbar). */
export const DEVICE_TIME = "14:44";
