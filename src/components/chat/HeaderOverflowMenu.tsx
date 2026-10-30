"use client";

import type { ReactNode } from "react";
import { MoreVertical } from "lucide-react";
import { useGT } from "gt-next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface HeaderOverflowItem {
  key: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  hidden?: boolean;
}

/**
 * "⋯" menu for a narrow chat header. The channel or DM name keeps the room
 * and the less-used buttons move in here. `.chat-header-more` shows it only
 * while the header itself is under 760px.
 */
export function HeaderOverflowMenu({ items, className }: { items: HeaderOverflowItem[]; className?: string }) {
  const gt = useGT();
  const visible = items.filter((item) => !item.hidden);
  if (visible.length === 0) return null;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "chat-header-more h-11 w-10 shrink-0 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] active:scale-95",
            className
          )}
          title={gt("More options")}
          aria-label={gt("More options")}
        >
          <MoreVertical className="h-5 w-5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[200px]">
        {visible.map((item) => (
          <DropdownMenuItem key={item.key} onSelect={item.onSelect} className="min-h-11 gap-3 text-[15px]">
            <span className="flex h-5 w-5 items-center justify-center text-[var(--text-secondary)]">{item.icon}</span>
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
