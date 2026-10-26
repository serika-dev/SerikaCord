"use client";

import type { ReactNode } from "react";

/** Discord's "Upload requirements" card on the Emoji / Stickers / Soundboard pages. */
export function UploadRequirements({
  title,
  items,
  action,
}: {
  title: ReactNode;
  items: ReactNode[];
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-[var(--text-muted)]">{title}</p>
        <ul className="mt-2 space-y-1 text-[13px] leading-snug text-[var(--text-secondary)]">
          {items.map((item, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--text-muted)]" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
