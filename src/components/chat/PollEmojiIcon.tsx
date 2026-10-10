"use client";

import { cn } from "@/lib/utils";
import { Twemoji } from "@/components/ui/twemoji";
import type { PollEmoji } from "@/lib/chat/polls";

/** A poll answer's emoji: twemoji for unicode, the image for a custom emoji. */
export function PollEmojiIcon({ emoji, className }: { emoji: PollEmoji; className?: string }) {
  if (emoji.id && emoji.url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={emoji.url} alt={`:${emoji.name}:`} className={cn("h-5 w-5 object-contain", className)} loading="lazy" />;
  }
  if (emoji.id) return null;
  return (
    <span className={cn("inline-flex h-5 w-5 items-center justify-center", className)}>
      <Twemoji>{emoji.name}</Twemoji>
    </span>
  );
}
