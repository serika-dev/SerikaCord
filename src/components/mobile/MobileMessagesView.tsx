"use client";

import { sharedGet } from "@/lib/bootFetch";
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { UserPlus, Star, RefreshCw, Search, X, ChevronLeft, MessageSquarePlus } from "lucide-react";
import dynamic from "next/dynamic";
import { MountWhenOpened } from "@/components/ui/MountWhenOpened";

const GroupDmPickerDialog = dynamic(() => import("@/components/dm/GroupDmPickerDialog").then((m) => m.GroupDmPickerDialog), { ssr: false });
import { cn, cdnImage } from "@/lib/utils";
import { useGT } from "gt-next";
import { useUnread, type DmSeed } from "@/contexts/UnreadContext";
import { notificationPreview } from "@/lib/notifications/notify";
import { groupDmHref } from "@/lib/chat/groupDm";
import { groupDisplayName } from "@/lib/chat/dmCall";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { PullIndicator } from "@/components/mobile/PullIndicator";

interface Message {
  id: string;
  recipientId: string;
  /** Where the row opens (the 1:1 DM or the group page). */
  href: string;
  type: "dm" | "group";
  name: string;
  username: string;
  avatar?: string;
  avatars?: string[];
  lastMessage: string;
  timestamp: string;
  unreadCount?: number;
  isPinned?: boolean;
  isFavorite?: boolean;
  status?: "online" | "idle" | "dnd" | "offline";
}

interface MobileMessagesViewProps {
  onAddFriend?: () => void;
}

