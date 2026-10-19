import type { ChatMessage } from "./types";
import { isStandaloneRow } from "./messages";

/**
 * Keyboard message selection (Ctrl+Up / Ctrl+Down to pick a message to reply
 * to, Ctrl+Shift+Up / Ctrl+Shift+Down to pick one of your own to edit).
 */

/** A message that can be replied to: a real, persisted, non-system row. */
export function isReplyableMessage(m: ChatMessage): boolean {
  if (!m?.id || isStandaloneRow(m)) return false;
  if (m.pending || m.ephemeral) return false;
  const id = String(m.id);
  return !id.startsWith("temp-") && !id.startsWith("eph-");
}

/** One of your own messages that has text to edit. */
export function isEditableOwnMessage(m: ChatMessage, selfId: string | null | undefined): boolean {
  if (!selfId || !isReplyableMessage(m)) return false;
  if (m.webhookId || (m.authorId !== selfId && m.author?.id !== selfId)) return false;
  return !m.poll && !m.forward;
}

/**
 * Step the selected message up (-1, older) or down (1, newer) among the
 * messages that pass `eligible`.
 *
 * - Up with nothing selected picks the newest; at the oldest it stays put.
 * - Down past the newest returns `null` (cancel the selection, like Discord).
 * - Down with nothing selected returns `undefined` (nothing to do).
 */
export function stepMessageTarget<M extends ChatMessage>(
  messages: readonly M[],
  currentId: string | null | undefined,
  dir: 1 | -1,
  eligible: (m: M) => boolean = isReplyableMessage,
): M | null | undefined {
  const list = messages.filter(eligible);
  if (list.length === 0) return currentId ? null : undefined;
  const idx = currentId ? list.findIndex((m) => m.id === currentId) : -1;
  if (idx === -1) {
    // Nothing (or a message no longer in view) selected.
    return dir === -1 ? list[list.length - 1] : currentId ? null : undefined;
  }
  if (dir === -1) return list[Math.max(0, idx - 1)];
  return idx + 1 < list.length ? list[idx + 1] : null;
}
