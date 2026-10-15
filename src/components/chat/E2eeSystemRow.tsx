"use client";

import { Fragment, memo, type ReactNode } from "react";
import { Lock, LockOpen } from "lucide-react";
import { useChatGt } from "./ChatGtContext";
import type { ChatMessage } from "@/lib/chat/types";

interface E2eeSystemRowProps {
  message: ChatMessage;
  formattedTimestamp?: string;
}

/** "X turned on / off end-to-end encryption." — one line, like the group DM system rows. */
function E2eeSystemRowInner({ message, formattedTimestamp }: E2eeSystemRowProps) {
  const gt = useChatGt();
  const off = message.type === "e2ee_disabled";
  // "Turned off": the actor is the member who signed the record (the row's
  // author is server data); unverified records are marked as such.
  const signer = off ? (message.e2eeRecord as { userId?: unknown } | null | undefined)?.userId : undefined;
  const authorIsSigner = !off || (typeof signer === "string" && signer.toLowerCase() === (message.author?.id ?? message.authorId ?? "").toLowerCase());
  const verified = !off || (message.e2eeNoticeVerified === true && authorIsSigner);
  const actor = (
    <span className="font-semibold text-[var(--text-primary)]">
      {authorIsSigner ? message.author?.displayName || message.author?.username || gt("Unknown") : gt("Someone")}
    </span>
  );
  // The template keeps its {actor} placeholder (see ChatGtContext); the bold
  // name is spliced in as a node.
  const template = off
    ? gt("{actor} turned off end-to-end encryption. New messages here aren't end-to-end encrypted.")
    : gt("{actor} turned on end-to-end encryption. Messages and calls here are now encrypted.");
  const parts: ReactNode[] = template
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
          {off ? <LockOpen className="h-4 w-4 text-[var(--app-muted)]" aria-hidden /> : <Lock className="h-4 w-4 text-green-500" aria-hidden />}
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm text-[var(--app-muted)] break-words">{parts}</span>
          {!verified && (
            <span className="text-xs font-medium text-amber-500">{gt("Not verified")}</span>
          )}
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
