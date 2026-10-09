"use client";

/**
 * Real-time unread + mention tracking for the whole app.
 *
 * Drives: channel "glow" (bold white text) when there's unread activity, the
 * mention badge + count, desktop notifications / toasts / sounds for messages
 * outside the conversation on screen, server-level unread/mention aggregation
 * for the server rail, the Inbox "Unreads" list, and the "(n)" tab title /
 * favicon dot / app badge. Backed by the `/api/users/@me/activity` SSE stream
 * so updates are instant, the server read markers (`/@me/read-states`) so read
 * state follows the user across devices, and localStorage so it survives reloads.
 *
 * Reading: opening a conversation does NOT mark it read. The chat list acks
 * the exact newest message once the user has actually seen it (window focused
 * and visible, scrolled to the bottom) via `markChannelRead(id, message)`.
 */

import { sharedGet } from "@/lib/bootFetch";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
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
  isAppFocused,
  notificationPreview,
  notifyIncomingMessage,
} from "@/lib/notifications/notify";
import { recordMissedCall } from "@/lib/notifications/missedCalls";
import { navigateToMessage } from "@/lib/notifications/events";
import { markMentionsReadLocal, refreshMentionsNow } from "@/hooks/useMentions";

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
  parentId?: string | null;
  createdAt: string;
}

export interface ChannelMeta {
  id: string;
  serverId?: string;
  type?: string;
  lastMessageAt?: string | null;
  /** Display name (channel name, or the other person for DMs). */
  name?: string;
  /** Category / forum parent, for inherited notification settings. */
  parentId?: string | null;
  /** Where the conversation opens (DMs; channels derive it from serverId). */
  href?: string;
  avatar?: string | null;
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
   *  Messages tab badge). Capped at MAX_UNREAD_BADGE per channel upstream. */
  totalDmUnreadCount: number;
  /** Total server mentions across every joined server (drives the mobile
   *  Notifications tab badge). */
  totalMentionCount: number;
  /** Unread, unmuted conversations, newest first (Inbox "Unreads"). */
  unreadChannels: UnreadChannelEntry[];
  /**
   * Mark a conversation read. With `upTo`, acks exactly that message (the
   * newest one the user saw); without it, everything up to now.
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
  /**
   * Seed exact per-DM unread counts from the server (`/api/dms`). Unlike the
   * live increment, this is authoritative — it replaces the count for each
   * channel so a reload shows the real number, not a session-local tally.
   */
  seedDmCounts: (counts: Record<string, number>) => void;
  /**
   * Live-bump a DM's unread badge when a message arrives over the DM stream.
   * DMs don't flow through the activity stream, so this is how their counts
   * stay realtime. No-op while the DM is on screen.
   */
  notifyDmActivity: (channelId: string, createdAt?: string, messageId?: string) => void;
}

const UnreadContext = createContext<UnreadContextValue | undefined>(undefined);

// Mirror of the server's MAX_UNREAD_BADGE (Message.ts). Kept as a local literal
// so this client module doesn't pull the DB-backed model into the bundle. Past
// this the UI shows "99+", so we never let a live count climb higher — a channel
// spammed with 1000 messages stays a clean, cheap "99+" instead of re-rendering
// on every increment up to 1000.
const MAX_UNREAD_BADGE = 100;

const LS_READ = "sc:unread:read";
const LS_READ_IDS = "sc:unread:readids";
const LS_ACTIVITY = "sc:unread:activity";

function loadMap(key: string): Record<string, string> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function saveMap(key: string, map: Record<string, string>) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {
    /* quota — ignore */
  }
}

