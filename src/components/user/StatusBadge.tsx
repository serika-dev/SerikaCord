"use client";

/**
 * Discord-style presence badge, drawn as one crisp SVG at any size:
 *
 *   online    green filled circle
 *   idle      yellow crescent moon
 *   dnd       red circle with a white rounded bar
 *   offline   grey hollow ring (also "invisible")
 *   streaming purple circle with a play cut-out
 *
 * `ring` paints a cutout ring in `ringColor` around the shape so it looks
 * punched out of the avatar it sits on (pass the colour of the surface behind
 * the avatar). `corner` pins it to the bottom-right of a `relative` avatar box,
 * where Discord puts it. Use `StatusIcon` (no ring, decorative) for status
 * menus and pickers next to a text label.
 *
 * Colours come from the `--status-*` tokens in globals.css.
 */

import type { CSSProperties } from "react";
import { useGT } from "gt-next";
import { cn } from "@/lib/utils";

export type PresenceStatus = "online" | "idle" | "dnd" | "offline" | "invisible" | "streaming";

const COLOR: Record<PresenceStatus, string> = {
  online: "var(--status-online, #23a55a)",
  idle: "var(--status-idle, #f0b232)",
  dnd: "var(--status-dnd, #f23f43)",
  offline: "var(--status-offline, #80848e)",
  invisible: "var(--status-offline, #80848e)",
  streaming: "var(--status-streaming, #593695)",
};

/** Any stored / client status string mapped to a badge shape. */
export function toPresenceStatus(status: string | null | undefined): PresenceStatus {
  switch (status) {
    case "online":
    case "idle":
    case "dnd":
    case "invisible":
    case "streaming":
      return status;
    default:
      return "offline";
  }
}

/** The theme colour of a status (for text or accents next to a badge). */
export function presenceColor(status: string | null | undefined): string {
  return COLOR[toPresenceStatus(status)];
}

// Lucide "moon", whose outer arc is a radius-9 circle centred on (12,12):
// scaled from its 3..21 box onto the badge's 10-unit circle.
const MOON_PATH =
  "M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401";
const MOON_TRANSFORM = "scale(0.5555556) translate(-3 -3)";

/** The 10×10-unit status shape (circle of radius 5 centred on 5,5). */
function Shape({ status, small }: { status: PresenceStatus; small: boolean }) {
  const fill = COLOR[status];
  switch (status) {
    case "online":
      return <circle cx={5} cy={5} r={5} fill={fill} />;
    case "idle":
      // At very small sizes a hairline of the same colour keeps the crescent's
      // tips from fading out in anti-aliasing; at larger sizes it's pure fill.
      return (
        <path
          d={MOON_PATH}
          transform={MOON_TRANSFORM}
          fill={fill}
          stroke={small ? fill : "none"}
          strokeWidth={small ? 0.9 : 0}
          strokeLinejoin="round"
        />
      );
    case "dnd":
      return (
        <>
          <circle cx={5} cy={5} r={5} fill={fill} />
          <rect x={1.25} y={3.75} width={7.5} height={2.5} rx={1.25} fill="var(--status-glyph, #fff)" />
        </>
      );
    case "streaming":
      return (
        <path
          fillRule="evenodd"
          fill={fill}
          d="M5 0a5 5 0 1 1 0 10A5 5 0 0 1 5 0ZM3.9 2.85v4.3a.4.4 0 0 0 .6.35l3.5-2.15a.4.4 0 0 0 0-.7L4.5 2.5a.4.4 0 0 0-.6.35Z"
        />
      );
    default:
      // Hollow ring: the hole shows whatever is behind (the cutout ring, or
      // the surface when there is no ring).
      return (
        <path
          fillRule="evenodd"
          fill={fill}
          d="M5 0a5 5 0 1 1 0 10A5 5 0 0 1 5 0Zm0 2.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 0 0 0-5Z"
        />
      );
  }
}

export interface StatusBadgeProps {
  status?: string | null;
  /** Diameter of the status shape in px (the ring is drawn outside it). */
  size?: number;
  /** Cutout ring width in px; defaults to ~30% of `size`. 0 for no ring. */
  ring?: number;
  /** Colour of the surface behind the avatar. */
  ringColor?: string;
  /** Pin to the bottom-right corner of a `relative` avatar box. */
  corner?: boolean;
  /** Overrides the accessible label (e.g. a custom status). */
  label?: string;
  /** Hide from assistive tech (a text label is right next to it). */
  decorative?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function StatusBadge({
  status,
  size = 10,
  ring,
  ringColor = "var(--app-bg-solid)",
  corner = false,
  label,
  decorative = false,
  className,
  style,
}: StatusBadgeProps) {
  const gt = useGT();
  const s = toPresenceStatus(status);
  const ringPx = Math.max(0, ring ?? Math.max(2, Math.round(size * 0.3)));
  const total = size + ringPx * 2;
  // Ring width in the 10-unit shape frame.
  const r = (ringPx * 10) / size;

  let text = label;
  if (!text && !decorative) {
    switch (s) {
      case "online": text = gt("Online"); break;
      case "idle": text = gt("Idle"); break;
      case "dnd": text = gt("Do Not Disturb"); break;
      case "invisible": text = gt("Invisible"); break;
      case "streaming": text = gt("Streaming"); break;
      default: text = gt("Offline");
    }
  }

  return (
    <svg
      width={total}
      height={total}
      viewBox={`${-r} ${-r} ${10 + r * 2} ${10 + r * 2}`}
      role={decorative ? undefined : "img"}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : text}
      className={cn("block shrink-0 pointer-events-auto", corner && "absolute z-[1]", className)}
      style={corner ? { right: -ringPx, bottom: -ringPx, ...style } : style}
      data-status={s}
    >
      {!decorative && text ? <title>{text}</title> : null}
      {ringPx > 0 ? <circle cx={5} cy={5} r={5 + r} fill={ringColor} /> : null}
      <Shape status={s} small={size < 14} />
    </svg>
  );
}

/** A status shape for menus and pickers (no cutout ring, decorative). */
export function StatusIcon({ status, size = 10, className }: { status?: string | null; size?: number; className?: string }) {
  return <StatusBadge status={status} size={size} ring={0} decorative className={className} />;
}
