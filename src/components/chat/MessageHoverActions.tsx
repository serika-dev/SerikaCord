"use client";

import { Copy, MoreHorizontal, Pencil, Pin, Reply, Smile, Trash2 } from "lucide-react";
import { useGT } from "gt-next";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CustomEmojiPicker } from "@/components/chat/CustomEmojiPicker";
import type { ChatMessage, MessageCustomEmoji } from "@/lib/chat/types";

interface PickerEmoji {
  id: string;
  name: string;
  url: string;
  serverId?: string;
  serverName?: string;
  animated?: boolean;
}

interface MessageHoverActionsProps<M extends ChatMessage> {
  message: M;
  isOwn: boolean;
  reactionPickerOpen: boolean;
  onReactionPickerChange: (open: boolean) => void;
  onAddReaction: (messageId: string, emoji: string) => void;
  onReply: (message: M) => void;
  onCopy: (content: string) => void;
  onPinToggle: (message: M) => void;
  onEdit: (message: M) => void;
  onDelete: (message: M) => void;
  serverEmojis?: PickerEmoji[];
  availableServerEmojis?: PickerEmoji[];
  serverName?: string;
}

/**
 * The floating react/reply/more toolbar shown on message hover,
 * including the reaction emoji picker and the "more" dropdown.
 */
export function MessageHoverActions<M extends ChatMessage>({
  message,
  isOwn,
  reactionPickerOpen,
  onReactionPickerChange,
  onAddReaction,
  onReply,
  onCopy,
  onPinToggle,
  onEdit,
  onDelete,
  serverEmojis,
  availableServerEmojis,
  serverName,
}: MessageHoverActionsProps<M>) {
  const gt = useGT();
  const handlePickerSelect = (
    emoji: string,
    isCustom?: boolean,
    emojiData?: MessageCustomEmoji & { url?: string }
  ) => {
    const emojiStr =
      isCustom && emojiData
        ? `<${emojiData.animated ? "a" : ""}:${emojiData.name}:${emojiData.id}>`
        : emoji;
    onAddReaction(message.id, emojiStr);
  };

  return (
    <div
      className={cn(
        "absolute -top-3 right-4 transition-opacity z-[100]",
        reactionPickerOpen ? "opacity-100" : "opacity-0 group-hover/message:opacity-100"
      )}
    style={{ transform: 'translateZ(0)', willChange: 'opacity, transform' }}
    >
      <div className="flex items-center bg-[var(--app-surface-alt)] border border-[var(--app-border)] rounded-md shadow-lg">
        <Popover open={reactionPickerOpen} onOpenChange={onReactionPickerChange}>
          <PopoverTrigger asChild>
            <button className="p-1.5 hover:bg-black/20 rounded-l-md transition-colors" title={gt("Add Reaction")}>
              <Smile className="w-4 h-4 text-[var(--app-muted)]" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-[440px] max-w-[calc(100vw-1rem)] p-0 border-none" side="top" align="end">
            <CustomEmojiPicker
              onEmojiSelect={handlePickerSelect}
              serverEmojis={serverEmojis}
              serverName={serverName}
              availableServerEmojis={availableServerEmojis}
              initialTab="emoji"
            />
          </PopoverContent>
        </Popover>
        <button
          onClick={() => onReply(message)}
          className="p-1.5 hover:bg-black/20 transition-colors"
          title={gt("Reply")}
        >
          <Reply className="w-4 h-4 text-[var(--app-muted)]" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="p-1.5 hover:bg-black/20 rounded-r-md transition-colors" title={gt("More")}>
              <MoreHorizontal className="w-4 h-4 text-[var(--app-muted)]" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="bottom"
            align="end"
            className="bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-primary)] min-w-[160px]"
          >
            <DropdownMenuItem onClick={() => onReply(message)} className="hover:bg-[var(--bg-hover)] cursor-pointer">
              <Reply className="w-4 h-4 mr-2" /> {gt("Reply")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onCopy(message.content)}
              className="hover:bg-[var(--bg-hover)] cursor-pointer"
            >
              <Copy className="w-4 h-4 mr-2" /> {gt("Copy Text")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onPinToggle(message)}
              className="hover:bg-[var(--bg-hover)] cursor-pointer"
            >
              <Pin className="w-4 h-4 mr-2" /> {message.pinned ? gt("Unpin Message") : gt("Pin Message")}
            </DropdownMenuItem>
            {isOwn && (
              <>
                <DropdownMenuSeparator className="bg-[var(--border-subtle)]" />
                <DropdownMenuItem onClick={() => onEdit(message)} className="hover:bg-[var(--bg-hover)] cursor-pointer">
                  <Pencil className="w-4 h-4 mr-2" /> {gt("Edit Message")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onDelete(message)}
                  className="hover:bg-red-500/20 text-red-400 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4 mr-2" /> {gt("Delete Message")}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export type { PickerEmoji };
