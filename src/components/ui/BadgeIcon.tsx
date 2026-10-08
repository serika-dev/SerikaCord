"use client";

import { createElement, useState, type CSSProperties } from "react";
import { getBadgeIconComponent } from "@/lib/badges/icons";
import { badgeIconSrc, type BadgeDefinition } from "@/lib/badges/shared";
import { cdnImage, cn } from "@/lib/utils";

type BadgeIconSource = Pick<BadgeDefinition, "icon" | "iconUrl" | "color"> & { name?: string };

interface BadgeIconProps {
  badge: BadgeIconSource;
  /** Pixel size; omit to size with className instead. */
  size?: number;
  className?: string;
  style?: CSSProperties;
  strokeWidth?: number;
}

/**
 * The glyph for a badge: its custom image (iconUrl) when set, otherwise the
 * allowlisted lucide icon by name, tinted with the badge colour. A broken
 * image falls back to the lucide icon so a bad URL never leaves a hole.
 */
export function BadgeIcon({ badge, size, className, style, strokeWidth = 2 }: BadgeIconProps) {
  const src = badgeIconSrc(badge.iconUrl);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (src && failedSrc !== src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- tiny remote badge art, no next/image loader
      <img
        src={cdnImage(src)}
        alt={badge.name || ""}
        width={size}
        height={size}
        className={cn("object-contain", className)}
        style={style}
        loading="lazy"
        decoding="async"
        draggable={false}
        referrerPolicy="no-referrer"
        onError={() => setFailedSrc(src)}
      />
    );
  }

  // createElement: the component comes from a static allowlist map, not
  // something created during render.
  return createElement(getBadgeIconComponent(badge.icon), {
    className,
    width: size,
    height: size,
    color: badge.color,
    strokeWidth,
    style,
    "aria-hidden": true,
  });
}
