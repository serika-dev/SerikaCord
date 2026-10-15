"use client";

import { Fragment, memo, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { useChatGt } from "./ChatGtContext";
import type { ChatMessage } from "@/lib/chat/types";

interface E2eeSystemRowProps {
  message: ChatMessage;
  formattedTimestamp?: string;
}

/** "X turned on end-to-end encryption." — one line, like the group DM system rows. */
function E2eeSystemRowInner({ message, formattedTimestamp }: E2eeSystemRowProps) {
  const gt = useChatGt();
  const actor = (
    <span className="font-semibold text-[var(--text-primary)]">
      {message.author?.displayName || message.author?.username || gt("Unknown")}
    </span>
  );
  // The template keeps its {actor} placeholder (see ChatGtContext); the bold
  // name is spliced in as a node.
  const parts: ReactNode[] = gt("{actor} turned on end-to-end encryption. Messages and calls here are now encrypted.")
    .split("{actor}")
    .flatMap((text, i) => (i === 0 ? [<Fragment key={`t${i}`}>{text}</Fragment>] : [<Fragment key={`a${i}`}>{actor}</Fragment>, <Fragment key={`t${i}`}>{text}</Fragment>]));
  return (
    <div className="chat-message-row py-0.5">
      <div
        id={`message-${message.id}`}
        role="note"
        className="flex items-center gap-4 rounded -mx-1 px-1 py-1 hover:bg-[var(--app-surface-alt)]/80 transition-colors"
      >
        <div className="flex w-10 flex-shrink-0 justify-center">
          <Lock className="h-4 w-4 text-green-500" aria-hidden />
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm text-[var(--app-muted)] break-words">{parts}</span>
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

export const E2eeSystemRow = memo(E2eeSystemRowInner);
