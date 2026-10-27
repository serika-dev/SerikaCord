"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useGT } from "gt-next";
import { SettingsButton } from "@/components/settings/blocks/SettingsButton";

/** Members shown per page (Server Settings → Members and the server Members page). */
export const MEMBERS_PAGE_SIZE = 50;

/** "Showing 1–50 of 812" with previous / next, under a member table. Renders nothing for one page. */
export function MembersPager({
  page,
  pageCount,
  total,
  onPage,
  pageSize = MEMBERS_PAGE_SIZE,
}: {
  /** 0-based. */
  page: number;
  pageCount: number;
  total: number;
  onPage: (page: number) => void;
  pageSize?: number;
}) {
  const gt = useGT();
  if (pageCount <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] px-4 py-2.5">
      <p className="text-xs text-[var(--text-muted)]">
        {gt("Showing {from}–{to} of {count}", {
          from: page * pageSize + 1,
          to: Math.min(total, (page + 1) * pageSize),
          count: total,
        })}
      </p>
      <div className="flex items-center gap-1">
        <SettingsButton size="sm" variant="ghost" disabled={page === 0} onClick={() => onPage(page - 1)} aria-label={gt("Previous page")}>
          <ChevronLeft />
        </SettingsButton>
        <span className="min-w-[56px] text-center text-xs tabular-nums text-[var(--text-secondary)]">
          {page + 1} / {pageCount}
        </span>
        <SettingsButton size="sm" variant="ghost" disabled={page >= pageCount - 1} onClick={() => onPage(page + 1)} aria-label={gt("Next page")}>
          <ChevronRight />
        </SettingsButton>
      </div>
    </div>
  );
}
