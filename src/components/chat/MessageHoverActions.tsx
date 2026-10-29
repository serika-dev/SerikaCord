"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Copy, MessagesSquare, MoreHorizontal, Pencil, Pin, Reply, Smile, Trash2, CornerUpRight } from "lucide-react";
import { useChatGt } from "./ChatGtContext";
import { cdnImage, cn } from "@/lib/utils";
import { emojiToken, quickReactions } from "@/lib/chat/emojiFrecency";
import { recordEmoji, useFrecentEmojis } from "@/lib/chat/emojiFrecencyStore";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import dynamic from "next/dynamic";
import type { ChatMessage, MessageCustomEmoji } from "@/lib/chat/types";
import { isForwardable } from "@/lib/chat/forward";
import { requestForward } from "@/lib/chat/forwardBus";
import { useCoarsePointer } from "@/hooks/useVisualViewport";

// Lazy-loaded so the reaction picker's code/data only load on first open,
// keeping it out of every rendered message's bundle.
const CustomEmojiPicker = dynamic(
  () => import("@/components/chat/CustomEmojiPicker").then((m) => m.CustomEmojiPicker),
  { ssr: false, loading: () => <div className="w-[440px] max-w-[calc(100vw-1rem)] h-[420px]" /> }
);

interface PickerEmoji {
  id: string;
  name: string;
  url: string;
  serverId?: string;
  serverName?: string;
  serverIcon?: string;
  animated?: boolean;
}

