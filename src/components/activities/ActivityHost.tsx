"use client";
/**
 * Activities host (CORD-92), mounted once in the app shell.
 *
 * Renders the open Activity's frame exactly once and moves it (by style, so
 * the iframe never reloads) to where it belongs:
 *  - docked: over the slot of its chat or call (ActivitySlot), like Discord;
 *  - mini: a small floating player when you're elsewhere (or minimized);
 *  - full screen on phones;
 *  - nowhere while it's popped out into its own window.
 * Also hosts the shelf (launcher), the 18+ confirmation and error toasts.
 */
import { useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useGT } from "gt-next";
import { Maximize2, Minimize2, X } from "lucide-react";
import { toast } from "sonner";
import { cdnImage } from "@/lib/utils";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useBackHandler } from "@/hooks/useBackHandler";
import { MountWhenOpened } from "@/components/ui/MountWhenOpened";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  clearActivityError, closeActivity, setActivityLayout, useActivityError, useActivityShelf, useAgePrompt, useInstanceView,
  useOpenActivity, useOpenActivitySlot,
} from "@/lib/activities/clientStore";
import type { LayoutMode } from "./ActivityFrame";

const ActivityFrame = dynamic(() => import("./ActivityFrame"), { ssr: false });
const ActivityShelf = dynamic(() => import("./ActivityShelf"), { ssr: false });

const MINI_W = 384;
const MINI_H = 216;
const MINI_HEADER = 36;

function useErrorToasts() {
  const gt = useGT();
  const error = useActivityError();
  useEffect(() => {
    if (!error) return;
    const messages: Record<string, string> = {
      not_configured: gt("Activities are not available on this server."),
      not_enabled: gt("This Activity is not available."),
      no_access: gt("You do not have access to this channel."),
      missing_permissions: gt("You do not have permission to start Activities here."),
      not_in_call: gt("Join the call to play this Activity."),
      platform: gt("This Activity is not available on this device."),
      channel_type: gt("Activities can not be started here."),
      full: gt("This Activity is full."),
      not_found: gt("This Activity has ended."),
      rate_limited: gt("Slow down a little and try again."),
    };
    toast.error(messages[error.code] ?? gt("Couldn't start the Activity. Try again."));
    clearActivityError();
  }, [error, gt]);
}

