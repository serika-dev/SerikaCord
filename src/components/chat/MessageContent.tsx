"use client";

import { useEffect, useRef, useMemo } from "react";
import twemoji from "twemoji";
import { cn } from "@/lib/utils";

interface CustomEmoji {
  id: string;
  name: string;
  url: string;
  serverId?: string;
  animated?: boolean;
}

interface MessageContentProps {
  content: string;
  serverEmojis?: CustomEmoji[];
  className?: string;
  edited?: boolean;
  onImageClick?: (src: string, alt?: string) => void;
}

// Check if a URL is an image/GIF
function isImageUrl(url: string): boolean {
  const imageExtensions = /\.(gif|jpg|jpeg|png|webp|svg|bmp)(\?.*)?$/i;
  const imageHosts = /^https?:\/\/(cdn\.ado\.wtf|i\.imgur\.com|media\.tenor\.com|media\.giphy\.com|cdn\.discordapp\.com)/i;
  return imageExtensions.test(url) || imageHosts.test(url);
}

// Check if a string is only a URL (possibly with whitespace)
function isOnlyUrl(text: string): boolean {
  const trimmed = text.trim();
  const urlRegex = /^https?:\/\/[^\s]+$/i;
  return urlRegex.test(trimmed);
}

// Check if a string contains only emoji characters (including custom emoji syntax)
function isOnlyEmoji(text: string, customEmojiCount: number): boolean {
  // Remove whitespace and custom emoji placeholders
  const stripped = text.replace(/\s/g, "").replace(/:[a-zA-Z0-9_]+:/g, "");
  const emojiRegex = /^(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)*$/u;
  
  // Check if remaining chars are only emojis and total emoji count is small
  const unicodeEmojiCount = (stripped.match(/(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)/gu) || []).length;
  const totalEmojis = unicodeEmojiCount + customEmojiCount;
  
  return emojiRegex.test(stripped) && totalEmojis > 0 && totalEmojis <= 6;
}

export function MessageContent({ content, serverEmojis = [], className, edited, onImageClick }: MessageContentProps) {
  const textRef = useRef<HTMLSpanElement>(null);

  // Check if the entire message is just an image URL
  const imageOnlyUrl = useMemo(() => {
    if (isOnlyUrl(content) && isImageUrl(content.trim())) {
      return content.trim();
    }
    return null;
  }, [content]);

  // Parse content to identify custom emojis and inline images
  const parsedContent = useMemo(() => {
    if (imageOnlyUrl) {
      // Don't parse if it's just an image URL
      return { parts: [], customEmojiCount: 0 };
    }

    const customEmojiRegex = /:([a-zA-Z0-9_]+):/g;
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts: Array<{ type: "text" | "custom-emoji" | "image" | "link"; content: string; emoji?: CustomEmoji; url?: string }> = [];
    
    // First, split by URLs
    let lastIndex = 0;
    let urlMatch;
    const segments: Array<{ type: "text" | "url"; content: string }> = [];
    
    while ((urlMatch = urlRegex.exec(content)) !== null) {
      if (urlMatch.index > lastIndex) {
        segments.push({ type: "text", content: content.slice(lastIndex, urlMatch.index) });
      }
      segments.push({ type: "url", content: urlMatch[0] });
      lastIndex = urlMatch.index + urlMatch[0].length;
    }
    if (lastIndex < content.length) {
      segments.push({ type: "text", content: content.slice(lastIndex) });
    }

    let customEmojiCount = 0;

    // Process each segment
    for (const segment of segments) {
      if (segment.type === "url") {
        if (isImageUrl(segment.content)) {
          parts.push({ type: "image", content: segment.content, url: segment.content });
        } else {
          parts.push({ type: "link", content: segment.content, url: segment.content });
        }
      } else {
        // Process text for custom emojis
        let textLastIndex = 0;
        let emojiMatch;
        const textContent = segment.content;
        customEmojiRegex.lastIndex = 0;

        while ((emojiMatch = customEmojiRegex.exec(textContent)) !== null) {
          if (emojiMatch.index > textLastIndex) {
            parts.push({ type: "text", content: textContent.slice(textLastIndex, emojiMatch.index) });
          }

          const emojiName = emojiMatch[1];
          const foundEmoji = serverEmojis.find(e => e.name.toLowerCase() === emojiName.toLowerCase());

          if (foundEmoji) {
            parts.push({ type: "custom-emoji", content: emojiMatch[0], emoji: foundEmoji });
            customEmojiCount++;
          } else {
            parts.push({ type: "text", content: emojiMatch[0] });
          }

          textLastIndex = emojiMatch.index + emojiMatch[0].length;
        }

        if (textLastIndex < textContent.length) {
          parts.push({ type: "text", content: textContent.slice(textLastIndex) });
        }
      }
    }

    return { parts, customEmojiCount };
  }, [content, serverEmojis, imageOnlyUrl]);

  // Determine if message is emoji-only for larger display
  const isLargeEmoji = useMemo(() => {
    if (imageOnlyUrl) return false;
    return isOnlyEmoji(content, parsedContent.customEmojiCount);
  }, [content, parsedContent.customEmojiCount, imageOnlyUrl]);

  // Apply twemoji to text parts after render
  useEffect(() => {
    if (textRef.current) {
      const textSpans = textRef.current.querySelectorAll(".twemoji-text");
      textSpans.forEach((span) => {
        twemoji.parse(span as HTMLElement, {
          folder: "svg",
          ext: ".svg",
          className: "emoji",
        });
      });
    }
  }, [content, serverEmojis]);

  const emojiSize = isLargeEmoji ? "w-10 h-10" : "w-5 h-5";

  // If the message is just an image URL, render it as a large image
  if (imageOnlyUrl) {
    return (
      <div className={className}>
        <img
          src={imageOnlyUrl}
          alt="Image"
          className="max-w-md max-h-80 rounded-md cursor-pointer hover:opacity-90 transition-opacity"
          onClick={() => onImageClick?.(imageOnlyUrl, "Image")}
          loading="lazy"
        />
        {edited && <span className="text-xs text-[#555555] ml-1">(edited)</span>}
      </div>
    );
  }

  return (
    <span 
      ref={textRef} 
      className={cn(
        isLargeEmoji ? "twemoji-large" : "twemoji",
        className
      )}
    >
      {parsedContent.parts.map((part, index) => {
        if (part.type === "custom-emoji" && part.emoji) {
          return (
            <img
              key={`emoji-${index}-${part.emoji.id}`}
              src={part.emoji.url}
              alt={`:${part.emoji.name}:`}
              title={`:${part.emoji.name}:`}
              className={cn(
                "inline-block align-middle mx-0.5",
                emojiSize,
                part.emoji.animated && "animate-pulse"
              )}
              loading="lazy"
            />
          );
        }
        if (part.type === "image" && part.url) {
          return (
            <span key={`image-${index}`} className="block my-2">
              <img
                src={part.url}
                alt="Image"
                className="max-w-md max-h-80 rounded-md cursor-pointer hover:opacity-90 transition-opacity"
                onClick={() => onImageClick?.(part.url!, "Image")}
                loading="lazy"
              />
            </span>
          );
        }
        if (part.type === "link" && part.url) {
          return (
            <a
              key={`link-${index}`}
              href={part.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#00AFF4] hover:underline"
            >
              {part.content}
            </a>
          );
        }
        return (
          <span key={`text-${index}`} className="twemoji-text">
            {part.content}
          </span>
        );
      })}
      {edited && <span className="text-xs text-[#555555] ml-1">(edited)</span>}
    </span>
  );
}
