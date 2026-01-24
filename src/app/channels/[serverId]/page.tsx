"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useServer } from "@/contexts/ServerContext";
import { ChatArea } from "@/components/chat/ChatArea";
import { MemberSidebar } from "@/components/chat/MemberSidebar";
import { Loader2, Hash } from "lucide-react";

export default function ServerPage() {
  const params = useParams();
  const router = useRouter();
  const { servers, setCurrentServer, channels, setCurrentChannel, isLoading, fetchChannels, currentServer } = useServer();
  const [showMembers, setShowMembers] = useState(true);
  const [isRedirecting, setIsRedirecting] = useState(false);

  const serverId = params.serverId as string;

  // Set current server when servers are loaded
  useEffect(() => {
    if (!isLoading && servers.length > 0) {
      const server = servers.find((s) => s.id === serverId);
      if (server) {
        setCurrentServer(server);
      } else {
        router.push("/channels/@me");
      }
    }
  }, [serverId, servers, isLoading, setCurrentServer, router]);

  // Auto-select first channel when channels load
  useEffect(() => {
    if (currentServer && currentServer.id === serverId && channels.length > 0 && !params.channelId && !isRedirecting) {
      const firstTextChannel = channels.find((c) => c.type === "text");
      if (firstTextChannel && firstTextChannel.id) {
        setIsRedirecting(true);
        setCurrentChannel(firstTextChannel);
        router.push(`/channels/${serverId}/${firstTextChannel.id}`);
      }
    }
  }, [channels, params.channelId, serverId, router, setCurrentChannel, currentServer, isRedirecting]);

  // Show loading state while waiting for redirect
  if (isRedirecting || (currentServer && channels.length === 0)) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#0a0a0a] text-[#666666]">
        <Loader2 className="w-8 h-8 animate-spin text-[#8B5CF6] mb-4" />
        <p>Loading channels...</p>
      </div>
    );
  }

  return (
    <>
      <ChatArea onToggleMembers={() => setShowMembers(!showMembers)} showMembers={showMembers} />
      {showMembers && <MemberSidebar />}
    </>
  );
}
