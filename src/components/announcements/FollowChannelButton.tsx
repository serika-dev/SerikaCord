"use client";

/**
 * Announcement channel header: "Follow" opens a (lazy) dialog to send this
 * channel's published messages into a text channel of one of your servers.
 */

import { useState } from "react";
import dynamic from "next/dynamic";
import { BellPlus } from "lucide-react";
import { useGT } from "gt-next";
import { MountWhenOpened } from "@/components/ui/MountWhenOpened";

const FollowChannelDialog = dynamic(() => import("@/components/announcements/FollowChannelDialog").then((m) => m.FollowChannelDialog), { ssr: false });

/** Publish an announcement to every following channel. */
export async function publishAnnouncement(channelId: string, messageId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/channels/${channelId}/messages/${messageId}/crosspost`, { method: "POST" });
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: data.error };
  } catch {
    return { ok: false };
  }
}

export function FollowChannelButton({ channelId, channelName }: { channelId: string; channelName: string }) {
  const gt = useGT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="p-2 -m-1 sm:p-0 sm:m-0 rounded-lg flex items-center justify-center hover:text-[var(--text-primary)] transition-colors"
        onClick={() => setOpen(true)}
        title={gt("Follow")}
        aria-label={gt("Follow")}
      >
        <BellPlus className="w-5 h-5" />
      </button>
      <MountWhenOpened open={open}>
        <FollowChannelDialog open={open} onOpenChange={setOpen} channelId={channelId} channelName={channelName} />
      </MountWhenOpened>
    </>
  );
}
