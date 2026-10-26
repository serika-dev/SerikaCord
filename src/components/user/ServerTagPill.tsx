"use client";

import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import {
  Leaf, Star, Heart, Flame, Zap, Crown, Shield, Sword, Gamepad2, Music, Moon, Sun,
  Skull, Ghost, Gem, Rocket, PawPrint, Flower2, Coffee, Sparkles, type LucideIcon,
} from "lucide-react";
import { useGT } from "gt-next";
import { cn } from "@/lib/utils";
import { resolvedTagOf, type ResolvedServerTag, type ServerTagIcon, isCdnEmojiUrl } from "@/lib/servers/serverProfile";

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
  if (isCdnEmojiUrl(tag.emojiUrl)) {
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
  /**
   * Hovering shows the server card (default). Off inside pickers and the
   * card itself, where the pill is just a preview.
   */
  interactive?: boolean;
  /** Rendered inside the pill after the tag text (e.g. a dropdown chevron). */
  trailing?: ReactNode;
}

// The card's chunk loads on the first hover of any pill, never per message.
const ServerTagHoverCard = dynamic(() => import("@/components/user/ServerTagHoverCard"), { ssr: false });

const OPEN_DELAY_MS = 350;
const CLOSE_DELAY_MS = 150;

/**
 * The server tag (CORD-53) shown next to a user's name. Renders nothing when
 * the payload carries no resolved tag. Data comes from the author/member
 * payload already loaded, never from a per-message fetch; hovering it opens
 * a server card that is mounted only from then on.
 */
export const ServerTagPill = memo(function ServerTagPill({ customization, tag: tagProp, className, size = "sm", interactive = true, trailing }: ServerTagPillProps) {
  const gt = useGT();
  const pillRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPointer = useRef<string>("mouse");
  const [armed, setArmed] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const tag = tagProp ?? resolvedTagOf(customization);
  if (!tag) return null;
  const label = tag.serverName
    ? gt("Server tag: {server}", { server: tag.serverName })
    : gt("Server tag");

  const schedule = (next: boolean, delay: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(next), delay);
  };
  const hoverIn = () => {
    setArmed(true);
    schedule(true, OPEN_DELAY_MS);
  };
  const hoverOut = () => schedule(false, CLOSE_DELAY_MS);

  return (
    <>
      <span
        ref={pillRef}
        aria-label={label}
        title={interactive ? undefined : label}
        onPointerEnter={interactive ? (e) => { if (e.pointerType !== "touch") hoverIn(); } : undefined}
        onPointerLeave={interactive ? (e) => { if (e.pointerType !== "touch") hoverOut(); } : undefined}
        onPointerDown={interactive ? (e) => { lastPointer.current = e.pointerType; } : undefined}
        onClick={interactive ? (e) => {
          // Touch has no hover: a tap toggles the card instead of opening the row.
          if (lastPointer.current !== "touch") return;
          e.stopPropagation();
          setArmed(true);
          setOpen((o) => !o);
        } : undefined}
        className={cn(
          "inline-flex items-center gap-1 rounded-md border shrink-0 select-none leading-none font-semibold",
          "border-[var(--border-subtle)] bg-[var(--bg-hover)] text-[var(--text-primary)]",
          size === "sm" ? "px-1 py-0.5 text-[10px]" : "px-1.5 py-1 text-xs",
          interactive && "cursor-default transition-colors duration-150 hover:border-[color-mix(in_srgb,var(--app-accent)_55%,var(--border-subtle))]",
          className,
        )}
      >
        <ServerTagBadge tag={tag} size={size === "sm" ? 11 : 14} />
        <span>{tag.tag}</span>
        {trailing}
      </span>
      {interactive && armed && (
        <ServerTagHoverCard
          tag={tag}
          anchorRef={pillRef}
          open={open}
          onOpenChange={setOpen}
          onPointerEnter={() => { if (timer.current) clearTimeout(timer.current); }}
          onPointerLeave={hoverOut}
        />
      )}
    </>
  );
});
