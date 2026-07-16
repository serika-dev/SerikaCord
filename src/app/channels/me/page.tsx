"use client";

import { useState, useEffect, useCallback, useRef, Fragment } from "react";
import { 
  Users, 
  Search,
  MessageCircle,
  Check,
  X,
  MoreVertical,
  UserX,
  UserPlus,
  Clock,
  Crown,
  Shield,
  Copy,
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
import { SwipeableRow } from "@/components/ui/swipe-actions";
import { T, useGT } from "gt-next";
import { statusLabel } from "@/lib/statusLabels";
import { Loader } from "@/components/ui/Loader";
import { toast } from "sonner";
import { GameActivityCard } from "@/components/user/GameActivityCard";
import { NowWatchingCard } from "@/components/user/NowWatchingCard";
import { MusicActivityCard } from "@/components/user/MusicActivityCard";
import type { GameActivity, MusicActivity, MoeActivity } from "@/hooks/useMoeActivity";

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

interface ActiveFriend {
  friend: Friend;
  activity: {
    activity: MoeActivity | null;
    music: MusicActivity | null;
    game: GameActivity | null;
    activities: GameActivity[];
  };
}

const statusColors = {
  online: "#23A559",
  idle: "#F0B232",
  dnd: "#EF4444",
  offline: "#80848e",
};

const statusLabels = {
  online: "Online",
  idle: "Idle",
  dnd: "Do Not Disturb",
  offline: "Offline",
} as const;

export default function DirectMessagesPage() {
  const gt = useGT();
  const { user } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("online");
  const [contextMenuFriendId, setContextMenuFriendId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [addFriendUsername, setAddFriendUsername] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [activeFriends, setActiveFriends] = useState<ActiveFriend[]>([]);
  const [isLoadingActive, setIsLoadingActive] = useState(false);
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

  const fetchActiveFriends = useCallback(async () => {
    setIsLoadingActive(true);
    try {
      const response = await fetch("/api/friends/active");
      if (response.ok) {
        const data = await response.json();
        setActiveFriends((data.active || []) as ActiveFriend[]);
      }
    } catch (error) {
      console.error("Failed to fetch active friends:", error);
    } finally {
      setIsLoadingActive(false);
    }
  }, []);

  useEffect(() => {
    fetchFriends();
    fetchActiveFriends();
    const timer = setInterval(fetchActiveFriends, 30_000);
    return () => clearInterval(timer);
  }, [fetchFriends, fetchActiveFriends]);

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
      setAddFriendStatus({ type: "error", message: gt("Failed to send friend request") });
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

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "online", label: gt("Online"), count: onlineFriends.length },
    { id: "all", label: gt("All"), count: friendsData.friends.length },
    { id: "pending", label: gt("Pending"), count: friendsData.pending.incoming.length + friendsData.pending.outgoing.length },
    { id: "blocked", label: gt("Blocked"), count: friendsData.blocked.length },
  ];

  // Start DM with friend
  const startDM = async (friendId: string) => {
    // Navigate to the DM conversation page
    router.push(`/dm/${friendId}`);
  };

  return (
    <div className="flex-1 flex bg-[var(--bg-app)] overflow-hidden">
      {/* Left column: header + content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      {/* Header */}
      <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-app)] flex-shrink-0">
        <div className="px-3 sm:px-6 pt-4 pb-3">
          {/* Title row */}
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-[var(--app-accent)]/15 flex items-center justify-center">
                <Users className="w-5 h-5 text-[var(--app-accent)]" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-[var(--text-primary)] leading-tight"><T>Friends</T></h1>
                <p className="text-xs text-[var(--text-muted)] hidden sm:block">
                  {friendsData.friends.length} {gt("friends")} · {onlineFriends.length} {gt("online")}
                </p>
              </div>
            </div>
            <button
              onClick={() => setActiveTab("add")}
              className={cn(
                "flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-colors shrink-0",
                activeTab === "add"
                  ? "bg-[var(--app-accent)]/15 text-[var(--app-accent)]"
                  : "bg-[var(--app-accent)] text-white hover:opacity-90"
              )}
            >
              <UserPlus className="w-4 h-4" />
              <span className="hidden sm:inline"><T>Add Friend</T></span>
              <span className="sm:hidden"><T>Add</T></span>
            </button>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide -mx-3 px-3 sm:mx-0 sm:px-0">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5",
                  activeTab === tab.id
                    ? "bg-[var(--bg-active)] text-[var(--app-accent)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                )}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span className={cn(
                    "text-xs px-1.5 py-0.5 rounded-full",
                    activeTab === tab.id
                      ? "bg-[var(--app-accent)]/20 text-[var(--app-accent)]"
                      : "bg-[var(--border-subtle)] text-[var(--text-secondary)]"
                  )}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Main content area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {activeTab === "add" ? (
            <ScrollArea className="flex-1">
              <div className="p-4 sm:p-6 max-w-2xl">
                <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5 sm:p-6">
                  <h2 className="text-xl font-bold text-[var(--text-primary)] mb-1">
                    <T>Add Friend</T>
                  </h2>
                  <p className="text-sm text-[var(--text-muted)] mb-5">
                    <T>Enter a SerikaCord username to send a friend request.</T>
                  </p>

                  <div className="flex flex-col sm:flex-row gap-2">
                    <Input
                      value={addFriendUsername}
                      onChange={(e) => {
                        setAddFriendUsername(e.target.value);
                        setAddFriendStatus({ type: null, message: "" });
                      }}
                      onKeyDown={(e) => e.key === "Enter" && handleAddFriend()}
                      placeholder={gt("Enter a username")}
                      className={cn(
                        "h-12 bg-[var(--bg-app)] border-2 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] text-base rounded-lg focus-visible:ring-0 flex-1",
                        addFriendStatus.type === "success" && "border-green-500/50",
                        addFriendStatus.type === "error" && "border-red-500/50",
                        !addFriendStatus.type && "border-[var(--border-subtle)] focus:border-[var(--app-accent)]"
                      )}
                    />
                    <button
                      onClick={handleAddFriend}
                      disabled={!addFriendUsername.trim() || isAddingFriend}
                      className={cn(
                        "h-12 px-5 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2 shrink-0",
                        addFriendUsername.trim() && !isAddingFriend
                          ? "bg-[var(--app-accent)] hover:opacity-90 text-white"
                          : "bg-[var(--app-accent)]/40 text-white/50 cursor-not-allowed"
                      )}
                    >
                      {isAddingFriend && <Loader size={16} />}
                      <T>Send Request</T>
                    </button>
                  </div>

                  {addFriendStatus.type && (
                    <div className={cn(
                      "mt-3 px-4 py-2.5 rounded-lg text-sm flex items-center gap-2",
                      addFriendStatus.type === "success"
                        ? "bg-green-500/10 text-green-500"
                        : "bg-red-500/10 text-red-500"
                    )}>
                      {addFriendStatus.type === "success"
                        ? <Check className="w-4 h-4 shrink-0" />
                        : <X className="w-4 h-4 shrink-0" />}
                      {addFriendStatus.message}
                    </div>
                  )}
                </div>

                {/* Tips */}
                <div className="mt-4 flex flex-col sm:flex-row gap-3">
                  {[
                    { icon: <Search className="w-5 h-5" />, title: gt("Find username"), desc: gt("Ask your friend for their exact SerikaCord username") },
                    { icon: <UserPlus className="w-5 h-5" />, title: gt("Send request"), desc: gt("Type it above and send a friend request") },
                    { icon: <Check className="w-5 h-5" />, title: gt("Get connected"), desc: gt("Once they accept, you can start chatting") },
                  ].map((step, i) => (
                    <div key={i} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
                      <div className="w-9 h-9 rounded-lg bg-[var(--app-accent)]/15 flex items-center justify-center text-[var(--app-accent)] mb-2">
                        {step.icon}
                      </div>
                      <p className="text-sm font-semibold text-[var(--text-primary)] mb-0.5">{step.title}</p>
                      <p className="text-xs text-[var(--text-muted)] leading-relaxed">{step.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </ScrollArea>
          ) : activeTab === "pending" ? (
            <ScrollArea className="flex-1">
              <div className="p-4 sm:p-6 max-w-3xl">
                {/* Incoming requests */}
                {friendsData.pending.incoming.length > 0 && (
                  <div className="mb-6">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-2 h-2 rounded-full bg-green-500" />
                      <p className="text-sm font-semibold text-[var(--text-primary)]">
                        <T>Incoming</T>
                      </p>
                      <span className="text-xs text-[var(--text-muted)]">· {friendsData.pending.incoming.length}</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      {friendsData.pending.incoming.map((request) => (
                        <div
                          key={request.id}
                          className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] hover:border-[var(--app-accent)]/30 transition-colors"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <Avatar className="w-10 h-10 shrink-0">
                              <AvatarImage src={request.avatar} />
                              <AvatarFallback className="bg-[var(--app-accent)] text-[var(--text-on-accent)]">
                                {(request.displayName || request.username).charAt(0).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p className="font-medium text-[var(--text-primary)] text-sm truncate">
                                  {request.displayName || request.username}
                                </p>
                                {request.isPremium && (
                                  <Crown className="w-3.5 h-3.5 text-[var(--app-accent)] shrink-0" />
                                )}
                              </div>
                              <p className="text-xs text-[var(--text-muted)]">{gt("Incoming request")}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              onClick={() => handleAcceptRequest(request.id)}
                              disabled={actionLoading === request.id}
                              className="p-2 rounded-lg bg-green-500/10 hover:bg-green-500/20 text-green-500 transition-colors disabled:opacity-50"
                              aria-label={gt("Accept")}
                            >
                              {actionLoading === request.id ? (
                                <Loader size={20} />
                              ) : (
                                <Check className="w-5 h-5" />
                              )}
                            </button>
                            <button
                              onClick={() => handleDeclineRequest(request.id)}
                              disabled={actionLoading === request.id}
                              className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-500 transition-colors disabled:opacity-50"
                              aria-label={gt("Decline")}
                            >
                              <X className="w-5 h-5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Outgoing requests */}
                {friendsData.pending.outgoing.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-2 h-2 rounded-full bg-[var(--text-muted)]" />
                      <p className="text-sm font-semibold text-[var(--text-primary)]">
                        <T>Outgoing</T>
                      </p>
                      <span className="text-xs text-[var(--text-muted)]">· {friendsData.pending.outgoing.length}</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      {friendsData.pending.outgoing.map((request) => (
                        <div
                          key={request.id}
                          className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] hover:border-[var(--app-accent)]/30 transition-colors"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <Avatar className="w-10 h-10 shrink-0">
                              <AvatarImage src={request.avatar} />
                              <AvatarFallback className="bg-[var(--bg-sidebar-elevated)] text-[var(--text-primary)]">
                                {(request.displayName || request.username).charAt(0).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p className="font-medium text-[var(--text-primary)] text-sm truncate">
                                  {request.displayName || request.username}
                                </p>
                                {request.isPremium && (
                                  <Crown className="w-3.5 h-3.5 text-[var(--app-accent)] shrink-0" />
                                )}
                              </div>
                              <p className="text-xs text-[var(--text-muted)]">{gt("Outgoing request")}</p>
                            </div>
                          </div>
                          <button
                            onClick={() => handleCancelRequest(request.id)}
                            disabled={actionLoading === request.id}
                            className="px-3 py-1.5 text-sm rounded-lg bg-[var(--bg-hover)] hover:bg-red-500/15 text-[var(--text-secondary)] hover:text-red-500 transition-colors disabled:opacity-50 shrink-0"
                          >
                            {actionLoading === request.id ? (
                              <Loader size={16} />
                            ) : (
                              gt("Cancel")
                            )}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {friendsData.pending.incoming.length === 0 && friendsData.pending.outgoing.length === 0 && (
                  <EmptyState
                    icon={<Clock className="w-12 h-12 text-[var(--app-accent)]" />}
                    title={gt("No pending requests")}
                    description={gt("Friend requests you send or receive will appear here")}
                  />
                )}
              </div>
            </ScrollArea>
          ) : activeTab === "blocked" ? (
            <ScrollArea className="flex-1">
              <div className="p-4 sm:p-6 max-w-3xl">
                {friendsData.blocked.length > 0 ? (
                  <>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-2 h-2 rounded-full bg-red-500" />
                      <p className="text-sm font-semibold text-[var(--text-primary)]">
                        <T>Blocked Users</T>
                      </p>
                      <span className="text-xs text-[var(--text-muted)]">· {friendsData.blocked.length}</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      {friendsData.blocked.map((blockedUser) => (
                        <div
                          key={blockedUser.id}
                          className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] hover:border-[var(--app-accent)]/30 transition-colors"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <Avatar className="w-10 h-10 shrink-0">
                              <AvatarImage src={blockedUser.avatar} />
                              <AvatarFallback className="bg-[var(--bg-sidebar-elevated)] text-[var(--text-primary)]">
                                {(blockedUser.displayName || blockedUser.username).charAt(0).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="font-medium text-[var(--text-primary)] text-sm truncate">
                                {blockedUser.displayName || blockedUser.username}
                              </p>
                              <p className="text-xs text-[var(--text-muted)]">{gt("Blocked")}</p>
                            </div>
                          </div>
                          <button
                            onClick={() => handleUnblockUser(blockedUser.id)}
                            disabled={actionLoading === blockedUser.id}
                            className="px-3 py-1.5 text-sm rounded-lg bg-[var(--bg-hover)] hover:bg-[var(--app-accent)]/15 text-[var(--text-secondary)] hover:text-[var(--app-accent)] transition-colors disabled:opacity-50 shrink-0"
                          >
                            {actionLoading === blockedUser.id ? (
                              <Loader size={16} />
                            ) : (
                              gt("Unblock")
                            )}
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <EmptyState
                    icon={<Shield className="w-12 h-12 text-[var(--app-accent)]" />}
                    title={gt("No blocked users")}
                    description={gt("Users you block won't be able to message you or send friend requests")}
                  />
                )}
              </div>
            </ScrollArea>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Search */}
              <div className="p-4 pb-2 flex-shrink-0">
                <div className="relative max-w-md">
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={gt("Search friends...")}
                    className="h-10 bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] pl-10 rounded-lg focus:border-[var(--app-accent)] focus-visible:ring-0"
                  />
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
                </div>
              </div>

              {/* Friends list */}
              <ScrollArea className="flex-1">
                <div className="p-4 pt-2">
                  {isLoading ? (
                    <div className="flex items-center justify-center py-20">
                      <Loader size={32} />
                    </div>
                  ) : filteredFriends.length > 0 ? (
                    <>
                      <p className="text-xs font-semibold uppercase text-[var(--text-muted)] mb-3 px-1">
                        {activeTab === "online" ? gt("Online") : gt("All Friends")} — {filteredFriends.length}
                      </p>
                      <div className="flex flex-col">
                        {filteredFriends.map((friend, idx) => (
                          <Fragment key={friend.id}>
                          <SwipeableRow
                            className="group"
                            actions={[
                              {
                                icon: <MessageCircle className="w-5 h-5" />,
                                label: gt("Message"),
                                className: "bg-[var(--app-accent)]",
                                onAction: () => startDM(friend.id),
                              },
                              {
                                icon: <UserX className="w-5 h-5" />,
                                label: gt("Remove"),
                                className: "bg-red-500",
                                onAction: () => handleRemoveFriend(friend.id),
                              },
                            ]}
                          >
                            {idx > 0 && <div className="mx-4 h-px bg-[var(--border-subtle)]" />}
                            <div onContextMenu={(e) => { e.preventDefault(); setContextMenuFriendId(friend.id); }} className="group flex items-center gap-3 px-3 py-2.5 hover:bg-[var(--bg-hover)] cursor-pointer transition-colors rounded-lg mx-1">
                              <button
                                className="flex items-center gap-3 flex-1 min-w-0 text-left"
                                onClick={() => startDM(friend.id)}
                                aria-label={`${gt("Message")} ${friend.displayName || friend.username}`}
                              >
                                <div className="relative shrink-0">
                                  <Avatar className="w-10 h-10">
                                    <AvatarImage src={friend.avatar} />
                                    <AvatarFallback className="bg-[var(--app-accent)] text-[var(--text-on-accent)]">
                                      {(friend.displayName || friend.username).charAt(0).toUpperCase()}
                                    </AvatarFallback>
                                  </Avatar>
                                  <div
                                    className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-[var(--bg-app)]"
                                    style={{ backgroundColor: statusColors[friend.status] }}
                                  />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5">
                                    <p className="font-semibold text-[var(--text-primary)] text-sm truncate">
                                      {friend.displayName || friend.username}
                                    </p>
                                    {friend.isPremium && (
                                      <Crown className="w-3.5 h-3.5 text-[var(--app-accent)] shrink-0" />
                                    )}
                                  </div>
                                  <p className="text-xs text-[var(--text-muted)] truncate">
                                    {friend.status !== "offline" && friend.customStatus ? friend.customStatus : statusLabel(friend.status, gt)}
                                  </p>
                                </div>
                              </button>

                              {/* Desktop hover actions */}
                              <div className="hidden sm:flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
                                <button
                                  onClick={() => startDM(friend.id)}
                                  aria-label={gt("Message")}
                                  title={gt("Message")}
                                  className="p-2.5 rounded-full bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] transition-colors"
                                >
                                  <MessageCircle className="w-4 h-4 text-[var(--text-secondary)]" />
                                </button>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <button
                                      aria-label={gt("More options")}
                                      title={gt("More")}
                                      className="p-2.5 rounded-full bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] transition-colors"
                                    >
                                      <MoreVertical className="w-4 h-4 text-[var(--text-secondary)]" />
                                    </button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent className="bg-[var(--bg-card)] border-[var(--border-subtle)]">
                                    <DropdownMenuItem
                                      onClick={() => startDM(friend.id)}
                                      className="text-[var(--text-secondary)] focus:text-[var(--text-on-accent)] focus:bg-[var(--app-accent)]"
                                    >
                                      <MessageCircle className="w-4 h-4 mr-2" />
                                      <T>Message</T>
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator className="bg-[var(--border-subtle)]" />
                                    <DropdownMenuItem
                                      onClick={() => handleRemoveFriend(friend.id)}
                                      className="text-red-400 focus:text-[var(--text-on-accent)] focus:bg-red-500"
                                    >
                                      <UserX className="w-4 h-4 mr-2" />
                                      <T>Remove Friend</T>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => handleBlockUser(friend.id)}
                                      className="text-red-400 focus:text-[var(--text-on-accent)] focus:bg-red-500"
                                    >
                                      <Shield className="w-4 h-4 mr-2" />
                                      <T>Block</T>
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>

                              {/* Mobile more menu */}
                              <div className="sm:hidden shrink-0">
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <button
                                      aria-label={gt("More options")}
                                      className="p-2 rounded-lg text-[var(--text-muted)] active:bg-[var(--bg-hover)] transition-colors"
                                    >
                                      <MoreVertical className="w-5 h-5" />
                                    </button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="bg-[var(--bg-card)] border-[var(--border-subtle)]">
                                    <DropdownMenuItem
                                      onClick={() => startDM(friend.id)}
                                      className="text-[var(--text-secondary)] focus:text-[var(--text-on-accent)] focus:bg-[var(--app-accent)]"
                                    >
                                      <MessageCircle className="w-4 h-4 mr-2" />
                                      <T>Message</T>
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator className="bg-[var(--border-subtle)]" />
                                    <DropdownMenuItem
                                      onClick={() => handleRemoveFriend(friend.id)}
                                      className="text-red-400 focus:text-[var(--text-on-accent)] focus:bg-red-500"
                                    >
                                      <UserX className="w-4 h-4 mr-2" />
                                      <T>Remove Friend</T>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => handleBlockUser(friend.id)}
                                      className="text-red-400 focus:text-[var(--text-on-accent)] focus:bg-red-500"
                                    >
                                      <Shield className="w-4 h-4 mr-2" />
                                      <T>Block</T>
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            </div>
                          </SwipeableRow>
                          <DropdownMenu open={contextMenuFriendId === friend.id} onOpenChange={(o) => setContextMenuFriendId(o ? friend.id : null)}>
                            <DropdownMenuTrigger asChild>
                              <span className="absolute inset-0 pointer-events-none" aria-hidden />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="bg-[var(--bg-card)] border-[var(--border-subtle)]">
                              <DropdownMenuItem
                                onClick={() => { setContextMenuFriendId(null); startDM(friend.id); }}
                                className="text-[var(--text-secondary)] focus:text-[var(--text-on-accent)] focus:bg-[var(--app-accent)]"
                              >
                                <MessageCircle className="w-4 h-4 mr-2" />
                                <T>Message</T>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => { setContextMenuFriendId(null); navigator.clipboard?.writeText(friend.username); toast.success(gt("Username copied")); }}
                              >
                                <Copy className="w-4 h-4 mr-2" />
                                <T>Copy Username</T>
                              </DropdownMenuItem>
                              {user?.badges?.some((b: string) => ["admin", "serikacord_developer"].includes(b)) && (
                                <DropdownMenuItem
                                  onClick={() => { setContextMenuFriendId(null); navigator.clipboard?.writeText(friend.id); toast.success(gt("User ID copied")); }}
                                >
                                  <Copy className="w-4 h-4 mr-2" />
                                  <T>Copy User ID</T>
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator className="bg-[var(--border-subtle)]" />
                              <DropdownMenuItem
                                onClick={() => { setContextMenuFriendId(null); handleRemoveFriend(friend.id); }}
                                className="text-red-400 focus:text-[var(--text-on-accent)] focus:bg-red-500"
                              >
                                <UserX className="w-4 h-4 mr-2" />
                                <T>Remove Friend</T>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => { setContextMenuFriendId(null); handleBlockUser(friend.id); }}
                                className="text-red-400 focus:text-[var(--text-on-accent)] focus:bg-red-500"
                              >
                                <Shield className="w-4 h-4 mr-2" />
                                <T>Block</T>
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                          </Fragment>
                        ))}
                      </div>
                    </>
                  ) : (
                    <EmptyState
                      icon={<Users className="w-12 h-12 text-[var(--app-accent)]" />}
                      title={searchQuery ? gt("No friends found") : gt("No friends yet")}
                      description={searchQuery
                        ? gt("Try a different search term")
                        : gt("Add some friends to start chatting!")}
                    />
                  )}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>
      </div>
      </div>
      {/* Active Now sidebar — full height */}
      {(activeTab === "online" || activeTab === "all") && (
        <div className="w-80 border-l border-[var(--border-subtle)] bg-[var(--bg-card)] hidden lg:flex flex-col shrink-0">
          <div className="p-4 border-b border-[var(--border-subtle)] flex-shrink-0">
            <h3 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-wide">
              <T>Active Now</T>
            </h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {activeFriends.length} {activeFriends.length === 1 ? gt("friend") : gt("friends")}
            </p>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-4 flex flex-col gap-4">
              {isLoadingActive ? (
                <div className="flex items-center justify-center py-10">
                  <Loader size={24} />
                </div>
              ) : activeFriends.length > 0 ? (
                activeFriends.map((entry) => (
                  <ActiveFriendCard
                    key={entry.friend.id}
                    entry={entry}
                    onMessage={() => startDM(entry.friend.id)}
                  />
                ))
              ) : (
                <div className="text-center py-10 px-2">
                  <p className="text-sm text-[var(--text-muted)]">
                    {gt("When friends are active, they'll show up here")}
                  </p>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}

function ActiveFriendCard({ entry, onMessage }: { entry: ActiveFriend; onMessage: () => void }) {
  const gt = useGT();
  const { friend, activity } = entry;
  const displayName = friend.displayName || friend.username;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 transition-colors hover:border-[var(--app-accent)]/30">
      {/* Friend header */}
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={onMessage}
          className="flex items-center gap-3 min-w-0 text-left group"
        >
          <div className="relative shrink-0">
            <Avatar className="w-11 h-11">
              <AvatarImage src={friend.avatar} />
              <AvatarFallback className="bg-[var(--app-accent)] text-[var(--text-on-accent)]">
                {displayName.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div
              className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-[var(--bg-card)]"
              style={{ backgroundColor: statusColors[friend.status] }}
            />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="font-semibold text-[var(--text-primary)] text-sm truncate group-hover:text-[var(--app-accent)] transition-colors">
                {displayName}
              </p>
              {friend.isPremium && <Crown className="w-3.5 h-3.5 text-[var(--app-accent)] shrink-0" />}
            </div>
            <p className="text-xs text-[var(--text-muted)] truncate">
              {friend.status !== "offline" && friend.customStatus ? friend.customStatus : statusLabels[friend.status]}
            </p>
          </div>
        </button>
        <button
          onClick={onMessage}
          aria-label={gt("Message")}
          title={gt("Message")}
          className="p-2 rounded-full bg-[var(--bg-hover)] hover:bg-[var(--app-accent)] text-[var(--text-secondary)] hover:text-white transition-colors shrink-0"
        >
          <MessageCircle className="w-4 h-4" />
        </button>
      </div>

      {/* Activity cards */}
      <div className="flex flex-col gap-2">
        {activity.activity && <NowWatchingCard activity={activity.activity} />}
        {activity.music && <MusicActivityCard music={activity.music} />}
        {activity.activities.map((game, idx) => (
          <GameActivityCard key={`${game.type}-${game.name}-${idx}`} game={game} />
        ))}
      </div>
    </div>
  );
}

// Empty state component
function EmptyState({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="mb-5">
        <div className="w-20 h-20 rounded-2xl bg-[var(--app-accent)]/10 flex items-center justify-center">
          {icon}
        </div>
      </div>
      <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
        {title}
      </h3>
      <p className="text-sm text-[var(--text-muted)] max-w-xs">
        {description}
      </p>
    </div>
  );
}
