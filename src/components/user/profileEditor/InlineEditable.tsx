"use client";

import { useState, type ReactNode } from "react";
import { useGT } from "gt-next";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizeInlineValue, PROFILE_LIMITS, type InlineField } from "@/components/user/profileEditor/selfProfile";

interface InlineEditableProps {
  field: InlineField;
  /** Current saved value (plain text). */
  value: string;
  /** Called with the cleaned value when it changed. */
  onSave: (next: string) => void;
  /** Accessible name of the edit action, e.g. "Edit pronouns". */
  label: string;
  /** What the field shows while not editing. */
  children: ReactNode;
  placeholder?: string;
  /** Rendered before the input while editing (e.g. the status emoji). */
  leading?: ReactNode;
  className?: string;
  inputClassName?: string;
}

/**
 * Double-click (or the pencil button, which also covers touch screens) to
 * edit a profile field in place. Enter saves (Shift+Enter is a new line in
 * the bio), Escape cancels, leaving the field saves, empty clears.
 * `data-inline-editor` lets the profile dialog keep Escape from closing it.
 */
export function InlineEditable({
  field,
  value,
  onSave,
  label,
  children,
  placeholder,
  leading,
  className,
  inputClassName,
}: InlineEditableProps) {
  const gt = useGT();
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;
  const multiline = field === "bio";
  const limit = PROFILE_LIMITS[field];

  const start = () => setDraft(value);
  const cancel = () => setDraft(null);
  const commit = () => {
    if (draft === null) return;
    const next = normalizeInlineValue(field, draft);
    setDraft(null);
    if (next !== value) onSave(next);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    } else if (e.key === "Enter" && !(multiline && e.shiftKey) && !e.nativeEvent.isComposing) {
      e.preventDefault();
      commit();
    }
  };

  if (editing) {
    const shared = {
      autoFocus: true,
      value: draft,
      maxLength: limit,
      placeholder,
      "aria-label": label,
      onKeyDown,
      onBlur: commit,
      onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const len = e.currentTarget.value.length;
        e.currentTarget.setSelectionRange(len, len);
      },
      className: cn(
        "w-full min-w-0 rounded-md bg-black/40 border border-white/15 px-2 py-1 text-white placeholder:text-white/40",
        "outline-none focus:border-[var(--app-accent)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--app-accent)_35%,transparent)]",
        inputClassName,
      ),
    };
    return (
      <div data-inline-editor className={cn("flex flex-col gap-1", className)}>
        <div className="flex items-center gap-1.5 min-w-0">
          {leading}
          {multiline ? (
            <textarea
              {...shared}
              onChange={(e) => setDraft(e.target.value)}
              rows={5}
              className={cn(shared.className, "resize-none text-sm leading-relaxed scrollbar-hide")}
            />
          ) : (
            <input {...shared} type="text" onChange={(e) => setDraft(e.target.value)} />
          )}
        </div>
        <div className="flex items-center justify-between gap-2 text-[11px] text-white/50">
          <span>
            {multiline
              ? gt("Enter to save · Shift+Enter for a new line · Esc to cancel")
              : gt("Enter to save · Esc to cancel")}
          </span>
          {(multiline || draft.length > limit - 10) && (
            <span className={cn("tabular-nums", draft.length >= limit && "text-amber-400")}>
              {draft.length}/{limit}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn("group/inline relative rounded-md -mx-1 px-1 transition-colors duration-150 hover:bg-white/[0.05] cursor-text", className)}
      onDoubleClick={start}
      title={gt("Double-click to edit")}
    >
      {children}
      <button
        type="button"
        onClick={start}
        aria-label={label}
        className={cn(
          "absolute top-1/2 -translate-y-1/2 right-0.5 flex size-6 items-center justify-center rounded-md text-white/70 bg-black/40",
          "opacity-0 transition-opacity duration-150 group-hover/inline:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100",
          "hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]",
          multiline && "top-1 translate-y-0",
        )}
      >
        <Pencil className="w-3 h-3" />
      </button>
    </div>
  );
}
