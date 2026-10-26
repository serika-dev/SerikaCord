"use client";

import { useEffect, useState } from "react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { Plus, Radio, Webhook } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/Loader";
import { WebhookCard, type ChannelWebhookRow } from "@/components/dialogs/WebhookCard";
import { MAX_WEBHOOKS_PER_CHANNEL } from "@/lib/chat/webhook";

/** Create a webhook with a friendly default name (POST without a name), Discord's "New Webhook". */
export async function createDefaultWebhook(channelId: string): Promise<ChannelWebhookRow> {
  const res = await fetch(`/api/channels/${channelId}/webhooks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body?.error === "string" ? body.error : "");
  return body as ChannelWebhookRow;
}

/** Header card of a webhooks list: what webhooks are, and the New Webhook button. */
export function WebhooksHeader({
  description,
  onCreate,
  creating,
  disabled,
  disabledReason,
}: {
  description: string;
  onCreate: () => void;
  creating: boolean;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const gt = useGT();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)]">
      <div className="flex items-start gap-3 min-w-0">
        <span className="w-10 h-10 shrink-0 rounded-lg bg-[var(--app-accent)]/15 text-[var(--app-accent)] flex items-center justify-center">
          <Webhook className="w-5 h-5" />
        </span>
        <div className="space-y-1 min-w-0">
          <span className="text-sm font-semibold text-[var(--text-primary)]">{gt("Webhooks")}</span>
          <p className="text-xs text-[var(--text-muted)] max-w-md leading-relaxed">{description}</p>
        </div>
      </div>
      <Button
        onClick={onCreate}
        disabled={creating || disabled}
        title={disabled ? disabledReason : undefined}
        className="bg-[var(--app-accent)] hover:opacity-90 text-[var(--text-on-accent)] text-sm px-4 h-9"
      >
        {creating ? <Loader size={16} className="size-4" /> : <Plus className="w-4 h-4" />}
        {gt("New Webhook")}
      </Button>
    </div>
  );
}

/**
 * Channel settings → Integrations: this channel's webhooks. "New Webhook"
 * creates one right away with a default name and opens it for editing.
 */
export function ChannelWebhooksPanel({
  channelId,
  channelOptions,
}: {
  channelId: string;
  /** Channels a webhook may move to (text, announcement, forum). */
  channelOptions: Array<{ id: string; name: string }>;
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
        const res = await fetch(`/api/channels/${channelId}/webhooks`);
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
  }, [channelId]);

  const create = async () => {
    setCreating(true);
    try {
      const row = await createDefaultWebhook(channelId);
      setWebhooks((list) => [row, ...list]);
      setNewId(row.id);
      toast.success(gt("Webhook created"));
    } catch (err) {
      toast.error((err instanceof Error && err.message) || gt("Failed to create webhook"));
    } finally {
      setCreating(false);
    }
  };

  const full = webhooks.length >= MAX_WEBHOOKS_PER_CHANNEL;

  return (
    <div className="space-y-4">
      <WebhooksHeader
        description={gt("Webhooks are an easy way to get messages from other apps into this channel. Give each one its own name and picture.")}
        onCreate={() => void create()}
        creating={creating}
        disabled={forbidden || full}
        disabledReason={full ? gt("A channel can have up to {max} webhooks.", { max: MAX_WEBHOOKS_PER_CHANNEL }) : undefined}
      />

      {loading ? (
        <div className="flex justify-center py-10"><Loader size={24} /></div>
      ) : loadFailed ? (
        <div className="text-center py-12 px-4 border border-dashed border-[var(--border-subtle)] rounded-xl bg-[var(--bg-app)] text-[var(--text-muted)] text-sm">
          {gt("Couldn't load webhooks. Try again in a moment.")}
        </div>
      ) : forbidden ? (
        <div className="text-center py-12 px-4 border border-dashed border-[var(--border-subtle)] rounded-xl bg-[var(--bg-app)] text-[var(--text-muted)] text-sm">
          {gt("You need the Manage Webhooks permission to view this channel's webhooks.")}
        </div>
      ) : webhooks.length === 0 ? (
        <div className="text-center py-12 px-4 border border-dashed border-[var(--border-subtle)] rounded-xl bg-[var(--bg-app)] text-[var(--text-muted)] text-sm flex flex-col items-center gap-3">
          <Radio className="w-10 h-10 opacity-40" />
          <span>{gt("No webhooks in this channel yet. Create one to start posting from other apps.")}</span>
        </div>
      ) : (
        <div className="space-y-3">
          {webhooks.map((w) => (
            <WebhookCard
              key={w.id}
              webhook={w}
              channelOptions={channelOptions}
              defaultOpen={w.id === newId}
              onUpdated={(row) => setWebhooks((list) => (
                row.channel_id === channelId ? list.map((x) => (x.id === row.id ? row : x)) : list.filter((x) => x.id !== row.id)
              ))}
              onDeleted={(id) => setWebhooks((list) => list.filter((x) => x.id !== id))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default ChannelWebhooksPanel;
