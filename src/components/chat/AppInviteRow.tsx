"use client";

import { Fragment, memo, type ReactNode } from "react";
import { ExternalLink, Sparkles } from "lucide-react";
import { useChatGt } from "./ChatGtContext";
import type { ChatMessage } from "@/lib/chat/types";

/** Fill "{actor} invited you to {app}." with React nodes (bold names). */
function fill(template: string, values: Record<string, ReactNode>): ReactNode[] {
  return template.split(/(\{\w+\})/g).map((part, i) => {
    const key = /^\{(\w+)\}$/.exec(part)?.[1];
    return <Fragment key={i}>{key && key in values ? values[key] : part}</Fragment>;
  });
}

interface AppInviteRowProps {
  message: ChatMessage;
  currentUserId?: string;
  /** The other person in the DM (for "You invited X"). */
  peerName?: string;
  formattedTimestamp?: string;
}

/**
 * "X invited you to SerikaTrack." — one line with an Open button, sent by
 * another Serika app on the inviter's behalf (lib/social/appInvite). A system
 * row like call rows, so it works in end-to-end encrypted DMs too.
 */
function AppInviteRowInner({ message, currentUserId, peerName, formattedTimestamp }: AppInviteRowProps) {
  const gt = useChatGt();
  const invite = message.appInvite;
  if (!invite) return null;
  const strong = (name: string) => <span className="font-semibold text-[var(--text-primary)]">{name}</span>;
  const mine = !!currentUserId && (message.author?.id ?? message.authorId)?.toLowerCase() === currentUserId.toLowerCase();
  const app = strong(invite.name);
  const text = mine
    ? fill(gt("You invited {target} to {app}."), { target: strong(peerName || gt("Unknown")), app })
    : fill(gt("{actor} invited you to {app}."), { actor: strong(message.author?.displayName || message.author?.username || gt("Unknown")), app });
  return (
    <div className="chat-message-row py-0.5">
      <div
        id={`message-${message.id}`}
        role="note"
        className="flex items-center gap-4 rounded -mx-1 px-1 py-1 hover:bg-[var(--app-surface-alt)]/80 transition-colors"
      >
        <div className="flex w-10 flex-shrink-0 justify-center">
          <Sparkles className="h-4 w-4 text-[var(--app-accent)]" aria-hidden />
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm text-[var(--app-muted)] break-words">{text}</span>
          {!mine && (
            <a
              href={invite.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md bg-[var(--app-accent)] px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90"
            >
              {gt("Open {app}").replace("{app}", invite.name)}
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
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

export const AppInviteRow = memo(AppInviteRowInner);
