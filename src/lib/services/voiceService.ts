import SimplePeer from "simple-peer";

export interface VoiceParticipant {
  userId: string;
  username: string;
  displayName?: string;
  avatar?: string;
  audio: boolean;
  video: boolean;
  deafened: boolean;
  joinedAt: string;
  stream?: MediaStream;
  screenShare?: boolean;
}

export type VoiceEvent =
  | { type: "participants_changed"; participants: VoiceParticipant[] }
  | { type: "speaking"; userId: string; speaking: boolean }
  | { type: "error"; message: string }
  | { type: "connected" }
  | { type: "disconnected" }
  | { type: "video_toggled"; enabled: boolean }
  | { type: "screen_share_toggled"; enabled: boolean }
  | { type: "mute_toggled"; muted: boolean }
  | { type: "deafen_toggled"; deafened: boolean }
  | { type: "soundboard_played"; userId: string; username: string; soundName: string };

type VoiceListener = (event: VoiceEvent) => void;

class VoiceService {
  private roomId: string | null = null;
  private localStream: MediaStream | null = null;
  private peers: Map<string, SimplePeer.Instance> = new Map();
  private remoteStreams: Map<string, MediaStream> = new Map();
  private participants: Map<string, VoiceParticipant> = new Map();
  private signalingEs: EventSource | null = null;
  private listeners: Set<VoiceListener> = new Set();
  private isMuted = false;
  private isDeafened = false;
  private isVideoOn = false;
  private isScreenSharing = false;
  private screenStream: MediaStream | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private speakingAnalyser: { userId: string; analyser: AnalyserNode; ctx: AudioContext } | null = null;
  private speakingInterval: NodeJS.Timeout | null = null;
  private speakingState: Map<string, boolean> = new Map();

  private myUserId: string = "";

  setUserId(userId: string) {
    this.myUserId = userId;
    try {
      sessionStorage.setItem("serika-user-id", userId);
    } catch {
      // ignore
    }
  }

