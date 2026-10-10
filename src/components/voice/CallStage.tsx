"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useGT } from "gt-next";
import {
  ExternalLink,
  HeadphoneOff,
  LayoutGrid,
  Maximize2,
  MicOff,
  Minimize2,
  Monitor,
  PictureInPicture2,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn, cdnImage } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useSpeakingUsers } from "@/hooks/useSpeakingUsers";
import { voiceService, type VoiceParticipant } from "@/lib/services/voiceService";
import { buildStageTiles, gridColumns, resolveFocusedTile, type StageTile } from "@/lib/voice/callLayout";
import {
  getServerUserVoicePrefs,
  getUserVoicePref,
  getUserVoicePrefs,
  subscribeUserVoicePrefs,
} from "@/lib/voice/userVolume";
import { useVoiceUserMenu } from "@/components/voice/VoiceUserMenu";

type DocumentPip = { requestWindow: (opts?: { width?: number; height?: number }) => Promise<Window> };

function getDocumentPip(): DocumentPip | null {
  if (typeof window === "undefined") return null;
  const pip = (window as unknown as { documentPictureInPicture?: DocumentPip }).documentPictureInPicture;
  return pip && typeof pip.requestWindow === "function" ? pip : null;
}

/** Copy this page's styles and theme (CSS variables live on <html>) into a popped-out window. */
function mirrorStylesInto(target: Document) {
  document.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
    target.head.appendChild(node.cloneNode(true));
  });
  target.documentElement.className = document.documentElement.className;
  const rootStyle = document.documentElement.getAttribute("style");
  if (rootStyle) target.documentElement.setAttribute("style", rootStyle);
  target.body.className = document.body.className;
  target.body.style.margin = "0";
  target.body.style.background = "var(--bg-app)";
  target.title = document.title;
}

interface CallSnapshot {
  participants: VoiceParticipant[];
  connected: boolean;
  videoOn: boolean;
  sharing: boolean;
  muted: boolean;
  deafened: boolean;
  serverMute: boolean;
  serverDeaf: boolean;
  myId: string;
  localStream: MediaStream | null;
  screenStream: MediaStream | null;
}

function readSnapshot(): CallSnapshot {
  return {
    participants: voiceService.currentParticipants,
    connected: voiceService.connected,
    videoOn: voiceService.videoOn,
    sharing: voiceService.screenSharing,
    muted: voiceService.muted,
    deafened: voiceService.deafened,
    serverMute: voiceService.serverMute,
    serverDeaf: voiceService.serverDeaf,
    myId: voiceService.myId,
    localStream: voiceService.localStream_,
    screenStream: voiceService.screenShareStream,
  };
}

/** Live call state for the stage (participants, your camera/share/mute). */
function useCallSnapshot(): CallSnapshot {
  const [snap, setSnap] = useState<CallSnapshot>(readSnapshot);
  useEffect(() => voiceService.subscribe((event) => {
    switch (event.type) {
      case "participants_changed":
        setSnap((prev) => ({ ...prev, participants: event.participants, myId: voiceService.myId }));
        break;
      case "connected":
      case "disconnected":
      case "video_toggled":
      case "screen_share_toggled":
      case "mute_toggled":
      case "deafen_toggled":
      case "server_voice_state":
        setSnap(readSnapshot());
        break;
    }
  }), []);
  return snap;
}

interface TileInfo {
  name: string;
  avatar?: string | null;
  muted: boolean;
  deafened: boolean;
  serverMute: boolean;
  serverDeaf: boolean;
  localMuted: boolean;
  participant?: VoiceParticipant;
}

/**
 * The call's video stage, Discord-style, shared by server voice channels and
 * DM / group calls: a grid of everyone (camera, or an avatar card in voice
 * channels) and every screen share. Click a tile to spotlight it with the
 * others in a filmstrip (click again or Esc for the grid); double-click or
 * the corner button for fullscreen; picture-in-picture per video; pop the
 * whole stage out into its own window where the browser supports it.
 * Right-click someone for their volume / mute and moderator actions.
 */
