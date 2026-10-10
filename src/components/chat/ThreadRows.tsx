"use client";

import { Fragment, memo, type ReactNode } from "react";
import { ChevronRight, MessagesSquare, Archive, Lock } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useChatGt } from "./ChatGtContext";
import { cdnImage } from "@/lib/utils";
import { decodeHtmlEntities } from "@/lib/chat/messages";
import { renderMentionText } from "@/lib/chat/mentionText";
import { formatThreadCount, type ThreadSummary } from "@/lib/chat/threads";
import type { ChatMessage } from "@/lib/chat/types";

function preview(raw: string, max = 120): string {
  const text = renderMentionText(decodeHtmlEntities(raw || ""))
    .replace(/[*_~`|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function shortTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface ThreadChipProps {
  thread: ThreadSummary;
  onOpen: () => void;
}

/**
 * The box under a message a thread was started from, Discord style: thread
 * name and "N Messages ›", then the latest reply. Opens the thread panel.
 */
export const ThreadChip = memo(function ThreadChip({ thread, onOpen }: ThreadChipProps) {
  const gt = useChatGt();
  const last = thread.lastMessage;
  const count = formatThreadCount(thread.messageCount);
  // Names are stored HTML-escaped (sanitizeInput), like channel names.
  const name = decodeHtmlEntities(thread.name);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      onContextMenu={(e) => e.stopPropagation()}
      className="thread-chip mt-1.5 flex w-full max-w-[min(32rem,100%)] flex-col gap-1 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-alt)] px-3 py-2 text-left transition-colors hover:border-[var(--app-accent)]/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]"
      aria-label={gt("Open thread {name}", { name })}
    >
      <span className="flex min-w-0 items-center gap-2 text-sm">
        <span className="truncate font-semibold text-[var(--text-primary)]">{name}</span>
        {thread.locked ? (
          <Lock className="h-3.5 w-3.5 shrink-0 text-[var(--app-muted)]" aria-label={gt("Locked")} />
        ) : thread.archived ? (
          <Archive className="h-3.5 w-3.5 shrink-0 text-[var(--app-muted)]" aria-label={gt("Archived")} />
        ) : null}
        <span className="ml-auto flex shrink-0 items-center gap-0.5 text-xs font-semibold text-[var(--app-accent)]">
          {thread.messageCount === 1 ? gt("1 Message") : gt("{count} Messages", { count })}
          <ChevronRight className="h-3.5 w-3.5" />
        </span>
      </span>
      {last ? (
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-[var(--app-muted)]">
          <Avatar className="h-4 w-4 shrink-0">
            <AvatarImage src={cdnImage(last.author?.avatar)} loading="lazy" alt="" />
            <AvatarFallback className="bg-[var(--app-accent)] text-[8px] text-[var(--text-on-accent)]">
              {(last.author?.displayName || last.author?.username || "?").charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="shrink-0 font-medium text-[var(--text-primary)]">
            {last.author?.displayName || last.author?.username || gt("Unknown")}
          </span>
          <span className="min-w-0 truncate">{preview(last.content) || gt("(attachment)")}</span>
          <span className="ml-auto shrink-0 opacity-80">{shortTime(last.createdAt)}</span>
        </span>
      ) : (
        <span className="text-xs text-[var(--app-muted)]">{gt("There are no recent messages in this thread.")}</span>
      )}
    </button>
  );
});

/** Fill "{actor} started a thread: {name}." with React nodes. */
function fill(template: string, values: Record<string, ReactNode>): ReactNode[] {
  return template.split(/(\{\w+\})/g).map((part, i) => {
    const key = /^\{(\w+)\}$/.exec(part)?.[1];
    return <Fragment key={i}>{key && key in values ? values[key] : part}</Fragment>;
  });
}

interface ThreadSystemRowProps {
  message: ChatMessage;
  formattedTimestamp?: string;
  onOpenThread?: (threadId: string) => void;
  onSeeAllThreads?: () => void;
}

/**
 * "X started a thread: name. See all threads." — the row a thread created from
 * the channel header (not from a message) leaves in the channel.
 */
function ThreadSystemRowInner({ message, formattedTimestamp, onOpenThread, onSeeAllThreads }: ThreadSystemRowProps) {
  const gt = useChatGt();
  const actor = (
    <span className="font-semibold text-[var(--text-primary)]">
      {message.author?.displayName || message.author?.username || gt("Unknown")}
    </span>
  );
  const threadId = message.thread?.id ?? message.threadId;
  const label = decodeHtmlEntities(message.thread?.name || message.content || "") || gt("a thread");
  const name = threadId && onOpenThread && message.thread !== null ? (
    <button
      type="button"
      onClick={() => onOpenThread(threadId)}
      className="font-semibold text-[var(--text-primary)] hover:underline"
    >
      {label}
    </button>
  ) : (
    <span className="font-semibold text-[var(--text-primary)]">{label}</span>
  );

  return (
    <div className="chat-message-row py-0.5">
      <div
        id={`message-${message.id}`}
        role="note"
        className="flex items-center gap-4 rounded -mx-1 px-1 py-1 hover:bg-[var(--app-surface-alt)]/80 transition-colors"
      >
        <div className="flex w-10 flex-shrink-0 justify-center">
          <MessagesSquare className="h-4 w-4 text-[var(--app-muted)]" aria-hidden />
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm text-[var(--app-muted)] break-words">
            {fill(gt("{actor} started a thread: {name}."), { actor, name })}{" "}
            {onSeeAllThreads && (
              <button type="button" onClick={onSeeAllThreads} className="font-semibold text-[var(--text-primary)] hover:underline">
                {gt("See all threads.")}
              </button>
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

export const ThreadSystemRow = memo(ThreadSystemRowInner);
