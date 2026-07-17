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
  markChannelRead: (channelId: string) => void;
  /** Feed the sidebar's channel list so we know channel→server + last activity. */
  registerChannels: (channels: ChannelMeta[]) => void;
  /** Called when the user opens a channel — marks it read + preps preload. */
  setActiveChannel: (channelId: string | null) => void;
}

const UnreadContext = createContext<UnreadContextValue | undefined>(undefined);

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

  const setActiveChannel = useCallback(
    (channelId: string | null) => {
      activeChannelRef.current = channelId;
      if (channelId) markChannelRead(channelId);
    },
    [markChannelRead]
  );

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
            counts[m.channelId] = (counts[m.channelId] || 0) + 1;
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
      if (data.type !== "channel_activity") return;
      const event = data as ActivityEvent;
      if (event.authorId === user.id) return; // own messages aren't unread

      const isActive = activeChannelRef.current === event.channelId;
      const mentionsMe =
        event.mentionEveryone || (event.mentionedUserIds || []).includes(user.id);

      if (!isActive) {
        setLastActivity((prev) => {
          const next = { ...prev, [event.channelId]: event.createdAt };
          persistActivity(next);
          return next;
        });

        if (mentionsMe) {
          setMentionCounts((prev) => ({
            ...prev,
            [event.channelId]: (prev[event.channelId] || 0) + 1,
          }));
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
  }, [user, persistActivity]);

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

  const value = useMemo<UnreadContextValue>(
    () => ({
      isChannelUnread,
      getMentionCount,
      isServerUnread,
      getServerMentionCount,
      markChannelRead,
      registerChannels,
      setActiveChannel,
    }),
    [
      isChannelUnread,
      getMentionCount,
      isServerUnread,
      getServerMentionCount,
      markChannelRead,
      registerChannels,
      setActiveChannel,
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
  markChannelRead: () => {},
  registerChannels: () => {},
  setActiveChannel: () => {},
};

export function useUnread() {
  return useContext(UnreadContext) ?? NOOP_UNREAD;
}
