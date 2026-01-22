"use client";

import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";

interface Server {
  id: string;
  name: string;
  icon?: string;
  ownerId: string;
}

interface Channel {
  id: string;
  name: string;
  type: "text" | "voice" | "announcement";
  serverId: string;
  position: number;
}

interface ServerContextType {
  servers: Server[];
  currentServer: Server | null;
  channels: Channel[];
  currentChannel: Channel | null;
  isLoading: boolean;
  setCurrentServer: (server: Server | null) => void;
  setCurrentChannel: (channel: Channel | null) => void;
  fetchServers: () => Promise<void>;
  fetchChannels: (serverId: string) => Promise<void>;
  createServer: (name: string, icon?: File) => Promise<Server>;
  joinServer: (inviteCode: string) => Promise<void>;
}

const ServerContext = createContext<ServerContextType | undefined>(undefined);

export function ServerProvider({ children }: { children: ReactNode }) {
  const [servers, setServers] = useState<Server[]>([]);
  const [currentServer, setCurrentServer] = useState<Server | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [currentChannel, setCurrentChannel] = useState<Channel | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchServers = useCallback(async () => {
    try {
      const response = await fetch("/api/users/@me/servers");
      if (response.ok) {
        const data = await response.json();
        setServers(data);
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
        setChannels(data);
      }
    } catch (error) {
      console.error("Failed to fetch channels:", error);
    }
  }, []);

  const createServer = async (name: string, icon?: File): Promise<Server> => {
    const formData = new FormData();
    formData.append("name", name);
    if (icon) {
      formData.append("icon", icon);
    }

    const response = await fetch("/api/servers", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "Failed to create server");
    }

    const server = await response.json();
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

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  useEffect(() => {
    if (currentServer) {
      fetchChannels(currentServer.id);
    } else {
      setChannels([]);
      setCurrentChannel(null);
    }
  }, [currentServer, fetchChannels]);

  return (
    <ServerContext.Provider
      value={{
        servers,
        currentServer,
        channels,
        currentChannel,
        isLoading,
        setCurrentServer,
        setCurrentChannel,
        fetchServers,
        fetchChannels,
        createServer,
        joinServer,
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
