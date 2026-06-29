"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, MicOff, Headphones, PhoneOff, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import { voiceService, type VoiceParticipant } from "@/lib/services/voiceService";

interface VoiceBarProps {
  channelName?: string;
  serverId?: string;
  className?: string;
}

export function VoiceBar({ channelName, className }: VoiceBarProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
  const [currentChannel, setCurrentChannel] = useState<string | null>(null);

  useEffect(() => {
    const unsub = voiceService.subscribe((event) => {
      if (event.type === "connected") {
        setIsConnected(true);
        setCurrentChannel(voiceService.currentRoomId);
      } else if (event.type === "disconnected") {
        setIsConnected(false);
        setCurrentChannel(null);
        setIsMuted(false);
        setIsDeafened(false);
        setParticipants([]);
      } else if (event.type === "participants_changed") {
        setParticipants(event.participants);
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
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <div className="relative flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-xs font-medium text-green-400">Voice Connected</span>
              </div>
            </div>
            {(channelName || currentChannel) && (
              <span className="text-[10px] text-[#6b7387] truncate max-w-[120px]">
                #{channelName || currentChannel}
              </span>
            )}
          </div>

          {/* Participants */}
          {participants.length > 0 && (
            <div className="flex items-center gap-1 mb-2 flex-wrap">
              {participants.slice(0, 6).map((p) => (
                <div
                  key={p.userId}
                  className={cn(
                    "flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px]",
                    "bg-[#131a28] border border-[#1e2637]",
                    !p.audio && "opacity-60"
                  )}
                  title={p.displayName || p.username}
                >
                  {p.audio ? (
                    <Volume2 className="w-2.5 h-2.5 text-green-400" />
                  ) : (
                    <VolumeX className="w-2.5 h-2.5 text-[#ef4444]" />
                  )}
                  <span className="text-[#d5d9e8] max-w-[60px] truncate">
                    {p.displayName || p.username}
                  </span>
                </div>
              ))}
              {participants.length > 6 && (
                <span className="text-[10px] text-[#6b7387]">+{participants.length - 6}</span>
              )}
            </div>
          )}

          {/* Controls */}
          <div className="flex items-center gap-1">
            <button
              onClick={handleMute}
              title={isMuted ? "Unmute" : "Mute"}
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
              title={isDeafened ? "Undeafen" : "Deafen"}
              className={cn(
                "flex items-center justify-center w-8 h-8 rounded-lg transition-all active:scale-95",
                isDeafened
                  ? "bg-[#ef4444]/20 text-[#ef4444] hover:bg-[#ef4444]/30"
                  : "bg-[#1e2637] text-[#8d97ad] hover:bg-[#243044] hover:text-[#d5d9e8]"
              )}
            >
              <Headphones className="w-4 h-4" />
            </button>

            <div className="flex-1" />

            <button
              onClick={handleDisconnect}
              title="Disconnect"
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
