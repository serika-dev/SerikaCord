"use client";
/**
 * The Game Invitation card (CORD-92): posted when an Activity is launched in a
 * text chat (server channel, DM, group DM). Shows the app, a live status line
 * and Play / Join. It reads the instance from the Activities store, which the
 * chat stream keeps fresh (`activity_update`), so the message itself never
 * changes and MessageGroup's memo comparator needs nothing new.
 */
import { useState } from "react";
import { useGT } from "gt-next";
import { Gamepad2 } from "lucide-react";
import { cdnImage } from "@/lib/utils";
import { cardStatus } from "@/lib/activities/instances";
import { joinActivity, launchActivity, useInstanceView, useOpenActivity } from "@/lib/activities/clientStore";

export default function ActivityInviteCard({
  instanceId,
  applicationId,
  channelId,
  currentUserId,
}: {
  instanceId: string;
  applicationId: string;
  channelId: string;
  currentUserId?: string | null;
}) {
  const gt = useGT();
  const view = useInstanceView(instanceId);
  const open = useOpenActivity();
  const [busy, setBusy] = useState(false);
  const ended = !view || Boolean(view.ended || view.endedAt);
  const participants = view?.participants ?? [];
  const status = view ? cardStatus({ ended, participantCount: participants.length }) : null;
  const playing = !ended && participants.some((p) => p.id === currentUserId);
  const isOpenHere = open?.instanceId === instanceId;
  const name = view?.app?.name ?? gt("Activity");
  const art = view?.app?.imageUrl ?? view?.app?.icon ?? null;

  const onPlay = async () => {
    setBusy(true);
    if (ended) await launchActivity(applicationId, channelId, false);
    else await joinActivity(instanceId);
    setBusy(false);
  };

  const statusText =
    status === null ? gt("Loading…")
      : status === "ended" ? gt("Game ended. Start a new one?")
        : status === "waiting" ? gt("Waiting for players…")
          : gt("{count} playing", { count: participants.length });

  const buttonText = busy ? gt("Starting…") : ended ? gt("Play") : playing || isOpenHere ? gt("Open") : gt("Join");

  return (
    <div className="mt-1 max-w-[420px] rounded-xl border overflow-hidden" style={{ borderColor: "var(--app-border)", background: "var(--app-surface)" }}>
      {art && (
        <div className="aspect-[16/7] w-full overflow-hidden" style={{ background: "var(--app-bg)" }}>
          <img src={cdnImage(art)} alt="" className="w-full h-full object-cover" loading="lazy" />
        </div>
      )}
      <div className="flex items-center gap-3 p-3">
        {view?.app?.icon
          ? <img src={cdnImage(view.app.icon)} alt="" className="size-10 rounded-lg object-cover shrink-0" />
          : <div className="size-10 rounded-lg shrink-0 flex items-center justify-center" style={{ background: "var(--app-accent)" }}><Gamepad2 className="size-5 text-white" /></div>}
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--app-muted)" }}>{gt("Game Invitation")}</p>
          <p className="text-sm font-semibold truncate" style={{ color: "var(--app-text)" }}>{name}</p>
          <p className="text-xs truncate" style={{ color: "var(--app-muted)" }}>{statusText}</p>
        </div>
        {!ended && participants.length > 0 && (
          <div className="hidden sm:flex -space-x-2">
            {participants.slice(0, 3).map((p) => (
              p.avatar
                ? <img key={p.id} src={cdnImage(p.avatar)} alt="" title={p.displayName ?? p.username} className="size-6 rounded-full border-2 object-cover" style={{ borderColor: "var(--app-surface)" }} />
                : <span key={p.id} title={p.displayName ?? p.username} className="size-6 rounded-full border-2 text-[10px] flex items-center justify-center font-semibold text-white" style={{ borderColor: "var(--app-surface)", background: "var(--app-accent)" }}>{(p.displayName ?? p.username).slice(0, 1).toUpperCase()}</span>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => void onPlay()}
          disabled={busy || !view}
          className="px-4 py-2 text-sm rounded-lg font-semibold text-white shrink-0 disabled:opacity-50"
          style={{ background: "var(--app-accent)" }}
        >
          {buttonText}
        </button>
      </div>
    </div>
  );
}
