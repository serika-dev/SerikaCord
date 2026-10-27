"use client";

import { EyeOff, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { useChatGt } from "@/components/chat/ChatGtContext";

/**
 * The cover over spoilered (or explicit-content-filtered) media, shared by
 * uploaded attachments, Components V2 media/file cards and containers so every
 * spoiler looks the same. Place it inside a `relative overflow-hidden` box
 * whose content is already blurred; it fills the box and reveals on click.
 */
export function SpoilerVeil({
  onReveal,
  kind = "spoiler",
  compact = false,
  className,
}: {
  onReveal: () => void;
  kind?: "spoiler" | "sensitive";
  /** Small tiles (multi-image grids): pill only, no second line. */
  compact?: boolean;
  className?: string;
}) {
  const gt = useChatGt();
  const sensitive = kind === "sensitive";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onReveal();
      }}
      aria-label={sensitive ? gt("Sensitive content") : gt("Spoiler")}
      title={gt("Click to reveal")}
      className={cn(
        "group/spoiler absolute inset-0 z-[1] flex flex-col items-center justify-center gap-1.5 rounded-[inherit] px-2 text-center",
        "bg-black/30 transition-colors duration-150 hover:bg-black/15",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--app-accent)]",
        className,
      )}
    >
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full bg-black/75 font-bold uppercase text-white shadow-[0_4px_16px_rgba(0,0,0,0.35)] ring-1 ring-white/15 backdrop-blur-sm",
          "transition-transform duration-150 group-hover/spoiler:scale-105 group-active/spoiler:scale-95",
          compact ? "px-2 py-0.5 text-[9px] tracking-[0.12em]" : "px-3 py-1 text-[11px] tracking-[0.14em]",
        )}
      >
        {sensitive ? <ShieldAlert className={compact ? "size-3" : "size-3.5"} aria-hidden /> : <EyeOff className={compact ? "size-3" : "size-3.5"} aria-hidden />}
        {sensitive ? gt("Sensitive") : gt("Spoiler")}
      </span>
      {!compact && sensitive && (
        <span className="max-w-[16rem] text-[11px] font-medium leading-snug text-white/85 [text-shadow:0_1px_3px_rgba(0,0,0,0.6)]">
          {gt("This media may contain explicit content.")}
        </span>
      )}
    </button>
  );
}
