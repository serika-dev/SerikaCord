"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { 
  Users, 
  Sparkles, 
  Search,
  Inbox,
  MessageCircle,
  Video,
  Phone,
  Check,
  X,
  MoreVertical,
  UserX,
  Clock,
  Crown,
  Shield,
  Loader2,
} from "lucide-react";
import { useAuth, type BadgeId } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";

type Tab = "online" | "all" | "pending" | "blocked" | "add";

interface Friend {
  id: string;
  username: string;
  displayName: string;
  avatar?: string;
  status: "online" | "idle" | "dnd" | "offline";
  customStatus?: string;
  isPremium?: boolean;
  badges?: BadgeId[];
  createdAt?: string;
}

interface FriendsData {
  friends: Friend[];
  pending: {
    incoming: Friend[];
    outgoing: Friend[];
  };
  blocked: Friend[];
}

const statusColors = {
  online: "#8B5CF6",
  idle: "#A78BFA", 
  dnd: "#EF4444",
  offline: "#555555",
};

const statusLabels = {
  online: "Online",
  idle: "Idle",
  dnd: "Do Not Disturb",
  offline: "Offline",
};

export default function DirectMessagesPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("online");
  const [searchQuery, setSearchQuery] = useState("");
  const [addFriendUsername, setAddFriendUsername] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [friendsData, setFriendsData] = useState<FriendsData>({
    friends: [],
    pending: { incoming: [], outgoing: [] },
    blocked: [],
  });
  const [addFriendStatus, setAddFriendStatus] = useState<{
    type: "success" | "error" | null;
    message: string;
  }>({ type: null, message: "" });
  const [isAddingFriend, setIsAddingFriend] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);

  // Fetch friends data
  const fetchFriends = useCallback(async () => {
    try {
      const response = await fetch("/api/friends");
      if (response.ok) {
        const data = await response.json();
        setFriendsData(data);
      }
    } catch (error) {
      console.error("Failed to fetch friends:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFriends();
  }, [fetchFriends]);

  useEffect(() => {
    const connectSSE = () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      const source = new EventSource("/api/friends/stream");
      eventSourceRef.current = source;

      source.onopen = () => {
        reconnectAttemptsRef.current = 0;
      };

      source.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "connected" || data.type === "ping") return;
          if (data.type === "friends:update" || data.type === "presence:update") {
            fetchFriends();
          }
        } catch {
          // ignore malformed messages
        }
      };

      source.onerror = () => {
        source.close();
        const backoffMs = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
        reconnectAttemptsRef.current += 1;
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(connectSSE, backoffMs);
      };
    };

    connectSSE();

    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close();
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    };
  }, [fetchFriends]);

  // Add friend handler
  const handleAddFriend = async () => {
    if (!addFriendUsername.trim() || isAddingFriend) return;
    
    setIsAddingFriend(true);
    setAddFriendStatus({ type: null, message: "" });

    try {
      const response = await fetch("/api/friends/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: addFriendUsername.trim() }),
      });

      const data = await response.json();

      if (response.ok) {
        setAddFriendStatus({ type: "success", message: data.message });
        setAddFriendUsername("");
        fetchFriends();
      } else {
        setAddFriendStatus({ type: "error", message: data.error });
      }
    } catch {
      setAddFriendStatus({ type: "error", message: "Failed to send friend request" });
    } finally {
      setIsAddingFriend(false);
    }
  };

  // Accept friend request
  const handleAcceptRequest = async (userId: string) => {
    setActionLoading(userId);
    try {
      const response = await fetch(`/api/friends/accept/${userId}`, {
        method: "POST",
      });
      if (response.ok) {
        fetchFriends();
      }
    } catch (error) {
      console.error("Failed to accept request:", error);
    } finally {
      setActionLoading(null);
    }
  };

  // Decline friend request
  const handleDeclineRequest = async (userId: string) => {
    setActionLoading(userId);
    try {
      const response = await fetch(`/api/friends/decline/${userId}`, {
        method: "DELETE",
      });
      if (response.ok) {
        fetchFriends();
      }
    } catch (error) {
      console.error("Failed to decline request:", error);
    } finally {
      setActionLoading(null);
    }
  };

  // Cancel outgoing request
  const handleCancelRequest = async (userId: string) => {
    setActionLoading(userId);
    try {
      const response = await fetch(`/api/friends/cancel/${userId}`, {
        method: "DELETE",
      });
      if (response.ok) {
        fetchFriends();
      }
    } catch (error) {
      console.error("Failed to cancel request:", error);
    } finally {
      setActionLoading(null);
    }
  };

  // Remove friend
  const handleRemoveFriend = async (userId: string) => {
    setActionLoading(userId);
    try {
      const response = await fetch(`/api/friends/${userId}`, {
        method: "DELETE",
      });
      if (response.ok) {
        fetchFriends();
      }
    } catch (error) {
      console.error("Failed to remove friend:", error);
    } finally {
      setActionLoading(null);
    }
  };

  // Block user
  const handleBlockUser = async (userId: string) => {
    setActionLoading(userId);
    try {
      const response = await fetch(`/api/friends/block/${userId}`, {
        method: "POST",
      });
      if (response.ok) {
        fetchFriends();
      }
    } catch (error) {
      console.error("Failed to block user:", error);
    } finally {
      setActionLoading(null);
    }
  };

  // Unblock user
  const handleUnblockUser = async (userId: string) => {
    setActionLoading(userId);
    try {
      const response = await fetch(`/api/friends/unblock/${userId}`, {
        method: "DELETE",
      });
      if (response.ok) {
        fetchFriends();
      }
    } catch (error) {
      console.error("Failed to unblock user:", error);
    } finally {
      setActionLoading(null);
    }
  };

  // Filter friends
  const onlineFriends = friendsData.friends.filter(f => f.status !== "offline");
  const filteredFriends = friendsData.friends.filter(friend => {
    if (activeTab === "online" && friend.status === "offline") return false;
    if (searchQuery && !friend.displayName?.toLowerCase().includes(searchQuery.toLowerCase()) && 
        !friend.username.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const tabs = [
    { id: "online" as Tab, label: "Online", count: onlineFriends.length },
    { id: "all" as Tab, label: "All", count: friendsData.friends.length },
    { id: "pending" as Tab, label: "Pending", count: friendsData.pending.incoming.length + friendsData.pending.outgoing.length },
    { id: "blocked" as Tab, label: "Blocked", count: friendsData.blocked.length },
  ];

  // Start DM with friend
  const startDM = async (friendId: string) => {
    // Navigate to the DM conversation page
    router.push(`/dm/${friendId}`);
  };

  return (
    <div className="flex-1 flex flex-col bg-[var(--bg-app)]">
      {/* Header */}
      <div className="h-12 min-h-12 px-4 flex items-center gap-4 border-b border-[var(--border-subtle)] bg-[var(--bg-app)]">
        <div className="flex items-center gap-2 text-[var(--text-primary)]">
          <Users className="w-6 h-6 text-[#555555]" />
          <span className="font-semibold">Friends</span>
        </div>

        <div className="w-px h-6 bg-[var(--border-subtle)]" />

        {/* Tabs */}
        <div className="flex items-center gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                activeTab === tab.id
                  ? "bg-[var(--bg-active)] text-[var(--app-accent)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              )}
            >
              {tab.label}
              {tab.count > 0 && (
                <span className="ml-1.5 text-xs bg-[var(--border-subtle)] px-1.5 py-0.5 rounded-full text-[var(--text-secondary)]">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        <button
          onClick={() => setActiveTab("add")}
          className={cn(
            "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
            activeTab === "add"
              ? "bg-transparent text-[#8B5CF6]"
              : "bg-[#8B5CF6] text-white hover:bg-[#7C3AED]"
          )}
        >
          Add Friend
        </button>

        {/* Right side actions */}
        <div className="ml-auto flex items-center gap-2">
          <button className="p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors rounded-md hover:bg-[var(--bg-hover)]">
            <Inbox className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Main content area */}
        <div className="flex-1 flex flex-col min-w-0">
          {activeTab === "add" ? (
            <div className="p-6">
              <h2 className="text-lg font-semibold text-[var(--text-primary)] uppercase tracking-wide mb-2">
                Add Friend
              </h2>
              <p className="text-[var(--text-secondary)] text-sm mb-4">
                You can add friends with their SerikaCord username.
              </p>
              
              <div className="relative max-w-xl">
                <Input
                  value={addFriendUsername}
                  onChange={(e) => {
                    setAddFriendUsername(e.target.value);
                    setAddFriendStatus({ type: null, message: "" });
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handleAddFriend()}
                  placeholder="Enter a username"
                  className={cn(
                    "h-14 bg-[var(--bg-card)] border-2 text-[var(--text-primary)] placeholder:text-[#555555] pr-32 text-base rounded-lg focus-visible:ring-0",
                    addFriendStatus.type === "success" && "border-green-500/50",
                    addFriendStatus.type === "error" && "border-red-500/50",
                    !addFriendStatus.type && "border-[var(--border-subtle)] focus:border-[#8B5CF6]"
                  )}
                />
                <button
                  onClick={handleAddFriend}
                  disabled={!addFriendUsername.trim() || isAddingFriend}
                  className={cn(
                    "absolute right-2 top-1/2 -translate-y-1/2 px-4 py-2 text-sm font-medium rounded-md transition-colors flex items-center gap-2",
                    addFriendUsername.trim() && !isAddingFriend
                      ? "bg-[#8B5CF6] hover:bg-[#7C3AED] text-white"
                      : "bg-[#8B5CF6]/50 text-white/50 cursor-not-allowed"
                  )}
                >
                  {isAddingFriend && <Loader2 className="w-4 h-4 animate-spin" />}
                  Send Friend Request
                </button>
              </div>

              {addFriendStatus.type && (
                <p className={cn(
                  "mt-3 text-sm",
                  addFriendStatus.type === "success" ? "text-green-500" : "text-red-500"
                )}>
                  {addFriendStatus.message}
                </p>
              )}

              {/* Instructions */}
              <div className="mt-8 p-4 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] max-w-xl">
                <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">How to add friends</h3>
                <ul className="text-sm text-[var(--text-secondary)] space-y-2">
                  <li className="flex items-start gap-2">
                    <span className="text-[#8B5CF6]">1.</span>
                    Ask your friend for their username
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#8B5CF6]">2.</span>
                    Type their exact username above
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#8B5CF6]">3.</span>
                    They&apos;ll receive a friend request they can accept
                  </li>
                </ul>
              </div>
            </div>
          ) : activeTab === "pending" ? (
            <div className="flex-1 flex flex-col">
              <ScrollArea className="flex-1">
                <div className="p-4">
                  {/* Incoming requests */}
                  {friendsData.pending.incoming.length > 0 && (
                    <>
                      <p className="text-xs font-semibold uppercase text-[var(--text-muted)] mb-2 px-2">
                        Incoming — {friendsData.pending.incoming.length}
                      </p>
                      <div className="space-y-0.5 mb-6">
                        {friendsData.pending.incoming.map((request) => (
                          <div
                            key={request.id}
                            className="group flex items-center justify-between p-3 rounded-lg hover:bg-[var(--bg-hover)] transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <div className="relative">
                                <Avatar className="w-10 h-10">
                                  <AvatarImage src={request.avatar} />
                                  <AvatarFallback className="bg-[#8B5CF6] text-[var(--text-on-accent)]">
                                    {(request.displayName || request.username).charAt(0).toUpperCase()}
                                  </AvatarFallback>
                                </Avatar>
                              </div>
                              
                              <div>
                                <div className="flex items-center gap-2">
                                  <p className="font-medium text-[var(--text-primary)] text-sm">
                                    {request.displayName || request.username}
                                  </p>
                                  {request.isPremium && (
                                    <Crown className="w-3.5 h-3.5 text-[#8B5CF6]" />
                                  )}
                                </div>
                                <p className="text-xs text-[var(--text-muted)]">
                                  Incoming Friend Request
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleAcceptRequest(request.id)}
                                disabled={actionLoading === request.id}
                                className="p-2 bg-[var(--bg-card)] rounded-full hover:bg-green-500/20 text-[var(--text-secondary)] hover:text-green-500 transition-colors disabled:opacity-50"
                              >
                                {actionLoading === request.id ? (
                                  <Loader2 className="w-5 h-5 animate-spin" />
                                ) : (
                                  <Check className="w-5 h-5" />
                                )}
                              </button>
                              <button
                                onClick={() => handleDeclineRequest(request.id)}
                                disabled={actionLoading === request.id}
                                className="p-2 bg-[var(--bg-card)] rounded-full hover:bg-red-500/20 text-[var(--text-secondary)] hover:text-red-500 transition-colors disabled:opacity-50"
                              >
                                <X className="w-5 h-5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  {/* Outgoing requests */}
                  {friendsData.pending.outgoing.length > 0 && (
                    <>
                      <p className="text-xs font-semibold uppercase text-[var(--text-muted)] mb-2 px-2">
                        Outgoing — {friendsData.pending.outgoing.length}
                      </p>
                      <div className="space-y-0.5">
                        {friendsData.pending.outgoing.map((request) => (
                          <div
                            key={request.id}
                            className="group flex items-center justify-between p-3 rounded-lg hover:bg-[var(--bg-hover)] transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <div className="relative">
                                <Avatar className="w-10 h-10">
                                  <AvatarImage src={request.avatar} />
                                  <AvatarFallback className="bg-[#8B5CF6] text-[var(--text-on-accent)]">
                                    {(request.displayName || request.username).charAt(0).toUpperCase()}
                                  </AvatarFallback>
                                </Avatar>
                              </div>
                              
                              <div>
                                <div className="flex items-center gap-2">
                                  <p className="font-medium text-[var(--text-primary)] text-sm">
                                    {request.displayName || request.username}
                                  </p>
                                  {request.isPremium && (
                                    <Crown className="w-3.5 h-3.5 text-[#8B5CF6]" />
                                  )}
                                </div>
                                <p className="text-xs text-[var(--text-muted)]">
                                  Outgoing Friend Request
                                </p>
                              </div>
                            </div>

                            <button
                              onClick={() => handleCancelRequest(request.id)}
                              disabled={actionLoading === request.id}
                              className="px-3 py-1.5 text-sm bg-[var(--bg-card)] rounded-md hover:bg-red-500/20 text-[var(--text-secondary)] hover:text-red-500 transition-colors disabled:opacity-50"
                            >
                              {actionLoading === request.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                "Cancel"
                              )}
                            </button>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  {friendsData.pending.incoming.length === 0 && friendsData.pending.outgoing.length === 0 && (
                    <EmptyState
                      icon={<Clock className="w-12 h-12 text-[#8B5CF6]" />}
                      title="No pending requests"
                      description="Friend requests you send or receive will show up here"
                    />
                  )}
                </div>
              </ScrollArea>
            </div>
          ) : activeTab === "blocked" ? (
            <div className="flex-1 flex flex-col">
              <ScrollArea className="flex-1">
                <div className="p-4">
                  {friendsData.blocked.length > 0 ? (
                    <>
                      <p className="text-xs font-semibold uppercase text-[var(--text-muted)] mb-2 px-2">
                        Blocked Users — {friendsData.blocked.length}
                      </p>
                      <div className="space-y-0.5">
                        {friendsData.blocked.map((blockedUser) => (
                          <div
                            key={blockedUser.id}
                            className="group flex items-center justify-between p-3 rounded-lg hover:bg-[var(--bg-hover)] transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <Avatar className="w-10 h-10">
                                <AvatarImage src={blockedUser.avatar} />
                                <AvatarFallback className="bg-[var(--bg-sidebar-elevated)] text-[var(--text-primary)]">
                                  {(blockedUser.displayName || blockedUser.username).charAt(0).toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                              
                              <div>
                                <p className="font-medium text-[var(--text-primary)] text-sm">
                                  {blockedUser.displayName || blockedUser.username}
                                </p>
                                <p className="text-xs text-[var(--text-muted)]">Blocked</p>
                              </div>
                            </div>

                            <button
                              onClick={() => handleUnblockUser(blockedUser.id)}
                              disabled={actionLoading === blockedUser.id}
                              className="px-3 py-1.5 text-sm bg-[var(--bg-card)] rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
                            >
                              {actionLoading === blockedUser.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                "Unblock"
                              )}
                            </button>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <EmptyState
                      icon={<Shield className="w-12 h-12 text-[#8B5CF6]" />}
                      title="No blocked users"
                      description="Users you block won't be able to message you or send friend requests"
                    />
                  )}
                </div>
              </ScrollArea>
            </div>
          ) : (
            <div className="flex-1 flex flex-col">
              {/* Search */}
              <div className="p-4 pb-0">
                <div className="relative">
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search"
                    className="h-9 bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-primary)] placeholder:text-[#555555] pl-9 rounded-md focus:border-[#8B5CF6] focus-visible:ring-0"
                  />
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#555555]" />
                </div>
              </div>

              {/* Friends list */}
              <ScrollArea className="flex-1">
                <div className="p-4">
                  <p className="text-xs font-semibold uppercase text-[var(--text-muted)] mb-2 px-2">
                    {activeTab === "online" ? "Online" : "All Friends"} — {filteredFriends.length}
                  </p>
                  
                  {isLoading ? (
                    <div className="flex items-center justify-center py-20">
                      <Loader2 className="w-8 h-8 text-[#8B5CF6] animate-spin" />
                    </div>
                  ) : filteredFriends.length > 0 ? (
                    <div className="space-y-0.5">
                      {filteredFriends.map((friend) => (
                        <div
                          key={friend.id}
                          className="group flex items-center justify-between p-2 rounded-lg hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
                        >
                          <div className="flex items-center gap-3" onClick={() => startDM(friend.id)}>
                            <div className="relative">
                              <Avatar className="w-10 h-10">
                                <AvatarImage src={friend.avatar} />
                                <AvatarFallback className="bg-[#8B5CF6] text-[var(--text-on-accent)]">
                                  {(friend.displayName || friend.username).charAt(0).toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                              <div 
                                className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2 border-[var(--bg-app)]"
                                style={{ backgroundColor: statusColors[friend.status] }}
                              />
                            </div>
                            
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="font-medium text-[var(--text-primary)] text-sm">
                                  {friend.displayName || friend.username}
                                </p>
                                {friend.isPremium && (
                                  <Crown className="w-3.5 h-3.5 text-[#8B5CF6]" />
                                )}
                              </div>
                              <p className="text-xs text-[var(--text-muted)]">
                                {friend.customStatus || statusLabels[friend.status]}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button 
                              onClick={() => startDM(friend.id)}
                              className="p-2 bg-[var(--bg-card)] rounded-full hover:bg-[var(--bg-hover)] transition-colors"
                            >
                              <MessageCircle className="w-5 h-5 text-[var(--text-secondary)]" />
                            </button>
                            <button className="p-2 bg-[var(--bg-card)] rounded-full hover:bg-[var(--bg-hover)] transition-colors">
                              <Phone className="w-5 h-5 text-[var(--text-secondary)]" />
                            </button>
                            <button className="p-2 bg-[var(--bg-card)] rounded-full hover:bg-[var(--bg-hover)] transition-colors">
                              <Video className="w-5 h-5 text-[var(--text-secondary)]" />
                            </button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button className="p-2 bg-[var(--bg-card)] rounded-full hover:bg-[var(--bg-hover)] transition-colors">
                                  <MoreVertical className="w-5 h-5 text-[var(--text-secondary)]" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent className="bg-[var(--bg-card)] border-[var(--border-subtle)]">
                                <DropdownMenuItem 
                                  onClick={() => startDM(friend.id)}
                                  className="text-[var(--text-secondary)] focus:text-[var(--text-on-accent)] focus:bg-[#8B5CF6]"
                                >
                                  <MessageCircle className="w-4 h-4 mr-2" />
                                  Message
                                </DropdownMenuItem>
                                <DropdownMenuSeparator className="bg-[var(--border-subtle)]" />
                                <DropdownMenuItem 
                                  onClick={() => handleRemoveFriend(friend.id)}
                                  className="text-red-400 focus:text-[var(--text-on-accent)] focus:bg-red-500"
                                >
                                  <UserX className="w-4 h-4 mr-2" />
                                  Remove Friend
                                </DropdownMenuItem>
                                <DropdownMenuItem 
                                  onClick={() => handleBlockUser(friend.id)}
                                  className="text-red-400 focus:text-[var(--text-on-accent)] focus:bg-red-500"
                                >
                                  <Shield className="w-4 h-4 mr-2" />
                                  Block
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      icon={<Users className="w-12 h-12 text-[#8B5CF6]" />}
                      title={searchQuery ? "No friends found" : "No friends yet"}
                      description={searchQuery
                        ? "Try a different search"
                        : "Add some friends to start chatting!"}
                    />
                  )}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>

        {/* Active Now sidebar */}
        <div className="w-[360px] bg-[var(--bg-app)] border-l border-[var(--border-subtle)] hidden lg:flex flex-col">
          <div className="p-4">
            <h3 className="text-xl font-bold text-[var(--text-primary)] mb-4">Active Now</h3>
            
            {onlineFriends.length > 0 ? (
              <div className="space-y-2">
                {onlineFriends.slice(0, 5).map((friend) => (
                  <div
                    key={friend.id}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
                    onClick={() => startDM(friend.id)}
                  >
                    <div className="relative">
                      <Avatar className="w-9 h-9">
                        <AvatarImage src={friend.avatar} />
                        <AvatarFallback className="bg-[#8B5CF6] text-[var(--text-on-accent)] text-sm">
                          {(friend.displayName || friend.username).charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div 
                        className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-[var(--bg-app)]"
                        style={{ backgroundColor: statusColors[friend.status] }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                        {friend.displayName || friend.username}
                      </p>
                      {friend.customStatus && (
                        <p className="text-xs text-[var(--text-muted)] truncate">
                          {friend.customStatus}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                  It&apos;s quiet for now...
                </p>
                <p className="text-sm text-[var(--text-muted)] max-w-[200px]">
                  When a friend starts an activity—like playing a game or hanging out on voice—we&apos;ll show it here!
                </p>
              </div>
            )}
          </div>

          {/* Serika+ Promo - Only show if user is not premium */}
          {!user?.isPremium && (
            <div className="mt-auto p-4">
              <div className="p-4 rounded-lg bg-gradient-to-br from-[#8B5CF6]/20 to-[#6D28D9]/20 border border-[#8B5CF6]/30">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="w-5 h-5 text-[#8B5CF6]" />
                  <span className="font-semibold text-[var(--text-primary)]">Serika+</span>
                </div>
                <p className="text-sm text-[var(--text-secondary)] mb-3">
                  Get bigger uploads, custom profiles, animated avatars, and more!
                </p>
                <button className="w-full py-2.5 px-4 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-sm font-medium rounded-lg transition-colors">
                  Upgrade to Serika+
                </button>
              </div>
            </div>
          )}

          {/* Premium badge if user is premium */}
          {user?.isPremium && (
            <div className="mt-auto p-4">
              <div className="p-4 rounded-lg bg-gradient-to-br from-[#8B5CF6]/10 to-[#6D28D9]/10 border border-[#8B5CF6]/20">
                <div className="flex items-center gap-2 mb-2">
                  <Crown className="w-5 h-5 text-[#8B5CF6]" />
                  <span className="font-semibold text-[var(--text-primary)]">Serika+ Active</span>
                </div>
                <p className="text-sm text-[var(--text-secondary)]">
                  Thank you for supporting SerikaCord! You have access to all premium features.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Empty state component
function EmptyState({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="mb-6">
        <div className="w-24 h-24 rounded-full bg-[#8B5CF6]/10 flex items-center justify-center">
          {icon}
        </div>
      </div>
      <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2">
        {title}
      </h3>
      <p className="text-sm text-[var(--text-muted)] max-w-xs">
        {description}
      </p>
    </div>
  );
}
