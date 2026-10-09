/**
 * Open the app-wide Inbox / notification settings dialogs from anywhere
 * (they're mounted once in AppShellProviders and lazy-loaded on first use).
 */

export type InboxTab = "mentions" | "unreads" | "calls";

export interface NotificationSettingsTarget {
  scope: "server" | "channel";
  id: string;
  /** Shown in the dialog title (server name, #channel, category, person). */
  name: string;
  /** For channels: the server they belong to (to show inherited values). */
  serverId?: string | null;
  /** Channel kind, for wording ("category", "dm"). */
  kind?: "channel" | "category" | "dm";
  /** Parent category / forum, for the inherited level. */
  parentId?: string | null;
}

export const OPEN_INBOX_EVENT = "serika:open-inbox";
export const OPEN_NOTIFICATION_SETTINGS_EVENT = "serika:notification-settings";

export function openInbox(tab?: InboxTab): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<InboxTab | undefined>(OPEN_INBOX_EVENT, { detail: tab }));
}

// ── Jump to a message from the Inbox / a notification ──────────────────────
// A `?jump=<id>` URL is honoured when a conversation opens. When that
// conversation is ALREADY open the page doesn't remount, so we also broadcast
// the jump; the open chat checks the path is its own before jumping.

export const JUMP_TO_MESSAGE_EVENT = "serika:jump-to-message";

export interface JumpToMessageDetail {
  /** Conversation path, e.g. /channels/<server>/<channel> or /dm/<user>. */
  path: string;
  messageId: string;
}

/** Navigate to an in-app URL, jumping to its `?jump=` message even if that conversation is already open. */
export function navigateToMessage(push: (url: string) => void, url: string): void {
  push(url);
  if (typeof window === "undefined") return;
  let parsed: URL;
  try {
    parsed = new URL(url, window.location.origin);
  } catch {
    return;
  }
  const messageId = parsed.searchParams.get("jump");
  if (!messageId) return;
  const detail: JumpToMessageDetail = { path: parsed.pathname, messageId };
  setTimeout(() => {
    window.dispatchEvent(new CustomEvent<JumpToMessageDetail>(JUMP_TO_MESSAGE_EVENT, { detail }));
  }, 0);
}

/** Listen for jumps aimed at `path` (the listener's own conversation). */
export function onJumpToMessage(path: string, handler: (messageId: string) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) => {
    const d = (e as CustomEvent<JumpToMessageDetail>).detail;
    if (d && d.path === path) handler(d.messageId);
  };
  window.addEventListener(JUMP_TO_MESSAGE_EVENT, listener);
  return () => window.removeEventListener(JUMP_TO_MESSAGE_EVENT, listener);
}

export function openNotificationSettings(target: NotificationSettingsTarget): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<NotificationSettingsTarget>(OPEN_NOTIFICATION_SETTINGS_EVENT, { detail: target }));
}
