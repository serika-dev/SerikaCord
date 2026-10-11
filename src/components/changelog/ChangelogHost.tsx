"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { MountWhenOpened } from "@/components/ui/MountWhenOpened";
import { sharedGet } from "@/lib/bootFetch";
import type { ChangelogAnnouncement, ChangelogFeed } from "@/lib/changelogAnnouncements";

const ChangelogDialog = dynamic(() => import("./ChangelogDialog").then((module) => module.ChangelogDialog), { ssr: false });
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

function readPending(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string").slice(-100) : [];
  } catch {
    return [];
  }
}

function writePending(key: string, ids: Set<string>) {
  try { localStorage.setItem(key, JSON.stringify([...ids].slice(-100))); } catch { /* Private browsing can disable storage. */ }
}

/** Keying by account drops every dialog, in-flight callback, and receipt on account changes. */
export function ChangelogHost() {
  const { user } = useAuth();
  return user ? <AccountChangelogHost key={user.id} userId={user.id} /> : null;
}

function AccountChangelogHost({ userId }: { userId: string }) {
  const gt = useGT();
  const pendingKey = `sc:changelog-pending:${userId}`;
  const readKey = `sc:changelog-read:${userId}`;
  const [entries, setEntries] = useState<ChangelogAnnouncement[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runtime = useRef({
    mounted: false,
    open: false,
    manual: false,
    selectedId: null as string | null,
    checking: false,
    lastCheck: 0,
    viewed: new Set<string>(),
    dismissed: new Set<string>(),
    pending: new Set<string>(),
    acknowledging: new Set<string>(),
    controllers: new Set<AbortController>(),
  });

  const acknowledge = useCallback(async (announceFailure = false) => {
    const current = runtime.current;
    let failed = false;
    for (const id of current.pending) {
      if (!current.mounted || current.acknowledging.has(id)) continue;
      const controller = new AbortController();
      current.controllers.add(controller);
      current.acknowledging.add(id);
      try {
        const response = await fetch(`/api/changelogs/${id}/read`, { method: "POST", credentials: "include", signal: controller.signal });
        if (!current.mounted) return;
        if (!response.ok && response.status !== 404) throw new Error("Receipt failed");
        current.pending.delete(id);
        writePending(pendingKey, current.pending);
        try { localStorage.setItem(readKey, JSON.stringify({ id, at: Date.now() })); } catch { /* Best-effort cross-tab synchronization. */ }
      } catch {
        if (!controller.signal.aborted) failed = true;
      } finally {
        current.acknowledging.delete(id);
        current.controllers.delete(controller);
      }
    }
    if (failed && announceFailure && current.mounted) {
      toast.error(gt("Your update was dismissed. We'll retry saving it when you're connected."));
    }
  }, [gt, pendingKey, readKey]);

  const refresh = useCallback(async (manual = false) => {
    const current = runtime.current;
    if (manual) {
      current.manual = true;
      current.open = true;
      setOpen(true);
      setLoading(true);
      setError(null);
    } else if (document.visibilityState !== "visible" || Date.now() - current.lastCheck < 10000) {
      return;
    }
    if (current.checking) return;
    current.checking = true;
    current.lastCheck = Date.now();
    void acknowledge();
    try {
      const response = await sharedGet("/api/changelogs");
      if (!response.ok) throw new Error("Feed unavailable");
      const feed: ChangelogFeed = await response.json();
      if (!current.mounted) return;
      setEntries(feed.entries);
      const unread = feed.entries.find((entry) => entry.id === feed.unreadId);
      if (!current.open && unread && !current.dismissed.has(unread.id)) {
        current.open = true;
        current.manual = false;
        current.viewed.clear();
        current.selectedId = unread.id;
        setOpen(true);
      } else if (current.open && !feed.entries.some((entry) => entry.id === current.selectedId)) {
        current.selectedId = feed.entries[0]?.id ?? null;
      }
      if (current.open && current.selectedId) current.viewed.add(current.selectedId);
      setSelectedId(current.selectedId);
      setError(null);
    } catch {
      if (current.mounted && current.open) setError(gt("We couldn't load the changelog. Please try again."));
    } finally {
      current.checking = false;
      if (current.mounted) setLoading(false);
    }
  }, [acknowledge, gt]);

  useEffect(() => {
    const current = runtime.current;
    current.mounted = true;
    for (const id of readPending(pendingKey)) {
      current.pending.add(id);
      current.dismissed.add(id);
    }
    // Startup is deferred one task so focus/listener setup completes first.
    const initial = window.setTimeout(() => { void refresh(); }, 0);
    const onFocus = () => { void refresh(); };
    const onOpen = () => {
      current.viewed.clear();
      current.selectedId = null;
      void refresh(true);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== readKey || !event.newValue) return;
      try {
        const value: unknown = JSON.parse(event.newValue);
        if (!value || typeof value !== "object" || !("id" in value) || typeof value.id !== "string") return;
        current.dismissed.add(value.id);
        current.pending.delete(value.id);
        if (current.open && !current.manual && current.selectedId === value.id) {
          current.open = false;
          current.viewed.clear();
          setOpen(false);
        }
      } catch { /* Ignore unrelated or malformed local storage. */ }
    };
    const interval = window.setInterval(onFocus, CHECK_INTERVAL_MS);
    window.addEventListener("serika:open-changelog", onOpen);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onFocus);
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      current.mounted = false;
      for (const controller of current.controllers) controller.abort();
      window.clearTimeout(initial);
      window.clearInterval(interval);
      window.removeEventListener("serika:open-changelog", onOpen);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onFocus);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [pendingKey, readKey, refresh]);

  const dismiss = () => {
    const current = runtime.current;
    current.open = false;
    setOpen(false);
    for (const id of current.viewed) {
      if (!current.dismissed.has(id)) current.pending.add(id);
      current.dismissed.add(id);
    }
    current.viewed.clear();
    writePending(pendingKey, current.pending);
    void acknowledge(true);
  };

  return (
    <MountWhenOpened open={open}>
      <ChangelogDialog open={open} onOpenChange={(next) => { if (!next) dismiss(); }} entries={entries} selectedId={selectedId} loading={loading} error={error} onRetry={() => { void refresh(true); }} onSelect={(id) => {
        runtime.current.selectedId = id;
        runtime.current.viewed.add(id);
        setSelectedId(id);
      }} />
    </MountWhenOpened>
  );
}
