"use client";

import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useGT } from "gt-next";
import { cn } from "@/lib/utils";
import { useBackHandler } from "@/hooks/useBackHandler";
import { useDragToDismiss } from "@/hooks/useDragToDismiss";

/**
 * Discord-style bottom sheet for phones: dimmed backdrop, grab handle, drag
 * down (handle, or content scrolled to the top) / tap outside / Android back
 * to close, safe-area aware and scrollable when its content is taller than
 * the screen. Render it only while open.
 */
export function MobileSheet({
  onClose,
  label,
  header,
  children,
  className,
  containerClassName,
}: {
  onClose: () => void;
  /** Accessible name of the sheet. */
  label: string;
  /** Pinned above the scrolling body. */
  header?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  containerClassName?: string;
}) {
  const gt = useGT();
  const sheet = useRef<HTMLDivElement | null>(null);
  const closed = useRef(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const { sheetRef, backdropRef, dismiss } = useDragToDismiss({
    onDismiss: () => {
      if (closed.current) return;
      closed.current = true;
      onCloseRef.current();
    },
  });
  const requestClose = useCallback(() => dismiss(), [dismiss]);
  // The finger that long-pressed this sheet open lifts over the backdrop: its
  // click (some browsers send one) must not close the sheet straight away.
  const openedAt = useRef(0);
  useEffect(() => {
    openedAt.current = performance.now();
  }, []);
  useBackHandler(true, requestClose);
  const setSheet = useCallback(
    (el: HTMLDivElement | null) => {
      sheet.current = el;
      return sheetRef(el);
    },
    [sheetRef],
  );

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sheet.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
      }
      if (event.key !== "Tab" || !sheet.current) return;
      const focusable = Array.from(sheet.current.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex="0"]')).filter((el) => !el.hasAttribute("disabled") && el.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === sheet.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === sheet.current)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [requestClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className={cn("fixed inset-0 z-[9990]", containerClassName)}
      data-message-sheet=""
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        ref={backdropRef}
        tabIndex={-1}
        aria-label={gt("Close")}
        className="sheet-backdrop-enter absolute inset-0 cursor-default bg-black/50 touch-none"
        onClick={() => {
          if (performance.now() - openedAt.current > 450) requestClose();
        }}
      />
      <div
        ref={setSheet}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={cn(
          "sheet-enter absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col overflow-hidden rounded-t-2xl border-t border-[var(--border-subtle)] bg-[var(--bg-app)] shadow-2xl",
          "outline-none",
          className,
        )}
      >
        <div className="shrink-0 touch-none select-none">
          <div className="flex justify-center pb-2 pt-2.5">
            <div className="h-1 w-10 rounded-full bg-[var(--border-subtle)]" />
          </div>
          {header}
        </div>
        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
          style={{ paddingBottom: "max(0.75rem, var(--safe-area-bottom))" }}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** A rounded group of sheet rows (Discord's grouped list). */
export function SheetGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-3 mb-2 divide-y divide-[var(--border-subtle)] overflow-hidden rounded-xl bg-[var(--bg-card)]">
      {children}
    </div>
  );
}

/** One tappable row in a sheet. */
export function SheetRow({
  icon: Icon,
  label,
  onClick,
  danger,
  trailing,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  danger?: boolean;
  trailing?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-12 w-full touch-manipulation items-center gap-3 px-4 text-left text-[15px] font-medium active:bg-[var(--bg-hover)]",
        danger ? "text-red-500" : "text-[var(--text-primary)]",
      )}
    >
      <Icon className={cn("h-5 w-5 shrink-0", danger ? "text-red-500" : "text-[var(--text-secondary)]")} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </button>
  );
}
