"use client";

import { Fragment, useEffect, useRef, useMemo, memo, useState, useCallback } from "react";
import twemoji from "@twemoji/api";
import { twemojiOnError } from "@/lib/twemoji-helpers";
import { useChatGt } from "./ChatGtContext";
import { cn, cdnImage } from "@/lib/utils";
import { isImageLikeUrl, isGifUrl, isGifProviderUrl } from "@/lib/chat/media";
import { useAnimatedMedia } from "@/hooks/useAnimatedMedia";
import { MarkdownDocument, type MarkdownTextRenderer } from "@/components/chat/MarkdownRenderer";
import { parseMarkdown, type MarkdownNode, type ParsedMarkdown } from "@/lib/chat/markdown";
import { GifFavoriteButton } from "@/components/chat/GifFavoriteButton";
import { MemberProfilePopup } from "@/components/user/MemberProfilePopup";
import { useUserContextMenu } from "@/components/user/UserContextMenu";
import { decodeHtmlEntities } from "@/lib/chat/messages";
import { Copy, Star, StarOff } from "lucide-react";
import { toast } from "sonner";
import { useEmojiFavorites } from "@/hooks/useEmojiFavorites";
import { createPortal } from "react-dom";
import { EMOJI_TO_NAME } from "@/lib/constants/emojis";

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
  /** Inline mode (e.g. reply previews): render emoji/mentions inline, but never
   *  expand into full-size images/stickers. */
  inline?: boolean;
}

// Check if a string is only a URL (possibly with whitespace)
function isOnlyUrl(text: string): boolean {
  const trimmed = text.trim();
  const urlRegex = /^https?:\/\/[^\s]+$/i;
  return urlRegex.test(trimmed);
}

