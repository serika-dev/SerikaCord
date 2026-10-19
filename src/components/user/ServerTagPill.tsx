"use client";

import { memo } from "react";
import {
  Leaf, Star, Heart, Flame, Zap, Crown, Shield, Sword, Gamepad2, Music, Moon, Sun,
  Skull, Ghost, Gem, Rocket, PawPrint, Flower2, Coffee, Sparkles, type LucideIcon,
} from "lucide-react";
import { useGT } from "gt-next";
import { cn } from "@/lib/utils";
import { resolvedTagOf, type ResolvedServerTag, type ServerTagIcon } from "@/lib/servers/serverProfile";

export const SERVER_TAG_ICON_COMPONENTS: Record<ServerTagIcon, LucideIcon> = {
  leaf: Leaf,
  star: Star,
  heart: Heart,
  flame: Flame,
  zap: Zap,
  crown: Crown,
  shield: Shield,
  sword: Sword,
  gamepad: Gamepad2,
  music: Music,
  moon: Moon,
  sun: Sun,
  skull: Skull,
  ghost: Ghost,
  gem: Gem,
  rocket: Rocket,
  paw: PawPrint,
  flower: Flower2,
  coffee: Coffee,
  sparkles: Sparkles,
};

/** The badge glyph of a server tag: server emoji, unicode emoji, or preset icon. */
export function ServerTagBadge({ tag, size = 12 }: { tag: Pick<ResolvedServerTag, "icon" | "color" | "emoji" | "emojiUrl">; size?: number }) {
  if (tag.emojiUrl) {
    return <img src={tag.emojiUrl} alt="" width={size} height={size} className="shrink-0 object-contain" style={{ width: size, height: size }} loading="lazy" />;
  }
  if (tag.emoji) {
    return <span className="shrink-0 leading-none" style={{ fontSize: size }} aria-hidden>{tag.emoji}</span>;
  }
  const Icon = SERVER_TAG_ICON_COMPONENTS[tag.icon] ?? Star;
  return <Icon className="shrink-0" style={{ width: size, height: size, color: tag.color }} aria-hidden />;
}

interface ServerTagPillProps {
  /** A payload customization object (the API resolves `serverTag` in it). */
  customization?: unknown;
  /** Or an already-resolved tag (previews). */
  tag?: ResolvedServerTag | null;
  className?: string;
  size?: "sm" | "md";
}

/**
 * The server tag (CORD-53) shown next to a user's name. Renders nothing when
 * the payload carries no resolved tag. Data comes from the author/member
 * payload already loaded, never from a per-message fetch.
 */
export const ServerTagPill = memo(function ServerTagPill({ customization, tag: tagProp, className, size = "sm" }: ServerTagPillProps) {
  const gt = useGT();
  const tag = tagProp ?? resolvedTagOf(customization);
  if (!tag) return null;
  const title = tag.serverName
    ? gt("Server tag: {server}", { server: tag.serverName })
    : gt("Server tag");
  return (
    <span
      title={title}
      aria-label={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border shrink-0 select-none leading-none font-semibold",
        "border-[var(--border-subtle)] bg-[var(--bg-hover)] text-[var(--text-primary)]",
        size === "sm" ? "px-1 py-0.5 text-[10px]" : "px-1.5 py-1 text-xs",
        className,
      )}
    >
      <ServerTagBadge tag={tag} size={size === "sm" ? 11 : 14} />
      <span>{tag.tag}</span>
    </span>
  );
});
