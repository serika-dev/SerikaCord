"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { HOTKEYS, formatHotkey, getEffectiveBinding, onHotkey, type Hotkey } from "@/lib/keybinds";
import { useGT } from "gt-next";

const CATEGORY_ORDER: Hotkey["category"][] = ["Navigation", "Chat", "Voice", "Application"];

/** Ctrl+/ keyboard-shortcuts reference overlay. Listens for the toggle-help hotkey. */
export function KeyboardShortcutsDialog() {
  const gt = useGT();
  const [open, setOpen] = useState(false);

  useEffect(() => onHotkey("toggle-help", () => setOpen((v) => !v)), []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{gt("Keyboard Shortcuts")}</DialogTitle>
          <DialogDescription>
            {gt("Press")}{" "}
            <kbd className="px-1.5 py-0.5 rounded bg-[var(--app-surface-alt)] border border-[var(--app-border)] text-xs font-mono">
              {formatHotkey(getEffectiveBinding("toggle-help"))}
            </kbd>{" "}
            {gt("any time to open this list.")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          {CATEGORY_ORDER.map((category) => {
            const rows = HOTKEYS.filter((h) => h.category === category).map((h) => getEffectiveBinding(h.action));
            if (rows.length === 0) return null;
            return (
              <div key={category}>
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-[var(--app-muted)] mb-2">
                  {category}
                </h3>
                <div className="rounded-lg border border-[var(--app-border)] overflow-hidden divide-y divide-[var(--app-border)]">
                  {rows.map((hk) => (
                    <div
                      key={hk.action}
                      className="flex items-center justify-between gap-4 px-3 py-2 bg-[var(--app-surface)]"
                    >
                      <span className="text-sm text-[var(--text-primary)]">{hk.label}</span>
                      <kbd className="shrink-0 px-2 py-1 rounded-md bg-[var(--app-surface-alt)] border border-[var(--app-border)] text-xs font-mono text-[var(--text-secondary)] whitespace-nowrap">
                        {formatHotkey(hk)}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
