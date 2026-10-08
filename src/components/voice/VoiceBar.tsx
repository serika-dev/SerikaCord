"use client";

import { useState, useEffect, useCallback, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, MicOff, Headphones, HeadphoneOff, PhoneOff, Video, VideoOff, Monitor, MonitorOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { voiceService, type VoiceParticipant } from "@/lib/services/voiceService";
import { hangUp } from "@/lib/services/dmCallController";
import { useSpeakingUsers } from "@/hooks/useSpeakingUsers";
import { VoiceParticipantAvatar } from "@/components/voice/VoiceParticipantAvatar";
import { onHotkey } from "@/lib/keybinds";
import { useGT } from "gt-next";

interface VoiceBarProps {
  /** Overrides the room label the call was joined with. */
  channelName?: string;
  serverId?: string;
  className?: string;
  /** Don't render while connected to this room (a fuller call UI is on screen). */
  hideForRoomId?: string | null;
}

const subscribeVoice = (onChange: () => void) => voiceService.subscribe((e) => {
  if (e.type === "connected" || e.type === "disconnected" || e.type === "meta_changed") onChange();
});

export function VoiceBar({ channelName, className, hideForRoomId }: VoiceBarProps) {
  const gt = useGT();
  const router = useRouter();
  // Label + link the call was joined with ("general", "@friend"), so the bar
  // names the call on every page instead of a raw room id or nothing.
  const metaLabel = useSyncExternalStore(subscribeVoice, () => voiceService.roomMeta.label ?? "", () => "");
  const metaHref = useSyncExternalStore(subscribeVoice, () => voiceService.roomMeta.href ?? "", () => "");
  const label = channelName || metaLabel;
  // Start from the live call so the bar is right when it mounts mid-call
  // (navigating between pages). Before any call this is all "off", which is
  // also what the server rendered.
  const [isConnected, setIsConnected] = useState(() => voiceService.connected);
  const [isMuted, setIsMuted] = useState(() => voiceService.muted);
  const [listenOnly, setListenOnly] = useState(() => voiceService.listenOnly);
  const [isDeafened, setIsDeafened] = useState(() => voiceService.deafened);
  const [isVideoOn, setIsVideoOn] = useState(() => voiceService.videoOn);
  const [isScreenSharing, setIsScreenSharing] = useState(() => voiceService.screenSharing);
  const [participants, setParticipants] = useState<VoiceParticipant[]>(() => voiceService.currentParticipants);
  const [currentChannel, setCurrentChannel] = useState<string | null>(() => voiceService.currentRoomId);
  const speakingUsers = useSpeakingUsers();

  useEffect(() => {
    const unsub = voiceService.subscribe((event) => {
      if (event.type === "connected") {
        setIsConnected(true);
        setCurrentChannel(voiceService.currentRoomId);
        setIsMuted(voiceService.muted);
        setListenOnly(voiceService.listenOnly);
        setIsDeafened(voiceService.deafened);
      } else if (event.type === "disconnected") {
        setIsConnected(false);
        setCurrentChannel(null);
        setIsMuted(false);
        setListenOnly(false);
        setIsDeafened(false);
        setIsVideoOn(false);
        setIsScreenSharing(false);
        setParticipants([]);
      } else if (event.type === "participants_changed") {
        setParticipants(event.participants);
      } else if (event.type === "video_toggled") {
        setIsVideoOn(event.enabled);
      } else if (event.type === "screen_share_toggled") {
        setIsScreenSharing(event.enabled);
      } else if (event.type === "mute_toggled") {
        setIsMuted(event.muted);
      } else if (event.type === "listen_only") {
        setListenOnly(event.enabled);
      } else if (event.type === "deafen_toggled") {
        setIsDeafened(event.deafened);
        if (event.deafened) setIsMuted(true);
      }
    });
    return unsub;
  }, []);

  const handleMute = useCallback(() => {
    const muted = voiceService.toggleMute();
    setIsMuted(muted);
  }, []);

  const handleDeafen = useCallback(() => {
    const deafened = voiceService.toggleDeafen();
    setIsDeafened(deafened);
    if (deafened) setIsMuted(true);
  }, []);

  // Ctrl+Shift+M / Ctrl+Shift+D global toggles (only act while connected).
  useEffect(() => {
    const unsubs = [
      onHotkey("toggle-mute", () => { if (voiceService.connected) handleMute(); }),
      onHotkey("toggle-deafen", () => { if (voiceService.connected) handleDeafen(); }),
      onHotkey("return-to-voice", () => {
        const href = voiceService.roomMeta.href;
        if (voiceService.connected && href) router.push(href);
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [handleMute, handleDeafen, router]);

  const handleVideo = useCallback(async () => {
    const videoOn = await voiceService.toggleVideo();
    setIsVideoOn(videoOn);
  }, []);

  const handleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      voiceService.stopScreenShare();
      setIsScreenSharing(false);
    } else {
      const sharing = await voiceService.startScreenShare();
      setIsScreenSharing(sharing);
    }
  }, [isScreenSharing]);

  const handleDisconnect = useCallback(async () => {
    await hangUp();
  }, []);

  const hidden = !!hideForRoomId && currentChannel === hideForRoomId;

  return (
    <AnimatePresence>
      {isConnected && !hidden && (
        <motion.div
          key="voice-bar"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className={cn(
            "bg-[var(--bg-app)] border-t border-[var(--app-border)] px-3 py-2",
            className
          )}
        >
          {/* Status row */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="relative flex h-2 w-2 flex-shrink-0">
                <span className="absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-60 animate-ping" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </span>
              <span className="text-xs font-semibold text-green-400 flex-shrink-0">{gt("Voice Connected")}</span>
              {/* Never show the raw room id ("channel-<uuid>") as a name. */}
              {label && (metaHref ? (
                <Link
                  href={metaHref}
                  title={gt("Return to call")}
                  className="text-[11px] text-[var(--app-muted-2)] truncate hover:text-[var(--text-primary)] hover:underline"
                >
                  — {label}
                </Link>
              ) : (
                <span className="text-[11px] text-[var(--app-muted-2)] truncate">
                  — {label}
                </span>
              ))}
            </div>
            <span className="text-[10px] text-[var(--app-muted-2)] flex-shrink-0">
              {participants.filter((p) => p.userId !== voiceService.myId).length + 1} {gt("in call")}
            </span>
          </div>

          {listenOnly && (
            <div
              role="status"
              className="mb-2 flex items-center gap-1.5 rounded-md bg-[#ef4444]/10 px-2 py-1 text-[11px] text-[var(--text-primary)]"
            >
              <MicOff className="h-3 w-3 shrink-0 text-[#ef4444]" aria-hidden />
              <span className="min-w-0">{gt("No microphone — you can listen but others can't hear you")}</span>
            </div>
          )}

          {/* Participant avatars with speaking rings */}
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <div className="flex flex-col items-center gap-1">
              <VoiceParticipantAvatar
                participant={{
                  userId: voiceService.myId,
                  username: gt("You"),
                  displayName: gt("You"),
                  audio: !isMuted,
                }}
                speaking={speakingUsers.has(voiceService.myId)}
                size="md"
              />
              <span className="text-[10px] text-[var(--app-muted)] max-w-[56px] truncate">{gt("You")}</span>
            </div>
            {participants.filter(p => p.userId !== voiceService.myId).map((p) => (
              <div key={p.userId} className="flex flex-col items-center gap-1">
                <VoiceParticipantAvatar
                  participant={p}
                  speaking={speakingUsers.has(p.userId)}
                  size="md"
                />
                <span className="text-[10px] text-[var(--app-muted)] max-w-[56px] truncate">
                  {p.displayName || p.username}
                </span>
              </div>
            ))}
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2 sm:gap-1">
            <button
              onClick={handleMute}
              title={listenOnly ? gt("No microphone — press to try again") : isMuted ? gt("Unmute") : gt("Mute")}
              aria-label={listenOnly ? gt("No microphone — press to try again") : isMuted ? gt("Unmute") : gt("Mute")}
              className={cn(
                "flex items-center justify-center w-10 h-10 sm:w-8 sm:h-8 rounded-lg transition-all active:scale-95",
                isMuted
                  ? "bg-[#ef4444]/20 text-[#ef4444] hover:bg-[#ef4444]/30"
                  : "bg-[var(--app-border)] text-[var(--app-muted)] hover:bg-[var(--border-strong)] hover:text-[var(--text-primary)]"
              )}
            >
              {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>

            <button
              onClick={handleDeafen}
              title={isDeafened ? gt("Undeafen") : gt("Deafen")}
              className={cn(
                "flex items-center justify-center w-10 h-10 sm:w-8 sm:h-8 rounded-lg transition-all active:scale-95",
                isDeafened
                  ? "bg-[#ef4444]/20 text-[#ef4444] hover:bg-[#ef4444]/30"
                  : "bg-[var(--app-border)] text-[var(--app-muted)] hover:bg-[var(--border-strong)] hover:text-[var(--text-primary)]"
              )}
            >
              {isDeafened ? <HeadphoneOff className="w-4 h-4" /> : <Headphones className="w-4 h-4" />}
            </button>

            <button
              onClick={handleVideo}
              title={isVideoOn ? gt("Turn Off Camera") : gt("Turn On Camera")}
              className={cn(
                "flex items-center justify-center w-10 h-10 sm:w-8 sm:h-8 rounded-lg transition-all active:scale-95",
                isVideoOn
                  ? "bg-[#8B5CF6]/20 text-[#8B5CF6] hover:bg-[#8B5CF6]/30"
                  : "bg-[var(--app-border)] text-[var(--app-muted)] hover:bg-[var(--border-strong)] hover:text-[var(--text-primary)]"
              )}
            >
              {isVideoOn ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
            </button>

            {/* Screen share — start is desktop-only (getDisplayMedia isn't on mobile) */}
            <button
              onClick={handleScreenShare}
              title={isScreenSharing ? gt("Stop Sharing") : gt("Share Your Screen")}
              aria-pressed={isScreenSharing}
              className={cn(
                "items-center justify-center w-10 h-10 sm:w-8 sm:h-8 rounded-lg transition-all active:scale-95",
                isScreenSharing
                  ? "flex bg-[#8B5CF6]/20 text-[#8B5CF6] hover:bg-[#8B5CF6]/30"
                  : "hidden md:flex bg-[var(--app-border)] text-[var(--app-muted)] hover:bg-[var(--border-strong)] hover:text-[var(--text-primary)]"
              )}
            >
              {isScreenSharing ? <MonitorOff className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
            </button>

            <div className="flex-1" />

            <button
              onClick={handleDisconnect}
              title={gt("Disconnect")}
              className="flex items-center justify-center w-10 h-10 sm:w-8 sm:h-8 rounded-lg bg-[#ef4444]/15 text-[#ef4444] hover:bg-[#ef4444]/25 transition-all active:scale-95"
            >
              <PhoneOff className="w-4 h-4" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
