"use client";

import { useCallback, useState } from "react";

// Client-side persisted organization for the server rail: custom ordering plus
// Discord-style folders. Kept in localStorage so it needs no DB migration and
// stays per-device. Servers the user joins that aren't in the saved layout are
// appended automatically; stale ids (servers left) are pruned on read.

export type ServerLayoutEntry =
  | { kind: "server"; id: string }
  | { kind: "folder"; id: string; name: string; color: string; serverIds: string[] };

interface StoredLayout {
  entries: ServerLayoutEntry[];
}

const LS_KEY = "sc:server-layout";

const FOLDER_COLORS = [
  "#8B5CF6", "#5865F2", "#EB459E", "#F59E0B", "#10B981", "#EF4444", "#06B6D4",
];

function randomFolderColor(): string {
  return FOLDER_COLORS[Math.floor(Math.random() * FOLDER_COLORS.length)];
}

function newId(): string {
  return `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function load(): StoredLayout {
  if (typeof localStorage === "undefined") return { entries: [] };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { entries: [] };
    const parsed = JSON.parse(raw) as StoredLayout;
    if (!parsed || !Array.isArray(parsed.entries)) return { entries: [] };
    return parsed;
  } catch {
    return { entries: [] };
  }
}

function save(layout: StoredLayout) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(layout));
  } catch {
    /* quota — ignore */
  }
}

/**
 * Reconcile the saved layout against the live set of joined server ids:
 * drops entries for servers the user left, and appends newly-joined servers.
 */
function reconcile(entries: ServerLayoutEntry[], liveIds: string[]): ServerLayoutEntry[] {
  const live = new Set(liveIds);
  const seen = new Set<string>();
  const next: ServerLayoutEntry[] = [];

  for (const entry of entries) {
    if (entry.kind === "server") {
      if (live.has(entry.id) && !seen.has(entry.id)) {
        seen.add(entry.id);
        next.push(entry);
      }
    } else {
      const kept = entry.serverIds.filter((id) => live.has(id) && !seen.has(id));
      kept.forEach((id) => seen.add(id));
      // Drop empty folders so they don't linger forever.
      if (kept.length > 0) next.push({ ...entry, serverIds: kept });
    }
  }

  // Append any joined servers not yet placed anywhere.
  for (const id of liveIds) {
    if (!seen.has(id)) {
      seen.add(id);
      next.push({ kind: "server", id });
    }
  }

  return next;
}

export function useServerLayout(liveServerIds: string[]) {
  const [entries, setEntries] = useState<ServerLayoutEntry[]>(() => load().entries);

  // Derive the render list by reconciling stored entries against the live server
  // set (join/leave) on every render — deterministic, so newly-joined servers
  // always land in the same spot without needing to write back to state. Explicit
  // user actions (reorder/folder edits) persist their result below. The React
  // Compiler memoizes this automatically.
  const reconciled = reconcile(entries, liveServerIds);

  const commit = useCallback((next: ServerLayoutEntry[]) => {
    setEntries(next);
    save({ entries: next });
  }, []);

  // Replace the top-level ordering (used by drag-to-reorder).
  const reorder = useCallback((next: ServerLayoutEntry[]) => {
    commit(next);
  }, [commit]);

  // Create a new folder seeded with a server, placed where that server was.
  const createFolder = useCallback((serverId: string, name?: string) => {
    setEntries((prev) => {
      const idx = prev.findIndex((e) => e.kind === "server" && e.id === serverId);
      const folder: ServerLayoutEntry = {
        kind: "folder",
        id: newId(),
        name: name || "New Folder",
        color: randomFolderColor(),
        serverIds: [serverId],
      };
      const next = prev.filter((e) => !(e.kind === "server" && e.id === serverId));
      const insertAt = idx === -1 ? next.length : idx;
      next.splice(insertAt, 0, folder);
      save({ entries: next });
      return next;
    });
  }, []);

  // Drop one server onto another (top-level) → new folder holding both, placed
  // where the target server was. Mirrors Discord's drag-to-create-folder.
  const mergeIntoNewFolder = useCallback((sourceServerId: string, targetServerId: string) => {
    if (sourceServerId === targetServerId) return;
    setEntries((prev) => {
      const targetIdx = prev.findIndex((e) => e.kind === "server" && e.id === targetServerId);
      if (targetIdx === -1) return prev;
      const folder: ServerLayoutEntry = {
        kind: "folder",
        id: newId(),
        name: "New Folder",
        color: randomFolderColor(),
        serverIds: [targetServerId, sourceServerId],
      };
      const next = prev.filter(
        (e) => !(e.kind === "server" && (e.id === sourceServerId || e.id === targetServerId))
      );
      const insertAt = next.findIndex((e) => e.kind === "server" && e.id === targetServerId);
      // targetServerId was removed above, so recompute using original index clamp.
      const at = insertAt === -1 ? Math.min(targetIdx, next.length) : insertAt;
      next.splice(at, 0, folder);
      save({ entries: next });
      return next;
    });
  }, []);

  const addToFolder = useCallback((serverId: string, folderId: string) => {
    setEntries((prev) => {
      const next = prev
        .filter((e) => !(e.kind === "server" && e.id === serverId))
        .map((e) => {
          if (e.kind !== "folder") return e;
          if (e.id === folderId) {
            if (e.serverIds.includes(serverId)) return e;
            return { ...e, serverIds: [...e.serverIds, serverId] };
          }
          // Remove from any other folder it may have been in.
          return { ...e, serverIds: e.serverIds.filter((id) => id !== serverId) };
        });
      save({ entries: next });
      return next;
    });
  }, []);

  // Pull a server out of its folder and back to the top level (after the folder).
  const removeFromFolder = useCallback((serverId: string) => {
    setEntries((prev) => {
      let insertAt = prev.length;
      const next: ServerLayoutEntry[] = [];
      prev.forEach((e) => {
        if (e.kind === "folder" && e.serverIds.includes(serverId)) {
          const remaining = e.serverIds.filter((id) => id !== serverId);
          if (remaining.length > 0) next.push({ ...e, serverIds: remaining });
          insertAt = next.length;
        } else {
          next.push(e);
        }
      });
      next.splice(insertAt, 0, { kind: "server", id: serverId });
      save({ entries: next });
      return next;
    });
  }, []);

  const renameFolder = useCallback((folderId: string, name: string) => {
    setEntries((prev) => {
      const next = prev.map((e) =>
        e.kind === "folder" && e.id === folderId ? { ...e, name } : e
      );
      save({ entries: next });
      return next;
    });
  }, []);

  const recolorFolder = useCallback((folderId: string, color: string) => {
    setEntries((prev) => {
      const next = prev.map((e) =>
        e.kind === "folder" && e.id === folderId ? { ...e, color } : e
      );
      save({ entries: next });
      return next;
    });
  }, []);

  const folders = reconciled.filter(
    (e): e is Extract<ServerLayoutEntry, { kind: "folder" }> => e.kind === "folder"
  );

  return {
    entries: reconciled,
    folders,
    reorder,
    createFolder,
    mergeIntoNewFolder,
    addToFolder,
    removeFromFolder,
    renameFolder,
    recolorFolder,
    folderColors: FOLDER_COLORS,
  };
}
