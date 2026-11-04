"use client";
/**
 * Activities host (CORD-92), mounted once in the app shell.
 *
 * Renders the open Activity's frame exactly once and moves it (by style, so
 * the iframe never reloads) to where it belongs:
 *  - docked: over the slot of its chat or call (ActivitySlot), like Discord;
 *  - mini: a small floating player when you're elsewhere (or minimized), like
 *    Discord's: the app's name and participants fade in over it on hover, and
 *    it can be dragged anywhere on screen (the position is remembered);
 *  - full screen on phones;
 *  - nowhere while it's popped out into its own window.
 * Also hosts the shelf (launcher), the 18+ confirmation and error toasts.
 */
import { useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useGT } from "gt-next";
import { ArrowLeft, ExternalLink, Minimize2, PhoneOff, X } from "lucide-react";
import { toast } from "sonner";
import { cdnImage } from "@/lib/utils";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useBackHandler } from "@/hooks/useBackHandler";
import { MountWhenOpened } from "@/components/ui/MountWhenOpened";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  canPopOut, clearActivityError, closeActivity, popOutActivity, setActivityLayout, useActivityError, useActivityShelf, useAgePrompt, useInstanceView,
  useOpenActivity, useOpenActivitySlot, type ActivityParticipant,
} from "@/lib/activities/clientStore";
import type { LayoutMode } from "./ActivityFrame";

const ActivityFrame = dynamic(() => import("./ActivityFrame"), { ssr: false });
const ActivityShelf = dynamic(() => import("./ActivityShelf"), { ssr: false });

const MINI_W = 384;
const MINI_H = 216;
const MINI_MARGIN = 12;
const MINI_POS_KEY = "serika.activityMiniPos";

type MiniPos = { x: number; y: number };
let miniPos: MiniPos | null = null;

function miniSize() {
  const w = Math.min(MINI_W, window.innerWidth - MINI_MARGIN * 2);
  return { w, h: Math.round((w * MINI_H) / MINI_W) };
}

/** Where the mini player sits: the remembered spot, kept on screen; bottom right by default. */
function miniPlace(w: number, h: number): MiniPos {
  if (!miniPos) {
    try {
      const saved = JSON.parse(localStorage.getItem(MINI_POS_KEY) ?? "null") as MiniPos | null;
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) miniPos = saved;
    } catch { /* storage unavailable */ }
  }
  const maxX = window.innerWidth - w - MINI_MARGIN;
  const maxY = window.innerHeight - h - MINI_MARGIN;
  const p = miniPos ?? { x: maxX, y: maxY };
  return { x: Math.max(MINI_MARGIN, Math.min(maxX, p.x)), y: Math.max(MINI_MARGIN, Math.min(maxY, p.y)) };
}

function saveMiniPos(p: MiniPos) {
  miniPos = p;
  try { localStorage.setItem(MINI_POS_KEY, JSON.stringify(p)); } catch { /* storage unavailable */ }
}

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
    if (mode === "mini") {
      const place = () => {
        const { w, h } = miniSize();
        const p = miniPlace(w, h);
        s.width = `${w}px`;
        s.height = `${h}px`;
        s.left = `${p.x}px`;
        s.top = `${p.y}px`;
      };
      place();
      window.addEventListener("resize", place);
      return () => window.removeEventListener("resize", place);
    }
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
        : { position: "fixed", zIndex: 60, background: "#000", borderRadius: 12, overflow: "hidden", boxShadow: "0 12px 32px rgba(0,0,0,.5)" };

  const goToSlot = () => {
    router.push(open.returnPath);
    setActivityLayout("inline");
  };

  return (
    <>
      {mode === "full" && (
        <div
          className="fixed flex items-center gap-2 px-2 z-[70]"
          style={{ left: 0, right: 0, top: 0, height: "calc(env(safe-area-inset-top) + 44px)", paddingTop: "env(safe-area-inset-top)", background: "var(--app-bg)", color: "var(--app-text)" }}
        >
          {icon ? <img src={icon} alt="" className="size-6 rounded-md object-cover" /> : null}
          <span className="text-sm font-semibold truncate flex-1">{name}</span>
          <button type="button" onClick={() => setActivityLayout("mini")} className="p-1.5 rounded-md hover:opacity-80" style={{ color: "var(--app-muted)" }} title={gt("Minimize")} aria-label={gt("Minimize")}>
            <Minimize2 className="size-4" />
          </button>
          <button type="button" onClick={() => close()} className="p-1.5 rounded-md hover:opacity-80" style={{ color: "var(--app-muted)" }} title={gt("Leave Activity")} aria-label={gt("Leave Activity")}>
            <X className="size-4" />
          </button>
        </div>
      )}
      <div ref={boxRef} style={boxStyle} aria-label={name} className="group">
        <ActivityFrame
          instanceId={open.instanceId}
          frame={open.frame}
          appName={name}
          appIcon={icon}
          layoutMode={layoutMode}
          inviteLink={inviteLink}
          onClose={close}
        />
        {mode === "mini" && (
          <MiniChrome
            boxRef={boxRef}
            name={name}
            participants={view?.participants ?? []}
            touch={isMobile}
            onBack={isMobile ? () => setActivityLayout("inline") : goToSlot}
            onLeave={() => close()}
          />
        )}
      </div>
    </>
  );
}