interface MessageHoverActionsProps<M extends ChatMessage> {
  message: M;
  isOwn: boolean;
  reactionPickerOpen: boolean;
  onReactionPickerChange: (open: boolean) => void;
  onAddReaction: (messageId: string, emoji: string) => void;
  onReply: (message: M, opts?: { mention?: boolean }) => void;
  onCopy: (content: string) => void;
  onPinToggle: (message: M) => void;
  /** Owner / MANAGE_MESSAGES / PIN_MESSAGES — can pin or unpin messages. */
  canPin?: boolean;
  onEdit: (message: M) => void;
  onDelete: (message: M) => void;
  /** Start a thread from this message (text channels with CREATE_PUBLIC_THREADS). */
  onCreateThread?: (message: M) => void;
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
  canPin = false,
  onEdit,
  onDelete,
  onCreateThread,
  serverEmojis,
  availableServerEmojis,
  serverName,
}: MessageHoverActionsProps<M>) {
  const gt = useChatGt();
  // Touch screens have no hover: the long-press sheet replaces this toolbar.
  const coarse = useCoarsePointer();
  const [shiftHeld, setShiftHeld] = useState(false);
  // The reaction popover and the "More" menu (Radix poppers, a few dozen
  // components each) only mount once the pointer or focus reaches this
  // message. Until then the toolbar is plain buttons, so opening a channel
  // doesn't build two popper trees per message for a toolbar nobody hovers.
  // Armed when the pointer moves over the message (rows that only scroll past
  // under a still pointer stay plain: that fires pointerenter, not
  // pointermove), by keyboard focus, or by clicking a plain button, which then
  // opens what it was clicked for.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [armedBy, setArmedBy] = useState<"hover" | "more" | null>(null);
  const armed = armedBy !== null;
  const refocusRef = useRef<string | null>(null);
  const live = armed || reactionPickerOpen;
  useEffect(() => {
    if (armed || coarse) return;
    const root = rootRef.current;
    const row = root?.closest<HTMLElement>('[id^="message-"]') ?? root;
    if (!row) return;
    const onMove = () => setArmedBy((prev) => prev ?? "hover");
    const armOnFocus = (e: FocusEvent) => {
      // Keyboard focus on a toolbar button: arming swaps it for the popper
      // trigger, so focus moves to the new button once it has mounted.
      const action = (e.target as Element | null)?.closest?.("[data-hover-action]")?.getAttribute("data-hover-action");
      if (action) refocusRef.current = action;
      setArmedBy((prev) => prev ?? "hover");
    };
    row.addEventListener("pointermove", onMove, { passive: true });
    row.addEventListener("focusin", armOnFocus);
    return () => {
      row.removeEventListener("pointermove", onMove);
      row.removeEventListener("focusin", armOnFocus);
    };
  }, [armed, coarse]);
  useLayoutEffect(() => {
    const action = refocusRef.current;
    if (!live || !action) return;
    refocusRef.current = null;
    rootRef.current?.querySelector<HTMLElement>(`[data-hover-action="${action}"]`)?.focus();
  }, [live]);
  // Discord's hover bar: your three most-used reactions, one click away.
  const frecent = useFrecentEmojis();
  const quick = message.pending || message.ephemeral ? [] : quickReactions(frecent, 3);

  useEffect(() => {
    // Shift swaps the "More" menu for its quick actions; only toolbars the
    // pointer has reached listen (not one set of window listeners per message).
    if (coarse || !armed) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") setShiftHeld(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") setShiftHeld(false);
    };
    const onBlur = () => setShiftHeld(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [coarse, armed]);

  const forwardable = isForwardable(message);
  // Polls and forwards have no text of their own to edit (like Discord).
  const editable = isOwn && !message.poll && !message.forward;
  const copyText = message.forward?.content || message.content;

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

  // On touch, an invisible toolbar would swallow taps on the message. It only
  // renders while its reaction picker is open (the picker anchors to it).
  if (coarse && !reactionPickerOpen) return null;

  const reactionButton = (
    <button
      data-hover-action="react"
      // Plain (not yet armed) button: opening the picker mounts the popover.
      onClick={live ? undefined : () => {
        setArmedBy((prev) => prev ?? "hover");
        onReactionPickerChange(true);
      }}
      className={cn("p-1.5 hover:bg-[color-mix(in_srgb,var(--text-primary)_10%,transparent)] transition-colors [&:hover>svg]:text-[var(--text-primary)]", quick.length === 0 && "rounded-l-md")} title={gt("Add Reaction")}>
      <Smile className="w-4 h-4 text-[var(--app-muted)]" />
    </button>
  );
  const moreButton = (
    <button
      data-hover-action="more"
      onClick={live ? undefined : () => setArmedBy("more")}
      className="p-1.5 hover:bg-[color-mix(in_srgb,var(--text-primary)_10%,transparent)] rounded-r-md transition-colors [&:hover>svg]:text-[var(--text-primary)]" title={gt("More")}>
      <MoreHorizontal className="w-4 h-4 text-[var(--app-muted)]" />
    </button>
  );

  return (
    <div
      ref={rootRef}
      className={cn(
        "theme-solid absolute -top-3 right-4 transition-opacity duration-(--motion-fast) z-[100]",
        reactionPickerOpen ? "opacity-100" : "opacity-0 group-hover/message:opacity-100 group-has-[:focus-visible]/message:opacity-100"
      )}
    >
      <div className="flex items-center bg-[var(--app-surface-alt)] border border-[var(--app-border)] rounded-lg shadow-[var(--app-elev-1)] overflow-hidden">
        {quick.map((emoji, i) => (
          <button
            key={emoji.kind === "custom" ? emoji.id : emoji.emoji}
            type="button"
            onClick={() => {
              recordEmoji(emoji);
              onAddReaction(message.id, emojiToken(emoji));
            }}
            className={cn("hidden sm:flex h-7 w-7 items-center justify-center hover:bg-[color-mix(in_srgb,var(--text-primary)_10%,transparent)] transition-colors [&:hover>svg]:text-[var(--text-primary)]", i === 0 && "rounded-l-md")}
            title={emoji.kind === "custom" ? `:${emoji.name}:` : emoji.emoji}
          >
            {emoji.kind === "custom" ? (
              <img src={cdnImage(emoji.url)} alt={`:${emoji.name}:`} className="h-[18px] w-[18px] object-contain" />
            ) : (
              <span className="text-base leading-none">{emoji.emoji}</span>
            )}
          </button>
        ))}
        {quick.length > 0 && <span className="hidden sm:block mx-0.5 h-4 w-px bg-[var(--app-border)]" aria-hidden="true" />}
        {live ? (
        <Popover open={reactionPickerOpen} onOpenChange={onReactionPickerChange}>
          <PopoverTrigger asChild>
            {reactionButton}
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
        ) : reactionButton}
        <button
          onClick={(e) => onReply(message, e.shiftKey ? { mention: false } : undefined)}
          className="p-1.5 hover:bg-[color-mix(in_srgb,var(--text-primary)_10%,transparent)] transition-colors [&:hover>svg]:text-[var(--text-primary)]"
          title={gt("Reply")}
        >
          <Reply className="w-4 h-4 text-[var(--app-muted)]" />
        </button>
        {onCreateThread && (
          <button
            onClick={() => onCreateThread(message)}
            className="p-1.5 hover:bg-[color-mix(in_srgb,var(--text-primary)_10%,transparent)] transition-colors [&:hover>svg]:text-[var(--text-primary)]"
            title={gt("Create Thread")}
            aria-label={gt("Create Thread")}
          >
            <MessagesSquare className="w-4 h-4 text-[var(--app-muted)]" />
          </button>
        )}
        {editable && (
          <button
            onClick={() => onEdit(message)}
            className="p-1.5 hover:bg-[color-mix(in_srgb,var(--text-primary)_10%,transparent)] transition-colors [&:hover>svg]:text-[var(--text-primary)]"
            title={gt("Edit")}
          >
            <Pencil className="w-4 h-4 text-[var(--app-muted)]" />
          </button>
        )}
        {forwardable && (
          <button
            onClick={() => requestForward(message)}
            className="p-1.5 hover:bg-[color-mix(in_srgb,var(--text-primary)_10%,transparent)] transition-colors [&:hover>svg]:text-[var(--text-primary)]"
            title={gt("Forward")}
          >
            <CornerUpRight className="w-4 h-4 text-[var(--app-muted)]" />
          </button>
        )}
        {shiftHeld ? (
          <>
            <button
              onClick={() => onCopy(copyText)}
              className="p-1.5 hover:bg-[color-mix(in_srgb,var(--text-primary)_10%,transparent)] transition-colors [&:hover>svg]:text-[var(--text-primary)]"
              title={gt("Copy Text")}
            >
              <Copy className="w-4 h-4 text-[var(--app-muted)]" />
            </button>
            {canPin && (
              <button
                onClick={() => onPinToggle(message)}
                className="p-1.5 hover:bg-[color-mix(in_srgb,var(--text-primary)_10%,transparent)] transition-colors [&:hover>svg]:text-[var(--text-primary)]"
                title={message.pinned ? gt("Unpin Message") : gt("Pin Message")}
              >
                <Pin className="w-4 h-4 text-[var(--app-muted)]" />
              </button>
            )}
            {isOwn && (
              <button
                onClick={() => onDelete(message)}
                className="p-1.5 hover:bg-red-500/20 rounded-r-md transition-colors"
                title={gt("Delete Message")}
              >
                <Trash2 className="w-4 h-4 text-red-400" />
              </button>
            )}
          </>
        ) : !live ? (
          moreButton
        ) : (
          <DropdownMenu defaultOpen={armedBy === "more"}>
            <DropdownMenuTrigger asChild>
              {moreButton}
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="bottom"
              align="end"
              className="bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-primary)] min-w-[160px]"
            >
              <DropdownMenuItem onClick={() => onReply(message)} className="hover:bg-[var(--bg-hover)] cursor-pointer">
                <Reply className="w-4 h-4 mr-2" /> {gt("Reply")}
              </DropdownMenuItem>
              {onCreateThread && (
                <DropdownMenuItem onClick={() => onCreateThread(message)} className="hover:bg-[var(--bg-hover)] cursor-pointer">
                  <MessagesSquare className="w-4 h-4 mr-2" /> {gt("Create Thread")}
                </DropdownMenuItem>
              )}
              {forwardable && (
                <DropdownMenuItem onClick={() => requestForward(message)} className="hover:bg-[var(--bg-hover)] cursor-pointer">
                  <CornerUpRight className="w-4 h-4 mr-2" /> {gt("Forward")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() => onCopy(copyText)}
                className="hover:bg-[var(--bg-hover)] cursor-pointer"
              >
                <Copy className="w-4 h-4 mr-2" /> {gt("Copy Text")}
              </DropdownMenuItem>
              {canPin && (
                <DropdownMenuItem
                  onClick={() => onPinToggle(message)}
                  className="hover:bg-[var(--bg-hover)] cursor-pointer"
                >
                  <Pin className="w-4 h-4 mr-2" /> {message.pinned ? gt("Unpin Message") : gt("Pin Message")}
                </DropdownMenuItem>
              )}
              {isOwn && (
                <>
                  <DropdownMenuSeparator className="bg-[var(--border-subtle)]" />
                  {editable && (
                    <DropdownMenuItem onClick={() => onEdit(message)} className="hover:bg-[var(--bg-hover)] cursor-pointer">
                      <Pencil className="w-4 h-4 mr-2" /> {gt("Edit Message")}
                    </DropdownMenuItem>
                  )}
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
        )}
      </div>
    </div>
  );
}

export type { PickerEmoji };
