"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { patchRelationship, refreshRelationships } from "@/lib/social/relationshipsStore";
import { refreshMessageRequests, resolveMessageRequest, useMessageRequests } from "@/lib/social/messageRequestsStore";

/** The pending Message Request for a 1:1 DM with `userId`, if any. */
export function useMessageRequestFor(userId: string | null | undefined) {
  const { loaded, items } = useMessageRequests();
  useEffect(() => {
    if (!loaded) void refreshMessageRequests();
  }, [loaded]);
  if (!userId) return null;
  const id = userId.toLowerCase();
  return items.find((i) => i.user.id.toLowerCase() === id) ?? null;
}

/**
 * Shown instead of the composer while a DM is a Message Request (Discord):
 * accept to reply, ignore to hide it, or block the sender.
 */
export function MessageRequestBar({ channelId, userId, name }: { channelId: string; userId: string; name: string }) {
  const gt = useGT();
  const router = useRouter();
  const confirm = useConfirm();

  const act = async (action: "accept" | "ignore") => {
    const ok = await resolveMessageRequest(channelId, action);
    if (!ok) {
      toast.error(gt("Something went wrong. Please try again."));
      return;
    }
    if (action === "ignore") router.push("/channels/me?tab=requests");
  };

  const block = async () => {
    const ok = await confirm({
      title: gt("Block {name}?", { name }),
      description: gt("They won't be able to message you, and their messages will be hidden in servers you share. Blocking also removes them from your friends."),
      confirmLabel: gt("Block"),
    });
    if (!ok) return;
    const res = await fetch(`/api/friends/block/${userId}`, { method: "POST" }).catch(() => null);
    if (!res?.ok) {
      toast.error(gt("Failed to block user"));
      return;
    }
    patchRelationship(userId, { blocked: true, friend: false });
    void refreshRelationships();
    await resolveMessageRequest(channelId, "ignore");
    router.push("/channels/me?tab=requests");
  };

  return (
    <div className="mx-4 mb-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-[var(--text-primary)] truncate">{gt("{name} wants to message you", { name })}</p>
        <p className="text-xs text-[var(--text-muted)]">
          {gt("You aren't friends yet. Accept to reply, or ignore to hide this conversation.")}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button variant="ghost" onClick={() => void block()} className="text-red-400 hover:text-red-300">
          {gt("Block")}
        </Button>
        <Button variant="ghost" onClick={() => void act("ignore")} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
          {gt("Ignore")}
        </Button>
        <Button onClick={() => void act("accept")}>{gt("Accept")}</Button>
      </div>
    </div>
  );
}
