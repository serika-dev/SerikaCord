"use client";

import { Fragment, memo } from "react";
import { Pin } from "lucide-react";
import { useChatGt } from "./ChatGtContext";
import type { ChatMessage } from "@/lib/chat/types";

interface PinSystemRowProps {
  message: ChatMessage;
  formattedTimestamp?: string;
  onJumpToMessage?: (messageId: string) => void;
}

/**
 * Discord's "X pinned a message to this channel." row (type
 * channel_pinned_message, posted by src/lib/botapi/pinNotice.ts). Clicking
 * "a message" jumps to the pinned message.
 */
function PinSystemRowInner({ message, formattedTimestamp, onJumpToMessage }: PinSystemRowProps) {
  const gt = useChatGt();
  const actor = message.author?.displayName || message.author?.username || gt("Unknown");
  const target = message.referencedMessageId;
  const template = gt("{actor} pinned {message} to this channel.", { actor: "\u0001", message: "\u0000" });
  const parts = template.split(/(\u0000|\u0001)/);
  const linkText = gt("a message");

  return (
    <div className="chat-message-row py-0.5">
      <div
        id={`message-${message.id}`}
        role="note"
        className="flex items-center gap-4 rounded -mx-1 px-1 py-1 hover:bg-[var(--app-surface-alt)]/80 transition-colors"
      >
        <div className="flex w-10 flex-shrink-0 justify-center">
          <Pin className="h-4 w-4 text-[var(--app-muted)]" aria-hidden />
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm text-[var(--app-muted)] break-words">
            {parts.map((p, i) =>
              p === "\u0001" ? (
                <span key={i} className="font-semibold text-[var(--text-primary)]">{actor}</span>
              ) : p === "\u0000" ? (
                target && onJumpToMessage ? (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onJumpToMessage(target)}
                    className="font-semibold text-[var(--text-primary)] hover:underline"
                  >
                    {linkText}
                  </button>
                ) : (
                  <span key={i} className="font-semibold text-[var(--text-primary)]">{linkText}</span>
                )
              ) : (
                <Fragment key={i}>{p}</Fragment>
              ),
            )}
          </span>
          {formattedTimestamp && (
            <time dateTime={message.createdAt} className="text-xs text-[var(--app-muted)] opacity-80">
              {formattedTimestamp}
            </time>
          )}
        </div>
      </div>
    </div>
  );
}

export const PinSystemRow = memo(PinSystemRowInner);
