"use client";

/**
 * Real-time unread + mention tracking for the whole app.
 *
 * Drives: channel "glow" (bold white text) when there's unread activity, the
 * mention badge + count, desktop notifications / toasts / sounds for messages
 * outside the conversation on screen, server-level unread/mention aggregation
 * for the server rail, the Inbox "Unreads" list, and the "(n)" tab title /
 * favicon dot / app badge.
 *
 * The rules live in a pure reducer (`src/lib/unread/engine.ts`, tested event
 * by event); this provider only feeds it: startup seeds (`/@me/read-states`,
 * `/@me/channel-activity`, `/@me/mentions`, `/api/dms`), the
 * `/api/users/@me/activity` stream (messages, cross-device read markers,
 * deletions), the DM list stream, and the open conversation's acks. Every
 * (re)connect re-seeds, so a dropped stream never leaves stale badges.
 *
 * Reading: opening a conversation does NOT mark it read. The chat list acks
 * the exact newest message once the user has actually seen it (page visible,
 * window focused or touched within the last minute, scrolled to the bottom)
 * via `markChannelRead(id, message)`.
 */

import { getRelationships, refreshRelationships } from "@/lib/social/relationshipsStore";
import { receiveUserNote } from "@/lib/social/notesStore";
import { refreshMessageRequests } from "@/lib/social/messageRequestsStore";
import { isBlockedAuthor } from "@/lib/chat/blocked";
import { sharedGet } from "@/lib/bootFetch";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useGT } from "gt-next";
import { emitCallEvent, type CallEvent, type CallMissed } from "@/lib/chat/dmCall";
import { useAuth } from "@/contexts/AuthContext";
import { setUnreadBadge, isNotifyAllMessages } from "@/lib/services/notificationUX";
import { decideMessageAlert, resolveNotification } from "@/lib/notifications/levels";
import {
  applyRemoteNotificationSettings,
  isMentionCounted,
  loadNotificationPrefs,
  useNotificationPrefs,
} from "@/lib/notifications/prefsStore";
import {
  clearConversationNotifications,
  notificationPreview,
  notifyIncomingMessage,
} from "@/lib/notifications/notify";
import { recordMissedCall } from "@/lib/notifications/missedCalls";
import { navigateToMessage } from "@/lib/notifications/events";
import { refreshMentionsNow } from "@/hooks/useMentions";
import type { MentionNames } from "@/lib/chat/mentionText";
import {
  badgeCount,
  hasUnread,
  isCaughtUp,
  isMessageRead,
  readMarkerOf,
  summarize,
  titleBadgeCount,
  toMs,
  type SeedConversation,
} from "@/lib/unread/engine";
import { decideLiveMessage } from "@/lib/unread/live";
import {
  dispatchUnread,
  dispatchUnreadBatch,
  getServerUnreadState,
  getUnreadState,
  setMentionFeed,
  subscribeUnread,
} from "@/lib/unread/store";
import { isReadingLive } from "@/lib/unread/attentionTracker";
import { groupDmHref } from "@/lib/chat/groupDm";
import { emitThreadsChanged } from "@/lib/chat/threadPanelStore";

interface ActivityEvent {
  type: "channel_activity";
  serverId: string;
  channelId: string;
  channelName?: string;
  messageId: string;
  authorId: string;
  authorName?: string;
  authorAvatar?: string | null;
  mentionedUserIds: string[];
  mentionEveryone: boolean;
  /** This user holds a mentioned role (resolved server-side). */
  mentionedRole?: boolean;
  preview?: string;
  /** Names for mention markup in `preview`. */
  mentionNames?: MentionNames;
  parentId?: string | null;
  createdAt: string;
}

export interface ChannelMeta {
  id: string;
  serverId?: string;
  type?: string;
  lastMessageAt?: string | null;
  /** Newest message id / author, when known (own newest message = read). */
  lastMessageId?: string | null;
  lastMessageAuthorId?: string | null;
  /** Display name (channel name, or the other person for DMs). */
  name?: string;
  /** Category / forum parent, for inherited notification settings. */
  parentId?: string | null;
  /** Where the conversation opens (DMs; channels derive it from serverId). */
  href?: string;
  avatar?: string | null;
}

/** One DM / group DM from `/api/dms`, for seeding. */
export interface DmSeed {
  id: string;
  unreadCount?: number;
  updatedAt?: string | null;
  lastMessage?: { id?: string; authorId?: string; createdAt?: string | null } | null;
}

/** The read marker captured for a conversation (drives the "NEW" divider). */
export interface ReadMarkerSnapshot {
  lastReadAt: string | null;
  lastReadMessageId: string | null;
}

export interface UnreadChannelEntry {
  channelId: string;
  serverId?: string;
  name?: string;
  href: string;
  avatar?: string | null;
  lastMessageAt: string;
  mentions: number;
  isDM: boolean;
}

