"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { MicOff } from "lucide-react";
import { cn, cdnImage } from "@/lib/utils";
import type { VoiceParticipant } from "@/lib/services/voiceService";

interface VoiceParticipantAvatarProps {
  participant: Pick<VoiceParticipant, "userId" | "username" | "displayName" | "avatar" | "audio">;
  speaking?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZES = {
  sm: "w-8 h-8",
  md: "w-14 h-14",
  lg: "w-20 h-20",
} as const;

/**
 * Avatar tile for a voice participant with a green "speaking" ring and a
 * muted badge — the core visual shared across the voice bar and video grid.
 */
export function VoiceParticipantAvatar({
  participant,
  speaking = false,
  size = "md",
  className,
}: VoiceParticipantAvatarProps) {
  const name = participant.displayName || participant.username || "?";
  const muted = !participant.audio;

  return (
    <div className={cn("relative flex-shrink-0", className)}>
      <div
        className={cn(
          "rounded-full transition-shadow duration-100",
          speaking && !muted && "ring-2 ring-[#22c55e] ring-offset-2 ring-offset-[#0a0d15] shadow-[0_0_12px_rgba(34,197,94,0.5)]"
        )}
      >
        <Avatar className={cn(SIZES[size])}>
          <AvatarImage src={cdnImage(participant.avatar)} alt="" />
          <AvatarFallback className="bg-gradient-to-br from-[#8B5CF6] to-[#6366F1] text-white font-semibold">
            {name.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      </div>
      {muted && (
        <div
          className={cn(
            "absolute -bottom-0.5 -right-0.5 rounded-full bg-[#ef4444] flex items-center justify-center ring-2 ring-[#0a0d15]",
            size === "sm" ? "w-4 h-4" : "w-6 h-6"
          )}
        >
          <MicOff className={cn("text-white", size === "sm" ? "w-2.5 h-2.5" : "w-3.5 h-3.5")} />
        </div>
      )}
    </div>
  );
}
