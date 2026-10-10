"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { useServer } from "@/contexts/ServerContext";
import { useAuth } from "@/contexts/AuthContext";
import { ChatArea } from "@/components/chat/ChatArea";
import { ForumChannelView } from "@/components/chat/ForumChannelView";
import { MemberSidebar } from "@/components/chat/MemberSidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, Video, VideoOff, Volume2, PhoneOff, Users, MonitorOff, Headphones, HeadphoneOff, ScreenShare, Music, X, Sparkles, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { voiceService, type VoiceParticipant } from "@/lib/services/voiceService";
import { voiceErrorText } from "@/components/voice/IncomingCall";
import { cn, cdnImage } from "@/lib/utils";
import { usePolling } from "@/hooks/usePolling";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useGT } from "gt-next";
import { Loader } from "@/components/ui/Loader";
import { SwipeNav } from "@/components/mobile/SwipeNav";
import { useBackHandler } from "@/hooks/useBackHandler";
import { useThreadPanel } from "@/lib/chat/threadPanelStore";
import { canHostThreads, isThreadType } from "@/lib/chat/threads";

// The thread side panel's chunk loads the first time a thread is opened.
const ThreadPanel = dynamic(() => import("@/components/chat/ThreadPanel").then((m) => m.ThreadPanel), { ssr: false });
import { useVoiceUserMenu } from "@/components/voice/VoiceUserMenu";
import { StreamQualityPicker } from "@/components/voice/StreamQualityPicker";

// The call stage (video grid, spotlight, pop-out) only loads once you join.
const CallStage = dynamic(() => import("@/components/voice/CallStage").then((m) => m.CallStage), { ssr: false });

interface SoundboardSound {
  id: string;
  name: string;
  url: string;
  emoji?: string;
}

