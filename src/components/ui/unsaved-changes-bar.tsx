"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { RotateCcw, Undo2, Redo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGT } from "gt-next";
import { Loader } from "@/components/ui/Loader";

interface UnsavedChangesBarProps {
  visible: boolean;
  isSaving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  /** Number of changed fields, shown in the message when > 0 */
  changeCount?: number;
  /**
   * Bump (see useUnsavedShake) to shake the bar and flash it red, Discord's
   * nudge when someone tries to leave with unsaved changes.
   */
  shakeSignal?: number;
  className?: string;
}

/**
 * Counter + trigger for UnsavedChangesBar's `shakeSignal`. Call `shake()`
 * wherever leaving is blocked (close, Escape, switching pages).
 */
export function useUnsavedShake() {
  const [signal, setSignal] = useState(0);
  const shake = useCallback(() => setSignal((n) => n + 1), []);
  return [signal, shake] as const;
}

/**
 * Sticky action bar shown while a settings draft has unsaved changes.
 * Save = one atomic bulk request; Discard = reset draft to last saved state.
 * Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z map to undo/redo while visible.
 */
export function UnsavedChangesBar({
  visible,
  isSaving,
  onSave,
  onDiscard,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  changeCount = 0,
  shakeSignal = 0,
  className,
}: UnsavedChangesBarProps) {
  const gt = useGT();
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visible) return;
    const handleKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Let text fields keep their native undo behavior
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          if (canRedo) onRedo?.();
        } else if (canUndo) {
          onUndo?.();
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [visible, canUndo, canRedo, onUndo, onRedo]);

  // Restart the shake animation on every bump (class toggle + reflow), and
  // drop the class when it ends so the bar returns to its normal colours.
  useEffect(() => {
    const el = barRef.current;
    if (!shakeSignal || !el) return;
    el.classList.remove("settings-unsaved-shake");
    void el.offsetWidth;
    el.classList.add("settings-unsaved-shake");
    const timer = window.setTimeout(() => el.classList.remove("settings-unsaved-shake"), 900);
    return () => window.clearTimeout(timer);
  }, [shakeSignal]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          role="status"
          aria-live="polite"
          className={cn(
            "sticky bottom-0 left-0 right-0 z-30 mx-auto mt-4 w-full max-w-3xl",
            className
          )}
        >
          <div
            ref={barRef}
            className="theme-solid flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-2.5 shadow-[var(--app-elev-2)] transition-colors duration-(--motion-fast)"
          >
            <p className="text-sm font-medium text-[var(--text-primary)] min-w-0">
              {gt("Careful — you have unsaved changes")}{changeCount > 0 ? ` (${changeCount} ${changeCount === 1 ? gt("field") : gt("fields")})` : ""}!
            </p>
            <div className="flex items-center gap-2 shrink-0">
              {onUndo && (
                <button
                  type="button"
                  onClick={onUndo}
                  disabled={!canUndo || isSaving}
                  aria-label={gt("Undo change")}
                  title={gt("Undo (Ctrl+Z)")}
                  className="p-2 rounded-md text-current opacity-75 hover:opacity-100 hover:bg-[var(--bg-hover)] disabled:opacity-30 disabled:pointer-events-none transition-[opacity,background-color] duration-(--motion-fast) focus-visible:outline-2 focus-visible:outline-[var(--app-accent)]"
                >
                  <Undo2 className="w-4 h-4" />
                </button>
              )}
              {onRedo && (
                <button
                  type="button"
                  onClick={onRedo}
                  disabled={!canRedo || isSaving}
                  aria-label={gt("Redo change")}
                  title={gt("Redo (Ctrl+Shift+Z)")}
                  className="p-2 rounded-md text-current opacity-75 hover:opacity-100 hover:bg-[var(--bg-hover)] disabled:opacity-30 disabled:pointer-events-none transition-[opacity,background-color] duration-(--motion-fast) focus-visible:outline-2 focus-visible:outline-[var(--app-accent)]"
                >
                  <Redo2 className="w-4 h-4" />
                </button>
              )}
              <button
                type="button"
                onClick={onDiscard}
                disabled={isSaving}
                className="flex items-center gap-1.5 px-3 py-1.5 max-md:py-2.5 rounded-md text-sm text-current hover:underline underline-offset-2 disabled:opacity-40 transition-colors focus-visible:outline-2 focus-visible:outline-[var(--app-accent)]"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {gt("Reset")}
              </button>
              <button
                type="button"
                onClick={onSave}
                disabled={isSaving}
                className="flex items-center gap-2 px-4 py-1.5 max-md:py-2.5 rounded-md bg-[var(--app-success)] hover:brightness-110 active:scale-[0.97] text-sm font-medium text-white disabled:opacity-60 transition-[filter,transform,opacity] duration-(--motion-fast) focus-visible:outline-2 focus-visible:outline-[var(--app-accent)]"
              >
                {isSaving && <Loader size={16} />}
                {isSaving ? gt("Saving...") : gt("Save Changes")}
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
