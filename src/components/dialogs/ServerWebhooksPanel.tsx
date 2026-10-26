"use client";

import { useEffect, useMemo, useState } from "react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { Hash, Radio } from "lucide-react";
import { Loader } from "@/components/ui/Loader";
import { WebhookCard, type ChannelWebhookRow } from "@/components/dialogs/WebhookCard";
import { WebhooksHeader, createDefaultWebhook } from "@/components/dialogs/ChannelWebhooksPanel";
import { MAX_WEBHOOKS_PER_CHANNEL } from "@/lib/chat/webhook";

const WEBHOOK_CHANNEL_TYPES = new Set(["text", "announcement", "forum"]);

/**
 * Server settings → Webhooks: every webhook in the server, grouped by
 * channel in sidebar order, with the same cards as channel settings (rename,
 * avatar, move, copy URL, delete). "New Webhook" adds one to the first text
 * channel that still has room. Needs Manage Webhooks (the list carries the
 * webhook URLs); without it the panel says so.
 */
export function ServerWebhooksPanel({
  serverId,
  channels,
}: {
  serverId: string;
  /** The server's channels (useServer().channels): names, order and where webhooks may go. */
  channels: Array<{ id: string; name: string; type: string; position?: number; parentId?: string | null }>;
}) {
  const gt = useGT();
  const [webhooks, setWebhooks] = useState<ChannelWebhookRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newId, setNewId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/servers/${serverId}/webhooks`);
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        setForbidden(res.status === 403);
        setWebhooks(res.ok && Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setLoadFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [serverId]);

  const channelOptions = useMemo(
    () => channels
      .filter((c) => WEBHOOK_CHANNEL_TYPES.has(c.type))
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((c) => ({ id: c.id, name: c.name })),
    [channels],
  );

  const groups = useMemo(() => {
    const order = new Map(channelOptions.map((c, i) => [c.id, i]));
    const names = new Map(channels.map((c) => [c.id, c.name]));
    const byChannel = new Map<string, ChannelWebhookRow[]>();
    for (const w of webhooks) {
      const list = byChannel.get(w.channel_id) ?? [];
      list.push(w);
      byChannel.set(w.channel_id, list);
    }
    return [...byChannel.entries()]
      .map(([channelId, rows]) => ({ channelId, name: names.get(channelId) ?? null, rows }))
      .sort((a, b) => (order.get(a.channelId) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.channelId) ?? Number.MAX_SAFE_INTEGER));
  }, [webhooks, channels, channelOptions]);

  // The first text channel with room for another webhook.
  const createTarget = useMemo(() => {
    const counts = new Map<string, number>();
    for (const w of webhooks) counts.set(w.channel_id, (counts.get(w.channel_id) ?? 0) + 1);
    return channelOptions.find((c) => (counts.get(c.id) ?? 0) < MAX_WEBHOOKS_PER_CHANNEL)?.id ?? null;
  }, [webhooks, channelOptions]);

  const create = async () => {
    if (!createTarget) return;
    setCreating(true);
    try {
      const row = await createDefaultWebhook(createTarget);
      setWebhooks((list) => [row, ...list]);
      setNewId(row.id);
      toast.success(gt("Webhook created"));
    } catch (err) {
      toast.error((err instanceof Error && err.message) || gt("Failed to create webhook"));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-5">
      <WebhooksHeader
        description={gt("Webhooks post messages from other apps into your channels. Each one has its own name and picture, and you can move it between channels.")}
        onCreate={() => void create()}
        creating={creating}
        disabled={forbidden || !createTarget}
        disabledReason={!createTarget ? gt("Make a text channel first.") : undefined}
      />

      {loading ? (
        <div className="flex justify-center py-10"><Loader size={24} /></div>
      ) : loadFailed ? (
        <div className="text-center py-12 px-4 border border-dashed border-[var(--border-subtle)] rounded-xl bg-[var(--bg-app)] text-[var(--text-muted)] text-sm">
          {gt("Couldn't load webhooks. Try again in a moment.")}
        </div>
      ) : forbidden ? (
        <div className="text-center py-12 px-4 border border-dashed border-[var(--border-subtle)] rounded-xl bg-[var(--bg-app)] text-[var(--text-muted)] text-sm">
          {gt("You need the Manage Webhooks permission to see this server's webhooks.")}
        </div>
      ) : groups.length === 0 ? (
        <div className="text-center py-12 px-4 border border-dashed border-[var(--border-subtle)] rounded-xl bg-[var(--bg-app)] text-[var(--text-muted)] text-sm flex flex-col items-center gap-3">
          <Radio className="w-10 h-10 opacity-40" />
          <span>{gt("This server has no webhooks yet.")}</span>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.channelId} className="space-y-2">
            <h3 className="flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
              <Hash className="w-3.5 h-3.5" />
              <span className="truncate">{g.name ?? gt("Unknown channel")}</span>
              <span className="ml-1 font-medium normal-case tracking-normal">· {g.rows.length}</span>
            </h3>
            <div className="space-y-3">
              {g.rows.map((w) => (
                <WebhookCard
                  key={w.id}
                  webhook={w}
                  channelOptions={channelOptions}
                  defaultOpen={w.id === newId}
                  onUpdated={(row) => setWebhooks((list) => list.map((x) => (x.id === row.id ? row : x)))}
                  onDeleted={(id) => setWebhooks((list) => list.filter((x) => x.id !== id))}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

export default ServerWebhooksPanel;
