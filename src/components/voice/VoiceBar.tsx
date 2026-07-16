"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, MicOff, Headphones, HeadphoneOff, PhoneOff, Video, VideoOff, Monitor, MonitorOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { voiceService, type VoiceParticipant } from "@/lib/services/voiceService";
import { useSpeakingUsers } from "@/hooks/useSpeakingUsers";
import { VoiceParticipantAvatar } from "@/components/voice/VoiceParticipantAvatar";
import { onHotkey } from "@/lib/keybinds";
import { useGT } from "gt-next";

interface VoiceBarProps {
  channelName?: string;
  serverId?: string;
  className?: string;
}

export function VoiceBar({ channelName, className }: VoiceBarProps) {
  const gt = useGT();
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
  const [currentChannel, setCurrentChannel] = useState<string | null>(null);
  const speakingUsers = useSpeakingUsers();

  useEffect(() => {
    // Sync from service on mount
    setIsConnected(voiceService.connected);
    setIsMuted(voiceService.muted);
    setIsDeafened(voiceService.deafened);
    setIsVideoOn(voiceService.videoOn);
    setIsScreenSharing(voiceService.screenSharing);
    setParticipants(voiceService.currentParticipants);
    setCurrentChannel(voiceService.currentRoomId);

    const unsub = voiceService.subscribe((event) => {
      if (event.type === "connected") {
        setIsConnected(true);
        setCurrentChannel(voiceService.currentRoomId);
        setIsMuted(voiceService.muted);
        setIsDeafened(voiceService.deafened);
      } else if (event.type === "disconnected") {
        setIsConnected(false);
        setCurrentChannel(null);
        setIsMuted(false);
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
        if (voiceService.connected && currentChannel) {
          // currentChannel is a roomId string like "serverId:channelId"
          const parts = currentChannel.split(":");
          if (parts.length >= 2) {
            window.location.href = `/channels/${parts[0]}/${parts[1]}`;
          }
        }
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [handleMute, handleDeafen]);

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
    await voiceService.leaveChannel();
  }, []);

  return (
    <AnimatePresence>
      {isConnected && (
        <motion.div
          key="voice-bar"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className={cn(
            "bg-[#0a0d15] border-t border-[#1e2637] px-3 py-2",
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
              {(channelName || currentChannel) && (
                <span className="text-[11px] text-[#6b7387] truncate">
                  — {channelName || currentChannel}
                </span>
              )}
            </div>
            <span className="text-[10px] text-[#6b7387] flex-shrink-0">
              {participants.length + 1} {gt("in call")}
            </span>
          </div>

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
              <span className="text-[10px] text-[#8d97ad] max-w-[56px] truncate">{gt("You")}</span>
            </div>
            {participants.filter(p => p.userId !== voiceService.myId).map((p) => (
              <div key={p.userId} className="flex flex-col items-center gap-1">
                <VoiceParticipantAvatar
                  participant={p}
                  speaking={speakingUsers.has(p.userId)}
                  size="md"
                />
                <span className="text-[10px] text-[#8d97ad] max-w-[56px] truncate">
                  {p.displayName || p.username}
                </span>
              </div>
            ))}
          </div>

          {/* Controls */}
          <div className="flex items-center gap-1">
            <button
              onClick={handleMute}
              title={isMuted ? gt("Unmute") : gt("Mute")}
              className={cn(
                "flex items-center justify-center w-8 h-8 rounded-lg transition-all active:scale-95",
                isMuted
                  ? "bg-[#ef4444]/20 text-[#ef4444] hover:bg-[#ef4444]/30"
                  : "bg-[#1e2637] text-[#8d97ad] hover:bg-[#243044] hover:text-[#d5d9e8]"
              )}
            >
              {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>

            <button
              onClick={handleDeafen}
              title={isDeafened ? gt("Undeafen") : gt("Deafen")}
              className={cn(
                "flex items-center justify-center w-8 h-8 rounded-lg transition-all active:scale-95",
                isDeafened
                  ? "bg-[#ef4444]/20 text-[#ef4444] hover:bg-[#ef4444]/30"
                  : "bg-[#1e2637] text-[#8d97ad] hover:bg-[#243044] hover:text-[#d5d9e8]"
              )}
            >
              {isDeafened ? <HeadphoneOff className="w-4 h-4" /> : <Headphones className="w-4 h-4" />}
            </button>

            <button
              onClick={handleVideo}
              title={isVideoOn ? gt("Turn Off Camera") : gt("Turn On Camera")}
              className={cn(
                "flex items-center justify-center w-8 h-8 rounded-lg transition-all active:scale-95",
                isVideoOn
                  ? "bg-[#8B5CF6]/20 text-[#8B5CF6] hover:bg-[#8B5CF6]/30"
                  : "bg-[#1e2637] text-[#8d97ad] hover:bg-[#243044] hover:text-[#d5d9e8]"
              )}
            >
              {isVideoOn ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
            </button>

            {/* Screen share — hidden on mobile (getDisplayMedia not supported) */}
            {!isScreenSharing && null}
            {isScreenSharing && (
              <button
                onClick={handleScreenShare}
                title={gt("Stop Sharing")}
                className={cn(
                  "flex items-center justify-center w-8 h-8 rounded-lg transition-all active:scale-95",
                  "bg-[#8B5CF6]/20 text-[#8B5CF6] hover:bg-[#8B5CF6]/30"
                )}
              >
                <MonitorOff className="w-4 h-4" />
              </button>
            )}

            <div className="flex-1" />

            <button
              onClick={handleDisconnect}
              title={gt("Disconnect")}
              className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#ef4444]/15 text-[#ef4444] hover:bg-[#ef4444]/25 transition-all active:scale-95"
            >
              <PhoneOff className="w-4 h-4" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
