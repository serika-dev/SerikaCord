"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MicOff, Monitor, VideoOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { voiceService, type VoiceParticipant } from "@/lib/services/voiceService";

export function VideoGrid() {
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
  const [isVideoOn, setIsVideoOn] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const screenVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const unsub = voiceService.subscribe((event) => {
      if (event.type === "connected") {
        setIsConnected(true);
      } else if (event.type === "disconnected") {
        setIsConnected(false);
        setParticipants([]);
        setIsVideoOn(false);
        setIsScreenSharing(false);
      } else if (event.type === "participants_changed") {
        setParticipants(event.participants);
      } else if (event.type === "video_toggled") {
        setIsVideoOn(event.enabled);
      } else if (event.type === "screen_share_toggled") {
        setIsScreenSharing(event.enabled);
      }
    });
    return unsub;
  }, []);

  // Attach local stream to video element
  useEffect(() => {
    if (localVideoRef.current && isVideoOn) {
      const stream = voiceService.localAudioStream;
      if (stream) {
        localVideoRef.current.srcObject = stream;
      }
    }
  }, [isVideoOn]);

  // Attach screen share stream
  useEffect(() => {
    if (screenVideoRef.current && isScreenSharing) {
      const stream = voiceService.screenShareStream;
      if (stream) {
        screenVideoRef.current.srcObject = stream;
      }
    }
  }, [isScreenSharing]);

  if (!isConnected) return null;

  const videoParticipants = participants.filter(p => p.video || p.screenShare);
  const hasVideo = isVideoOn || videoParticipants.length > 0 || isScreenSharing;

  if (!hasVideo) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: "auto" }}
        exit={{ opacity: 0, height: 0 }}
        className="border-t border-[#1e2637] bg-[#0a0d15] p-3 overflow-hidden"
      >
        <div className={cn(
          "grid gap-2",
          videoParticipants.length === 0 && !isVideoOn && !isScreenSharing ? "grid-cols-1" :
          videoParticipants.length <= 1 && !isVideoOn ? "grid-cols-1" :
          videoParticipants.length <= 3 ? "grid-cols-2" :
          "grid-cols-3"
        )}>
          {/* Local video */}
          {isVideoOn && (
            <div className="relative rounded-lg overflow-hidden bg-[#131a28] aspect-video min-h-[120px]">
              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-full object-cover video-mirror"
              />
              <div className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/60 text-[10px] text-white">
                You
              </div>
            </div>
          )}

          {/* Local screen share */}
          {isScreenSharing && (
            <div className="relative rounded-lg overflow-hidden bg-[#131a28] aspect-video min-h-[120px] col-span-full">
              <video
                ref={screenVideoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-full object-contain"
              />
              <div className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/60 text-[10px] text-white flex items-center gap-1">
                <Monitor className="w-3 h-3" />
                Your Screen
              </div>
            </div>
          )}

          {/* Remote participants */}
          {videoParticipants.map((p) => (
            <RemoteVideo key={p.userId} participant={p} />
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function RemoteVideo({ participant }: { participant: VoiceParticipant }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && participant.stream) {
      videoRef.current.srcObject = participant.stream;
    }
  }, [participant.stream]);

  return (
    <div className="relative rounded-lg overflow-hidden bg-[#131a28] aspect-video min-h-[120px]">
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className={cn(
          "w-full h-full",
          participant.screenShare ? "object-contain col-span-full" : "object-cover"
        )}
      />
      <div className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/60 text-[10px] text-white flex items-center gap-1">
        {participant.screenShare && <Monitor className="w-3 h-3" />}
        {participant.displayName || participant.username}
        {!participant.audio && <MicOff className="w-3 h-3 text-red-400" />}
      </div>
      {!participant.video && !participant.screenShare && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-12 h-12 rounded-full bg-[#1e2637] flex items-center justify-center">
            <VideoOff className="w-5 h-5 text-[#6b7387]" />
          </div>
        </div>
      )}
    </div>
  );
}
