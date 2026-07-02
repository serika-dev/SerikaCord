"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export interface MentionData {
  id: string;
  content: string;
  channelId: string;
  channelName: string;
  serverId: string;
  createdAt: string;
  author: {
    id: string;
    username: string;
    displayName: string;
    avatar?: string;
  } | null;
}

interface MentionApiResponse {
  servers: { id: string }[];
  mentions: MentionData[];
}

const READ_KEY_PREFIX = "mention-read:";
const POLL_INTERVAL = 30_000;

function getChannelReadTimestamp(channelId: string): number {
  if (typeof localStorage === "undefined") return 0;
  const raw = localStorage.getItem(`${READ_KEY_PREFIX}${channelId}`);
  return raw ? parseInt(raw, 10) : 0;
}

function setChannelReadTimestamp(channelId: string, ts: number) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(`${READ_KEY_PREFIX}${channelId}`, String(ts));
}

export function useMentions(serverId?: string) {
  const [mentions, setMentions] = useState<MentionData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [readVersion, setReadVersion] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const fetchMentions = useCallback(async () => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const url = serverId
        ? `/api/users/@me/mentions?serverId=${encodeURIComponent(serverId)}`
        : "/api/users/@me/mentions";
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        setError("Failed to fetch mentions");
        return;
      }
      const data: MentionApiResponse = await res.json();
      setMentions(data.mentions || []);
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError("Failed to fetch mentions");
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    void fetchMentions();
    const interval = setInterval(() => void fetchMentions(), POLL_INTERVAL);
    return () => {
      clearInterval(interval);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [fetchMentions]);

  // Recompute unread state when readVersion changes (after markChannelRead)
  const unreadMentions = (() => {
    return mentions.filter((m) => {
      const readTs = getChannelReadTimestamp(m.channelId);
      return new Date(m.createdAt).getTime() > readTs;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  })();

  // Per-channel unread counts
  const channelMentionCounts = new Map<string, number>();
  for (const m of unreadMentions) {
    channelMentionCounts.set(m.channelId, (channelMentionCounts.get(m.channelId) || 0) + 1);
  }

  // Per-server unread counts
  const serverMentionCounts = new Map<string, number>();
  for (const m of unreadMentions) {
    if (m.serverId) {
      serverMentionCounts.set(m.serverId, (serverMentionCounts.get(m.serverId) || 0) + 1);
    }
  }

  const totalUnread = unreadMentions.length;

  const markChannelRead = useCallback((channelId: string) => {
    setChannelReadTimestamp(channelId, Date.now());
    setReadVersion((v) => v + 1);
  }, []);

  const markAllRead = useCallback(() => {
    const channelIds = new Set(mentions.map((m) => m.channelId));
    for (const chId of channelIds) {
      setChannelReadTimestamp(chId, Date.now());
    }
    setReadVersion((v) => v + 1);
  }, [mentions]);

  const getChannelCount = useCallback(
    (channelId: string): number => channelMentionCounts.get(channelId) || 0,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [readVersion, mentions]
  );

  const getServerCount = useCallback(
    (sid: string): number => serverMentionCounts.get(sid) || 0,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [readVersion, mentions]
  );

  return {
    mentions: unreadMentions,
    allMentions: mentions,
    loading,
    error,
    totalUnread,
    channelMentionCounts,
    serverMentionCounts,
    getChannelCount,
    getServerCount,
    markChannelRead,
    markAllRead,
    refresh: fetchMentions,
  };
}
