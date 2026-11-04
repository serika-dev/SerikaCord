"use client";
/**
 * A popped-out Activity (CORD-92): its own browser window on SerikaCord's
 * origin, opened by the main window with the frame info in the URL hash.
 * Runs the same SDK host as the main window; live updates arrive over a
 * BroadcastChannel. "Return" hands the Activity back to the main window,
 * "Leave" leaves it.
 */
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useGT } from "gt-next";
import { LogOut, Undo2 } from "lucide-react";
import { cdnImage } from "@/lib/utils";
import { postToMainWindow, useInstanceView, type PopoutPayload } from "@/lib/activities/clientStore";

const ActivityFrame = dynamic(() => import("@/components/activities/ActivityFrame"), { ssr: false });

function readPayload(): PopoutPayload | null {
  try {
    const raw = decodeURIComponent(window.location.hash.slice(1));
    const p = JSON.parse(raw) as PopoutPayload;
    return p && typeof p.instanceId === "string" && p.frame && typeof p.frame.origin === "string" ? p : null;
  } catch {
    return null;
  }
}

export default function ActivityPopoutPage() {
  const gt = useGT();
  const [payload, setPayload] = useState<PopoutPayload | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    const p = readPayload();
    const t = window.setTimeout(() => { if (p) setPayload(p); else setMissing(true); }, 0);
    return () => window.clearTimeout(t);
  }, []);
  const view = useInstanceView(payload?.instanceId);

  if (missing) return <p className="p-6 text-sm" style={{ color: "var(--app-muted)" }}>{gt("This window is no longer connected to an Activity.")}</p>;
  if (!payload) return null;
  const name = view?.app?.name ?? payload.frame.app.name;
  const icon = view?.app?.icon ?? payload.frame.app.icon;
  const back = () => { postToMainWindow({ type: "popout_return", instanceId: payload.instanceId }); window.close(); };
  const leave = () => { postToMainWindow({ type: "popout_leave", instanceId: payload.instanceId }); window.close(); };

  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: "var(--app-bg)", color: "var(--app-text)" }}>
      <title>{name}</title>
      <header className="h-11 shrink-0 flex items-center gap-2 px-3 border-b" style={{ borderColor: "var(--app-border)" }}>
        {icon ? <img src={cdnImage(icon)} alt="" className="size-6 rounded-md object-cover" /> : null}
        <span className="text-sm font-semibold truncate flex-1">{name}</span>
        <button type="button" onClick={back} className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-lg hover:opacity-80" style={{ color: "var(--app-muted)" }}>
          <Undo2 className="size-4" />{gt("Return to SerikaCord")}
        </button>
        <button type="button" onClick={leave} className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-lg text-white" style={{ background: "#ef4444" }}>
          <LogOut className="size-4" />{gt("Leave Activity")}
        </button>
      </header>
      <div className="flex-1 min-h-0">
        <ActivityFrame
          instanceId={payload.instanceId}
          frame={payload.frame}
          appName={name}
          appIcon={icon ? cdnImage(icon) : null}
          layoutMode={0}
          inviteLink={null}
          onClose={leave}
        />
      </div>
    </div>
  );
}
