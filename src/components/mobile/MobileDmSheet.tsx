"use client";

import { useGT } from "gt-next";
import { toast } from "sonner";
import { Bell, BellOff, CheckCheck, Copy, MessageCircle, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { useUnread } from "@/contexts/UnreadContext";
import { updateNotificationOverride, useNotificationPrefs } from "@/lib/notifications/prefsStore";
import { MUTE_FOREVER, isMuteActive } from "@/lib/notifications/levels";
import { openUserAction } from "@/lib/social/userActions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cdnImage } from "@/lib/utils";
import { MobileSheet, SheetGroup, SheetRow } from "./MobileSheet";

interface SheetConversation {
  /** DM / group channel id. */
  id: string;
  recipientId: string;
  href: string;
  type: "dm" | "group";
  name: string;
  username: string;
  avatar?: string;
}

/** Long-press menu for a conversation in the phone Messages tab. */
export function MobileDmSheet({ conversation, onClose }: { conversation: SheetConversation; onClose: () => void }) {
  const gt = useGT();
  const router = useRouter();
  const { isChannelUnread, markChannelRead } = useUnread();
  const prefs = useNotificationPrefs();
  const muted = isMuteActive(prefs.doc.channels[conversation.id]);
  const isDm = conversation.type === "dm";

  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };

  const header = (
    <div className="flex items-center gap-3 px-4 pb-3">
      <Avatar className="h-10 w-10">
        <AvatarImage src={cdnImage(conversation.avatar)} />
        <AvatarFallback className="bg-[var(--app-accent)] text-[var(--text-on-accent)]">
          {conversation.name.charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <h2 className="truncate text-lg font-bold text-[var(--text-primary)]">{conversation.name}</h2>
        {isDm && conversation.username ? (
          <p className="truncate text-xs text-[var(--text-muted)]">@{conversation.username}</p>
        ) : null}
      </div>
    </div>
  );

  return (
    <MobileSheet label={conversation.name} header={header} onClose={onClose}>
      <SheetGroup>
        <SheetRow icon={MessageCircle} label={gt("Open Conversation")} onClick={run(() => router.push(conversation.href))} />
        {isDm && (
          <SheetRow
            icon={User}
            label={gt("Profile")}
            onClick={run(() =>
              openUserAction("profile", {
                id: conversation.recipientId,
                username: conversation.username,
                displayName: conversation.name,
                avatar: conversation.avatar ?? null,
              }),
            )}
          />
        )}
        {isChannelUnread(conversation.id) && (
          <SheetRow icon={CheckCheck} label={gt("Mark As Read")} onClick={run(() => markChannelRead(conversation.id))} />
        )}
        <SheetRow
          icon={muted ? Bell : BellOff}
          label={muted ? gt("Unmute Conversation") : gt("Mute Conversation")}
          onClick={run(() => {
            void updateNotificationOverride("channel", conversation.id, { muteUntil: muted ? null : MUTE_FOREVER });
          })}
        />
      </SheetGroup>
      {isDm && (
        <SheetGroup>
          <SheetRow
            icon={Copy}
            label={gt("Copy User ID")}
            onClick={run(() => {
              void navigator.clipboard?.writeText(conversation.recipientId);
              toast.success(gt("User ID copied"));
            })}
          />
        </SheetGroup>
      )}
    </MobileSheet>
  );
}
