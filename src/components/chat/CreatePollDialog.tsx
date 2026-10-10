"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useGT } from "gt-next";
import { BarChart3, Plus, SmilePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Loader } from "@/components/ui/Loader";
import { PollEmojiIcon } from "@/components/chat/PollEmojiIcon";
import {
  DEFAULT_POLL_DURATION_HOURS,
  MAX_POLL_ANSWERS,
  MAX_POLL_ANSWER_LENGTH,
  MAX_POLL_QUESTION_LENGTH,
  POLL_DURATION_HOURS,
  type PollDurationHours,
  type PollEmoji,
} from "@/lib/chat/polls";

const CustomEmojiPicker = dynamic(
  () => import("@/components/chat/CustomEmojiPicker").then((m) => m.CustomEmojiPicker),
  { ssr: false, loading: () => <div className="w-[440px] max-w-[calc(100vw-1rem)] h-[420px]" /> },
);

type PickerEmoji = { id: string; name: string; url: string; serverId?: string; serverName?: string; serverIcon?: string; animated?: boolean };
type Row = { key: number; text: string; emoji: PollEmoji | null };

interface CreatePollDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** REST base of the conversation (`/api/channels/:id`, `/api/dms/:id`, `/api/group-dms/:id`). */
  apiBase: string;
  serverEmojis?: PickerEmoji[];
  availableServerEmojis?: PickerEmoji[];
  serverName?: string;
}

/**
 * Discord's "Create a Poll" dialog: a question, up to 10 answers (each with an
 * optional emoji), a duration and "Allow Multiple Answers". Posts to
 * `${apiBase}/polls`; the poll then arrives over the conversation stream.
 */