export function CallStage({
  variant,
  serverId,
  channelId,
  className,
  aloneHint,
}: {
  /** "channel": everyone gets a tile. "dm": only cameras and screens (avatars are in the call header). */
  variant: "channel" | "dm";
  serverId?: string | null;
  channelId?: string | null;
  className?: string;
  /** Shown under your own tile while nobody else is here. */
  aloneHint?: ReactNode;
}) {
  const gt = useGT();
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const snap = useCallSnapshot();
  const speaking = useSpeakingUsers();
  const prefs = useSyncExternalStore(subscribeUserVoicePrefs, getUserVoicePrefs, getServerUserVoicePrefs);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const pipContainer = pipWindow?.document.body ?? null;
  const { openVoiceUserMenu, voiceUserMenu } = useVoiceUserMenu({
    serverId: variant === "channel" ? serverId : null,
    channelId: variant === "channel" ? channelId : null,
    container: pipContainer,
  });

  const myId = snap.myId || user?.id || "";
  const isMe = useCallback((id: string) => !!myId && id.toLowerCase() === myId.toLowerCase(), [myId]);
  const { localStream, screenStream } = snap;

  const byId = useMemo(() => {
    const map = new Map<string, VoiceParticipant>();
    snap.participants.forEach((p) => map.set(p.userId.toLowerCase(), p));
    return map;
  }, [snap.participants]);

  const tiles = useMemo(() => {
    if (!snap.connected) return [];
    const members = snap.participants
      .filter((p) => !isMe(p.userId))
      .map((p) => ({
        userId: p.userId,
        camera: !!p.video && !!p.stream && p.stream.getVideoTracks().length > 0,
        screen: !!p.screenStream,
      }));
    if (myId) {
      members.unshift({
        userId: myId,
        camera: snap.videoOn && !!localStream && localStream.getVideoTracks().length > 0,
        screen: snap.sharing && !!screenStream,
      });
    }
    return buildStageTiles({ members, selfId: myId, includeAudioOnly: variant === "channel" });
  }, [snap.connected, snap.participants, snap.videoOn, snap.sharing, localStream, screenStream, myId, isMe, variant]);

  const focused = resolveFocusedTile(tiles, focusedId);

  // Esc leaves the spotlight (fullscreen handles its own Esc).
  useEffect(() => {
    if (!focused) return;
    const win = pipWindow ?? window;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !win.document.fullscreenElement) setFocusedId(null);
    };
    win.addEventListener("keydown", onKey);
    return () => win.removeEventListener("keydown", onKey);
  }, [focused, pipWindow]);

  // Closing the call closes its popped-out window too.
  useEffect(() => {
    if (!pipWindow) return;
    const onHide = () => setPipWindow(null);
    pipWindow.addEventListener("pagehide", onHide);
    return () => pipWindow.removeEventListener("pagehide", onHide);
  }, [pipWindow]);
  useEffect(() => {
    if (snap.connected || !pipWindow) return;
    pipWindow.close();
  }, [snap.connected, pipWindow]);

  const popOut = useCallback(async () => {
    const pip = getDocumentPip();
    if (!pip) return;
    try {
      const win = await pip.requestWindow({ width: 720, height: 460 });
      mirrorStylesInto(win.document);
      setPipWindow(win);
    } catch {
      // Blocked or dismissed: stay inline.
    }
  }, []);

  const infoFor = (userId: string): TileInfo => {
    const p = byId.get(userId.toLowerCase());
    const pref = getUserVoicePref(prefs, userId);
    if (isMe(userId)) {
      return {
        name: user?.displayName || user?.username || p?.displayName || p?.username || gt("You"),
        avatar: user?.avatar ?? p?.avatar,
        muted: snap.muted,
        deafened: snap.deafened,
        serverMute: snap.serverMute,
        serverDeaf: snap.serverDeaf,
        localMuted: false,
        participant: p,
      };
    }
    return {
      name: p?.displayName || p?.username || "?",
      avatar: p?.avatar,
      muted: p ? !p.audio : false,
      deafened: !!p?.deafened,
      serverMute: !!p?.serverMute,
      serverDeaf: !!p?.serverDeaf,
      localMuted: pref.muted,
      participant: p,
    };
  };

  const streamFor = (tile: StageTile): MediaStream | null => {
    if (tile.kind === "avatar") return null;
    if (tile.isSelf) return tile.kind === "screen" ? screenStream : localStream;
    const p = byId.get(tile.userId.toLowerCase());
    return (tile.kind === "screen" ? p?.screenStream : p?.stream) ?? null;
  };

  const onTileMenu = (e: React.MouseEvent, tile: StageTile) => {
    const info = infoFor(tile.userId);
    openVoiceUserMenu(e, {
      userId: tile.userId,
      username: info.participant?.username || info.name,
      displayName: info.name,
      serverMute: info.serverMute,
      serverDeaf: info.serverDeaf,
    });
  };

  if (!snap.connected) return null;
  if (variant === "dm" && tiles.length === 0) return null;

  const renderTile = (tile: StageTile, mode: "grid" | "spotlight" | "strip") => (
    <StageTileView
      key={tile.id}
      tile={tile}
      info={infoFor(tile.userId)}
      stream={streamFor(tile)}
      speaking={speaking.has(tile.userId) || (tile.isSelf && speaking.has(myId))}
      mode={mode}
      onSelect={() => setFocusedId((cur) => (cur === tile.id ? null : tile.id))}
      onContextMenu={(e) => onTileMenu(e, tile)}
    />
  );

  const cols = gridColumns(tiles.length, isMobile && !pipWindow);
  const canPopOut = !pipWindow && !!getDocumentPip() && !isMobile;

  const stage = (
    <div className={cn("relative flex min-h-0 flex-1 flex-col", pipWindow && "h-screen bg-[var(--bg-app)] p-2")}>
      {(canPopOut || focused) && (
        <div className="pointer-events-none absolute right-2 top-2 z-10 flex gap-1.5">
          {focused && (
            <button
              type="button"
              onClick={() => setFocusedId(null)}
              title={gt("Show grid")}
              aria-label={gt("Show grid")}
              className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-lg bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/75"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          )}
          {canPopOut && (
            <button
              type="button"
              onClick={() => void popOut()}
              title={gt("Pop Out")}
              aria-label={gt("Pop Out")}
              className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-lg bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/75"
            >
              <ExternalLink className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {focused ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex min-h-0 flex-1 items-center justify-center">
            {renderTile(focused, "spotlight")}
          </div>
          {tiles.length > 1 && (
            <div className="flex shrink-0 gap-2 overflow-x-auto pb-1" role="list" aria-label={gt("Participants")}>
              {tiles.filter((t) => t.id !== focused.id).map((t) => renderTile(t, "strip"))}
            </div>
          )}
        </div>
      ) : (
        <div className={cn("flex min-h-0 flex-1", variant === "channel" ? "items-center" : "items-start")}>
          <div
            className="mx-auto grid w-full gap-2 sm:gap-3"
            style={{
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              maxWidth: tiles.length === 1 ? "56rem" : undefined,
            }}
          >
            {tiles.map((t) => renderTile(t, "grid"))}
          </div>
        </div>
      )}

      {aloneHint && tiles.length <= 1 && !focused && (
        <p className="mt-3 text-center text-sm text-[var(--text-muted)]">{aloneHint}</p>
      )}
    </div>
  );

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      {pipWindow && pipContainer ? (
        <>
          <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[var(--border-subtle)] p-6 text-center text-sm text-[var(--text-muted)]">
            <ExternalLink className="h-6 w-6" aria-hidden />
            <p>{gt("The call is open in another window.")}</p>
            <button
              type="button"
              onClick={() => pipWindow.close()}
              className="rounded-lg bg-[var(--app-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--text-on-accent)] hover:opacity-90"
            >
              {gt("Bring Back")}
            </button>
          </div>
          {createPortal(stage, pipContainer)}
        </>
      ) : (
        stage
      )}
      {voiceUserMenu}
    </div>
  );
}

function StageTileView({
  tile,
  info,
  stream,
  speaking,
  mode,
  onSelect,
  onContextMenu,
}: {
  tile: StageTile;
  info: TileInfo;
  stream: MediaStream | null;
  speaking: boolean;
  mode: "grid" | "spotlight" | "strip";
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const gt = useGT();
  const boxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const isScreen = tile.kind === "screen";
  const hasVideo = tile.kind !== "avatar" && !!stream;
  const silent = info.muted || info.serverMute || info.localMuted;
  const showRing = speaking && !silent && !isScreen;

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    if (stream) void el.play().catch(() => {});
  }, [stream]);

  useEffect(() => {
    const doc = boxRef.current?.ownerDocument;
    if (!doc) return;
    const onChange = () => setFullscreen(doc.fullscreenElement === boxRef.current);
    doc.addEventListener("fullscreenchange", onChange);
    return () => doc.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = () => {
    const el = boxRef.current;
    if (!el) return;
    const doc = el.ownerDocument;
    if (doc.fullscreenElement) void doc.exitFullscreen().catch(() => {});
    else void el.requestFullscreen?.().catch(() => {});
  };

  const pictureInPicture = () => {
    const v = videoRef.current as (HTMLVideoElement & { requestPictureInPicture?: () => Promise<unknown> }) | null;
    if (!v?.requestPictureInPicture) return;
    const doc = v.ownerDocument as Document & { pictureInPictureElement?: Element | null; exitPictureInPicture?: () => Promise<void> };
    if (doc.pictureInPictureElement === v) void doc.exitPictureInPicture?.().catch(() => {});
    else void v.requestPictureInPicture().catch(() => {});
  };
  const canPip = hasVideo && typeof document !== "undefined"
    && (document as Document & { pictureInPictureEnabled?: boolean }).pictureInPictureEnabled === true;

  const label = isScreen
    ? (tile.isSelf ? gt("Your Screen") : gt("{name}'s screen", { name: info.name }))
    : info.name;

  return (
    <div
      ref={boxRef}
      role={mode === "strip" ? "listitem" : undefined}
      tabIndex={0}
      aria-label={label}
      onClick={onSelect}
      onDoubleClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); }
        if (e.key.toLowerCase() === "f") { e.preventDefault(); toggleFullscreen(); }
      }}
      onContextMenu={onContextMenu}
      className={cn(
        "group relative cursor-pointer overflow-hidden rounded-xl bg-[var(--bg-card)] outline-none transition-shadow duration-100",
        "focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]",
        mode === "grid" && "aspect-video w-full",
        mode === "spotlight" && "h-full max-h-full w-full",
        mode === "strip" && "aspect-video h-24 shrink-0 sm:h-28",
        fullscreen && "rounded-none",
        showRing && "ring-2 ring-[#23a55a] ring-offset-0 shadow-[0_0_14px_rgba(35,165,90,0.35)]",
      )}
    >
      {hasVideo ? (
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className={cn(
            "h-full w-full bg-black",
            isScreen || mode === "spotlight" || fullscreen ? "object-contain" : "object-cover",
            tile.isSelf && !isScreen && "video-mirror",
          )}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-[var(--bg-sidebar-elevated)]">
          <div
            className={cn(
              "rounded-full transition-shadow duration-100",
              showRing && "ring-[3px] ring-[#23a55a] ring-offset-2 ring-offset-[var(--bg-sidebar-elevated)]",
            )}
          >
            <Avatar className={cn(mode === "strip" ? "h-10 w-10" : mode === "spotlight" ? "h-28 w-28" : "h-16 w-16 sm:h-20 sm:w-20")}>
              <AvatarImage src={cdnImage(info.avatar ?? undefined)} alt="" />
              <AvatarFallback className="bg-[var(--app-accent)] text-lg font-semibold text-[var(--text-on-accent)]">
                {info.name.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </div>
        </div>
      )}

      <div className="absolute bottom-1.5 left-1.5 flex max-w-[calc(100%-12px)] items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] text-white sm:bottom-2 sm:left-2 sm:text-xs">
        {isScreen && <Monitor className="h-3 w-3 shrink-0" aria-hidden />}
        <span className="truncate">{label}</span>
        {!isScreen && (info.serverMute || info.muted) && (
          <MicOff
            className={cn("h-3 w-3 shrink-0", info.serverMute ? "text-[#f23f43]" : "text-white/80")}
            aria-label={info.serverMute ? gt("Server Muted") : gt("Muted")}
          />
        )}
        {!isScreen && (info.serverDeaf || info.deafened) && (
          <HeadphoneOff
            className={cn("h-3 w-3 shrink-0", info.serverDeaf ? "text-[#f23f43]" : "text-white/80")}
            aria-label={info.serverDeaf ? gt("Server Deafened") : gt("Deafened")}
          />
        )}
        {!isScreen && info.localMuted && (
          <MicOff className="h-3 w-3 shrink-0 text-[#f0b232]" aria-label={gt("Muted for you")} />
        )}
      </div>

      {mode !== "strip" && (
        <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 sm:right-2 sm:top-2">
          {canPip && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); pictureInPicture(); }}
              title={gt("Picture in Picture")}
              aria-label={gt("Picture in Picture")}
              className="flex h-7 w-7 items-center justify-center rounded-md bg-black/60 text-white hover:bg-black/80"
            >
              <PictureInPicture2 className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
            title={fullscreen ? gt("Exit Full Screen") : gt("Full Screen")}
            aria-label={fullscreen ? gt("Exit Full Screen") : gt("Full Screen")}
            className="flex h-7 w-7 items-center justify-center rounded-md bg-black/60 text-white hover:bg-black/80"
          >
            {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      )}
    </div>
  );
}
