"use client";

/**
 * "Server Guide" row under the server header (desktop sidebar and mobile
 * server view, like Discord), shown when the server has a guide. Carries a
 * small "done/total" pill while the new member to-dos aren't finished.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useGT } from "gt-next";
import { Signpost } from "lucide-react";
import { useServerOnboarding } from "@/hooks/useServerOnboarding";
import { cn } from "@/lib/utils";

export function ServerGuideEntry({ serverId, variant = "sidebar" }: { serverId: string; variant?: "sidebar" | "mobile" }) {
  const gt = useGT();
  const pathname = usePathname();
  const { data } = useServerOnboarding(serverId);

  const guide = data?.guide;
  if (!data || !guide) return null;

  const href = `/channels/${serverId}/guide`;
  const active = pathname === href;
  const total = guide.todos.length;
  const done = guide.todos.filter((t) => data.member.todosDone.includes(t.id)).length;
  const showProgress = total > 0 && done < total;

  return (
    <Link
      href={href}
      prefetch={false}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-2 text-left transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--app-accent)]/60",
        variant === "sidebar"
          ? "px-4 h-10 border-b border-[var(--border-subtle)] text-sm hover:bg-[var(--bg-sidebar-elevated)] hover:text-[var(--text-primary)]"
          : "px-4 py-3 border-b border-[var(--border-subtle)] text-sm active:bg-[var(--bg-hover)]",
        active ? "bg-[var(--bg-hover)] text-[var(--text-primary)]" : "text-[var(--text-secondary)]",
      )}
    >
      <Signpost className={cn("h-4 w-4 shrink-0", active && "text-[var(--app-accent)]")} aria-hidden />
      <span className="min-w-0 flex-1 truncate font-medium">{gt("Server Guide")}</span>
      {showProgress && (
        <span
          className="shrink-0 rounded-full bg-[var(--app-accent)] px-1.5 py-0.5 text-[10px] font-bold leading-none text-[var(--text-on-accent)] tabular-nums"
          aria-label={gt("{done} of {total} to-dos done", { done, total })}
        >
          {done}/{total}
        </span>
      )}
    </Link>
  );
}
