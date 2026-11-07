"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { useGT } from "gt-next";
import type { ServerChannel } from "@/contexts/ServerContext";
import { ChatArea } from "@/components/chat/ChatArea";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useBackHandler } from "@/hooks/useBackHandler";
import { clampThreadPanelWidth } from "@/lib/chat/threads";
import { cn } from "@/lib/utils";

const WIDTH_KEY = "sc:voice-chat-width";
const OPEN_KEY = "sc:voice-chat-open";

// Whether the voice chat panel is open, per device (like Discord, it stays
// as you left it across voice channels).
const openListeners = new Set<() => void>();
function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}
let openState: boolean | null = null;
function getOpen(): boolean {
  if (openState === null) openState = typeof window === "undefined" ? false : readOpen();
  return openState;
}
function subscribeOpen(listener: () => void) {
  openListeners.add(listener);
  return () => openListeners.delete(listener);
}

/** The voice chat panel's open state and setter. */
export function useVoiceChatOpen(): [boolean, (open: boolean) => void] {
  const open = useSyncExternalStore(subscribeOpen, getOpen, () => false);
  const setOpen = useCallback((next: boolean) => {
    openState = next;
    try {
      localStorage.setItem(OPEN_KEY, next ? "1" : "0");
    } catch {
      /* per-device convenience only */
    }
    openListeners.forEach((l) => l());
  }, []);
  return [open, setOpen];
}

function readWidth(): number {
  try {
    const n = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(n) && n > 0 ? n : 400;
  } catch {
    return 400;
  }
}

/**
 * Discord's text chat in voice: a voice or stage channel's own messages in a
 * side panel next to the call (the same ChatArea engine as text channels,
 * as the only chat on screen). Resizable from its left edge, width
 * remembered; full screen on phones.
 */
export function VoiceChatPanel({ channel, onClose }: { channel: ServerChannel; onClose: () => void }) {
  const gt = useGT();
  const isMobile = useIsMobile();
  const [width, setWidth] = useState<number>(() => (typeof window === "undefined" ? 400 : readWidth()));
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const viewport = typeof window === "undefined" ? 1280 : window.innerWidth;
  const shownWidth = clampThreadPanelWidth(width, viewport);

  useBackHandler(isMobile, onClose);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = { startX: e.clientX, startWidth: shownWidth };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setWidth(clampThreadPanelWidth(d.startWidth + (d.startX - e.clientX), window.innerWidth));
  };
  const onPointerUp = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      localStorage.setItem(WIDTH_KEY, String(shownWidth));
    } catch {
      /* per-device convenience only */
    }
  };

  return (
    <aside
      className={cn(
        "relative flex min-h-0 flex-col border-l border-[var(--app-border)] bg-[var(--app-bg)]",
        isMobile ? "theme-backdrop fixed inset-0 z-50" : "shrink-0",
      )}
      style={isMobile ? undefined : { width: shownWidth }}
      aria-label={gt("Chat")}
    >
      {!isMobile && (
        <div
          role="separator"
          aria-orientation="vertical"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="absolute -left-1 top-0 z-20 h-full w-2 cursor-col-resize hover:bg-[var(--app-accent)]/30"
        />
      )}
      <ChatArea channelOverride={channel} variant="panel" primary onClosePanel={onClose} />
    </aside>
  );
}
