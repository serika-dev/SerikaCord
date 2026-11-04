"use client";
/**
 * Where a chat or call shows its Activity (CORD-92), like Discord: a text-chat
 * Activity docks at the top of the chat, a call Activity fills the call stage.
 * "Hide chat" (the chevron) lets a text-chat Activity cover the conversation
 * below the chat header, with the app's name above it, until it is shown again.
 * The slot only reserves the space and draws the bars; the frame itself is
 * rendered once by ActivityHost and laid over the registered area, so it
 * keeps running while you navigate. Desktop only; phones show it full screen.
 */
import { useEffect, useRef } from "react";
import { useGT } from "gt-next";
import { ChevronDown, ChevronUp, ExternalLink, Maximize, Minimize2, PhoneOff, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { cdnImage, cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  canFullscreenActivity, canPopOut, closeActivity, popOutActivity, registerActivitySlot, returnFromPopout, setActivityLayout, slotKey, toggleActivityFullscreen, toggleChatHidden,
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
  const view = useInstanceView(open.instanceId);
  const areaRef = useRef<HTMLDivElement | null>(null);
  const markerRef = useRef<HTMLDivElement | null>(null);
  const coverRef = useRef<HTMLDivElement | null>(null);
  const chatHidden = !voice && open.chatHidden;

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    return registerActivitySlot(slotKey(channelId, voice), el);
  }, [channelId, voice, chatHidden]);

  // Hide chat: cover from where the slot sits (just below the chat header) to
  // the bottom of the conversation column. The column is `relative`.
  useEffect(() => {
    const marker = markerRef.current;
    const cover = coverRef.current;
    if (!chatHidden || !marker || !cover) return;
    const place = () => { cover.style.top = `${marker.offsetTop}px`; };
    place();
    const ro = new ResizeObserver(place);
    if (marker.parentElement) ro.observe(marker.parentElement);
    return () => ro.disconnect();
  }, [chatHidden]);

  const away = open.layout !== "inline";
  const awayNotice = away && (
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
  );

  if (chatHidden) {
    return (
      <>
        <div ref={markerRef} className="h-0 w-full shrink-0" aria-hidden />
        <div ref={coverRef} className="absolute left-0 right-0 bottom-0 z-20 flex flex-col" style={{ background: "var(--app-bg)" }}>
          <div className="h-11 shrink-0 flex items-center justify-center text-sm font-semibold" style={{ color: "var(--app-text)", background: "#000" }}>
            {view?.app?.name ?? open.frame.app.name}
          </div>
          <div ref={areaRef} className="relative flex-1 min-h-0 w-full" style={{ background: "#000" }}>{awayNotice}</div>
          <ActivityBar open={open} voice={false} chatHidden />
        </div>
      </>
    );
  }

  return (
    <div className={cn("flex flex-col min-h-0", voice ? "flex-[3]" : "shrink-0 border-b", className)} style={{ borderColor: "var(--app-border)" }}>
      <div
        ref={areaRef}
        className={cn("relative w-full", voice ? "flex-1 min-h-0" : "")}
        style={voice ? { background: "#000" } : { height: "clamp(240px, 46vh, 600px)", background: "#000" }}
      >
        {awayNotice}
      </div>
      <ActivityBar open={open} voice={voice} chatHidden={false} />
    </div>
  );
}

/** Participants on the left; hide chat / minimize / leave in the middle; pop-out on the right. */
export function ActivityBar({ open, voice, chatHidden }: { open: OpenActivity; voice: boolean; chatHidden: boolean }) {
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
          <button type="button" onClick={toggleChatHidden} className={btn} title={chatHidden ? gt("Show chat") : gt("Hide chat")} aria-label={chatHidden ? gt("Show chat") : gt("Hide chat")}>
            {chatHidden ? <ChevronUp className="size-5" /> : <ChevronDown className="size-5" />}
          </button>
        )}
        <button type="button" onClick={() => setActivityLayout("mini")} className={btn} title={gt("Minimize")} aria-label={gt("Minimize")}>
          <Minimize2 className="size-5" />
        </button>
      </div>
      <button type="button" onClick={closeActivity} className="px-4 py-2 rounded-xl text-white" style={{ background: "#ef4444" }} title={gt("Leave Activity")} aria-label={gt("Leave Activity")}>
        <PhoneOff className="size-5" />
      </button>
      <div className="flex-1 flex justify-end gap-1">
        {canFullscreenActivity() && open.layout === "inline" && (
          <button type="button" onClick={toggleActivityFullscreen} className={btn} style={{ color: "var(--app-muted)" }} title={gt("Full screen")} aria-label={gt("Full screen")}>
            <Maximize className="size-5" />
          </button>
        )}
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
