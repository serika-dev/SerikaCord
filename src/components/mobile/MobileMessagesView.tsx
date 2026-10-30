"use client";

import { sharedGet } from "@/lib/bootFetch";
import { memo, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { UserPlus, Star, RefreshCw, Search, X, ChevronLeft, MessageSquarePlus, Inbox } from "lucide-react";
import { seedMessageRequestCount, useMessageRequests } from "@/lib/social/messageRequestsStore";
import dynamic from "next/dynamic";
import { MountWhenOpened } from "@/components/ui/MountWhenOpened";

const GroupDmPickerDialog = dynamic(() => import("@/components/dm/GroupDmPickerDialog").then((m) => m.GroupDmPickerDialog), { ssr: false });
import { cn, cdnImage } from "@/lib/utils";
import { useGT } from "gt-next";
import { useStreamerHides } from "@/hooks/useStreamerMode";
import { useUnreadGetter, useUnreadSelector, type DmSeed } from "@/contexts/UnreadContext";
import { parseRowBadges, reuseRows, rowBadgeKey, type DmListRow } from "@/lib/mobile/dmList";
import { notificationPreview } from "@/lib/notifications/notify";
import { groupDmHref } from "@/lib/chat/groupDm";
import { groupDisplayName } from "@/lib/chat/dmCall";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { PullIndicator } from "@/components/mobile/PullIndicator";
import { useLongPress } from "@/components/mobile/useLongPress";
import { Bone } from "@/components/mobile/Bone";
import { useAuth } from "@/contexts/AuthContext";
import { previewEncryptedMessage, type EncryptedPreviewInput } from "@/lib/e2ee/client/previews";
import { useE2ee } from "@/hooks/useE2ee";
import { getRelationships } from "@/lib/social/relationshipsStore";
import { isBlockedAuthor } from "@/lib/chat/blocked";
import { useResilientStream } from "@/hooks/useStreamRevive";
import { StatusBadge } from "@/components/user/StatusBadge";
import { prefetchChannelMessages } from "@/hooks/useChatSession";
import { conversationApiBase } from "@/lib/mobile/pager";
import { useMobileShell } from "./MobileShellContext";

const MobileDmSheet = dynamic(() => import("@/components/mobile/MobileDmSheet").then((m) => m.MobileDmSheet), { ssr: false });

type Message = DmListRow;

interface MobileMessagesViewProps {
  onAddFriend?: () => void;
}

/**
 * The last list shown (per account), so opening the Messages tab again paints
 * the rows at once while the list refreshes, instead of a skeleton until
 * /api/dms answers.
 */
let lastList: { uid: string; rows: Message[] } | null = null;

/** An encrypted last message to decrypt on this device for its row. */
interface EncryptedRowJob {
  rowId: string;
  input: EncryptedPreviewInput;
  /** 1:1 DM: the other person (the channel must be exactly the two of you). */
  dmPeer: string | null;
  names: Record<string, string>;
}

/** Newest rows first, a few at a time: never a burst of key requests, never blocking the list. */
async function decryptRowPreviews(
  jobs: EncryptedRowJob[],
  selfId: string,
  labels: { attachment: string; sticker: string; spoiler: string },
  onResult: (rowId: string, text: string) => void,
  /** A row that couldn't be decrypted (yet): tried again once keys are ready. */
  onMiss?: () => void,
): Promise<void> {
  for (let i = 0; i < jobs.length; i += 6) {
    await Promise.all(jobs.slice(i, i + 6).map(async (job) => {
      const p = await previewEncryptedMessage(job.input, selfId, { dmPeer: job.dmPeer, labels, names: { users: job.names }, max: 120 });
      if (p) onResult(job.rowId, p.text);
      else onMiss?.();
    }));
  }
}

export function MobileMessagesView({ onAddFriend }: MobileMessagesViewProps) {
  const messageRequests = useMessageRequests();
  const router = useRouter();
  const shell = useMobileShell();
  const gt = useGT();
  // Streamer Mode hides what people wrote.
  const hidePreviews = useStreamerHides("notifications");
  // Unread state narrowly: re-render when a row's badge changes, not on every
  // message anywhere (useUnread()); functions are read through the getter.
  const getUnread = useUnreadGetter();
  const { user } = useAuth();
  const selfId = user?.id ?? null;
  const selfName = user?.displayName || user?.username || "";
  // Decrypted previews by `<channel>|<message>` (memory only): a list refresh
  // shows them at once instead of flashing the placeholder.
  const decryptedPreviewsRef = useRef(new Map<string, string>());
  // Some encrypted preview couldn't be decrypted (keys not ready / unreachable).
  const previewMissRef = useRef(false);
  const [messages, setMessages] = useState<Message[]>(() => (lastList && lastList.uid === selfId ? lastList.rows : []));
  const [isLoading, setIsLoading] = useState(() => !(lastList && lastList.uid === selfId));
  useEffect(() => {
    if (selfId && !isLoading) lastList = { uid: selfId, rows: messages };
  }, [selfId, messages, isLoading]);
  const badgeKey = useUnreadSelector((u) => rowBadgeKey(u, messages));
  const badges = useMemo(() => parseRowBadges(badgeKey), [badgeKey]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [showGroupPicker, setShowGroupPicker] = useState(false);
  const [sheetMessage, setSheetMessage] = useState<Message | null>(null);
  const rowPress = useLongPress<Message>(setSheetMessage);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // Live updates are applied in place; a full list fetch is debounced and
  // only needed for rows we don't have (or after a reconnect / resume).
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchRef = useRef<(fresh?: boolean) => Promise<void>>(async () => {});
  // Bumped by every in-place update: a list fetch that raced one refetches.
  const liveEditsRef = useRef(0);
  const scheduleRefetch = useCallback(() => {
    if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
    refetchTimerRef.current = setTimeout(() => {
      refetchTimerRef.current = null;
      void fetchRef.current(true);
    }, 250);
  }, []);
  useEffect(() => () => {
    if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
  }, []);

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

  // `fresh`: bypass the shared/boot GET (sharedGet may hand back a request
  // that started before the event we're refetching for).
  const fetchMessages = useCallback(async (fresh = false) => {
    const issuedAt = Date.now();
    const editsAtStart = liveEditsRef.current;
    try {
      const response = fresh
        ? await fetch("/api/dms", { credentials: "include", cache: "no-store" })
        : await sharedGet("/api/dms");
      if (response.ok) {
        const data = await response.json();
        if (typeof data.messageRequestCount === "number") seedMessageRequestCount(data.messageRequestCount);
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
          lastMessage?: { id?: string; content?: string; authorId?: string; createdAt?: string; encrypted?: boolean; e2ee?: unknown } | null;
          updatedAt?: string;
        };
        // End-to-end encrypted last messages: a placeholder now, the real text
        // once this device decrypted it (the server never sees it).
        const encryptedJobs: EncryptedRowJob[] = [];
        const blocked = getRelationships().blocked;
        const encryptedPreview = (channel: ListChannel, recipients: ListRecipient[], dmPeer: string | null): string | null => {
          const last = channel.lastMessage;
          if (!last?.encrypted) return null;
          const known = last.id ? decryptedPreviewsRef.current.get(`${channel.id}|${last.id}`) : undefined;
          if (known) return known;
          const authorId = String(last.authorId ?? "");
          if (selfId && last.id && authorId && last.e2ee && !isBlockedAuthor(authorId.toLowerCase(), blocked)) {
            const names: Record<string, string> = { [selfId]: selfName };
            for (const r of recipients) names[r.id] = r.displayName || r.username || "";
            encryptedJobs.push({
              rowId: channel.id,
              input: { id: last.id, channelId: channel.id, authorId, createdAt: last.createdAt, e2ee: last.e2ee },
              dmPeer,
              names,
            });
          }
          return gt("Encrypted message");
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
              lastMessage: encryptedPreview(channel, recipients, null) ?? (channel.lastMessage?.content || gt("{count} Members", { count: recipients.length + 1 })),
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
              lastMessage: encryptedPreview(channel, recipients, recipientId)
                ?? (notificationPreview(channel.lastMessage?.content, 120, data.mentionNames) || gt("Start a conversation")),
              timestamp: formatTimestamp(channel.updatedAt || ""),
              status: recipient.status || "offline",
            });
          }
        });

        // Keep the server's newest-first order across DMs and groups.
        const order = new Map(((data.channels || []) as ListChannel[]).map((c, i) => [c.id, i]));
        const list = [...seenRecipients.values(), ...groups].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
        setMessages((prev) => reuseRows(prev, list));
        // A live update landed while this request was out: it may predate it.
        if (liveEditsRef.current !== editsAtStart) scheduleRefetch();
        if (selfId && encryptedJobs.length > 0) {
          const kept = new Set(list.map((m) => m.id));
          void decryptRowPreviews(
            encryptedJobs.filter((j) => kept.has(j.rowId)),
            selfId,
            { attachment: gt("📎 Attachment"), sticker: gt("Sticker"), spoiler: gt("Spoiler") },
            (rowId, text) => {
              const job = encryptedJobs.find((j) => j.rowId === rowId);
              if (job) {
                const cache = decryptedPreviewsRef.current;
                cache.set(`${rowId}|${job.input.id}`, text);
                if (cache.size > 300) cache.delete(cache.keys().next().value!);
              }
              setMessages((prev) => prev.map((m) => (m.id === rowId ? { ...m, lastMessage: text } : m)));
            },
            () => { previewMissRef.current = true; },
          );
        }
        // Feed the unread engine so DM rows light up cross-device: the newest
        // message (its own time / author) plus the server's unread counts.
        getUnread().registerChannels(
          (data.channels || []).map((c: DmSeed) => ({
            id: c.id,
            type: "dm" as const,
            lastMessageAt: c.lastMessage?.createdAt ?? null,
            lastMessageId: c.lastMessage?.id ?? null,
            lastMessageAuthorId: c.lastMessage?.authorId ?? null,
          }))
        );
        getUnread().seedDmChannels((data.channels || []) as DmSeed[], issuedAt);
      }
    } catch (error) {
      console.error("Failed to fetch messages:", error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [formatTimestamp, getUnread, selfId, selfName, scheduleRefetch]);

  useEffect(() => {
    fetchRef.current = fetchMessages;
  }, [fetchMessages]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  // This device's keys became usable (first sign-in, PIN / link restore) or a
  // key set changed: previews that couldn't be decrypted yet get another go.
  const e2ee = useE2ee();
  const e2eeReadyRef = useRef<string | null>(null);
  useEffect(() => {
    const sig = `${e2ee.phase}|${e2ee.keysVersion}|${e2ee.pinsVersion}`;
    const previous = e2eeReadyRef.current;
    e2eeReadyRef.current = sig;
    if (previous === null || previous === sig || e2ee.phase !== "ready" || !previewMissRef.current) return;
    previewMissRef.current = false;
    scheduleRefetch();
  }, [e2ee.phase, e2ee.keysVersion, e2ee.pinsVersion, scheduleRefetch]);

  // A DM message (any author, any device) bumps its row to the top with the
  // new preview, without refetching the whole list.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyListUpdate = (data: any) => {
    const channelId = String(data.channelId ?? "");
    const msg = data.message as
      | { id?: string; content?: string; authorId?: string; createdAt?: string; encrypted?: boolean; e2ee?: unknown }
      | undefined;
    if (!channelId || !msg?.id) {
      // No message (e.g. a request was accepted): the row may be new.
      scheduleRefetch();
      return;
    }
    const authorId = msg.authorId ? String(msg.authorId) : "";
    const createdAt = typeof msg.createdAt === "string" ? msg.createdAt : new Date().toISOString();
    if (authorId) getUnread().notifyDmActivity(channelId, createdAt, msg.id, authorId);
    const row = messages.find((m) => m.id === channelId);
    if (!row) {
      scheduleRefetch();
      return;
    }
    let preview: string;
    if (msg.encrypted) {
      preview = decryptedPreviewsRef.current.get(`${channelId}|${msg.id}`) ?? gt("Encrypted message");
      if (selfId && authorId && msg.e2ee && !isBlockedAuthor(authorId.toLowerCase(), getRelationships().blocked)) {
        const names: Record<string, string> = { [selfId]: selfName };
        if (row.type === "dm") names[row.recipientId] = row.name;
        const messageId = msg.id;
        void decryptRowPreviews(
          [{
            rowId: channelId,
            input: { id: messageId, channelId, authorId, createdAt, e2ee: msg.e2ee },
            dmPeer: row.type === "dm" ? row.recipientId : null,
            names,
          }],
          selfId,
          { attachment: gt("📎 Attachment"), sticker: gt("Sticker"), spoiler: gt("Spoiler") },
          (rowId, text) => {
            const cache = decryptedPreviewsRef.current;
            cache.set(`${rowId}|${messageId}`, text);
            if (cache.size > 300) cache.delete(cache.keys().next().value!);
            setMessages((prev) => prev.map((m) => (m.id === rowId ? { ...m, lastMessage: text } : m)));
          },
          () => { previewMissRef.current = true; },
        );
      }
    } else {
      preview = notificationPreview(msg.content, 120) || row.lastMessage;
    }
    liveEditsRef.current += 1;
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === channelId);
      if (idx === -1) return prev;
      const updated: Message = { ...prev[idx], lastMessage: preview, timestamp: formatTimestamp(createdAt) };
      return [updated, ...prev.slice(0, idx), ...prev.slice(idx + 1)];
    });
  };

  // DM list stream. Self-healing (src/hooks/useStreamRevive.ts): reconnects at
  // once when the phone wakes the page, replaces silent half-open connections,
  // and refetches whatever was sent while it was down.
  useResilientStream("/api/dms/stream", {
    onOpen: ({ reconnect }) => {
      if (reconnect) scheduleRefetch();
    },
    onResume: ({ reconnecting, hiddenForMs }) => {
      // Reconnecting: onOpen refetches. Back after a while: refresh the list
      // (also brings the relative timestamps up to date).
      if (!reconnecting && hiddenForMs >= 15_000) scheduleRefetch();
    },
    onMessage: (data) => {
      if (data.type === "dm:list:update") {
        applyListUpdate(data);
      } else if (data.type === "group:remove") {
        const channelId = String(data.channelId ?? "");
        liveEditsRef.current += 1;
        setMessages((prev) => prev.filter((m) => m.id !== channelId));
      } else if (data.type === "group:update") {
        // Group rows need member names / avatars: rebuild from the server.
        scheduleRefetch();
      }
    },
  });

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    await fetchMessages(true);
  }, [fetchMessages, isRefreshing]);
  const { pullDistance, pullHandlers } = usePullToRefresh(scrollContainerRef, handleRefresh);

  /** Warm the conversation's message cache as the finger lands. */
  const warmConversation = useCallback((message: Message) => {
    const apiBase = conversationApiBase(message.href);
    if (apiBase) void prefetchChannelMessages(apiBase);
  }, []);
  const openConversation = useCallback((message: Message) => {
    // The request starts before any rendering (a click without a touch or
    // hover first, e.g. keyboard or an emulator, never warmed it).
    warmConversation(message);
    // Phone shell: the conversation slides in on the same page.
    if (shell) shell.open(message.href);
    else router.push(message.href);
  }, [shell, router, warmConversation]);
  const handleMessageClick = (message: Message) => {
    if (rowPress.wasLongPress()) return;
    openConversation(message);
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
      <div className="theme-solid flex flex-col px-5 bg-[var(--bg-app)] sticky top-0 z-10 pt-safe">
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
              <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">{gt("Messages")}</h1>
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

      {/* Message Requests (DMs from people you aren't friends with) */}
      {messageRequests.count > 0 && (
        <button
          onClick={() => router.push("/channels/me?tab=requests")}
          className="mx-5 mt-3 flex items-center gap-3 px-4 py-3 rounded-2xl bg-[var(--bg-card)] text-left active:scale-[0.99] transition-transform"
        >
          <Inbox className="w-5 h-5 text-[var(--text-secondary)] shrink-0" />
          <span className="flex-1 min-w-0 truncate font-medium text-[var(--text-primary)]">{gt("Message Requests")}</span>
          <span className="shrink-0 min-w-[20px] h-5 px-1.5 flex items-center justify-center rounded-full bg-[var(--app-accent)] text-xs font-bold text-[var(--text-on-accent)]">
            {messageRequests.count > 99 ? "99+" : messageRequests.count}
          </span>
        </button>
      )}

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
                onTouchStartCapture={() => warmConversation(message)}
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
                  <StatusBadge status={message.status} size={12} ring={3} ringColor="var(--app-bg-solid)" className="absolute bottom-0 right-0" />
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
        <div className="px-2 pt-1" style={{ paddingBottom: "calc(var(--mobile-content-pb) + 4.5rem)" }}>
          {isLoading ? (
            <div className="space-y-1 px-1 pt-1">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-2 py-2">
                  <Bone className="h-10 w-10 shrink-0 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Bone className="h-3.5" style={{ width: `${30 + ((i * 17) % 35)}%` }} />
                    <Bone className="h-3" style={{ width: `${50 + ((i * 11) % 40)}%` }} />
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
              {regularMessages.map((message) => (
                <DmRow
                  key={message.id}
                  message={message}
                  unread={badges.get(message.id)?.unread ?? false}
                  mentionCount={badges.get(message.id)?.mentions ?? 0}
                  hidePreview={hidePreviews}
                  onOpen={openConversation}
                  onWarm={warmConversation}
                  onLongPress={setSheetMessage}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      <MountWhenOpened open={!!sheetMessage}>
        {sheetMessage && (
          <MobileDmSheet
            conversation={sheetMessage}
            onClose={() => setSheetMessage(null)}
          />
        )}
      </MountWhenOpened>
      <MountWhenOpened open={showGroupPicker}>
        <GroupDmPickerDialog open={showGroupPicker} onOpenChange={setShowGroupPicker} mode="create" />
      </MountWhenOpened>
    </div>
  );
}

interface DmRowProps {
  message: Message;
  unread: boolean;
  mentionCount: number;
  hidePreview: boolean;
  onOpen: (message: Message) => void;
  onWarm: (message: Message) => void;
  onLongPress: (message: Message) => void;
}

/**
 * One conversation row. Memoized: opening a conversation, a badge or a new
 * message elsewhere re-renders only the rows whose content or badge changed.
 */
const DmRow = memo(function DmRow({ message, unread, mentionCount, hidePreview, onOpen, onWarm, onLongPress }: DmRowProps) {
  const press = useLongPress<Message>(onLongPress);
  return (
    <button
      type="button"
      {...press.bind(message)}
      onTouchStartCapture={() => onWarm(message)}
      onPointerEnter={() => onWarm(message)}
      onClick={() => {
        if (press.wasLongPress()) return;
        onOpen(message);
      }}
      className={cn(
        "w-full flex items-center gap-3 px-2 py-2 rounded-lg select-none touch-manipulation transition-colors duration-100",
        "active:bg-[var(--bg-hover)]"
      )}
    >
      {/* Avatar with status */}
      <div className="relative flex-shrink-0">
        {message.type === "group" && message.avatars ? (
          <div className="w-10 h-10 rounded-full bg-[var(--bg-card)] relative">
            <Avatar className="w-6 h-6 absolute top-0 left-0 ring-2 ring-[var(--bg-app)]">
              <AvatarImage src={cdnImage(message.avatars[0])} />
              <AvatarFallback className="bg-[var(--app-accent)] text-[10px]">
                {message.name.charAt(0)}
              </AvatarFallback>
            </Avatar>
            {message.avatars[1] && (
              <Avatar className="w-6 h-6 absolute bottom-0 right-0 ring-2 ring-[var(--bg-app)]">
                <AvatarImage src={cdnImage(message.avatars[1])} />
                <AvatarFallback className="bg-[#6366F1] text-[10px]">+</AvatarFallback>
              </Avatar>
            )}
          </div>
        ) : (
          <Avatar className="w-10 h-10">
            <AvatarImage src={cdnImage(message.avatar)} />
            <AvatarFallback className="bg-gradient-to-br from-[var(--app-accent)] to-[var(--app-accent)] text-white text-base font-semibold">
              {message.name.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        )}
        {/* Status indicator */}
        {message.type !== "group" && (
        <StatusBadge status={message.status} size={12} ring={3} ringColor="var(--app-bg-solid)" corner />
        )}
      </div>

      <div className="flex-1 min-w-0 text-left">
        <div className="flex items-center justify-between gap-2">
          <span className={cn(
            "text-[16px] truncate leading-tight text-[var(--text-primary)]",
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
          "text-[14px] truncate leading-snug mt-0.5",
          unread ? "text-[var(--text-secondary)]" : "text-[var(--text-muted)]"
        )}>
          {hidePreview ? "" : message.lastMessage}
        </p>
      </div>

      {/* Unread badge — accent count pill, falling back to a dot. */}
      {mentionCount > 0 ? (
        <span className="min-w-[20px] h-5 px-1.5 flex-shrink-0 flex items-center justify-center rounded-full bg-[var(--app-accent)] text-[11px] font-bold text-[var(--text-on-accent)] leading-none shadow-lg">
          {mentionCount > 99 ? "99+" : mentionCount}
        </span>
      ) : unread ? (
        <span className="w-2.5 h-2.5 flex-shrink-0 bg-[var(--app-accent)] rounded-full shadow-lg" />
      ) : null}
    </button>
  );
});
