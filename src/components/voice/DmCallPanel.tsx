"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useGT } from "gt-next";
import { Headphones, HeadphoneOff, Mic, MicOff, Monitor, MonitorOff, PhoneOff, Video, VideoOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { voiceService, type VoiceParticipant } from "@/lib/services/voiceService";
import { getCallSnapshot, getServerCallSnapshot, hangUp, subscribeCall } from "@/lib/services/dmCallController";
import { callPanelPeople, formatCallDuration } from "@/lib/voice/callState";
import { useSpeakingUsers } from "@/hooks/useSpeakingUsers";
import { VoiceParticipantAvatar } from "@/components/voice/VoiceParticipantAvatar";
import dynamic from "next/dynamic";
import { useVoiceUserMenu } from "@/components/voice/VoiceUserMenu";
import { StreamQualityPicker } from "@/components/voice/StreamQualityPicker";

// Video stage (spotlight, fullscreen, pop-out): loaded with the first call.
const CallStage = dynamic(() => import("@/components/voice/CallStage").then((m) => m.CallStage), { ssr: false });

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
 * Discord-style call area at the top of a DM: everyone's avatars (speaking
 * ring, muted badge; people not in the call yet are dimmed), "Calling…" while
 * it rings, a timer once connected, the video grid, and the call controls.
 * 1:1 calls pass `peer`; group DM calls pass every member as `peers` plus
 * `groupName`. Renders nothing unless this tab is in (or dialing) the call.
 */
export function DmCallPanel({
  roomId,
  me,
  peer,
  peers,
  groupName,
}: {
  roomId: string;
  me: Person;
  peer?: Person;
  peers?: Person[];
  groupName?: string;
}) {
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
  // Right-click someone: their volume / local mute (no server moderation in DMs).
  const { openVoiceUserMenu, voiceUserMenu } = useVoiceUserMenu({});

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

  const group = !!groupName;
  const others = peers ?? (peer ? [peer] : []);
  const inRoom = voiceRoom === roomId ? participants : [];
  const participantOf = (id: string) => inRoom.find((p) => p.userId.toLowerCase() === id.toLowerCase());
  const myKey = me.id.toLowerCase();
  const othersHere = inRoom.filter((p) => p.userId.toLowerCase() !== myKey && p.userId !== voiceService.myId);
  // 1:1: the other person is in; group: anyone else is.
  const peerParticipant = group ? othersHere[0] : (peer ? participantOf(peer.id) : undefined);
  const people = callPanelPeople(me, others, group ? othersHere : []);
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
        ? (group || !peer ? gt("Waiting for others…") : gt("Waiting for {name}…", { name: peer.name }))
        : gt("Connecting…");

  const controlBase = "flex h-11 w-11 items-center justify-center rounded-full transition-all active:scale-95";
  const neutral = "bg-[var(--bg-hover)] text-[var(--text-primary)] hover:bg-[var(--border-subtle)]";
  const off = "bg-[var(--text-primary)] text-[var(--bg-app)]";

  return (
    <section
      aria-label={group ? gt("Call in {name}", { name: groupName }) : gt("Call with {name}", { name: peer?.name ?? "" })}
      className="shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 pb-4 pt-5 animate-fade-in"
    >
      <ul
        className={cn(
          "flex flex-wrap items-start justify-center",
          people.length > 2 ? "gap-x-5 gap-y-3 sm:gap-x-6" : "gap-8 sm:gap-12",
        )}
      >
        {people.map((person, index) => {
          const isMe = index === 0;
          const here = isMe ? undefined : participantOf(person.id);
          return (
            <li
              key={person.id}
              className="flex w-16 flex-col items-center gap-1.5 sm:w-20"
              onContextMenu={(e) => openVoiceUserMenu(e, { userId: person.id, username: person.name, displayName: person.name })}
            >
              <div className={cn("relative", !isMe && !here && "opacity-60")}>
                {!isMe && !here && ringingOut && (
                  <span className="pointer-events-none absolute inset-0 rounded-full bg-[var(--app-accent)]/40 animate-ping" />
                )}
                <VoiceParticipantAvatar
                  participant={{
                    userId: person.id,
                    username: person.name,
                    displayName: person.name,
                    avatar: person.avatar ?? undefined,
                    audio: isMe ? !muted : here ? here.audio : true,
                  }}
                  speaking={isMe ? speaking.has(voiceService.myId) : !!here && speaking.has(here.userId)}
                  size={people.length > 4 ? "md" : "lg"}
                />
              </div>
              {people.length > 2 && (
                <span className="w-full truncate text-center text-xs text-[var(--text-secondary)]">{person.name}</span>
              )}
            </li>
          );
        })}
      </ul>

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

      <CallStage variant="dm" className="mt-3 max-h-[60vh]" />

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
        <div className={cn("items-center", sharing ? "flex" : "hidden md:flex")}>
          <button
            type="button"
            onClick={() => void toggleShare()}
            title={sharing ? gt("Stop Sharing") : gt("Share Your Screen")}
            aria-label={sharing ? gt("Stop Sharing") : gt("Share Your Screen")}
            aria-pressed={sharing}
            className={cn(controlBase, sharing ? off : neutral)}
          >
            {sharing ? <MonitorOff className="h-5 w-5" /> : <Monitor className="h-5 w-5" />}
          </button>
          <StreamQualityPicker sharing={sharing} onStarted={setSharing} className="h-11 w-5" />
        </div>
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
      {voiceUserMenu}
    </section>
  );
}
