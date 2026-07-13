"use client";

import { useEffect, useRef, useMemo, memo } from "react";
import twemoji from "twemoji";
import { useChatGt } from "./ChatGtContext";
import { cn } from "@/lib/utils";
import { isImageLikeUrl, isGifUrl, isGifProviderUrl } from "@/lib/chat/media";
import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";
import { GifFavoriteButton } from "@/components/chat/GifFavoriteButton";
import { MemberProfilePopup } from "@/components/user/MemberProfilePopup";
import { decodeHtmlEntities } from "@/lib/chat/messages";

interface CustomEmoji {
  id: string;
  name: string;
  url: string;
  imageUrl?: string;
  _id?: string;
  serverId?: string;
  animated?: boolean;
}

interface MentionUser {
  id: string;
  username?: string;
  displayName?: string;
}

interface MentionRole {
  id: string;
  name: string;
  color?: string;
}

interface MessageContentProps {
  content: string;
  serverEmojis?: CustomEmoji[];
  mentionUsers?: MentionUser[];
  mentionRoles?: MentionRole[];
  currentUserId?: string;
  serverId?: string;
  className?: string;
  edited?: boolean;
  sticker?: {
    id: string;
    name: string;
    imageUrl: string;
  };
  onMediaClick?: (media: { src: string; alt?: string; messageId?: string }) => void;
  onImageClick?: (src: string, alt?: string) => void;
  /** Passed back through onMediaClick so parents can keep a stable handler */
  messageId?: string;
}

// Check if a string is only a URL (possibly with whitespace)
function isOnlyUrl(text: string): boolean {
  const trimmed = text.trim();
  const urlRegex = /^https?:\/\/[^\s]+$/i;
  return urlRegex.test(trimmed);
}

// Check if a string contains only emoji characters (including custom emoji syntax)
function isOnlyEmoji(text: string, customEmojiCount: number): boolean {
  // Remove whitespace and custom emoji placeholders. Full custom-emoji tokens
  // (<:name:id> / <a:name:id>) must be stripped too, otherwise a message made
  // only of custom emojis leaves behind the raw id and fails the emoji check.
  const stripped = text
    .replace(/\s/g, "")
    .replace(/<a?:[a-zA-Z0-9_]{2,32}:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}>/g, "")
    .replace(/:[a-zA-Z_][a-zA-Z0-9_]*:/g, "");
  const emojiRegex = /^(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)*$/u;
  
  // Check if remaining chars are only emojis and total emoji count is small
  const unicodeEmojiCount = (stripped.match(/(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)/gu) || []).length;
  const totalEmojis = unicodeEmojiCount + customEmojiCount;
  
  return emojiRegex.test(stripped) && totalEmojis > 0 && totalEmojis <= 6;
}

