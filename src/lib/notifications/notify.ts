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
import { renderMentionText, type MentionNames } from "@/lib/chat/mentionText";
import { isUserAttending } from "@/lib/unread/attentionTracker";
import { NotificationGroups, conversationTag, groupedNotificationBody } from "./grouping";

const groups = new NotificationGroups();

/**
 * The user is looking at the app right now: tab shown and either focused or
 * touched within the last minute (see `lib/unread/attention.ts`).
 */
export function isAppFocused(): boolean {
  return isUserAttending();
}

/**
 * Plain-text preview of a stored message for a notification: decodes HTML
 * entities and turns mention/emoji markup into readable text, using `names`
 * to show "@Alice" / "@Moderators" / "#general" when they are known.
 */
export function notificationPreview(raw: string | null | undefined, max = 140, names?: MentionNames | null): string {
  if (!raw) return "";
  const text = renderMentionText(decodeHtmlEntities(raw), names)
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Every open tab receives the same live message; only one of them alerts:
 * the first to claim the message id (a Web Lock held for a while). A tab
 * where the user is reading claims at once, background tabs wait a beat.
 */
async function claimAlert(messageId: string | undefined, attending: boolean): Promise<boolean> {
  if (!messageId || typeof navigator === "undefined") return true;
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks?.request) return true;
  if (!attending) await new Promise((r) => setTimeout(r, 150));
  return new Promise<boolean>((resolve) => {
    locks
      .request(`serika-alert-${messageId}`, { ifAvailable: true }, async (lock) => {
        resolve(Boolean(lock));
        // Hold it long enough for every other tab to find it taken.
        if (lock) await new Promise((r) => setTimeout(r, 15_000));
      })
      .catch(() => resolve(true));
  });
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
  /** Deduplicates the alert across open tabs. */
  messageId?: string;
  /** Checked right before alerting: false once the message was read meanwhile. */
  stillUnread?: () => boolean;
}

export function notifyIncomingMessage(alert: IncomingMessageAlert): void {
  const focused = isAppFocused();
  void claimAlert(alert.messageId, focused && alert.viewing).then((mine) => {
    if (!mine) return;
    if (alert.stillUnread && !alert.stillUnread()) return;
    deliverAlert(alert, isAppFocused());
  });
}

function deliverAlert(alert: IncomingMessageAlert, focused: boolean): void {
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
