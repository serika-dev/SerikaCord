"use client";

import { Crown } from "lucide-react";
import { useGT } from "gt-next";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * Shown instead of "Leave Server" to the server owner (CORD-77): owners can't
 * leave their own server, so this explains why and opens Server Settings,
 * where the owner can delete it.
 */
export function OwnerLeaveHintItem({ onOpenSettings, className }: { onOpenSettings: () => void; className?: string }) {
  const gt = useGT();
  return (
    <DropdownMenuItem onSelect={onOpenSettings} className={cn("items-start cursor-pointer", className)}>
      <Crown className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium">{gt("You own this server")}</span>
        <span className="text-xs leading-snug opacity-75 whitespace-normal">
          {gt("Owners can't leave their own server. You can delete it in Server Settings.")}
        </span>
      </span>
    </DropdownMenuItem>
  );
}
