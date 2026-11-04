"use client";
/**
 * Where a chat or call shows its Activity (CORD-92), like Discord: a text-chat
 * Activity docks at the top of the chat, a call Activity fills the call stage.
 * The slot only reserves the space and draws the control bar; the frame itself
 * is rendered once by ActivityHost and laid over the registered area, so it
 * keeps running while you navigate. Desktop only; phones show it full screen.
 */
import { useEffect, useRef } from "react";
import { useGT } from "gt-next";
import { ChevronDown, ChevronUp, ExternalLink, Minimize2, PhoneOff, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { cdnImage, cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  canPopOut, closeActivity, popOutActivity, registerActivitySlot, returnFromPopout, setActivityLayout, slotKey, toggleActivityCollapsed,
  useInstanceView, useOpenActivityAt, type OpenActivity,
} from "@/lib/activities/clientStore";

export function ActivitySlot({ channelId, voice, className }: { channelId: string | null | undefined; voice: boolean; className?: string }) {
  const open = useOpenActivityAt(channelId, voice);
  const isMobile = useIsMobile();
  if (!open || !channelId || isMobile) return null;
  return <SlotBody key={open.instanceId} open={open} channelId={channelId} voice={voice} className={className} />;
}

function SlotBody({ open, channelId, voice, className }: { open: OpenActivity; channelId: string; voice: boolean; className?: string }) {
  const gt = useGT();
  const areaRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    return registerActivitySlot(slotKey(channelId, voice), el);
  }, [channelId, voice]);
  const collapsed = !voice && open.collapsed;
  const away = open.layout !== "inline";

  return (
    <div className={cn("flex flex-col min-h-0", voice ? "flex-[3]" : "shrink-0 border-b", className)} style={{ borderColor: "var(--app-border)" }}>
      <div
        ref={areaRef}
        className={cn("relative w-full", voice ? "flex-1 min-h-0" : "")}
        style={voice ? { background: "#000" } : { height: collapsed ? 0 : "clamp(240px, 46vh, 600px)", background: "#000" }}
      >
        {away && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm" style={{ color: "var(--app-muted)" }}>
            <p>{open.layout === "popout" ? gt("This Activity is open in another window.") : gt("This Activity is playing in the mini player.")}</p>
            <button
              type="button"
              onClick={() => (open.layout === "popout" ? returnFromPopout() : setActivityLayout("inline"))}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white font-medium"
              style={{ background: "var(--app-accent)" }}
            >
              <Undo2 className="size-4" />{gt("Bring it back here")}
            </button>
          </div>
        )}
      </div>
      <ActivityBar open={open} voice={voice} collapsed={collapsed} />
    </div>
  );
}

/** Participants on the left; collapse / minimize / leave in the middle; pop-out on the right. */
export function ActivityBar({ open, voice, collapsed }: { open: OpenActivity; voice: boolean; collapsed: boolean }) {
  const gt = useGT();
  const view = useInstanceView(open.instanceId);
  const participants = view?.participants ?? [];
  const btn = "p-2 rounded-lg hover:opacity-80";
  return (
    <div className="h-14 shrink-0 flex items-center px-3 gap-2" style={{ background: "var(--app-bg)" }}>
      <div className="flex -space-x-2 flex-1 min-w-0" aria-label={gt("{count} playing", { count: participants.length })}>
        {participants.slice(0, 6).map((p) => (
          p.avatar
            ? <img key={p.id} src={cdnImage(p.avatar)} alt={p.displayName ?? p.username} title={p.displayName ?? p.username} className="size-8 rounded-full border-2 object-cover" style={{ borderColor: "var(--app-bg)" }} />
            : <span key={p.id} title={p.displayName ?? p.username} className="size-8 rounded-full border-2 text-xs flex items-center justify-center font-semibold text-white" style={{ borderColor: "var(--app-bg)", background: "var(--app-accent)" }}>{(p.displayName ?? p.username).slice(0, 1).toUpperCase()}</span>
        ))}
      </div>
      <div className="flex items-center gap-1 rounded-xl px-1 py-1" style={{ background: "var(--app-surface)", color: "var(--app-text)" }}>
        {!voice && (
          <button type="button" onClick={toggleActivityCollapsed} className={btn} title={collapsed ? gt("Show Activity") : gt("Hide Activity")} aria-label={collapsed ? gt("Show Activity") : gt("Hide Activity")}>
            {collapsed ? <ChevronUp className="size-5" /> : <ChevronDown className="size-5" />}
          </button>
        )}
        <button type="button" onClick={() => setActivityLayout("mini")} className={btn} title={gt("Minimize")} aria-label={gt("Minimize")}>
          <Minimize2 className="size-5" />
        </button>
      </div>
      <button type="button" onClick={closeActivity} className="px-4 py-2 rounded-xl text-white" style={{ background: "#ef4444" }} title={gt("Leave Activity")} aria-label={gt("Leave Activity")}>
        <PhoneOff className="size-5" />
      </button>
      <div className="flex-1 flex justify-end">
        {canPopOut() && open.layout !== "popout" && (
          <button
            type="button"
            onClick={() => { if (!popOutActivity()) toast.error(gt("Allow pop-ups for SerikaCord to open the Activity in its own window.")); }}
            className={btn}
            style={{ color: "var(--app-muted)" }}
            title={gt("Pop out")}
            aria-label={gt("Pop out")}
          >
            <ExternalLink className="size-5" />
          </button>
        )}
      </div>
    </div>
  );
}
