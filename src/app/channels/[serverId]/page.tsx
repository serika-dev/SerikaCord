"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useServer } from "@/contexts/ServerContext";
import { ChatArea } from "@/components/chat/ChatArea";
import { MemberSidebar } from "@/components/chat/MemberSidebar";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Loader2 } from "lucide-react";
import { useGT } from "gt-next";

export default function ServerPage() {
  const params = useParams();
  const router = useRouter();
  const gt = useGT();
  const { servers, setCurrentServer, channels, setCurrentChannel, isLoading, currentServer } = useServer();
  const [showMembers, setShowMembers] = useState(true);
  const isMobile = useIsMobile();

  const serverId = params.serverId as string;
  const channelId = params.channelId as string;

  // Set current server when servers are loaded
  useEffect(() => {
    if (!isLoading && servers.length > 0) {
      const server = servers.find((s) => s.id === serverId);
      if (server) {
        setCurrentServer(server);
      } else {
        router.push("/channels/me");
      }
    }
  }, [serverId, servers, isLoading, setCurrentServer, router]);

  // Auto-select channel when channels load
  useEffect(() => {
    if (currentServer && currentServer.id === serverId && channels.length > 0 && !channelId) {
      // Try to get last visited channel from localStorage
      const lastVisitedChannelId = localStorage.getItem(`sc:last_channel:${serverId}`);
      const lastChannel = channels.find((c) => c.id === lastVisitedChannelId && (c.type === "text" || c.type === "announcement"));
      
      if (lastChannel && lastChannel.id) {
        setCurrentChannel(lastChannel);
        router.push(`/channels/${serverId}/${lastChannel.id}`);
      } else {
        // Fallback to first text channel
        const firstTextChannel = channels.find((c) => c.type === "text");
        if (firstTextChannel && firstTextChannel.id) {
          setCurrentChannel(firstTextChannel);
          router.push(`/channels/${serverId}/${firstTextChannel.id}`);
        }
      }
    }
  }, [channels, channelId, serverId, router, setCurrentChannel, currentServer]);

  // (Last-visited channel is persisted from the [channelId] page, where the
  // channelId param is actually populated.)

  // Show loading state while waiting for redirect
  if (currentServer && channels.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[var(--bg-app)] text-[var(--text-secondary)]">
        <Loader2 className="w-8 h-8 animate-spin text-[#8B5CF6] mb-4" />
        <p>{gt("Loading channels...")}</p>
      </div>
    );
  }

  return (
    <>
      <ChatArea onToggleMembers={() => setShowMembers(!showMembers)} showMembers={showMembers} />
      {showMembers && !isMobile && <MemberSidebar />}
    </>
  );
}
