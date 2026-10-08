"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useGT } from "gt-next";
import { Headphones, HeadphoneOff, Mic, MicOff, Monitor, MonitorOff, PhoneOff, Video, VideoOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { voiceService, type VoiceParticipant } from "@/lib/services/voiceService";
import { getCallSnapshot, getServerCallSnapshot, hangUp, subscribeCall } from "@/lib/services/dmCallController";
import { formatCallDuration } from "@/lib/voice/callState";
import { useSpeakingUsers } from "@/hooks/useSpeakingUsers";
import { VoiceParticipantAvatar } from "@/components/voice/VoiceParticipantAvatar";
import { VideoGrid } from "@/components/voice/VideoGrid";

type Person = { id: string; name: string; avatar?: string | null };

const subscribeRoom = (onChange: () => void) => voiceService.subscribe((e) => {
  if (e.type === "connected" || e.type === "disconnected") onChange();
});
const getRoom = () => voiceService.currentRoomId ?? "";
const getServerRoom = () => "";

/** Re-render once a second while `active` (the call timer). */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/**
 * Discord-style call area at the top of a DM: both avatars, "Calling…" while
 * it rings, a timer once connected, the video grid, and the call controls.
 * Renders nothing unless this tab is in (or dialing) this DM's call.
 */
export function DmCallPanel({ roomId, me, peer }: { roomId: string; me: Person; peer: Person }) {
  const gt = useGT();
  const voiceRoom = useSyncExternalStore(subscribeRoom, getRoom, getServerRoom);
  const call = useSyncExternalStore(subscribeCall, getCallSnapshot, getServerCallSnapshot);
  const callState = call.state.phase !== "idle" && call.state.roomId === roomId ? call.state : null;
  const active = voiceRoom === roomId || callState !== null;

  const [participants, setParticipants] = useState<VoiceParticipant[]>(() => voiceService.currentParticipants);
  const [muted, setMuted] = useState(() => voiceService.muted);
  const [listenOnly, setListenOnly] = useState(() => voiceService.listenOnly);
  const [deafened, setDeafened] = useState(() => voiceService.deafened);
  const [videoOn, setVideoOn] = useState(() => voiceService.videoOn);
  const [sharing, setSharing] = useState(() => voiceService.screenSharing);
  const speaking = useSpeakingUsers();

  useEffect(() => voiceService.subscribe((event) => {
    switch (event.type) {
      case "participants_changed": setParticipants(event.participants); break;
      case "mute_toggled": setMuted(event.muted); break;
      case "listen_only": setListenOnly(event.enabled); break;
      case "deafen_toggled": setDeafened(event.deafened); if (event.deafened) setMuted(true); break;
      case "video_toggled": setVideoOn(event.enabled); break;
      case "screen_share_toggled": setSharing(event.enabled); break;
      case "connected":
        setParticipants(voiceService.currentParticipants);
        setMuted(voiceService.muted);
        setListenOnly(voiceService.listenOnly);
        setDeafened(voiceService.deafened);
        setVideoOn(voiceService.videoOn);
        setSharing(voiceService.screenSharing);
        break;
      case "disconnected":
        setParticipants([]);
        setMuted(false);
        setListenOnly(false);
        setDeafened(false);
        setVideoOn(false);
        setSharing(false);
        break;
    }
  }), []);

  const peerKey = peer.id.toLowerCase();
  const peerParticipant = voiceRoom === roomId
    ? participants.find((p) => p.userId.toLowerCase() === peerKey)
    : undefined;
  const connectedAt = callState?.connectedAt ?? null;
  const ringingOut = callState?.phase === "ringing" && callState.direction === "outgoing" && !peerParticipant;
  const now = useNow(active && connectedAt !== null);

  const toggleMute = useCallback(() => setMuted(voiceService.toggleMute()), []);
  const toggleDeafen = useCallback(() => {
    const d = voiceService.toggleDeafen();
    setDeafened(d);
    setMuted(voiceService.muted);
  }, []);
  const toggleVideo = useCallback(async () => setVideoOn(await voiceService.toggleVideo()), []);
  const toggleShare = useCallback(async () => {
    if (voiceService.screenSharing) {
      voiceService.stopScreenShare();
      setSharing(false);
    } else {
      setSharing(await voiceService.startScreenShare());
    }
  }, []);

  if (!active) return null;

  const status = peerParticipant
    ? connectedAt !== null
      ? formatCallDuration(now - connectedAt)
      : gt("Connected")
    : ringingOut
      ? gt("Calling…")
      : voiceRoom === roomId && !callState
        ? gt("Waiting for {name}…", { name: peer.name })
        : gt("Connecting…");

  const controlBase = "flex h-11 w-11 items-center justify-center rounded-full transition-all active:scale-95";
  const neutral = "bg-[var(--bg-hover)] text-[var(--text-primary)] hover:bg-[var(--border-subtle)]";
  const off = "bg-[var(--text-primary)] text-[var(--bg-app)]";

  return (
    <section
      aria-label={gt("Call with {name}", { name: peer.name })}
      className="shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 pb-4 pt-5 animate-fade-in"
    >
      <div className="flex items-center justify-center gap-8 sm:gap-12">
        <div className="flex flex-col items-center gap-2">
          <VoiceParticipantAvatar
            participant={{ userId: me.id, username: me.name, displayName: me.name, avatar: me.avatar ?? undefined, audio: !muted }}
            speaking={speaking.has(voiceService.myId)}
            size="lg"
          />
        </div>
        <div className="flex flex-col items-center gap-2">
          <div className={cn("relative", !peerParticipant && "opacity-60")}>
            {ringingOut && (
              <span className="pointer-events-none absolute inset-0 rounded-full bg-[var(--app-accent)]/40 animate-ping" />
            )}
            <VoiceParticipantAvatar
              participant={{
                userId: peer.id,
                username: peer.name,
                displayName: peer.name,
                avatar: peer.avatar ?? undefined,
                audio: peerParticipant ? peerParticipant.audio : true,
              }}
              speaking={!!peerParticipant && speaking.has(peerParticipant.userId)}
              size="lg"
            />
          </div>
        </div>
      </div>

      <p
        className="mt-3 text-center text-sm font-medium tabular-nums text-[var(--text-secondary)]"
        aria-live="polite"
      >
        {status}
      </p>

      {listenOnly && voiceRoom === roomId && (
        <p
          role="status"
          className="mx-auto mt-2 flex max-w-sm items-center justify-center gap-1.5 text-center text-xs text-[var(--text-secondary)]"
        >
          <MicOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {gt("No microphone — you can listen but others can't hear you")}
        </p>
      )}

      <VideoGrid className="mt-3 rounded-lg border-t-0 bg-transparent p-0" />

      <div className="mt-4 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={toggleMute}
          title={listenOnly ? gt("No microphone — press to try again") : muted ? gt("Unmute") : gt("Mute")}
          aria-label={listenOnly ? gt("No microphone — press to try again") : muted ? gt("Unmute") : gt("Mute")}
          aria-pressed={muted}
          className={cn(controlBase, "relative", muted ? off : neutral)}
        >
          {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          {listenOnly && (
            <span
              aria-hidden
              className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#ef4444] text-[10px] font-bold leading-none text-white"
            >
              !
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={toggleDeafen}
          title={deafened ? gt("Undeafen") : gt("Deafen")}
          aria-label={deafened ? gt("Undeafen") : gt("Deafen")}
          aria-pressed={deafened}
          className={cn(controlBase, deafened ? off : neutral)}
        >
          {deafened ? <HeadphoneOff className="h-5 w-5" /> : <Headphones className="h-5 w-5" />}
        </button>
        <button
          type="button"
          onClick={() => void toggleVideo()}
          title={videoOn ? gt("Turn Off Camera") : gt("Turn On Camera")}
          aria-label={videoOn ? gt("Turn Off Camera") : gt("Turn On Camera")}
          aria-pressed={videoOn}
          className={cn(controlBase, videoOn ? off : neutral)}
        >
          {videoOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
        </button>
        <button
          type="button"
          onClick={() => void toggleShare()}
          title={sharing ? gt("Stop Sharing") : gt("Share Your Screen")}
          aria-label={sharing ? gt("Stop Sharing") : gt("Share Your Screen")}
          aria-pressed={sharing}
          className={cn(controlBase, sharing ? off : neutral, !sharing && "hidden md:flex")}
        >
          {sharing ? <MonitorOff className="h-5 w-5" /> : <Monitor className="h-5 w-5" />}
        </button>
        <button
          type="button"
          onClick={() => void hangUp()}
          title={gt("Leave Call")}
          aria-label={gt("Leave Call")}
          className={cn(controlBase, "bg-[#ef4444] text-white hover:bg-[#dc2626]")}
        >
          <PhoneOff className="h-5 w-5" />
        </button>
      </div>
    </section>
  );
}