/**
 * The mini player's overlay, like Discord's: "← name" on top (back to the
 * Activity), participants and pop-out / leave at the bottom. Shown on hover
 * (always on touch). Both bars are drag handles: the player follows the
 * pointer anywhere on screen; a press that doesn't move is a click.
 */
function MiniChrome({ boxRef, name, participants, touch, onBack, onLeave }: {
  boxRef: React.RefObject<HTMLDivElement | null>;
  name: string;
  participants: ActivityParticipant[];
  touch: boolean;
  onBack: () => void;
  onLeave: () => void;
}) {
  const gt = useGT();
  const drag = useRef<{ id: number; dx: number; dy: number; sx: number; sy: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = boxRef.current;
    if (!box || e.button !== 0) return;
    const r = box.getBoundingClientRect();
    drag.current = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top, sx: e.clientX, sy: e.clientY, moved: false };
    suppressClick.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const box = boxRef.current;
    if (!d || !box || d.id !== e.pointerId) return;
    if (!d.moved && Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) < 5) return;
    if (!d.moved) { d.moved = true; box.dataset.dragging = "1"; }
    const p = { x: e.clientX - d.dx, y: e.clientY - d.dy };
    const maxX = window.innerWidth - box.offsetWidth - MINI_MARGIN;
    const maxY = window.innerHeight - box.offsetHeight - MINI_MARGIN;
    box.style.left = `${Math.max(MINI_MARGIN, Math.min(maxX, p.x))}px`;
    box.style.top = `${Math.max(MINI_MARGIN, Math.min(maxY, p.y))}px`;
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const box = boxRef.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!box || !d.moved) return;
    delete box.dataset.dragging;
    suppressClick.current = true;
    saveMiniPos({ x: box.offsetLeft, y: box.offsetTop });
  };
  // A drag that starts on a button must not also press it.
  const guard = (fn: () => void) => () => { if (suppressClick.current) { suppressClick.current = false; return; } fn(); };
  const handle = { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp };
  const shown = touch ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100 group-data-[dragging]:opacity-100";
  const iconBtn = "p-1.5 rounded-md text-white hover:bg-white/15";

  return (
    <>
      {/* While dragging, the frame must not swallow the pointer. */}
      <style>{"[data-dragging] iframe{pointer-events:none}"}</style>
      <div
        {...handle}
        className={`absolute inset-x-0 top-0 h-11 flex items-center px-2 transition-opacity duration-150 cursor-grab active:cursor-grabbing select-none touch-none ${shown}`}
        style={{ background: "linear-gradient(rgba(0,0,0,.72), rgba(0,0,0,0))" }}
      >
        <button type="button" onClick={guard(onBack)} className="flex items-center gap-1.5 min-w-0 px-1.5 py-1 rounded-md text-white font-semibold text-sm hover:bg-white/15" title={gt("Go to Activity")}>
          <ArrowLeft className="size-4 shrink-0" />
          <span className="truncate">{name}</span>
        </button>
      </div>
      <div
        {...handle}
        className={`absolute inset-x-0 bottom-0 h-12 flex items-center gap-1 px-2 transition-opacity duration-150 cursor-grab active:cursor-grabbing select-none touch-none ${shown}`}
        style={{ background: "linear-gradient(rgba(0,0,0,0), rgba(0,0,0,.72))" }}
      >
        <div className="flex -space-x-2 flex-1 min-w-0" aria-label={gt("{count} playing", { count: participants.length })}>
          {participants.slice(0, 5).map((p) => (
            p.avatar
              ? <img key={p.id} src={cdnImage(p.avatar)} alt="" title={p.displayName ?? p.username} draggable={false} className="size-7 rounded-full object-cover ring-2 ring-black/60" />
              : <span key={p.id} title={p.displayName ?? p.username} className="size-7 rounded-full ring-2 ring-black/60 text-[11px] flex items-center justify-center font-semibold text-white" style={{ background: "var(--app-accent)" }}>{(p.displayName ?? p.username).slice(0, 1).toUpperCase()}</span>
          ))}
        </div>
        {canPopOut() && (
          <button
            type="button"
            onClick={guard(() => { if (!popOutActivity()) toast.error(gt("Allow pop-ups for SerikaCord to open the Activity in its own window.")); })}
            className={iconBtn}
            title={gt("Pop out")}
            aria-label={gt("Pop out")}
          >
            <ExternalLink className="size-4" />
          </button>
        )}
        <button type="button" onClick={guard(onLeave)} className={iconBtn} title={gt("Leave Activity")} aria-label={gt("Leave Activity")}>
          <PhoneOff className="size-4" />
        </button>
      </div>
    </>
  );
}
