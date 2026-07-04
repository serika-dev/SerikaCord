"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useServer } from "@/contexts/ServerContext";
import { useAuth } from "@/contexts/AuthContext";
import { ChatArea } from "@/components/chat/ChatArea";
import { MemberSidebar } from "@/components/chat/MemberSidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2, Mic, MicOff, Video, VideoOff, Volume2, PhoneOff, Users, Monitor, MonitorOff, Headphones, ScreenShare, Maximize2, Music } from "lucide-react";
import { toast } from "sonner";
import { voiceService, type VoiceParticipant } from "@/lib/services/voiceService";
import { cn } from "@/lib/utils";
import { usePolling } from "@/hooks/usePolling";

interface SoundboardSound {
  _id: string;
  name: string;
  url: string;
  emoji?: string;
}

function VoiceChannelView({ channelId, channelName, serverId }: { channelId: string; channelName: string; serverId?: string }) {
  const { user } = useAuth();
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
  const [isJoining, setIsJoining] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [speakingUsers, setSpeakingUsers] = useState<Map<string, boolean>>(new Map());
  const [showSoundboard, setShowSoundboard] = useState(false);
  const [soundboardSounds, setSoundboardSounds] = useState<SoundboardSound[]>([]);
  const [playingSoundId, setPlayingSoundId] = useState<string | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const screenVideoRef = useRef<HTMLVideoElement>(null);

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
      } else if (event.type === "speaking") {
        setSpeakingUsers(prev => {
          const next = new Map(prev);
          if (event.speaking) {
            next.set(event.userId, true);
          } else {
            next.delete(event.userId);
          }
          return next;
        });
      } else if (event.type === "error") {
        setVoiceError(event.message);
        toast.error(event.message);
      } else if (event.type === "soundboard_played") {
        toast(`${event.username} played ${event.soundName}`, { icon: "🔊" });
      }
    });
    return unsub;
  }, [syncFromService]);

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

  // Attach local video stream
  useEffect(() => {
    if (localVideoRef.current && isVideoOn) {
      const stream = voiceService.localStream_;
      if (stream) {
        localVideoRef.current.srcObject = stream;
      }
    }
  }, [isVideoOn]);

  // Attach screen share stream
  useEffect(() => {
    if (screenVideoRef.current && isScreenSharing) {
      const stream = voiceService.screenShareStream;
      if (stream) {
        screenVideoRef.current.srcObject = stream;
      }
    }
  }, [isScreenSharing]);

  const joinVoice = async () => {
    setIsJoining(true);
    setVoiceError(null);
    try {
      await voiceService.joinChannel(roomId, false);
      toast.success(`Joined #${channelName}`);
    } catch (err) {
      setVoiceError("Failed to join voice channel.");
      toast.error("Failed to join voice channel");
      console.error("Join error:", err);
    } finally {
      setIsJoining(false);
    }
  };

  const leaveVoice = async () => {
    await voiceService.leaveChannel();
    toast.success(`Left #${channelName}`);
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

  const handlePlaySound = useCallback(async (sound: SoundboardSound) => {
    if (!isConnected) return;
    setPlayingSoundId(sound._id);
    const success = await voiceService.playSoundboardSound({ url: sound.url, name: sound.name });
    if (!success) {
      toast.error("Failed to play sound");
    }
    setTimeout(() => setPlayingSoundId(null), 2000);
  }, [isConnected]);

  // No auto-leave on unmount — voice persists across channel navigation.
  // The sidebar VoiceBar leave button or the call controls leave button handles disconnect.

  const videoParticipants = participants.filter(p => p.video || p.screenShare);
  const audioOnlyParticipants = participants.filter(p => !p.video && !p.screenShare);

  return (
    <div className="flex-1 flex flex-col bg-[#0a0d15] min-w-0 min-h-0 overflow-hidden">
      {/* Header */}
      <div className="h-12 px-4 flex items-center justify-between border-b border-[#1e2637] bg-[#0a0d15]">
        <div className="flex items-center gap-2 min-w-0">
          <Volume2 className="w-5 h-5 text-[#8B5CF6]" />
          <span className="font-semibold text-white truncate">{channelName}</span>
        </div>
        <div className="text-xs text-[#6b7387]">
          {participants.length} {participants.length === 1 ? "participant" : "participants"}
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {!isConnected ? (
          /* Not joined — show join screen */
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <div className="w-20 h-20 rounded-full bg-[#131a28] flex items-center justify-center mb-4">
              <Volume2 className="w-10 h-10 text-[#8B5CF6]" />
            </div>
            <h2 className="text-lg font-semibold text-white mb-1">{channelName}</h2>
            <p className="text-sm text-[#6b7387] mb-4">
              {participants.length > 0
                ? `${participants.length} ${participants.length === 1 ? "person is" : "people are"} in this channel`
                : "No one is here yet"}
            </p>
            {participants.length > 0 && (
              <div className="flex flex-wrap justify-center gap-2 mb-6 max-w-md">
                {participants.map((p) => (
                  <div key={p.userId} className="flex flex-col items-center gap-1 w-16">
                    <Avatar className="w-12 h-12">
                      {p.avatar && <AvatarImage src={p.avatar} alt={p.username} />}
                      <AvatarFallback className="bg-[#8B5CF6]/20 text-[#8B5CF6]">
                        {(p.displayName || p.username || "?").charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-[10px] text-[#d5d9e8] truncate max-w-full">
                      {p.displayName || p.username}
                    </span>
                    {!p.audio && <MicOff className="w-3 h-3 text-red-400" />}
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={joinVoice}
              disabled={isJoining}
              className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white font-medium transition-colors disabled:opacity-50"
            >
              {isJoining ? <Loader2 className="w-5 h-5 animate-spin" /> : <PhoneOff className="w-5 h-5 rotate-[135deg]" />}
              {isJoining ? "Joining..." : "Join Voice"}
            </button>
            {voiceError && <p className="mt-3 text-sm text-red-400">{voiceError}</p>}
          </div>
        ) : (
          /* Joined — show video grid + controls */
          <>
            {/* Video / Screen share grid */}
            <div className="flex-1 overflow-y-auto p-4 min-h-0">
              {/* Screen share (full width on top) */}
              {isScreenSharing && (
                <div className="relative rounded-xl overflow-hidden bg-[#131a28] mb-3 aspect-video">
                  <video
                    ref={screenVideoRef}
                    autoPlay
                    muted
                    playsInline
                    className="w-full h-full object-contain"
                  />
                  <div className="absolute bottom-2 left-2 px-2 py-1 rounded bg-black/60 text-xs text-white flex items-center gap-1.5">
                    <Monitor className="w-3.5 h-3.5" />
                    Your Screen Share
                  </div>
                </div>
              )}

              {/* Remote screen shares */}
              {videoParticipants.filter(p => p.screenShare).map((p) => (
                <RemoteScreenShare key={`screen-${p.userId}`} participant={p} />
              ))}

              {/* Video grid */}
              <div className={cn(
                "grid gap-3",
                videoParticipants.filter(p => !p.screenShare).length === 0 && !isVideoOn
                  ? "grid-cols-1"
                  : videoParticipants.filter(p => !p.screenShare).length <= 1 && !isVideoOn
                    ? "grid-cols-1 max-w-md mx-auto"
                    : videoParticipants.filter(p => !p.screenShare).length <= 3 && !isVideoOn
                      ? "grid-cols-2"
                      : "grid-cols-3"
              )}>
                {/* Local video tile */}
                {isVideoOn && (
                  <div className="relative rounded-xl overflow-hidden bg-[#131a28] aspect-video min-h-[140px]">
                    <video
                      ref={localVideoRef}
                      autoPlay
                      muted
                      playsInline
                      className="w-full h-full object-cover video-mirror"
                    />
                    <div className="absolute bottom-2 left-2 px-2 py-1 rounded bg-black/60 text-xs text-white">
                      You
                    </div>
                  </div>
                )}

                {/* Remote video tiles */}
                {videoParticipants.filter(p => !p.screenShare).map((p) => (
                  <RemoteVideoTile key={p.userId} participant={p} speaking={speakingUsers.get(p.userId)} />
                ))}
              </div>

              {/* Audio-only participants */}
              {audioOnlyParticipants.length > 0 && (
                <div className={cn(
                  "mt-4",
                  videoParticipants.length === 0 && !isVideoOn ? "" : ""
                )}>
                  {videoParticipants.length > 0 || isVideoOn ? (
                    <h3 className="text-xs font-semibold text-[#6b7387] uppercase tracking-wide mb-2">In Voice</h3>
                  ) : null}
                  <div className={cn(
                    "grid gap-2",
                    audioOnlyParticipants.length <= 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3 sm:grid-cols-6"
                  )}>
                    {audioOnlyParticipants.map((p) => {
                      const isSpeaking = speakingUsers.get(p.userId);
                      return (
                        <div
                          key={p.userId}
                          className="flex flex-col items-center gap-2 p-3 rounded-xl bg-[#131a28] border border-[#1e2637] transition-all"
                          style={isSpeaking ? { borderColor: '#22c55e', boxShadow: '0 0 8px rgba(34,197,94,0.3)' } : undefined}
                        >
                          <div className="relative">
                            <Avatar className={cn("w-12 h-12", isSpeaking && "ring-2 ring-green-500 ring-offset-2 ring-offset-[#131a28]")}>
                              {p.avatar && <AvatarImage src={p.avatar} alt={p.username} />}
                              <AvatarFallback className="bg-[#8B5CF6]/20 text-[#8B5CF6]">
                                {(p.displayName || p.username || "?").charAt(0).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            {isSpeaking && (
                              <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-500 border-2 border-[#131a28]" />
                            )}
                          </div>
                          <span className="text-xs text-[#d5d9e8] truncate max-w-full">
                            {p.displayName || p.username}
                          </span>
                          <div className="flex items-center gap-1">
                            {p.audio ? (
                              <Mic className="w-3 h-3 text-green-400" />
                            ) : (
                              <MicOff className="w-3 h-3 text-red-400" />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Empty state when connected but nobody has video */}
              {videoParticipants.length === 0 && !isVideoOn && audioOnlyParticipants.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center text-[#6b7387]">
                  <Users className="w-10 h-10 mb-3 text-[#2a3548]" />
                  <p className="text-sm">You&apos;re the only one here. Invite others to join!</p>
                </div>
              )}
            </div>

            {/* Call controls bar */}
            <div className="border-t border-[#1e2637] bg-[#0a0d15] px-4 py-3">
              <div className="flex items-center justify-center gap-2">
                <button
                  onClick={handleMute}
                  title={isMuted ? "Unmute" : "Mute"}
                  className={cn(
                    "flex items-center justify-center w-10 h-10 rounded-lg transition-all active:scale-95",
                    isMuted
                      ? "bg-[#ef4444]/20 text-[#ef4444] hover:bg-[#ef4444]/30"
                      : "bg-[#1e2637] text-[#8d97ad] hover:bg-[#243044] hover:text-[#d5d9e8]"
                  )}
                >
                  {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                </button>

                <button
                  onClick={handleDeafen}
                  title={isDeafened ? "Undeafen" : "Deafen"}
                  className={cn(
                    "flex items-center justify-center w-10 h-10 rounded-lg transition-all active:scale-95",
                    isDeafened
                      ? "bg-[#ef4444]/20 text-[#ef4444] hover:bg-[#ef4444]/30"
                      : "bg-[#1e2637] text-[#8d97ad] hover:bg-[#243044] hover:text-[#d5d9e8]"
                  )}
                >
                  <Headphones className="w-5 h-5" />
                </button>

                <button
                  onClick={handleVideo}
                  title={isVideoOn ? "Turn Off Camera" : "Turn On Camera"}
                  className={cn(
                    "flex items-center justify-center w-10 h-10 rounded-lg transition-all active:scale-95",
                    isVideoOn
                      ? "bg-[#8B5CF6]/20 text-[#8B5CF6] hover:bg-[#8B5CF6]/30"
                      : "bg-[#1e2637] text-[#8d97ad] hover:bg-[#243044] hover:text-[#d5d9e8]"
                  )}
                >
                  {isVideoOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
                </button>

                <button
                  onClick={handleScreenShare}
                  title={isScreenSharing ? "Stop Sharing" : "Share Screen"}
                  className={cn(
                    "flex items-center justify-center w-10 h-10 rounded-lg transition-all active:scale-95",
                    isScreenSharing
                      ? "bg-[#8B5CF6]/20 text-[#8B5CF6] hover:bg-[#8B5CF6]/30"
                      : "bg-[#1e2637] text-[#8d97ad] hover:bg-[#243044] hover:text-[#d5d9e8]"
                  )}
                >
                  {isScreenSharing ? <MonitorOff className="w-5 h-5" /> : <ScreenShare className="w-5 h-5" />}
                </button>

                {/* Soundboard toggle */}
                {soundboardSounds.length > 0 && (
                  <button
                    onClick={() => setShowSoundboard(!showSoundboard)}
                    title="Soundboard"
                    className={cn(
                      "flex items-center justify-center w-10 h-10 rounded-lg transition-all active:scale-95",
                      showSoundboard
                        ? "bg-[#8B5CF6]/20 text-[#8B5CF6] hover:bg-[#8B5CF6]/30"
                        : "bg-[#1e2637] text-[#8d97ad] hover:bg-[#243044] hover:text-[#d5d9e8]"
                    )}
                  >
                    <Music className="w-5 h-5" />
                  </button>
                )}

                <div className="w-px h-6 bg-[#1e2637] mx-1" />

                <button
                  onClick={leaveVoice}
                  title="Leave Voice Channel"
                  className="flex items-center justify-center w-10 h-10 rounded-lg bg-[#ef4444]/15 text-[#ef4444] hover:bg-[#ef4444]/25 transition-all active:scale-95"
                >
                  <PhoneOff className="w-5 h-5" />
                </button>
              </div>

              {/* Soundboard Panel */}
              {showSoundboard && soundboardSounds.length > 0 && (
                <div className="mt-3 p-3 bg-[#131a28] rounded-lg border border-[#1e2637]">
                  <p className="text-xs text-[#6b7387] mb-2 font-medium uppercase tracking-wide">Soundboard</p>
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                    {soundboardSounds.map((sound) => (
                      <button
                        key={sound._id}
                        onClick={() => handlePlaySound(sound)}
                        disabled={playingSoundId === sound._id}
                        className={cn(
                          "flex flex-col items-center gap-1 p-2 rounded-lg border transition-all",
                          playingSoundId === sound._id
                            ? "bg-[#8B5CF6]/20 border-[#8B5CF6] scale-95"
                            : "bg-[#0a0d15] border-[#1e2637] hover:border-[#8B5CF6]/50 hover:bg-[#1e2637]"
                        )}
                      >
                        <span className="text-lg">{sound.emoji || "🔊"}</span>
                        <span className="text-[10px] text-[#8d97ad] truncate w-full text-center">{sound.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function RemoteVideoTile({ participant, speaking }: { participant: VoiceParticipant; speaking?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && participant.stream) {
      videoRef.current.srcObject = participant.stream;
    }
  }, [participant.stream]);

  return (
    <div className={cn(
      "relative rounded-xl overflow-hidden bg-[#131a28] aspect-video min-h-[140px] transition-all",
      speaking && "ring-2 ring-green-500"
    )}>
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="w-full h-full object-cover"
      />
      <div className="absolute bottom-2 left-2 px-2 py-1 rounded bg-black/60 text-xs text-white flex items-center gap-1.5">
        {participant.displayName || participant.username}
        {!participant.audio && <MicOff className="w-3 h-3 text-red-400" />}
      </div>
    </div>
  );
}

function RemoteScreenShare({ participant }: { participant: VoiceParticipant }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (videoRef.current && participant.stream) {
      videoRef.current.srcObject = participant.stream;
    }
  }, [participant.stream]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void containerRef.current?.requestFullscreen().catch(() => {});
    }
  };

  return (
    <div
      ref={containerRef}
      className="group relative rounded-xl overflow-hidden bg-[#131a28] mb-3 aspect-video"
      onDoubleClick={toggleFullscreen}
    >
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="w-full h-full object-contain"
      />
      <div className="absolute bottom-2 left-2 px-2 py-1 rounded bg-black/60 text-xs text-white flex items-center gap-1.5">
        <Monitor className="w-3.5 h-3.5" />
        {participant.displayName || participant.username}&apos;s Screen
      </div>
      <button
        onClick={toggleFullscreen}
        aria-label="Toggle fullscreen"
        className="absolute top-2 right-2 p-1.5 rounded bg-black/60 text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
      >
        <Maximize2 className="w-4 h-4" />
      </button>
    </div>
  );
}

export default function ChannelPage() {
  const params = useParams();
  const router = useRouter();
  const { servers, setCurrentServer, channels, setCurrentChannel, isLoading, fetchChannels, currentServer, currentChannel } = useServer();
  const [showMembers, setShowMembers] = useState(true);
  const [isMobile, setIsMobile] = useState(false);

  const serverId = params.serverId as string;
  const channelId = params.channelId as string;

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

  // Set current channel when channels load. If the URL points to a channel
  // that isn't in the loaded list yet (mid server-switch), clear the stale
  // selection so the previous server's chat doesn't stick.
  useEffect(() => {
    if (!channelId) return;
    const channel = channels.find((c) => c.id === channelId);
    if (channel) {
      setCurrentChannel(channel);
    } else if (currentChannel && currentChannel.id !== channelId) {
      setCurrentChannel(null);
    }
  }, [channelId, channels, currentChannel, setCurrentChannel]);

  // Voice channel experience
  if (currentChannel?.type === "voice") {
    return (
      <>
        <VoiceChannelView
          channelId={currentChannel.id}
          channelName={currentChannel.name}
          serverId={currentServer?.id}
        />
        {showMembers && !isMobile && <MemberSidebar />}
      </>
    );
  }

  return (
    <>
      <ChatArea onToggleMembers={() => setShowMembers(!showMembers)} showMembers={showMembers} />
      {showMembers && !isMobile && <MemberSidebar />}
    </>
  );
}
