"use client";

import { Pin, Loader2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatMessageTimestamp } from "@/lib/chat/messages";
import { T, useGT } from "gt-next";
import type { ChatMessage } from "@/lib/chat/types";

interface PinnedMessagesDialogProps<M extends ChatMessage> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messages: M[];
  isLoading: boolean;
  /** Context label shown in the description, e.g. "#general" or "@user". */
  contextLabel?: string;
  onJumpToMessage?: (messageId: string) => void;
  onUnpin?: (message: M) => void;
}

/** Shared pinned-messages dialog used by both channel chat and DMs. */
export function PinnedMessagesDialog<M extends ChatMessage>({
  open,
  onOpenChange,
  messages,
  isLoading,
  contextLabel,
  onJumpToMessage,
  onUnpin,
}: PinnedMessagesDialogProps<M>) {
  const gt = useGT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-primary)] max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pin className="w-5 h-5 text-[var(--accent-color)]" />
            <T>Pinned Messages</T>
          </DialogTitle>
          <DialogDescription className="text-[var(--text-secondary)]">
            {isLoading
              ? gt("Loading pinned messages...")
              : contextLabel
                ? <>{gt("Quick access to important messages in")} {contextLabel}.</>
                : <>{messages.length} {messages.length === 1 ? gt("pinned message") : gt("pinned messages")}</>}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto space-y-2 pr-1 scrollbar-thin">
          {isLoading ? (
            <div className="text-sm text-[var(--text-secondary)] flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              {gt("Loading pinned messages...")}
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-8 text-sm text-[var(--text-secondary)]">
              <T>No pinned messages yet.</T>
            </div>
          ) : (
            messages.map((message) => (
              <div
                key={`pin-${message.id}`}
                className="w-full text-left p-3 rounded-md bg-[var(--bg-sidebar-elevated)] hover:bg-[var(--bg-hover)] transition cursor-pointer"
                onClick={() => {
                  onJumpToMessage?.(message.id);
                  onOpenChange(false);
                }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Avatar className="w-6 h-6">
                    <AvatarImage src={message.author?.avatar} />
                    <AvatarFallback className="bg-[var(--accent-color)] text-white text-xs">
                      {(message.author?.displayName || message.author?.username || "?")
                        .charAt(0)
                        .toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="font-medium text-sm text-[var(--text-primary)]">
                    {message.author?.displayName || message.author?.username || gt("Unknown")}
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">
                    {formatMessageTimestamp(message.createdAt)}
                  </span>
                  {onUnpin && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onUnpin(message);
                      }}
                      className="ml-auto p-1 hover:bg-[var(--bg-hover)] rounded-md transition-colors"
                      title={gt("Unpin")}
                    >
                      <Pin className="w-4 h-4 text-[var(--accent-color)]" />
                    </button>
                  )}
                </div>
                <p className="text-sm text-[var(--text-primary)] line-clamp-3">
                  {message.content || gt("(attachment)")}
                </p>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
