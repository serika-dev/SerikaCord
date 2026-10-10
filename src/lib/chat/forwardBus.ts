/**
 * Open the app-wide Forward dialog from any message menu (it's mounted once in
 * AppShellProviders by ForwardDialogHost and lazy-loaded on first use), so the
 * channel, DM and group DM containers don't each need wiring.
 */
import type { ChatMessage } from "./types";

export const OPEN_FORWARD_EVENT = "serika:forward-message";

export function requestForward(message: ChatMessage): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ChatMessage>(OPEN_FORWARD_EVENT, { detail: message }));
}

export function onForwardRequest(handler: (message: ChatMessage) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) => {
    const message = (e as CustomEvent<ChatMessage>).detail;
    if (message?.id) handler(message);
  };
  window.addEventListener(OPEN_FORWARD_EVENT, listener);
  return () => window.removeEventListener(OPEN_FORWARD_EVENT, listener);
}
