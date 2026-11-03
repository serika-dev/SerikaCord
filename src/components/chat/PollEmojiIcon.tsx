"use client";

import { cn } from "@/lib/utils";
import { Twemoji } from "@/components/ui/twemoji";
import { isPollEmojiUrl, isPollUnicodeEmoji, type PollEmoji } from "@/lib/chat/polls";

/**
 * A poll answer's emoji: twemoji for unicode, the image for a custom emoji.
 * Only images on our CDN render (a stored or forged URL elsewhere shows nothing).
 */
export function PollEmojiIcon({ emoji, className }: { emoji: PollEmoji; className?: string }) {
  if (emoji.id) {
    if (!isPollEmojiUrl(emoji.url)) return null;
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={emoji.url} alt={`:${emoji.name}:`} className={cn("h-5 w-5 object-contain", className)} loading="lazy" />;
  }
  if (!isPollUnicodeEmoji(emoji.name)) return null;
  return (
    <span className={cn("inline-flex h-5 w-5 items-center justify-center", className)}>
      <Twemoji>{emoji.name}</Twemoji>
    </span>
  );
}
