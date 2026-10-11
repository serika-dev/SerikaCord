"use client";

/**
 * "N Events" row under the server header (desktop sidebar and mobile server
 * view, like Discord). Loads the server's upcoming/live events, follows live
 * changes from the activity stream and opens the (lazy) events dialog.
 */

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { CalendarDays, Radio } from "lucide-react";
import { useGT } from "gt-next";
import { cn } from "@/lib/utils";
import { MountWhenOpened } from "@/components/ui/MountWhenOpened";
import { onOpenServerEvents, onScheduledEventChange } from "@/lib/chat/scheduledEventsBus";
import type { ServerEventView } from "@/components/events/types";

const ServerEventsDialog = dynamic(() => import("@/components/events/ServerEventsDialog").then((m) => m.ServerEventsDialog), { ssr: false });

const same = (a?: string | null, b?: string | null) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());

interface EventsState {
  events: ServerEventView[];
  canCreate: boolean;
  canManage: boolean;
}

async function fetchEvents(serverId: string): Promise<EventsState | null> {
  try {
    const res = await fetch(`/api/servers/${serverId}/scheduled-events`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<EventsState>;
    return {
      events: Array.isArray(data.events) ? data.events : [],
      canCreate: Boolean(data.canCreate),
      canManage: Boolean(data.canManage),
    };
  } catch {
    return null; // offline: keep what we have
  }
}

export function ServerEventsEntry({ serverId, variant = "sidebar" }: { serverId: string; variant?: "sidebar" | "mobile" }) {
  const gt = useGT();
  const [state, setState] = useState<EventsState | null>(null);
  const [open, setOpen] = useState(false);
  const [focusEventId, setFocusEventId] = useState<string | null>(null);
  // Bumped on every open so the dialog starts fresh (list or the asked-for event).
  const [openSeq, setOpenSeq] = useState(0);
  const show = useCallback((eventId: string | null) => {
    setFocusEventId(eventId);
    setOpenSeq((n) => n + 1);
    setOpen(true);
  }, []);

  // Bumped to refetch (live change, or after an edit in the dialog).
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    void fetchEvents(serverId).then((next) => {
      if (alive && next) setState(next);
    });
    return () => { alive = false; };
  }, [serverId, version]);

  useEffect(() => {
    const offChange = onScheduledEventChange((signal) => {
      if (same(signal.serverId, serverId)) reload();
    });
    const offOpen = onOpenServerEvents((req) => {
      if (same(req.serverId, serverId)) show(req.eventId);
    });
    // Links like /channels/<server>?event=<id> (notification for somewhere-else events).
    const fromUrl = new URLSearchParams(window.location.search).get("event");
    const timer = fromUrl ? setTimeout(() => show(fromUrl), 0) : null;
    return () => {
      offChange();
      offOpen();
      if (timer) clearTimeout(timer);
    };
  }, [serverId, reload, show]);

  const events = state?.events ?? [];
  const live = events.find((e) => e.status === "active") ?? null;
  const count = events.length;
  const label = count === 0 ? gt("Events") : count === 1 ? gt("1 Event") : gt("{count} Events", { count });

  // Nothing to show and nothing you could do: hide the row (Discord shows it
  // to everyone; keep the sidebar quiet when a server has no events).
  if (!state || (count === 0 && !state.canCreate)) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => show(null)}
        className={cn(
          "flex w-full items-center gap-2 text-left transition-colors shrink-0",
          variant === "sidebar"
            ? "px-4 h-10 border-b border-[var(--border-subtle)] text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-sidebar-elevated)] hover:text-[var(--text-primary)]"
            : "px-4 py-3 border-b border-[var(--border-subtle)] text-sm text-[var(--text-secondary)] active:bg-[var(--bg-hover)]",
        )}
      >
        {live ? (
          <>
            <Radio className="h-4 w-4 shrink-0 text-emerald-500" />
            <span className="min-w-0 flex-1 truncate">
              <span className="font-semibold text-emerald-500">{gt("Live")}</span>{" "}
              <span className="text-[var(--text-primary)]">{live.name}</span>
            </span>
          </>
        ) : (
          <>
            <CalendarDays className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
          </>
        )}
      </button>
      <MountWhenOpened open={open}>
        <ServerEventsDialog
          key={openSeq}
          open={open}
          onOpenChange={setOpen}
          serverId={serverId}
          events={events}
          canCreate={state.canCreate}
          canManage={state.canManage}
          focusEventId={focusEventId}
          onChanged={reload}
        />
      </MountWhenOpened>
    </>
  );
}
