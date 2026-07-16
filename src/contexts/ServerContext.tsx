"use client";

import { createContext, useContext, useEffect, useState, ReactNode, useCallback, useRef, useTransition, useMemo } from "react";
import { usePolling } from "@/hooks/usePolling";
import { prefetchChannelMessages } from "@/hooks/useChatSession";
import { notifyServersChanged } from "@/lib/notifyServersChanged";

interface Server {
  id: string;
  name: string;
  icon?: string;
  banner?: string | null;
  ownerId: string;
  isOwner?: boolean;
  isPartnered?: boolean;
  isAgeGated?: boolean;
  description?: string;
  memberCount?: number;
  onlineCount?: number;
  systemChannelId?: string | null;
  rulesChannelId?: string | null;
  afkChannelId?: string | null;
  afkTimeout?: number;
}

type ChannelType =
  | "text"
  | "voice"
  | "category"
  | "announcement"
  | "stage"
  | "forum"
  | "public_thread"
  | "private_thread"
  | "dm"
  | "group_dm";

interface PermissionOverwrite {
  id: string;
  type: 'role' | 'member';
  allow: string;
  deny: string;
}

interface Channel {
  id: string;
  name: string;
  type: ChannelType;
  serverId: string;
  position: number;
  parentId?: string; // Category parent, or parent forum for threads
  parentName?: string; // Parent forum name for threads
  isNsfw?: boolean;
  topic?: string;
  rateLimitPerUser?: number;
  permissionOverwrites?: PermissionOverwrite[];
  lastMessageAt?: string | null;
}

interface ServerContextType {
  servers: Server[];
  currentServer: Server | null;
  channels: Channel[];
  /** The server id that the current `channels` array belongs to, or null while
   * they are being (re)loaded for a newly selected server. Consumers use this to
   * avoid deriving state from a stale channel list mid server-switch. */
  channelsServerId: string | null;
  currentChannel: Channel | null;
  isLoading: boolean;
  isTransitioning: boolean;
  setCurrentServer: (server: Server | null) => void;
  setCurrentChannel: (channel: Channel | null) => void;
  clearContext: () => void;
  fetchServers: () => Promise<void>;
  fetchChannels: (serverId: string) => Promise<void>;
  /** Warm channel list + top channel messages for a server (e.g. on hover). */
  prefetchServer: (serverId: string) => void;
  createServer: (name: string, icon?: File) => Promise<Server>;
  joinServer: (inviteCode: string) => Promise<void>;
  leaveServer: (serverId: string) => Promise<void>;
  deleteChannel: (channelId: string) => Promise<void>;
  updateChannel: (channelId: string, data: { name?: string; topic?: string; nsfw?: boolean; parentId?: string | null; position?: number; rateLimitPerUser?: number; permissionOverwrites?: PermissionOverwrite[]; type?: string; forumMode?: 'posts' | 'tickets'; ticketAccessRoleIds?: string[]; availableTags?: Array<{ id?: string; name: string; moderated?: boolean; emojiName?: string }>; archived?: boolean; locked?: boolean }) => Promise<void>;
  reorderChannels: (serverId: string, channelUpdates: Array<{ id: string; position: number; parentId?: string | null }>) => Promise<void>;
  fetchMembers: (serverId: string) => Promise<void>;
}

const ServerContext = createContext<ServerContextType | undefined>(undefined);

// Members live in a SEPARATE context so the 30s member poll (and per-navigation
// member refetches) only re-render the member list + chat, not every one of the
// ~19 useServer() consumers (sidebars, server list, etc.).
interface ServerMembersContextType {
  members: any[];
  isMembersLoading: boolean;
  /**
   * Optimistically patch a member's roles in the sidebar without waiting for
   * the 30s poll. `roles` must be full role objects (id/name/color/hoist/
   * position) so hoist-grouping and name colour recompute correctly.
   */
  applyMemberRoles: (userId: string, roles: any[]) => void;
}

const ServerMembersContext = createContext<ServerMembersContextType | undefined>(undefined);

