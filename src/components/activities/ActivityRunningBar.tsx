"use client";
/**
 * Encrypted DMs and group DMs get no Game Invitation card (CORD-92): the
 * server can't post readable rows there (lib/e2ee). This bar takes its place
 * above the composer: an Activity running in this chat that you're not in,
 * with Join. Fed by the running list once, then by the `activity_update` stream.
 */
import { useEffect, useState } from "react";
import { useGT } from "gt-next";
import { Gamepad2 } from "lucide-react";
import { cdnImage } from "@/lib/utils";
import { joinActivity, onActivityEvent, useInstanceView, useOpenActivity } from "@/lib/activities/clientStore";

export default function ActivityRunningBar({ channelId, currentUserId }: { channelId: string; currentUserId?: string | null }) {
  const [found, setFound] = useState<{ channelId: string; ids: string[] }>({ channelId, ids: [] });
  const ids = found.channelId === channelId ? found.ids : [];

  useEffect(() => {
    let cancelled = false;
    const add = (id: string) => setFound((f) => (f.channelId !== channelId ? { channelId, ids: [id] } : f.ids.includes(id) ? f : { channelId, ids: [...f.ids, id] }));
    void fetch(`/api/activities/channels/${encodeURIComponent(channelId)}/running`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { running?: Array<{ id: string }> } | null) => { if (!cancelled) for (const v of d?.running ?? []) add(v.id); })
      .catch(() => {});
    const off = onActivityEvent((e) => {
      if (e.type === "activity_update" && e.instance.location?.channelId === channelId && !e.instance.location.voice) add(e.instance.id);
    });
    return () => { cancelled = true; off(); };
  }, [channelId]);

  if (!ids.length) return null;
  return (
    <div className="px-4 pb-2 flex flex-col gap-2">
      {ids.slice(-3).map((id) => <RunningRow key={id} instanceId={id} currentUserId={currentUserId} />)}
    </div>
  );
}

function RunningRow({ instanceId, currentUserId }: { instanceId: string; currentUserId?: string | null }) {
  const gt = useGT();
  const view = useInstanceView(instanceId);
  const open = useOpenActivity();
  const [busy, setBusy] = useState(false);
  const participants = view?.participants ?? [];
  const ended = !view || Boolean(view.ended || view.endedAt) || participants.length === 0;
  const mine = participants.some((p) => p.id === currentUserId) || open?.instanceId === instanceId;
  if (ended || mine) return null;
  const name = view?.app?.name ?? gt("Activity");
  const icon = view?.app?.icon ? cdnImage(view.app.icon) : null;
  const starter = participants.find((p) => p.id === view?.launcherId) ?? participants[0];

  return (
    <div className="flex items-center gap-3 rounded-xl border px-3 py-2" style={{ background: "var(--app-surface)", borderColor: "var(--app-border)", color: "var(--app-text)" }}>
      {icon
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={icon} alt="" className="size-9 rounded-lg object-cover shrink-0" />
        : <span className="size-9 rounded-lg flex items-center justify-center shrink-0 text-white" style={{ background: "var(--app-accent)" }}><Gamepad2 className="size-5" /></span>}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold truncate">{name}</div>
        <div className="text-xs truncate" style={{ color: "var(--app-muted)" }}>
          {starter
            ? gt("{name} is playing · {count} in the Activity", { name: starter.displayName ?? starter.username, count: participants.length })
            : gt("{count} in the Activity", { count: participants.length })}
        </div>
      </div>
      <div className="flex -space-x-2 shrink-0">
        {participants.slice(0, 4).map((p) => (
          p.avatar
            // eslint-disable-next-line @next/next/no-img-element
            ? <img key={p.id} src={cdnImage(p.avatar)} alt="" title={p.displayName ?? p.username} className="size-6 rounded-full object-cover border-2" style={{ borderColor: "var(--app-surface)" }} />
            : <span key={p.id} title={p.displayName ?? p.username} className="size-6 rounded-full border-2 text-[10px] flex items-center justify-center font-semibold text-white" style={{ borderColor: "var(--app-surface)", background: "var(--app-accent)" }}>{(p.displayName ?? p.username).slice(0, 1).toUpperCase()}</span>
        ))}
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={async () => { setBusy(true); await joinActivity(instanceId, false, name); setBusy(false); }}
        className="px-3 py-1.5 rounded-lg text-sm font-medium text-white shrink-0 disabled:opacity-60"
        style={{ background: "var(--app-accent)" }}
      >
        {gt("Join")}
      </button>
    </div>
  );
}
