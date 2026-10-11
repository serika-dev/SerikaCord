"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { useGT } from "gt-next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  /** Label of the confirm button (defaults to "Confirm"). */
  confirmLabel?: string;
  /** Label of the cancel button (defaults to "Cancel"). */
  cancelLabel?: string;
  /** Red confirm button for destructive actions (default true). */
  destructive?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * Themed replacement for window.confirm(). Mount once (AppShellProviders);
 * call sites use `if (!(await confirm({ title }))) return;`.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const gt = useGT();
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const settle = useCallback((value: boolean) => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setOptions(null);
  }, []);

  const confirm = useCallback<ConfirmFn>((next) => {
    // A newer prompt supersedes an unanswered one (treated as cancelled).
    resolverRef.current?.(false);
    setOptions(next);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const destructive = options?.destructive !== false;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={!!options} onOpenChange={(open) => { if (!open) settle(false); }}>
        {/* Phones get a bottom sheet with full-width 48px buttons. */}
        <DialogContent className="bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-primary)] max-md:top-auto max-md:bottom-0 max-md:left-0 max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-b-none max-md:rounded-t-2xl max-md:border-x-0 max-md:border-b-0 max-md:pb-[max(1.5rem,env(safe-area-inset-bottom))] max-md:data-[state=open]:slide-in-from-bottom-8 max-md:data-[state=open]:zoom-in-100">
          <DialogHeader>
            <DialogTitle>{options?.title}</DialogTitle>
            {options?.description && (
              <DialogDescription className="text-[var(--text-secondary)]">
                {options.description}
              </DialogDescription>
            )}
          </DialogHeader>
          <DialogFooter className="gap-2 max-md:[&>button]:h-12 max-md:[&>button]:w-full max-md:[&>button]:text-base">
            <Button
              variant="ghost"
              onClick={() => settle(false)}
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              {options?.cancelLabel || gt("Cancel")}
            </Button>
            <Button
              autoFocus
              variant={destructive ? "destructive" : "default"}
              onClick={() => settle(true)}
              className={destructive
                ? "bg-red-600 hover:bg-red-700 text-white"
                : "bg-[var(--app-accent)] hover:bg-[var(--accent-hover)] text-[var(--text-on-accent)]"}
            >
              {options?.confirmLabel || gt("Confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

/**
 * Returns an async confirm(). Outside a ConfirmProvider it falls back to the
 * native dialog so callers never silently skip the prompt.
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  return useMemo<ConfirmFn>(
    () =>
      ctx ??
      (async (o) =>
        typeof window !== "undefined" &&
        window.confirm(typeof o.description === "string" ? `${o.title}\n\n${o.description}` : o.title)),
    [ctx],
  );
}
