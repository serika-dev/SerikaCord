"use client";

/**
 * Real-time unread + mention tracking for the whole app.
 *
 * Drives: channel "glow" (bold white text) when there's unread activity, the
 * purple mention badge + count, mention toasts when you're pinged in a channel
 * you're not viewing, and server-level unread/mention aggregation for the
 * server rail. Backed by the `/api/users/@me/activity` SSE stream so updates are
 * instant, with localStorage persistence so state survives reloads.
 */

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
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

interface ActivityEvent {
  type: "channel_activity";
  serverId: string;
  channelId: string;
  channelName?: string;
  messageId: string;
  authorId: string;
  authorName?: string;
  mentionedUserIds: string[];
  mentionEveryone: boolean;
  createdAt: string;
}

interface ChannelMeta {
  id: string;
  serverId?: string;
  type?: string;
  lastMessageAt?: string | null;
}

interface UnreadContextValue {
  isChannelUnread: (channelId: string) => boolean;
  getMentionCount: (channelId: string) => number;
  isServerUnread: (serverId: string) => boolean;
  getServerMentionCount: (serverId: string) => number;
  /** Total unread DM messages across every DM/group channel (drives the mobile
   *  Messages tab badge). Capped at MAX_UNREAD_BADGE per channel upstream. */
  totalDmUnreadCount: number;
  /** Total server mentions across every joined server (drives the mobile
   *  Notifications tab badge). */
  totalMentionCount: number;
  markChannelRead: (channelId: string) => void;
  /** Mark every channel in a server as read (clears unread pill + mention badges). */
  markServerRead: (serverId: string) => void;
  /** Feed the sidebar's channel list so we know channel→server + last activity. */
  registerChannels: (channels: ChannelMeta[]) => void;
  /** Called when the user opens a channel — marks it read + preps preload. */
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
   * stay realtime. No-op while the DM is the active channel.
   */
  notifyDmActivity: (channelId: string, createdAt?: string) => void;
}

const UnreadContext = createContext<UnreadContextValue | undefined>(undefined);

// Mirror of the server's MAX_UNREAD_BADGE (Message.ts). Kept as a local literal
// so this client module doesn't pull the DB-backed model into the bundle. Past
// this the UI shows "99+", so we never let a live count climb higher — a channel
// spammed with 1000 messages stays a clean, cheap "99+" instead of re-rendering
// on every increment up to 1000.
const MAX_UNREAD_BADGE = 100;

const LS_READ = "sc:unread:read";
const LS_ACTIVITY = "sc:unread:activity";
// Legacy per-channel read key used by useMentions (still powers the server rail's
// cross-server mention badges). Kept in sync so both systems agree on read state.
const LEGACY_READ_PREFIX = "mention-read:";

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

