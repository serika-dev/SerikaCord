"use client";

import { memo, useState } from "react";
import dynamic from "next/dynamic";
import { Check, CircleCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PollEmojiIcon } from "@/components/chat/PollEmojiIcon";
import { MountWhenOpened } from "@/components/ui/MountWhenOpened";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useChatGt } from "./ChatGtContext";
import {
  applyLocalVote,
  pollPercent,
  pollTimeLeft,
  pollWinners,
  totalVotes,
  type PollView,
} from "@/lib/chat/polls";

const PollVotersDialog = dynamic(() => import("@/components/chat/PollVotersDialog").then((m) => m.PollVotersDialog), { ssr: false });

interface PollCardProps {
  messageId: string;
  poll: PollView;
  /** The poll's author (can end it early). */
  isAuthor: boolean;
}

/**
 * A poll message, Discord-style: question, answers to pick (one or several),
 * Vote / Remove Vote, live result bars with percentages, "time left", and the
 * frozen results once it closes. Votes go to PUT /api/polls/:id/votes; the
 * live tallies come back over the conversation stream (poll_update).
 */
function PollCardInner({ messageId, poll, isAuthor }: PollCardProps) {
  const gt = useChatGt();
  const confirm = useConfirm();
  const [selected, setSelected] = useState<number[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [busy, setBusy] = useState(false);
  const [votersFor, setVotersFor] = useState<number | null>(null);
  // Our vote, shown until the stream delivers the new tallies (a new `poll`).
  const [optimistic, setOptimistic] = useState<{ base: PollView; view: PollView } | null>(null);
  const [now] = useState(() => Date.now());

  const view = optimistic && optimistic.base === poll ? optimistic.view : poll;
  const hasVoted = view.myVotes.length > 0;
  const closed = view.closed;
  const resultsMode = closed || hasVoted || showResults;
  const votes = totalVotes(view.counts);
  const winners = closed ? pollWinners(view.answers, view.counts) : [];
  const left = closed ? null : pollTimeLeft(view.expiresAt, now);

  const submit = async (answerIds: number[]) => {
    if (busy) return;
    const base = poll;
    setBusy(true);
    setOptimistic({ base, view: applyLocalVote(view, answerIds) });
    try {
      const res = await fetch(`/api/polls/${messageId}/votes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answerIds }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setOptimistic(null);
        toast.error(data?.error || gt("Couldn't save your vote."));
        return;
      }
      if (data?.poll) setOptimistic({ base, view: data.poll as PollView });
      setSelected([]);
      setShowResults(false);
    } catch {
      setOptimistic(null);
      toast.error(gt("Couldn't save your vote."));
    } finally {
      setBusy(false);
    }
  };

  const endPoll = async () => {
    const ok = await confirm({
      title: gt("End poll now?"),
      description: gt("Everyone will see the results and no one can vote anymore."),
      confirmLabel: gt("End Poll"),
      destructive: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/polls/${messageId}/expire`, { method: "POST" }).catch(() => null);
    if (!res?.ok) toast.error(gt("Couldn't end the poll."));
  };

  const toggle = (id: number) => {
    if (resultsMode || busy) return;
    setSelected((prev) => {
      if (view.allowMultiselect) return prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      return prev.includes(id) ? [] : [id];
    });
  };

  return (
    <div
      className="mt-1 w-full max-w-[min(100%,440px)] rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-alt)] p-4"
      role="group"
      aria-label={gt("Poll")}
    >
      <div className="break-words text-base font-semibold text-[var(--text-primary)]">{view.question}</div>
      <div className="mb-3 mt-0.5 text-xs text-[var(--app-muted)]">
        {closed
          ? gt("Poll closed")
          : view.allowMultiselect
            ? gt("Select one or more answers")
            : gt("Select one answer")}
      </div>

      <div className="flex flex-col gap-2">
        {view.answers.map((answer) => {
          const count = view.counts[answer.id] || 0;
          const percent = pollPercent(count, votes);
          const mine = view.myVotes.includes(answer.id);
          const isSelected = selected.includes(answer.id);
          const isWinner = winners.includes(answer.id);
          if (resultsMode) {
            return (
              <button
                key={answer.id}
                type="button"
                onClick={() => count > 0 && setVotersFor(answer.id)}
                className={cn(
                  "relative flex min-h-[44px] w-full items-center gap-2 overflow-hidden rounded-md border px-3 py-2 text-left text-sm transition-colors",
                  mine || isWinner ? "border-[var(--app-accent)]" : "border-[var(--app-border)]",
                  count > 0 ? "cursor-pointer" : "cursor-default",
                )}
                title={count > 0 ? gt("View votes") : undefined}
              >
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 bg-[var(--app-accent)] opacity-20 transition-[width] duration-500"
                  style={{ width: `${percent}%` }}
                />
                {answer.emoji && <PollEmojiIcon emoji={answer.emoji} className="relative flex-shrink-0" />}
                <span className="relative min-w-0 flex-1 break-words font-medium text-[var(--text-primary)]">{answer.text}</span>
                {mine && <CircleCheck className="relative h-4 w-4 flex-shrink-0 text-[var(--app-accent)]" aria-label={gt("Your vote")} />}
                <span className="relative flex-shrink-0 text-xs text-[var(--app-muted)]">
                  {count === 1 ? gt("1 vote") : gt("{count} votes", { count })}
                </span>
                <span className="relative w-10 flex-shrink-0 text-right text-sm font-semibold text-[var(--text-primary)]">{percent}%</span>
              </button>
            );
          }
          return (
            <button
              key={answer.id}
              type="button"
              onClick={() => toggle(answer.id)}
              aria-pressed={isSelected}
              className={cn(
                "flex min-h-[44px] w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                isSelected
                  ? "border-[var(--app-accent)] bg-[var(--app-accent)]/10"
                  : "border-[var(--app-border)] hover:bg-[var(--app-surface)]",
              )}
            >
              {answer.emoji && <PollEmojiIcon emoji={answer.emoji} className="flex-shrink-0" />}
              <span className="min-w-0 flex-1 break-words font-medium text-[var(--text-primary)]">{answer.text}</span>
              <span
                aria-hidden
                className={cn(
                  "flex h-5 w-5 flex-shrink-0 items-center justify-center border-2",
                  view.allowMultiselect ? "rounded" : "rounded-full",
                  isSelected ? "border-[var(--app-accent)] bg-[var(--app-accent)]" : "border-[var(--app-muted)]",
                )}
              >
                {isSelected && <Check className="h-3 w-3 text-[var(--text-on-accent,#fff)]" />}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2 text-xs text-[var(--app-muted)]">
        <span>
          {view.totalVoters === 1 ? gt("1 vote") : gt("{count} votes", { count: view.totalVoters })}
        </span>
        <span aria-hidden>·</span>
        <span>
          {closed
            ? gt("Poll closed")
            : left?.unit === "d"
              ? gt("{count}d left", { count: left.value })
              : left?.unit === "h"
                ? gt("{count}h left", { count: left.value })
                : gt("{count}m left", { count: left?.value ?? 1 })}
        </span>
        {!closed && !hasVoted && (
          <button
            type="button"
            onClick={() => setShowResults((v) => !v)}
            className="font-medium text-[var(--app-accent)] hover:underline"
          >
            {showResults ? gt("Go back to vote") : gt("Show results")}
          </button>
        )}
        {!closed && hasVoted && (
          <button
            type="button"
            onClick={() => void submit([])}
            disabled={busy}
            className="font-medium text-[var(--app-accent)] hover:underline disabled:opacity-50"
          >
            {gt("Remove Vote")}
          </button>
        )}
        {!closed && isAuthor && (
          <button
            type="button"
            onClick={() => void endPoll()}
            className="font-medium text-[var(--app-muted)] hover:text-[var(--text-primary)] hover:underline"
          >
            {gt("End Poll")}
          </button>
        )}
        {!resultsMode && (
          <button
            type="button"
            onClick={() => void submit(selected)}
            disabled={busy || selected.length === 0}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-[var(--app-accent)] px-4 py-1.5 text-sm font-semibold text-[var(--text-on-accent,#fff)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            {gt("Vote")}
          </button>
        )}
      </div>

      <MountWhenOpened open={votersFor !== null}>
        <PollVotersDialog
          messageId={messageId}
          poll={view}
          answerId={votersFor}
          onAnswerChange={setVotersFor}
          onClose={() => setVotersFor(null)}
        />
      </MountWhenOpened>
    </div>
  );
}

export const PollCard = memo(PollCardInner);
