"use client";

/**
 * "An event you're interested in started": a toast while the app is in use,
 * otherwise a desktop notification. One tab alerts (Web Lock per event).
 */

import { toast } from "sonner";
import { cdnImage } from "@/lib/utils";
import { navigateInApp, showNotification } from "@/lib/services/notificationService";
import { playNotificationSound } from "@/lib/services/notificationUX";
import { isAppFocused } from "@/lib/notifications/notify";
import { requestOpenServerEvents, type ScheduledEventSignal } from "@/lib/chat/scheduledEventsBus";

async function claim(key: string): Promise<boolean> {
  const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  if (!locks?.request) return true;
  return new Promise<boolean>((resolve) => {
    locks
      .request(`serika-event-start-${key}`, { ifAvailable: true }, async (lock) => {
        resolve(Boolean(lock));
        if (lock) await new Promise((r) => setTimeout(r, 15_000));
      })
      .catch(() => resolve(true));
  });
}

function openEvent(ev: ScheduledEventSignal) {
  const route = typeof ev.route === "string" && ev.route.startsWith("/") ? ev.route : `/channels/${ev.serverId}`;
  navigateInApp(route);
  // Somewhere-else events have no channel to land in: show the event itself.
  if (!/^\/channels\/[^/?]+\/[^/?]+/.test(route)) {
    setTimeout(() => requestOpenServerEvents(ev.serverId, ev.eventId), 300);
  }
}

export function alertEventStarted(ev: ScheduledEventSignal, body: string, actionLabel: string): void {
  if (!ev.eventId) return;
  void claim(ev.eventId).then((mine) => {
    if (!mine) return;
    const title = ev.name || body;
    if (isAppFocused()) {
      toast(title, { description: body, action: { label: actionLabel, onClick: () => openEvent(ev) } });
      return;
    }
    playNotificationSound();
    void showNotification(title, body, {
      icon: ev.serverIcon ? cdnImage(ev.serverIcon) : undefined,
      tag: `event-${ev.eventId}`,
      data: { url: ev.route },
      onClick: () => openEvent(ev),
    });
  });
}