// Memoized: message rows must not re-parse/re-render while the composer or
// unrelated chat state changes.
export const MessageContent = memo(function MessageContent({
  content,
  serverEmojis = [],
  mentionUsers = [],
  mentionRoles = [],
  currentUserId,
  serverId,
  className,
  edited,
  sticker,
  onMediaClick,
  onImageClick,
  messageId,
}: MessageContentProps) {
  const gt = useChatGt();
  const textRef = useRef<HTMLSpanElement>(null);
  const mentionUserMap = useMemo(() => {
    const map = new Map<string, MentionUser>();
    for (const mentionUser of mentionUsers) {
      if (mentionUser?.id) {
        map.set(mentionUser.id, mentionUser);
      }
    }
    return map;
  }, [mentionUsers]);
  const mentionRoleMap = useMemo(() => {
    const map = new Map<string, MentionRole>();
    for (const mentionRole of mentionRoles) {
      if (mentionRole?.id) {
        map.set(mentionRole.id, mentionRole);
      }
    }
    return map;
  }, [mentionRoles]);
  const handleMediaClick = (src: string, alt?: string) => {
    onMediaClick?.({ src, alt, messageId });
    onImageClick?.(src, alt);
  };

  // Decode any legacy HTML entities, then strip /tts prefix for display
  const decodedContent = decodeHtmlEntities(content);
  const isTtsMessage = decodedContent.startsWith("/tts ");
  const displayContent = isTtsMessage ? decodedContent.slice(5) : decodedContent;

  // Check if the entire message is just an image URL
  const imageOnlyUrl = useMemo(() => {
    if (isOnlyUrl(displayContent) && isImageLikeUrl(displayContent.trim())) {
      return displayContent.trim();
    }
    return null;
  }, [displayContent]);

  // Parse content to identify custom emojis and inline images
  const parsedContent = useMemo(() => {
    if (imageOnlyUrl) {
      // Don't parse if it's just an image URL
      return { parts: [], customEmojiCount: 0 };
    }

    const tokenRegex = /<@!?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>|<@&([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>|(?<!\S)@(everyone|here)\b|<(a)?:([a-zA-Z0-9_]+):([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>|:([a-zA-Z_][a-zA-Z0-9_]*):/gi;
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts: Array<{
      type: "text" | "custom-emoji" | "image" | "link" | "mention-user" | "mention-role" | "mention-special";
      content: string;
      emoji?: CustomEmoji;
      url?: string;
      mentionId?: string;
      mentionKind?: "everyone" | "here";
    }> = [];
    
    // First, split by URLs
    let lastIndex = 0;
    let urlMatch;
    const segments: Array<{ type: "text" | "url"; content: string }> = [];
    
    while ((urlMatch = urlRegex.exec(displayContent)) !== null) {
      if (urlMatch.index > lastIndex) {
        segments.push({ type: "text", content: displayContent.slice(lastIndex, urlMatch.index) });
      }
      segments.push({ type: "url", content: urlMatch[0] });
      lastIndex = urlMatch.index + urlMatch[0].length;
    }
    if (lastIndex < displayContent.length) {
      segments.push({ type: "text", content: displayContent.slice(lastIndex) });
    }

    let customEmojiCount = 0;

    // Process each segment
    for (const segment of segments) {
      if (segment.type === "url") {
        if (isImageLikeUrl(segment.content)) {
          parts.push({ type: "image", content: segment.content, url: segment.content });
        } else {
          parts.push({ type: "link", content: segment.content, url: segment.content });
        }
      } else {
        // Process text for custom emojis and mentions
        let textLastIndex = 0;
        let tokenMatch;
        const textContent = segment.content;
        tokenRegex.lastIndex = 0;

        while ((tokenMatch = tokenRegex.exec(textContent)) !== null) {
          if (tokenMatch.index > textLastIndex) {
            parts.push({ type: "text", content: textContent.slice(textLastIndex, tokenMatch.index) });
          }

          const userMentionId = tokenMatch[1];
          const roleMentionId = tokenMatch[2];
          const specialMention = tokenMatch[3] as "everyone" | "here" | undefined;
          const emojiName = (tokenMatch[5] || tokenMatch[7] || "").toLowerCase();
          const emojiId = tokenMatch[6];

          if (userMentionId) {
            parts.push({
              type: "mention-user",
              content: tokenMatch[0],
              mentionId: userMentionId,
            });
            textLastIndex = tokenMatch.index + tokenMatch[0].length;
            continue;
          }

          if (roleMentionId) {
            parts.push({
              type: "mention-role",
              content: tokenMatch[0],
              mentionId: roleMentionId,
            });
            textLastIndex = tokenMatch.index + tokenMatch[0].length;
            continue;
          }

          if (specialMention) {
            parts.push({
              type: "mention-special",
              content: `@${specialMention}`,
              mentionKind: specialMention,
            });
            textLastIndex = tokenMatch.index + tokenMatch[0].length;
            continue;
          }

          const foundEmoji = serverEmojis.find((e) => {
            const normalizedName = e.name?.toLowerCase?.() || "";
            const normalizedId = e.id || e._id;
            return normalizedName === emojiName || (emojiId && normalizedId === emojiId);
          });

          if (foundEmoji) {
            parts.push({ type: "custom-emoji", content: tokenMatch[0], emoji: foundEmoji });
            customEmojiCount++;
          } else {
            parts.push({ type: "text", content: tokenMatch[0] });
          }

          textLastIndex = tokenMatch.index + tokenMatch[0].length;
        }

        if (textLastIndex < textContent.length) {
          parts.push({ type: "text", content: textContent.slice(textLastIndex) });
        }
      }
    }

    return { parts, customEmojiCount };
  }, [displayContent, serverEmojis, imageOnlyUrl]);

  // Determine if message is emoji-only for larger display
  const isLargeEmoji = useMemo(() => {
    if (imageOnlyUrl) return false;
    return isOnlyEmoji(displayContent, parsedContent.customEmojiCount);
  }, [displayContent, parsedContent.customEmojiCount, imageOnlyUrl]);

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
  }, [displayContent, serverEmojis]);

  // If the message has a sticker, render it as a smaller Discord-like sticker
  if (sticker) {
    return (
      <div className={className}>
        <img
          src={sticker.imageUrl}
          alt={sticker.name}
          title={sticker.name}
          className="max-w-[160px] max-h-[160px] w-auto h-auto object-contain cursor-pointer hover:opacity-90 transition-opacity rounded-lg"
          onClick={() => handleMediaClick(sticker.imageUrl, sticker.name)}
          loading="lazy"
        />
        {edited && <span className="text-xs text-[#555555] ml-1">({gt("edited")})</span>}
      </div>
    );
  }

  // If the message is just an image URL, render it as a large image
  if (imageOnlyUrl) {
    const onlyGif = isGifUrl(imageOnlyUrl);
    return (
      <div className={className}>
        <div className={cn("relative group", onlyGif ? "inline-flex rounded-lg chat-gif-wrap" : "inline-block w-fit")}>
          <img
            src={imageOnlyUrl}
            alt={gt("Image")}
            className="chat-media cursor-pointer hover:opacity-90 transition-opacity block"
            onClick={() => handleMediaClick(imageOnlyUrl, gt("Image"))}
            loading="lazy"
          />
          {onlyGif && (
            <div className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity p-1 bg-black/60 backdrop-blur-sm rounded-full flex items-center justify-center">
              <GifFavoriteButton url={imageOnlyUrl} className="p-0" />
            </div>
          )}
        </div>
        {edited && <span className="text-xs text-[#555555] ml-1">({gt("edited")})</span>}
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
              src={part.emoji.url || part.emoji.imageUrl}
              alt={`:${part.emoji.name}:`}
              title={`:${part.emoji.name}:`}
              className="custom-emoji"
              loading="lazy"
            />
          );
        }
        if (part.type === "image" && part.url) {
          const inlineGif = isGifUrl(part.url);
          return (
            <span key={`image-${index}`} className="block my-2">
              <span className={cn("relative group", inlineGif && "inline-flex rounded-lg chat-gif-wrap")}>
                <img
                  src={part.url}
                  alt={gt("Image")}
                  className="chat-media cursor-pointer hover:opacity-90 transition-opacity block"
                  onClick={() => handleMediaClick(part.url!, gt("Image"))}
                  loading="lazy"
                  />
                  {inlineGif && (
                    <div className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity p-1 bg-black/60 backdrop-blur-sm rounded-full flex items-center justify-center">
                      <GifFavoriteButton url={part.url} className="p-0" />
                  </div>
                )}
              </span>
            </span>
          );
        }
        if (part.type === "link" && part.url) {
          // GIF-provider page links (giphy/tenor/klipy) are rendered as an
          // actual GIF by LinkEmbed, so don't also show the raw URL text.
          if (isGifProviderUrl(part.url)) {
            return null;
          }
          return (
            <a
              key={`link-${index}`}
              href={part.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--app-accent)] hover:underline break-all"
            >
              {part.content}
            </a>
          );
        }
        if (part.type === "mention-user" && part.mentionId) {
          const mentionUser = mentionUserMap.get(part.mentionId);
          const isResolved = Boolean(mentionUser);
          const mentionLabel = mentionUser?.displayName || mentionUser?.username || gt("Unknown User");
          const isSelfMention = Boolean(currentUserId && currentUserId === part.mentionId);
          const mentionSpan = (
            <span
              title={isResolved ? undefined : `User ID: ${part.mentionId}`}
              className={cn(
                "inline-block px-1 py-0.5 rounded font-medium cursor-pointer",
                isSelfMention
                  ? "bg-yellow-500/25 text-yellow-200"
                  : isResolved
                    ? "bg-[var(--app-accent)]/20 text-[var(--app-accent)] hover:bg-[var(--app-accent)]/30"
                    : "bg-[var(--app-surface-alt)] text-[var(--app-muted)] hover:bg-[var(--app-border)]"
              )}
            >
              @{mentionLabel}
            </span>
          );
          // Wrap in MemberProfilePopup if we have enough info to show the card
          if (mentionUser && mentionUser.id && mentionUser.id !== "unknown") {
            return (
              <MemberProfilePopup
                key={`mention-user-${index}-${part.mentionId}`}
                member={{
                  id: mentionUser.id,
                  username: mentionUser.username || "unknown",
                  displayName: mentionUser.displayName,
                }}
                serverId={serverId}
                side="top"
                align="center"
              >
                <button
                  type="button"
                  className="inline focus-visible:outline-2 focus-visible:outline-[#8B5CF6] rounded"
                  onClick={(e) => e.stopPropagation()}
                >
                  {mentionSpan}
                </button>
              </MemberProfilePopup>
            );
          }
          return (
            <span key={`mention-user-${index}-${part.mentionId}`}>
              {mentionSpan}
            </span>
          );
        }
        if (part.type === "mention-role" && part.mentionId) {
          const mentionRole = mentionRoleMap.get(part.mentionId);
          const mentionLabel = mentionRole?.name || gt("role");
          const roleColor = mentionRole?.color || "var(--app-accent)";
          const roleBackgroundColor = roleColor.startsWith("#") ? `${roleColor}22` : "rgba(124, 58, 237, 0.2)";
          return (
            <span
              key={`mention-role-${index}-${part.mentionId}`}
              className="inline-block px-1 py-0.5 rounded font-medium"
              style={{ backgroundColor: roleBackgroundColor, color: roleColor }}
            >
              @{mentionLabel}
            </span>
          );
        }
        if (part.type === "mention-special" && part.mentionKind) {
          return (
            <span
              key={`mention-special-${index}-${part.mentionKind}`}
              className="inline-block px-1 py-0.5 rounded font-medium bg-yellow-500/20 text-yellow-200"
            >
              @{part.mentionKind}
            </span>
          );
        }
        return (
          <span key={`text-${index}`} className="twemoji-text">
            <MarkdownRenderer content={part.content} />
          </span>
        );
      })}
      {isTtsMessage && (
        <span className="inline-flex items-center gap-1 ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-500/15 text-indigo-400 align-middle select-none">
          🔊 {gt("TTS")}
        </span>
      )}
      {edited && <span className="text-xs text-[#555555] ml-1">({gt("edited")})</span>}
    </span>
  );
});
