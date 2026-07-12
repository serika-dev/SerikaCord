"use client";

import { useEffect, useState, type ElementType } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";
import { Share2, Copy, Check,  User, Hash, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGT } from "gt-next";
import { Loader } from "@/components/ui/Loader";

interface ShareInviteButtonProps {
  inviteCode: string;
  serverId: string;
  serverName: string;
  className?: string;
}

interface ServerOption {
  id: string;
  name: string;
  icon?: string;
}

interface ChannelOption {
  id: string;
  name: string;
  type: string;
}

interface FriendOption {
  id: string;
  username: string;
  displayName?: string;
  avatar?: string;
}

export function ShareInviteButton({
  inviteCode,
  serverId,
  serverName,
  className,
}: ShareInviteButtonProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"link" | "channel" | "friend">("link");
  const [copied, setCopied] = useState(false);
  const [servers, setServers] = useState<ServerOption[]>([]);
  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [friends, setFriends] = useState<FriendOption[]>([]);
  const [selectedServer, setSelectedServer] = useState<ServerOption | null>(null);
  const [loadingServers, setLoadingServers] = useState(false);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [loadingFriends, setLoadingFriends] = useState(false);
  const [sending, setSending] = useState(false);
  const [recentMessages, setRecentMessages] = useState<Array<{ authorName: string; content: string }>>([]);
  const gt = useGT();

  const inviteUrl = `https://serika.cc/${inviteCode}`;

  useEffect(() => {
    if (!open) return;
    const fetchServers = async () => {
      setLoadingServers(true);
      try {
        const res = await fetch("/api/servers");
        if (!res.ok) throw new Error("Failed to fetch servers");
        const data = await res.json();
        setServers(data.servers || []);
      } catch {
        // best-effort: user may not be authenticated
      } finally {
        setLoadingServers(false);
      }
    };
    const fetchFriends = async () => {
      setLoadingFriends(true);
      try {
        const res = await fetch("/api/friends");
        if (!res.ok) throw new Error("Failed to fetch friends");
        const data = await res.json();
        setFriends(data.friends || []);
      } catch {
        // best-effort
      } finally {
        setLoadingFriends(false);
      }
    };
    const fetchWidget = async () => {
      try {
        const res = await fetch(`/api/servers/${serverId}/widget`);
        if (!res.ok) return;
        const data = await res.json();
        const messages = (data.recentMessages || []).slice(0, 5).map((m: { content: string; author: { displayName?: string; username: string } }) => ({
          authorName: m.author.displayName || m.author.username,
          content: m.content.slice(0, 120),
        }));
        setRecentMessages(messages);
      } catch {
        // ignore
      }
    };
    fetchServers();
    fetchFriends();
    fetchWidget();
    setSelectedServer(null);
    setChannels([]);
  }, [open, serverId]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(gt("Failed to copy link"));
    }
  };

  const loadChannels = async (server: ServerOption) => {
    setSelectedServer(server);
    setLoadingChannels(true);
    try {
      const res = await fetch(`/api/servers/${server.id}/channels`);
      if (!res.ok) throw new Error("Failed to fetch channels");
      const data = await res.json();
      const textChannels = (data.channels || []).filter((c: ChannelOption) => c.type === "text");
      setChannels(textChannels);
    } catch (err) {
      toast.error(gt("Failed to load channels"));
    } finally {
      setLoadingChannels(false);
    }
  };

  const buildMessage = () => {
    let text = `${gt("Check out {name}", { name: serverName })}: ${inviteUrl}`;
    if (recentMessages.length > 0) {
      text += `\n\n${gt("Recent messages:")}`;
      recentMessages.forEach((m) => {
        text += `\n**${m.authorName}**: ${m.content}`;
      });
    }
    return text;
  };

  const sendToChannel = async (channelId: string) => {
    setSending(true);
    try {
      const res = await fetch(`/api/channels/${channelId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: buildMessage() }),
      });
      if (!res.ok) throw new Error("Failed to send");
      toast.success(gt("Invite shared to channel"));
      setOpen(false);
    } catch {
      toast.error(gt("Failed to share invite"));
    } finally {
      setSending(false);
    }
  };

  const sendToFriend = async (friendId: string) => {
    setSending(true);
    try {
      const res = await fetch(`/api/dms/${friendId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: buildMessage() }),
      });
      if (!res.ok) throw new Error("Failed to send");
      toast.success(gt("Invite shared"));
      setOpen(false);
    } catch {
      toast.error(gt("Failed to share invite"));
    } finally {
      setSending(false);
    }
  };

  const TabButton = ({
    id,
    label,
    icon: Icon,
  }: {
    id: "link" | "channel" | "friend";
    label: string;
    icon: ElementType;
  }) => (
    <button
      onClick={() => {
        setTab(id);
        setSelectedServer(null);
      }}
      className={cn(
        "flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium rounded-lg transition-colors",
        tab === id
          ? "bg-[var(--accent-color)] text-white"
          : "text-[#b5bac1] hover:bg-[#1a1a1a]"
      )}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          className={cn(
            "flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[#1a1a1a] hover:bg-[#252525] text-white transition-colors text-sm font-medium",
            className
          )}
        >
          <Share2 className="w-4 h-4" />
          {gt("Share")}
        </button>
      </DialogTrigger>
      <DialogContent className="bg-[#111111] border border-[#222222] text-[#d5d9e8] max-w-sm p-0 rounded-xl overflow-hidden">
        <DialogHeader className="p-4 pb-0">
          <DialogTitle className="text-lg font-bold text-white flex items-center gap-2">
            <Share2 className="w-5 h-5 text-[var(--accent-color)]" />
            {gt("Share Invite")}
          </DialogTitle>
        </DialogHeader>

        <div className="p-4">
          <div className="flex gap-2 mb-4">
            <TabButton id="link" label={gt("Link")} icon={Copy} />
            <TabButton id="channel" label={gt("Channel")} icon={Hash} />
            <TabButton id="friend" label={gt("Friend")} icon={User} />
          </div>

          {tab === "link" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 p-3 bg-[#0a0a0a] rounded-lg border border-[#222222]">
                <input
                  type="text"
                  readOnly
                  value={inviteUrl}
                  className="flex-1 bg-transparent text-sm text-[#b5bac1] outline-none"
                />
                <button
                  onClick={handleCopy}
                  className="p-2 rounded-md bg-[var(--accent-color)] hover:brightness-110 text-white transition-colors"
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
              {navigator.share && (
                <button
                  onClick={() => {
                    void navigator.share({ title: `Join ${serverName} on SerikaCord`, url: inviteUrl });
                  }}
                  className="w-full py-2 rounded-lg bg-[#1a1a1a] hover:bg-[#252525] text-sm text-white transition-colors"
                >
                  {gt("Open device share sheet")}
                </button>
              )}
            </div>
          )}

          {tab === "channel" && (
            <div className="space-y-2">
              {selectedServer ? (
                <>
                  <button
                    onClick={() => setSelectedServer(null)}
                    className="text-xs text-[#b5bac1] hover:text-white flex items-center gap-1 mb-2"
                  >
                    <ChevronLeft className="w-3 h-3" /> {gt("Back to servers")}
                  </button>
                  {loadingChannels ? (
                    <div className="flex justify-center py-4">
                      <Loader size={20} />
                    </div>
                  ) : channels.length === 0 ? (
                    <p className="text-sm text-[#6b7387]">{gt("No text channels available.")}</p>
                  ) : (
                    channels.map((channel) => (
                      <button
                        key={channel.id}
                        onClick={() => sendToChannel(channel.id)}
                        disabled={sending}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg bg-[#0a0a0a] hover:bg-[#1a1a1a] text-left transition-colors"
                      >
                        <Hash className="w-4 h-4 text-[#6b7387]" />
                        <span className="text-sm text-[#dcddde] truncate">{channel.name}</span>
                        {sending && <Loader size={undefined} className="ml-auto" />}
                      </button>
                    ))
                  )}
                </>
              ) : (
                <>
                  {loadingServers ? (
                    <div className="flex justify-center py-4">
                      <Loader size={20} />
                    </div>
                  ) : servers.length === 0 ? (
                    <p className="text-sm text-[#6b7387]">{gt("You need to be in a server to share to a channel.")}</p>
                  ) : (
                    servers.map((server) => (
                      <button
                        key={server.id}
                        onClick={() => loadChannels(server)}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg bg-[#0a0a0a] hover:bg-[#1a1a1a] text-left transition-colors"
                      >
                        <Avatar className="w-7 h-7">
                          <AvatarImage src={server.icon} />
                          <AvatarFallback className="bg-[var(--accent-color)] text-white text-xs">
                            {server.name.charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-sm text-[#dcddde] truncate">{server.name}</span>
                      </button>
                    ))
                  )}
                </>
              )}
            </div>
          )}

          {tab === "friend" && (
            <div className="space-y-2">
              {loadingFriends ? (
                <div className="flex justify-center py-4">
                  <Loader size={20} />
                </div>
              ) : friends.length === 0 ? (
                <p className="text-sm text-[#6b7387]">{gt("No friends available to share with.")}</p>
              ) : (
                friends.map((friend) => (
                  <button
                    key={friend.id}
                    onClick={() => sendToFriend(friend.id)}
                    disabled={sending}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg bg-[#0a0a0a] hover:bg-[#1a1a1a] text-left transition-colors"
                  >
                    <Avatar className="w-7 h-7">
                      <AvatarImage src={friend.avatar} />
                      <AvatarFallback className="bg-[var(--accent-color)] text-white text-xs">
                        {(friend.displayName || friend.username).charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm text-[#dcddde] truncate">
                      {friend.displayName || friend.username}
                    </span>
                    {sending && <Loader size={undefined} className="ml-auto" />}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
