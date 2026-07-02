"use client";

import { cn } from "@/lib/utils";

interface StaffPillProps {
  badges?: string[];
  className?: string;
}

const STAFF_RANKS: { id: string; label: string }[] = [
  { id: "serikacord_developer", label: "Developer" },
  { id: "staff", label: "Serika Staff" },
  { id: "admin", label: "Admin" },
  { id: "moderator", label: "Moderator" },
];

export function StaffPill({ badges, className }: StaffPillProps) {
  if (!badges || badges.length === 0) return null;

  for (const rank of STAFF_RANKS) {
    if (badges.includes(rank.id)) {
      return (
        <span
          className={cn(
            "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold leading-none bg-[#8B5CF6]/20 text-[#A78BFA] whitespace-nowrap",
            className
          )}
        >
          {rank.label}
        </span>
      );
    }
  }

  return null;
}