export function MobileMessagesView({ onAddFriend }: MobileMessagesViewProps) {
  const router = useRouter();
  const gt = useGT();
  const { isChannelUnread, registerChannels, getMentionCount, seedDmChannels } = useUnread();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [showGroupPicker, setShowGroupPicker] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);

  const formatTimestamp = useCallback((date: string | Date) => {
    if (!date) return "";
    const d = new Date(date);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (minutes < 1) return gt("Now");
    if (minutes < 60) return `${minutes}m`;
    if (hours < 24) return `${hours}h`;
    if (days < 7) return `${days}d`;
    return d.toLocaleDateString();
  }, []);

  const fetchMessages = useCallback(async () => {
    const issuedAt = Date.now();
    try {
      const response = await sharedGet("/api/dms");
      if (response.ok) {
        const data = await response.json();
        // 1:1 DMs are de-duplicated by the other person; groups are their own rows.
        const seenRecipients = new Map<string, Message>();
        const groups: Message[] = [];
        type ListRecipient = { id: string; username?: string; displayName?: string; avatar?: string; status?: Message["status"] };
        type ListChannel = {
          id: string;
          type: string;
          name?: string | null;
          icon?: string | null;
          recipients?: ListRecipient[];
          lastMessage?: { content?: string } | null;
          updatedAt?: string;
        };

        ((data.channels || []) as ListChannel[]).forEach((channel) => {
          const recipients = channel.recipients || [];
          if (channel.type === "group_dm") {
            groups.push({
              id: channel.id,
              recipientId: channel.id,
              href: groupDmHref(channel.id),
              type: "group",
              name: groupDisplayName(channel.name, recipients.map((r) => r.displayName || r.username || "")),
              username: recipients.map((r) => r.username || "").join(" "),
              avatar: channel.icon ?? undefined,
              avatars: channel.icon ? undefined : recipients.slice(0, 2).map((r) => r.avatar || ""),
              lastMessage: channel.lastMessage?.content || gt("{count} Members", { count: recipients.length + 1 }),
              timestamp: formatTimestamp(channel.updatedAt || ""),
            });
            return;
          }
          const recipient = recipients[0];
          if (!recipient?.id) return;
          const recipientId = String(recipient.id);

          // Only keep the most recent conversation with each user
          const existing = seenRecipients.get(recipientId);
          const channelDate = new Date(channel.updatedAt || 0).getTime();
          const existingDate = existing ? new Date(existing.timestamp || 0).getTime() : 0;

          if (!existing || channelDate > existingDate) {
            seenRecipients.set(recipientId, {
              id: channel.id,
              recipientId,
              href: `/dm/${recipientId}`,
              type: "dm",
              name: recipient.displayName || recipient.username || gt("Unknown"),
              username: recipient.username || "",
              avatar: recipient.avatar,
              lastMessage: notificationPreview(channel.lastMessage?.content, 120, data.mentionNames) || gt("Start a conversation"),
              timestamp: formatTimestamp(channel.updatedAt || ""),
              status: recipient.status || "offline",
            });
          }
        });

        // Keep the server's newest-first order across DMs and groups.
        const order = new Map(((data.channels || []) as ListChannel[]).map((c, i) => [c.id, i]));
        const list = [...seenRecipients.values(), ...groups].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
        setMessages(list);
        // Feed the unread engine so DM rows light up cross-device: the newest
        // message (its own time / author) plus the server's unread counts.
        registerChannels(
          (data.channels || []).map((c: DmSeed) => ({
            id: c.id,
            type: "dm" as const,
            lastMessageAt: c.lastMessage?.createdAt ?? null,
            lastMessageId: c.lastMessage?.id ?? null,
            lastMessageAuthorId: c.lastMessage?.authorId ?? null,
          }))
        );
        seedDmChannels((data.channels || []) as DmSeed[], issuedAt);
      }
    } catch (error) {
      console.error("Failed to fetch messages:", error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [formatTimestamp, registerChannels, seedDmChannels]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  useEffect(() => {
    const connectSSE = () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      const source = new EventSource("/api/dms/stream");
      eventSourceRef.current = source;

      source.onopen = () => {
        reconnectAttemptsRef.current = 0;
      };

      source.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "connected" || data.type === "ping") return;
          if (data.type === "dm:list:update" || data.type === "group:update" || data.type === "group:remove") {
            fetchMessages();
          }
        } catch {
          // ignore malformed events
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
  }, [fetchMessages]);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    await fetchMessages();
  }, [fetchMessages, isRefreshing]);
  const { pullDistance, pullHandlers } = usePullToRefresh(scrollContainerRef, handleRefresh);

  const statusColors: Record<string, string> = {
    online: "#22c55e",
    idle: "#eab308",
    dnd: "#ef4444",
    offline: "#6b7280",
  };

  const handleMessageClick = (message: Message) => {
    router.push(message.href);
  };

  // Filter messages by search query
  const filteredMessages = messages.filter(m => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return m.name.toLowerCase().includes(query) || 
           m.username.toLowerCase().includes(query) ||
           m.lastMessage.toLowerCase().includes(query);
  });

  // Group messages by pinned/favorites
  const pinnedMessages = filteredMessages.filter(m => m.isPinned || m.isFavorite);
  const regularMessages = filteredMessages.filter(m => !m.isPinned && !m.isFavorite);

  return (
    <div className="flex flex-col h-full bg-[var(--bg-app)]">
      {/* Header */}
      <div className="flex flex-col px-5 bg-[var(--bg-app)] sticky top-0 z-10 pt-safe">
        <div className="flex items-center justify-between pt-4 pb-3">
          {showSearch ? (
            <div className="flex-1 flex items-center gap-3">
              <button 
                onClick={() => {
                  setShowSearch(false);
                  setSearchQuery("");
                }}
                className="p-2 -ml-2 rounded-full hover:bg-[var(--bg-hover)] transition-colors active:scale-95"
              >
                <ChevronLeft className="w-6 h-6 text-[var(--text-primary)]" />
              </button>
              <input
                type="text"
                placeholder={gt("Search conversations...")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
                className="flex-1 bg-[var(--bg-card)] border-0 rounded-xl px-4 py-2.5 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] text-base focus:outline-none focus:ring-2 focus:ring-[var(--app-accent)]/50"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="p-2 rounded-full hover:bg-[var(--bg-hover)] transition-colors active:scale-95"
                >
                  <X className="w-5 h-5 text-[var(--text-muted)]" />
                </button>
              )}
            </div>
          ) : (
            <>
              <h1 className="text-3xl font-bold text-[var(--text-primary)] tracking-tight">{gt("Messages")}</h1>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setShowSearch(true)}
                  className="p-2.5 rounded-full bg-[var(--bg-card)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-all active:scale-95"
                >
                  <Search className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setShowGroupPicker(true)}
                  className="p-2.5 rounded-full bg-[var(--bg-card)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-all active:scale-95"
                  aria-label={gt("New Group DM")}
                  title={gt("New Group DM")}
                >
                  <MessageSquarePlus className="w-5 h-5" />
                </button>
                <button 
                  onClick={onAddFriend}
                  className="p-2.5 rounded-full bg-[var(--bg-card)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-all active:scale-95"
                >
                  <UserPlus className="w-5 h-5" />
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Pinned/Favorites Section */}
      {pinnedMessages.length > 0 && (
        <div className="px-5 py-3 border-b border-[var(--border-subtle)]">
          <h2 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest mb-3 flex items-center gap-2">
            <Star className="w-3.5 h-3.5" />
            {gt("Favorites")}
          </h2>
          <div className="flex items-center gap-4 overflow-x-auto pb-2 scrollbar-hide -mx-1 px-1">
            {pinnedMessages.map((message) => (
              <button
                key={message.id}
                onClick={() => handleMessageClick(message)}
                className="flex flex-col items-center gap-2 min-w-[72px] group"
              >
                <div className="relative transform transition-transform duration-150 group-active:scale-90">
                  {message.type === "group" && message.avatars ? (
                    <div className="w-16 h-16 rounded-2xl bg-[var(--bg-card)] relative overflow-hidden ring-2 ring-transparent group-focus:ring-[var(--app-accent)] transition-all">
                      <Avatar className="w-9 h-9 absolute top-1 left-1 border-2 border-[var(--bg-app)]">
                        <AvatarImage src={cdnImage(message.avatars[0])} />
                        <AvatarFallback className="bg-[var(--app-accent)]">
                          {message.name.charAt(0)}
                        </AvatarFallback>
                      </Avatar>
                      {message.avatars[1] && (
                        <Avatar className="w-9 h-9 absolute bottom-1 right-1 border-2 border-[var(--bg-app)]">
                          <AvatarImage src={cdnImage(message.avatars[1])} />
                          <AvatarFallback className="bg-[#6366F1]">+</AvatarFallback>
                        </Avatar>
                      )}
                    </div>
                  ) : (
                    <Avatar className="w-16 h-16 rounded-2xl ring-2 ring-transparent group-focus:ring-[var(--app-accent)] transition-all">
                      <AvatarImage src={cdnImage(message.avatar)} />
                      <AvatarFallback className="bg-gradient-to-br from-[var(--app-accent)] to-[var(--app-accent)] text-white text-xl font-semibold">
                        {message.name.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  )}
                  {message.isFavorite && (
                    <div className="absolute -top-1 -right-1 w-5 h-5 bg-[#F59E0B] rounded-full flex items-center justify-center border-2 border-black shadow-lg">
                      <Star className="w-3 h-3 text-white fill-white" />
                    </div>
                  )}
                  <div
                    className="absolute bottom-0 right-0 w-4 h-4 rounded-full border-[3px] border-[var(--bg-app)]"
                    style={{ backgroundColor: statusColors[message.status || "offline"] }}
                  />
                </div>
                <span className="text-xs font-medium text-[var(--text-muted)] truncate max-w-[72px] group-hover:text-[var(--text-primary)] transition-colors">
                  {message.name.split(" ")[0]}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Messages List */}
      <div 
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto overscroll-contain"
        {...pullHandlers}
      >
        <PullIndicator distance={pullDistance} refreshing={isRefreshing} />
        <div className="px-3 pb-28 pt-2">
          {isLoading ? (
            <div className="space-y-3 p-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 p-2">
                  <div className="w-12 h-12 rounded-full bg-[var(--bg-card)] animate-pulse" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-28 rounded bg-[var(--bg-card)] animate-pulse" />
                    <div className="h-3 w-48 rounded bg-[var(--bg-card)] animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredMessages.length === 0 && searchQuery ? (
            <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
              <div className="w-16 h-16 rounded-2xl bg-[var(--bg-card)] flex items-center justify-center mb-4">
                <Search className="w-8 h-8 text-[var(--text-muted)]" />
              </div>
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-1">{gt("No results")}</h3>
              <p className="text-[var(--text-muted)] text-sm">
                {gt("Try searching for something else")}
              </p>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
              <div className="w-20 h-20 rounded-3xl bg-[var(--bg-card)] flex items-center justify-center mb-6">
                <UserPlus className="w-10 h-10 text-[var(--text-muted)]" />
              </div>
              <h3 className="text-xl font-bold text-[var(--text-primary)] mb-2">{gt("No messages yet")}</h3>
              <p className="text-[var(--text-muted)] text-base mb-6 max-w-[280px]">
                {gt("Start a conversation by adding friends or joining a server")}
              </p>
              <button 
                onClick={onAddFriend}
                className="px-8 py-3.5 bg-[var(--app-accent)] hover:opacity-90 text-white font-bold rounded-2xl transition-all active:scale-95 shadow-lg"
              >
                {gt("Find Friends")}
              </button>
            </div>
          ) : (
            <div className="space-y-0.5">
              {regularMessages.map((message, index) => {
                const unread = isChannelUnread(message.id);
                return (
                <button
                  key={`${message.recipientId}-${index}`}
                  onClick={() => handleMessageClick(message)}
                  className={cn(
                    "w-full flex items-center gap-4 px-3 py-3.5 rounded-2xl transition-all duration-150",
                    "hover:bg-[var(--bg-hover)]/60 active:bg-[var(--bg-hover)] active:scale-[0.98]"
                  )}
                >
                  {/* Avatar with status */}
                  <div className="relative flex-shrink-0">
                    {message.type === "group" && message.avatars ? (
                      <div className="w-12 h-12 rounded-full bg-[var(--bg-card)] relative">
                        <Avatar className="w-7 h-7 absolute top-0 left-0 ring-2 ring-[var(--bg-app)]">
                          <AvatarImage src={cdnImage(message.avatars[0])} />
                          <AvatarFallback className="bg-[var(--app-accent)] text-[10px]">
                            {message.name.charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                        {message.avatars[1] && (
                          <Avatar className="w-7 h-7 absolute bottom-0 right-0 ring-2 ring-[var(--bg-app)]">
                            <AvatarImage src={cdnImage(message.avatars[1])} />
                            <AvatarFallback className="bg-[#6366F1] text-[10px]">+</AvatarFallback>
                          </Avatar>
                        )}
                      </div>
                    ) : (
                      <Avatar className="w-12 h-12">
                        <AvatarImage src={cdnImage(message.avatar)} />
                        <AvatarFallback className="bg-gradient-to-br from-[var(--app-accent)] to-[var(--app-accent)] text-white text-base font-semibold">
                          {message.name.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    )}
                    {/* Status indicator */}
                    {message.type !== "group" && (
                    <div
                      className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full ring-[3px] ring-[var(--bg-app)]"
                      style={{ backgroundColor: statusColors[message.status || "offline"] }}
                    />
                    )}
                  </div>
                  
                  <div className="flex-1 min-w-0 text-left">
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn(
                        "text-[17px] truncate leading-tight text-[var(--text-primary)]",
                        unread ? "font-bold" : "font-semibold"
                      )}>
                        {message.name}
                      </span>
                      <span className={cn(
                        "text-xs flex-shrink-0",
                        unread ? "text-[var(--app-accent)] font-medium" : "text-[var(--text-muted)]"
                      )}>
                        {message.timestamp}
                      </span>
                    </div>
                    <p className={cn(
                      "text-[15px] line-clamp-2 break-words leading-snug mt-0.5",
                      unread ? "text-[var(--text-secondary)]" : "text-[var(--text-muted)]"
                    )}>
                      {message.lastMessage}
                    </p>
                  </div>

                  {/* Unread badge — accent count pill, falling back to a dot. */}
                  {(() => {
                    const count = getMentionCount(message.id);
                    if (count > 0) {
                      return (
                        <span className="min-w-[20px] h-5 px-1.5 flex-shrink-0 flex items-center justify-center rounded-full bg-[var(--app-accent)] text-[11px] font-bold text-[var(--text-on-accent)] leading-none shadow-lg">
                          {count > 99 ? "99+" : count}
                        </span>
                      );
                    }
                    return unread ? (
                      <span className="w-2.5 h-2.5 flex-shrink-0 bg-[var(--app-accent)] rounded-full shadow-lg" />
                    ) : null;
                  })()}
                </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <MountWhenOpened open={showGroupPicker}>
        <GroupDmPickerDialog open={showGroupPicker} onOpenChange={setShowGroupPicker} mode="create" />
      </MountWhenOpened>
    </div>
  );
}
