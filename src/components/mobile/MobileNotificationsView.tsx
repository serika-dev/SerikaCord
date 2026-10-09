"use client";

import { useRouter } from "next/navigation";
import { Settings } from "lucide-react";
import { useGT } from "gt-next";
import { InboxPanel } from "@/components/notifications/InboxPanel";

/**
 * Mobile Notifications tab: the same Inbox (mentions, unread conversations,
 * missed calls) as the desktop bell, fed by the same unread/mention sources as
 * the bottom-nav badges.
 */
export function MobileNotificationsView() {
  const router = useRouter();
  const gt = useGT();

  return (
    <div className="flex h-full flex-col bg-[var(--bg-app)]">
      <header className="safe-area-top flex-shrink-0 px-4 pb-2 pt-3">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">{gt("Notifications")}</h1>
          <button
            onClick={() => router.push("/channels/settings/notifications")}
            aria-label={gt("Notification settings")}
            className="flex h-10 w-10 touch-manipulation items-center justify-center rounded-full bg-[var(--bg-card)] text-[var(--text-primary)] transition-all active:scale-95 active:bg-[var(--bg-hover)]"
          >
            <Settings className="h-5 w-5" />
          </button>
        </div>
      </header>
      <InboxPanel className="min-h-0 flex-1 px-3 pb-24" />
    </div>
  );
}
