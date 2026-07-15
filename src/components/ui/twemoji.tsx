"use client";

import { useEffect, useRef, useMemo } from "react";
import twemoji from "@twemoji/api";
import { cn } from "@/lib/utils";

interface CustomEmojiData {
  id: string;
  name: string;
  animated?: boolean;
  url: string;
}

interface TwemojiProps {
  children: React.ReactNode;
  className?: string;
  size?: "normal" | "large";
  customEmojis?: CustomEmojiData[]; // Pre-parsed custom emoji data from backend
}

// Custom emoji regex: <:name:id> or <a:name:id>
const CUSTOM_EMOJI_REGEX = /<(a)?:([a-zA-Z0-9_]{2,32}):([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>/g;

// Check if a string contains only emoji characters (including custom)
function isOnlyEmoji(text: string): boolean {
  // Remove whitespace and custom emoji patterns
  const stripped = text.replace(/\s/g, "").replace(CUSTOM_EMOJI_REGEX, "E");
  const emojiRegex = /^(?:E|\p{Emoji_Presentation}|\p{Emoji}\uFE0F)+$/u;
  return emojiRegex.test(stripped) && stripped.length <= 12;
}

// Parse content and replace custom emojis with img tags
function parseCustomEmojis(content: string, customEmojis?: CustomEmojiData[]): string {
  if (!content || typeof content !== 'string') return content;
  
  // Create a map for quick lookup
  const emojiMap = new Map<string, CustomEmojiData>();
  if (customEmojis) {
    for (const emoji of customEmojis) {
      emojiMap.set(emoji.id, emoji);
    }
  }
  
  return content.replace(CUSTOM_EMOJI_REGEX, (match, animated, name, id) => {
    // Check if we have pre-parsed data
    const emojiData = emojiMap.get(id);
    if (emojiData) {
      return `<img src="${emojiData.url}" alt=":${emojiData.name}:" title=":${emojiData.name}:" class="custom-emoji inline-block align-middle" draggable="false" />`;
    }
    // Fallback: return original text as placeholder
    return `:${name}:`;
  });
}

export function Twemoji({ children, className, size = "normal", customEmojis }: TwemojiProps) {
  const ref = useRef<HTMLSpanElement>(null);
  
  // Pre-process content to handle custom emojis
  const processedContent = useMemo(() => {
    if (typeof children === 'string') {
      return parseCustomEmojis(children, customEmojis);
    }
    return null;
  }, [children, customEmojis]);

  useEffect(() => {
    if (ref.current) {
      twemoji.parse(ref.current, {
        folder: "svg",
        ext: ".svg",
        className: "emoji",
      });
    }
  }, [processedContent, children]);

  // Auto-detect large emojis if the content is only emojis
  const textContent = typeof children === "string" ? children : "";
  const autoSize = isOnlyEmoji(textContent) ? "large" : size;
  const sizeClass = autoSize === "large" ? "twemoji-large" : "twemoji";

  // If we processed custom emojis, use innerHTML
  if (processedContent && processedContent !== children) {
    return (
      <span 
        ref={ref} 
        className={cn(sizeClass, className)}
        dangerouslySetInnerHTML={{ __html: processedContent }}
      />
    );
  }

  return (
    <span ref={ref} className={cn(sizeClass, className)}>
      {children}
    </span>
  );
}
