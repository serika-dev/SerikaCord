"use client";

import { Fragment, memo, type ReactNode } from "react";
import { ExternalLink, Sparkles } from "lucide-react";
import { useChatGt, type ChatGt } from "./ChatGtContext";
import type { ChatMessage } from "@/lib/chat/types";

/** Fill "{actor} invited you to {app}." with React nodes (bold names). */
function fill(template: string, values: Record<string, ReactNode>): ReactNode[] {
  return template.split(/(\{\w+\})/g).map((part, i) => {
    const key = /^\{(\w+)\}$/.exec(part)?.[1];
    return <Fragment key={i}>{key && key in values ? values[key] : part}</Fragment>;
  });
}

/** The app's one-line pitch, translated for apps we know (lib/social/appInvite). */
function taglineFor(app: string, fallback: string | undefined, gt: ChatGt): string | undefined {
  if (app === "serikatrack") return gt("Track the anime and manga you watch and read, and see what your friends are into.");
  return fallback;
}

interface AppInviteRowProps {
  message: ChatMessage;
  currentUserId?: string;
  /** The other person in the DM (for "You invited X"). */
  peerName?: string;
  formattedTimestamp?: string;
}

/**
 * "X invited you to SerikaTrack" — a small card with what the app is and an
 * Open button, sent by another Serika app on the inviter's behalf
 * (lib/social/appInvite). A system row like call rows, so it works in
 * end-to-end encrypted DMs too.
 */
function AppInviteRowInner({ message, currentUserId, peerName, formattedTimestamp }: AppInviteRowProps) {
  const gt = useChatGt();
  const invite = message.appInvite;
  if (!invite) return null;
  const strong = (name: string) => <span className="font-semibold text-[var(--app-text)]">{name}</span>;
  const mine = !!currentUserId && (message.author?.id ?? message.authorId)?.toLowerCase() === currentUserId.toLowerCase();
  const app = strong(invite.name);
  const headline = mine
    ? fill(gt("You invited {target} to {app}."), { target: strong(peerName || gt("Unknown")), app })
    : fill(gt("{actor} invited you to {app}."), { actor: strong(message.author?.displayName || message.author?.username || gt("Unknown")), app });
  const tagline = taglineFor(invite.app, invite.tagline, gt);
  return (
    <div className="chat-message-row py-1">
      <div id={`message-${message.id}`} role="note" className="flex items-start gap-4 -mx-1 px-1">
        <div className="flex w-10 flex-shrink-0 justify-center pt-3">
          <Sparkles className="h-4 w-4 text-[var(--app-accent)]" aria-hidden />
        </div>
        <div className="min-w-0 max-w-md flex-1 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] p-3">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm text-[var(--app-muted)] break-words">{headline}</span>
            {formattedTimestamp && (
              <time dateTime={message.createdAt} className="text-xs text-[var(--app-muted)] opacity-80">
                {formattedTimestamp}
              </time>
            )}
          </div>
          {tagline && <p className="mt-1 text-sm text-[var(--app-text)] break-words">{tagline}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <a
              href={invite.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md bg-[var(--app-accent)] px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90"
            >
              {gt("Open {app}").replace("{app}", invite.name)}
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
            {!mine && <span className="text-xs text-[var(--app-muted)]">{gt("Sign in with your Serika account.")}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

export const AppInviteRow = memo(AppInviteRowInner);