interface UnreadContextValue {
  isChannelUnread: (channelId: string) => boolean;
  getMentionCount: (channelId: string) => number;
  isServerUnread: (serverId: string) => boolean;
  getServerMentionCount: (serverId: string) => number;
  /** Muted channel / category / DM, or a channel in a muted server (dimmed, no glow). */
  isChannelMuted: (channelId: string) => boolean;
  /** Read marker for a conversation, as last known on this device. */
  getReadMarker: (channelId: string) => ReadMarkerSnapshot;
  /** Total unread DM messages across every DM/group channel (drives the mobile
   *  Messages tab badge). */
  totalDmUnreadCount: number;
  /** Total server mentions across every joined server (drives the mobile
   *  Notifications tab badge). */
  totalMentionCount: number;
  /** Unread, unmuted conversations, newest first (Inbox "Unreads"). */
  unreadChannels: UnreadChannelEntry[];
  /**
   * Mark a conversation read. With `upTo`, acks exactly that message (the
   * newest one the user saw); without it, everything known.
   */
  markChannelRead: (channelId: string, upTo?: { id: string; createdAt: string }) => void;
  /** Mark every channel in a server as read (clears unread pill + mention badges). */
  markServerRead: (serverId: string) => void;
  /** Mark several conversations read (a category, the whole Inbox). */
  markChannelsRead: (channelIds: string[]) => void;
  /** Mark every unread conversation read (DMs included). */
  markAllRead: () => void;
  /** Feed the sidebar's channel list so we know channel→server + last activity. */
  registerChannels: (channels: ChannelMeta[]) => void;
  /** Called when the user opens a conversation. Doesn't mark it read. */
  setActiveChannel: (channelId: string | null) => void;
  /** The thread open in the side panel next to the active channel (also on screen). */
  setActivePanelChannel: (channelId: string | null) => void;
  /**
   * Seed DMs from `/api/dms` (newest message + the server's unread count,
   * reconciled with what this device saw since `issuedAt`, local ms).
   */
  seedDmChannels: (channels: DmSeed[], issuedAt: number) => void;
  /**
   * A DM message arrived over the DM list stream (any author: your own
   * message from another device reads the conversation).
   */
  notifyDmActivity: (channelId: string, createdAt?: string, messageId?: string, authorId?: string) => void;
}

const UnreadContext = createContext<UnreadContextValue | undefined>(undefined);

interface DmActivityEvent {
  type: "dm_activity";
  channelId?: string;
  messageId?: string;
  authorId?: string;
  authorName?: string;
  authorAvatar?: string | null;
  preview?: string;
  mentionNames?: MentionNames;
  hasAttachments?: boolean;
  hasSticker?: boolean;
  createdAt?: string;
  /** A call log message: the incoming-call card already alerted the user. */
  isCall?: boolean;
  /** A group DM system row ("X added Y"): badge only, no notification. */
  isSystem?: boolean;
  /** Set for group DMs: notifications name the group and open its page. */
  group?: { channelId: string; name: string; icon?: string | null } | null;
}

// Message ids already alerted. A DM can reach us over both the activity
// stream and the DM-list stream; alert once. (Counting is idempotent in the
// engine — badges are kept by message id.)
const alertedMessageIds = new Set<string>();
function markAlerted(messageId: string | undefined): boolean {
  if (!messageId) return true;
  if (alertedMessageIds.has(messageId)) return false;
  alertedMessageIds.add(messageId);
  if (alertedMessageIds.size > 500) {
    const oldest = alertedMessageIds.values().next().value;
    if (oldest) alertedMessageIds.delete(oldest);
  }
  return true;
}

/** The conversation is on screen: the open channel or the thread beside it. */
function isOnScreenIn(
  main: { current: string | null },
  panel: { current: string | null },
  channelId: string,
): boolean {
  return main.current === channelId || panel.current === channelId;
}

function ancestorsOf(meta: Record<string, ChannelMeta>, channelId: string, parentId?: string | null): string[] {
  const out: string[] = [];
  let cur = parentId ?? meta[channelId]?.parentId ?? null;
  for (let i = 0; cur && i < 3; i++) {
    out.push(cur);
    cur = meta[cur]?.parentId ?? null;
  }
  return out;
}

/** Re-seed at most this often when the tab comes back (reconnects always do). */
const RESYNC_MIN_INTERVAL_MS = 30_000;
/** Server-channel types whose activity the channel-activity seed covers. */
const SEEDED_CHANNEL_TYPES = new Set(["text", "announcement"]);

function dmSeedToConversation(c: DmSeed, selfId: string | undefined): SeedConversation {
  const last = c.lastMessage ?? null;
  return {
    channelId: c.id,
    // The newest message's own time; `updatedAt` also moves on renames etc.
    lastMessageAt: last?.createdAt ?? null,
    lastMessageId: last?.id ?? null,
    lastMessageIsOwn: Boolean(selfId && last?.authorId && last.authorId === selfId),
    unread: typeof c.unreadCount === "number" ? c.unreadCount : 0,
  };
}

