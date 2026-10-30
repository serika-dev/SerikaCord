"use client";

import { Users, X } from "lucide-react";
import { useGT } from "gt-next";
import { SwipeNav } from "@/components/mobile/SwipeNav";
import { useBackHandler } from "@/hooks/useBackHandler";

/**
 * The member list over the chat below 1024px (tablets, split view, narrow
 * windows; servers and DMs alike): a right-hand drawer with a backdrop that
 * closes on tap, swipe right, Escape-like Back and its close button. Render
 * it only while open.
 */
export function MembersDrawer({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const gt = useGT();
  // Android back closes the drawer first.
  useBackHandler(true, onClose);
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 lg:hidden animate-in fade-in duration-200" onClick={onClose} aria-hidden />
      <SwipeNav
        onSwipeRight={onClose}
        className="theme-solid fixed top-0 right-0 bottom-0 z-50 w-72 md:w-80 max-w-[85vw] lg:hidden shadow-2xl flex flex-col bg-[var(--bg-app)] animate-in slide-in-from-right duration-200 ease-out pt-safe pb-safe"
      >
        <div className="flex items-center justify-between h-12 px-4 border-b border-[var(--app-border)] shrink-0">
          <span className="flex items-center gap-2 font-semibold text-[var(--text-primary)]">
            <Users className="w-5 h-5" />
            {gt("Members")}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={gt("Close member list")}
            className="flex h-11 w-11 -mr-3 items-center justify-center rounded-lg text-[var(--app-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--app-surface-alt)] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 min-h-0 flex flex-col">{children}</div>
      </SwipeNav>
    </>
  );
}
