"use client";

import { useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";

export interface SwipeAction {
  icon: React.ElementType;
  label: string;
  /** Tailwind background class, e.g. "bg-[#8B5CF6]" or "bg-red-500" */
  className: string;
  onAction: () => void;
}

interface SwipeableRowProps {
  children: React.ReactNode;
  /** Actions revealed by swiping left, rendered right-to-left */
  actions: SwipeAction[];
  disabled?: boolean;
  className?: string;
}

const ACTION_WIDTH = 72;

/**
 * iOS-style swipe-to-reveal actions for list rows on touch devices.
 * Swipe left to reveal the action buttons; tap the row or swipe right to
 * close. Mouse users are unaffected (touch events only) — desktop should
 * provide the same actions through hover buttons or menus.
 */
export function SwipeableRow({ children, actions, disabled = false, className }: SwipeableRowProps) {
  const [offset, setOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startRef = useRef<{ x: number; y: number; offset: number } | null>(null);
  const directionLocked = useRef<"horizontal" | "vertical" | null>(null);

  const maxOffset = actions.length * ACTION_WIDTH;

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (disabled || actions.length === 0) return;
    const touch = e.touches[0];
    startRef.current = { x: touch.clientX, y: touch.clientY, offset };
    directionLocked.current = null;
  }, [disabled, actions.length, offset]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const start = startRef.current;
    if (!start) return;
    const touch = e.touches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;

    if (!directionLocked.current) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      directionLocked.current = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
    }
    if (directionLocked.current === "vertical") return;

    setIsDragging(true);
    // Negative offset slides content left; clamp with soft resistance past max
    const raw = start.offset + dx;
    const clamped = Math.min(0, Math.max(raw, -maxOffset - 24));
    setOffset(clamped);
  }, [maxOffset]);

  const handleTouchEnd = useCallback(() => {
    startRef.current = null;
    directionLocked.current = null;
    setIsDragging(false);
    // Snap open if past half of the action area, otherwise closed
    setOffset((current) => (current < -maxOffset / 2 ? -maxOffset : 0));
  }, [maxOffset]);

  const close = useCallback(() => setOffset(0), []);

  const isOpen = offset <= -maxOffset;

  return (
    <div className={cn("relative overflow-hidden", className)}>
      {/* Action buttons behind the row */}
      {actions.length > 0 && (
        <div className="absolute inset-y-0 right-0 flex" aria-hidden={!isOpen}>
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.label}
                tabIndex={isOpen ? 0 : -1}
                onClick={() => {
                  close();
                  action.onAction();
                }}
                aria-label={action.label}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 text-white text-[10px] font-medium active:brightness-90 transition-[filter]",
                  action.className
                )}
                style={{ width: ACTION_WIDTH }}
              >
                <Icon className="w-5 h-5" />
                {action.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Row content */}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onClickCapture={(e) => {
          // A tap while open just closes the row
          if (isOpen) {
            e.stopPropagation();
            e.preventDefault();
            close();
          }
        }}
        className={cn("relative bg-[var(--bg-app)]", !isDragging && "transition-transform duration-200 ease-out")}
        style={{ transform: `translateX(${offset}px)`, touchAction: "pan-y" }}
      >
        {children}
      </div>
    </div>
  );
}
