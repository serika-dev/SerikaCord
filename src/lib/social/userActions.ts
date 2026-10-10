"use client";

/**
 * Tiny event bus behind the user context menu. The menu closes the moment an
 * item is picked, so dialogs it opens (profile, note, nickname, kick, ban,
 * timeout) live in one host mounted with the app shell (UserActionsHost), and
 * "Mention" is delivered to the open composer.
 */

export type UserActionKind = "profile" | "note" | "nickname" | "kick" | "ban" | "timeout" | "modview";

export interface UserActionTarget {
  id: string;
  username: string;
  displayName?: string | null;
  avatar?: string | null;
  isBot?: boolean;
  /** Server the action applies to (nickname / kick / ban / timeout / profile roles). */
  serverId?: string | null;
  /** Current timeout end, so Timeout can offer "Remove Timeout". */
  communicationDisabledUntil?: string | null;
}

export interface UserActionRequest {
  kind: UserActionKind;
  target: UserActionTarget;
}

const actionListeners = new Set<(req: UserActionRequest) => void>();

export function openUserAction(kind: UserActionKind, target: UserActionTarget) {
  actionListeners.forEach((l) => l({ kind, target }));
}

export function onUserAction(listener: (req: UserActionRequest) => void): () => void {
  actionListeners.add(listener);
  return () => actionListeners.delete(listener);
}

const mentionListeners = new Set<(m: { id: string; label: string }) => void>();

/** Insert a mention of this user into the open message composer. */
export function requestMention(id: string, label: string) {
  mentionListeners.forEach((l) => l({ id, label }));
}

export function onMentionRequest(listener: (m: { id: string; label: string }) => void): () => void {
  mentionListeners.add(listener);
  return () => mentionListeners.delete(listener);
}

/** Whether any composer is mounted (the Mention item is hidden otherwise). */
export function hasMentionTarget(): boolean {
  return mentionListeners.size > 0;
}
