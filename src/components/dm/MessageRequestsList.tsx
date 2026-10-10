"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useGT } from "gt-next";
import { Check, Inbox, X } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader } from "@/components/ui/Loader";
import { useUserContextMenu } from "@/components/user/UserContextMenu";
import { refreshMessageRequests, resolveMessageRequest, useMessageRequests, type MessageRequestItem } from "@/lib/social/messageRequestsStore";
import { notificationPreview } from "@/lib/notifications/notify";
import { cdnImage } from "@/lib/utils";

/**
 * Discord's Message Requests list: DMs from people you aren't friends with.
 * Open one to read it, Accept to move it into your DMs, or Ignore to hide it.
 */
export function MessageRequestsList() {
  const gt = useGT();
  const router = useRouter();
  const { loaded, items } = useMessageRequests();
  const { openUserMenu, userMenu } = useUserContextMenu();

  useEffect(() => {
    void refreshMessageRequests();
  }, []);

  const act = async (item: MessageRequestItem, action: "accept" | "ignore") => {
    const ok = await resolveMessageRequest(item.channelId, action);
    if (!ok) {
      toast.error(gt("Something went wrong. Please try again."));
      return;
    }
    if (action === "accept") router.push(`/dm/${item.user.id}`);
  };

  if (!loaded) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader size={32} />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-20 px-6">
        <Inbox className="w-12 h-12 text-[var(--app-accent)] mb-4" />
        <p className="font-semibold text-[var(--text-primary)]">{gt("No message requests")}</p>
        <p className="text-sm text-[var(--text-muted)] mt-1 max-w-sm">
          {gt("Messages from people you aren't friends with will show up here.")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-semibold uppercase text-[var(--text-muted)] mb-2 px-1">
        {gt("Message Requests")} — {items.length}
      </p>
      {items.map((item) => {
        const name = item.user.displayName || item.user.username;
        const preview = item.lastMessage ? notificationPreview(item.lastMessage.content, 120) : "";
        return (
          <div
            key={item.channelId}
            onContextMenu={(e) => openUserMenu(e, { id: item.user.id, username: item.user.username, displayName: item.user.displayName, avatar: item.user.avatar })}
            className="group flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[var(--bg-hover)] transition-colors"
          >
            <button
              className="flex items-center gap-3 flex-1 min-w-0 text-left"
              onClick={() => router.push(`/dm/${item.user.id}`)}
            >
              <Avatar className="w-10 h-10 shrink-0">
                <AvatarImage src={cdnImage(item.user.avatar)} />
                <AvatarFallback className="bg-[var(--app-accent)] text-[var(--text-on-accent)]">
                  {name.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm text-[var(--text-primary)] truncate">{name}</p>
                <p className="text-xs text-[var(--text-muted)] truncate">{preview || item.user.username}</p>
              </div>
            </button>
            <button
              onClick={() => void act(item, "ignore")}
              className="p-2 rounded-full bg-[var(--bg-card)] text-[var(--text-secondary)] hover:text-red-400 transition-colors shrink-0"
              title={gt("Ignore")}
              aria-label={gt("Ignore")}
            >
              <X className="w-4 h-4" />
            </button>
            <button
              onClick={() => void act(item, "accept")}
              className="p-2 rounded-full bg-[var(--bg-card)] text-[var(--text-secondary)] hover:text-green-400 transition-colors shrink-0"
              title={gt("Accept")}
              aria-label={gt("Accept")}
            >
              <Check className="w-4 h-4" />
            </button>
          </div>
        );
      })}
      {userMenu}
    </div>
  );
}
