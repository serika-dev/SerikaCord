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
}

export type VoiceEvent =
  | { type: "participants_changed"; participants: VoiceParticipant[] }
  | { type: "speaking"; userId: string; speaking: boolean }
  | { type: "error"; message: string }
  | { type: "connected" }
  | { type: "disconnected" };

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
  private reconnectTimeout: NodeJS.Timeout | null = null;

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

  async joinChannel(channelId: string): Promise<void> {
    if (this.roomId === channelId) return;
    if (this.roomId) await this.leaveChannel();

    this.roomId = channelId;

    // Get mic
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    } catch {
      this.emit({ type: "error", message: "Microphone access denied." });
      this.roomId = null;
      return;
    }

    // Register with server
    await fetch(`/api/voice/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId: channelId, audio: true, video: false }),
    });

    // Connect SSE signaling
    this.connectSignaling(channelId);
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
        const parts = (msg.participants as VoiceParticipant[]) || [];
        this.participants = new Map(parts.map((p) => [p.userId, p]));
        // Initiate peer connections with existing participants
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
        this.participants.set(p.userId, p);
        // They joined after us — we initiate
        this.createPeer(p.userId, true);
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
      case "voice:state_update": {
        const userId = msg.userId as string;
        const participant = this.participants.get(userId);
        if (participant) {
          if (msg.audio !== undefined) participant.audio = msg.audio as boolean;
          if (msg.deafened !== undefined) participant.deafened = msg.deafened as boolean;
          this.emitParticipants();
        }
        break;
      }
    }
  }

  private getMyUserId(): string {
    // Read from local storage as a fallback — the chat app stores user there
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

    // Stop local stream
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }

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
    if (this.roomId) {
      fetch(`/api/voice/state/${this.roomId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deafened: this.isDeafened }),
      }).catch(() => {});
    }
    return this.isDeafened;
  }

  get muted() { return this.isMuted; }
  get deafened() { return this.isDeafened; }
  get currentRoomId() { return this.roomId; }
  get currentParticipants(): VoiceParticipant[] {
    return Array.from(this.participants.values()).map((p) => ({
      ...p,
      stream: this.remoteStreams.get(p.userId),
    }));
  }
  get localAudioStream() { return this.localStream; }
}

export const voiceService = new VoiceService();
