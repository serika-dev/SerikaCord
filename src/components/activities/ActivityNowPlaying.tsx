"use client";
/**
 * "Now playing" card above the user panel (CORD-92): the open Activity's icon,
 * name and how long it has been running. Click to go back to it, or leave.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useGT } from "gt-next";
import { LogOut } from "lucide-react";
import { cdnImage } from "@/lib/utils";
import { closeActivity, returnFromPopout, setActivityLayout, useInstanceView, useOpenActivity } from "@/lib/activities/clientStore";

function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function ActivityNowPlaying() {
  const open = useOpenActivity();
  if (!open) return null;
  return <Card key={open.instanceId} />;
}

function Card() {
  const gt = useGT();
  const router = useRouter();
  const open = useOpenActivity();
  const view = useInstanceView(open?.instanceId);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  if (!open) return null;
  const name = view?.app?.name ?? open.frame.app.name;
  const icon = view?.app?.icon ?? open.frame.app.icon;
  const started = view?.startedAt ?? null;
  const goBack = () => {
    if (open.layout === "popout") { returnFromPopout(); return; }
    router.push(open.returnPath);
    setActivityLayout("inline");
  };
  return (
    <div className="hidden desk:flex items-center gap-2 px-2 py-2 border-t" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-sidebar)" }}>
      <button type="button" onClick={goBack} className="flex items-center gap-2 flex-1 min-w-0 text-left rounded-md hover:opacity-90" title={gt("Go to Activity")}>
        {icon
          ? <img src={cdnImage(icon)} alt="" className="size-9 rounded-lg object-cover shrink-0" />
          : <span className="size-9 rounded-lg shrink-0" style={{ background: "var(--app-accent)" }} />}
        <span className="min-w-0">
          <span className="block text-sm font-semibold truncate" style={{ color: "var(--app-text)" }}>{name}</span>
          <span className="block text-xs truncate" style={{ color: "var(--app-muted)" }}>
            {open.layout === "popout"
              ? gt("Open in another window")
              : started ? gt("{time} elapsed", { time: elapsed(now - started) }) : gt("Activity")}
          </span>
        </span>
      </button>
      <button type="button" onClick={closeActivity} className="p-2 rounded-md hover:opacity-80" style={{ color: "var(--app-muted)" }} title={gt("Leave Activity")} aria-label={gt("Leave Activity")}>
        <LogOut className="size-4" />
      </button>
    </div>
  );
}
