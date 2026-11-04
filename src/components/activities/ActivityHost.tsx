"use client";
/**
 * Activities host (CORD-92), mounted once in the app shell. Shows:
 *  - the open Activity: a panel docked on the right (desktop), full screen
 *    (phones, or "expand"), or a small floating window ("minimize"); the frame
 *    keeps running in every layout;
 *  - the Activity shelf (launcher) for a chat or a call;
 *  - errors from launching / joining as toasts.
 * Heavy parts (frame, shelf) are their own chunks, loaded on first use.
 */
import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useGT } from "gt-next";
import { Maximize2, Minimize2, PictureInPicture2, X } from "lucide-react";
import { toast } from "sonner";
import { cdnImage } from "@/lib/utils";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useBackHandler } from "@/hooks/useBackHandler";
import { MountWhenOpened } from "@/components/ui/MountWhenOpened";
import {
  clearActivityError, closeActivity, useActivityError, useActivityShelf, useInstanceView, useOpenActivity,
} from "@/lib/activities/clientStore";
import type { LayoutMode } from "./ActivityFrame";

const ActivityFrame = dynamic(() => import("./ActivityFrame"), { ssr: false });
const ActivityShelf = dynamic(() => import("./ActivityShelf"), { ssr: false });

type Layout = "docked" | "full" | "mini";

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
      age_restricted: gt("This Activity is age-restricted and can only be played in age-restricted channels."),
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

export default function ActivityHost() {
  useErrorToasts();
  const open = useOpenActivity();
  const shelf = useActivityShelf();
  return (
    <>
      <MountWhenOpened open={!!shelf}>
        {shelf && <ActivityShelf request={shelf} />}
      </MountWhenOpened>
      {open && <ActivityPanel key={open.instanceId} />}
    </>
  );
}

function ActivityPanel() {
  const gt = useGT();
  const open = useOpenActivity();
  const view = useInstanceView(open?.instanceId);
  const isMobile = useIsMobile();
  const [layout, setLayout] = useState<Layout>("docked");
  const effective: Layout = isMobile && layout === "docked" ? "full" : layout;
  const close = useCallback((reason?: string) => {
    if (reason === "ended") toast(gt("The Activity has ended."));
    closeActivity();
  }, [gt]);
  useBackHandler(isMobile && effective === "full", () => setLayout("mini"));

  // Opening the same Activity again (card / shelf) brings it back from the mini window.
  const nonce = open?.nonce ?? 0;
  const [seenNonce, setSeenNonce] = useState(nonce);
  if (nonce !== seenNonce) {
    setSeenNonce(nonce);
    if (layout === "mini") setLayout("docked");
  }

  if (!open) return null;
  const name = view?.app?.name ?? gt("Activity");
  const icon = view?.app?.icon ? cdnImage(view.app.icon) : null;
  const participants = view?.participants ?? [];
  const layoutMode: LayoutMode = effective === "mini" ? 1 : 0;
  const loc = view?.location;
  const inviteLink = loc && loc.kind === "gc" && loc.guildId && typeof window !== "undefined"
    ? `${window.location.origin}/channels/${loc.guildId}/${loc.channelId}`
    : null;

  const frameBox =
    effective === "full" ? "fixed inset-0 z-[70]"
      : effective === "mini" ? "fixed z-[70] right-4 bottom-4 w-[320px] h-[220px] rounded-xl overflow-hidden shadow-2xl border"
        : "fixed z-[60] right-0 top-0 bottom-0 w-[min(560px,45vw)] border-l shadow-2xl";

  return (
    <aside
      aria-label={name}
      className={`${frameBox} flex flex-col`}
      style={{ background: "var(--app-bg)", borderColor: "var(--app-border)", paddingTop: effective === "full" ? "env(safe-area-inset-top)" : undefined }}
    >
      <header className="flex items-center gap-2 px-3 h-11 shrink-0 border-b" style={{ borderColor: "var(--app-border)", color: "var(--app-text)" }}>
        {icon ? <img src={icon} alt="" className="size-6 rounded-md object-cover" /> : null}
        <span className="font-semibold text-sm truncate flex-1">{name}</span>
        {effective !== "mini" && participants.length > 0 && (
          <div className="flex -space-x-2 mr-1" aria-label={gt("{count} playing", { count: participants.length })}>
            {participants.slice(0, 4).map((p) => (
              p.avatar
                ? <img key={p.id} src={cdnImage(p.avatar)} alt={p.displayName ?? p.username} title={p.displayName ?? p.username} className="size-6 rounded-full border-2 object-cover" style={{ borderColor: "var(--app-bg)" }} />
                : <span key={p.id} title={p.displayName ?? p.username} className="size-6 rounded-full border-2 text-[10px] flex items-center justify-center font-semibold" style={{ borderColor: "var(--app-bg)", background: "var(--app-accent)", color: "#fff" }}>{(p.displayName ?? p.username).slice(0, 1).toUpperCase()}</span>
            ))}
          </div>
        )}
        {effective !== "mini" && (
          <button type="button" onClick={() => setLayout("mini")} title={gt("Minimize")} aria-label={gt("Minimize")} className="p-1.5 rounded-md hover:opacity-80" style={{ color: "var(--app-muted)" }}>
            <PictureInPicture2 className="size-4" />
          </button>
        )}
        {!isMobile && (
          <button
            type="button"
            onClick={() => setLayout(effective === "full" ? "docked" : "full")}
            title={effective === "full" ? gt("Dock to the side") : gt("Expand")}
            aria-label={effective === "full" ? gt("Dock to the side") : gt("Expand")}
            className="p-1.5 rounded-md hover:opacity-80"
            style={{ color: "var(--app-muted)" }}
          >
            {effective === "full" ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </button>
        )}
        {effective === "mini" && (
          <button type="button" onClick={() => setLayout(isMobile ? "full" : "docked")} title={gt("Expand")} aria-label={gt("Expand")} className="p-1.5 rounded-md hover:opacity-80" style={{ color: "var(--app-muted)" }}>
            <Maximize2 className="size-4" />
          </button>
        )}
        <button type="button" onClick={() => close()} title={gt("Leave Activity")} aria-label={gt("Leave Activity")} className="p-1.5 rounded-md hover:opacity-80" style={{ color: "var(--app-muted)" }}>
          <X className="size-4" />
        </button>
      </header>
      <div className="flex-1 min-h-0">
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
    </aside>
  );
}
