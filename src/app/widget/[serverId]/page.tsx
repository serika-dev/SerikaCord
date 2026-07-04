"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Users, MessageCircle, Loader2 } from "lucide-react";
import { ServerBadge } from "@/components/ui/badges";

interface ServerWidget {
  id: string;
  name: string;
  icon?: string;
  memberCount: number;
  onlineCount: number;
  isPartnered?: boolean;
  inviteCode?: string;
  channels: Array<{
    id: string;
    name: string;
    type: string;
  }>;
  members: Array<{
    id: string;
    username: string;
    displayName?: string;
    avatar?: string;
    status: "online" | "idle" | "dnd" | "offline";
  }>;
  recentMessages: Array<{
    id: string;
    content: string;
    author: {
      id: string;
      username: string;
      displayName?: string;
      avatar?: string;
    };
    createdAt: string;
  }>;
}

export default function WidgetPage() {
  const params = useParams();
  const serverId = params.serverId as string;
  const [widget, setWidget] = useState<ServerWidget | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchWidget = async () => {
      try {
        const response = await fetch(`/api/servers/${serverId}/widget`);
        if (response.ok) {
          const data = await response.json();
          setWidget(data);
        } else if (response.status === 403) {
          setError("Widget is disabled for this server");
        } else if (response.status === 404) {
          setError("Server not found");
        } else {
          setError("Failed to load widget");
        }
      } catch (err) {
        setError("Failed to load widget");
      } finally {
        setIsLoading(false);
      }
    };

    fetchWidget();
  }, [serverId]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#111111] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[var(--accent-color)] animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#111111] flex items-center justify-center p-4">
        <div className="text-center">
          <MessageCircle className="w-12 h-12 text-[#666666] mx-auto mb-4" />
          <p className="text-[#888888]">{error}</p>
        </div>
      </div>
    );
  }

  if (!widget) return null;

  const onlineMembers = widget.members.filter(m => m.status !== "offline");

  return (
    <div className="min-h-screen bg-[#111111] p-4">
      <div className="max-w-sm mx-auto bg-[#0a0a0a] rounded-lg border border-[#222222] overflow-hidden">
        {/* Header */}
        <div className="p-4 bg-gradient-to-r from-[var(--accent-color)] to-[var(--accent-color)]/80">
          <div className="flex items-center gap-3">
            <Avatar className="w-12 h-12 border-2 border-white/20">
              <AvatarImage src={widget.icon} />
              <AvatarFallback className="bg-white/20 text-white text-lg">
                {widget.name.charAt(0)}
              </AvatarFallback>
            </Avatar>
            <div>
              <div className="flex items-center gap-2">
                {widget.isPartnered && <ServerBadge type="partnered" size="sm" />}
                <h1 className="font-bold text-white text-lg">{widget.name}</h1>
              </div>
              <div className="flex items-center gap-3 text-white/80 text-sm">
                <span className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-[#23A559]" />
                  {widget.onlineCount} Online
                </span>
                <span className="flex items-center gap-1">
                  <Users className="w-3 h-3" />
                  {widget.memberCount} Members
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Online Members */}
        {onlineMembers.length > 0 && (
          <div className="p-4 border-b border-[#222222]">
            <h2 className="text-xs font-semibold uppercase text-[#666666] mb-3">
              Online — {onlineMembers.length}
            </h2>
            <div className="space-y-2">
              {onlineMembers.slice(0, 10).map((member) => (
                <div key={member.id} className="flex items-center gap-2">
                  <div className="relative">
                    <Avatar className="w-8 h-8">
                      <AvatarImage src={member.avatar} />
                      <AvatarFallback className="bg-[var(--accent-color)] text-white text-xs">
                        {(member.displayName || member.username).charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <div
                      className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#0a0a0a]"
                      style={{
                        backgroundColor:
                          member.status === "online"
                            ? "#8B5CF6"
                            : member.status === "idle"
                            ? "#A78BFA"
                            : member.status === "dnd"
                            ? "#EF4444"
                            : "#555555",
                      }}
                    />
                  </div>
                  <span className="text-sm text-[#dcddde] truncate">
                    {member.displayName || member.username}
                  </span>
                </div>
              ))}
              {onlineMembers.length > 10 && (
                <p className="text-xs text-[#666666]">
                  +{onlineMembers.length - 10} more online
                </p>
              )}
            </div>
          </div>
        )}

        {/* Recent Messages */}
        {widget.recentMessages && widget.recentMessages.length > 0 && (
          <div className="p-4 border-b border-[#222222]">
            <h2 className="text-xs font-semibold uppercase text-[#666666] mb-3">
              Recent Messages
            </h2>
            <div className="space-y-3">
              {widget.recentMessages.map((msg) => (
                <div key={msg.id} className="flex gap-2">
                  <Avatar className="w-7 h-7 shrink-0">
                    <AvatarImage src={msg.author.avatar} />
                    <AvatarFallback className="bg-[var(--accent-color)] text-white text-[10px]">
                      {(msg.author.displayName || msg.author.username).charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium text-[#dcddde] truncate">
                        {msg.author.displayName || msg.author.username}
                      </span>
                      <span className="text-[10px] text-[#666666]">
                        {new Date(msg.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-sm text-[#b5bac1] line-clamp-2">{msg.content}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Join Button */}
        {widget.inviteCode && (
          <div className="p-4">
            <a
              href={`https://serika.cc/${widget.inviteCode}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full py-2.5 px-4 bg-[var(--accent-color)] hover:brightness-110 text-white font-medium text-center rounded-md transition-all"
            >
              Join Server
            </a>
          </div>
        )}

        {/* Footer */}
        <div className="px-4 py-3 bg-[#080808] border-t border-[#222222]">
          <div className="flex items-center justify-center gap-2 text-xs text-[#666666]">
            <img src="/logo.svg" alt="SerikaCord" className="w-4 h-4 opacity-50" />
            <span>Powered by SerikaCord</span>
          </div>
        </div>
      </div>
    </div>
  );
}
