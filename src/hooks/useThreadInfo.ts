"use client";

import { useCallback, useEffect, useState } from "react";
import type { ThreadSummary } from "@/lib/chat/threads";
import { emitThreadsChanged } from "@/lib/chat/threadPanelStore";

export interface ThreadStarterMessage {
  id: string;
  channelId: string;
  content: string;
  authorId: string;
  author: { id: string; username: string; displayName: string; avatar?: string | null; isBot?: boolean } | null;
  createdAt: string;
  edited?: boolean;
}

export interface ThreadInfo {
  thread: ThreadSummary | null;
  starterMessage: ThreadStarterMessage | null;
  joined: boolean;
  canManageThread: boolean;
  parentName: string | null;
  parentType: string | null;
}

interface PermissionOverwrite { id: string; type: "role" | "member"; allow: string; deny: string }

export interface ThreadInfoState {
  info: ThreadInfo | null;
  /** The parent's overwrites (threads inherit them) as the server resolved them. */
  permissionOverwrites: PermissionOverwrite[] | null;
  /** A `thread_state` event for this thread arrived. */
  applySummary: (summary: ThreadSummary) => void;
  join: () => Promise<boolean>;
  leave: () => Promise<boolean>;
  /** Archive / unarchive / lock / change the inactivity window (PATCH). */
  update: (patch: { archived?: boolean; locked?: boolean; autoArchiveDuration?: number; name?: string }) => Promise<boolean>;
  /** The viewer just posted: they're a member now. */
  markJoined: () => void;
}

type Loaded = { id: string; info: ThreadInfo; overwrites: PermissionOverwrite[] | null };

/**
 * The open thread's header data (summary, starter message, joined, may manage)
 * from GET /api/channels/:id, kept live from `thread_state` events, plus the
 * join / leave / archive actions. Null id: not a thread.
 */
export function useThreadInfo(threadId: string | null, serverId: string | null | undefined): ThreadInfoState {
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    void fetch(`/api/channels/${threadId}`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const ch = data?.channel;
        if (cancelled || !ch) return;
        setLoaded({
          id: threadId,
          info: {
            thread: ch.thread ?? null,
            starterMessage: ch.starterMessage ?? null,
            joined: Boolean(ch.joined),
            canManageThread: Boolean(ch.canManageThread),
            parentName: ch.parentName ?? null,
            parentType: ch.parentType ?? null,
          },
          overwrites: Array.isArray(ch.permissionOverwrites) ? ch.permissionOverwrites : null,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  const current = loaded && loaded.id === threadId ? loaded : null;

  const patchInfo = useCallback(
    (fn: (info: ThreadInfo) => ThreadInfo) => {
      setLoaded((prev) => (prev && prev.id === threadId ? { ...prev, info: fn(prev.info) } : prev));
    },
    [threadId],
  );

  const applySummary = useCallback(
    (summary: ThreadSummary) => {
      if (summary.id !== threadId) return;
      patchInfo((info) => ({ ...info, thread: summary }));
    },
    [patchInfo, threadId],
  );

  const markJoined = useCallback(() => {
    patchInfo((info) => (info.joined ? info : { ...info, joined: true }));
  }, [patchInfo]);

  const join = useCallback(async () => {
    if (!threadId) return false;
    const res = await fetch(`/api/channels/${threadId}/join`, { method: "PUT", credentials: "include" }).catch(() => null);
    if (!res?.ok) return false;
    patchInfo((info) => ({ ...info, joined: true }));
    if (serverId) emitThreadsChanged(serverId);
    return true;
  }, [threadId, serverId, patchInfo]);

  const leave = useCallback(async () => {
    if (!threadId) return false;
    const res = await fetch(`/api/channels/${threadId}/leave`, { method: "DELETE", credentials: "include" }).catch(() => null);
    if (!res?.ok) return false;
    patchInfo((info) => ({ ...info, joined: false }));
    if (serverId) emitThreadsChanged(serverId);
    return true;
  }, [threadId, serverId, patchInfo]);

  const update = useCallback(
    async (patch: { archived?: boolean; locked?: boolean; autoArchiveDuration?: number; name?: string }) => {
      if (!threadId) return false;
      const res = await fetch(`/api/channels/${threadId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }).catch(() => null);
      if (!res?.ok) return false;
      // The authoritative summary follows as a `thread_state` event; reflect
      // the change right away meanwhile.
      patchInfo((info) =>
        info.thread
          ? {
              ...info,
              thread: {
                ...info.thread,
                ...(patch.archived !== undefined ? { archived: patch.archived } : {}),
                ...(patch.locked !== undefined ? { locked: patch.locked, archived: patch.locked ? true : info.thread.archived } : {}),
                ...(patch.autoArchiveDuration !== undefined ? { autoArchiveDuration: patch.autoArchiveDuration } : {}),
                ...(patch.name !== undefined ? { name: patch.name } : {}),
              },
            }
          : info,
      );
      if (serverId) emitThreadsChanged(serverId);
      return true;
    },
    [threadId, serverId, patchInfo],
  );

  return {
    info: current?.info ?? null,
    permissionOverwrites: current?.overwrites ?? null,
    applySummary,
    join,
    leave,
    update,
    markJoined,
  };
}
