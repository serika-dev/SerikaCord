"use client";

import { useSyncExternalStore } from "react";
import { useGT } from "gt-next";
import { HeadphoneOff, MicOff, Video } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn, cdnImage } from "@/lib/utils";
import { useSpeakingUsers } from "@/hooks/useSpeakingUsers";
import type { VoiceParticipant } from "@/lib/services/voiceService";
import {
  getServerUserVoicePrefs,
  getUserVoicePref,
  getUserVoicePrefs,
  subscribeUserVoicePrefs,
} from "@/lib/voice/userVolume";
import { useVoiceUserMenu } from "@/components/voice/VoiceUserMenu";

/** dataTransfer type for dragging someone onto another voice channel (Move To). */
export const VOICE_MEMBER_DRAG_TYPE = "application/x-serika-voice-member";

export function readVoiceMemberDrag(e: React.DragEvent): { userId: string; fromChannelId: string } | null {
  try {
    const raw = e.dataTransfer.getData(VOICE_MEMBER_DRAG_TYPE);
    const data = raw ? JSON.parse(raw) : null;
    if (data && typeof data.userId === "string" && typeof data.fromChannelId === "string") return data;
  } catch {
    // not ours
  }
  return null;
}

export function isVoiceMemberDrag(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes(VOICE_MEMBER_DRAG_TYPE);
}

/**
 * The people under a voice channel in the channel list, Discord-style:
 * speaking ring (for the channel you're in), mute / deafen icons (red when a
 * moderator did it, yellow when you muted them for yourself), camera and
 * "live" badges. Right-click for volume and moderation; with Move Members,
 * drag someone onto another voice channel to move them.
 */
export function VoiceChannelMembers({
  participants,
  active,
  serverId,
  channelId,
  canMove,
}: {
  participants: VoiceParticipant[];
  /** You're connected to this channel (live speaking indicators). */
  active: boolean;
  serverId: string;
  channelId: string;
  canMove: boolean;
}) {
  const gt = useGT();
  const speaking = useSpeakingUsers();
  const prefs = useSyncExternalStore(subscribeUserVoicePrefs, getUserVoicePrefs, getServerUserVoicePrefs);
  const { openVoiceUserMenu, voiceUserMenu } = useVoiceUserMenu({ serverId, channelId });

  if (participants.length === 0) return null;

  return (
    <div className="ml-6 mr-2 space-y-0.5 mb-1" role="list" aria-label={gt("In voice")}>
      {participants.map((p) => {
        const name = p.displayName || p.username;
        const isSpeaking = active && speaking.has(p.userId) && p.audio && !p.serverMute;
        const localMuted = getUserVoicePref(prefs, p.userId).muted;
        return (
          <div
            key={p.userId}
            role="listitem"
            draggable={canMove}
            onDragStart={(e) => {
              e.stopPropagation();
              if (!canMove) return;
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData(VOICE_MEMBER_DRAG_TYPE, JSON.stringify({ userId: p.userId, fromChannelId: channelId }));
            }}
            onContextMenu={(e) => openVoiceUserMenu(e, p)}
            className={cn(
              "flex items-center gap-1.5 px-1.5 py-0.5 rounded hover:bg-[var(--bg-sidebar-elevated)] transition-colors",
              canMove && "cursor-grab active:cursor-grabbing",
            )}
          >
            <span
              className={cn(
                "shrink-0 rounded-full transition-shadow duration-100",
                isSpeaking && "ring-2 ring-[#23a55a] ring-offset-1 ring-offset-[var(--bg-sidebar)]",
              )}
            >
              <Avatar className="w-5 h-5">
                <AvatarImage src={cdnImage(p.avatar)} />
                <AvatarFallback className="bg-[var(--app-accent)] text-[var(--text-on-accent)] text-[9px]">
                  {name.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </span>
            <span
              className={cn(
                "text-xs truncate flex-1",
                isSpeaking ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]",
              )}
            >
              {name}
            </span>
            {p.screenShare && (
              <span className="shrink-0 rounded bg-[#f23f43] px-1 text-[9px] font-bold uppercase leading-[14px] text-white">
                {gt("Live")}
              </span>
            )}
            {p.video && !p.screenShare && <Video className="w-3 h-3 shrink-0 text-[var(--text-muted)]" aria-label={gt("Camera on")} />}
            {(p.serverMute || !p.audio) && (
              <MicOff
                className={cn("w-3 h-3 shrink-0", p.serverMute ? "text-[#f23f43]" : "text-[var(--text-muted)]")}
                aria-label={p.serverMute ? gt("Server Muted") : gt("Muted")}
              />
            )}
            {localMuted && !p.serverMute && p.audio && (
              <MicOff className="w-3 h-3 shrink-0 text-[#f0b232]" aria-label={gt("Muted for you")} />
            )}
            {(p.serverDeaf || p.deafened) && (
              <HeadphoneOff
                className={cn("w-3 h-3 shrink-0", p.serverDeaf ? "text-[#f23f43]" : "text-[var(--text-muted)]")}
                aria-label={p.serverDeaf ? gt("Server Deafened") : gt("Deafened")}
              />
            )}
          </div>
        );
      })}
      {voiceUserMenu}
    </div>
  );
}
