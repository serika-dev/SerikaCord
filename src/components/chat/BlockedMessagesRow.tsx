"use client";

import { memo } from "react";
import { Ban } from "lucide-react";
import { useGT } from "gt-next";

/** Discord's collapsed "N Blocked Messages — Show messages" row. */
export const BlockedMessagesRow = memo(function BlockedMessagesRow({
  count,
  open,
  onToggle,
}: {
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  const gt = useGT();
  const label = count === 1 ? gt("1 Blocked Message") : gt("{count} Blocked Messages", { count });
  return (
    <div className="flex items-center gap-2 px-4 py-1.5 my-0.5 text-sm text-[var(--text-muted)]">
      <Ban className="w-4 h-4 shrink-0" aria-hidden />
      <span className="font-medium">{label}</span>
      <span aria-hidden>—</span>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="text-[var(--app-accent)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--app-accent)] rounded"
      >
        {open
          ? count === 1 ? gt("Hide message") : gt("Hide messages")
          : count === 1 ? gt("Show message") : gt("Show messages")}
      </button>
    </div>
  );
});
