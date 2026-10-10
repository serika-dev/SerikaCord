"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { Check, ChevronRight, HeadphoneOff, MicOff, PhoneOff, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useServer } from "@/contexts/ServerContext";
import { usePermissions } from "@/hooks/usePermissions";
import { voiceService } from "@/lib/services/voiceService";
import {
  USER_VOLUME_MAX,
  USER_VOLUME_MIN,
  getServerUserVoicePrefs,
  getUserVoicePref,
  getUserVoicePrefs,
  setUserVoicePref,
  subscribeUserVoicePrefs,
} from "@/lib/voice/userVolume";
import { UserMenuItems } from "@/components/user/UserContextMenu";

/** Someone in a voice channel or call, as the menu needs them. */
export interface VoiceMenuTarget {
  userId: string;
  username: string;
  displayName?: string | null;
  serverMute?: boolean;
  serverDeaf?: boolean;
}

/** Fired after a moderation change so voice lists refresh right away. */
export const VOICE_STATES_REFRESH_EVENT = "serika:voice-states-refresh";

export async function moderateVoiceMember(
  serverId: string,
  userId: string,
  patch: { mute?: boolean; deaf?: boolean; channelId?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/voice/servers/${serverId}/members/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json().catch(() => null) as { error?: string } | null;
    if (!res.ok) return { ok: false, error: data?.error };
    try { window.dispatchEvent(new CustomEvent(VOICE_STATES_REFRESH_EVENT)); } catch { /* SSR */ }
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

const MENU_WIDTH = 232;

/**
 * Discord's right-click menu for someone in voice: their User Volume (0–200%)
 * and a local Mute (both only for you, remembered on this device), then the
 * moderator actions your permissions allow — Server Mute, Server Deafen,
 * Move To another voice channel and Disconnect — then the usual user actions.
 *
 *   const { openVoiceUserMenu, voiceUserMenu } = useVoiceUserMenu({ serverId, channelId });
 *   <div onContextMenu={(e) => openVoiceUserMenu(e, participant)} />
 *   {voiceUserMenu}
 *
 * `serverId`/`channelId` are only set for server voice channels; DM and group
 * calls get the local volume/mute part only.
 */
export function useVoiceUserMenu({
  serverId,
  channelId,
  container,
}: {
  serverId?: string | null;
  channelId?: string | null;
  /** Where to render the menu (a popped-out call window's body); defaults to this page. */
  container?: HTMLElement | null;
}) {
  const [state, setState] = useState<{ x: number; y: number; target: VoiceMenuTarget } | null>(null);

  const openVoiceUserMenu = useCallback((event: React.MouseEvent, target: VoiceMenuTarget) => {
    event.preventDefault();
    event.stopPropagation();
    setState({ x: event.clientX, y: event.clientY, target });
  }, []);

  const close = useCallback(() => setState(null), []);

  useEffect(() => {
    if (!state) return;
    const win = container?.ownerDocument?.defaultView ?? window;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    win.addEventListener("click", close);
    win.addEventListener("contextmenu", close);
    win.addEventListener("resize", close);
    win.addEventListener("keydown", onKey);
    return () => {
      win.removeEventListener("click", close);
      win.removeEventListener("contextmenu", close);
      win.removeEventListener("resize", close);
      win.removeEventListener("keydown", onKey);
    };
  }, [state, close, container]);

  const voiceUserMenu = state && typeof document !== "undefined"
    ? createPortal(
        <VoiceUserMenuPanel
          x={state.x}
          y={state.y}
          target={state.target}
          serverId={serverId ?? null}
          channelId={channelId ?? null}
          onDone={close}
        />,
        container ?? document.body,
      )
    : null;

  return { openVoiceUserMenu, voiceUserMenu };
}

function VoiceUserMenuPanel({
  x,
  y,
  target,
  serverId,
  channelId,
  onDone,
}: {
  x: number;
  y: number;
  target: VoiceMenuTarget;
  serverId: string | null;
  channelId: string | null;
  onDone: () => void;
}) {
  const gt = useGT();
  const ref = useRef<HTMLDivElement>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [flipSubmenu, setFlipSubmenu] = useState(false);
  // Open "Move To" to the right, or to the left when there's no room.
  const openMove = () => {
    const el = ref.current;
    if (el) {
      const win = el.ownerDocument.defaultView ?? window;
      setFlipSubmenu(el.getBoundingClientRect().right + MENU_WIDTH + 8 > win.innerWidth);
    }
    setMoveOpen(true);
  };
  const prefs = useSyncExternalStore(subscribeUserVoicePrefs, getUserVoicePrefs, getServerUserVoicePrefs);
  const pref = getUserVoicePref(prefs, target.userId);
  const { can } = usePermissions(serverId);
  const { channels } = useServer();
  const isSelf = target.userId.toLowerCase() === (voiceService.myId || "").toLowerCase();
  const name = target.displayName || target.username;

  const inServerVoice = !!serverId && !!channelId;
  const canMute = inServerVoice && can("MUTE_MEMBERS");
  const canDeafen = inServerVoice && can("DEAFEN_MEMBERS");
  const canMove = inServerVoice && can("MOVE_MEMBERS");
  const moveTargets = canMove
    ? channels.filter((c) => c.type === "voice" && c.id !== channelId)
    : [];

  // Keep the menu on screen once its real size is known.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const win = el.ownerDocument.defaultView ?? window;
    const rect = el.getBoundingClientRect();
    el.style.left = `${Math.max(8, Math.min(x, win.innerWidth - rect.width - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(y, win.innerHeight - rect.height - 8))}px`;
  }, [x, y, canMute, canDeafen, canMove]);

  const run = async (patch: { mute?: boolean; deaf?: boolean; channelId?: string | null }) => {
    if (!serverId) return;
    onDone();
    const result = await moderateVoiceMember(serverId, target.userId, patch);
    if (!result.ok) toast.error(result.error || gt("Something went wrong. Please try again."));
  };


  return (
    <div
      ref={ref}
      className="ctx-menu fixed z-[9999]"
      style={{ left: x, top: y, width: MENU_WIDTH }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}
      role="menu"
      aria-label={gt("Voice options for {name}", { name })}
    >
      {!isSelf && (
        <>
          <div className="px-2.5 pb-2 pt-1.5">
            <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-[var(--text-secondary)]">
              <span className="flex items-center gap-1.5">
                <Volume2 className="h-3.5 w-3.5" aria-hidden />
                {gt("User Volume")}
              </span>
              <span className="tabular-nums text-[var(--text-muted)]">{pref.volume}%</span>
            </div>
            <input
              type="range"
              min={USER_VOLUME_MIN}
              max={USER_VOLUME_MAX}
              step={1}
              value={pref.volume}
              onChange={(e) => setUserVoicePref(target.userId, { volume: Number(e.target.value) })}
              onDoubleClick={() => setUserVoicePref(target.userId, { volume: 100 })}
              aria-label={gt("User Volume")}
              className="w-full accent-[var(--app-accent)]"
            />
          </div>
          <button
            className="ctx-item"
            role="menuitemcheckbox"
            aria-checked={pref.muted}
            onClick={() => setUserVoicePref(target.userId, { muted: !pref.muted })}
          >
            <MicOff className="h-4 w-4" />
            <span className="flex-1">{gt("Mute")}</span>
            <CheckBox checked={pref.muted} />
          </button>
        </>
      )}

      {(canMute || canDeafen || canMove) && (
        <>
          {!isSelf && <div className="ctx-sep" />}
          {canMute && (
            <button
              className="ctx-item ctx-item-danger"
              role="menuitemcheckbox"
              aria-checked={!!target.serverMute}
              onClick={() => void run({ mute: !target.serverMute })}
            >
              <MicOff className="h-4 w-4" />
              <span className="flex-1">{gt("Server Mute")}</span>
              <CheckBox checked={!!target.serverMute} />
            </button>
          )}
          {canDeafen && (
            <button
              className="ctx-item ctx-item-danger"
              role="menuitemcheckbox"
              aria-checked={!!target.serverDeaf}
              onClick={() => void run({ deaf: !target.serverDeaf })}
            >
              <HeadphoneOff className="h-4 w-4" />
              <span className="flex-1">{gt("Server Deafen")}</span>
              <CheckBox checked={!!target.serverDeaf} />
            </button>
          )}
          {canMove && moveTargets.length > 0 && (
            <div
              className="relative"
              onMouseEnter={openMove}
              onMouseLeave={() => setMoveOpen(false)}
            >
              <button
                className="ctx-item"
                aria-haspopup="menu"
                aria-expanded={moveOpen}
                onClick={() => (moveOpen ? setMoveOpen(false) : openMove())}
              >
                <Volume2 className="h-4 w-4" />
                <span className="flex-1">{gt("Move To")}</span>
                <ChevronRight className="h-4 w-4" />
              </button>
              {moveOpen && (
                <div
                  className={cn(
                    "ctx-menu absolute top-0 max-h-[50vh] overflow-y-auto",
                    flipSubmenu ? "right-full mr-1" : "left-full ml-1",
                  )}
                  style={{ width: MENU_WIDTH }}
                  role="menu"
                  aria-label={gt("Move To")}
                >
                  {moveTargets.map((c) => (
                    <button key={c.id} className="ctx-item" onClick={() => void run({ channelId: c.id })}>
                      <Volume2 className="h-4 w-4 shrink-0" />
                      <span className="truncate">{c.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {canMove && (
            <button className="ctx-item ctx-item-danger" onClick={() => void run({ channelId: null })}>
              <PhoneOff className="h-4 w-4" />
              {gt("Disconnect")}
            </button>
          )}
        </>
      )}

      <div className="ctx-sep" />
      <UserMenuItems user={{ id: target.userId, username: target.username, displayName: target.displayName }} onDone={onDone} />
    </div>
  );
}

function CheckBox({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
        checked
          ? "border-[var(--app-accent)] bg-[var(--app-accent)] text-[var(--text-on-accent)]"
          : "border-current opacity-70",
      )}
    >
      {checked && <Check className="h-3 w-3" />}
    </span>
  );
}
