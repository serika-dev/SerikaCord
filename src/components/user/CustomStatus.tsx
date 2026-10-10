"use client";

import type { ReactNode } from "react";
import { activeCustomStatus, type CustomStatusEmoji } from "@/lib/social/customStatus";
import { cn, cdnImage } from "@/lib/utils";

/** A custom status emoji: unicode text or a custom emoji image. */
export function StatusEmoji({ emoji, className }: { emoji: CustomStatusEmoji; className?: string }) {
  if (emoji.url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={cdnImage(emoji.url)} alt={`:${emoji.name}:`} title={`:${emoji.name}:`} className={cn("inline-block w-4 h-4 object-contain align-[-3px]", className)} draggable={false} />;
  }
  return <span className={cn("inline-block leading-none", className)} aria-hidden>{emoji.name}</span>;
}

/**
 * Emoji + text of someone's custom status, hidden once its "Clear after"
 * passed. `renderText` lets profiles keep their markdown rendering.
 */
export function CustomStatusLine({
  text,
  customization,
  className,
  emojiClassName,
  emojiOnly = false,
  renderText,
}: {
  text: string | null | undefined;
  customization: unknown;
  className?: string;
  emojiClassName?: string;
  emojiOnly?: boolean;
  renderText?: (text: string) => ReactNode;
}) {
  const status = activeCustomStatus(text, customization);
  if (!status.text && !status.emoji) return null;
  return (
    <span className={cn("inline-flex items-center gap-1 min-w-0", className)}>
      {status.emoji && <StatusEmoji emoji={status.emoji} className={emojiClassName} />}
      {!emojiOnly && status.text && (
        <span className="truncate min-w-0">{renderText ? renderText(status.text) : status.text}</span>
      )}
    </span>
  );
}
