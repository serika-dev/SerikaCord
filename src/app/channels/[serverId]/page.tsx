"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useServer } from "@/contexts/ServerContext";
import { ChatArea } from "@/components/chat/ChatArea";
import { MemberSidebar } from "@/components/chat/MemberSidebar";

export default function ServerPage() {
  const params = useParams();
  const router = useRouter();
  const { servers, setCurrentServer, channels, setCurrentChannel, isLoading } = useServer();
  const [showMembers, setShowMembers] = useState(true);

  const serverId = params.serverId as string;

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
    if (channels.length > 0 && !params.channelId) {
      const firstTextChannel = channels.find((c) => c.type === "text");
      if (firstTextChannel) {
        setCurrentChannel(firstTextChannel);
        router.push(`/channels/${serverId}/${firstTextChannel.id}`);
      }
    }
  }, [channels, params.channelId, serverId, router, setCurrentChannel]);

  return (
    <>
      <ChatArea onToggleMembers={() => setShowMembers(!showMembers)} showMembers={showMembers} />
      {showMembers && <MemberSidebar />}
    </>
  );
}
