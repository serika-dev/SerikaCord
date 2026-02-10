"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Bell,
  MessageSquare,
  UserPlus,
  Heart,
  AtSign,
  Settings,
  Check,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Notification {
  id: string;
  type: "message" | "mention" | "friend_request" | "reaction" | "server_invite";
  title: string;
  description: string;
  avatar?: string;
  timestamp: string;
  isRead: boolean;
  serverId?: string;
  channelId?: string;
  userId?: string;
}

export function MobileNotificationsView() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "mentions" | "unread">("all");

  useEffect(() => {
    // Fetch notifications
    const fetchNotifications = async () => {
      try {
        const response = await fetch("/api/notifications");
        if (response.ok) {
          const data = await response.json();
          setNotifications(data.notifications || []);
        }
      } catch (error) {
        console.error("Failed to fetch notifications:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchNotifications();
  }, []);

  const formatTimestamp = (date: string | Date) => {
    if (!date) return "";
    const d = new Date(date);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString();
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case "message":
        return <MessageSquare className="w-4 h-4" />;
      case "mention":
        return <AtSign className="w-4 h-4" />;
      case "friend_request":
        return <UserPlus className="w-4 h-4" />;
      case "reaction":
        return <Heart className="w-4 h-4" />;
      default:
        return <Bell className="w-4 h-4" />;
    }
  };

  const handleNotificationClick = (notification: Notification) => {
    if (notification.type === "message" || notification.type === "mention") {
      if (notification.serverId && notification.channelId) {
        router.push(`/channels/${notification.serverId}/${notification.channelId}`);
      }
    } else if (notification.type === "friend_request" && notification.userId) {
      // Handle friend request
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await fetch("/api/notifications/read-all", { method: "POST" });
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    } catch (error) {
      console.error("Failed to mark all as read:", error);
    }
  };

  const filteredNotifications = notifications.filter(n => {
    if (filter === "mentions") return n.type === "mention";
    if (filter === "unread") return !n.isRead;
    return true;
  });

  const unreadCount = notifications.filter(n => !n.isRead).length;

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a]">
      {/* Header */}
      <header className="flex-shrink-0 px-4 pt-3 pb-2 safe-area-top">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-2xl font-bold text-white">Notifications</h1>
          <button
            onClick={() => router.push("/channels/settings/notifications")}
            className="flex items-center justify-center w-10 h-10 rounded-full bg-[#1a1a1a] text-white active:scale-95 active:bg-[#252525] transition-all touch-manipulation"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1">
          <button
            onClick={() => setFilter("all")}
            className={cn(
              "px-4 py-2 rounded-full text-sm font-semibold transition-all whitespace-nowrap active:scale-95 touch-manipulation",
              filter === "all"
                ? "bg-[#8B5CF6] text-white"
                : "bg-[#1a1a1a] text-neutral-400"
            )}
          >
            All
          </button>
          <button
            onClick={() => setFilter("mentions")}
            className={cn(
              "px-4 py-2 rounded-full text-sm font-semibold transition-all whitespace-nowrap active:scale-95 touch-manipulation",
              filter === "mentions"
                ? "bg-[#8B5CF6] text-white"
                : "bg-[#1a1a1a] text-neutral-400"
            )}
          >
            Mentions
          </button>
          <button
            onClick={() => setFilter("unread")}
            className={cn(
              "px-4 py-2 rounded-full text-sm font-semibold transition-all whitespace-nowrap flex items-center gap-1.5 active:scale-95 touch-manipulation",
              filter === "unread"
                ? "bg-[#8B5CF6] text-white"
                : "bg-[#1a1a1a] text-neutral-400"
            )}
          >
            Unread
            {unreadCount > 0 && (
              <span className="min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-[#ED4245] text-white text-[10px] font-bold rounded-full">
                {unreadCount}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Mark All Read Button */}
      {unreadCount > 0 && (
        <div className="px-5 mb-2">
          <button
            onClick={handleMarkAllRead}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[#1a1a1a] text-neutral-400 hover:text-white transition-all active:scale-95 border border-white/5"
          >
            <Check className="w-4 h-4" />
            <span className="text-sm font-medium">Mark all as read</span>
          </button>
        </div>
      )}

      {/* Notifications List */}
      <ScrollArea className="flex-1 px-2">
        <div className="pb-24 pt-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-10 h-10 border-4 border-[#8B5CF6] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filteredNotifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
              <div className="w-20 h-20 rounded-3xl bg-[#1a1a1a] flex items-center justify-center mb-6">
                <Bell className="w-10 h-10 text-neutral-500" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">
                {filter === "all" ? "No notifications" : `No ${filter} notifications`}
              </h3>
              <p className="text-neutral-500 text-base">
                {filter === "all"
                  ? "When you receive notifications, they'll appear here"
                  : `You don't have any ${filter} notifications`}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {filteredNotifications.map((notification) => (
                <button
                  key={notification.id}
                  onClick={() => handleNotificationClick(notification)}
                  className={cn(
                    "w-full flex items-start gap-4 px-4 py-4 hover:bg-[#1a1a1a]/50 active:bg-[#1a1a1a] rounded-2xl transition-all text-left group",
                    !notification.isRead && "bg-[#8B5CF6]/5 border border-[#8B5CF6]/20"
                  )}
                >
                  <div className="relative flex-shrink-0 mt-0.5">
                    <Avatar className="w-12 h-12 border border-white/5">
                      <AvatarImage src={notification.avatar} />
                      <AvatarFallback className="bg-[#8B5CF6] text-white font-bold">
                        {notification.title.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-[#111111] flex items-center justify-center shadow-sm border border-black">
                      {getNotificationIcon(notification.type)}
                    </div>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <span className={cn(
                        "font-semibold truncate text-[16px] leading-tight",
                        notification.isRead ? "text-neutral-400" : "text-white"
                      )}>
                        {notification.title}
                      </span>
                      <span className="text-xs font-medium text-neutral-600 flex-shrink-0 whitespace-nowrap">
                        {formatTimestamp(notification.timestamp)}
                      </span>
                    </div>
                    <p className={cn(
                      "text-[15px] leading-snug mt-1 line-clamp-2",
                      notification.isRead ? "text-neutral-500" : "text-neutral-300"
                    )}>
                      {notification.description}
                    </p>

                    {/* Friend Request Actions */}
                    {notification.type === "friend_request" && !notification.isRead && (
                      <div className="flex items-center gap-3 mt-3">
                        <button
                          className="flex items-center justify-center px-4 py-2 rounded-lg bg-[#23A559] hover:bg-[#1A7D41] text-white transition-all active:scale-95 font-bold text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            // Add accept logic
                          }}
                        >
                          <Check className="w-4 h-4 mr-1" /> Accept
                        </button>
                        <button
                          className="flex items-center justify-center px-4 py-2 rounded-lg bg-[#ED4245] hover:bg-[#C03537] text-white transition-all active:scale-95 font-bold text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            // Add deny logic
                          }}
                        >
                          <X className="w-4 h-4 mr-1" /> Decline
                        </button>
                      </div>
                    )}
                  </div>

                  {!notification.isRead && (
                    <div className="w-2.5 h-2.5 rounded-full bg-[#8B5CF6] flex-shrink-0 mt-2 shadow-[0_0_10px_rgba(139,92,246,0.5)]" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
