"use client";

/**
 * One row under the server header (Server Guide, Channels & Roles, Members),
 * desktop sidebar and mobile server view alike, styled like Discord's. Active
 * while its page is open.
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function ServerNavLink({
  href,
  icon: Icon,
  label,
  variant = "sidebar",
  trailing,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  variant?: "sidebar" | "mobile";
  /** Small pill after the label (e.g. the guide's to-do progress). */
  trailing?: ReactNode;
}) {
  const pathname = usePathname();
  const active = pathname === href;
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
      <Icon className={cn("h-4 w-4 shrink-0", active && "text-[var(--app-accent)]")} aria-hidden />
      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
      {trailing}
    </Link>
  );
}