export function UnreadProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const gt = useGT();
  const router = useRouter();
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);
  const prefs = useNotificationPrefs();
  const prefsRef = useRef(prefs);
  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);
  const userRef = useRef(user);
  useEffect(() => {
    userRef.current = user;
  }, [user]);
  // Translated strings the stream handler needs (it lives outside render).
  const strings = useMemo(
    () => ({
      newMessage: gt("New message"),
      attachment: gt("📎 Attachment"),
      sticker: gt("Sticker"),
      view: gt("View"),
      someone: gt("Someone"),
      aChannel: gt("a channel"),
      many: (count: number) => gt("{count} new messages", { count }),
      mentionedYou: (name: string) => gt("{name} mentioned you", { name }),
      inChannel: (name: string, channel: string) => gt("{name} in {channel}", { name, channel }),
    }),
    [gt],
  );
  const stringsRef = useRef(strings);
  useEffect(() => {
    stringsRef.current = strings;
  }, [strings]);

  // The engine state (read markers, newest messages, badges).
  const unread = useSyncExternalStore(subscribeUnread, getUnreadState, getServerUnreadState);

  // channelId -> serverId (+ type) so we can aggregate per server and route toasts.
  const [channelMeta, setChannelMeta] = useState<Record<string, ChannelMeta>>({});
  const channelMetaRef = useRef(channelMeta);
  useEffect(() => {
    channelMetaRef.current = channelMeta;
  }, [channelMeta]);
  const activeChannelRef = useRef<string | null>(null);
  // A thread open in the side panel is on screen too.
  const activePanelChannelRef = useRef<string | null>(null);

  // Last message id POSTed per channel, so repeated acks of the same message
  // (scroll jitter, focus events) cost nothing.
  const postedAckRef = useRef<Record<string, string>>({});
  // Acks whose POST failed (offline, server restarting): retried on reconnect.
  const pendingAcksRef = useRef<Record<string, { channelId: string; messageId?: string }>>({});

  /** The conversation is fully read: its notification can go. */
  const afterRead = useCallback((channelId: string) => {
    if (isCaughtUp(getUnreadState(), channelId)) clearConversationNotifications(channelId);
  }, []);

  const postAck = useCallback((body: { channelId: string; messageId?: string }) => {
    delete pendingAcksRef.current[body.channelId];
    // Persist the ack so read state follows the user across devices. With a
    // message id it's exact; without one the server resolves the latest.
    void fetch("/api/users/@me/read-states", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((res) => {
        // 4xx won't get better by retrying; anything else will.
        if (!res.ok && res.status >= 500) pendingAcksRef.current[body.channelId] = body;
      })
      .catch(() => {
        pendingAcksRef.current[body.channelId] = body;
      });
  }, []);

  const flushPendingAcks = useCallback(() => {
    const pending = Object.values(pendingAcksRef.current);
    for (const body of pending) postAck(body);
  }, [postAck]);

  const markChannelRead = useCallback(
    (channelId: string, upTo?: { id: string; createdAt: string }) => {
      if (!channelId) return;
      if (upTo) {
        if (postedAckRef.current[channelId] === upTo.id) return;
        postedAckRef.current[channelId] = upTo.id;
        dispatchUnread({ type: "read", channelId, at: upTo.createdAt, messageId: upTo.id });
      } else {
        delete postedAckRef.current[channelId];
        dispatchUnread({ type: "read_all", channelId });
      }
      afterRead(channelId);
      postAck(upTo ? { channelId, messageId: upTo.id } : { channelId });
    },
    [afterRead, postAck],
  );

  const needsRead = useCallback((channelId: string) => {
    const s = getUnreadState();
    return hasUnread(s, channelId) || badgeCount(s, channelId) > 0;
  }, []);

  const markChannelsRead = useCallback(
    (channelIds: string[]) => {
      for (const id of channelIds) if (needsRead(id)) markChannelRead(id);
    },
    [markChannelRead, needsRead],
  );

  const markServerRead = useCallback(
    (serverId: string) => {
      if (!serverId) return;
      for (const [channelId, meta] of Object.entries(channelMetaRef.current)) {
        if (meta.serverId !== serverId) continue;
        // Only channels with something to clear: no POST storm for big servers.
        if (needsRead(channelId)) markChannelRead(channelId);
      }
    },
    [markChannelRead, needsRead],
  );

  const markAllRead = useCallback(() => {
    const s = getUnreadState();
    const ids = new Set([...Object.keys(s.activity), ...Object.keys(s.badges)]);
    for (const id of ids) if (needsRead(id)) markChannelRead(id);
  }, [markChannelRead, needsRead]);

  const setActiveChannel = useCallback((channelId: string | null) => {
    activeChannelRef.current = channelId;
  }, []);

  const setActivePanelChannel = useCallback((channelId: string | null) => {
    activePanelChannelRef.current = channelId;
  }, []);

  const registerChannels = useCallback((channels: ChannelMeta[]) => {
    if (channels.length === 0) return;
    setChannelMeta((prev) => {
      let metaChanged = false;
      const nextMeta = { ...prev };
      for (const ch of channels) {
        const existing = nextMeta[ch.id];
        const merged: ChannelMeta = {
          ...existing,
          ...ch,
          name: ch.name ?? existing?.name,
          parentId: ch.parentId !== undefined ? ch.parentId : existing?.parentId,
          href: ch.href ?? existing?.href,
          avatar: ch.avatar ?? existing?.avatar,
          serverId: ch.serverId ?? existing?.serverId,
          type: ch.type ?? existing?.type,
        };
        if (
          !existing ||
          existing.serverId !== merged.serverId ||
          existing.lastMessageAt !== merged.lastMessageAt ||
          existing.name !== merged.name ||
          existing.parentId !== merged.parentId ||
          existing.href !== merged.href ||
          existing.avatar !== merged.avatar ||
          existing.type !== merged.type
        ) {
          nextMeta[ch.id] = merged;
          metaChanged = true;
        }
      }
      return metaChanged ? nextMeta : prev;
    });
    // Seed the newest-message stamps so unread persists across reloads / new
    // devices. A conversation whose newest message is your own is read.
    const selfId = userRef.current?.id;
    const conversations: SeedConversation[] = [];
    for (const ch of channels) {
      if (!ch.lastMessageAt) continue;
      conversations.push({
        channelId: ch.id,
        lastMessageAt: ch.lastMessageAt,
        lastMessageId: ch.lastMessageId ?? null,
        lastMessageIsOwn: Boolean(selfId && ch.lastMessageAuthorId && ch.lastMessageAuthorId === selfId),
      });
    }
    if (conversations.length > 0) {
      dispatchUnread({ type: "seed_conversations", conversations });
      for (const c of conversations) if (c.lastMessageIsOwn) afterRead(c.channelId);
    }
  }, [afterRead]);

  const seedDmChannels = useCallback(
    (channels: DmSeed[], issuedAt: number) => {
      if (channels.length === 0) return;
      const selfId = userRef.current?.id;
      dispatchUnread({
        type: "seed_conversations",
        conversations: channels.map((c) => dmSeedToConversation(c, selfId)),
        issuedAt,
      });
    },
    [],
  );

  // Mentions (startup seed, the Inbox's poll): union into the badges,
  // honouring per-server "Nothing" and @everyone / role suppression.
  const seedMentions = useCallback(
    (mentions: Array<{ id: string; channelId: string; serverId?: string; createdAt: string; kind?: "user" | "role" | "everyone" }>) => {
      const muteEveryone = userRef.current?.settings?.notifications?.muteEveryone === true;
      const counted = mentions.filter((m) =>
        isMentionCounted({ serverId: m.serverId || null, channelId: m.channelId, kind: m.kind, muteEveryoneGlobally: muteEveryone }),
      );
      // Mentions are server channels: register them so they aggregate per
      // server (and aren't mistaken for DMs) before the sidebar has.
      const unknown = counted.filter((m) => m.serverId && !channelMetaRef.current[m.channelId]?.serverId);
      if (unknown.length > 0) {
        setChannelMeta((prev) => {
          const next = { ...prev };
          for (const m of unknown) next[m.channelId] = { ...next[m.channelId], id: m.channelId, serverId: m.serverId };
          return next;
        });
      }
      if (counted.length > 0) {
        dispatchUnread({ type: "seed_mentions", mentions: counted.map((m) => ({ id: m.id, channelId: m.channelId, createdAt: m.createdAt })) });
      }
    },
    [],
  );
  useEffect(() => {
    setMentionFeed(seedMentions);
    return () => setMentionFeed(null);
  }, [seedMentions]);

  const notifyDmActivity = useCallback(
    (channelId: string, createdAt?: string, messageId?: string, authorId?: string) => {
      const self = userRef.current?.id;
      if (!channelId || !self) return;
      const outcome = decideLiveMessage(getUnreadState(), {
        channelId,
        messageId: messageId ?? null,
        at: createdAt || new Date().toISOString(),
        authorId: authorId ?? null,
        selfId: self,
        isDM: true,
        mention: true,
        notify: false, // the activity stream's dm_activity alerts
        active: isOnScreenIn(activeChannelRef, activePanelChannelRef, channelId),
        readingLive: isReadingLive(),
      });
      if (outcome.event) dispatchUnread(outcome.event);
      afterRead(channelId);
    },
    [afterRead],
  );

  // Notification settings (levels, mutes) — server-side, cross-device.
  useEffect(() => {
    if (!user) return;
    void loadNotificationPrefs();
  }, [user]);

  // ── Seeds ──────────────────────────────────────────────────────────────

  // Every text channel the user can see in every server (not just the open
  // one) with its newest message, so the server-rail pill is right on load.
  const seedChannelActivity = useCallback(async () => {
    try {
      const res = await sharedGet("/api/users/@me/channel-activity");
      if (!res.ok) return;
      const data = (await res.json()) as {
        channels?: Array<{
          channelId: string;
          serverId: string;
          type?: string;
          name?: string;
          parentId?: string | null;
          lastMessageAt: string | null;
          lastMessageId?: string | null;
          lastMessageAuthorId?: string | null;
        }>;
      };
      const list = data.channels ?? [];
      registerChannels(
        list.map((c) => ({
          id: c.channelId,
          serverId: c.serverId,
          type: c.type ?? "text",
          name: c.name,
          parentId: c.parentId ?? null,
          lastMessageAt: c.lastMessageAt,
          lastMessageId: c.lastMessageId ?? null,
          lastMessageAuthorId: c.lastMessageAuthorId ?? null,
        })),
      );
      // Channels this device remembers but the user can no longer see (left
      // the server, lost access, deleted): stop them glowing.
      const visible = new Set(list.map((c) => c.channelId));
      const s = getUnreadState();
      const meta = channelMetaRef.current;
      const stale: string[] = [];
      for (const id of Object.keys(s.activity)) {
        const m = meta[id];
        if (!m?.serverId || visible.has(id)) continue;
        // Only kinds this seed lists (threads, forums etc. aren't in it).
        if (!m.type || !SEEDED_CHANNEL_TYPES.has(m.type)) continue;
        stale.push(id);
      }
      if (stale.length > 0) dispatchUnreadBatch(stale.map((channelId) => ({ type: "forget" as const, channelId })));
    } catch {
      /* best-effort seed — live activity events fill in the rest */
    }
  }, [registerChannels]);

  const seedMentionsFromApi = useCallback(async () => {
    try {
      const res = await sharedGet("/api/users/@me/mentions");
      if (!res.ok) return;
      const data = (await res.json()) as { mentions?: Array<{ id: string; channelId: string; serverId?: string; createdAt: string; kind?: "user" | "role" | "everyone" }> };
      seedMentions(data.mentions ?? []);
    } catch {
      /* best-effort seed */
    }
  }, [seedMentions]);

  const seedDms = useCallback(async () => {
    const issuedAt = Date.now();
    try {
      const res = await sharedGet("/api/dms");
      if (!res.ok) return;
      const data = (await res.json()) as { channels?: Array<DmSeed & { recipients?: Array<{ id: string; displayName?: string; username?: string; avatar?: string | null }> }> };
      const channels = data.channels ?? [];
      registerChannels(
        channels.map((c) => {
          const r = c.recipients?.[0];
          return {
            id: c.id,
            type: "dm",
            name: r ? r.displayName || r.username : undefined,
            href: r ? `/dm/${r.id}` : undefined,
            avatar: r?.avatar ?? null,
          };
        }),
      );
      seedDmChannels(channels, issuedAt);
    } catch {
      /* best-effort seed */
    }
  }, [registerChannels, seedDmChannels]);

  // Cross-device read state: pull the DB read markers (newest wins per
  // channel). Runs on login, on every activity-stream (re)connect and when the
  // tab comes back — a `read_state` event only reaches a connected client.
  const syncReadStates = useCallback(async () => {
    try {
      const res = await sharedGet("/api/users/@me/read-states");
      if (!res.ok) return;
      const data = (await res.json()) as {
        readStates?: Array<{ channelId: string; lastReadAt: string | null; lastReadMessageId?: string | null }>;
      };
      const rows = (data.readStates ?? []).filter((rs) => rs.channelId && rs.lastReadAt);
      if (rows.length === 0) return;
      dispatchUnreadBatch(
        rows.map((rs) => ({ type: "read" as const, channelId: rs.channelId, at: rs.lastReadAt, messageId: rs.lastReadMessageId ?? null })),
      );
      for (const rs of rows) afterRead(rs.channelId);
    } catch {
      /* best-effort — localStorage remains the fallback */
    }
  }, [afterRead]);

  const lastResyncRef = useRef(0);
  const resync = useCallback(async () => {
    lastResyncRef.current = Date.now();
    // Read markers first: the counts that follow are reconciled against them.
    await syncReadStates();
    await Promise.all([seedChannelActivity(), seedMentionsFromApi(), seedDms()]);
    flushPendingAcks();
  }, [syncReadStates, seedChannelActivity, seedMentionsFromApi, seedDms, flushPendingAcks]);

  useEffect(() => {
    if (!user) return;
    // Next tick: the seeds update state, which an effect body mustn't do directly.
    const first = window.setTimeout(() => void resync(), 0);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastResyncRef.current < RESYNC_MIN_INTERVAL_MS) {
        void syncReadStates();
        return;
      }
      void resync();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(first);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user, resync, syncReadStates]);

  // Notification clicks route in-app instead of reloading the page.
  useEffect(() => {
    const onNavigate = (e: Event) => {
      const url = (e as CustomEvent<string>).detail;
      if (typeof url !== "string" || !url.startsWith("/")) return;
      e.preventDefault();
      navigateToMessage((u) => routerRef.current.push(u), url);
    };
    window.addEventListener("serika:navigate", onNavigate);
    return () => window.removeEventListener("serika:navigate", onNavigate);
  }, []);

  // Live activity stream.
  useEffect(() => {
    if (!user) return;
    let es: EventSource | null = null;
    let closed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    // The mount effect seeds once; every later (re)open re-seeds, because
    // anything sent while disconnected (messages, reads on other devices,
    // deletions) was missed.
    let firstOpen = true;

    const handleMessage = (ev: MessageEvent) => {
      let data: ActivityEvent | { type: string };
      try {
        data = JSON.parse(ev.data);
      } catch {
        return;
      }
      const s = stringsRef.current;
      const showPreview = user.settings?.notifications?.showPreview !== false;

      // Cross-device read receipt: another of this user's sessions read a
      // channel. Advance our read marker + clear its badge and notification
      // locally — no re-POST, so devices converge without loops.
      if (data.type === "read_state") {
        const { channelId, lastReadAt, lastReadMessageId } = data as {
          channelId?: string;
          lastReadAt?: string;
          lastReadMessageId?: string | null;
        };
        if (!channelId || !lastReadAt) return;
        dispatchUnread({ type: "read", channelId, at: lastReadAt, messageId: lastReadMessageId ?? null });
        afterRead(channelId);
        return;
      }

      // Friends / blocks changed (any device): refresh the shared lists.
      if (data.type === "relationships_changed") {
        void refreshRelationships();
        return;
      }

      // A private note was edited on another tab or device.
      if (data.type === "user_note_update") {
        const { userId, note } = data as { userId?: string; note?: string };
        if (userId) receiveUserNote(userId, typeof note === "string" ? note : "");
        return;
      }

      // Message Requests changed (a new request, or one accepted/ignored on
      // another device): no badge or sound, just refresh the list/count.
      if (data.type === "message_request") {
        void refreshMessageRequests();
        return;
      }

      // Notification settings changed on another device.
      if (data.type === "notification_settings") {
        applyRemoteNotificationSettings((data as { settings?: unknown }).settings);
        return;
      }

      // Messages were deleted: roll the newest-message stamp back to what
      // remains and drop the deleted messages' badges.
      if (data.type === "unread_reset") {
        const { channelId, lastMessageAt, deleted } = data as {
          channelId?: string;
          lastMessageAt?: string | null;
          deleted?: Array<{ id: string; at?: string | null }>;
        };
        if (!channelId) return;
        dispatchUnread({ type: "reset", channelId, lastMessageAt: lastMessageAt ?? null, deleted });
        afterRead(channelId);
        refreshMentionsNow();
        return;
      }

      // Joined / left / archived threads: the sidebar's thread list refetches.
      if (data.type === "thread_members_update") {
        const serverId = (data as { serverId?: string }).serverId;
        if (serverId) emitThreadsChanged(serverId);
        return;
      }

      // An edit removed this user's mention from a message.
      if (data.type === "mention_retract") {
        const { channelId, messageId, keepUserIds } = data as { channelId?: string; messageId?: string; keepUserIds?: string[] };
        if (!channelId || !messageId) return;
        // Still mentioned directly after the edit: keep the badge.
        if (keepUserIds?.includes(user.id)) return;
        dispatchUnread({ type: "retract", channelId, messageId });
        afterRead(channelId);
        refreshMentionsNow();
        return;
      }

      // DM activity: a DM message arrived. Comes through the always-connected
      // activity stream so DM unread badges appear in realtime regardless of
      // which view the user is in.
      if (data.type === "dm_activity") {
        const dm = data as DmActivityEvent;
        const { channelId, authorId } = dm;
        if (!channelId || !authorId) return;
        const group = dm.group ?? null;
        const href = group ? groupDmHref(channelId) : `/dm/${authorId}`;
        if (authorId !== user.id && !channelMetaRef.current[channelId]?.href) {
          registerChannels([{
            id: channelId,
            type: "dm",
            name: group ? group.name : dm.authorName,
            href,
            avatar: group ? group.icon ?? dm.authorAvatar ?? null : dm.authorAvatar ?? null,
          }]);
        }
        const resolved = resolveNotification({ doc: prefsRef.current.doc, channelId, isDM: true });
        const decision = decideMessageAlert({ resolved, isDM: true, mentionedDirectly: false, mentionedRole: false, mentionedEveryone: false });
        // Blocked people (group DMs) never notify.
        const fromBlocked = isBlockedAuthor(String(authorId).toLowerCase(), getRelationships().blocked);
        const outcome = decideLiveMessage(getUnreadState(), {
          channelId,
          messageId: dm.messageId ?? null,
          at: dm.createdAt || new Date().toISOString(),
          authorId,
          selfId: user.id,
          isDM: true,
          mention: decision.mention,
          notify: decision.notify && !dm.isCall && !dm.isSystem && !fromBlocked,
          active: isOnScreenIn(activeChannelRef, activePanelChannelRef, channelId),
          readingLive: isReadingLive(),
        });
        if (outcome.event) dispatchUnread(outcome.event);
        afterRead(channelId);
        if (!outcome.alert || !markAlerted(dm.messageId)) return;
        const preview = !showPreview
          ? s.newMessage
          : notificationPreview(dm.preview, 140, dm.mentionNames) || (dm.hasAttachments ? s.attachment : dm.hasSticker ? s.sticker : s.newMessage);
        // Group DMs: titled with the group, "Author: message" as the body.
        const body = group && showPreview && dm.authorName ? `${dm.authorName}: ${preview}` : preview;
        const title = group ? channelMetaRef.current[channelId]?.name || group.name : dm.authorName || s.newMessage;
        notifyIncomingMessage({
          channelId,
          isDM: true,
          isMentioned: false,
          isEveryoneMention: false,
          viewing: outcome.viewing || isOnScreenIn(activeChannelRef, activePanelChannelRef, channelId),
          title,
          body,
          showPreview,
          icon: (group?.icon || dm.authorAvatar) ?? null,
          url: dm.messageId ? `${href}?jump=${encodeURIComponent(dm.messageId)}` : href,
          formatMany: s.many,
          toastTitle: title,
          toastAction: s.view,
          messageId: dm.messageId,
          stillUnread: () => !isMessageRead(getUnreadState(), channelId, dm.messageId, dm.createdAt),
        });
        return;
      }

      // Incoming call ringing / stopped / missed — handled by the IncomingCall
      // UI (ringtone, card, desktop notification, missed-call toast). The
      // missed call's DM already has its unread badge from the call message.
      if (data.type === "call_ring" || data.type === "call_cancel" || data.type === "call_missed") {
        if (data.type === "call_missed") recordMissedCall(data as unknown as CallMissed);
        emitCallEvent(data as CallEvent);
        return;
      }

      if (data.type !== "channel_activity") return;
      const event = data as ActivityEvent;

      // Keep the channel→server map current so per-server unread aggregation
      // works for channels the sidebar hasn't registered (e.g. a server the
      // user hasn't opened this session, or a brand-new channel).
      const known = channelMetaRef.current[event.channelId];
      if (
        event.serverId &&
        (!known || known.serverId !== event.serverId || (event.parentId !== undefined && known.parentId !== event.parentId))
      ) {
        registerChannels([{
          id: event.channelId,
          serverId: event.serverId,
          // Unknown kind (could be a thread): left unset, not guessed.
          type: known?.type,
          name: event.channelName ?? known?.name,
          ...(event.parentId !== undefined ? { parentId: event.parentId } : {}),
        }]);
      }

      const mentionedDirectly = (event.mentionedUserIds || []).includes(user.id);
      const mentionedRole = event.mentionedRole === true;
      const mentionedEveryone = Boolean(event.mentionEveryone);
      const ancestorIds = ancestorsOf(channelMetaRef.current, event.channelId, event.parentId);
      const p = prefsRef.current;
      const resolved = resolveNotification({
        doc: p.doc,
        serverId: event.serverId,
        channelId: event.channelId,
        ancestorIds,
        serverDefault: p.serverDefaults[event.serverId],
        globalAllMessages: isNotifyAllMessages(),
      });
      const muteEveryone = user.settings?.notifications?.muteEveryone === true;
      const alert = decideMessageAlert({
        resolved: { ...resolved, suppressEveryone: resolved.suppressEveryone || muteEveryone },
        isDM: false,
        mentionedDirectly,
        mentionedRole,
        mentionedEveryone,
      });
      // Messages from people you blocked never ping or notify (Discord).
      const fromBlocked = isBlockedAuthor(String(event.authorId ?? "").toLowerCase(), getRelationships().blocked);
      if (fromBlocked) {
        alert.mention = false;
        alert.notify = false;
      }
      const outcome = decideLiveMessage(getUnreadState(), {
        channelId: event.channelId,
        messageId: event.messageId,
        at: event.createdAt,
        authorId: event.authorId,
        selfId: user.id,
        isDM: false,
        mention: alert.mention,
        notify: alert.notify,
        active: isOnScreenIn(activeChannelRef, activePanelChannelRef, event.channelId),
        readingLive: isReadingLive(),
      });
      if (outcome.event) dispatchUnread(outcome.event);
      afterRead(event.channelId);
      if (alert.mention) refreshMentionsNow();

      // The open channel notifies through its own chat view; everything else
      // goes here.
      if (!outcome.alert || !markAlerted(event.messageId)) return;
      const pinged = alert.mention;
      const label = event.channelName ? `#${event.channelName}` : s.aChannel;
      const who = event.authorName || s.someone;
      const base = event.serverId ? `/channels/${event.serverId}/${event.channelId}` : "/channels/me";
      const url = `${base}?jump=${encodeURIComponent(event.messageId)}`;
      const preview = showPreview ? notificationPreview(event.preview, 140, event.mentionNames) : "";
      notifyIncomingMessage({
        channelId: event.channelId,
        serverId: event.serverId,
        ancestorIds,
        isDM: false,
        isMentioned: mentionedDirectly || mentionedRole,
        isRoleMention: !mentionedDirectly && mentionedRole,
        isEveryoneMention: mentionedEveryone,
        viewing: false,
        title: pinged ? s.mentionedYou(who) : s.inChannel(who, label),
        body: preview || label,
        showPreview,
        icon: event.authorAvatar,
        url,
        formatMany: s.many,
        toastTitle: pinged ? s.mentionedYou(who) : s.inChannel(who, label),
        toastAction: s.view,
        quiet: !pinged,
        messageId: event.messageId,
        stillUnread: () => !isMessageRead(getUnreadState(), event.channelId, event.messageId, event.createdAt),
      });
    };

    const connect = () => {
      if (closed) return;
      const source = new EventSource("/api/users/@me/activity", { withCredentials: true });
      es = source;
      source.onopen = () => {
        attempts = 0;
        if (firstOpen) { firstOpen = false; return; } // mount effect already seeded
        void resync();
        void loadNotificationPrefs();
      };
      source.onmessage = handleMessage;
      source.onerror = () => {
        // The browser retries dropped connections by itself, but gives up for
        // good after an HTTP error (401 while a token refreshes, 502/503 while
        // the server restarts). Reconnect ourselves when that happens, or the
        // app silently stops receiving unread badges and notifications.
        if (source.readyState !== EventSource.CLOSED) return;
        source.close();
        if (closed) return;
        const delay = Math.min(1000 * 2 ** attempts, 30000);
        attempts += 1;
        retryTimer = setTimeout(connect, delay);
      };
    };
    connect();

    // Come back right away when the tab or the network returns.
    const revive = () => {
      if (closed || document.visibilityState !== "visible") return;
      flushPendingAcks();
      if (es && es.readyState !== EventSource.CLOSED) return;
      if (retryTimer) clearTimeout(retryTimer);
      attempts = 0;
      connect();
    };
    window.addEventListener("online", revive);
    document.addEventListener("visibilitychange", revive);

    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      window.removeEventListener("online", revive);
      document.removeEventListener("visibilitychange", revive);
      es?.close();
    };
  }, [user, resync, afterRead, registerChannels, flushPendingAcks]);

  // Effective mute per registered conversation (recomputed when settings change
  // or a timed mute runs out — `prefs.version`).
  const mutedChannels = useMemo(() => {
    const muted = new Set<string>();
    // `prefs` is a new object whenever settings change or a timed mute runs out.
    const { doc } = prefs;
    for (const [channelId, meta] of Object.entries(channelMeta)) {
      const r = resolveNotification({
        doc,
        serverId: meta.serverId ?? null,
        channelId,
        ancestorIds: ancestorsOf(channelMeta, channelId),
      });
      if (r.muted) muted.add(channelId);
    }
    // Muted channels not (yet) registered still count.
    for (const id of Object.keys(doc.channels)) {
      if (!channelMeta[id] && resolveNotification({ doc, channelId: id }).channelMuted) muted.add(id);
    }
    return muted;
  }, [channelMeta, prefs]);

  const isChannelMuted = useCallback((channelId: string) => mutedChannels.has(channelId), [mutedChannels]);

  const isChannelUnread = useCallback(
    (channelId: string) => {
      if (isOnScreenIn(activeChannelRef, activePanelChannelRef, channelId)) return false;
      if (mutedChannels.has(channelId)) return false;
      return hasUnread(unread, channelId);
    },
    [unread, mutedChannels],
  );

  const getMentionCount = useCallback((channelId: string) => badgeCount(unread, channelId), [unread]);

  const getReadMarker = useCallback((channelId: string): ReadMarkerSnapshot => readMarkerOf(unread, channelId), [unread]);

  const summary = useMemo(() => summarize(unread, channelMeta, mutedChannels), [unread, channelMeta, mutedChannels]);

  const isServerUnread = useCallback((serverId: string) => summary.unreadServers.has(serverId), [summary]);
  const getServerMentionCount = useCallback(
    (serverId: string) => summary.serverMentions.get(serverId) || 0,
    [summary],
  );
  const totalDmUnreadCount = summary.dmBadgeTotal;
  const totalMentionCount = summary.serverMentionTotal;
  const titleCount = titleBadgeCount(summary);

  // "(n)" title, favicon dot, app/taskbar badge: mentions + unmuted DM messages.
  useEffect(() => {
    setUnreadBadge(user ? titleCount : 0);
  }, [user, titleCount]);
  // Leaving the app shell (settings pages, logout) must not strand a stale count.
  useEffect(() => () => setUnreadBadge(0), []);

  const unreadChannels = useMemo<UnreadChannelEntry[]>(() => {
    const out: UnreadChannelEntry[] = [];
    const ids = new Set([...Object.keys(unread.activity), ...Object.keys(unread.badges)]);
    for (const channelId of ids) {
      const mentions = badgeCount(unread, channelId);
      if (mutedChannels.has(channelId) && !mentions) continue;
      if (!hasUnread(unread, channelId) && !mentions) continue;
      const meta = channelMeta[channelId];
      // Unknown conversation (left server, deleted channel): nothing to open.
      if (!meta) continue;
      const isDM = !meta.serverId;
      const href = meta.href ?? (meta.serverId ? `/channels/${meta.serverId}/${channelId}` : null);
      if (!href) continue;
      const act = unread.activity[channelId];
      out.push({
        channelId,
        serverId: meta.serverId,
        name: meta.name,
        href,
        avatar: meta.avatar,
        lastMessageAt: new Date(act || toMs(meta.lastMessageAt) || 0).toISOString(),
        mentions,
        isDM,
      });
    }
    out.sort((a, b) => toMs(b.lastMessageAt) - toMs(a.lastMessageAt));
    return out;
  }, [unread, channelMeta, mutedChannels]);

  const value = useMemo<UnreadContextValue>(
    () => ({
      isChannelUnread,
      getMentionCount,
      isServerUnread,
      getServerMentionCount,
      isChannelMuted,
      getReadMarker,
      totalDmUnreadCount,
      totalMentionCount,
      unreadChannels,
      markChannelRead,
      markServerRead,
      markChannelsRead,
      markAllRead,
      registerChannels,
      setActiveChannel,
      setActivePanelChannel,
      seedDmChannels,
      notifyDmActivity,
    }),
    [
      isChannelUnread,
      getMentionCount,
      isServerUnread,
      getServerMentionCount,
      isChannelMuted,
      getReadMarker,
      totalDmUnreadCount,
      totalMentionCount,
      unreadChannels,
      markChannelRead,
      markServerRead,
      markChannelsRead,
      markAllRead,
      registerChannels,
      setActiveChannel,
      setActivePanelChannel,
      seedDmChannels,
      notifyDmActivity,
    ],
  );

  return <UnreadContext.Provider value={value}>{children}</UnreadContext.Provider>;
}

// No-op fallback so a component rendered outside an UnreadProvider (e.g. a new
// layout that forgets to wrap it) degrades to "no unread info" instead of
// white-screening the whole page via the error boundary.
const NOOP_UNREAD: UnreadContextValue = {
  isChannelUnread: () => false,
  getMentionCount: () => 0,
  isServerUnread: () => false,
  getServerMentionCount: () => 0,
  isChannelMuted: () => false,
  getReadMarker: () => ({ lastReadAt: null, lastReadMessageId: null }),
  totalDmUnreadCount: 0,
  totalMentionCount: 0,
  unreadChannels: [],
  markChannelRead: () => {},
  markServerRead: () => {},
  markChannelsRead: () => {},
  markAllRead: () => {},
  registerChannels: () => {},
  setActiveChannel: () => {},
  setActivePanelChannel: () => {},
  seedDmChannels: () => {},
  notifyDmActivity: () => {},
};

export function useUnread() {
  return useContext(UnreadContext) ?? NOOP_UNREAD;
}
