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
      <div className="px-4 py-4 border-b border-[#1a1a1a]">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold text-white">Notifications</h1>
          <button 
            onClick={() => router.push("/channels/settings/notifications")}
            className="p-2 rounded-full hover:bg-[#1a1a1a] transition-colors"
          >
            <Settings className="w-5 h-5 text-[#888888]" />
          </button>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilter("all")}
            className={cn(
              "px-4 py-1.5 rounded-full text-sm font-medium transition-colors",
              filter === "all" 
                ? "bg-[#8B5CF6] text-white" 
                : "bg-[#1a1a1a] text-[#888888] hover:text-white"
            )}
          >
            All
          </button>
          <button
            onClick={() => setFilter("mentions")}
            className={cn(
              "px-4 py-1.5 rounded-full text-sm font-medium transition-colors",
              filter === "mentions" 
                ? "bg-[#8B5CF6] text-white" 
                : "bg-[#1a1a1a] text-[#888888] hover:text-white"
            )}
          >
            Mentions
          </button>
          <button
            onClick={() => setFilter("unread")}
            className={cn(
              "px-4 py-1.5 rounded-full text-sm font-medium transition-colors flex items-center gap-1",
              filter === "unread" 
                ? "bg-[#8B5CF6] text-white" 
                : "bg-[#1a1a1a] text-[#888888] hover:text-white"
            )}
          >
            Unread
            {unreadCount > 0 && (
              <span className="min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-[#ED4245] text-white text-xs font-bold rounded-full">
                {unreadCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Mark All Read Button */}
      {unreadCount > 0 && (
        <button
          onClick={handleMarkAllRead}
          className="flex items-center justify-center gap-2 px-4 py-2 mx-4 mt-3 rounded-lg bg-[#1a1a1a] text-[#888888] hover:text-white transition-colors"
        >
          <Check className="w-4 h-4" />
          <span className="text-sm">Mark all as read</span>
        </button>
      )}

      {/* Notifications List */}
      <ScrollArea className="flex-1">
        <div className="pb-20">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-2 border-[#8B5CF6] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filteredNotifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <div className="w-16 h-16 rounded-full bg-[#1a1a1a] flex items-center justify-center mb-4">
                <Bell className="w-8 h-8 text-[#666666]" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">
                {filter === "all" ? "No notifications" : `No ${filter} notifications`}
              </h3>
              <p className="text-[#666666] text-sm">
                {filter === "all" 
                  ? "When you receive notifications, they'll appear here" 
                  : `You don't have any ${filter} notifications`}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#1a1a1a]">
              {filteredNotifications.map((notification) => (
                <button
                  key={notification.id}
                  onClick={() => handleNotificationClick(notification)}
                  className={cn(
                    "w-full flex items-start gap-3 px-4 py-3 hover:bg-[#111111] transition-colors text-left",
                    !notification.isRead && "bg-[#8B5CF6]/5"
                  )}
                >
                  <div className="relative flex-shrink-0">
                    <Avatar className="w-10 h-10">
                      <AvatarImage src={notification.avatar} />
                      <AvatarFallback className="bg-[#8B5CF6] text-white">
                        {notification.title.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-[#1a1a1a] flex items-center justify-center text-[#8B5CF6]">
                      {getNotificationIcon(notification.type)}
                    </div>
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <span className={cn(
                        "font-medium truncate",
                        notification.isRead ? "text-[#888888]" : "text-white"
                      )}>
                        {notification.title}
                      </span>
                      <span className="text-xs text-[#666666] flex-shrink-0">
                        {formatTimestamp(notification.timestamp)}
                      </span>
                    </div>
                    <p className="text-sm text-[#666666] line-clamp-2 mt-0.5">
                      {notification.description}
                    </p>

                    {/* Friend Request Actions */}
                    {notification.type === "friend_request" && !notification.isRead && (
                      <div className="flex items-center gap-2 mt-2">
                        <button className="flex items-center justify-center w-8 h-8 rounded-full bg-[#23A559] hover:bg-[#1A7D41] text-white transition-colors">
                          <Check className="w-4 h-4" />
                        </button>
                        <button className="flex items-center justify-center w-8 h-8 rounded-full bg-[#ED4245] hover:bg-[#C03537] text-white transition-colors">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>

                  {!notification.isRead && (
                    <div className="w-2 h-2 rounded-full bg-[#8B5CF6] flex-shrink-0 mt-2" />
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
