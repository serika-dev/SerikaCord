"use client";

import { useState, useEffect, useCallback } from "react";
import { useServer } from "@/contexts/ServerContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MemberProfilePopup } from "@/components/user/MemberProfilePopup";
import { cn } from "@/lib/utils";
import { Skeleton, MemberSidebarSkeleton } from "@/components/ui/skeleton";

interface Member {
  id: string;
  username: string;
  displayName: string;
  avatar?: string;
  status: "online" | "idle" | "dnd" | "offline";
  roles?: Array<{
    id: string;
    name: string;
    color?: string;
  }>;
}

export function MemberSidebar() {
  const { currentServer } = useServer();
  const [members, setMembers] = useState<Member[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchMembers = useCallback(async () => {
    if (!currentServer) return;

    setIsLoading(true);
    try {
      const response = await fetch(`/api/servers/${currentServer.id}/members`);
      if (response.ok) {
        const data = await response.json();
        // Transform the API response - members have userId populated
        const rawMembers = Array.isArray(data) ? data : data?.members || [];
        const transformedMembers = rawMembers.map((m: { _id?: string; userId?: { _id?: string; username?: string; displayName?: string; avatar?: string; status?: string }; roles?: Array<{ _id?: string; name?: string; color?: string }> }) => ({
          id: m.userId?._id || m._id || '',
          username: m.userId?.username || 'Unknown',
          displayName: m.userId?.displayName || m.userId?.username || 'Unknown',
          avatar: m.userId?.avatar,
          status: m.userId?.status || 'offline',
          roles: m.roles?.map((r: { _id?: string; name?: string; color?: string }) => ({
            id: r._id || '',
            name: r.name || '',
            color: r.color,
          })) || [],
        }));
        setMembers(transformedMembers);
      }
    } catch (error) {
      console.error("Failed to fetch members:", error);
      setMembers([]);
    } finally {
      setIsLoading(false);
    }
  }, [currentServer]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const onlineMembers = members.filter((m) => m.status !== "offline");
  const offlineMembers = members.filter((m) => m.status === "offline");

  if (!currentServer) return null;

  if (isLoading) {
    return <MemberSidebarSkeleton />;
  }

  return (
    <div className="w-60 h-full bg-[#0a0a0a] border-l border-[#1a1a1a] flex-shrink-0 animate-slide-in-right">
      <ScrollArea className="h-full scrollbar-thin">
        <div className="py-4">
          <>
            {/* Online Members */}
            {onlineMembers.length > 0 && (
              <div className="mb-4">
                <div className="px-4 mb-2">
                  <span className="text-xs font-semibold uppercase text-[#666666]">
                    Online — {onlineMembers.length}
                  </span>
                </div>
                <div className="stagger-children">
                  {onlineMembers.map((member, index) => (
                    <MemberItem key={member.id || `online-${index}`} member={member} serverId={currentServer.id} />
                  ))}
                </div>
              </div>
            )}

            {/* Offline Members */}
            {offlineMembers.length > 0 && (
              <div>
                <div className="px-4 mb-2">
                  <span className="text-xs font-semibold uppercase text-[#666666]">
                    Offline — {offlineMembers.length}
                  </span>
                </div>
                <div className="stagger-children">
                  {offlineMembers.map((member, index) => (
                    <MemberItem key={member.id || `offline-${index}`} member={member} serverId={currentServer.id} />
                  ))}
                </div>
              </div>
            )}

            {members.length === 0 && (
              <div className="text-center text-[#666666] text-sm py-8 animate-fade-in">
                No members found
              </div>
            )}
          </>
        </div>
      </ScrollArea>
    </div>
  );
}

interface MemberItemProps {
  member: Member;
  serverId?: string;
}

function MemberItem({ member, serverId }: MemberItemProps) {
  const isOffline = member.status === "offline";

  return (
    <MemberProfilePopup 
      member={member} 
      serverId={serverId}
      side="left"
      align="start"
    >
      <button
        className={cn(
          "w-full px-2 py-1.5 mx-2 rounded flex items-center gap-3 hover:bg-[#111111] transition-all duration-150 group",
          isOffline && "opacity-50"
        )}
        style={{ width: "calc(100% - 16px)" }}
      >
        <div className="relative flex-shrink-0">
          <Avatar className="w-8 h-8">
            <AvatarImage src={member.avatar} alt={member.displayName || member.username} loading="lazy" />
            <AvatarFallback className="bg-[#8B5CF6] text-white text-xs">
              {(member.displayName || member.username || "?").charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div
            className={cn(
              "absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-[2.5px] border-[#0a0a0a] transition-colors duration-200",
              member.status === "online" && "bg-[#8B5CF6]",
              member.status === "idle" && "bg-[#A78BFA]",
              member.status === "dnd" && "bg-red-500",
              member.status === "offline" && "bg-[#555555]"
            )}
          />
        </div>
        <div className="flex-1 min-w-0 text-left">
          <div
            className={cn(
              "text-sm font-medium truncate",
              member.roles?.[0]?.color
                ? `text-[${member.roles[0].color}]`
                : "text-white"
            )}
            style={member.roles?.[0]?.color ? { color: member.roles[0].color } : undefined}
          >
            {member.displayName || member.username || "Unknown"}
          </div>
        </div>
      </button>
    </MemberProfilePopup>
  );
}
