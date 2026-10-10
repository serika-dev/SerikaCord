"use client";

import { useGT } from "gt-next";
import { flushUserNote, saveUserNote, useUserNote } from "@/lib/social/notesStore";
import { USER_NOTE_MAX } from "@/lib/social/userNotes";
import { cn } from "@/lib/utils";

/**
 * Discord's "Note (only visible to you)" field on profiles. Autosaves while
 * you type and syncs to your other tabs and devices.
 */
export function UserNoteField({ userId, className }: { userId: string; className?: string }) {
  const gt = useGT();
  const note = useUserNote(userId);
  return (
    <div className={className}>
      <label htmlFor={`note-${userId}`} className="block text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wide mb-1">
        {gt("Note")} <span className="normal-case font-normal text-[var(--text-muted)]">{gt("(only visible to you)")}</span>
      </label>
      <textarea
        id={`note-${userId}`}
        value={note}
        maxLength={USER_NOTE_MAX}
        rows={1}
        onChange={(e) => void saveUserNote(userId, e.target.value)}
        onBlur={() => flushUserNote(userId)}
        placeholder={gt("Click to add a note")}
        className={cn(
          "w-full resize-none rounded-md bg-transparent px-1.5 py-1 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]",
          "outline-none border border-transparent focus:border-[var(--border-subtle)] focus:bg-[var(--bg-app)] [field-sizing:content] max-h-32"
        )}
      />
    </div>
  );
}
