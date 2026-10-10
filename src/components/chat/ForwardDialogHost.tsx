"use client";

/**
 * Mounted once in AppShellProviders: opens the Forward dialog for a message
 * from any menu (requestForward in lib/chat/forwardBus). The dialog is
 * code-split and only downloaded on first use.
 */
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { MountWhenOpened } from "@/components/ui/MountWhenOpened";
import { onForwardRequest } from "@/lib/chat/forwardBus";
import type { ChatMessage } from "@/lib/chat/types";

const ForwardDialog = dynamic(() => import("./ForwardDialog").then((m) => m.ForwardDialog), { ssr: false });

export function ForwardDialogHost() {
  const [message, setMessage] = useState<ChatMessage | null>(null);
  useEffect(() => onForwardRequest(setMessage), []);
  return (
    <MountWhenOpened open={message !== null}>
      <ForwardDialog message={message} onClose={() => setMessage(null)} />
    </MountWhenOpened>
  );
}
