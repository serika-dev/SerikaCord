"use client";

import { memo } from "react";
import { BarChart3, Trophy } from "lucide-react";
import { useChatGt } from "./ChatGtContext";
import { PollEmojiIcon } from "@/components/chat/PollEmojiIcon";
import { pollPercent } from "@/lib/chat/polls";
import type { ChatMessage } from "@/lib/chat/types";

interface PollResultRowProps {
  message: ChatMessage;
  currentUserId?: string;
  formattedTimestamp?: string;
  onJumpToMessage?: (messageId: string) => void;
}

/**
 * The "poll results" row posted when a poll closes, Discord-style: one line
 * ("X's poll Question has closed") and a small card with the winning answer
 * (or a tie / no votes) and a "View Poll" jump back to the poll.
 */
function PollResultRowInner({ message, currentUserId, formattedTimestamp, onJumpToMessage }: PollResultRowProps) {
  const gt = useChatGt();
  const result = message.pollResult;
  const authorName = message.author?.displayName || message.author?.username || gt("Unknown");
  const mine = message.authorId === currentUserId;
  const winners = result ? result.answers.filter((a) => result.winnerIds.includes(a.id)) : [];
  const winner = winners.length === 1 ? winners[0] : null;
  const question = result?.question ?? "";

  const before = mine ? gt("Your poll {question} has closed", { question: "\u0000" }) : gt("{name}'s poll {question} has closed", { name: "\u0001", question: "\u0000" });
  const parts = before.split(/(\u0000|\u0001)/);

  return (
    <div className="chat-message-row py-0.5">
      <div
        id={`message-${message.id}`}
        role="note"
        aria-label={gt("Poll results")}
        className="flex gap-4 rounded -mx-1 px-1 py-1 hover:bg-[var(--app-surface-alt)]/80 transition-colors"
      >
        <div className="flex w-10 flex-shrink-0 justify-center pt-0.5">
          <BarChart3 className="h-4 w-4 text-[var(--app-muted)]" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 text-sm text-[var(--app-muted)]">
            <span>
              {parts.map((p, i) =>
                p === "\u0000" ? (
                  <span key={i} className="font-semibold text-[var(--text-primary)]">{question}</span>
                ) : p === "\u0001" ? (
                  <span key={i} className="font-semibold text-[var(--text-primary)]">{authorName}</span>
                ) : (
                  <span key={i}>{p}</span>
                ),
              )}
            </span>
            {formattedTimestamp && (
              <time dateTime={message.createdAt} className="text-xs opacity-80">{formattedTimestamp}</time>
            )}
          </div>
          {result && (
            <div className="mt-1.5 flex max-w-[min(100%,440px)] items-center gap-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-alt)] px-3 py-2">
              {winner ? (
                <>
                  {winner.emoji ? <PollEmojiIcon emoji={winner.emoji} className="flex-shrink-0" /> : <Trophy className="h-5 w-5 flex-shrink-0 text-[var(--app-accent)]" aria-hidden />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-[var(--text-primary)]">{winner.text}</div>
                    <div className="text-xs text-[var(--app-muted)]">
                      {gt("Winning answer · {percent}%", { percent: pollPercent(winner.votes, result.totalVotes) })}
                    </div>
                  </div>
                </>
              ) : (
                <div className="min-w-0 flex-1 text-sm font-medium text-[var(--text-primary)]">
                  {result.totalVotes === 0 ? gt("There were no votes") : gt("The results were tied")}
                </div>
              )}
              {onJumpToMessage && (
                <button
                  type="button"
                  onClick={() => onJumpToMessage(result.pollMessageId)}
                  className="flex-shrink-0 rounded-md border border-[var(--app-border)] px-3 py-1 text-xs font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--app-surface)]"
                >
                  {gt("View Poll")}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export const PollResultRow = memo(PollResultRowInner);
