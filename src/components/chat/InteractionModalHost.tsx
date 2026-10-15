"use client";

/**
 * Mounted once in AppShellProviders: opens app modals (interaction callback 9)
 * and reports interactions that failed (the app didn't answer in time, or its
 * answer was invalid). The modal is code-split and loads on first use.
 */
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { MountWhenOpened } from "@/components/ui/MountWhenOpened";
import { isClaimedInteraction, onInteractionEvent } from "@/lib/chat/interactionEvents";
import type { InteractionModalData } from "./InteractionModal";

const InteractionModal = dynamic(() => import("./InteractionModal"), { ssr: false });

export function InteractionModalHost() {
  const gt = useGT();
  const [data, setData] = useState<InteractionModalData | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => onInteractionEvent((e) => {
    if (e.event === "modal") {
      setData({ modalId: e.modalId, modal: e.modal, application: e.application });
      setOpen(true);
      return;
    }
    if (e.event === "failed") {
      // Component clicks show their own inline error.
      if (e.interactionId && isClaimedInteraction(e.interactionId)) return;
      if (e.reason === "invalid_options") toast.error(gt("That command's options aren't valid."));
      else if (e.reason === "command_forbidden") toast.error(gt("You don't have permission to use this command here."));
      else if (e.reason === "rate_limited") toast.error(gt("You are doing that too fast."));
      else toast.error(gt("The app didn't respond in time."));
    }
  }), [gt]);

  return (
    <MountWhenOpened open={open}>
      <InteractionModal data={data} open={open} onOpenChange={setOpen} />
    </MountWhenOpened>
  );
}
