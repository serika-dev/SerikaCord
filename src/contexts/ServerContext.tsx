"use client";

import { createContext, useContext, useEffect, useState, ReactNode, useCallback, useRef, useTransition } from "react";

interface Server {
  id: string;
  name: string;
  icon?: string;
  ownerId: string;
}

type ChannelType = 
  | "text" 
  | "voice" 
  | "category" 
  | "announcement" 
  | "stage" 
  | "forum" 
  | "dm" 
  | "group_dm";

interface Channel {
  id: string;
  name: string;
  type: ChannelType;
  serverId: string;
  position: number;
  parentId?: string; // Category parent
  isNsfw?: boolean;
  topic?: string;
}

interface ServerContextType {
  servers: Server[];
  currentServer: Server | null;
  channels: Channel[];
  currentChannel: Channel | null;
  isLoading: boolean;
  isTransitioning: boolean;
  setCurrentServer: (server: Server | null) => void;
  setCurrentChannel: (channel: Channel | null) => void;
  clearContext: () => void;
  fetchServers: () => Promise<void>;
  fetchChannels: (serverId: string) => Promise<void>;
  createServer: (name: string, icon?: File) => Promise<Server>;
  joinServer: (inviteCode: string) => Promise<void>;
  leaveServer: (serverId: string) => Promise<void>;
  deleteChannel: (channelId: string) => Promise<void>;
  updateChannel: (channelId: string, data: { name?: string; topic?: string }) => Promise<void>;
}

const ServerContext = createContext<ServerContextType | undefined>(undefined);

export function ServerProvider({ children }: { children: ReactNode }) {
  const [servers, setServers] = useState<Server[]>([]);
  const [currentServer, setCurrentServerState] = useState<Server | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [currentChannel, setCurrentChannel] = useState<Channel | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isTransitioning, startTransition] = useTransition();
  const channelCacheRef = useRef<Map<string, Channel[]>>(new Map());

  // Clear all context (used when switching to DMs)
  const clearContext = useCallback(() => {
    startTransition(() => {
      setCurrentServerState(null);
      setChannels([]);
      setCurrentChannel(null);
    });
  }, []);

  // Set current server with transition
  const setCurrentServer = useCallback((server: Server | null) => {
    startTransition(() => {
      if (!server) {
        setCurrentServerState(null);
        setChannels([]);
        setCurrentChannel(null);
      } else {
        setCurrentServerState(server);
        // Load cached channels immediately if available
        const cachedChannels = channelCacheRef.current.get(server.id);
        if (cachedChannels) {
          setChannels(cachedChannels);
        }
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
        }));
        // Cache channels for faster switching
        channelCacheRef.current.set(serverId, transformedChannels);
        setChannels(transformedChannels);
      }
    } catch (error) {
      console.error("Failed to fetch channels:", error);
    }
  }, []);

  const createServer = async (name: string, icon?: File): Promise<Server> => {
    let iconUrl: string | undefined;
    
    // Upload icon first if provided
    if (icon) {
      const formData = new FormData();
      formData.append("file", icon);
      formData.append("type", "server-icon");
      
      const uploadResponse = await fetch("/api/uploads/icon", {
        method: "POST",
        body: formData,
      });
      
      if (uploadResponse.ok) {
        const uploadData = await uploadResponse.json();
        iconUrl = uploadData.url;
      }
    }

    const response = await fetch("/api/servers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, icon: iconUrl }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "Failed to create server");
    }

    const data = await response.json();
    const server = data.server || data;
    setServers((prev) => [...prev, server]);
    return server;
  };

  const joinServer = async (inviteCode: string) => {
    const response = await fetch(`/api/invites/${inviteCode}`, {
      method: "POST",
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "Failed to join server");
    }

    await fetchServers();
  };

  const leaveServer = async (serverId: string) => {
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
  };

  const deleteChannel = async (channelId: string) => {
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
  };

  const updateChannel = async (channelId: string, data: { name?: string; topic?: string }) => {
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
  };

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  useEffect(() => {
    if (currentServer) {
      fetchChannels(currentServer.id);
    }
  }, [currentServer, fetchChannels]);

  // Use currentServerState for the provider
  const currentServerValue = currentServer;

  return (
    <ServerContext.Provider
      value={{
        servers,
        currentServer: currentServerValue,
        channels,
        currentChannel,
        isLoading,
        isTransitioning,
        setCurrentServer,
        setCurrentChannel,
        clearContext,
        fetchServers,
        fetchChannels,
        createServer,
        joinServer,
        leaveServer,
        deleteChannel,
        updateChannel,
      }}
    >
      {children}
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