// Check if a string contains only emoji characters (including custom emoji syntax)
/** One piece of a plain-text (or bare URL) leaf of the parsed markdown. */
type MessagePart = {
  type: "text" | "custom-emoji" | "image" | "link" | "mention-user" | "mention-role" | "mention-special";
  content: string;
  emoji?: CustomEmoji;
  url?: string;
  mentionId?: string;
  mentionKind?: "everyone" | "here";
};

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
  inline = false,
}: MessageContentProps) {
  const gt = useChatGt();
  const animateMedia = useAnimatedMedia();
  const textRef = useRef<HTMLSpanElement>(null);
  // Right-clicking a @mention opens the same user menu as a name or avatar.
  const { openUserMenu, userMenu } = useUserContextMenu(serverId);
  const { isFavorite, toggleFavorite } = useEmojiFavorites();
  const [emojiCtxMenu, setEmojiCtxMenu] = useState<{
    x: number;
    y: number;
    emoji: CustomEmoji;
    isCustom?: boolean;
  } | null>(null);

  // Close emoji context menu on click elsewhere or Escape
  useEffect(() => {
    if (!emojiCtxMenu) return;
    const close = () => setEmojiCtxMenu(null);
    const closeOnEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setEmojiCtxMenu(null);
      }
    };
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", closeOnEsc, { capture: true });
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", closeOnEsc, { capture: true } as EventListenerOptions);
    };
  }, [emojiCtxMenu]);

  const handleEmojiContextMenu = useCallback((e: React.MouseEvent, emoji: CustomEmoji) => {
    e.preventDefault();
    e.stopPropagation();
    setEmojiCtxMenu({ x: e.clientX, y: e.clientY, emoji, isCustom: true });
  }, []);

  // Delegated right-click handler on the whole message span so a right-click on
  // any emoji (custom or standard) reliably opens the emoji menu (and never falls through to
  // the message context menu), regardless of how the emoji <img> was produced.
  const handleSpanContextMenu = useCallback((e: React.MouseEvent) => {
    const img = (e.target as HTMLElement)?.closest?.("img.custom-emoji, img.emoji") as HTMLElement | null;
    if (!img) return; // not an emoji — let the message context menu handle it
    e.preventDefault();
    e.stopPropagation();

    const isCustom = img.classList.contains("custom-emoji");
    if (isCustom) {
      const id = img.getAttribute("data-emoji-id");
      if (!id) return;
      setEmojiCtxMenu({
        x: e.clientX,
        y: e.clientY,
        emoji: {
          id,
          name: img.getAttribute("data-emoji-name") || "emoji",
          url: img.getAttribute("data-emoji-url") || "",
          serverId: img.getAttribute("data-emoji-server") || undefined,
        },
        isCustom: true,
      });
    } else {
      // Standard unicode emoji
      const emojiChar = img.getAttribute("alt") || "";
      setEmojiCtxMenu({
        x: e.clientX,
        y: e.clientY,
        emoji: {
          id: emojiChar,
          name: EMOJI_TO_NAME[emojiChar] || "emoji",
          url: img.getAttribute("src") || "",
        },
        isCustom: false,
      });
    }
  }, []);

  const handleCopyEmojiId = useCallback(() => {
    if (!emojiCtxMenu) return;
    navigator.clipboard?.writeText(emojiCtxMenu.emoji.id);
    toast.success(gt("Copied {id}", { id: emojiCtxMenu.emoji.id }));
    setEmojiCtxMenu(null);
  }, [emojiCtxMenu, gt]);

  const handleToggleEmojiFav = useCallback(() => {
    if (!emojiCtxMenu) return;
    const isCustom = emojiCtxMenu.isCustom;
    toggleFavorite({
      emoji: isCustom ? `:${emojiCtxMenu.emoji.name}:` : emojiCtxMenu.emoji.id,
      name: emojiCtxMenu.emoji.name,
      customEmojiId: isCustom ? emojiCtxMenu.emoji.id : undefined,
      url: isCustom ? (emojiCtxMenu.emoji.url || emojiCtxMenu.emoji.imageUrl) : undefined,
    });
    setEmojiCtxMenu(null);
  }, [emojiCtxMenu, toggleFavorite]);
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

  // Parse the markdown first (blocks, then inline formatting), then split each
  // plain-text leaf into mentions / custom emoji, and each bare URL into a link
  // or inline image. Formatting that wraps a mention or emoji ("**hi <@id>**",
  // "# :wave: welcome", "- @everyone") keeps working because the markdown sees
  // the whole line, and code (inline or fenced) is never tokenized.
  const parsedContent = useMemo(() => {
    const leaves = new Map<MarkdownNode, MessagePart[]>();
    if (imageOnlyUrl) {
      // Don't parse if it's just an image URL
      return { blocks: [] as ParsedMarkdown[], leaves, customEmojiCount: 0 };
    }

    const tokenRegex = /<@!?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>|<@&([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>|(?<!\S)@(everyone|here)\b|<(a)?:([a-zA-Z0-9_]+):([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>|:([a-zA-Z_][a-zA-Z0-9_]*):/gi;
    let customEmojiCount = 0;

    // Mentions and custom emoji in one run of plain text.
    const tokenizeText = (textContent: string): MessagePart[] => {
      const parts: MessagePart[] = [];
      let textLastIndex = 0;
      let tokenMatch: RegExpExecArray | null;
      tokenRegex.lastIndex = 0;
      while ((tokenMatch = tokenRegex.exec(textContent)) !== null) {
        if (tokenMatch.index > textLastIndex) {
          parts.push({ type: "text", content: textContent.slice(textLastIndex, tokenMatch.index) });
        }
        textLastIndex = tokenMatch.index + tokenMatch[0].length;
        const userMentionId = tokenMatch[1];
        const roleMentionId = tokenMatch[2];
        const specialMention = tokenMatch[3] as "everyone" | "here" | undefined;
        const emojiName = (tokenMatch[5] || tokenMatch[7] || "").toLowerCase();
        const emojiId = tokenMatch[6];

        if (userMentionId) {
          parts.push({ type: "mention-user", content: tokenMatch[0], mentionId: userMentionId });
          continue;
        }
        if (roleMentionId) {
          parts.push({ type: "mention-role", content: tokenMatch[0], mentionId: roleMentionId });
          continue;
        }
        if (specialMention) {
          parts.push({ type: "mention-special", content: `@${specialMention}`, mentionKind: specialMention.toLowerCase() as "everyone" | "here" });
          continue;
        }
        // An id-bearing token resolves by id first, so two servers' same-named
        // emojis don't render as each other; the name is only a fallback.
        const foundEmoji =
          (emojiId && serverEmojis.find((e) => (e.id || e._id) === emojiId)) ||
          serverEmojis.find((e) => (e.name?.toLowerCase?.() || "") === emojiName);
        if (foundEmoji) {
          parts.push({ type: "custom-emoji", content: tokenMatch[0], emoji: foundEmoji });
          customEmojiCount++;
        } else {
          parts.push({ type: "text", content: tokenMatch[0] });
        }
      }
      if (textLastIndex < textContent.length) {
        parts.push({ type: "text", content: textContent.slice(textLastIndex) });
      }
      return parts;
    };

    const urlPart = (url: string): MessagePart => {
      if (isImageLikeUrl(url)) return { type: "image", content: url, url };
      if (/serika\.cc/i.test(url)) return { type: "text", content: url };
      return { type: "link", content: url, url };
    };

    const walkInline = (nodes: MarkdownNode[] | undefined) => {
      for (const node of nodes ?? []) {
        if (node.type === "text") leaves.set(node, tokenizeText(node.content));
        else if (node.type === "url") leaves.set(node, [urlPart(node.content)]);
        if (node.children) walkInline(node.children);
      }
    };
    const walkBlock = (block: ParsedMarkdown) => {
      walkInline(block.inline);
      block.children?.forEach(walkBlock);
      for (const item of block.items ?? []) {
        walkInline(item.inline);
        item.children.forEach(walkBlock);
      }
    };
    const blocks = parseMarkdown(displayContent);
    blocks.forEach(walkBlock);
    return { blocks, leaves, customEmojiCount };
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
          onerror: twemojiOnError,
        } as Parameters<typeof twemoji.parse>[1]);
      });
    }
  }, [displayContent, serverEmojis]);

  // Inline mode (reply previews): render a compact sticker/attachment label
  // instead of the full media so the preview stays a single line.
  if (inline && (sticker || imageOnlyUrl)) {
    return (
      <span ref={textRef} onContextMenu={handleSpanContextMenu} className={cn("twemoji", className)}>
        {sticker ? `${sticker.name}` : gt("(attachment)")}
      </span>
    );
  }

  // If the message has a sticker, render it as a smaller Discord-like sticker
  if (sticker) {
    return (
      <div className={className}>
        <img
          src={cdnImage(sticker.imageUrl)}
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
            src={onlyGif && !animateMedia ? cdnImage(imageOnlyUrl, { still: true }) : imageOnlyUrl}
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

  const renderPart = (part: MessagePart, index: string): React.ReactNode => {
    if (part.type === "custom-emoji" && part.emoji) {
      return (
        <img
          key={`emoji-${index}-${part.emoji.id}`}
          src={cdnImage(part.emoji.url || part.emoji.imageUrl, { still: !animateMedia })}
          alt={`:${part.emoji.name}:`}
          title={`:${part.emoji.name}:`}
          className="custom-emoji"
          loading="lazy"
          data-emoji-id={part.emoji.id}
          data-emoji-name={part.emoji.name}
          data-emoji-url={part.emoji.url || part.emoji.imageUrl || ""}
          data-emoji-server={part.emoji.serverId || ""}
          onContextMenu={(e) => handleEmojiContextMenu(e, part.emoji!)}
        />
      );
    }
    if (part.type === "image" && part.url) {
      if (inline) {
        return (
          <span key={`image-${index}`} className="opacity-70">{gt("(attachment)")}</span>
        );
      }
      const inlineGif = isGifUrl(part.url);
      return (
        <span key={`image-${index}`} className="block my-2">
          <span className={cn("relative group", inlineGif && "inline-flex rounded-lg chat-gif-wrap")}>
            <img
              src={inlineGif && !animateMedia ? cdnImage(part.url, { still: true }) : part.url}
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
              onContextMenu={(e) => openUserMenu(e, { id: mentionUser.id, username: mentionUser.username || "unknown", displayName: mentionUser.displayName })}
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
        {part.content}
      </span>
    );
  };

  const renderLeaf: MarkdownTextRenderer = (node, key) => {
    const parts = parsedContent.leaves.get(node);
    if (!parts) return <Fragment key={key}>{node.content}</Fragment>;
    return <Fragment key={key}>{parts.map((p, i) => renderPart(p, `${key}-${i}`))}</Fragment>;
  };

  return (
    <span
      ref={textRef}
      onContextMenu={handleSpanContextMenu}
      className={cn(
        isLargeEmoji ? "twemoji-large" : "twemoji",
        !inline && "whitespace-pre-wrap break-words",
        className
      )}
    >
      <MarkdownDocument blocks={parsedContent.blocks} renderText={renderLeaf} inline={inline} />
      {userMenu}
      {typeof document !== "undefined" && emojiCtxMenu && createPortal(
        <div
          className="ctx-menu fixed z-[9999] min-w-[188px]"
          style={{ 
            left: Math.min(emojiCtxMenu.x, window.innerWidth - 188), 
            top: Math.min(emojiCtxMenu.y, window.innerHeight - 148) 
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Emoji preview header */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-subtle)]">
            <img
              src={cdnImage(emojiCtxMenu.emoji.url || emojiCtxMenu.emoji.imageUrl)}
              alt={emojiCtxMenu.isCustom ? `:${emojiCtxMenu.emoji.name}:` : emojiCtxMenu.emoji.id}
              className="w-6 h-6 object-contain"
            />
            <div className="min-w-0">
              <div className="text-sm font-medium text-[var(--text-primary)] truncate">
                {emojiCtxMenu.isCustom ? `:${emojiCtxMenu.emoji.name}:` : emojiCtxMenu.emoji.name}
              </div>
              {emojiCtxMenu.isCustom && emojiCtxMenu.emoji.serverId && (
                <div className="text-[10px] text-[var(--text-muted)] truncate">{emojiCtxMenu.emoji.serverId}</div>
              )}
            </div>
          </div>
          <button
            onClick={handleToggleEmojiFav}
            className="ctx-item"
          >
            {isFavorite(
              emojiCtxMenu.isCustom ? `:${emojiCtxMenu.emoji.name}:` : emojiCtxMenu.emoji.id,
              emojiCtxMenu.isCustom ? emojiCtxMenu.emoji.id : undefined
            ) ? (
              <>
                <StarOff className="w-4 h-4" />
                {gt("Unfavorite")}
              </>
            ) : (
              <>
                <Star className="w-4 h-4" />
                {gt("Favorite")}
              </>
            )}
          </button>
          <button
            onClick={handleCopyEmojiId}
            className="ctx-item"
          >
            <Copy className="w-4 h-4" />
            {emojiCtxMenu.isCustom ? gt("Copy Emoji ID") : gt("Copy Emoji")}
          </button>
        </div>,
        document.body
      )}
      {isTtsMessage && (
        <span className="inline-flex items-center gap-1 ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-500/15 text-indigo-400 align-middle select-none">
          🔊 {gt("TTS")}
        </span>
      )}
      {edited && <span className="text-xs text-[#555555] ml-1">({gt("edited")})</span>}
    </span>
  );
});