function VoiceChannelView({ channelId, channelName, serverId }: { channelId: string; channelName: string; serverId?: string }) {
  const { user } = useAuth();
  const router = useRouter();
  const gt = useGT();
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
  const [isJoining, setIsJoining] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [showSoundboard, setShowSoundboard] = useState(false);
  const [soundboardSounds, setSoundboardSounds] = useState<SoundboardSound[]>([]);
  const [playingSoundId, setPlayingSoundId] = useState<string | null>(null);
  const isMobile = useIsMobile();
  const [noiseSuppression, setNoiseSuppression] = useState(voiceService.noiseSuppressionEnabled);
  const [serverVoice, setServerVoice] = useState(() => ({ mute: voiceService.serverMute, deaf: voiceService.serverDeaf }));
  const { openVoiceUserMenu, voiceUserMenu } = useVoiceUserMenu({ serverId, channelId });

  const roomId = `channel-${channelId}`;

  useEffect(() => {
    if (user?.id) {
      voiceService.setUserId(user.id);
    }
  }, [user?.id]);

  // Fetch soundboard sounds for this server
  useEffect(() => {
    if (!serverId) return;
    const fetchSounds = async () => {
      try {
        const res = await fetch(`/api/servers/${serverId}/soundboard`);
        if (res.ok) {
          const data = await res.json();
          setSoundboardSounds(data.sounds || []);
        }
      } catch {
        // best-effort
      }
    };
    fetchSounds();
  }, [serverId]);

  // Sync local UI state from the service (single source of truth)
  const syncFromService = useCallback(() => {
    setIsConnected(voiceService.isConnectedTo(roomId));
    setIsMuted(voiceService.muted);
    setIsDeafened(voiceService.deafened);
    setIsVideoOn(voiceService.videoOn);
    setIsScreenSharing(voiceService.screenSharing);
    setParticipants(voiceService.currentParticipants);
  }, [roomId]);

  useEffect(() => {
    // Initialize from current service state on mount (handles navigating back
    // into a channel you're already connected to)
    syncFromService();

    const unsub = voiceService.subscribe((event) => {
      if (event.type === "connected") {
        syncFromService();
      } else if (event.type === "disconnected") {
        setIsConnected(false);
        setIsMuted(false);
        setIsDeafened(false);
        setIsVideoOn(false);
        setIsScreenSharing(false);
        setParticipants([]);
      } else if (event.type === "participants_changed") {
        setParticipants(event.participants);
      } else if (event.type === "video_toggled") {
        setIsVideoOn(event.enabled);
      } else if (event.type === "screen_share_toggled") {
        setIsScreenSharing(event.enabled);
      } else if (event.type === "mute_toggled") {
        setIsMuted(event.muted);
      } else if (event.type === "deafen_toggled") {
        setIsDeafened(event.deafened);
        if (event.deafened) setIsMuted(true);
      } else if (event.type === "server_voice_state") {
        setServerVoice({ mute: event.mute, deaf: event.deaf });
      } else if (event.type === "moved_by_moderator") {
        toast(gt("A moderator moved you to {name}", { name: event.channelName || gt("another channel") }));
      } else if (event.type === "error") {
        // The toast itself is shown app-wide by IncomingCall.
        setVoiceError(voiceErrorText(gt, event.code, event.message));
      } else if (event.type === "soundboard_played") {
        toast(gt("{username} played {soundName}", { username: event.username, soundName: event.soundName }), { icon: "🔊" });
      }
    });
    return unsub;
  }, [syncFromService, gt]);

  // Poll participants when not connected so users can see who's in VC
  // (visibility-aware: pauses in background tabs, refreshes on focus)
  const fetchIdleParticipants = useCallback(async () => {
    try {
      const res = await fetch(`/api/voice/state/${roomId}`);
      if (res.ok) {
        const data = await res.json();
        setParticipants(data.participants || []);
      }
    } catch {
      // best-effort
    }
  }, [roomId]);
  usePolling(() => void fetchIdleParticipants(), 5000, !isConnected, roomId);

  const joinVoice = async () => {
    setIsJoining(true);
    setVoiceError(null);
    try {
      await voiceService.joinChannel(roomId, false, {
        label: channelName,
        href: serverId ? `/channels/${serverId}/${channelId}` : undefined,
      });
      // joinChannel reports failures as error events rather than throwing.
      if (voiceService.connected && voiceService.currentRoomId === roomId) {
        toast.success(gt("Joined #{name}", { name: channelName }));
      }
    } catch (err) {
      setVoiceError(gt("Failed to join voice channel."));
      toast.error(gt("Failed to join voice channel"));
      console.error("Join error:", err);
    } finally {
      setIsJoining(false);
    }
  };

  const leaveVoice = async () => {
    await voiceService.leaveChannel();
    toast.success(gt("Left #{name}", { name: channelName }));
  };

  const handleMute = useCallback(() => {
    const muted = voiceService.toggleMute();
    setIsMuted(muted);
  }, []);

  const handleDeafen = useCallback(() => {
    const deafened = voiceService.toggleDeafen();
    setIsDeafened(deafened);
    if (deafened) setIsMuted(true);
  }, []);

  const handleVideo = useCallback(async () => {
    const videoOn = await voiceService.toggleVideo();
    setIsVideoOn(videoOn);
  }, []);

  const handleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      voiceService.stopScreenShare();
      setIsScreenSharing(false);
    } else {
      const sharing = await voiceService.startScreenShare();
      setIsScreenSharing(sharing);
    }
  }, [isScreenSharing]);

  const handleToggleNoiseSuppression = useCallback(() => {
    const enabled = voiceService.toggleNoiseSuppression();
    setNoiseSuppression(enabled);
  }, []);

  const handlePlaySound = useCallback(async (sound: SoundboardSound) => {
    if (!isConnected) return;
    setPlayingSoundId(sound.id);
    const success = await voiceService.playSoundboardSound({ url: sound.url, name: sound.name });
    if (!success) {
      toast.error(gt("Failed to play sound"));
    }
    setTimeout(() => setPlayingSoundId(null), 2000);
  }, [isConnected]);

  // No auto-leave on unmount — voice persists across channel navigation.
  // The sidebar VoiceBar leave button or the call controls leave button handles disconnect.


  return (
    <div className="flex-1 flex flex-col bg-[var(--bg-app)] min-w-0 min-h-0 overflow-hidden">
      {/* Header */}
      <div className="h-12 px-4 flex items-center justify-between border-b border-[var(--app-border)] bg-[var(--bg-app)]">
        <div className="flex items-center gap-2 min-w-0">
          {isMobile && serverId && (
            <button
              onClick={() => router.push(`/channels/${serverId}`)}
              className="flex items-center justify-center w-8 h-8 -ml-2 rounded-lg text-[var(--app-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
              title={gt("Back")}
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <Volume2 className="w-5 h-5 text-[#8B5CF6] flex-shrink-0" />
          <span className="font-semibold text-[var(--text-primary)] truncate">{channelName}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--app-surface-alt)] text-xs text-[var(--app-muted)] ring-1 ring-white/5">
          <span className={cn("w-1.5 h-1.5 rounded-full", participants.length > 0 ? "bg-green-500" : "bg-[#3a4459]")} />
          {participants.length} {participants.length === 1 ? gt("participant") : gt("participants")}
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {!isConnected ? (
          /* Not joined — show join screen */
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <div className="w-24 h-24 rounded-full bg-gradient-to-b from-[#8B5CF6]/20 to-[var(--app-surface-alt)] ring-1 ring-[#8B5CF6]/20 shadow-[0_0_40px_rgba(139,92,246,0.25)] flex items-center justify-center mb-5">
              <Volume2 className="w-11 h-11 text-[#8B5CF6]" />
            </div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-1">{channelName}</h2>
            <p className="text-sm text-[var(--app-muted-2)] mb-4">
              {participants.length > 0
                ? gt("{count} {people} in this channel", { count: participants.length, people: participants.length === 1 ? gt("person is") : gt("people are") })
                : gt("No one is here yet")}
            </p>
            {participants.length > 0 && (
              <div className="flex flex-wrap justify-center gap-2 mb-6 max-w-md">
                {participants.map((p) => (
                  <div
                    key={p.userId}
                    className="flex flex-col items-center gap-1 w-16"
                    onContextMenu={(e) => openVoiceUserMenu(e, p)}
                  >
                    <Avatar className="w-12 h-12">
                      {p.avatar && <AvatarImage src={cdnImage(p.avatar)} alt={p.username} />}
                      <AvatarFallback className="bg-[#8B5CF6]/20 text-[#8B5CF6]">
                        {(p.displayName || p.username || "?").charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-[10px] text-[var(--text-primary)] truncate max-w-full">
                      {p.displayName || p.username}
                    </span>
                    {(p.serverMute || !p.audio) && (
                      <MicOff
                        className={cn("w-3 h-3", p.serverMute ? "text-[#f23f43]" : "text-red-400")}
                        aria-label={p.serverMute ? gt("Server Muted") : gt("Muted")}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={joinVoice}
              disabled={isJoining}
              className="flex items-center gap-2 px-7 py-3 rounded-full bg-gradient-to-b from-[#8B5CF6] to-[#7C3AED] hover:from-[#9d70f8] hover:to-[#8B5CF6] text-white font-semibold shadow-[0_4px_20px_rgba(139,92,246,0.45)] transition-all active:scale-95 hover:scale-[1.03] disabled:opacity-50"
            >
              {isJoining ? <Loader size={20} /> : <PhoneOff className="w-5 h-5 rotate-[135deg]" />}
              {isJoining ? gt("Joining...") : gt("Join Voice")}
            </button>
            {voiceError && <p className="mt-3 text-sm text-red-400">{voiceError}</p>}
          </div>
        ) : (
          /* Joined — show video grid + controls */
          <>
            {/* Everyone in the call: cameras, screen shares and avatar cards.
                Click to spotlight, right-click for volume / moderation. */}
            <CallStage
              variant="channel"
              serverId={serverId}
              channelId={channelId}
              className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4"
              aloneHint={gt("You're the only one here. Invite others to join!")}
            />

            {/* Call controls bar — floating dock */}
            <div className="bg-transparent px-3 sm:px-4 pb-3 sm:pb-5 pt-1">
              <div className="mx-auto w-fit flex items-center justify-center gap-1 sm:gap-1.5 rounded-2xl bg-[var(--app-surface-alt)]/90 backdrop-blur-md px-2 py-1.5 sm:px-2.5 sm:py-2 shadow-[0_8px_30px_rgba(0,0,0,0.4)] ring-1 ring-white/5">
                <button
                  onClick={handleMute}
                  title={serverVoice.mute ? gt("Server Muted") : isMuted ? gt("Unmute") : gt("Mute")}
                  className={cn(
                    "flex items-center justify-center rounded-full transition-all active:scale-95 hover:scale-105",
                    isMobile ? "w-9 h-9" : "w-10 h-10",
                    isMuted || serverVoice.mute
                      ? "bg-[#ef4444]/20 text-[#ef4444] hover:bg-[#ef4444]/30"
                      : "bg-[var(--app-border)] text-[var(--app-muted)] hover:bg-[var(--border-strong)] hover:text-[var(--text-primary)]"
                  )}
                >
                  {isMuted || serverVoice.mute ? <MicOff className={isMobile ? "w-4 h-4" : "w-5 h-5"} /> : <Mic className={isMobile ? "w-4 h-4" : "w-5 h-5"} />}
                </button>

                <button
                  onClick={handleDeafen}
                  title={serverVoice.deaf ? gt("Server Deafened") : isDeafened ? gt("Undeafen") : gt("Deafen")}
                  className={cn(
                    "flex items-center justify-center rounded-full transition-all active:scale-95 hover:scale-105",
                    isMobile ? "w-9 h-9" : "w-10 h-10",
                    isDeafened || serverVoice.deaf
                      ? "bg-[#ef4444]/20 text-[#ef4444] hover:bg-[#ef4444]/30"
                      : "bg-[var(--app-border)] text-[var(--app-muted)] hover:bg-[var(--border-strong)] hover:text-[var(--text-primary)]"
                  )}
                >
                  {isDeafened || serverVoice.deaf ? <HeadphoneOff className={isMobile ? "w-4 h-4" : "w-5 h-5"} /> : <Headphones className={isMobile ? "w-4 h-4" : "w-5 h-5"} />}
                </button>

                <button
                  onClick={handleVideo}
                  title={isVideoOn ? gt("Turn Off Camera") : gt("Turn On Camera")}
                  className={cn(
                    "flex items-center justify-center rounded-full transition-all active:scale-95 hover:scale-105",
                    isMobile ? "w-9 h-9" : "w-10 h-10",
                    isVideoOn
                      ? "bg-[#8B5CF6]/20 text-[#8B5CF6] hover:bg-[#8B5CF6]/30"
                      : "bg-[var(--app-border)] text-[var(--app-muted)] hover:bg-[var(--border-strong)] hover:text-[var(--text-primary)]"
                  )}
                >
                  {isVideoOn ? <Video className={isMobile ? "w-4 h-4" : "w-5 h-5"} /> : <VideoOff className={isMobile ? "w-4 h-4" : "w-5 h-5"} />}
                </button>

                {/* Noise suppression toggle */}
                <button
                  onClick={handleToggleNoiseSuppression}
                  title={noiseSuppression ? gt("Disable Noise Suppression") : gt("Enable Noise Suppression")}
                  className={cn(
                    "flex items-center justify-center rounded-full transition-all active:scale-95 hover:scale-105",
                    isMobile ? "w-9 h-9" : "w-10 h-10",
                    noiseSuppression
                      ? "bg-[#8B5CF6]/20 text-[#8B5CF6] hover:bg-[#8B5CF6]/30"
                      : "bg-[var(--app-border)] text-[var(--app-muted)] hover:bg-[var(--border-strong)] hover:text-[var(--text-primary)]"
                  )}
                >
                  <Sparkles className={isMobile ? "w-4 h-4" : "w-5 h-5"} />
                </button>

                {/* Screen share — hidden on mobile (getDisplayMedia not supported) */}
                {!isMobile && (
                  <div className="flex items-center">
                    <button
                      onClick={handleScreenShare}
                      title={isScreenSharing ? gt("Stop Sharing") : gt("Share Screen")}
                      className={cn(
                        "flex items-center justify-center w-10 h-10 rounded-full transition-all active:scale-95 hover:scale-105",
                        isScreenSharing
                          ? "bg-[#8B5CF6]/20 text-[#8B5CF6] hover:bg-[#8B5CF6]/30"
                          : "bg-[var(--app-border)] text-[var(--app-muted)] hover:bg-[var(--border-strong)] hover:text-[var(--text-primary)]"
                      )}
                    >
                      {isScreenSharing ? <MonitorOff className="w-5 h-5" /> : <ScreenShare className="w-5 h-5" />}
                    </button>
                    {/* Resolution / frame rate ("Go Live" when not sharing yet) */}
                    <StreamQualityPicker
                      sharing={isScreenSharing}
                      onStarted={setIsScreenSharing}
                      className="h-10 w-5"
                    />
                  </div>
                )}

                {/* Soundboard toggle */}
                {soundboardSounds.length > 0 && (
                  <button
                    onClick={() => setShowSoundboard(!showSoundboard)}
                    title={gt("Soundboard")}
                    className={cn(
                      "flex items-center justify-center rounded-full transition-all active:scale-95 hover:scale-105",
                      isMobile ? "w-9 h-9" : "w-10 h-10",
                      showSoundboard
                        ? "bg-[#8B5CF6]/20 text-[#8B5CF6] hover:bg-[#8B5CF6]/30"
                        : "bg-[var(--app-border)] text-[var(--app-muted)] hover:bg-[var(--border-strong)] hover:text-[var(--text-primary)]"
                    )}
                  >
                    <Music className={isMobile ? "w-4 h-4" : "w-5 h-5"} />
                  </button>
                )}

                <div className="w-px h-6 bg-white/10 mx-1" />

                <button
                  onClick={leaveVoice}
                  title={gt("Leave Voice Channel")}
                  className={cn(
                    "flex items-center justify-center rounded-full bg-[#ef4444] text-white hover:bg-[#dc2626] shadow-[0_2px_10px_rgba(239,68,68,0.4)] transition-all active:scale-95 hover:scale-105",
                    isMobile ? "w-9 h-9" : "w-12 h-10"
                  )}
                >
                  <PhoneOff className={isMobile ? "w-4 h-4" : "w-5 h-5"} />
                </button>
              </div>

              {/* Soundboard Panel */}
              {showSoundboard && soundboardSounds.length > 0 && (
                <div className="mt-3 p-3 bg-[var(--app-surface-alt)] rounded-lg border border-[var(--app-border)]">
                  <p className="text-xs text-[var(--app-muted-2)] mb-2 font-medium uppercase tracking-wide">{gt("Soundboard")}</p>
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                    {soundboardSounds.map((sound) => (
                      <button
                        key={sound.id}
                        onClick={() => handlePlaySound(sound)}
                        disabled={playingSoundId === sound.id}
                        className={cn(
                          "flex flex-col items-center gap-1 p-2 rounded-lg border transition-all",
                          playingSoundId === sound.id
                            ? "bg-[#8B5CF6]/20 border-[#8B5CF6] scale-95"
                            : "bg-[var(--bg-app)] border-[var(--app-border)] hover:border-[#8B5CF6]/50 hover:bg-[var(--bg-hover)]"
                        )}
                      >
                        <span className="text-lg">{sound.emoji || "🔊"}</span>
                        <span className="text-[10px] text-[var(--app-muted)] truncate w-full text-center">{sound.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
      {voiceUserMenu}
    </div>
  );
}

export default function ChannelPage() {
  const params = useParams();
  const router = useRouter();
  const gt = useGT();
  const { servers, setCurrentServer, channels, channelsServerId, setCurrentChannel, isLoading, fetchChannels, currentServer, currentChannel } = useServer();
  // Discord's thread side panel, next to a text / announcement channel.
  const threadPanel = useThreadPanel(currentChannel && canHostThreads(currentChannel.type) ? currentChannel.id : null);
  const [showMembers, setShowMembers] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= 768 : true
  );
  const [isMobile, setIsMobile] = useState(false);
  // Phones: the Android back button closes the member drawer first.
  useBackHandler(isMobile && showMembers, () => setShowMembers(false));

  // Member list rendering: inline sidebar on desktop, slide-in drawer on mobile.
  const renderMembers = (mobile: boolean) => {
    if (mobile) {
      if (!showMembers) return null;
      return (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/60 md:hidden animate-in fade-in duration-200"
            onClick={() => setShowMembers(false)}
          />
          {/* Drawer */}
          <SwipeNav
            onSwipeRight={() => setShowMembers(false)}
            className="fixed top-0 right-0 bottom-0 z-50 w-72 max-w-[85vw] md:hidden shadow-2xl flex flex-col bg-[var(--bg-app)] animate-in slide-in-from-right duration-200 ease-out pt-safe pb-safe"
          >
            <div className="flex items-center justify-between h-12 px-4 border-b border-[var(--app-border)] shrink-0">
              <span className="flex items-center gap-2 font-semibold text-[var(--text-primary)]">
                <Users className="w-5 h-5" />
                {gt("Members")}
              </span>
              <button
                onClick={() => setShowMembers(false)}
                aria-label={gt("Close member list")}
                className="p-2 -mr-2 rounded-lg text-[var(--app-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--app-surface-alt)] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 min-h-0">
              <MemberSidebar />
            </div>
          </SwipeNav>
        </>
      );
    }
    return showMembers ? <MemberSidebar /> : null;
  };

  const serverId = params.serverId as string;
  const channelId = params.channelId as string;

  const [confirmedNsfwChannels, setConfirmedNsfwChannels] = useState<Set<string>>(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = sessionStorage.getItem("confirmedNsfwChannels");
        return stored ? new Set(JSON.parse(stored)) : new Set();
      } catch {
        return new Set();
      }
    }
    return new Set();
  });

  const confirmChannel = (id: string) => {
    setConfirmedNsfwChannels((prev) => {
      const next = new Set(prev);
      next.add(id);
      if (typeof window !== "undefined") {
        try {
          sessionStorage.setItem("confirmedNsfwChannels", JSON.stringify(Array.from(next)));
        } catch {
          // ignore
        }
      }
      return next;
    });
  };

  // Detect mobile
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Set current server when servers load
  useEffect(() => {
    if (!isLoading && servers.length > 0) {
      const server = servers.find((s) => s.id === serverId);
      if (server) {
        setCurrentServer(server);
        // Ensure channels are fetched for this server
        if (!currentServer || currentServer.id !== serverId) {
          fetchChannels(serverId);
        }
      } else {
        router.push("/channels/me");
      }
    }
  }, [serverId, servers, isLoading, setCurrentServer, router, fetchChannels, currentServer]);

  const verifiedChannelRef = useRef<{ channelId: string | null; list: unknown }>({ channelId: null, list: null });

  // Set current channel when channels load. If the URL points to a channel
  // that isn't in the loaded list yet (mid server-switch), clear the stale
  // selection so the previous server's chat doesn't stick.
  useEffect(() => {
    if (!channelId) return;

    // The channel list must belong to THIS server before we can trust it. During
    // a server switch `channels` still holds the previous server's list, so
    // deriving the active channel from it would show the wrong channel/name.
    const listMatchesServer = channelsServerId === serverId;

    if (!listMatchesServer) {
      // Drop any lingering selection that doesn't match the URL so the old
      // server's chat doesn't stick while the new channel list loads.
      if (currentChannel && currentChannel.id !== channelId) {
        setCurrentChannel(null);
      }
      return;
    }

    const channel = channels.find((c) => c.id === channelId);
    if (channel) {
      if (currentChannel?.id !== channel.id) {
        setCurrentChannel(channel);
      }
      return;
    }
    // Threads aren't in the sidebar channel list — fetch the channel directly so
    // navigating into a forum post / ticket works. Also re-checked whenever the
    // list changes, so a channel deleted by someone else doesn't stay open.
    if (
      currentChannel?.id === channelId &&
      verifiedChannelRef.current.channelId === channelId &&
      verifiedChannelRef.current.list === channels
    ) return;
    verifiedChannelRef.current = { channelId, list: channels };
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/channels/${channelId}`);
        if (!res.ok) {
          if (cancelled) return;
          if (currentChannel) setCurrentChannel(null);
          // Gone or no longer visible: back to the server instead of an empty view.
          if (res.status === 404 || res.status === 403) router.replace(`/channels/${serverId}`);
          return;
        }
        const data = await res.json();
        const ch = data.channel;
        if (cancelled || !ch) return;
        setCurrentChannel({
          id: ch.id || ch._id,
          name: ch.name,
          type: ch.type,
          serverId: (ch.serverId || serverId)?.toString?.() || serverId,
          position: ch.position ?? 0,
          parentId: ch.parentId?.toString?.() || ch.parentId || null,
          parentName: ch.parentName,
          parentType: ch.parentType ?? null,
          isNsfw: ch.nsfw || ch.isNsfw,
          topic: ch.topic,
          rateLimitPerUser: ch.rateLimitPerUser || 0,
          permissionOverwrites: ch.permissionOverwrites || [],
        });
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, [channelId, channels, channelsServerId, currentChannel, setCurrentChannel, serverId, router]);

  // Persist the last-visited channel per server so reloads and server switches
  // return here instead of falling back to the first channel in the list.
  useEffect(() => {
    if (!channelId || !serverId) return;
    const channel = channels.find((c) => c.id === channelId);
    if (channel && (channel.type === "text" || channel.type === "announcement")) {
      localStorage.setItem(`sc:last_channel:${serverId}`, channelId);
    }
  }, [channelId, serverId, channels]);

  const isNsfw = currentChannel?.isNsfw;
  const isConfirmed = currentChannel ? confirmedNsfwChannels.has(currentChannel.id) : false;

  // iOS detection (or ?platform=ios query param for testing)
  const isIOS = useMemo(() => {
    if (typeof window === "undefined") return false;
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("platform") === "ios") return true;
    const ua = navigator.userAgent;
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }, []);

  // Age-gated server block for iOS
  if (isIOS && currentServer?.isAgeGated) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[var(--bg-primary)] text-[var(--text-primary)] p-6 text-center select-none">
        {/* TV Static Icon */}
        <div className="relative mb-6">
          {/* Decorative sparkles */}
          <span className="absolute -top-3 -left-4 text-[var(--text-muted)] text-xs select-none">✦</span>
          <span className="absolute -top-1 right-0 text-[var(--text-muted)] text-[10px] select-none">✧</span>
          <span className="absolute bottom-0 -left-2 text-[var(--text-muted)] text-[8px] select-none">+</span>
          <span className="absolute bottom-2 -right-3 text-[var(--text-muted)] text-xs select-none">·</span>

          <svg width="120" height="90" viewBox="0 0 120 90" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* TV Body */}
            <rect x="10" y="8" width="100" height="70" rx="6" fill="#3a3a3a" stroke="#555" strokeWidth="2"/>
            {/* Screen */}
            <rect x="18" y="16" width="84" height="50" rx="3" fill="#2a2a2a"/>
            {/* Static zigzag lines */}
            <path d="M18 30 L30 25 L42 35 L54 22 L66 38 L78 20 L90 32 L102 28" stroke="#555" strokeWidth="2" fill="none"/>
            <path d="M18 42 L28 48 L40 38 L52 50 L64 36 L76 45 L88 40 L102 44" stroke="#4a4a4a" strokeWidth="2" fill="none"/>
            <path d="M18 55 L32 50 L44 58 L56 48 L68 56 L80 52 L102 54" stroke="#555" strokeWidth="1.5" fill="none"/>
            {/* Stand */}
            <rect x="45" y="78" width="30" height="4" rx="2" fill="#444"/>
            {/* Exclamation badge */}
            <circle cx="98" cy="20" r="14" fill="white" stroke="#ddd" strokeWidth="1.5"/>
            <text x="98" y="26" textAnchor="middle" fontSize="18" fontWeight="bold" fill="#333">!</text>
          </svg>
        </div>

        <p className="text-base text-[var(--text-muted)] max-w-xs leading-relaxed">
          {gt("This server's content is unavailable on iOS")}
        </p>
      </div>
    );
  }

  // NSFW channel age gate (redesigned)
  if (isNsfw && !isConfirmed && currentChannel) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[var(--bg-primary)] text-[var(--text-primary)] p-6 text-center select-none">
        {/* Warning Triangle with cloud bubbles (matching reference) */}
        <div className="relative mb-8">
          {/* Background cloud bubbles */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
            <svg width="240" height="180" viewBox="0 0 240 180" fill="none">
              {/* Large cloud/blob shapes behind triangle */}
              <ellipse cx="120" cy="110" rx="90" ry="40" fill="var(--bg-sidebar)" opacity="0.6"/>
              <ellipse cx="80" cy="90" rx="30" ry="25" fill="var(--bg-sidebar)" opacity="0.4"/>
              <ellipse cx="160" cy="85" rx="25" ry="20" fill="var(--bg-sidebar)" opacity="0.4"/>
              {/* Small decorative dots */}
              <circle cx="45" cy="60" r="2" fill="var(--text-muted)" opacity="0.3"/>
              <circle cx="195" cy="55" r="1.5" fill="var(--text-muted)" opacity="0.3"/>
              <circle cx="50" cy="95" r="1" fill="var(--text-muted)" opacity="0.4"/>
              <circle cx="190" cy="100" r="1.5" fill="var(--text-muted)" opacity="0.3"/>
              {/* Cross sparkles */}
              <path d="M40 50 L40 56 M37 53 L43 53" stroke="var(--text-muted)" strokeWidth="1" opacity="0.3"/>
              <path d="M198 70 L198 74 M196 72 L200 72" stroke="var(--text-muted)" strokeWidth="1" opacity="0.3"/>
            </svg>
          </div>

          {/* Main warning triangle */}
          <svg width="140" height="130" viewBox="0 0 140 130" fill="none" className="relative z-10">
            {/* Triangle shadow */}
            <path d="M70 18 L128 118 H12Z" fill="rgba(0,0,0,0.15)" transform="translate(2, 3)"/>
            {/* Triangle body */}
            <path d="M70 15 L130 120 H10Z" fill="#d4a017" stroke="#b8940f" strokeWidth="3" strokeLinejoin="round"/>
            {/* Inner triangle highlight */}
            <path d="M70 30 L115 110 H25Z" fill="#c49515" opacity="0.5"/>
            {/* Exclamation mark */}
            <rect x="64" y="50" width="12" height="35" rx="4" fill="#3a3018"/>
            <circle cx="70" cy="100" r="7" fill="#3a3018"/>
          </svg>
        </div>

        {/* Text */}
        <h2 className="text-2xl font-extrabold text-[var(--text-primary)] mb-3">
          {gt("Age-Restricted Channel")}
        </h2>
        <p className="text-base text-[var(--text-muted)] max-w-md leading-relaxed mb-8">
          {gt("This channel contains adult content marked as age-restricted. Do you wish to proceed?")}
        </p>

        {/* Buttons */}
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            onClick={() => {
              if (currentServer) {
                const safeChannel = channels.find((c) => !c.isNsfw && c.type !== "category");
                if (safeChannel) {
                  router.push(`/channels/${currentServer.id}/${safeChannel.id}`);
                } else {
                  router.push(`/channels/${currentServer.id}`);
                }
              } else {
                router.push("/channels/me");
              }
            }}
            className="min-w-[160px] h-11 bg-[var(--bg-sidebar)] hover:bg-[var(--bg-sidebar-elevated)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-medium text-base rounded-md"
          >
            {gt("No, take me back")}
          </Button>
          <Button
            onClick={() => confirmChannel(currentChannel.id)}
            className="min-w-[180px] h-11 bg-[var(--app-accent)] hover:opacity-90 text-[var(--text-on-accent)] font-medium text-base shadow-lg rounded-md"
          >
            {gt("Yes, I am 18 or older")}
          </Button>
        </div>
      </div>
    );
  }

  // Forum channel experience — a list of posts / tickets
  if (currentChannel?.type === "forum") {
    return (
      <>
        <ForumChannelView
          serverId={serverId}
          channelId={currentChannel.id}
          channelName={currentChannel.name}
        />
        {renderMembers(isMobile)}
      </>
    );
  }

  // Voice channel experience
  if (currentChannel?.type === "voice") {
    return (
      <>
        <VoiceChannelView
          channelId={currentChannel.id}
          channelName={currentChannel.name}
          serverId={currentServer?.id}
        />
        {renderMembers(isMobile)}
      </>
    );
  }

  // Forum thread experience — show the parent forum post list + thread chat.
  // A thread in a text / announcement channel opens as a full chat view below
  // (header: "# parent › thread").
  const threadParentType = currentChannel?.parentId
    ? currentChannel.parentType ?? channels.find((c) => c.id === currentChannel.parentId)?.type ?? null
    : null;
  const isForumThread =
    currentChannel &&
    isThreadType(currentChannel.type) &&
    currentChannel.parentId &&
    (threadParentType === "forum" || threadParentType === null);

  if (isForumThread) {
    return (
      <ForumChannelView
        serverId={serverId}
        channelId={currentChannel.parentId!}
        channelName={currentChannel.parentName || ""}
        selectedThreadId={currentChannel.id}
      />
    );
  }

  return (
    <>
      <SwipeNav
        enabled={isMobile && !showMembers}
        onSwipeRight={() => router.push(`/channels/${serverId}`)}
        onSwipeLeft={() => setShowMembers(true)}
      >
        <ChatArea onToggleMembers={() => setShowMembers(!showMembers)} showMembers={showMembers} />
      </SwipeNav>
      {threadPanel.mode !== "closed" && currentChannel ? (
        // The member list makes way for the thread panel (Discord).
        <ThreadPanel parentChannel={currentChannel} state={threadPanel} serverId={serverId} />
      ) : (
        renderMembers(isMobile)
      )}
    </>
  );
}