// ── localStorage stale-while-revalidate ────────────────────────────────────
// Persist the servers list and per-server channels so a reload paints instantly
// from cache while the network refetch happens in the background. Purely a
// perceived-performance win; the fetch still runs and overwrites with fresh data.
const LS_SERVERS = "sc:servers";
const LS_CHANNELS_PREFIX = "sc:channels:";

function lsGet<T>(key: string): T | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function lsSet(key: string, value: unknown) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / disabled — ignore */
  }
}

export function ServerProvider({ children }: { children: ReactNode }) {
  const [servers, setServers] = useState<Server[]>([]);
  const [currentServer, setCurrentServerState] = useState<Server | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelsServerId, setChannelsServerId] = useState<string | null>(null);
  const [currentChannel, setCurrentChannel] = useState<Channel | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [members, setMembers] = useState<any[]>([]);
  const [isMembersLoading, setIsMembersLoading] = useState(false);
  const lastMembersServerIdRef = useRef<string | null>(null);
  const [isTransitioning, startTransition] = useTransition();
  const channelCacheRef = useRef<Map<string, Channel[]>>(new Map());

  // Clear all context (used when switching to DMs)
  const clearContext = useCallback(() => {
    startTransition(() => {
      setCurrentServerState(null);
      setChannels([]);
      setChannelsServerId(null);
      setCurrentChannel(null);
    });
  }, []);

  // Tracks the active server id so switches can be detected without a stale
  // closure (setCurrentServer is a stable callback).
  const activeServerIdRef = useRef<string | null>(null);

  // Set current server with transition
  const setCurrentServer = useCallback((server: Server | null) => {
    startTransition(() => {
      if (!server) {
        activeServerIdRef.current = null;
        setCurrentServerState(null);
        setChannels([]);
        setChannelsServerId(null);
        setCurrentChannel(null);
        return;
      }

      const isSwitch = activeServerIdRef.current !== server.id;
      activeServerIdRef.current = server.id;
      setCurrentServerState(server);

      const cached =
        channelCacheRef.current.get(server.id) ||
        lsGet<Channel[]>(LS_CHANNELS_PREFIX + server.id) ||
        undefined;
      if (cached) {
        // Warm the in-memory cache from localStorage on first access.
        channelCacheRef.current.set(server.id, cached);
        setChannels(cached);
        setChannelsServerId(server.id);
      } else if (isSwitch) {
        // Switching to a server whose channels aren't cached yet: clear the
        // old server's channels/selection so its chat doesn't linger. The
        // context effect below refetches channels for the new server.
        setChannels([]);
        setChannelsServerId(null);
        setCurrentChannel(null);
      }
    });
  }, []);

  const fetchServers = useCallback(async () => {
    try {
      const response = await fetch("/api/users/@me/servers");
      if (response.ok) {
        const data = await response.json();
        // Transform _id to id if needed
        const transformedServers = (Array.isArray(data) ? data : []).map((s: any) => ({
          id: s.id || s._id,
          name: s.name,
          icon: s.icon,
          ownerId: s.ownerId || s.isOwner,
          ...s,
        }));
        setServers(transformedServers);
        lsSet(LS_SERVERS, transformedServers);
        // Also update currentServer if it exists in the new list (keeps banner, icon, etc. in sync)
        setCurrentServerState((prev) => {
          if (!prev) return prev;
          const updated = transformedServers.find((s: Server) => s.id === prev.id);
          return updated || prev;
        });
      }
    } catch (error) {
      console.error("Failed to fetch servers:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchChannels = useCallback(async (serverId: string) => {
    try {
      const response = await fetch(`/api/servers/${serverId}/channels`);
      if (response.ok) {
        const data = await response.json();
        // Handle both array and wrapped response, transform _id to id if needed
        const channelsArray = Array.isArray(data) ? data : (data.channels || []);
        const transformedChannels = channelsArray.map((c: any) => ({
          id: c.id || c._id,
          name: c.name,
          type: c.type,
          serverId: c.serverId,
          position: c.position,
          parentId: c.parentId || null,
          isNsfw: c.nsfw || c.isNsfw,
          topic: c.topic,
          rateLimitPerUser: c.rateLimitPerUser || 0,
          permissionOverwrites: c.permissionOverwrites || [],
          lastMessageAt: c.lastMessageAt || null,
        }));
        // Cache channels for faster switching (in-memory + localStorage for
        // instant paint on reload).
        channelCacheRef.current.set(serverId, transformedChannels);
        lsSet(LS_CHANNELS_PREFIX + serverId, transformedChannels);
        // Guard against a slow response for a previously-selected server
        // overwriting the active server's channels after a fast switch. We still
        // cache above so the data is warm if the user returns.
        if (activeServerIdRef.current !== serverId) return;
        setChannels(transformedChannels);
        setChannelsServerId(serverId);
      }
    } catch (error) {
      console.error("Failed to fetch channels:", error);
    }
  }, []);

  // Warm a server before the user clicks it: fetch its channel list into the
  // cache (so the sidebar paints instantly) and prefetch the most recently
  // active text channel's messages (so landing in it is instant). Deduped so
  // repeated hovers don't refetch. Best-effort and non-blocking.
  const prefetchedServersRef = useRef<Set<string>>(new Set());
  const prefetchServer = useCallback((serverId: string) => {
    if (!serverId || prefetchedServersRef.current.has(serverId)) return;
    prefetchedServersRef.current.add(serverId);
    void (async () => {
      try {
        let list = channelCacheRef.current.get(serverId);
        if (!list) {
          const res = await fetch(`/api/servers/${serverId}/channels`);
          if (!res.ok) return;
          const data = await res.json();
          const arr = Array.isArray(data) ? data : data.channels || [];
          list = arr.map((c: any) => ({
            id: c.id || c._id,
            name: c.name,
            type: c.type,
            serverId: c.serverId,
            position: c.position,
            parentId: c.parentId || null,
            isNsfw: c.nsfw || c.isNsfw,
            topic: c.topic,
            rateLimitPerUser: c.rateLimitPerUser || 0,
            permissionOverwrites: c.permissionOverwrites || [],
            lastMessageAt: c.lastMessageAt || null,
          }));
          channelCacheRef.current.set(serverId, list!);
          lsSet(LS_CHANNELS_PREFIX + serverId, list);
        }
        const top = [...(list || [])]
          .filter((c) => c.type === "text" || c.type === "announcement")
          .sort(
            (a, b) =>
              (b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0) -
              (a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0)
          )[0];
        if (top) void prefetchChannelMessages(`/api/channels/${top.id}`);
      } catch {
        // best-effort — a failed prefetch just means the normal load runs
        prefetchedServersRef.current.delete(serverId);
      }
    })();
  }, []);

  const fetchMembers = useCallback(async (serverId: string) => {
    if (!serverId) return;
    const isSwitch = lastMembersServerIdRef.current !== serverId;
    if (isSwitch) {
      setIsMembersLoading(true);
      setMembers([]);
      lastMembersServerIdRef.current = serverId;
    }

    try {
      const response = await fetch(`/api/servers/${serverId}/members?limit=1000`);
      if (response.ok) {
        const data = await response.json();
        const rawMembers = Array.isArray(data) ? data : data?.members || [];
        // Only update state if the data actually changed to avoid unnecessary re-renders
        setMembers(prev => {
          if (!isSwitch && prev.length === rawMembers.length) {
            // Lightweight signature comparison instead of full JSON.stringify
            const sig = (m: any) => `${m.id}|${m.status}|${m.displayName || m.username}|${m.avatar || ""}|${m.customStatus || ""}|${m.communicationDisabledUntil || ""}|${JSON.stringify(m.customization?.nameplate || "")}|${(m.roles || []).map((r: any) => r.id).join(",")}`;
            const prevSig = prev.map(sig).join("\n");
            const newSig = rawMembers.map(sig).join("\n");
            if (prevSig === newSig) return prev;
          }
          return rawMembers;
        });
      } else if (isSwitch) {
        setMembers([]);
      }
    } catch (error) {
      console.error("Failed to fetch members:", error);
      if (isSwitch) {
        setMembers([]);
      }
    } finally {
      setIsMembersLoading(false);
    }
  }, []);

  const applyMemberRoles = useCallback((userId: string, roles: any[]) => {
    setMembers((prev) => {
      let changed = false;
      const next = prev.map((m) => {
        if (m.id !== userId && m.membershipId !== userId) return m;
        changed = true;
        const byPos = [...roles].sort((a, b) => (b.position ?? 0) - (a.position ?? 0));
        const highestHoisted = byPos.find((r) => r.hoist) || null;
        const highest = byPos.find((r) => !r.isDefault) || byPos[0] || null;
        return {
          ...m,
          roles,
          highestRole: highest ?? m.highestRole ?? null,
          highestHoistedRole: highestHoisted,
        };
      });
      return changed ? next : prev;
    });
  }, []);

  const createServer = useCallback(async (name: string, icon?: File): Promise<Server> => {
    const response = await fetch("/api/servers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "Failed to create server");
    }

    const data = await response.json();
    const raw = data.server || data;
    // The create response may carry `_id` rather than `id`; normalize it so
    // the new server has a stable key and is clickable/navigable immediately.
    const server: Server = { ...raw, id: raw.id || raw._id };

    // Upload the icon now that the server exists. The upload endpoint keyed by
    // serverId is the only one that actually persists the icon.
    if (icon) {
      const formData = new FormData();
      formData.append("file", icon);
      try {
        const uploadResponse = await fetch(`/api/upload/server/${server.id}/icon`, {
          method: "POST",
          body: formData,
        });
        if (uploadResponse.ok) {
          const uploadData = await uploadResponse.json();
          if (uploadData.url) server.icon = uploadData.url;
        }
      } catch {
        // Non-fatal: server is created, icon can be set later in settings.
      }
    }
    setServers((prev) => {
      if (prev.some((s) => s.id === server.id)) return prev;
      return [...prev, server];
    });
    return server;
  }, []);

  const joinServer = useCallback(async (inviteCode: string) => {
    const response = await fetch(`/api/invites/${inviteCode}`, {
      method: "POST",
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "Failed to join server");
    }

    await fetchServers();
    notifyServersChanged();
  }, [fetchServers]);

  const leaveServer = useCallback(async (serverId: string) => {
    const response = await fetch(`/api/servers/${serverId}/leave`, {
      method: "POST",
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "Failed to leave server");
    }

    // Remove server from list and clear current server if it was the one we left
    setServers((prev) => prev.filter((s) => s.id !== serverId));
    if (currentServer?.id === serverId) {
      setCurrentServer(null);
      setCurrentChannel(null);
    }
    notifyServersChanged();
  }, [currentServer, setCurrentServer]);

  const deleteChannel = useCallback(async (channelId: string) => {
    const response = await fetch(`/api/channels/${channelId}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "Failed to delete channel");
    }

    // Remove channel from list
    setChannels((prev) => prev.filter((c) => c.id !== channelId));
    if (currentChannel?.id === channelId) {
      setCurrentChannel(null);
    }
  }, [currentChannel]);

  const updateChannel = useCallback(async (channelId: string, data: { name?: string; topic?: string; nsfw?: boolean; parentId?: string | null; position?: number; rateLimitPerUser?: number; permissionOverwrites?: PermissionOverwrite[]; type?: string; forumMode?: 'posts' | 'tickets'; ticketAccessRoleIds?: string[]; availableTags?: Array<{ id?: string; name: string; moderated?: boolean; emojiName?: string }>; archived?: boolean; locked?: boolean }) => {
    const response = await fetch(`/api/channels/${channelId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const responseData = await response.json();
      throw new Error(responseData.error || "Failed to update channel");
    }

    const updatedChannel = await response.json();
    // Update channel in list
    setChannels((prev) => prev.map((c) => c.id === channelId ? { ...c, ...updatedChannel.channel } : c));
    // Update cache too
    if (currentServer) {
      const cached = channelCacheRef.current.get(currentServer.id);
      if (cached) {
        channelCacheRef.current.set(
          currentServer.id,
          cached.map((c) => c.id === channelId ? { ...c, ...updatedChannel.channel } : c)
        );
      }
    }
  }, [currentServer]);

  const reorderChannels = useCallback(async (serverId: string, channelUpdates: Array<{ id: string; position: number; parentId?: string | null }>) => {
    const response = await fetch(`/api/servers/${serverId}/channels/reorder`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channels: channelUpdates }),
    });

    if (!response.ok) {
      const responseData = await response.json();
      throw new Error(responseData.error || "Failed to reorder channels");
    }

    const data = await response.json();
    if (data.channels) {
      const transformedChannels: Channel[] = data.channels.map((c: any) => ({
        id: c.id || c._id,
        name: c.name,
        type: c.type,
        serverId: c.serverId,
        position: c.position,
        parentId: c.parentId || null,
        isNsfw: c.nsfw || c.isNsfw,
        topic: c.topic,
        rateLimitPerUser: c.rateLimitPerUser || 0,
      }));
      setChannels(transformedChannels);
      channelCacheRef.current.set(serverId, transformedChannels);
    }
  }, []);

  // Load cached servers from localStorage on mount (client-only) to paint
  // instantly while the network refetch happens in the background.
  useEffect(() => {
    const cached = lsGet<Server[]>(LS_SERVERS);
    if (cached && cached.length > 0) {
      setServers(cached);
    }
  }, []);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  useEffect(() => {
    if (currentServer) {
      fetchChannels(currentServer.id);
      fetchMembers(currentServer.id);
    } else {
      setMembers([]);
      lastMembersServerIdRef.current = null;
    }
  }, [currentServer, fetchChannels, fetchMembers]);

  usePolling(
    () => {
      if (currentServer) {
        fetchMembers(currentServer.id);
      }
    },
    30000,
    !!currentServer,
    currentServer?.id
  );

  // Keep the server rail live: refetch the joined-servers list on tab
  // focus/visibility and on a slow interval. This makes a server joined via an
  // invite/vanity link (which client-navigates without remounting this
  // provider) or in another tab appear in the sidebar without a manual reload.
  usePolling(fetchServers, 25000);

  // Cross-tab / cross-route signal: any join flow can broadcast so every open
  // client refreshes its server list immediately instead of waiting for the poll.
  useEffect(() => {
    const refresh = () => void fetchServers();
    let bc: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      bc = new BroadcastChannel("sc:servers");
      bc.onmessage = (e) => {
        if (e.data === "changed") refresh();
      };
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === "sc:servers-changed") refresh();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      bc?.close();
      window.removeEventListener("storage", onStorage);
    };
  }, [fetchServers]);

  // Memoize the context value so consumers only re-render when a field they
  // actually depend on changes — not on every provider render (e.g. the 30s
  // member poll, which now lives in a separate context below).
  const value = useMemo<ServerContextType>(
    () => ({
      servers,
      currentServer,
      channels,
      channelsServerId,
      currentChannel,
      isLoading,
      isTransitioning,
      setCurrentServer,
      setCurrentChannel,
      clearContext,
      fetchServers,
      fetchChannels,
      prefetchServer,
      createServer,
      joinServer,
      leaveServer,
      deleteChannel,
      updateChannel,
      reorderChannels,
      fetchMembers,
    }),
    [
      servers, currentServer, channels, channelsServerId, currentChannel, isLoading, isTransitioning,
      setCurrentServer, setCurrentChannel, clearContext, fetchServers, fetchChannels,
      prefetchServer, createServer, joinServer, leaveServer, deleteChannel,
      updateChannel, reorderChannels, fetchMembers,
    ]
  );

  const membersValue = useMemo<ServerMembersContextType>(
    () => ({ members, isMembersLoading, applyMemberRoles }),
    [members, isMembersLoading, applyMemberRoles]
  );

  return (
    <ServerContext.Provider value={value}>
      <ServerMembersContext.Provider value={membersValue}>
        {children}
      </ServerMembersContext.Provider>
    </ServerContext.Provider>
  );
}

export function useServer() {
  const context = useContext(ServerContext);
  if (context === undefined) {
    throw new Error("useServer must be used within a ServerProvider");
  }
  return context;
}

export function useServerMembers() {
  const context = useContext(ServerMembersContext);
  if (context === undefined) {
    throw new Error("useServerMembers must be used within a ServerProvider");
  }
  return context;
}

/** Like useServerMembers but returns undefined instead of throwing when used
 *  outside a ServerProvider (e.g. ProfileCard rendered in a DM). */
export function useServerMembersOptional() {
  return useContext(ServerMembersContext);
}
