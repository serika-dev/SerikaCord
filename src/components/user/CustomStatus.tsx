"use client";

import type { ReactNode } from "react";
import { activeCustomStatus, type CustomStatusEmoji } from "@/lib/social/customStatus";
import { safeStatusEmojiUrl } from "@/lib/profiles/customizationSafety";
import { cn, cdnImage } from "@/lib/utils";

const CDN_BASE = process.env.NEXT_PUBLIC_CDN_URL || "https://cdn.serika.chat";

/** A custom status emoji: unicode text or a custom emoji image. */
export function StatusEmoji({ emoji, className }: { emoji: CustomStatusEmoji; className?: string }) {
  // Only our CDN (or a same-origin path) goes into <img src>; a stored URL
  // from before server validation is not rendered.
  const url = emoji.url ? safeStatusEmojiUrl(emoji.url, CDN_BASE) : null;
  const name = typeof emoji.name === "string" ? emoji.name : "";
  if (emoji.url) {
    if (!url) return null;
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={cdnImage(url)} alt={`:${name}:`} title={`:${name}:`} className={cn("inline-block w-4 h-4 object-contain align-[-3px]", className)} draggable={false} />;
  }
  return <span className={cn("inline-block leading-none", className)} aria-hidden>{name}</span>;
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
