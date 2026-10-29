"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useGT } from "gt-next";
import { Smile } from "lucide-react";
import { RichComposer, type RichComposerHandle } from "@/components/chat/RichComposer";
import type { PickerEmoji } from "@/components/chat/MessageHoverActions";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

// The same picker as the message bar, fetched on first open.
const CustomEmojiPicker = dynamic(
  () => import("@/components/chat/CustomEmojiPicker").then((m) => m.CustomEmojiPicker),
  { ssr: false, loading: () => <div className="w-[440px] max-w-[calc(100vw-1rem)] h-[420px]" /> }
);

interface EditEmoji {
  id?: string;
  _id?: string;
  url?: string;
  imageUrl?: string;
}

interface MessageEditFormProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onCancel: () => void;
  onSave: () => void;
  /** Custom emoji the message may use (its own first): shown as images while editing. */
  emojis?: readonly EditEmoji[];
  /** Emoji picker: this server's emoji (server channels only) and every server's the viewer can use. */
  serverId?: string;
  serverName?: string;
  serverEmojis?: PickerEmoji[];
  availableServerEmojis?: PickerEmoji[];
}

/**
 * Inline message edit box with escape/enter hints. The same rich composer as
 * the message bar, so custom emoji show as images (not `<:name:id>` markup)
 * and are saved back as exactly the token they were. The emoji button opens
 * the message bar's picker (emoji only: GIFs and stickers can't be edited in).
 */
export function MessageEditForm({
  value,
  onChange,
  onKeyDown,
  onCancel,
  onSave,
  emojis,
  serverId,
  serverName,
  serverEmojis,
  availableServerEmojis,
}: MessageEditFormProps) {
  const gt = useGT();
  const { user } = useAuth();
  const emojiPickerEnabled = user?.settings?.textImages?.emojiPicker !== false;
  const composerRef = useRef<RichComposerHandle>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Every emoji this box can show as an image: the message's own, then the picker's.
  const emojiUrls = useMemo(() => {
    const urls = new Map<string, string>();
    for (const e of [...(emojis ?? []), ...(serverEmojis ?? []), ...(availableServerEmojis ?? [])] as EditEmoji[]) {
      const id = e.id || e._id;
      const url = e.url || e.imageUrl;
      if (id && url && !urls.has(id)) urls.set(id, url);
    }
    return urls;
  }, [emojis, serverEmojis, availableServerEmojis]);
  const resolveEmojiUrl = useCallback((id: string) => emojiUrls.get(id), [emojiUrls]);

  // Fill the box once, when it opens (it is uncontrolled afterwards).
  const initialRef = useRef({ value, resolveEmojiUrl });
  useEffect(() => {
    const { value: text, resolveEmojiUrl: resolve } = initialRef.current;
    composerRef.current?.setContent(text, resolve);
  }, []);

  const handleEmojiSelect = useCallback(
    (emoji: string, isCustom?: boolean, data?: { id: string; name: string; animated?: boolean; url?: string }) => {
      const composer = composerRef.current;
      if (!composer) return;
      if (isCustom && data?.url) {
        composer.insertEmojiAtCaret({ id: data.id, name: data.name, url: data.url, animated: data.animated });
      } else if (isCustom && data) {
        composer.insertTextAtCaret(`<${data.animated ? "a" : ""}:${data.name}:${data.id}>`);
      } else {
        composer.insertTextAtCaret(emoji);
      }
      setPickerOpen(false);
    },
    []
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Esc closes the picker first; only the next one cancels the edit.
      if (e.key === "Escape" && pickerOpen) {
        e.preventDefault();
        setPickerOpen(false);
        return;
      }
      // Ctrl/Cmd+E: the emoji picker, like in the message bar.
      if (emojiPickerEnabled && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        setPickerOpen((open) => !open);
        return;
      }
      onKeyDown(e);
    },
    [pickerOpen, emojiPickerEnabled, onKeyDown]
  );

  return (
    <div className="mt-1" data-message-edit-form="true">
      <div className="flex items-start rounded-md border border-[var(--border-subtle)] bg-[var(--bg-sidebar-elevated)] text-sm focus-within:ring-1 focus-within:ring-[var(--app-accent)]">
        <RichComposer
          ref={composerRef}
          compact
          aria-label={gt("Edit message")}
          onChange={(text) => onChange(text)}
          onKeyDown={handleKeyDown}
          resolveEmojiUrl={resolveEmojiUrl}
          className={cn("text-base sm:text-sm max-h-[50dvh]", emojiPickerEnabled && "pr-1 sm:pr-1")}
        />
        {emojiPickerEnabled && (
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                // Keep the caret in the edit box: the picker inserts there.
                onMouseDown={(e) => e.preventDefault()}
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center text-[var(--app-muted)] hover:text-[var(--text-primary)] transition-colors"
                title={gt("Add emoji")}
                aria-label={gt("Add emoji")}
                aria-expanded={pickerOpen}
              >
                <Smile className="h-5 w-5" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              side="top"
              align="end"
              collisionPadding={8}
              className="p-0 border-none bg-transparent shadow-xl w-[440px] max-w-[calc(100vw-1rem)]"
              // Back to the edit box with the caret where it was, so a second Esc cancels.
              onCloseAutoFocus={(e) => {
                e.preventDefault();
                composerRef.current?.restoreFocus();
              }}
              // The picker is portaled but React still bubbles its events to
              // the message row (right-click would open the message menu).
              onContextMenu={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <CustomEmojiPicker
                emojiOnly
                onEmojiSelect={handleEmojiSelect}
                serverId={serverId}
                serverName={serverName}
                serverEmojis={serverId ? serverEmojis : undefined}
                availableServerEmojis={availableServerEmojis}
                initialTab="emoji"
              />
            </PopoverContent>
          </Popover>
        )}
      </div>
      <div className="text-xs text-[var(--text-muted)] mt-1">
        {gt("escape to")}{" "}
        <button onClick={onCancel} className="text-[var(--app-accent)] hover:underline">
          {gt("cancel")}
        </button>
        {" • "}{gt("enter to")}{" "}
        <button onClick={onSave} className="text-[var(--app-accent)] hover:underline">
          {gt("save")}
        </button>
      </div>
    </div>
  );
}
