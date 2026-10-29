"use client";

import { createPortal } from "react-dom";
import { useGT } from "gt-next";
import { Copy, Hash, Star, StarOff, Type } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useEmojiFavorites } from "@/hooks/useEmojiFavorites";
import { useMenuPlacement } from "@/hooks/useMenuPlacement";
import { cdnImage } from "@/lib/utils";
import { customEmojiAlt, emojiClipboardPayload, type ClipboardPayload } from "@/lib/chat/emojiClipboard";
import { writeClipboardPayload } from "@/lib/chat/emojiClipboardDom";

export interface EmojiMenuTarget {
  x: number;
  y: number;
  /** Custom emoji: its id; Unicode emoji: the character (in `id` too). */
  emoji: {
    id: string;
    name: string;
    url: string;
    imageUrl?: string;
    serverId?: string;
    animated?: boolean;
  };
  isCustom?: boolean;
}

/**
 * Right-click menu on an emoji in a message: favourite it, copy it (pastes
 * back as the emoji), copy its `:name:`, and with Developer Mode on copy a
 * custom emoji's id. Mounted only while open (one per screen), so it may use
 * hooks a per-message component shouldn't.
 */
export function EmojiContextMenu({ target, onClose }: { target: EmojiMenuTarget; onClose: () => void }) {
  const gt = useGT();
  const { user } = useAuth();
  const developerMode = Boolean(user?.settings?.advanced?.developerMode);
  const { isFavorite, toggleFavorite } = useEmojiFavorites();
  const place = useMenuPlacement(target.x, target.y);
  const { emoji, isCustom } = target;
  const imageUrl = emoji.url || emoji.imageUrl || "";
  const favoriteKey = isCustom ? customEmojiAlt(emoji.name) : emoji.id;
  // Unicode emoji without a known shortcode get no "Copy Emoji Name".
  const name = isCustom ? customEmojiAlt(emoji.name) : emoji.name && emoji.name !== "emoji" ? customEmojiAlt(emoji.name) : "";

  const copy = (payload: ClipboardPayload) => {
    void writeClipboardPayload(payload)
      .then(() => toast.success(gt("Copied to clipboard")))
      .catch(() => {});
    onClose();
  };

  const toggleFav = () => {
    toggleFavorite({
      emoji: favoriteKey,
      name: emoji.name,
      customEmojiId: isCustom ? emoji.id : undefined,
      url: isCustom ? imageUrl : undefined,
    });
    onClose();
  };

  return createPortal(
    <div className="ctx-menu fixed z-[9999] min-w-[188px]" ref={place} onClick={(e) => e.stopPropagation()} role="menu">
      {/* Emoji preview header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-subtle)]">
        <img src={cdnImage(imageUrl)} alt={isCustom ? customEmojiAlt(emoji.name) : emoji.id} className="w-6 h-6 object-contain" />
        <div className="min-w-0">
          <div className="text-sm font-medium text-[var(--text-primary)] truncate">
            {isCustom ? customEmojiAlt(emoji.name) : emoji.name}
          </div>
          {isCustom && emoji.serverId && developerMode && (
            <div className="text-[10px] text-[var(--text-muted)] truncate">{emoji.serverId}</div>
          )}
        </div>
      </div>
      <button type="button" role="menuitem" onClick={toggleFav} className="ctx-item">
        {isFavorite(favoriteKey, isCustom ? emoji.id : undefined) ? (
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
        type="button"
        role="menuitem"
        className="ctx-item"
        onClick={() =>
          copy(
            isCustom
              ? emojiClipboardPayload({ kind: "custom", name: emoji.name, id: emoji.id, animated: emoji.animated, url: imageUrl })
              : emojiClipboardPayload({ kind: "unicode", char: emoji.id }),
          )
        }
      >
        <Copy className="w-4 h-4" />
        {gt("Copy Emoji")}
      </button>
      {name && (
        <button type="button" role="menuitem" className="ctx-item" onClick={() => copy({ text: name, html: "" })}>
          <Type className="w-4 h-4" />
          {gt("Copy Emoji Name")}
        </button>
      )}
      {isCustom && developerMode && (
        <button type="button" role="menuitem" className="ctx-item" onClick={() => copy({ text: emoji.id, html: "" })}>
          <Hash className="w-4 h-4" />
          {gt("Copy Emoji ID")}
        </button>
      )}
    </div>,
    document.body,
  );
}