export function UnreadProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  // lastActivity/lastRead are ISO timestamp maps keyed by channelId. Initialized
  // lazily from localStorage (guarded for SSR) so persisted state is available
  // on first client render without a cascading setState-in-effect.
  const [lastActivity, setLastActivity] = useState<Record<string, string>>(() => loadMap(LS_ACTIVITY));
  const [lastRead, setLastRead] = useState<Record<string, string>>(() => loadMap(LS_READ));
  const [mentionCounts, setMentionCounts] = useState<Record<string, number>>({});

  // channelId -> serverId (+ type) so we can aggregate per server and route toasts.
  const [channelMeta, setChannelMeta] = useState<Record<string, ChannelMeta>>({});
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

  const persistActivity = useCallback((next: Record<string, string>) => {
    saveMap(LS_ACTIVITY, next);
  }, []);
  const persistRead = useCallback((next: Record<string, string>) => {
    saveMap(LS_READ, next);
  }, []);

  const markChannelRead = useCallback(
    (channelId: string) => {
      if (!channelId) return;
      // Clamp the read marker to at least the newest known activity for this
      // channel. Server-sent activity uses server time; a client clock running
      // behind the server would otherwise leave the channel stuck "unread"
      // right after you read it (read < activity). +1ms keeps it strictly ahead.
      const activityTs = lastActivityRef.current[channelId];
      const readMs = activityTs
        ? Math.max(Date.now(), new Date(activityTs).getTime() + 1)
        : Date.now();
      const now = new Date(readMs).toISOString();
      // Keep the legacy useMentions read key in sync (server-rail badges).
      if (typeof localStorage !== "undefined") {
        try {
          localStorage.setItem(`${LEGACY_READ_PREFIX}${channelId}`, String(Date.now()));
        } catch {
          /* ignore */
        }
      }
      setLastRead((prev) => {
        if (prev[channelId] === now) return prev;
        const next = { ...prev, [channelId]: now };
        persistRead(next);
        return next;
      });
      setMentionCounts((prev) => {
        if (!prev[channelId]) return prev;
        const next = { ...prev };
        delete next[channelId];
        return next;
      });
      // Persist the ack to the DB so read state follows the user across devices.
      // Fire-and-forget; the server resolves the channel's latest message id.
      void fetch("/api/users/@me/read-states", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId }),
      }).catch(() => {
        /* best-effort — localStorage already updated for this device */
      });
    },
    [persistRead]
  );

  const markServerRead = useCallback(
    (serverId: string) => {
      if (!serverId) return;
      for (const [channelId, meta] of Object.entries(channelMeta)) {
        if (meta.serverId === serverId) markChannelRead(channelId);
      }
    },
    [channelMeta, markChannelRead]
  );

  const setActiveChannel = useCallback(
    (channelId: string | null) => {
      activeChannelRef.current = channelId;
      if (channelId) markChannelRead(channelId);
    },
    [markChannelRead]
  );

  // Authoritative per-DM unread counts from the server. Replace (not add) so a
  // reload reflects the real number; never overwrite the count of the DM the
  // user is currently reading (it should stay cleared).
  const seedDmCounts = useCallback((counts: Record<string, number>) => {
    setMentionCounts((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const [channelId, count] of Object.entries(counts)) {
        if (channelId === activeChannelRef.current) {
          if (next[channelId]) { delete next[channelId]; changed = true; }
          continue;
        }
        // Skip channels the user already marked read locally. The server's
        // unreadCount may be stale because the fire-and-forget read-state POST
        // hasn't landed yet — re-seeding would resurrect the badge.
        const readTs = lastReadRef.current[channelId];
        const actTs = lastActivityRef.current[channelId];
        if (readTs && actTs && new Date(readTs).getTime() > new Date(actTs).getTime()) {
          if (next[channelId]) { delete next[channelId]; changed = true; }
          continue;
        }
        const desired = count > 0 ? count : undefined;
        if (next[channelId] !== desired) {
          if (desired === undefined) delete next[channelId];
          else next[channelId] = desired;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  const notifyDmActivity = useCallback((channelId: string, createdAt?: string) => {
    if (!channelId) return;
    const ts = createdAt || new Date().toISOString();
    setLastActivity((prev) => {
      if (prev[channelId] === ts) return prev;
      const next = { ...prev, [channelId]: ts };
      persistActivity(next);
      return next;
    });
    if (channelId === activeChannelRef.current) return; // reading it now
    setMentionCounts((prev) => {
      const current = prev[channelId] || 0;
      if (current >= MAX_UNREAD_BADGE) return prev; // already at "99+", skip re-render
      return { ...prev, [channelId]: current + 1 };
    });
  }, [persistActivity]);

  const registerChannels = useCallback((channels: ChannelMeta[]) => {
    setChannelMeta((prev) => {
      let metaChanged = false;
      const nextMeta = { ...prev };
      for (const ch of channels) {
        const existing = nextMeta[ch.id];
        if (!existing || existing.serverId !== ch.serverId || existing.lastMessageAt !== ch.lastMessageAt) {
          nextMeta[ch.id] = ch;
          metaChanged = true;
        }
      }
      return metaChanged ? nextMeta : prev;
    });
    let changed = false;
    setLastActivity((prev) => {
      const next = { ...prev };
      for (const ch of channels) {
        // Seed activity from the server's known last-message time so unread
        // persists across reloads / new devices.
        if (ch.lastMessageAt) {
          const existing = next[ch.id];
          if (!existing || new Date(ch.lastMessageAt) > new Date(existing)) {
            next[ch.id] = ch.lastMessageAt;
            changed = true;
          }
        }
      }
      if (changed) persistActivity(next);
      return changed ? next : prev;
    });
  }, [persistActivity]);

  // Seed the channel→server map + last-activity for EVERY server the user is in
  // (not just the open one) so the server-rail unread pill is correct on load.
  // ChannelSidebar only registers the currently-open server's channels; without
  // this, unread servers you haven't opened this session show nothing.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/users/@me/channel-activity");
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          channels?: Array<{ channelId: string; serverId: string; lastMessageAt: string | null }>;
        };
        if (cancelled || !data.channels?.length) return;
        registerChannels(
          data.channels.map((c) => ({
            id: c.channelId,
            serverId: c.serverId,
            type: "text",
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
        const res = await fetch("/api/users/@me/mentions");
        if (!res.ok) return;
        const data = await res.json();
        const readMap = loadMap(LS_READ);
        const counts: Record<string, number> = {};
        for (const m of (data.mentions || []) as Array<{ channelId: string; createdAt: string }>) {
          const readTs = readMap[m.channelId] ? new Date(readMap[m.channelId]).getTime() : 0;
          if (new Date(m.createdAt).getTime() > readTs) {
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

  // Cross-device read state: pull the DB read markers on login and merge them
  // into the local read map (newest wins per channel). This is what makes a
  // channel you read on your phone show as read on desktop, and vice-versa.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/users/@me/read-states");
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          readStates?: Array<{ channelId: string; lastReadAt: string | null }>;
        };
        if (cancelled || !data.readStates?.length) return;
        setLastRead((prev) => {
          const next = { ...prev };
          let changed = false;
          for (const rs of data.readStates!) {
            if (!rs.lastReadAt) continue;
            const localTs = next[rs.channelId] ? new Date(next[rs.channelId]).getTime() : 0;
            const dbTs = new Date(rs.lastReadAt).getTime();
            if (dbTs > localTs) {
              next[rs.channelId] = rs.lastReadAt;
              changed = true;
              // Keep the legacy mention-read key in sync so server-rail badges agree.
              if (typeof localStorage !== "undefined") {
                try {
                  localStorage.setItem(`${LEGACY_READ_PREFIX}${rs.channelId}`, String(dbTs));
                } catch {
                  /* ignore */
                }
              }
            }
          }
          if (changed) persistRead(next);
          return changed ? next : prev;
        });
      } catch {
        /* best-effort — localStorage remains the fallback */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, persistRead]);

  // Live activity stream.
  useEffect(() => {
    if (!user) return;
    const es = new EventSource("/api/users/@me/activity", { withCredentials: true });

    es.onmessage = (ev) => {
      let data: ActivityEvent | { type: string };
      try {
        data = JSON.parse(ev.data);
      } catch {
        return;
      }

      // Cross-device read receipt: another of this user's sessions read a
      // channel. Advance our read marker + clear its badge locally — no re-POST
      // (that device already persisted it), so devices converge without loops.
      if (data.type === "read_state") {
        const { channelId, lastReadAt } = data as { channelId?: string; lastReadAt?: string };
        if (!channelId || !lastReadAt) return;
        setLastRead((prev) => {
          const localTs = prev[channelId] ? new Date(prev[channelId]).getTime() : 0;
          if (new Date(lastReadAt).getTime() <= localTs) return prev;
          const next = { ...prev, [channelId]: lastReadAt };
          persistRead(next);
          if (typeof localStorage !== "undefined") {
            try { localStorage.setItem(`${LEGACY_READ_PREFIX}${channelId}`, String(new Date(lastReadAt).getTime())); } catch { /* ignore */ }
          }
          return next;
        });
        setMentionCounts((prev) => {
          if (!prev[channelId]) return prev;
          const next = { ...prev }; delete next[channelId]; return next;
        });
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
          persistActivity(next);
          return next;
        });
        return;
      }

      // DM activity: a DM message arrived while the user is not viewing the DM
      // list. The DM SSE stream only fires while the DM list is open; this event
      // comes through the always-connected activity stream so DM unread badges
      // appear in realtime regardless of which view the user is in.
      if (data.type === "dm_activity") {
        const { channelId, authorId, createdAt } = data as { channelId?: string; authorId?: string; createdAt?: string };
        if (!channelId || !authorId || authorId === user.id) return;
        const ts = createdAt || new Date().toISOString();
        setLastActivity((prev) => {
          if (prev[channelId] === ts) return prev;
          const next = { ...prev, [channelId]: ts };
          persistActivity(next);
          return next;
        });
        if (activeChannelRef.current === channelId) return;
        setMentionCounts((prev) => {
          const current = prev[channelId] || 0;
          if (current >= MAX_UNREAD_BADGE) return prev;
          return { ...prev, [channelId]: current + 1 };
        });
        return;
      }

      if (data.type !== "channel_activity") return;
      const event = data as ActivityEvent;
      if (event.authorId === user.id) return; // own messages aren't unread

      const isActive = activeChannelRef.current === event.channelId;
      const mentionsMe =
        event.mentionEveryone || (event.mentionedUserIds || []).includes(user.id);

      // Keep the channel→server map current so per-server unread aggregation
      // works for channels the sidebar hasn't registered (e.g. a server the
      // user hasn't opened this session, or a brand-new channel).
      if (event.serverId) {
        setChannelMeta((prev) => {
          const existing = prev[event.channelId];
          if (existing && existing.serverId === event.serverId) return prev;
          return {
            ...prev,
            [event.channelId]: { id: event.channelId, serverId: event.serverId, type: "text" },
          };
        });
      }

      if (!isActive) {
        setLastActivity((prev) => {
          const next = { ...prev, [event.channelId]: event.createdAt };
          persistActivity(next);
          return next;
        });

        if (mentionsMe) {
          setMentionCounts((prev) => {
            const current = prev[event.channelId] || 0;
            if (current >= MAX_UNREAD_BADGE) return prev; // "99+" already; no re-render
            return { ...prev, [event.channelId]: current + 1 };
          });
          const label = event.channelName ? `#${event.channelName}` : "a channel";
          const who = event.authorName || "Someone";
          toast(`${who} mentioned you in ${label}`, {
            action: {
              label: "Jump",
              onClick: () => {
                if (event.serverId) {
                  window.location.href = `/channels/${event.serverId}/${event.channelId}`;
                }
              },
            },
          });
        }
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects; nothing to do.
    };

    return () => es.close();
  }, [user, persistActivity, persistRead]);

  const isChannelUnread = useCallback(
    (channelId: string) => {
      if (activeChannelRef.current === channelId) return false;
      const act = lastActivity[channelId];
      if (!act) return false;
      const read = lastRead[channelId];
      if (!read) return true;
      return new Date(act).getTime() > new Date(read).getTime();
    },
    [lastActivity, lastRead]
  );

  const getMentionCount = useCallback(
    (channelId: string) => mentionCounts[channelId] || 0,
    [mentionCounts]
  );

  // Per-server aggregation derived from the registered channel→server map.
  const { serverUnread, serverMentionCounts } = useMemo(() => {
    const unread = new Set<string>();
    const counts = new Map<string, number>();
    for (const [channelId, meta] of Object.entries(channelMeta)) {
      if (!meta.serverId) continue;
      // Inline unread check (active channel is kept read via markChannelRead, so
      // no need to special-case it here — this also avoids reading a ref in render).
      const act = lastActivity[channelId];
      if (act) {
        const read = lastRead[channelId];
        if (!read || new Date(act).getTime() > new Date(read).getTime()) {
          unread.add(meta.serverId);
        }
      }
      const mc = mentionCounts[channelId] || 0;
      if (mc > 0) counts.set(meta.serverId, (counts.get(meta.serverId) || 0) + mc);
    }
    return { serverUnread: unread, serverMentionCounts: counts };
  }, [lastActivity, lastRead, mentionCounts, channelMeta]);

  const isServerUnread = useCallback((serverId: string) => serverUnread.has(serverId), [serverUnread]);
  const getServerMentionCount = useCallback(
    (serverId: string) => serverMentionCounts.get(serverId) || 0,
    [serverMentionCounts]
  );

  // App-wide aggregates for the mobile bottom-nav badges. DM channels register
  // without a serverId, so "no serverId" == a DM/group conversation.
  const totalDmUnreadCount = useMemo(() => {
    let sum = 0;
    for (const [channelId, meta] of Object.entries(channelMeta)) {
      if (meta.serverId) continue;
      sum += mentionCounts[channelId] || 0;
    }
    return sum;
  }, [channelMeta, mentionCounts]);

  const totalMentionCount = useMemo(() => {
    let sum = 0;
    for (const c of serverMentionCounts.values()) sum += c;
    return sum;
  }, [serverMentionCounts]);

  const value = useMemo<UnreadContextValue>(
    () => ({
      isChannelUnread,
      getMentionCount,
      isServerUnread,
      getServerMentionCount,
      totalDmUnreadCount,
      totalMentionCount,
      markChannelRead,
      markServerRead,
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
      totalDmUnreadCount,
      totalMentionCount,
      markChannelRead,
      markServerRead,
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
  totalDmUnreadCount: 0,
  totalMentionCount: 0,
  markChannelRead: () => {},
  markServerRead: () => {},
  registerChannels: () => {},
  setActiveChannel: () => {},
  seedDmCounts: () => {},
  notifyDmActivity: () => {},
};

export function useUnread() {
  return useContext(UnreadContext) ?? NOOP_UNREAD;
}
