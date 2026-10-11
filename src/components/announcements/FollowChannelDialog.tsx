"use client";

/**
 * Follow an announcement channel (Discord "Follow"): pick one of your
 * servers and a text channel where you have Manage Webhooks; published
 * messages then show up there as "Server #channel". Unfollow from the same
 * list.
 */

import { useEffect, useMemo, useState } from "react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { Hash, Megaphone } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface TargetChannel { id: string; name: string; type: string; followId: string | null }
interface TargetServer { id: string; name: string; icon: string | null; channels: TargetChannel[] }

const fieldClass =
  "w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-input,var(--bg-card))] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--app-accent)]/50";

export function FollowChannelDialog({ open, onOpenChange, channelId, channelName }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId: string;
  channelName: string;
}) {
  const gt = useGT();
  const [servers, setServers] = useState<TargetServer[] | null>(null);
  const [serverId, setServerId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    void fetch(`/api/channels/${channelId}/follow-targets`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { servers: [] }))
      .catch(() => ({ servers: [] }))
      .then((data: { servers?: TargetServer[] }) => {
        if (alive) setServers(Array.isArray(data.servers) ? data.servers : []);
      });
    return () => { alive = false; };
  }, [channelId, reload]);

  const server = useMemo(() => servers?.find((s) => s.id === serverId) ?? servers?.[0] ?? null, [servers, serverId]);
  const channel = server?.channels.find((c) => c.id === targetId) ?? server?.channels.find((c) => !c.followId) ?? server?.channels[0] ?? null;

  const follow = async () => {
    if (!channel || channel.followId || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/channels/${channelId}/followers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhookChannelId: channel.id }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) toast.error(data.error || gt("Could not follow this channel"));
      else toast.success(gt("Following #{channel} in #{target}", { channel: channelName, target: channel.name }));
    } catch {
      toast.error(gt("Could not follow this channel"));
    }
    setBusy(false);
    setReload((n) => n + 1);
  };

  const unfollow = async (followId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/channel-follows/${followId}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) toast.error(data.error || gt("Could not unfollow this channel"));
      else toast.success(gt("Unfollowed"));
    } catch {
      toast.error(gt("Could not unfollow this channel"));
    }
    setBusy(false);
    setReload((n) => n + 1);
  };

  const following = (servers ?? []).flatMap((s) => s.channels.filter((c) => c.followId).map((c) => ({ server: s, channel: c })));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[var(--text-primary)] sm:max-w-md">
        <div className="flex flex-col items-center gap-2 text-center">
          <Megaphone className="h-8 w-8 text-[var(--app-accent)]" />
          <DialogTitle className="text-lg font-semibold">{gt("Follow #{channel}", { channel: channelName })}</DialogTitle>
          <DialogDescription className="text-sm text-[var(--text-muted)]">
            {gt("Pick a server and channel. Messages published here will show up there.")}
          </DialogDescription>
        </div>

        {servers === null ? (
          <p className="py-4 text-center text-sm text-[var(--text-muted)]">{gt("Loading...")}</p>
        ) : servers.length === 0 ? (
          <p className="py-4 text-center text-sm text-[var(--text-muted)]">
            {gt("You need the Manage Webhooks permission in a text channel of a server to follow this channel.")}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-bold uppercase text-[var(--text-secondary)]">{gt("Server")}</span>
              <select className={fieldClass} value={server?.id ?? ""} onChange={(e) => { setServerId(e.target.value); setTargetId(""); }}>
                {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-bold uppercase text-[var(--text-secondary)]">{gt("Channel")}</span>
              <select className={fieldClass} value={channel?.id ?? ""} onChange={(e) => setTargetId(e.target.value)}>
                {server?.channels.map((c) => (
                  <option key={c.id} value={c.id}>#{c.name}{c.followId ? ` (${gt("following")})` : ""}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={busy || !channel || Boolean(channel.followId)}
              onClick={() => void follow()}
              className="rounded-md bg-[var(--app-accent)] px-4 py-2 text-sm font-medium text-[var(--text-on-accent)] hover:opacity-90 disabled:opacity-60"
            >
              {channel?.followId ? gt("Already following") : gt("Follow")}
            </button>
          </div>
        )}

        {following.length > 0 && (
          <div className="flex flex-col gap-1 border-t border-[var(--border-subtle)] pt-3">
            <span className="text-xs font-bold uppercase text-[var(--text-secondary)]">{gt("Following in")}</span>
            {following.map(({ server: s, channel: c }) => (
              <div key={c.id} className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--bg-hover)]")}>
                <Hash className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {c.name} <span className="text-[var(--text-muted)]">· {s.name}</span>
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void unfollow(c.followId!)}
                  className="text-xs font-medium text-red-500 hover:underline disabled:opacity-60"
                >
                  {gt("Unfollow")}
                </button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