export function CreatePollDialog({ open, onOpenChange, apiBase, serverEmojis, availableServerEmojis, serverName }: CreatePollDialogProps) {
  const gt = useGT();
  const keyRef = useRef(2);
  const [question, setQuestion] = useState("");
  const [rows, setRows] = useState<Row[]>([{ key: 0, text: "", emoji: null }, { key: 1, text: "", emoji: null }]);
  const [duration, setDuration] = useState<PollDurationHours>(DEFAULT_POLL_DURATION_HOURS);
  const [multi, setMulti] = useState(false);
  const [pickerFor, setPickerFor] = useState<number | null>(null);
  const [posting, setPosting] = useState(false);

  const durationLabel = (h: PollDurationHours) => {
    switch (h) {
      case 1: return gt("1 hour");
      case 4: return gt("4 hours");
      case 8: return gt("8 hours");
      case 24: return gt("24 hours");
      case 72: return gt("3 days");
      default: return gt("1 week");
    }
  };

  const reset = () => {
    setQuestion("");
    setRows([{ key: 0, text: "", emoji: null }, { key: 1, text: "", emoji: null }]);
    keyRef.current = 2;
    setDuration(DEFAULT_POLL_DURATION_HOURS);
    setMulti(false);
  };

  const filled = rows.filter((r) => r.text.trim());
  const canPost = question.trim().length > 0 && filled.length > 0 && !posting;

  const update = (key: number, patch: Partial<Row>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: number) => setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.key !== key)));
  const add = () => {
    if (rows.length >= MAX_POLL_ANSWERS) return;
    const key = keyRef.current++;
    setRows((prev) => [...prev, { key, text: "", emoji: null }]);
  };

  const post = async () => {
    if (!canPost) return;
    setPosting(true);
    try {
      const res = await fetch(`${apiBase}/polls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: question.trim(),
          answers: filled.map((r) => ({ text: r.text.trim(), ...(r.emoji ? { emoji: r.emoji } : {}) })),
          durationHours: duration,
          allowMultiselect: multi,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || gt("Couldn't post the poll."));
        return;
      }
      reset();
      onOpenChange(false);
    } catch {
      toast.error(gt("Couldn't post the poll."));
    } finally {
      setPosting(false);
    }
  };

  const inputClass =
    "w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--app-muted)] focus:border-[var(--app-accent)]";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-lg flex-col gap-4 bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-primary)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-[var(--app-accent)]" aria-hidden />
            {gt("Create a Poll")}
          </DialogTitle>
          <DialogDescription className="text-[var(--text-secondary)]">
            {gt("Ask a question and let everyone vote.")}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 flex flex-col gap-4 overflow-y-auto px-1 scrollbar-thin">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">{gt("Question")}</span>
            <input
              autoFocus
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              maxLength={MAX_POLL_QUESTION_LENGTH}
              placeholder={gt("What question do you want to ask?")}
              className={inputClass}
            />
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">{gt("Answers")}</span>
            {rows.map((row, i) => (
              <div key={row.key} className="flex items-center gap-2">
                <Popover open={pickerFor === row.key} onOpenChange={(o) => setPickerFor(o ? row.key : null)}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-[var(--app-border)] text-[var(--app-muted)] hover:text-[var(--text-primary)]"
                      aria-label={gt("Add emoji")}
                      title={gt("Add emoji")}
                    >
                      {row.emoji ? <PollEmojiIcon emoji={row.emoji} /> : <SmilePlus className="h-4 w-4" />}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[440px] max-w-[calc(100vw-1rem)] p-0 border-none" side="top" align="start">
                    {pickerFor === row.key && (
                      <CustomEmojiPicker
                        onEmojiSelect={(emoji: string, isCustom?: boolean, data?: { id: string; name: string; animated?: boolean; url?: string }) => {
                          update(row.key, {
                            emoji: isCustom && data ? { id: data.id, name: data.name, animated: data.animated, url: data.url } : { name: emoji },
                          });
                          setPickerFor(null);
                        }}
                        serverEmojis={serverEmojis}
                        availableServerEmojis={availableServerEmojis}
                        serverName={serverName}
                        initialTab="emoji"
                      />
                    )}
                  </PopoverContent>
                </Popover>
                <input
                  value={row.text}
                  onChange={(e) => update(row.key, { text: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (i === rows.length - 1) add();
                    }
                  }}
                  maxLength={MAX_POLL_ANSWER_LENGTH}
                  placeholder={gt("Type your answer")}
                  aria-label={gt("Answer {n}", { n: i + 1 })}
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => remove(row.key)}
                  disabled={rows.length <= 1}
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-[var(--app-muted)] hover:text-red-400 disabled:opacity-30"
                  aria-label={gt("Remove answer")}
                  title={gt("Remove answer")}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            {rows.length < MAX_POLL_ANSWERS && (
              <button
                type="button"
                onClick={add}
                className="flex items-center gap-2 self-start rounded-md px-2 py-1.5 text-sm font-medium text-[var(--app-accent)] hover:bg-[var(--app-surface-alt)]"
              >
                <Plus className="h-4 w-4" aria-hidden />
                {gt("Add another answer")}
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <label className="flex min-w-[160px] flex-1 flex-col gap-1.5">
              <span className="text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">{gt("Duration")}</span>
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value) as PollDurationHours)}
                className={inputClass}
              >
                {POLL_DURATION_HOURS.map((h) => (
                  <option key={h} value={h}>{durationLabel(h)}</option>
                ))}
              </select>
            </label>
            <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm text-[var(--text-primary)]">
              <input
                type="checkbox"
                checked={multi}
                onChange={(e) => setMulti(e.target.checked)}
                className="h-4 w-4 accent-[var(--app-accent)]"
              />
              {gt("Allow Multiple Answers")}
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            {gt("Cancel")}
          </button>
          <button
            type="button"
            onClick={() => void post()}
            disabled={!canPost}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md bg-[var(--app-accent)] px-4 py-2 text-sm font-semibold text-[var(--text-on-accent,#fff)] transition-opacity hover:opacity-90",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {posting && <Loader size={14} />}
            {gt("Post")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
