"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useServer } from "@/contexts/ServerContext";
import { ChatArea } from "@/components/chat/ChatArea";
import { MemberSidebar } from "@/components/chat/MemberSidebar";
import { Volume2, Loader2 } from "lucide-react";

function VoiceChannelComingSoon({ channelName }: { channelName: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-[#0a0a0a] text-center p-8">
      <div className="w-24 h-24 rounded-full bg-[#8B5CF6]/10 flex items-center justify-center mb-6">
        <Volume2 className="w-12 h-12 text-[#8B5CF6]" />
      </div>
      <h2 className="text-2xl font-bold text-white mb-2">Voice Channel</h2>
      <h3 className="text-xl text-[#888888] mb-4">#{channelName}</h3>
      <div className="max-w-md">
        <p className="text-[#888888] mb-6">
          Voice channels are coming soon! We're working hard to bring you high-quality
          voice and video communication.
        </p>
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#111111] border border-[#222222]">
          <div className="w-2 h-2 rounded-full bg-[#8B5CF6] animate-pulse" />
          <span className="text-sm text-[#888888]">In Development</span>
        </div>
      </div>
    </div>
  );
}

export default function ChannelPage() {
  const params = useParams();
  const router = useRouter();
  const { servers, setCurrentServer, channels, setCurrentChannel, isLoading, fetchChannels, currentServer, currentChannel } = useServer();
  const [showMembers, setShowMembers] = useState(false);
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

  // Show members by default on desktop only
  useEffect(() => {
    if (!isMobile) {
      setShowMembers(true);
    }
  }, [isMobile]);

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
        router.push("/channels/@me");
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

  // Show voice channel coming soon screen
  if (currentChannel?.type === "voice") {
    return (
      <>
        <VoiceChannelComingSoon channelName={currentChannel.name} />
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