  subscribe(fn: VoiceListener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private emit(event: VoiceEvent) {
    this.listeners.forEach((fn) => fn(event));
  }

  private emitParticipants() {
    const list = Array.from(this.participants.values()).map((p) => ({
      ...p,
      stream: this.remoteStreams.get(p.userId),
    }));
    this.emit({ type: "participants_changed", participants: list });
  }

  async joinChannel(channelId: string, withVideo = false): Promise<void> {
    // Already connected to this exact room — just re-emit current state so UI syncs
    if (this.roomId === channelId) {
      this.emit({ type: "connected" });
      this.emitParticipants();
      return;
    }
    if (this.roomId) await this.leaveChannel();

    this.roomId = channelId;
    this.isMuted = false;
    this.isDeafened = false;
    this.isScreenSharing = false;

    // Get mic (and optionally camera)
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: withVideo ? { width: 1280, height: 720 } : false,
      });
      this.isVideoOn = withVideo;
    } catch {
      this.emit({ type: "error", message: "Microphone/camera access denied." });
      this.roomId = null;
      return;
    }

    // Register with server
    try {
      const joinRes = await fetch(`/api/voice/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: channelId, audio: true, video: withVideo }),
      });
      if (!joinRes.ok) {
        throw new Error(`join failed: ${joinRes.status}`);
      }
    } catch {
      this.localStream?.getTracks().forEach((t) => t.stop());
      this.localStream = null;
      this.isVideoOn = false;
      this.roomId = null;
      this.emit({ type: "error", message: "Could not connect to voice. Please try again." });
      return;
    }

    // Connect SSE signaling
    this.connectSignaling(channelId);
    this.startSpeakingDetection();
    this.emit({ type: "connected" });
  }

  private connectSignaling(roomId: string) {
    if (this.signalingEs) {
      this.signalingEs.close();
    }

    this.signalingEs = new EventSource(`/api/voice/signal/${roomId}`);

    this.signalingEs.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        this.handleSignalingMessage(msg);
      } catch {
        // ignore parse errors
      }
    };

    this.signalingEs.onerror = () => {
      if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = setTimeout(() => {
        if (this.roomId) this.connectSignaling(this.roomId);
      }, 3000);
    };
  }

  private handleSignalingMessage(msg: Record<string, unknown>) {
    switch (msg.type) {
      case "voice:state": {
        // Server tells us our own id for reliable self-identification
        if (msg.self) this.myUserId = msg.self as string;
        const parts = (msg.participants as VoiceParticipant[]) || [];
        this.participants = new Map(parts.map((p) => [p.userId, p]));
        // We are the newcomer: initiate connections to all existing participants.
        // Existing members will receive our offer and create non-initiator peers.
        parts.forEach((p) => {
          if (p.userId !== this.getMyUserId()) {
            this.createPeer(p.userId, true);
          }
        });
        this.emitParticipants();
        break;
      }
      case "voice:participant_joined": {
        const p = msg.participant as VoiceParticipant;
        if (p.userId === this.getMyUserId()) break;
        this.participants.set(p.userId, p);
        // Do NOT initiate here — the newcomer initiates to us, and their offer
        // will arrive via voice:offer which creates the non-initiator peer.
        // This avoids WebRTC glare (both sides initiating).
        this.emitParticipants();
        break;
      }
      case "voice:participant_left": {
        const userId = msg.userId as string;
        this.participants.delete(userId);
        this.destroyPeer(userId);
        this.remoteStreams.delete(userId);
        this.emitParticipants();
        break;
      }
      case "voice:offer": {
        const fromUserId = msg.fromUserId as string;
        if (!this.peers.has(fromUserId)) {
          this.createPeer(fromUserId, false);
        }
        const peer = this.peers.get(fromUserId);
        if (peer) peer.signal(msg.signal as SimplePeer.SignalData);
        break;
      }
      case "voice:answer": {
        const fromUserId = msg.fromUserId as string;
        const peer = this.peers.get(fromUserId);
        if (peer) peer.signal(msg.signal as SimplePeer.SignalData);
        break;
      }
      case "voice:ice": {
        const fromUserId = msg.fromUserId as string;
        const peer = this.peers.get(fromUserId);
        if (peer) peer.signal(msg.candidate as SimplePeer.SignalData);
        break;
      }
      case "voice:soundboard": {
        // Another participant played a soundboard sound
        const soundUrl = msg.soundUrl as string;
        const soundName = (msg.soundName as string) || "Sound";
        const fromUserId = msg.userId as string;
        const username = (msg.username as string) || "Someone";
        const volume = typeof msg.volume === "number" ? msg.volume : 100;
        this.playSoundboardAudio(soundUrl, volume);
        this.emit({ type: "soundboard_played", userId: fromUserId, username, soundName });
        break;
      }
      case "voice:state_update": {
        const userId = msg.userId as string;
        const participant = this.participants.get(userId);
        if (participant) {
          if (msg.audio !== undefined) participant.audio = msg.audio as boolean;
          if (msg.deafened !== undefined) participant.deafened = msg.deafened as boolean;
          if (msg.video !== undefined) participant.video = msg.video as boolean;
          if (msg.screenShare !== undefined) participant.screenShare = msg.screenShare as boolean;
          this.emitParticipants();
        }
        break;
      }
      case "voice:speaking": {
        const userId = msg.userId as string;
        const speaking = msg.speaking as boolean;
        this.speakingState.set(userId, speaking);
        this.emit({ type: "speaking", userId, speaking });
        break;
      }
    }
  }

  private getMyUserId(): string {
    if (this.myUserId) return this.myUserId;
    try {
      const stored = sessionStorage.getItem("serika-user-id") || "";
      return stored;
    } catch {
      return "";
    }
  }

  private createPeer(targetUserId: string, initiator: boolean) {
    if (this.peers.has(targetUserId)) return;
    if (!this.localStream || !this.roomId) return;

    const peer = new SimplePeer({
      initiator,
      stream: this.localStream,
      trickle: true,
      config: {
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      },
    });

    peer.on("signal", (signal) => {
      const endpoint = initiator ? "offer" : "answer";
      fetch(`/api/voice/signal/${this.roomId}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId, signal }),
      });
    });

    peer.on("stream", (stream) => {
      // Respect an active deafen for streams that arrive after toggling
      stream.getAudioTracks().forEach((t) => {
        t.enabled = !this.isDeafened;
      });
      this.remoteStreams.set(targetUserId, stream);
      this.emitParticipants();
    });

    peer.on("error", () => {
      this.destroyPeer(targetUserId);
    });

    peer.on("close", () => {
      this.destroyPeer(targetUserId);
    });

    this.peers.set(targetUserId, peer);
  }

  private destroyPeer(userId: string) {
    const peer = this.peers.get(userId);
    if (peer) {
      try { peer.destroy(); } catch { /* ignore */ }
      this.peers.delete(userId);
    }
  }

  async leaveChannel() {
    if (!this.roomId) return;

    const roomId = this.roomId;
    this.roomId = null;

    // Stop screen share
    this.stopScreenShare();
    this.stopSpeakingDetection();

    // Stop local stream
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }
    this.isVideoOn = false;

    // Destroy all peers
    this.peers.forEach((_, userId) => this.destroyPeer(userId));
    this.peers.clear();
    this.remoteStreams.clear();
    this.participants.clear();

    // Close SSE
    if (this.signalingEs) {
      this.signalingEs.close();
      this.signalingEs = null;
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    // Notify server
    await fetch("/api/voice/leave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId }),
    }).catch(() => {});

    this.emit({ type: "disconnected" });
    this.emitParticipants();
  }

  private startSpeakingDetection() {
    this.stopSpeakingDetection();
    this.speakingInterval = setInterval(() => {
      // Check local stream
      if (this.localStream && !this.isMuted) {
        const audioTracks = this.localStream.getAudioTracks();
        if (audioTracks.length > 0 && audioTracks[0].enabled) {
          try {
            if (!this.speakingAnalyser || this.speakingAnalyser.userId !== "local") {
              const ctx = new AudioContext();
              const source = ctx.createMediaStreamSource(this.localStream);
              const analyser = ctx.createAnalyser();
              analyser.fftSize = 256;
              source.connect(analyser);
              this.speakingAnalyser = { userId: "local", analyser, ctx };
            }
            const data = new Uint8Array(this.speakingAnalyser.analyser.frequencyBinCount);
            this.speakingAnalyser.analyser.getByteFrequencyData(data);
            const avg = data.reduce((a, b) => a + b, 0) / data.length;
            const isSpeaking = avg > 20;
            const wasSpeaking = this.speakingState.get("local") || false;
            if (isSpeaking !== wasSpeaking) {
              this.speakingState.set("local", isSpeaking);
              this.emit({ type: "speaking", userId: this.getMyUserId(), speaking: isSpeaking });
              // Broadcast to other peers via server
              if (this.roomId) {
                fetch(`/api/voice/speaking/${this.roomId}`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ speaking: isSpeaking }),
                }).catch(() => {});
              }
            }
          } catch {
            // AudioContext may fail in some browsers
          }
        }
      }

      // Check remote streams
      this.remoteStreams.forEach((stream, userId) => {
        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length > 0 && audioTracks[0].enabled) {
          try {
            // Create a fresh analyser for each remote stream
            const ctx = new AudioContext();
            const source = ctx.createMediaStreamSource(stream);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);
            const data = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteFrequencyData(data);
            const avg = data.reduce((a, b) => a + b, 0) / data.length;
            const isSpeaking = avg > 20;
            const wasSpeaking = this.speakingState.get(userId) || false;
            if (isSpeaking !== wasSpeaking) {
              this.speakingState.set(userId, isSpeaking);
              this.emit({ type: "speaking", userId, speaking: isSpeaking });
            }
            ctx.close();
          } catch {
            // ignore
          }
        }
      });
    }, 100);
  }

  private stopSpeakingDetection() {
    if (this.speakingInterval) {
      clearInterval(this.speakingInterval);
      this.speakingInterval = null;
    }
    if (this.speakingAnalyser) {
      try { this.speakingAnalyser.ctx.close(); } catch { /* ignore */ }
      this.speakingAnalyser = null;
    }
    this.speakingState.clear();
  }

  toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((t) => {
        t.enabled = !this.isMuted;
      });
    }
    if (this.roomId) {
      fetch(`/api/voice/state/${this.roomId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: !this.isMuted }),
      }).catch(() => {});
    }
    this.emit({ type: "mute_toggled", muted: this.isMuted });
    return this.isMuted;
  }

  toggleDeafen(): boolean {
    this.isDeafened = !this.isDeafened;
    // Mute remote streams when deafened
    this.remoteStreams.forEach((stream) => {
      stream.getAudioTracks().forEach((t) => {
        t.enabled = !this.isDeafened;
      });
    });
    // If deafening, also mute
    if (this.isDeafened && !this.isMuted) {
      this.isMuted = true;
      if (this.localStream) {
        this.localStream.getAudioTracks().forEach((t) => {
          t.enabled = false;
        });
      }
      this.emit({ type: "mute_toggled", muted: true });
    }
    if (this.roomId) {
      fetch(`/api/voice/state/${this.roomId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deafened: this.isDeafened, audio: !this.isMuted }),
      }).catch(() => {});
    }
    this.emit({ type: "deafen_toggled", deafened: this.isDeafened });
    return this.isDeafened;
  }

  async toggleVideo(): Promise<boolean> {
    if (!this.localStream || !this.roomId) return false;

    if (this.isVideoOn) {
      // Turn off video
      this.localStream.getVideoTracks().forEach((t) => {
        t.stop();
        this.localStream?.removeTrack(t);
      });
      this.isVideoOn = false;
      // Update peers - replaceStream will remove video track
      this.peers.forEach((peer) => {
        try { (peer as unknown as { replaceStream: (s: MediaStream) => void }).replaceStream(this.localStream!); } catch { /* ignore */ }
      });
    } else {
      // Turn on video
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720 },
          audio: false,
        });
        const videoTrack = videoStream.getVideoTracks()[0];
        if (videoTrack) {
          this.localStream.addTrack(videoTrack);
          this.isVideoOn = true;
          // Update peers - add track or replace stream
          this.peers.forEach((peer) => {
            try { (peer as unknown as { addTrack: (t: MediaStreamTrack, s: MediaStream) => void }).addTrack(videoTrack, this.localStream!); } catch {
              try { (peer as unknown as { replaceStream: (s: MediaStream) => void }).replaceStream(this.localStream!); } catch { /* ignore */ }
            }
          });
        }
      } catch {
        this.emit({ type: "error", message: "Camera access denied." });
        return false;
      }
    }

    // Update server state
    await fetch(`/api/voice/state/${this.roomId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ video: this.isVideoOn }),
    }).catch(() => {});

    this.emit({ type: "video_toggled", enabled: this.isVideoOn });
    return this.isVideoOn;
  }

  async startScreenShare(): Promise<boolean> {
    if (!this.roomId) return false;

    try {
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: "always" } as MediaTrackConstraints,
        audio: false,
      });
      this.isScreenSharing = true;

      const screenTrack = this.screenStream.getVideoTracks()[0];
      if (screenTrack) {
        screenTrack.onended = () => {
          this.stopScreenShare();
        };

        // Add screen track to all peers
        this.peers.forEach((peer) => {
          try { (peer as unknown as { addTrack: (t: MediaStreamTrack, s: MediaStream) => void }).addTrack(screenTrack, this.screenStream!); } catch { /* ignore */ }
        });
      }

      // Notify server
      await fetch(`/api/voice/state/${this.roomId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ screenShare: true }),
      }).catch(() => {});

      this.emit({ type: "screen_share_toggled", enabled: true });
      return true;
    } catch {
      this.emit({ type: "error", message: "Screen share permission denied." });
      return false;
    }
  }

  stopScreenShare() {
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
    }
    if (this.isScreenSharing && this.roomId) {
      this.isScreenSharing = false;
      fetch(`/api/voice/state/${this.roomId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ screenShare: false }),
      }).catch(() => {});
      this.emit({ type: "screen_share_toggled", enabled: false });
    }
  }

  // Local playback for soundboard sounds; respects deafen and clamps volume.
  private playSoundboardAudio(url: string, volumePercent: number) {
    if (this.isDeafened) return;
    try {
      const audio = new Audio(url);
      audio.volume = Math.min(Math.max(volumePercent, 0) / 100, 1);
      void audio.play().catch(() => { /* autoplay blocked; ignore */ });
    } catch {
      // Invalid URL or unsupported format — nothing to play
    }
  }

  /**
   * Play a soundboard sound in the current voice room: hear it locally and
   * broadcast it so every other participant hears it too.
   */
  async playSoundboardSound(sound: { url: string; name: string }): Promise<boolean> {
    if (!this.roomId) return false;
    try {
      const res = await fetch(`/api/voice/soundboard/${this.roomId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ soundUrl: sound.url, soundName: sound.name }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        this.emit({ type: "error", message: data?.error || "Failed to play sound" });
        return false;
      }
      const data = await res.json().catch(() => null);
      this.playSoundboardAudio(sound.url, typeof data?.volume === "number" ? data.volume : 100);
      return true;
    } catch {
      this.emit({ type: "error", message: "Failed to play sound. Check your connection." });
      return false;
    }
  }

  get muted() { return this.isMuted; }
  get deafened() { return this.isDeafened; }
  get videoOn() { return this.isVideoOn; }
  get screenSharing() { return this.isScreenSharing; }
  get connected() { return this.roomId !== null; }
  isConnectedTo(roomId: string) { return this.roomId === roomId; }
  get currentRoomId() { return this.roomId; }
  get currentParticipants(): VoiceParticipant[] {
    return Array.from(this.participants.values()).map((p) => ({
      ...p,
      stream: this.remoteStreams.get(p.userId),
    }));
  }
  get localAudioStream() { return this.localStream; }
  get localStream_() { return this.localStream; }
  get screenShareStream() { return this.screenStream; }
}

export const voiceService = new VoiceService();
