"use client";

// "Try again" on a message that couldn't be decrypted (MessageGroup) →
// the chat session showing it (useE2eeDecryptRetry). A tiny crypto-free
// event bus, so the per-message component needs no new callback prop.

type Listener = (messageId: string) => void;

const listeners = new Set<Listener>();

/** Ask the open chat to decrypt a message again (reloading the keys it needs). */
export function requestDecryptRetry(messageId: string): void {
  for (const listener of [...listeners]) listener(messageId);
}

export function onDecryptRetryRequest(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
