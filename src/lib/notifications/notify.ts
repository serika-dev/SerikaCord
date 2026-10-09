"use client";

/**
 * One path for "a message arrived — should we chime, pop a desktop
 * notification or toast?", shared by the open chat (ChatArea / DM page) and
 * the app-wide activity stream (UnreadContext). Desktop notifications are
 * grouped per conversation and closed once it's read.
 */

import { toast } from "sonner";
import { decodeHtmlEntities } from "@/lib/chat/messages";
import { cdnImage } from "@/lib/utils";
import { evaluateNotification, playNotificationSound, type NotifyContext } from "@/lib/services/notificationUX";
import { closeNotification, navigateInApp, showNotification } from "@/lib/services/notificationService";
import { NotificationGroups, conversationTag, groupedNotificationBody } from "./grouping";

const groups = new NotificationGroups();

/** The user is looking at the app right now (tab shown and window focused). */
export function isAppFocused(): boolean {
  if (typeof document === "undefined") return false;
  return document.visibilityState === "visible" && document.hasFocus();
}

/**
 * Plain-text preview of a stored message for a notification: decodes HTML
 * entities and turns mention/emoji markup into readable text.
 */
export function notificationPreview(raw: string | null | undefined, max = 140): string {
  if (!raw) return "";
  const text = decodeHtmlEntities(raw)
    .replace(/<@&[\w-]+>/g, "@role")
    .replace(/<@!?[\w-]+>/g, "@user")
    .replace(/<#[\w-]+>/g, "#channel")
    .replace(/<a?:(\w+):[\w-]+>/g, ":$1:")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export interface IncomingMessageAlert extends Omit<NotifyContext, "isTabVisible"> {
  /** This conversation is on screen. */
  viewing: boolean;
  /** Desktop notification title (sender for DMs, "Sender (#channel, Server)" for channels). */
  title: string;
  /** Message preview, already honouring the "show preview" setting. */
  body: string;
  showPreview: boolean;
  icon?: string | null;
  /** In-app URL opened on click (carries ?jump=<messageId>). */
  url: string;
  /** "{n} new messages", translated. */
  formatMany: (count: number) => string;
  /** Toast heading + action label, translated. */
  toastTitle: string;
  toastAction: string;
  /** Plain (non-mention) message: never toasts, chimes only while unfocused. */
  quiet?: boolean;
  /** Override what the toast's action does (defaults to opening `url`). */
  onToastAction?: () => void;
}

export function notifyIncomingMessage(alert: IncomingMessageAlert): void {
  const focused = isAppFocused();
  const decision = evaluateNotification({
    isMentioned: alert.isMentioned,
    isDM: alert.isDM,
    isEveryoneMention: alert.isEveryoneMention,
    channelId: alert.channelId,
    serverId: alert.serverId,
    ancestorIds: alert.ancestorIds,
    isRoleMention: alert.isRoleMention,
    // "Visible" means the user can already see this conversation.
    isTabVisible: focused && alert.viewing,
  });
  if (decision.playSound && !(alert.quiet && focused)) playNotificationSound();
  if (decision.showDesktop && !focused) {
    const tag = conversationTag(alert.channelId);
    const count = groups.bump(tag);
    const body = groupedNotificationBody(
      { count, latestBody: alert.body, showPreview: alert.showPreview },
      alert.formatMany,
    );
    void showNotification(alert.title, body, {
      tag,
      renotify: true,
      icon: cdnImage(alert.icon) || "/icons/icon-192x192.png",
      data: { url: alert.url, channelId: alert.channelId },
      onClick: () => navigateInApp(alert.url),
    });
  }
  if (decision.showToast && focused && !alert.viewing && !alert.quiet) {
    toast(alert.toastTitle, {
      description: alert.body,
      duration: 5000,
      action: { label: alert.toastAction, onClick: alert.onToastAction ?? (() => navigateInApp(alert.url)) },
    });
  }
}

/** The conversation was read (here or on another device): close its notification. */
export function clearConversationNotifications(channelId: string): void {
  const tag = conversationTag(channelId);
  groups.clear(tag);
  // Always try: the notification may predate a reload, or come from another tab.
  void closeNotification(tag);
}