function AgeDialog() {
  const gt = useGT();
  const prompt = useAgePrompt();
  if (!prompt) return null;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) prompt.cancel(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{gt("Age-restricted Activity")}</DialogTitle>
          <DialogDescription>
            {prompt.appName
              ? gt("{name} is for adults (18+) and may contain content that isn't suitable for everyone. Continue only if you're 18 or older.", { name: prompt.appName })
              : gt("This Activity is for adults (18+) and may contain content that isn't suitable for everyone. Continue only if you're 18 or older.")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button type="button" onClick={prompt.cancel} className="px-4 py-2 text-sm rounded-lg" style={{ color: "var(--app-text)" }}>{gt("Cancel")}</button>
          <button type="button" onClick={prompt.confirm} className="px-4 py-2 text-sm rounded-lg font-medium text-white" style={{ background: "var(--app-accent)" }}>{gt("I'm 18 or older")}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ActivityHost() {
  useErrorToasts();
  const open = useOpenActivity();
  const shelf = useActivityShelf();
  return (
    <>
      <MountWhenOpened open={!!shelf}>
        {shelf && <ActivityShelf request={shelf} />}
      </MountWhenOpened>
      <AgeDialog />
      {open && open.layout !== "popout" && <ActivityStage key={open.instanceId} />}
    </>
  );
}

type Mode = "docked" | "mini" | "full";

function ActivityStage() {
  const gt = useGT();
  const router = useRouter();
  const open = useOpenActivity();
  const slot = useOpenActivitySlot();
  const isMobile = useIsMobile();
  const view = useInstanceView(open?.instanceId);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const mode: Mode = !open ? "mini"
    : isMobile ? (open.layout === "mini" ? "mini" : "full")
      : open.layout === "inline" && slot ? "docked"
        : "mini";

  // Geometry is set here only (never by React), so switching modes leaves nothing stale.
  // Docked: follow the slot every frame (position + size) without re-rendering.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const s = box.style;
    for (const k of ["left", "top", "right", "bottom", "width", "height"] as const) s[k] = "";
    if (mode === "full") { s.left = "0px"; s.right = "0px"; s.top = "calc(env(safe-area-inset-top) + 44px)"; s.bottom = "0px"; return; }
    if (mode === "mini") { s.right = "16px"; s.bottom = "16px"; s.width = `${MINI_W}px`; s.height = `${MINI_H}px`; return; }
    if (!slot) return;
    let raf = 0;
    let last = "";
    const follow = () => {
      const r = slot.getBoundingClientRect();
      const key = `${r.left}|${r.top}|${r.width}|${r.height}`;
      if (key !== last) {
        last = key;
        s.left = `${r.left}px`;
        s.top = `${r.top}px`;
        s.width = `${r.width}px`;
        s.height = `${r.height}px`;
      }
      raf = requestAnimationFrame(follow);
    };
    raf = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(raf);
  }, [mode, slot]);

  const close = useCallback((reason?: string) => {
    if (reason === "ended") toast(gt("The Activity has ended."));
    closeActivity();
  }, [gt]);
  useBackHandler(isMobile && mode === "full", () => setActivityLayout("mini"));

  if (!open) return null;
  const name = view?.app?.name ?? open.frame.app.name;
  const iconUrl = view?.app?.icon ?? open.frame.app.icon;
  const icon = iconUrl ? cdnImage(iconUrl) : null;
  const loc = view?.location ?? { kind: open.frame.location.guildId ? "gc" : "pc", channelId: open.frame.location.channelId, guildId: open.frame.location.guildId };
  const inviteLink = loc.kind === "gc" && loc.guildId && typeof window !== "undefined" ? `${window.location.origin}/channels/${loc.guildId}/${loc.channelId}` : null;
  const layoutMode: LayoutMode = mode === "mini" ? 1 : 0;

  // Static look per mode; geometry comes from the effect above.
  const boxStyle: React.CSSProperties =
    mode === "docked" ? { position: "fixed", zIndex: 30, background: "#000" }
      : mode === "full" ? { position: "fixed", zIndex: 70, background: "#000" }
        : { position: "fixed", zIndex: 60, background: "#000", borderRadius: "0 0 12px 12px", overflow: "hidden", boxShadow: "0 12px 32px rgba(0,0,0,.5)" };

  const goToSlot = () => {
    router.push(open.returnPath);
    setActivityLayout("inline");
  };

  return (
    <>
      {(mode === "mini" || mode === "full") && (
        <div
          className="fixed flex items-center gap-2 px-2 z-[70]"
          style={mode === "full"
            ? { left: 0, right: 0, top: 0, height: "calc(env(safe-area-inset-top) + 44px)", paddingTop: "env(safe-area-inset-top)", background: "var(--app-bg)", color: "var(--app-text)" }
            : { right: 16, bottom: 16 + MINI_H, width: MINI_W, height: MINI_HEADER, background: "var(--app-surface)", color: "var(--app-text)", borderRadius: "12px 12px 0 0", zIndex: 60 }}
        >
          {icon ? <img src={icon} alt="" className="size-6 rounded-md object-cover" /> : null}
          <span className="text-sm font-semibold truncate flex-1">{name}</span>
          {mode === "full" ? (
            <button type="button" onClick={() => setActivityLayout("mini")} className="p-1.5 rounded-md hover:opacity-80" style={{ color: "var(--app-muted)" }} title={gt("Minimize")} aria-label={gt("Minimize")}>
              <Minimize2 className="size-4" />
            </button>
          ) : (
            <button type="button" onClick={isMobile ? () => setActivityLayout("inline") : goToSlot} className="p-1.5 rounded-md hover:opacity-80" style={{ color: "var(--app-muted)" }} title={gt("Go to Activity")} aria-label={gt("Go to Activity")}>
              <Maximize2 className="size-4" />
            </button>
          )}
          <button type="button" onClick={() => close()} className="p-1.5 rounded-md hover:opacity-80" style={{ color: "var(--app-muted)" }} title={gt("Leave Activity")} aria-label={gt("Leave Activity")}>
            <X className="size-4" />
          </button>
        </div>
      )}
      <div ref={boxRef} style={boxStyle} aria-label={name}>
        <ActivityFrame
          instanceId={open.instanceId}
          frame={open.frame}
          appName={name}
          appIcon={icon}
          layoutMode={layoutMode}
          inviteLink={inviteLink}
          onClose={close}
        />
      </div>
    </>
  );
}
