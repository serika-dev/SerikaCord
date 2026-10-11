"use client";

import { useGT } from "gt-next";
import { toast } from "sonner";
import { Bell, BellOff, CheckCheck, Copy, Hash, Link2, Settings, Volume2 } from "lucide-react";
import { useUnread } from "@/contexts/UnreadContext";
import { usePermissions } from "@/hooks/usePermissions";
import { openNotificationSettings } from "@/lib/notifications/events";
import { updateNotificationOverride, useNotificationPrefs } from "@/lib/notifications/prefsStore";
import { MUTE_FOREVER, isMuteActive } from "@/lib/notifications/levels";
import { MobileSheet, SheetGroup, SheetRow } from "./MobileSheet";

type SheetChannel = { id: string; name: string; type: string; parentId?: string | null; topic?: string };

/** Long-press menu for a channel row in the phone channel list. */
export function MobileChannelSheet({
  channel,
  serverId,
  onClose,
}: {
  channel: SheetChannel;
  serverId: string;
  onClose: () => void;
}) {
  const gt = useGT();
  const { isChannelUnread, markChannelRead } = useUnread();
  const prefs = useNotificationPrefs();
  const { can, isAdmin } = usePermissions(serverId);
  const canManageChannels = isAdmin || can("MANAGE_CHANNELS");
  const isVoice = channel.type === "voice";
  // This channel's own mute (a muted server is unmuted from the server sheet).
  const muted = isMuteActive(prefs.doc.channels[channel.id]);

  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };

  const copy = (text: string, done: string) => {
    void navigator.clipboard?.writeText(text);
    toast.success(done);
  };

  const header = (
    <div className="flex items-center gap-2 px-4 pb-3">
      {isVoice ? (
        <Volume2 className="h-5 w-5 shrink-0 text-[var(--text-muted)]" />
      ) : (
        <Hash className="h-5 w-5 shrink-0 text-[var(--text-muted)]" />
      )}
      <div className="min-w-0">
        <h2 className="truncate text-lg font-bold text-[var(--text-primary)]">{channel.name}</h2>
        {channel.topic ? <p className="line-clamp-2 text-xs text-[var(--text-muted)]">{channel.topic}</p> : null}
      </div>
    </div>
  );

  return (
    <MobileSheet label={channel.name} header={header} onClose={onClose}>
      {!isVoice && (
        <SheetGroup>
          {isChannelUnread(channel.id) && (
            <SheetRow icon={CheckCheck} label={gt("Mark As Read")} onClick={run(() => markChannelRead(channel.id))} />
          )}
          <SheetRow
            icon={muted ? Bell : BellOff}
            label={muted ? gt("Unmute Channel") : gt("Mute Channel")}
            onClick={run(() => {
              void updateNotificationOverride("channel", channel.id, { muteUntil: muted ? null : MUTE_FOREVER });
            })}
          />
          <SheetRow
            icon={Bell}
            label={gt("Notification Settings")}
            onClick={run(() =>
              openNotificationSettings({
                scope: "channel",
                id: channel.id,
                name: `#${channel.name}`,
                serverId,
                parentId: channel.parentId ?? null,
              }),
            )}
          />
        </SheetGroup>
      )}
      {canManageChannels && (
        <SheetGroup>
          <SheetRow
            icon={Settings}
            label={gt("Edit Channel")}
            onClick={run(() => window.dispatchEvent(new CustomEvent("openChannelSettings", { detail: { channelId: channel.id } })))}
          />
        </SheetGroup>
      )}
      <SheetGroup>
        <SheetRow
          icon={Link2}
          label={gt("Copy Link")}
          onClick={run(() => copy(`${window.location.origin}/channels/${serverId}/${channel.id}`, gt("Channel link copied")))}
        />
        <SheetRow icon={Copy} label={gt("Copy Channel ID")} onClick={run(() => copy(channel.id, gt("Channel ID copied")))} />
      </SheetGroup>
    </MobileSheet>
  );
}
