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
  // Screen share arrives as a SEPARATE MediaStream from the mic/camera stream,
  // so it's tracked independently and never clobbers `stream` (which carries
  // the audio the AudioSink plays).
  screenStream?: MediaStream;
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
  private remoteScreenStreams: Map<string, MediaStream> = new Map();
  private participants: Map<string, VoiceParticipant> = new Map();
  private signalingEs: EventSource | null = null;
  private listeners: Set<VoiceListener> = new Set();
  // ICE servers (STUN + any server-configured TURN). Overwritten from
  // /api/voice/token on join; falls back to public STUN if the fetch fails.
  private iceServers: RTCIceServer[] = [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  ];
  private isMuted = false;
  private isDeafened = false;
  private isVideoOn = false;
  private isScreenSharing = false;
  private screenStream: MediaStream | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private speakingAnalysers: Map<string, { analyser: AnalyserNode; ctx: AudioContext }> = new Map();
  private speakingInterval: NodeJS.Timeout | null = null;
  private speakingState: Map<string, boolean> = new Map();

  // User-configurable audio constraints (updated from settings before join)
  private audioConstraints: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };

  setAudioConstraints(constraints: Partial<MediaTrackConstraints>) {
    this.audioConstraints = { ...this.audioConstraints, ...constraints };
  }

  // Personal soundboard playback volume (0–200%), a local preference set from
  // the user's Voice & Video settings. Combined with the server's configured
  // volume when a sound plays.
  private soundboardVolume = 100;

  setSoundboardVolume(percent: number) {
    if (Number.isFinite(percent)) {
      this.soundboardVolume = Math.min(Math.max(percent, 0), 200);
    }
  }

  // Noise suppression chain
  private noiseSuppressionOn = false;
  private noiseCtx: AudioContext | null = null;
  private noiseHighPass: BiquadFilterNode | null = null;
  private noiseGate: GainNode | null = null;
  private noiseAnalyser: AnalyserNode | null = null;
  private noiseInterval: NodeJS.Timeout | null = null;
  private processedStream: MediaStream | null = null;

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
    const list = Array.from(this.participants.values())
      .map((p) => ({
        ...p,
        stream: this.remoteStreams.get(p.userId),
        screenStream: this.remoteScreenStreams.get(p.userId),
        // Reflect an actually-received screen stream so the UI renders the tile
        // even if the state_update flag hasn't arrived yet.
        screenShare: p.screenShare || this.remoteScreenStreams.has(p.userId),
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
        audio: this.audioConstraints,
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

    // Fetch ICE servers (STUN + any configured TURN relay) before we start
    // creating peers, so the WebRTC connections can actually traverse NAT.
    try {
      const tokenRes = await fetch(`/api/voice/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: channelId }),
      });
      if (tokenRes.ok) {
        const data = await tokenRes.json();
        if (Array.isArray(data.iceServers) && data.iceServers.length) {
          this.iceServers = data.iceServers as RTCIceServer[];
        }
      }
    } catch {
      // Keep the STUN fallback already set.
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
        this.remoteScreenStreams.delete(userId);
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
          if (msg.screenShare !== undefined) {
            participant.screenShare = msg.screenShare as boolean;
            // Sharer stopped: drop their screen stream so the tile disappears.
            if (msg.screenShare === false) {
              this.remoteScreenStreams.delete(userId);
            }
          }
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
        // Use the ICE servers fetched from /api/voice/token — this includes the
        // configured TURN relay, which is REQUIRED for two peers that can't reach
        // each other directly (different NATs/firewalls). Previously this was
        // hardcoded to public STUN only, so cross-network calls never connected
        // and the two clients couldn't hear or see each other.
        iceServers: this.iceServers,
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
      // The first stream from a peer is their primary mic/camera. Any later
      // stream is a screen share (getDisplayMedia produces a distinct stream),
      // so it must NOT overwrite the primary stream — otherwise remote audio
      // breaks and the camera tile disappears.
      if (!this.remoteStreams.has(targetUserId)) {
        this.remoteStreams.set(targetUserId, stream);
      } else {
        this.remoteScreenStreams.set(targetUserId, stream);
        // When the screen stream's track ends (sharer stopped), drop it.
        stream.getVideoTracks().forEach((t) => {
          t.addEventListener("ended", () => {
            this.remoteScreenStreams.delete(targetUserId);
            this.emitParticipants();
          });
        });
      }
      this.emitParticipants();
    });

    // Handle individual tracks that arrive via addTrack (screen share).
    // simple-peer's addTrack may fire a 'track' event WITHOUT a corresponding
    // 'stream' event, depending on browser/WebRTC implementation. Without this
    // listener, screen share tracks are silently dropped on the remote side.
    peer.on("track", (track: MediaStreamTrack, stream: MediaStream) => {
      if (track.kind === "video") {
        // If this track is part of the primary stream, it's the camera — not a screen share.
        const primary = this.remoteStreams.get(targetUserId);
        if (primary && stream.id === primary.id) return;
        // Also skip if the track is already in the primary stream
        if (primary && primary.getTracks().includes(track)) return;

        // This is a screen share video track — store it in a MediaStream for the UI.
        if (!this.remoteScreenStreams.has(targetUserId)) {
          const screenStream = new MediaStream([track]);
          this.remoteScreenStreams.set(targetUserId, screenStream);
          track.addEventListener("ended", () => {
            this.remoteScreenStreams.delete(targetUserId);
            this.emitParticipants();
          });
          this.emitParticipants();
        }
      } else if (track.kind === "audio") {
        // Audio track arriving outside a stream event — add to existing or
        // create a new primary stream. Skip if it's part of the primary stream.
        const primary = this.remoteStreams.get(targetUserId);
        if (primary && stream.id === primary.id) return;
        if (primary && primary.getTracks().includes(track)) return;

        if (this.remoteStreams.has(targetUserId)) {
          this.remoteStreams.get(targetUserId)!.addTrack(track);
        } else {
          const newStream = new MediaStream([track]);
          track.enabled = !this.isDeafened;
          this.remoteStreams.set(targetUserId, newStream);
        }
        this.emitParticipants();
      }
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
    this.cleanupNoiseSuppression();

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
    this.remoteScreenStreams.clear();
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
            if (!this.speakingAnalysers.has("local")) {
              const ctx = new AudioContext();
              const source = ctx.createMediaStreamSource(this.localStream);
              const analyser = ctx.createAnalyser();
              analyser.fftSize = 256;
              source.connect(analyser);
              this.speakingAnalysers.set("local", { analyser, ctx });
            }
            const entry = this.speakingAnalysers.get("local")!;
            const data = new Uint8Array(entry.analyser.frequencyBinCount);
            entry.analyser.getByteFrequencyData(data);
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

      // Check remote streams using persistent analysers
      this.remoteStreams.forEach((stream, userId) => {
        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length === 0 || !audioTracks[0].enabled) return;
        try {
          if (!this.speakingAnalysers.has(userId)) {
            const ctx = new AudioContext();
            const source = ctx.createMediaStreamSource(stream);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);
            this.speakingAnalysers.set(userId, { analyser, ctx });
          }
          const entry = this.speakingAnalysers.get(userId)!;
          const data = new Uint8Array(entry.analyser.frequencyBinCount);
          entry.analyser.getByteFrequencyData(data);
          const avg = data.reduce((a, b) => a + b, 0) / data.length;
          const isSpeaking = avg > 20;
          const wasSpeaking = this.speakingState.get(userId) || false;
          if (isSpeaking !== wasSpeaking) {
            this.speakingState.set(userId, isSpeaking);
            this.emit({ type: "speaking", userId, speaking: isSpeaking });
          }
        } catch {
          // ignore
        }
      });

      // Clean up analysers for streams that no longer exist
      for (const key of this.speakingAnalysers.keys()) {
        if (key === "local") continue;
        if (!this.remoteStreams.has(key)) {
          const entry = this.speakingAnalysers.get(key);
          try { entry?.ctx.close(); } catch { /* ignore */ }
          this.speakingAnalysers.delete(key);
          this.speakingState.delete(key);
        }
      }
    }, 100);
  }

  private stopSpeakingDetection() {
    if (this.speakingInterval) {
      clearInterval(this.speakingInterval);
      this.speakingInterval = null;
    }
    this.speakingAnalysers.forEach((entry) => {
      try { entry.ctx.close(); } catch { /* ignore */ }
    });
    this.speakingAnalysers.clear();
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

  get noiseSuppressionEnabled(): boolean {
    return this.noiseSuppressionOn;
  }

  toggleNoiseSuppression(): boolean {
    if (this.noiseSuppressionOn) {
      this.disableNoiseSuppression();
    } else {
      this.enableNoiseSuppression();
    }
    return this.noiseSuppressionOn;
  }

  private enableNoiseSuppression() {
    if (!this.localStream || this.noiseSuppressionOn) return;
    try {
      const audioTracks = this.localStream.getAudioTracks();
      if (audioTracks.length === 0) return;

      this.noiseCtx = new AudioContext();
      const source = this.noiseCtx.createMediaStreamSource(this.localStream);

      // High-pass filter at 85Hz — removes low-frequency hum/rumble
      this.noiseHighPass = this.noiseCtx.createBiquadFilter();
      this.noiseHighPass.type = "highpass";
      this.noiseHighPass.frequency.value = 85;

      // Noise gate — a GainNode that we dynamically control based on input level
      this.noiseGate = this.noiseCtx.createGain();
      this.noiseGate.gain.value = 0;

      // Analyser to measure input level for the noise gate
      this.noiseAnalyser = this.noiseCtx.createAnalyser();
      this.noiseAnalyser.fftSize = 512;

      // Chain: source -> highpass -> analyser -> gate -> destination
      source.connect(this.noiseHighPass);
      this.noiseHighPass.connect(this.noiseAnalyser);
      this.noiseAnalyser.connect(this.noiseGate);
      this.noiseGate.connect(this.noiseCtx.destination);

      // Noise gate loop: open gate when signal above threshold, close when below
      const GATE_OPEN = 1.0;
      const GATE_CLOSED = 0.0;
      const OPEN_THRESHOLD = 8;
      const CLOSE_THRESHOLD = 3;
      let gateOpen = false;

      this.noiseInterval = setInterval(() => {
        if (!this.noiseAnalyser || !this.noiseGate || !this.noiseCtx) return;
        const data = new Uint8Array(this.noiseAnalyser.frequencyBinCount);
        this.noiseAnalyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;

        if (!gateOpen && avg > OPEN_THRESHOLD) {
          gateOpen = true;
          this.noiseGate.gain.setTargetAtTime(GATE_OPEN, this.noiseCtx.currentTime, 0.01);
        } else if (gateOpen && avg < CLOSE_THRESHOLD) {
          gateOpen = false;
          this.noiseGate.gain.setTargetAtTime(GATE_CLOSED, this.noiseCtx.currentTime, 0.05);
        }
      }, 30);

      // Create a processed stream from the AudioContext destination
      const dest = this.noiseCtx.createMediaStreamDestination();
      this.noiseGate.connect(dest);
      this.processedStream = dest.stream;

      // Replace the audio track in localStream with the processed one
      const processedTrack = this.processedStream.getAudioTracks()[0];
      if (processedTrack) {
        const oldTrack = audioTracks[0];
        this.localStream.removeTrack(oldTrack);
        this.localStream.addTrack(processedTrack);

        // Update all peers with the new track
        this.peers.forEach((peer) => {
          try {
            (peer as unknown as { replaceTrack: (oldT: MediaStreamTrack, newT: MediaStreamTrack, stream: MediaStream) => void })
              .replaceTrack(oldTrack, processedTrack, this.localStream!);
          } catch {
            // Fallback: addTrack/removeTrack
            try { peer.addTrack(processedTrack, this.localStream!); } catch { /* ignore */ }
          }
        });

        // Keep old track alive but muted (don't stop it — we may need to revert)
        oldTrack.enabled = false;
      }

      this.noiseSuppressionOn = true;
    } catch {
      // AudioContext or Web Audio API not available
      this.cleanupNoiseSuppression();
    }
  }

  private disableNoiseSuppression() {
    if (!this.noiseSuppressionOn || !this.localStream) {
      this.cleanupNoiseSuppression();
      return;
    }

    try {
      // Restore the original audio track
      const processedTracks = this.localStream.getAudioTracks();
      const processedTrack = processedTracks.find(t => t.label === "" || t.id !== this.localStream?.getAudioTracks()[0]?.id);

      // We need the original track back — re-acquire it from getUserMedia
      // since we can't easily reverse the Web Audio processing
      navigator.mediaDevices.getUserMedia({
        audio: this.audioConstraints,
        video: false,
      }).then((origStream) => {
        const origTrack = origStream.getAudioTracks()[0];
        if (origTrack && this.localStream) {
          // Remove all current audio tracks
          this.localStream.getAudioTracks().forEach((t) => {
            this.localStream?.removeTrack(t);
            t.stop();
          });
          this.localStream.addTrack(origTrack);

          // Update peers
          this.peers.forEach((peer) => {
            try {
              this.localStream?.getAudioTracks().forEach((newT) => {
                peer.addTrack(newT, this.localStream!);
              });
            } catch { /* ignore */ }
          });

          // Apply current mute state
          origTrack.enabled = !this.isMuted;
        }
        this.cleanupNoiseSuppression();
      }).catch(() => {
        this.cleanupNoiseSuppression();
      });
    } catch {
      this.cleanupNoiseSuppression();
    }
  }

  private cleanupNoiseSuppression() {
    if (this.noiseInterval) {
      clearInterval(this.noiseInterval);
      this.noiseInterval = null;
    }
    if (this.noiseCtx) {
      try { this.noiseCtx.close(); } catch { /* ignore */ }
      this.noiseCtx = null;
    }
    this.noiseHighPass = null;
    this.noiseGate = null;
    this.noiseAnalyser = null;
    this.processedStream = null;
    this.noiseSuppressionOn = false;
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

    // getDisplayMedia is unavailable on most mobile browsers (iOS Safari has no
    // support at all). Surface a clear message instead of a generic "denied".
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
      this.emit({ type: "error", message: "Screen sharing isn't supported on this device or browser." });
      return false;
    }

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
    } catch (err) {
      // Distinguish an explicit user cancel from a real failure so the UI can
      // stay quiet on cancel but report actual errors.
      const name = (err as { name?: string })?.name;
      if (name === "NotAllowedError" || name === "AbortError") {
        // User dismissed the picker — not an error worth surfacing loudly.
        this.emit({ type: "screen_share_toggled", enabled: false });
      } else {
        this.emit({ type: "error", message: `Could not start screen share${name ? ` (${name})` : ""}.` });
      }
      this.screenStream = null;
      this.isScreenSharing = false;
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
      // Combine the server-configured volume with the user's personal
      // soundboard volume (both 0–200%), then clamp to the 0–1 media range.
      const combined = (Math.max(volumePercent, 0) / 100) * (this.soundboardVolume / 100);
      audio.volume = Math.min(Math.max(combined, 0), 1);
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
  get myId() { return this.getMyUserId(); }
  /** Snapshot of who is currently speaking (userId -> speaking). */
  get speakingSnapshot(): Map<string, boolean> { return new Map(this.speakingState); }
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
      screenStream: this.remoteScreenStreams.get(p.userId),
      screenShare: p.screenShare || this.remoteScreenStreams.has(p.userId),
    }));
  }
  get localAudioStream() { return this.localStream; }
  get localStream_() { return this.localStream; }
  get screenShareStream() { return this.screenStream; }
}

export const voiceService = new VoiceService();
