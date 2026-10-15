"use client";

import type { ReactNode } from "react";
import { useGT } from "gt-next";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { E2eeDialogRequest } from "@/lib/e2ee/client/state";
import { PinSetupFlow, PinUnlockFlow } from "./PinFlows";

interface E2eePinDialogProps {
  mode: Extract<E2eeDialogRequest, "pin-setup" | "pin-unlock" | "pin-change"> | null;
  onClose: () => void;
}

/** The 6-digit PIN flows as a dialog (a bottom sheet on phones). */
export function E2eePinDialog({ mode, onClose }: E2eePinDialogProps) {
  const gt = useGT();
  const title = (children: ReactNode) => <DialogTitle className="text-lg font-semibold">{children}</DialogTitle>;
  return (
    <Dialog open={mode !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-primary)] max-w-md">
        <DialogDescription className="sr-only">{gt("End-to-end encryption PIN")}</DialogDescription>
        {mode === "pin-unlock" ? (
          <PinUnlockFlow onDone={onClose} renderTitle={title} />
        ) : mode ? (
          <PinSetupFlow key={mode} change={mode === "pin-change"} onDone={onClose} onCancel={onClose} renderTitle={title} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export default E2eePinDialog;
