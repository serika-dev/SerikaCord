"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useServer } from "@/contexts/ServerContext";
import { ChatArea } from "@/components/chat/ChatArea";
import { MemberSidebar } from "@/components/chat/MemberSidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Loader2, Mic, MicOff, Video, VideoOff, Volume2, PhoneOff, Users } from "lucide-react";
import { toast } from "sonner";

type VoiceParticipant = {
  userId: string;
  username: string;
  audio: boolean;
  video: boolean;
  joinedAt: string;
};

function VoiceChannelView({ channelId, channelName }: { channelId: string; channelName: string }) {
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
  const [isJoining, setIsJoining] = useState(false);
  const [isJoined, setIsJoined] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const roomId = `channel-${channelId}`;

  const fetchRoomState = async () => {
    try {
      const response = await fetch(`/api/voice/state/${roomId}`);
      if (!response.ok) return;
      const data = await response.json();
      setParticipants(data.participants || []);
    } catch {
      // best effort
    }
  };

  const joinVoice = async () => {
    setIsJoining(true);
    setVoiceError(null);
    try {
      const tokenResponse = await fetch("/api/voice/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, channelId }),
      });

      if (!tokenResponse.ok) {
        const payload = await tokenResponse.json().catch(() => null);
        const message = payload?.error || "Voice is currently unavailable.";
        setVoiceError(message);
        toast.error(message);
        return;
      }

      const joinResponse = await fetch("/api/voice/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, channelId, audio: audioEnabled, video: videoEnabled }),
      });

      if (!joinResponse.ok) {
        const payload = await joinResponse.json().catch(() => null);
        const message = payload?.error || "Failed to join voice channel.";
        setVoiceError(message);
        toast.error(message);
        return;
      }

      const data = await joinResponse.json();
      setParticipants(data.participants || []);
      setIsJoined(true);
      toast.success("Joined voice channel");
    } catch {
      setVoiceError("Failed to join voice channel.");
      toast.error("Failed to join voice channel");
    } finally {
      setIsJoining(false);
    }
  };

  const leaveVoice = async () => {
    try {
      await fetch("/api/voice/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId }),
      });
    } catch {
      // no-op
    } finally {
      setIsJoined(false);
      void fetchRoomState();
      toast.success("Left voice channel");
    }
  };

  const updateJoinState = async (nextAudio: boolean, nextVideo: boolean) => {
    if (!isJoined) return;
    try {
      const response = await fetch("/api/voice/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, channelId, audio: nextAudio, video: nextVideo }),
      });
      if (!response.ok) return;
      const data = await response.json();
      setParticipants(data.participants || []);
    } catch {
      // best-effort
    }
  };

  useEffect(() => {
    void fetchRoomState();
    const interval = setInterval(() => {
      void fetchRoomState();
    }, 3500);
    return () => clearInterval(interval);
  }, [roomId]);

  useEffect(() => {
    return () => {
      if (isJoined) {
        void fetch("/api/voice/leave", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomId }),
        });
      }
    };
  }, [isJoined, roomId]);

  return (
    <div className="flex-1 flex flex-col bg-[#0a0a0a] min-w-0 min-h-0 overflow-hidden">
      <div className="h-12 px-4 flex items-center justify-between border-b border-[#1a1a1a] bg-[#111111]">
        <div className="flex items-center gap-2 min-w-0">
          <Volume2 className="w-5 h-5 text-[#8B5CF6]" />
          <span className="font-semibold text-white truncate">{channelName}</span>
        </div>
        <div className="text-xs text-[#888888]">
          {participants.length} {participants.length === 1 ? "participant" : "participants"}
        </div>
      </div>

      <div className="p-4 border-b border-[#1a1a1a] bg-[#0f0f0f]">
        <div className="flex flex-wrap items-center gap-2">
          {!isJoined ? (
            <Button
              onClick={joinVoice}
              disabled={isJoining}
              className="bg-[#8B5CF6] hover:bg-[#7C3AED] text-white"
            >
              {isJoining ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Join Voice
            </Button>
          ) : (
            <Button onClick={leaveVoice} variant="destructive" className="bg-red-500 hover:bg-red-600">
              <PhoneOff className="w-4 h-4 mr-2" />
              Leave
            </Button>
          )}

          <Button
            variant="outline"
            onClick={() => {
              const next = !audioEnabled;
              setAudioEnabled(next);
              void updateJoinState(next, videoEnabled);
            }}
            className="border-[#2a2a2a] bg-[#111111] hover:bg-[#1a1a1a] text-white"
          >
            {audioEnabled ? <Mic className="w-4 h-4 mr-2" /> : <MicOff className="w-4 h-4 mr-2 text-red-400" />}
            {audioEnabled ? "Mic On" : "Mic Off"}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              const next = !videoEnabled;
              setVideoEnabled(next);
              void updateJoinState(audioEnabled, next);
            }}
            className="border-[#2a2a2a] bg-[#111111] hover:bg-[#1a1a1a] text-white"
          >
            {videoEnabled ? <Video className="w-4 h-4 mr-2" /> : <VideoOff className="w-4 h-4 mr-2 text-red-400" />}
            {videoEnabled ? "Camera On" : "Camera Off"}
          </Button>
        </div>
        {voiceError && <p className="mt-3 text-sm text-red-400">{voiceError}</p>}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {participants.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-[#888888]">
            <Users className="w-10 h-10 mb-3 text-[#666666]" />
            <p>No one is connected yet.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {participants.map((participant) => (
              <div
                key={participant.userId}
                className="flex items-center justify-between p-3 rounded-lg bg-[#111111] border border-[#1a1a1a]"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar className="w-9 h-9">
                    <AvatarFallback className="bg-[#8B5CF6] text-white">
                      {participant.username.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="text-sm text-white truncate">{participant.username}</p>
                    <p className="text-xs text-[#666666]">
                      Joined {new Date(participant.joinedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-[#888888]">
                  {participant.audio ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4 text-red-400" />}
                  {participant.video ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4 text-red-400" />}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ChannelPage() {
  const params = useParams();
  const router = useRouter();
  const { servers, setCurrentServer, channels, setCurrentChannel, isLoading, fetchChannels, currentServer, currentChannel } = useServer();
  const [showMembers, setShowMembers] = useState(true);
  const [isMobile, setIsMobile] = useState(false);

  const serverId = params.serverId as string;
  const channelId = params.channelId as string;

  // Detect mobile
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Set current server when servers load
  useEffect(() => {
    if (!isLoading && servers.length > 0) {
      const server = servers.find((s) => s.id === serverId);
      if (server) {
        setCurrentServer(server);
        // Ensure channels are fetched for this server
        if (!currentServer || currentServer.id !== serverId) {
          fetchChannels(serverId);
        }
      } else {
        router.push("/channels/me");
      }
    }
  }, [serverId, servers, isLoading, setCurrentServer, router, fetchChannels, currentServer]);

  // Set current channel when channels load
  useEffect(() => {
    if (channels.length > 0 && channelId) {
      const channel = channels.find((c) => c.id === channelId);
      if (channel) {
        setCurrentChannel(channel);
      }
    }
  }, [channelId, channels, setCurrentChannel]);

  // Voice channel experience
  if (currentChannel?.type === "voice") {
    return (
      <>
        <VoiceChannelView channelId={currentChannel.id} channelName={currentChannel.name} />
        {showMembers && !isMobile && <MemberSidebar />}
      </>
    );
  }

  return (
    <>
      <ChatArea onToggleMembers={() => setShowMembers(!showMembers)} showMembers={showMembers} />
      {showMembers && !isMobile && <MemberSidebar />}
    </>
  );
}
