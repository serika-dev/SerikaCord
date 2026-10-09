"use client";

/**
 * Mounted once in AppShellProviders: opens the Inbox (bell, Ctrl+I) and the
 * notification settings dialog from anywhere via events. Both dialogs are
 * code-split and only downloaded on first open.
 */

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { MountWhenOpened } from "@/components/ui/MountWhenOpened";
import { onHotkey } from "@/lib/keybinds";
import {
  OPEN_INBOX_EVENT,
  OPEN_NOTIFICATION_SETTINGS_EVENT,
  type InboxTab,
  type NotificationSettingsTarget,
} from "@/lib/notifications/events";

const InboxDialog = dynamic(() => import("./InboxDialog"), { ssr: false });
const NotificationSettingsDialog = dynamic(() => import("./NotificationSettingsDialog"), { ssr: false });

export function NotificationHosts() {
  const [inbox, setInbox] = useState<{ open: boolean; tab: InboxTab }>({ open: false, tab: "mentions" });
  const [settings, setSettings] = useState<{ open: boolean; target: NotificationSettingsTarget | null }>({
    open: false,
    target: null,
  });

  useEffect(() => {
    const onInbox = (e: Event) => {
      const tab = (e as CustomEvent<InboxTab | undefined>).detail;
      setInbox((prev) => ({ open: true, tab: tab ?? prev.tab }));
    };
    const onSettings = (e: Event) => {
      const target = (e as CustomEvent<NotificationSettingsTarget>).detail;
      if (target?.id) setSettings({ open: true, target });
    };
    window.addEventListener(OPEN_INBOX_EVENT, onInbox);
    window.addEventListener(OPEN_NOTIFICATION_SETTINGS_EVENT, onSettings);
    const offHotkey = onHotkey("toggle-mentions", () => setInbox((prev) => ({ ...prev, open: !prev.open })));
    return () => {
      window.removeEventListener(OPEN_INBOX_EVENT, onInbox);
      window.removeEventListener(OPEN_NOTIFICATION_SETTINGS_EVENT, onSettings);
      offHotkey();
    };
  }, []);

  return (
    <>
      <MountWhenOpened open={inbox.open}>
        <InboxDialog
          open={inbox.open}
          tab={inbox.tab}
          onOpenChange={(open) => setInbox((prev) => ({ ...prev, open }))}
        />
      </MountWhenOpened>
      <MountWhenOpened open={settings.open}>
        <NotificationSettingsDialog
          open={settings.open}
          target={settings.target}
          onOpenChange={(open) => setSettings((prev) => ({ ...prev, open }))}
        />
      </MountWhenOpened>
    </>
  );
}
