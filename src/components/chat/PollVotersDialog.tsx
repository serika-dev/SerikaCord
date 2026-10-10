"use client";

import { useEffect, useState } from "react";
import { useGT } from "gt-next";
import { cdnImage, cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader } from "@/components/ui/Loader";
import { PollEmojiIcon } from "@/components/chat/PollEmojiIcon";
import type { PollView } from "@/lib/chat/polls";

type Voter = { id: string; username: string; displayName: string; avatar: string | null };

interface PollVotersDialogProps {
  messageId: string;
  poll: PollView;
  answerId: number | null;
  onAnswerChange: (answerId: number) => void;
  onClose: () => void;
}

/** "View votes": answers on the left, who picked the selected one on the right. */
export function PollVotersDialog({ messageId, poll, answerId, onAnswerChange, onClose }: PollVotersDialogProps) {
  const gt = useGT();
  const [voters, setVoters] = useState<Record<number, Voter[] | "error">>({});

  useEffect(() => {
    if (answerId === null || voters[answerId] !== undefined) return;
    let cancelled = false;
    void fetch(`/api/polls/${messageId}/answers/${answerId}/voters`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { users?: Voter[] }) => {
        if (!cancelled) setVoters((prev) => ({ ...prev, [answerId]: data.users ?? [] }));
      })
      .catch(() => {
        if (!cancelled) setVoters((prev) => ({ ...prev, [answerId]: "error" }));
      });
    return () => {
      cancelled = true;
    };
  }, [answerId, messageId, voters]);

  const list = answerId !== null ? voters[answerId] : undefined;

  return (
    <Dialog open={answerId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-primary)]">
        <DialogHeader>
          <DialogTitle className="break-words">{poll.question}</DialogTitle>
          <DialogDescription className="text-[var(--text-secondary)]">
            {poll.totalVoters === 1 ? gt("1 vote") : gt("{count} votes", { count: poll.totalVoters })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[60vh] flex-col gap-3 sm:flex-row">
          <div className="flex flex-shrink-0 flex-row gap-1 overflow-x-auto sm:w-48 sm:flex-col sm:overflow-y-auto">
            {poll.answers.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => onAnswerChange(a.id)}
                className={cn(
                  "flex min-w-0 flex-shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                  a.id === answerId ? "bg-[var(--app-surface-alt)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--app-surface-alt)]",
                )}
              >
                {a.emoji && <PollEmojiIcon emoji={a.emoji} className="flex-shrink-0" />}
                <span className="min-w-0 flex-1 truncate">{a.text}</span>
                <span className="text-xs text-[var(--app-muted)]">{poll.counts[a.id] || 0}</span>
              </button>
            ))}
          </div>
          <div className="min-h-[120px] flex-1 overflow-y-auto scrollbar-thin">
            {list === undefined ? (
              <div className="flex items-center gap-2 p-2 text-sm text-[var(--text-secondary)]">
                <Loader size={16} />
              </div>
            ) : list === "error" ? (
              <div className="p-2 text-sm text-[var(--text-secondary)]">{gt("Couldn't load votes.")}</div>
            ) : list.length === 0 ? (
              <div className="p-2 text-sm text-[var(--text-secondary)]">{gt("No votes yet.")}</div>
            ) : (
              <ul className="flex flex-col gap-1">
                {list.map((u) => (
                  <li key={u.id} className="flex items-center gap-2 rounded-md px-2 py-1.5">
                    <Avatar className="h-8 w-8">
                      {u.avatar && <AvatarImage src={cdnImage(u.avatar)} alt="" />}
                      <AvatarFallback>{(u.displayName || u.username).charAt(0).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-[var(--text-primary)]">{u.displayName}</div>
                      <div className="truncate text-xs text-[var(--app-muted)]">{u.username}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