function ms(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

interface DmActivityEvent {
  type: "dm_activity";
  channelId?: string;
  messageId?: string;
  authorId?: string;
  authorName?: string;
  authorAvatar?: string | null;
  preview?: string;
  hasAttachments?: boolean;
  hasSticker?: boolean;
  createdAt?: string;
  /** A call log message: the incoming-call card already alerted the user. */
  isCall?: boolean;
}

// Message ids already counted/notified. A DM can reach us over both the
// activity stream and the DM-list stream; count it once.
const seenMessageIds = new Set<string>();
function markMessageSeen(messageId: string | undefined): boolean {
  if (!messageId) return true;
  if (seenMessageIds.has(messageId)) return false;
  seenMessageIds.add(messageId);
  if (seenMessageIds.size > 500) {
    const oldest = seenMessageIds.values().next().value;
    if (oldest) seenMessageIds.delete(oldest);
  }
  return true;
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

  // lastActivity/lastRead are ISO timestamp maps keyed by channelId. Initialized
  // lazily from localStorage (guarded for SSR) so persisted state is available
  // on first client render without a cascading setState-in-effect.
  const [lastActivity, setLastActivity] = useState<Record<string, string>>(() => loadMap(LS_ACTIVITY));
  const [lastRead, setLastRead] = useState<Record<string, string>>(() => loadMap(LS_READ));
  // Exact last read message per channel (from acks and the server markers).
  const [readIds, setReadIds] = useState<Record<string, string>>(() => loadMap(LS_READ_IDS));
  const [mentionCounts, setMentionCounts] = useState<Record<string, number>>({});

  // channelId -> serverId (+ type) so we can aggregate per server and route toasts.
  const [channelMeta, setChannelMeta] = useState<Record<string, ChannelMeta>>({});
  const channelMetaRef = useRef(channelMeta);
  useEffect(() => {
    channelMetaRef.current = channelMeta;
  }, [channelMeta]);
  const activeChannelRef = useRef<string | null>(null);
  // Live mirror of lastActivity so markChannelRead can clamp the read marker to
  // the newest known activity without taking lastActivity as a dependency.
  const lastActivityRef = useRef(lastActivity);
  useEffect(() => {
    lastActivityRef.current = lastActivity;
  }, [lastActivity]);
  // Live mirror of lastRead so seedDmCounts can skip channels the user just
  // marked read locally (the fire-and-forget POST may not have hit the DB yet
  // when the next poll refetches DM counts — without this the stale server
  // count re-introduces the badge the user just dismissed).
  const lastReadRef = useRef(lastRead);
  useEffect(() => {
    lastReadRef.current = lastRead;
  }, [lastRead]);
  const readIdsRef = useRef(readIds);
  useEffect(() => {
    readIdsRef.current = readIds;
  }, [readIds]);
  const mentionCountsRef = useRef(mentionCounts);
  useEffect(() => {
    mentionCountsRef.current = mentionCounts;
  }, [mentionCounts]);
  // Last message id POSTed per channel, so repeated acks of the same message
  // (scroll jitter, focus events) cost nothing.
  const postedAckRef = useRef<Record<string, string>>({});

  /** Advance the local read marker (never backwards) and drop badges/notifications. */
  const applyLocalRead = useCallback((channelId: string, readIso: string, messageId: string | null) => {
    const readMs = ms(readIso);
    setLastRead((prev) => {
      if (ms(prev[channelId]) >= readMs) return prev;
      const next = { ...prev, [channelId]: readIso };
      saveMap(LS_READ, next);
      return next;
    });
    if (messageId) {
      setReadIds((prev) => {
        if (prev[channelId] === messageId) return prev;
        const next = { ...prev, [channelId]: messageId };
        saveMap(LS_READ_IDS, next);
        return next;
      });
    }
    // Badges and notifications only go once the marker covers the newest
    // known message (an older marker arriving late must not clear new pings).
    const activityMs = ms(lastActivityRef.current[channelId]);
    if (activityMs && readMs < activityMs) return;
    setMentionCounts((prev) => {
      if (!prev[channelId]) return prev;
      const next = { ...prev };
      delete next[channelId];
      return next;
    });
    markMentionsReadLocal(channelId, Math.max(readMs, Date.now()));
    clearConversationNotifications(channelId);
  }, []);

  const markChannelRead = useCallback(
    (channelId: string, upTo?: { id: string; createdAt: string }) => {
      if (!channelId) return;
      const activityMs = ms(lastActivityRef.current[channelId]);
      let readMs: number;
      if (upTo) {
        if (postedAckRef.current[channelId] === upTo.id) return;
        // Acking the newest message on screen reads the channel's activity
        // stamp too (it's bumped a moment after the insert, in server time).
        readMs = Math.max(ms(upTo.createdAt), activityMs);
      } else {
        // Clamp to at least the newest known activity: server-sent activity
        // uses server time and a client clock running behind would otherwise
        // leave the channel stuck "unread". +1ms keeps it strictly ahead.
        readMs = activityMs ? Math.max(Date.now(), activityMs + 1) : Date.now();
      }
      applyLocalRead(channelId, new Date(readMs).toISOString(), upTo?.id ?? null);
      if (upTo) postedAckRef.current[channelId] = upTo.id;
      else delete postedAckRef.current[channelId];
      // Persist the ack so read state follows the user across devices. With a
      // message id it's exact; without one the server resolves the latest.
      void fetch("/api/users/@me/read-states", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(upTo ? { channelId, messageId: upTo.id } : { channelId }),
      }).catch(() => {
        /* best-effort — localStorage already updated for this device */
      });
    },
    [applyLocalRead]
  );

  const isUnreadNow = useCallback((channelId: string) => {
    const act = ms(lastActivityRef.current[channelId]);
    return act > 0 && act > ms(lastReadRef.current[channelId]);
  }, []);

  const markChannelsRead = useCallback(
    (channelIds: string[]) => {
      for (const id of channelIds) markChannelRead(id);
    },
    [markChannelRead]
  );

  const markServerRead = useCallback(
    (serverId: string) => {
      if (!serverId) return;
      for (const [channelId, meta] of Object.entries(channelMetaRef.current)) {
        if (meta.serverId !== serverId) continue;
        // Only channels with something to clear: no POST storm for big servers.
        if (isUnreadNow(channelId) || mentionCountsRef.current[channelId]) markChannelRead(channelId);
      }
    },
    [markChannelRead, isUnreadNow]
  );

  const markAllRead = useCallback(() => {
    const ids = new Set<string>();
    for (const id of Object.keys(lastActivityRef.current)) if (isUnreadNow(id)) ids.add(id);
    for (const [id, n] of Object.entries(mentionCountsRef.current)) if (n > 0) ids.add(id);
    for (const id of ids) markChannelRead(id);
  }, [markChannelRead, isUnreadNow]);

  const setActiveChannel = useCallback((channelId: string | null) => {
    activeChannelRef.current = channelId;
  }, []);

  // Authoritative per-DM unread counts from the server. Replace (not add) so a
  // reload reflects the real number; never overwrite the count of the DM the
  // user is currently reading (it should stay cleared).
  const seedDmCounts = useCallback((counts: Record<string, number>) => {
    setMentionCounts((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const [channelId, count] of Object.entries(counts)) {
        if (channelId === activeChannelRef.current && isAppFocused()) {
          if (next[channelId]) { delete next[channelId]; changed = true; }
          continue;
        }
        // Skip channels the user already marked read locally. The server's
        // unreadCount may be stale because the fire-and-forget read-state POST
        // hasn't landed yet — re-seeding would resurrect the badge.
        const readTs = lastReadRef.current[channelId];
        const actTs = lastActivityRef.current[channelId];
        if (readTs && actTs && ms(readTs) >= ms(actTs)) {
          if (next[channelId]) { delete next[channelId]; changed = true; }
          continue;
        }
        const desired = count > 0 ? Math.min(count, MAX_UNREAD_BADGE) : undefined;
        if (next[channelId] !== desired) {
          if (desired === undefined) delete next[channelId];
          else next[channelId] = desired;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  /** Bump a conversation's badge unless it's already read past `createdAt`. */
  const bumpCount = useCallback((channelId: string, createdAt: string | undefined, messageId?: string) => {
    // The ack for this message may beat its activity event here.
    if (createdAt && ms(lastReadRef.current[channelId]) >= ms(createdAt)) return;
    if (messageId && readIdsRef.current[channelId] === messageId) return;
    setMentionCounts((prev) => {
      const current = prev[channelId] || 0;
      if (current >= MAX_UNREAD_BADGE) return prev; // already at "99+", skip re-render
      return { ...prev, [channelId]: current + 1 };
    });
  }, []);

  const touchActivity = useCallback((channelId: string, createdAt: string) => {
    setLastActivity((prev) => {
      if (ms(prev[channelId]) >= ms(createdAt)) return prev;
      const next = { ...prev, [channelId]: createdAt };
      saveMap(LS_ACTIVITY, next);
      return next;
    });
  }, []);

  const notifyDmActivity = useCallback((channelId: string, createdAt?: string, messageId?: string) => {
    if (!channelId) return;
    if (!markMessageSeen(messageId)) return;
    const ts = createdAt || new Date().toISOString();
    touchActivity(channelId, ts);
    if (channelId === activeChannelRef.current && isAppFocused()) return; // reading it now
    bumpCount(channelId, ts, messageId);
  }, [touchActivity, bumpCount]);

  const registerChannels = useCallback((channels: ChannelMeta[]) => {
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
        };
        if (
          !existing ||
          existing.serverId !== merged.serverId ||
          existing.lastMessageAt !== merged.lastMessageAt ||
          existing.name !== merged.name ||
          existing.parentId !== merged.parentId ||
          existing.href !== merged.href ||
          existing.avatar !== merged.avatar
        ) {
          nextMeta[ch.id] = merged;
          metaChanged = true;
        }
      }
      return metaChanged ? nextMeta : prev;
    });
    setLastActivity((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const ch of channels) {
        // Seed activity from the server's known last-message time so unread
        // persists across reloads / new devices.
        if (ch.lastMessageAt && ms(ch.lastMessageAt) > ms(next[ch.id])) {
          next[ch.id] = ch.lastMessageAt;
          changed = true;
        }
      }
      if (changed) saveMap(LS_ACTIVITY, next);
      return changed ? next : prev;
    });
  }, []);

  // Notification settings (levels, mutes) — server-side, cross-device.
  useEffect(() => {
    if (!user) return;
    void loadNotificationPrefs();
  }, [user]);

  // Seed the channel→server map + last-activity for EVERY server the user is in
  // (not just the open one) so the server-rail unread pill is correct on load.
  // ChannelSidebar only registers the currently-open server's channels; without
  // this, unread servers you haven't opened this session show nothing.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await sharedGet("/api/users/@me/channel-activity");
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          channels?: Array<{ channelId: string; serverId: string; name?: string; parentId?: string | null; lastMessageAt: string | null }>;
        };
        if (cancelled || !data.channels?.length) return;
        registerChannels(
          data.channels.map((c) => ({
            id: c.channelId,
            serverId: c.serverId,
            type: "text",
            name: c.name,
            parentId: c.parentId ?? null,
            lastMessageAt: c.lastMessageAt,
          }))
        );
      } catch {
        /* best-effort seed — live activity events fill in the rest */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, registerChannels]);

  // Seed mention counts once from the mentions API (accurate historical counts).
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await sharedGet("/api/users/@me/mentions");
        if (!res.ok) return;
        const data = await res.json();
        const readMap = loadMap(LS_READ);
        const counts: Record<string, number> = {};
        const muteEveryone = user.settings?.notifications?.muteEveryone === true;
        for (const m of (data.mentions || []) as Array<{ channelId: string; serverId?: string; createdAt: string; kind?: "user" | "role" | "everyone" }>) {
          // Honour per-server "Nothing" and @everyone / role suppression.
          if (!isMentionCounted({ serverId: m.serverId || null, channelId: m.channelId, kind: m.kind, muteEveryoneGlobally: muteEveryone })) continue;
          if (ms(m.createdAt) > ms(readMap[m.channelId])) {
            counts[m.channelId] = Math.min((counts[m.channelId] || 0) + 1, MAX_UNREAD_BADGE);
          }
        }
        if (!cancelled) setMentionCounts((prev) => ({ ...counts, ...prev }));
      } catch {
        /* best-effort seed */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Cross-device read state: pull the DB read markers and merge them into the
  // local read map (newest wins per channel). This is what makes a channel you
  // read on your phone show as read on desktop, and vice-versa.
  //
  // We run this not just on login but on every SSE (re)connect and whenever the
  // tab becomes visible again. The live `read_state` event only reaches a client
  // that's connected at the instant another device reads — a backgrounded tab or
  // a dropped connection misses it and would otherwise stay "unread" until a full
  // reload. Re-reconciling on reconnect/visibility closes that gap so read state
  // FULLY converges across devices without a manual refresh.
  const syncReadStates = useCallback(async () => {
    try {
      const res = await sharedGet("/api/users/@me/read-states");
      if (!res.ok) return;
      const data = (await res.json()) as {
        readStates?: Array<{ channelId: string; lastReadAt: string | null; lastReadMessageId?: string | null }>;
      };
      if (!data.readStates?.length) return;
      for (const rs of data.readStates) {
        if (!rs.lastReadAt) continue;
        if (ms(rs.lastReadAt) <= ms(lastReadRef.current[rs.channelId])) {
          // Same marker (or older): still learn the exact message id.
          if (rs.lastReadMessageId && ms(rs.lastReadAt) === ms(lastReadRef.current[rs.channelId])) {
            const id = rs.lastReadMessageId;
            setReadIds((prev) => {
              if (prev[rs.channelId] === id) return prev;
              const next = { ...prev, [rs.channelId]: id };
              saveMap(LS_READ_IDS, next);
              return next;
            });
          }
          continue;
        }
        applyLocalRead(rs.channelId, rs.lastReadAt, rs.lastReadMessageId ?? null);
      }
    } catch {
      /* best-effort — localStorage remains the fallback */
    }
  }, [applyLocalRead]);

  useEffect(() => {
    if (!user) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void syncReadStates();
    };
    void (async () => { await syncReadStates(); })();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [user, syncReadStates]);

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
    // On every (re)connect, reconcile against the DB. The initial mount seed is
    // handled separately, but a reconnect after a drop is exactly when we may
    // have missed a live `read_state` event — pull the authoritative markers so
    // read state converges instead of lingering stale until reload.
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
        applyLocalRead(channelId, lastReadAt, lastReadMessageId ?? null);
        return;
      }

      // Notification settings changed on another device.
      if (data.type === "notification_settings") {
        applyRemoteNotificationSettings((data as { settings?: unknown }).settings);
        return;
      }

      // Unread reset after a deletion: roll our activity marker back to the
      // newest remaining message (or drop it if the channel is now empty), so a
      // badge left by a since-deleted message clears.
      if (data.type === "unread_reset") {
        const { channelId, lastMessageAt } = data as { channelId?: string; lastMessageAt?: string | null };
        if (!channelId) return;
        setLastActivity((prev) => {
          if (!(channelId in prev) && !lastMessageAt) return prev;
          const next = { ...prev };
          if (lastMessageAt) next[channelId] = lastMessageAt;
          else delete next[channelId];
          saveMap(LS_ACTIVITY, next);
          return next;
        });
        return;
      }

      // DM activity: a DM message arrived. Comes through the always-connected
      // activity stream so DM unread badges appear in realtime regardless of
      // which view the user is in.
      if (data.type === "dm_activity") {
        const dm = data as DmActivityEvent;
        const { channelId, authorId, createdAt } = dm;
        if (!channelId || !authorId || authorId === user.id) return;
        if (!markMessageSeen(dm.messageId)) return;
        const viewing = activeChannelRef.current === channelId;
        const href = `/dm/${authorId}`;
        if (!channelMetaRef.current[channelId]?.href) {
          registerChannels([{ id: channelId, type: "dm", name: dm.authorName, href, avatar: dm.authorAvatar ?? null }]);
        }
        const body = !showPreview
          ? s.newMessage
          : notificationPreview(dm.preview) || (dm.hasAttachments ? s.attachment : dm.hasSticker ? s.sticker : s.newMessage);
        if (!dm.isCall) notifyIncomingMessage({
          channelId,
          isDM: true,
          isMentioned: false,
          isEveryoneMention: false,
          viewing,
          title: dm.authorName || s.newMessage,
          body,
          showPreview,
          icon: dm.authorAvatar,
          url: dm.messageId ? `${href}?jump=${encodeURIComponent(dm.messageId)}` : href,
          formatMany: s.many,
          toastTitle: dm.authorName || s.newMessage,
          toastAction: s.view,
        });
        const ts = createdAt || new Date().toISOString();
        touchActivity(channelId, ts);
        if (viewing && isAppFocused()) return;
        bumpCount(channelId, ts, dm.messageId);
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
      if (event.authorId === user.id) return; // own messages aren't unread

      const isActive = activeChannelRef.current === event.channelId;
      const mentionedDirectly = (event.mentionedUserIds || []).includes(user.id);
      const mentionedRole = event.mentionedRole === true;
      const mentionedEveryone = Boolean(event.mentionEveryone);

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
          type: known?.type ?? "text",
          name: event.channelName ?? known?.name,
          ...(event.parentId !== undefined ? { parentId: event.parentId } : {}),
        }]);
      }

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

      touchActivity(event.channelId, event.createdAt);
      if (alert.mention && !(isActive && isAppFocused())) {
        bumpCount(event.channelId, event.createdAt, event.messageId);
        refreshMentionsNow();
      }

      // The open channel notifies through its own chat view; everything else
      // goes here.
      if (alert.notify && !isActive && markMessageSeen(event.messageId)) {
        const pinged = alert.mention;
        const label = event.channelName ? `#${event.channelName}` : s.aChannel;
        const who = event.authorName || s.someone;
        const base = event.serverId ? `/channels/${event.serverId}/${event.channelId}` : "/channels/me";
        const url = `${base}?jump=${encodeURIComponent(event.messageId)}`;
        const preview = showPreview ? notificationPreview(event.preview) : "";
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
        });
      }
    };

    const connect = () => {
      if (closed) return;
      const source = new EventSource("/api/users/@me/activity", { withCredentials: true });
      es = source;
      source.onopen = () => {
        attempts = 0;
        if (firstOpen) { firstOpen = false; return; } // mount effect already seeded
        void syncReadStates();
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
  }, [user, syncReadStates, applyLocalRead, registerChannels, touchActivity, bumpCount]);

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
      if (activeChannelRef.current === channelId) return false;
      if (mutedChannels.has(channelId)) return false;
      const act = ms(lastActivity[channelId]);
      if (!act) return false;
      return act > ms(lastRead[channelId]);
    },
    [lastActivity, lastRead, mutedChannels]
  );

  const getMentionCount = useCallback(
    (channelId: string) => mentionCounts[channelId] || 0,
    [mentionCounts]
  );

  const getReadMarker = useCallback(
    (channelId: string): ReadMarkerSnapshot => ({
      lastReadAt: lastRead[channelId] ?? null,
      lastReadMessageId: readIds[channelId] ?? null,
    }),
    [lastRead, readIds]
  );

  // Per-server aggregation derived from the registered channel→server map.
  const { serverUnread, serverMentionCounts } = useMemo(() => {
    const unread = new Set<string>();
    const counts = new Map<string, number>();
    for (const [channelId, meta] of Object.entries(channelMeta)) {
      if (!meta.serverId) continue;
      const act = ms(lastActivity[channelId]);
      if (act && act > ms(lastRead[channelId]) && !mutedChannels.has(channelId)) {
        unread.add(meta.serverId);
      }
      const mc = mentionCounts[channelId] || 0;
      if (mc > 0) counts.set(meta.serverId, (counts.get(meta.serverId) || 0) + mc);
    }
    return { serverUnread: unread, serverMentionCounts: counts };
  }, [lastActivity, lastRead, mentionCounts, channelMeta, mutedChannels]);

  const isServerUnread = useCallback((serverId: string) => serverUnread.has(serverId), [serverUnread]);
  const getServerMentionCount = useCallback(
    (serverId: string) => serverMentionCounts.get(serverId) || 0,
    [serverMentionCounts]
  );

  // App-wide aggregates for the mobile bottom-nav badges. DM channels register
  // without a serverId, so "no serverId" == a DM/group conversation. Counts for
  // unknown channels (seeded before registration) are DMs too: server channels
  // all arrive through /channel-activity.
  const { totalDmUnreadCount, mutedDmCount } = useMemo(() => {
    let sum = 0;
    let muted = 0;
    for (const [channelId, count] of Object.entries(mentionCounts)) {
      if (channelMeta[channelId]?.serverId) continue;
      sum += count;
      if (mutedChannels.has(channelId)) muted += count;
    }
    return { totalDmUnreadCount: sum, mutedDmCount: muted };
  }, [channelMeta, mentionCounts, mutedChannels]);

  const totalMentionCount = useMemo(() => {
    let sum = 0;
    for (const c of serverMentionCounts.values()) sum += c;
    return sum;
  }, [serverMentionCounts]);

  // "(n)" title, favicon dot, app/taskbar badge: mentions + unmuted DM messages.
  useEffect(() => {
    setUnreadBadge(user ? totalMentionCount + totalDmUnreadCount - mutedDmCount : 0);
  }, [user, totalMentionCount, totalDmUnreadCount, mutedDmCount]);

  const unreadChannels = useMemo<UnreadChannelEntry[]>(() => {
    const out: UnreadChannelEntry[] = [];
    const ids = new Set([...Object.keys(lastActivity), ...Object.keys(mentionCounts)]);
    for (const channelId of ids) {
      if (mutedChannels.has(channelId) && !mentionCounts[channelId]) continue;
      const act = lastActivity[channelId];
      const mentions = mentionCounts[channelId] || 0;
      const unread = ms(act) > ms(lastRead[channelId]);
      if (!unread && !mentions) continue;
      const meta = channelMeta[channelId];
      // Unknown conversation (left server, deleted channel): nothing to open.
      if (!meta) continue;
      const isDM = !meta.serverId;
      const href = meta.href ?? (meta.serverId ? `/channels/${meta.serverId}/${channelId}` : null);
      if (!href) continue;
      out.push({
        channelId,
        serverId: meta.serverId,
        name: meta.name,
        href,
        avatar: meta.avatar,
        lastMessageAt: act ?? new Date(0).toISOString(),
        mentions,
        isDM,
      });
    }
    out.sort((a, b) => ms(b.lastMessageAt) - ms(a.lastMessageAt));
    return out;
  }, [lastActivity, lastRead, mentionCounts, channelMeta, mutedChannels]);

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
      seedDmCounts,
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
      seedDmCounts,
      notifyDmActivity,
    ]
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
  seedDmCounts: () => {},
  notifyDmActivity: () => {},
};

export function useUnread() {
  return useContext(UnreadContext) ?? NOOP_UNREAD;
}
