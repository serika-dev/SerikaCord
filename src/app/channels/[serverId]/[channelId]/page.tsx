"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useServer } from "@/contexts/ServerContext";
import { ChatArea } from "@/components/chat/ChatArea";
import { MemberSidebar } from "@/components/chat/MemberSidebar";

export default function ChannelPage() {
  const params = useParams();
  const router = useRouter();
  const { servers, setCurrentServer, channels, setCurrentChannel, isLoading } = useServer();
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

  useEffect(() => {
    if (channels.length > 0 && channelId) {
      const channel = channels.find((c) => c.id === channelId);
      if (channel) {
        setCurrentChannel(channel);
      }
    }
  }, [channelId, channels, setCurrentChannel]);

  return (
    <>
      <ChatArea onToggleMembers={() => setShowMembers(!showMembers)} showMembers={showMembers} />
      {showMembers && !isMobile && <MemberSidebar />}
    </>
  );
}
