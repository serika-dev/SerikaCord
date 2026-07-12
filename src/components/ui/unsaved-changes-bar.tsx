"use client";

import { useEffect } from "react";
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
  className?: string;
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
  className,
}: UnsavedChangesBarProps) {
  const gt = useGT();
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

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          role="status"
          aria-live="polite"
          className={cn(
            "sticky bottom-0 left-0 right-0 z-30 mx-auto mt-4 flex w-full max-w-3xl flex-wrap items-center justify-between gap-3 rounded-lg border border-[#222222] bg-[#0a0a0a]/95 px-4 py-3 shadow-2xl backdrop-blur",
            className
          )}
        >
          <p className="text-sm text-[#d5d9e8] min-w-0">
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
                className="p-2 rounded-md text-[#888888] hover:text-white hover:bg-[#1a1a1a] disabled:opacity-40 disabled:pointer-events-none transition-colors focus-visible:outline-2 focus-visible:outline-[#8B5CF6]"
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
                className="p-2 rounded-md text-[#888888] hover:text-white hover:bg-[#1a1a1a] disabled:opacity-40 disabled:pointer-events-none transition-colors focus-visible:outline-2 focus-visible:outline-[#8B5CF6]"
              >
                <Redo2 className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onDiscard}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm text-[#d5d9e8] hover:bg-[#1a1a1a] disabled:opacity-40 transition-colors focus-visible:outline-2 focus-visible:outline-[#8B5CF6]"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {gt("Discard")}
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={isSaving}
              className="flex items-center gap-2 px-4 py-1.5 rounded-md bg-[#23A559] hover:bg-[#1f9150] active:scale-[0.97] text-sm font-medium text-white disabled:opacity-60 transition-all focus-visible:outline-2 focus-visible:outline-white"
            >
              {isSaving && <Loader size={16} />}
              {isSaving ? gt("Saving...") : gt("Save Changes")}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
