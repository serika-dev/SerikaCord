import type SimplePeer from "simple-peer";
import { isPttKeyEvent, normalizePttKey, readVoiceCallSettings, shouldTransmit, DEFAULT_PTT_KEY } from "@/lib/voice/settings";
import { isPolitePeer, peerRetryDelayMs, signalRetryDelayMs } from "@/lib/voice/callState";
import { isListenOnlyError, mediaAttempts, mediaOutcome, micIssue, type MicIssue } from "@/lib/voice/media";
import {
  DEFAULT_SENSITIVITY_DB,
  amplitudeToDb,
  clampSensitivityDb,
  createVoiceGateState,
  rmsFromByteTimeDomain,
  stepVoiceGate,
  type VoiceGateState,
} from "@/lib/voice/voiceActivity";
import { deviceConstraint, getPreferredDevice } from "@/lib/voice/devices";
import {
  displayMediaVideoConstraints,
  loadStreamQuality,
  normalizeStreamQuality,
  streamContentHint,
  streamMaxBitrate,
  type StreamQuality,
} from "@/lib/voice/streamQuality";

// simple-peer (+ its stream polyfills, ~95KB) is only needed once you join
// voice, so it's loaded then instead of with every page.
let SimplePeerCtor: typeof SimplePeer | null = null;
async function loadSimplePeer(): Promise<typeof SimplePeer> {
  if (!SimplePeerCtor) SimplePeerCtor = (await import("simple-peer")).default;
  return SimplePeerCtor;
}

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
  /** Which device/tab this participant joined from (a new one replaces the old). */
  sessionId?: string;
  /** Server Mute / Server Deafen set by a moderator. */
  serverMute?: boolean;
  serverDeaf?: boolean;
}

/** One reading of your microphone for level meters and the sensitivity slider. */
export interface InputLevel {
  /** Current mic level, dBFS (-100..0). */
  levelDb: number;
  /** The voice activity threshold in effect, dBFS. */
  thresholdDb: number;
  /** The voice activity gate is open (your voice is above the threshold). */
  gateOpen: boolean;
  /** Your mic is actually being sent right now. */
  transmitting: boolean;
}

/**
 * Why voice failed, so the UI can show a translated, specific message.
 * `message` on the error event stays as an English fallback.
 */
export type VoiceErrorCode =
  | "mic-denied"
  | "mic-missing"
  | "mic-busy"
  | "insecure"
  | "camera-denied"
  | "room-full"
  | "call-blocked"
  | "join-failed"
  | "disconnected"
  | "moved"
  | "kicked"
  | "screen-unsupported"
  | "screen-failed"
  | "soundboard";

/** What the voice bar shows for the current room and where it links back to. */
export interface VoiceRoomMeta {
  label?: string;
  href?: string;
}

export type VoiceEvent =
  | { type: "participants_changed"; participants: VoiceParticipant[] }
  | { type: "speaking"; userId: string; speaking: boolean }
  | { type: "error"; message: string; code?: VoiceErrorCode }
  | { type: "connected" }
  | { type: "disconnected" }
  | { type: "video_toggled"; enabled: boolean }
  | { type: "screen_share_toggled"; enabled: boolean }
  | { type: "mute_toggled"; muted: boolean }
  | { type: "deafen_toggled"; deafened: boolean }
  | { type: "soundboard_played"; userId: string; username: string; soundName: string }
  | { type: "call_declined"; userId: string }
  /** No usable mic: in the call listen-only (others can't hear you), or back to normal. */
  | { type: "listen_only"; enabled: boolean; reason?: MicIssue }
  | { type: "meta_changed" }
  /** Push-to-talk mode or key changed (the desktop app re-registers its global key). */
  | { type: "push_to_talk_changed" }
  /** A moderator server-muted/deafened you (or lifted it). */
  | { type: "server_voice_state"; mute: boolean; deaf: boolean }
  /** A moderator moved you to another voice channel. */
  | { type: "moved_by_moderator"; channelName: string }
  /** Screen share resolution / frame rate changed. */
  | { type: "stream_quality_changed"; quality: StreamQuality };

type VoiceListener = (event: VoiceEvent) => void;

function newSessionId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    // fall through
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Map a getUserMedia failure to a specific, user-fixable reason. */
function mediaErrorCode(err: unknown, withVideo: boolean): VoiceErrorCode {
  const name = (err as { name?: string } | null)?.name;
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") return "mic-missing";
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") return "mic-busy";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
    return withVideo ? "camera-denied" : "mic-denied";
  }
  return "mic-denied";
}

const ERROR_FALLBACK: Record<VoiceErrorCode, string> = {
  "mic-denied": "Microphone access was blocked. Allow it in your browser's site settings to join calls.",
  "mic-missing": "No microphone was found. Plug one in and try again.",
  "mic-busy": "Your microphone is being used by another app.",
  insecure: "Voice needs a secure (https) connection.",
  "camera-denied": "Camera access was blocked. Allow it in your browser's site settings.",
  "room-full": "This voice channel is full.",
  "call-blocked": "You can't call this user.",
  "join-failed": "Could not connect to voice. Please try again.",
  disconnected: "Disconnected from voice.",
  moved: "You joined this call on another device.",
  kicked: "A moderator disconnected you from the voice channel.",
  "screen-unsupported": "Screen sharing isn't supported on this device or browser.",
  "screen-failed": "Could not start screen share.",
  soundboard: "Failed to play sound.",
};

type PeerMeta = {
  initiator: boolean;
  /** Our RTCPeerConnection's id, sent with every signal we post. */
  pcId: string;
  /** The remote connection we're paired with (learned from its offer/answer). */
  remotePcId: string | null;
};

type RemoteSignal = Record<string, unknown> & { type?: string };

// Keys typed into a text field must never trigger push-to-talk.
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el !== "object") return false;
  if (el.isContentEditable) return true;
  const tag = typeof el.tagName === "string" ? el.tagName.toUpperCase() : "";
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

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
  // Joined without a microphone (listen-only). Unmuting asks for it again.
  private micMissing = false;
  private micRetry: Promise<boolean> | null = null;
  private isDeafened = false;
  private isVideoOn = false;
  private isScreenSharing = false;
  private screenStream: MediaStream | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  // Identifies this tab's membership. Re-joins after a network blip reuse it so
  // the server treats them as a resume; a join from another device replaces it.
  private sessionId: string | null = null;
  // Bumped by every join/leave so a join still awaiting the mic or the server
  // can tell it was cancelled (hung up mid-dial) and back out.
  private joinSeq = 0;
  private joining: { roomId: string; promise: Promise<void> } | null = null;
  private joined = false;
  private meta: VoiceRoomMeta = {};
  private peerMeta: Map<string, PeerMeta> = new Map();
  // Signals that arrived before we knew which remote connection they belong to.
  private pendingSignals: Map<string, Array<{ pcId: string | null; signal: RemoteSignal }>> = new Map();
  private peerRetryTimers: Map<string, NodeJS.Timeout> = new Map();
  private peerRetryAttempts: Map<string, number> = new Map();
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
    const next = { ...this.audioConstraints, ...constraints };
    const changed = (Object.keys(constraints) as Array<keyof MediaTrackConstraints>)
      .some((k) => this.audioConstraints[k] !== next[k]);
    this.audioConstraints = next;
    if (!changed) return;
    // Mid-call: apply to the live mic track so the change takes effect without
    // rejoining. Only the raw device track accepts these constraints.
    const micTrack = this.inputRawTrack ?? (this.noiseSuppressionOn ? null : this.localStream?.getAudioTracks()[0] ?? null);
    if (micTrack && typeof micTrack.applyConstraints === "function") {
      void micTrack.applyConstraints(this.audioConstraints).catch(() => { /* unsupported; applies next join */ });
    }
  }

  /** getUserMedia audio constraints: processing flags + the chosen microphone. */
  private micConstraints(): MediaTrackConstraints {
    return { ...this.audioConstraints, ...deviceConstraint(getPreferredDevice("input")) };
  }

  /** getUserMedia video constraints for the camera (720p, chosen device). */
  private cameraConstraints(): MediaTrackConstraints {
    return { width: 1280, height: 720, ...deviceConstraint(getPreferredDevice("video")) };
  }

  /** Swap a sent track for every peer (simple-peer keeps its sender map in step). */
  private replaceSentTrack(old: MediaStreamTrack, next: MediaStreamTrack, stream: MediaStream) {
    this.peers.forEach((peer) => {
      try {
        (peer as unknown as { replaceTrack: (o: MediaStreamTrack, n: MediaStreamTrack, s: MediaStream) => void })
          .replaceTrack(old, next, stream);
      } catch { /* not sent to this peer */ }
    });
  }

  /**
   * The chosen microphone changed: mid-call, switch to it without rejoining
   * (input gain and noise suppression are rebuilt around the new device).
   */
  async switchInputDevice(): Promise<boolean> {
    if (!this.localStream || !this.roomId || this.micMissing) return false;
    const roomId = this.roomId;
    let raw: MediaStreamTrack | undefined;
    try {
      const fresh = await navigator.mediaDevices.getUserMedia({ audio: this.micConstraints(), video: false });
      raw = fresh.getAudioTracks()[0];
    } catch {
      return false;
    }
    if (!raw) return false;
    if (this.roomId !== roomId || !this.localStream) {
      raw.stop();
      return false;
    }
    const stream = this.localStream;
    const old = stream.getAudioTracks()[0];
    const hadNoiseSuppression = this.noiseSuppressionOn;
    if (hadNoiseSuppression) this.cleanupNoiseSuppression();
    this.teardownInputGain();
    const sent = this.wrapWithInputGain(raw);
    if (old) {
      this.replaceSentTrack(old, sent, stream);
      stream.removeTrack(old);
      old.stop();
    }
    stream.addTrack(sent);
    if (!old) {
      this.peers.forEach((peer) => {
        try { peer.addTrack(sent, stream); } catch { /* peer closing */ }
      });
    }
    this.applyMicState();
    if (hadNoiseSuppression) this.enableNoiseSuppression();
    return true;
  }

  /** The chosen camera changed: switch the live camera (if on) to it. */
  async switchVideoDevice(): Promise<boolean> {
    if (!this.localStream || !this.isVideoOn) return false;
    const stream = this.localStream;
    let next: MediaStreamTrack | undefined;
    try {
      const fresh = await navigator.mediaDevices.getUserMedia({ video: this.cameraConstraints(), audio: false });
      next = fresh.getVideoTracks()[0];
    } catch {
      this.emitError("camera-denied");
      return false;
    }
    if (!next) return false;
    if (this.localStream !== stream || !this.isVideoOn) {
      next.stop();
      return false;
    }
    const old = stream.getVideoTracks()[0];
    if (old) {
      this.replaceSentTrack(old, next, stream);
      stream.removeTrack(old);
      old.stop();
    }
    stream.addTrack(next);
    this.emit({ type: "video_toggled", enabled: true });
    return true;
  }

  /**
   * Apply the user's saved Voice & Video settings (mic processing,
   * push-to-talk, input/output volume). Safe to call with a partial object.
   */
  applyVoiceSettings(voiceVideo: unknown) {
    const s = readVoiceCallSettings(voiceVideo);
    if (Object.keys(s.constraints).length) this.setAudioConstraints(s.constraints);
    if (s.pushToTalk !== undefined || s.pushToTalkKey !== undefined) {
      this.setPushToTalk(s.pushToTalk ?? this.pttEnabled, s.pushToTalkKey ?? this.pttKey);
    }
    if (s.inputVolume !== undefined) this.setInputVolume(s.inputVolume);
    if (s.outputVolume !== undefined) this.setOutputVolume(s.outputVolume);
    if (s.autoSensitivity !== undefined || s.inputSensitivity !== undefined) {
      this.setInputSensitivity({ auto: s.autoSensitivity, thresholdDb: s.inputSensitivity });
    }
  }

  // -- Input sensitivity (voice activity gate) --------------------------------
  // Outside push-to-talk, the mic only transmits while it hears more than the
  // threshold (Discord's "Input Sensitivity"). The meter runs on a clone of
  // the outgoing mic track, so it keeps hearing you while the gate is closed.
  private autoSensitivity = true;
  private sensitivityDb = DEFAULT_SENSITIVITY_DB;
  private gateState: VoiceGateState = createVoiceGateState();
  private voiceGateOpen = true;
  private meterCtx: AudioContext | null = null;
  private meterAnalyser: AnalyserNode | null = null;
  private meterTrack: MediaStreamTrack | null = null;
  private meterSourceId: string | null = null;
  private meterInterval: ReturnType<typeof setInterval> | null = null;
  private meterBuffer: Uint8Array<ArrayBuffer> | null = null;
  private levelListeners = new Set<(level: InputLevel) => void>();

  setInputSensitivity(opts: { auto?: boolean; thresholdDb?: number }) {
    if (typeof opts.auto === "boolean") this.autoSensitivity = opts.auto;
    if (opts.thresholdDb !== undefined) this.sensitivityDb = clampSensitivityDb(opts.thresholdDb);
  }

  get inputSensitivity() {
    return { auto: this.autoSensitivity, thresholdDb: this.sensitivityDb };
  }

  /** Live mic level while in a call (about 20 times a second). */
  onInputLevel(fn: (level: InputLevel) => void): () => void {
    this.levelListeners.add(fn);
    return () => { this.levelListeners.delete(fn); };
  }

  private transmitState() {
    return {
      muted: this.isMuted,
      serverMuted: this.serverMuted,
      pttEnabled: this.pttEnabled,
      pttHeld: this.pttHeld || this.externalPttHeld,
    };
  }

  /** Point the meter at the track currently being sent (rebuilt when it changes). */
  private ensureMeter(): boolean {
    const sent = this.localStream?.getAudioTracks()[0] ?? null;
    if (!sent) {
      this.teardownMeter();
      return false;
    }
    if (this.meterAnalyser && this.meterSourceId === sent.id) return true;
    this.teardownMeter();
    try {
      const probe = sent.clone();
      probe.enabled = true;
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(new MediaStream([probe]));
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.2;
      source.connect(analyser);
      void ctx.resume().catch(() => {});
      this.meterCtx = ctx;
      this.meterAnalyser = analyser;
      this.meterTrack = probe;
      this.meterSourceId = sent.id;
      this.meterBuffer = new Uint8Array(new ArrayBuffer(analyser.fftSize));
      return true;
    } catch {
      this.teardownMeter();
      return false;
    }
  }

  private teardownMeter() {
    if (this.meterCtx) void this.meterCtx.close().catch(() => {});
    this.meterTrack?.stop();
    this.meterCtx = null;
    this.meterAnalyser = null;
    this.meterTrack = null;
    this.meterSourceId = null;
    this.meterBuffer = null;
  }

  private meterTick() {
    if (!this.ensureMeter() || !this.meterAnalyser || !this.meterBuffer) {
      if (!this.voiceGateOpen) {
        this.voiceGateOpen = true;
        this.applyMicState();
      }
      this.setLocalSpeaking(false);
      return;
    }
    if (this.meterCtx && this.meterCtx.state !== "running") {
      // Audio blocked until a click (autoplay policy): the meter hears
      // silence, so fail open rather than keep the mic gated shut.
      void this.meterCtx.resume().catch(() => {});
      if (!this.voiceGateOpen) {
        this.voiceGateOpen = true;
        this.applyMicState();
      }
      return;
    }
    this.meterAnalyser.getByteTimeDomainData(this.meterBuffer);
    const levelDb = amplitudeToDb(rmsFromByteTimeDomain(this.meterBuffer));
    this.gateState = stepVoiceGate(this.gateState, {
      levelDb,
      now: Date.now(),
      auto: this.autoSensitivity,
      manualThresholdDb: this.sensitivityDb,
    });
    const gateOpen = this.gateState.open;
    if (gateOpen !== this.voiceGateOpen) {
      this.voiceGateOpen = gateOpen;
      this.applyMicState();
    }
    const transmitting = shouldTransmit({ ...this.transmitState(), voiceGateOpen: gateOpen });
    // Speaking ring = actually sending and above the threshold (in push-to-
    // talk too, so holding the key in silence doesn't light it up).
    this.setLocalSpeaking(transmitting && gateOpen);
    if (this.levelListeners.size) {
      const level: InputLevel = { levelDb, thresholdDb: this.gateState.thresholdDb, gateOpen, transmitting };
      this.levelListeners.forEach((fn) => fn(level));
    }
  }

  private setLocalSpeaking(speaking: boolean) {
    const was = this.speakingState.get("local") || false;
    if (speaking === was) return;
    this.speakingState.set("local", speaking);
    const me = this.getMyUserId();
    if (me) this.speakingState.set(me, speaking);
    this.emit({ type: "speaking", userId: me, speaking });
    if (this.roomId) {
      fetch(`/api/voice/speaking/${this.roomId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ speaking }),
      }).catch(() => {});
    }
  }

  private startInputMeter() {
    this.stopInputMeter();
    this.gateState = createVoiceGateState();
    this.voiceGateOpen = true;
    this.meterInterval = setInterval(() => this.meterTick(), 50);
  }

  private stopInputMeter() {
    if (this.meterInterval) clearInterval(this.meterInterval);
    this.meterInterval = null;
    this.teardownMeter();
    this.voiceGateOpen = true;
  }

  // -- Server mute / deafen (set by a moderator) -------------------------------
  private serverMuted = false;
  private serverDeafened = false;

  private applyServerVoiceFlags(mute: boolean, deaf: boolean) {
    if (mute === this.serverMuted && deaf === this.serverDeafened) return;
    this.serverMuted = mute;
    this.serverDeafened = deaf;
    this.applyMicState();
    this.applyRemoteAudioEnabled();
    this.emit({ type: "server_voice_state", mute, deaf });
  }

  /** Remote voices are silenced while you're deafened, by yourself or a moderator. */
  private get hearingOff() { return this.isDeafened || this.serverDeafened; }

  private applyRemoteAudioEnabled() {
    const on = !this.hearingOff;
    this.remoteStreams.forEach((stream) => {
      stream.getAudioTracks().forEach((t) => { t.enabled = on; });
    });
  }

  // -- Push to talk ----------------------------------------------------------
  private pttEnabled = false;
  private pttKey = DEFAULT_PTT_KEY;
  private pttHeld = false;
  private pttListening = false;

  setPushToTalk(enabled: boolean, key: string = this.pttKey) {
    const nextKey = normalizePttKey(key);
    const changed = this.pttEnabled !== Boolean(enabled) || this.pttKey !== nextKey;
    this.pttEnabled = Boolean(enabled);
    this.pttKey = nextKey;
    if (!this.pttEnabled) {
      this.pttHeld = false;
      this.externalPttHeld = false;
    }
    this.applyMicState();
    if (changed) this.emit({ type: "push_to_talk_changed" });
  }

  get pushToTalkEnabled() { return this.pttEnabled; }
  get pushToTalkKey() { return this.pttKey; }

  // Held from outside the page: the desktop app's system-wide push-to-talk
  // key, which works while SerikaCord isn't focused.
  private externalPttHeld = false;

  setExternalPushToTalk(held: boolean) {
    const next = this.pttEnabled && Boolean(held);
    if (next === this.externalPttHeld) return;
    this.externalPttHeld = next;
    this.applyMicState();
  }

  private onPttKeyDown = (e: KeyboardEvent) => {
    if (!this.pttEnabled || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!isPttKeyEvent(e, this.pttKey) || isTypingTarget(e.target)) return;
    if (!this.pttHeld) {
      this.pttHeld = true;
      this.applyMicState();
    }
  };

  private onPttKeyUp = (e: KeyboardEvent) => {
    if (!this.pttHeld || !isPttKeyEvent(e, this.pttKey)) return;
    this.pttHeld = false;
    this.applyMicState();
  };

  // Losing focus means we'd never see the keyup: close the mic.
  private onPttRelease = () => {
    if (!this.pttHeld) return;
    this.pttHeld = false;
    this.applyMicState();
  };

  private onPttVisibility = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") this.onPttRelease();
  };

  private attachPttListeners() {
    if (this.pttListening || typeof window === "undefined") return;
    window.addEventListener("keydown", this.onPttKeyDown, true);
    window.addEventListener("keyup", this.onPttKeyUp, true);
    window.addEventListener("blur", this.onPttRelease);
    document.addEventListener("visibilitychange", this.onPttVisibility);
    window.addEventListener("pagehide", this.onPageHide);
    this.pttListening = true;
  }

  // Closing/reloading the tab: leave right away so the other person's call
  // ends now, not after the server's dropped-connection grace period.
  private onPageHide = (e: PageTransitionEvent) => {
    if (e.persisted || !this.roomId) return; // bfcache: the page may come back
    try {
      const body = new Blob([JSON.stringify({ roomId: this.roomId, sessionId: this.sessionId })], { type: "application/json" });
      navigator.sendBeacon?.("/api/voice/leave", body);
    } catch {
      // best effort; the server evicts after the grace period anyway
    }
  };

  private detachPttListeners() {
    this.pttHeld = false;
    this.externalPttHeld = false;
    if (!this.pttListening || typeof window === "undefined") return;
    window.removeEventListener("keydown", this.onPttKeyDown, true);
    window.removeEventListener("keyup", this.onPttKeyUp, true);
    window.removeEventListener("blur", this.onPttRelease);
    document.removeEventListener("visibilitychange", this.onPttVisibility);
    window.removeEventListener("pagehide", this.onPageHide);
    this.pttListening = false;
  }

  /** Enable/disable the outgoing mic track(s) from mute + push-to-talk state. */
  private applyMicState() {
    if (!this.localStream) return;
    const on = shouldTransmit({ ...this.transmitState(), voiceGateOpen: this.voiceGateOpen });
    this.localStream.getAudioTracks().forEach((t) => {
      t.enabled = on;
    });
  }

  // -- Input volume (mic gain) -----------------------------------------------
  // Only inserted into the mic path when the gain isn't 100%, so the common
  // case sends the raw device track untouched.
  private inputVolume = 100;
  private inputGainCtx: AudioContext | null = null;
  private inputGainNode: GainNode | null = null;
  private inputRawTrack: MediaStreamTrack | null = null;

  setInputVolume(percent: number) {
    if (!Number.isFinite(percent)) return;
    this.inputVolume = Math.min(Math.max(Math.round(percent), 0), 200);
    if (this.inputGainNode) {
      this.inputGainNode.gain.value = this.inputVolume / 100;
      return;
    }
    // Mid-call and no gain stage yet: splice one in (skipped while the noise
    // gate owns the mic path; it applies on the next join).
    if (!this.localStream || this.inputVolume === 100 || this.noiseSuppressionOn) return;
    const old = this.localStream.getAudioTracks()[0];
    if (!old) return;
    const wrapped = this.wrapWithInputGain(old);
    if (wrapped === old) return;
    this.localStream.removeTrack(old);
    this.localStream.addTrack(wrapped);
    this.peers.forEach((peer) => {
      try {
        (peer as unknown as { replaceTrack: (o: MediaStreamTrack, n: MediaStreamTrack, s: MediaStream) => void })
          .replaceTrack(old, wrapped, this.localStream!);
      } catch { /* ignore */ }
    });
    this.applyMicState();
  }

  /** Route a raw mic track through a GainNode; returns the track to send. */
  private wrapWithInputGain(track: MediaStreamTrack): MediaStreamTrack {
    if (this.inputVolume === 100) return track;
    try {
      this.teardownInputGain();
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(new MediaStream([track]));
      const gain = ctx.createGain();
      gain.gain.value = this.inputVolume / 100;
      const dest = ctx.createMediaStreamDestination();
      source.connect(gain);
      gain.connect(dest);
      const out = dest.stream.getAudioTracks()[0];
      if (!out) {
        void ctx.close().catch(() => {});
        return track;
      }
      void ctx.resume().catch(() => {});
      // The raw track feeds the gain stage and must stay enabled; mute/PTT
      // act on the processed track that is actually sent.
      track.enabled = true;
      this.inputGainCtx = ctx;
      this.inputGainNode = gain;
      this.inputRawTrack = track;
      return out;
    } catch {
      return track;
    }
  }

  private teardownInputGain() {
    if (this.inputGainCtx) {
      void this.inputGainCtx.close().catch(() => {});
    }
    this.inputGainCtx = null;
    this.inputGainNode = null;
    if (this.inputRawTrack) {
      this.inputRawTrack.stop();
      this.inputRawTrack = null;
    }
  }

  // -- Output volume (remote voices) -----------------------------------------
  private outputVolumePct = 100;
  private outputVolumeListeners = new Set<(percent: number) => void>();

  setOutputVolume(percent: number) {
    if (!Number.isFinite(percent)) return;
    const next = Math.min(Math.max(Math.round(percent), 0), 200);
    if (next === this.outputVolumePct) return;
    this.outputVolumePct = next;
    this.outputVolumeListeners.forEach((fn) => fn(next));
  }

  get outputVolume() { return this.outputVolumePct; }

  onOutputVolumeChange(fn: (percent: number) => void): () => void {
    this.outputVolumeListeners.add(fn);
    return () => { this.outputVolumeListeners.delete(fn); };
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
  private noiseSourceTrack: MediaStreamTrack | null = null;

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

  private emitError(code: VoiceErrorCode, message = ERROR_FALLBACK[code]) {
    this.emit({ type: "error", code, message });
  }

  /**
   * Join a voice room. `meta` labels it in the voice bar (channel or DM name)
   * and says where "return to call" goes.
   */
  joinChannel(channelId: string, withVideo = false, meta?: VoiceRoomMeta): Promise<void> {
    if (meta) {
      const sameRoom = this.roomId === channelId || this.joining?.roomId === channelId;
      if (sameRoom) this.meta = { ...this.meta, ...meta };
    }
    // Already connected to this exact room — just re-emit current state so UI syncs
    if (this.roomId === channelId && !this.joining) {
      this.emit({ type: "connected" });
      this.emitParticipants();
      return Promise.resolve();
    }
    // A double-clicked Call button (or Call + ?call= at once) joins once.
    if (this.joining?.roomId === channelId) return this.joining.promise;
    const promise = this.doJoin(channelId, withVideo, meta ?? {}).finally(() => {
      if (this.joining?.promise === promise) this.joining = null;
    });
    this.joining = { roomId: channelId, promise };
    return promise;
  }

  private async doJoin(channelId: string, withVideo: boolean, meta: VoiceRoomMeta): Promise<void> {
    await loadSimplePeer();
    // Switching rooms: leave the old one without cancelling this join.
    if (this.roomId) await this.leaveChannel({ keepPendingJoin: true });

    const seq = ++this.joinSeq;
    const cancelled = () => seq !== this.joinSeq;
    this.roomId = channelId;
    this.meta = meta;
    this.sessionId = newSessionId();
    this.reconnectAttempt = 0;
    this.isMuted = false;
    this.isDeafened = false;
    this.serverMuted = false;
    this.serverDeafened = false;
    this.isScreenSharing = false;

    // Get mic (and optionally camera). No usable mic (none plugged in,
    // permission refused, busy) isn't fatal: join listen-only and let the mute
    // button ask again later.
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      this.resetLocalJoin();
      this.emitError("insecure");
      return;
    }
    let stream: MediaStream | null = null;
    let lastErr: unknown = null;
    for (const request of mediaAttempts(withVideo)) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: request.audio ? this.micConstraints() : false,
          video: request.video ? this.cameraConstraints() : false,
        });
        break;
      } catch (err) {
        lastErr = err;
        if (cancelled()) return;
        // Something other than a device problem: the call can't work.
        if (!isListenOnlyError(err)) {
          this.resetLocalJoin();
          this.emitError(mediaErrorCode(err, withVideo));
          return;
        }
      }
    }
    if (cancelled()) {
      stream?.getTracks().forEach((t) => t.stop());
      return;
    }
    // Listen-only: an empty stream still lets peers connect and receive.
    if (!stream) stream = new MediaStream();
    const outcome = mediaOutcome({
      wantVideo: withVideo,
      gotAudio: stream.getAudioTracks().length > 0,
      gotVideo: stream.getVideoTracks().length > 0,
    });
    withVideo = stream.getVideoTracks().length > 0;
    this.localStream = stream;
    this.isVideoOn = withVideo;
    this.micMissing = outcome.listenOnly;
    this.isMuted = outcome.listenOnly;
    if (outcome.cameraMissing) this.emitError("camera-denied");
    if (outcome.listenOnly) {
      this.emit({ type: "listen_only", enabled: true, reason: micIssue(lastErr) });
    }
    const rawAudio = stream.getAudioTracks()[0];
    if (rawAudio) {
      const sent = this.wrapWithInputGain(rawAudio);
      if (sent !== rawAudio) {
        stream.removeTrack(rawAudio);
        stream.addTrack(sent);
      }
    }
    // Push-to-talk: start silent until the key is held.
    this.pttHeld = false;
    this.applyMicState();

    // Register with server
    const sessionId = this.sessionId;
    try {
      const joinRes = await fetch(`/api/voice/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: channelId, audio: !this.micMissing, video: withVideo, sessionId }),
      });
      if (!joinRes.ok) {
        const data = await joinRes.json().catch(() => null) as { error?: string } | null;
        const code: VoiceErrorCode = data?.error === "This voice channel is full"
          ? "room-full"
          : data?.error === "You cannot call this user"
            ? "call-blocked"
            : "join-failed";
        throw Object.assign(new Error(data?.error || `join failed: ${joinRes.status}`), { code });
      }
    } catch (err) {
      if (cancelled()) return;
      this.resetLocalJoin();
      this.emitError(((err as { code?: VoiceErrorCode }).code) || "join-failed");
      return;
    }
    if (cancelled()) {
      // Hung up while the join was in flight: undo it server-side.
      void fetch("/api/voice/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: channelId, sessionId }),
      }).catch(() => {});
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
    if (cancelled()) return;

    // Connect SSE signaling
    this.attachPttListeners();
    this.connectSignaling(channelId);
    this.startSpeakingDetection();
    this.joined = true;
    this.emit({ type: "connected" });
  }

  /** Undo a join that failed before it reached the server. */
  private resetLocalJoin() {
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.teardownInputGain();
    this.isVideoOn = false;
    this.micMissing = false;
    this.roomId = null;
    this.joined = false;
    this.sessionId = null;
    this.meta = {};
    this.joining = null;
    // Let the UI drop any "connecting" state it showed for this attempt.
    this.emit({ type: "disconnected" });
  }

  private connectSignaling(roomId: string) {
    if (this.signalingEs) {
      this.signalingEs.close();
    }

    const session = this.sessionId ? `?session=${encodeURIComponent(this.sessionId)}` : "";
    const es = new EventSource(`/api/voice/signal/${roomId}${session}`);
    this.signalingEs = es;

    es.onopen = () => {
      if (this.signalingEs === es) this.reconnectAttempt = 0;
    };

    es.onmessage = (e) => {
      if (this.signalingEs !== es) return;
      try {
        const msg = JSON.parse(e.data);
        this.handleSignalingMessage(msg);
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      if (this.signalingEs !== es) return;
      // Don't let EventSource silently reconnect on its own: the server may
      // have dropped us from the room, so every reconnect goes through /join.
      es.close();
      this.signalingEs = null;
      if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
      const delay = signalRetryDelayMs(this.reconnectAttempt++);
      this.reconnectTimeout = setTimeout(() => {
        this.reconnectTimeout = null;
        if (this.roomId === roomId) void this.resumeAfterSignalDrop(roomId);
      }, delay);
    };
  }

  // The server drops us from the room when our signaling stream stays closed
  // for a while, and only joined participants may exchange offers. So re-join
  // (with the same session, which the server treats as a resume) before
  // reconnecting the stream. Peer connections that survived the blip are kept.
  private async resumeAfterSignalDrop(roomId: string) {
    try {
      const res = await fetch(`/api/voice/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, audio: !this.isMuted, video: this.isVideoOn, sessionId: this.sessionId }),
      });
      if (this.roomId !== roomId) return;
      if (res.status === 400 || res.status === 403 || res.status === 404) {
        // Lost access to the room (or it's full): stop retrying.
        this.emitError("disconnected");
        await this.leaveChannel();
        return;
      }
      if (res.ok) {
        const data = await res.json().catch(() => null) as { resumed?: boolean } | null;
        // The server had already let us go: everyone else dropped their
        // connection to us, so start over and offer to them again.
        if (!data?.resumed) this.resetAllPeers();
        if (this.isDeafened || this.isScreenSharing) {
          fetch(`/api/voice/state/${roomId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ deafened: this.isDeafened, screenShare: this.isScreenSharing }),
          }).catch(() => {});
        }
      }
    } catch {
      // Network still down; reconnecting the stream will error and retry.
    }
    if (this.roomId === roomId) this.connectSignaling(roomId);
  }

  private resetAllPeers() {
    for (const userId of Array.from(this.peers.keys())) this.destroyPeer(userId);
    this.emitParticipants();
  }

  /**
   * Moved by a moderator: join the new channel, keeping self mute/deafen
   * (Discord keeps them across a move).
   */
  private async followModeratorMove(roomId: string, info: { channelName: string; serverId: string; channelId: string }) {
    const wasMuted = this.isMuted && !this.micMissing;
    const wasDeafened = this.isDeafened;
    await this.joinChannel(roomId, false, {
      label: info.channelName || undefined,
      href: info.serverId && info.channelId ? `/channels/${info.serverId}/${info.channelId}` : undefined,
    });
    if (this.roomId !== roomId) return;
    if (wasDeafened && !this.isDeafened) this.toggleDeafen();
    else if (wasMuted && !this.isMuted) this.toggleMute();
    this.emit({ type: "moved_by_moderator", channelName: info.channelName });
  }

  /** Torn down locally only — another device took over, or the server let us go. */
  private async dropLocally(code: VoiceErrorCode) {
    this.emitError(code);
    await this.leaveChannel({ notifyServer: false });
  }

  private handleSignalingMessage(msg: Record<string, unknown>) {
    switch (msg.type) {
      case "voice:state": {
        // Server tells us our own id for reliable self-identification
        if (msg.self) this.myUserId = msg.self as string;
        const me = this.getMyUserId();
        const parts = (msg.participants as VoiceParticipant[]) || [];
        // Our own entry belongs to a newer session (we joined somewhere else).
        const mine = parts.find((p) => p.userId === me);
        if (mine?.sessionId && this.sessionId && mine.sessionId !== this.sessionId) {
          void this.dropLocally("moved");
          break;
        }
        this.participants = new Map(parts.map((p) => [p.userId, p]));
        if (mine) this.applyServerVoiceFlags(mine.serverMute === true, mine.serverDeaf === true);
        // Connections to people who are gone are stale.
        for (const userId of Array.from(this.peers.keys())) {
          if (!this.participants.has(userId)) this.destroyPeer(userId);
        }
        // We are the newcomer (or just reconnected): offer to everyone we don't
        // already have a working connection with. Existing members answer.
        parts.forEach((p) => {
          if (p.userId !== me && !this.peers.has(p.userId)) {
            this.createPeer(p.userId, true);
          }
        });
        this.emitParticipants();
        break;
      }
      case "voice:participant_joined": {
        const p = msg.participant as VoiceParticipant;
        if (!p?.userId) break;
        if (p.userId === this.getMyUserId()) {
          // Our account joined from another tab/device: it takes the call over.
          if (p.sessionId && this.sessionId && p.sessionId !== this.sessionId) void this.dropLocally("moved");
          break;
        }
        const prev = this.participants.get(p.userId);
        // Same person from a new device/tab, or back after the server let them
        // go: the old connection is dead. They offer to us; wait for it.
        if (prev && prev.sessionId !== p.sessionId) this.destroyPeer(p.userId);
        this.participants.set(p.userId, p);
        // Do NOT initiate here — the newcomer initiates to us, and their offer
        // will arrive via voice:offer which creates the non-initiator peer.
        // This avoids WebRTC glare (both sides initiating).
        this.emitParticipants();
        break;
      }
      case "voice:replaced": {
        if (msg.sessionId && this.sessionId && msg.sessionId !== this.sessionId) void this.dropLocally("moved");
        break;
      }
      case "voice:force_disconnect": {
        // A moderator disconnected us: leave (the server already let us go).
        void this.dropLocally("kicked");
        break;
      }
      case "voice:move": {
        // A moderator moved us to another voice channel of the same server.
        const roomId = typeof msg.roomId === "string" ? msg.roomId : "";
        if (!roomId.startsWith("channel-") || roomId === this.roomId) break;
        void this.followModeratorMove(roomId, {
          channelName: typeof msg.channelName === "string" ? msg.channelName : "",
          serverId: typeof msg.serverId === "string" ? msg.serverId : "",
          channelId: typeof msg.channelId === "string" ? msg.channelId : "",
        });
        break;
      }
      case "voice:call_declined": {
        // The person we're calling declined. The DM call controller hangs up.
        this.emit({ type: "call_declined", userId: msg.userId as string });
        break;
      }
      case "voice:participant_left": {
        const userId = msg.userId as string;
        if (userId === this.getMyUserId()) {
          // The server dropped *us* (our stream was gone too long). Re-join.
          if (this.roomId && this.signalingEs) {
            const roomId = this.roomId;
            void this.resumeAfterSignalDrop(roomId);
          }
          break;
        }
        this.participants.delete(userId);
        this.destroyPeer(userId);
        this.emitParticipants();
        break;
      }
      case "voice:offer":
      case "voice:answer":
      case "voice:ice": {
        const fromUserId = msg.fromUserId as string;
        const signal = (msg.type === "voice:ice" ? msg.candidate : msg.signal) as RemoteSignal | undefined;
        if (!fromUserId || !signal || typeof signal !== "object") break;
        this.handleRemoteSignal(fromUserId, signal, typeof msg.pcId === "string" ? msg.pcId : null);
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
        if (userId === this.getMyUserId() && (typeof msg.serverMute === "boolean" || typeof msg.serverDeaf === "boolean")) {
          this.applyServerVoiceFlags(
            typeof msg.serverMute === "boolean" ? msg.serverMute : this.serverMuted,
            typeof msg.serverDeaf === "boolean" ? msg.serverDeaf : this.serverDeafened,
          );
        }
        const participant = this.participants.get(userId);
        if (participant) {
          if (msg.audio !== undefined) participant.audio = msg.audio as boolean;
          if (msg.deafened !== undefined) participant.deafened = msg.deafened as boolean;
          if (typeof msg.serverMute === "boolean") participant.serverMute = msg.serverMute;
          if (typeof msg.serverDeaf === "boolean") participant.serverDeaf = msg.serverDeaf;
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

  /**
   * Route an offer/answer/ICE signal to the right peer connection. Every
   * signal carries the sender's connection id (`pcId`), so leftovers from a
   * connection that was replaced (glare, a retry, a rejoin) never reach the
   * new one — feeding them in used to kill fresh connections.
   */
  private handleRemoteSignal(fromUserId: string, signal: RemoteSignal, pcId: string | null) {
    const me = this.getMyUserId();
    // Only accept connections from people who are visibly in the room.
    if (fromUserId === me || !this.participants.has(fromUserId)) return;

    let peer = this.peers.get(fromUserId);
    let meta = this.peerMeta.get(fromUserId);

    if (signal.type === "offer") {
      if (peer && meta) {
        const samePair = pcId !== null && meta.remotePcId === pcId;
        if (!samePair) {
          const glare = meta.initiator && !peer.connected && meta.remotePcId === null;
          // Both of us offered at once: the impolite side keeps its own offer.
          if (glare && !isPolitePeer(me, fromUserId)) return;
          // Polite side, or they started a brand-new connection: take theirs.
          this.destroyPeer(fromUserId);
          peer = undefined;
          meta = undefined;
        }
      }
      if (!peer) {
        this.createPeer(fromUserId, false);
        peer = this.peers.get(fromUserId);
        meta = this.peerMeta.get(fromUserId);
      }
      if (!peer || !meta) return;
      meta.remotePcId = pcId;
      this.safeSignal(peer, signal);
      this.flushPendingSignals(fromUserId);
      return;
    }

    if (signal.type === "answer") {
      if (!peer || !meta || !meta.initiator) return;
      if (meta.remotePcId === null) meta.remotePcId = pcId;
      if (pcId !== null && meta.remotePcId !== pcId) return;
      this.safeSignal(peer, signal);
      this.flushPendingSignals(fromUserId);
      return;
    }

    // ICE candidates, renegotiation requests and transceiver requests.
    if (!peer || !meta || meta.remotePcId === null) {
      const queue = this.pendingSignals.get(fromUserId) ?? [];
      if (queue.length < 64) queue.push({ pcId, signal });
      this.pendingSignals.set(fromUserId, queue);
      return;
    }
    if (pcId !== null && meta.remotePcId !== pcId) return; // stale connection
    this.safeSignal(peer, signal);
  }

  private flushPendingSignals(userId: string) {
    const queue = this.pendingSignals.get(userId);
    const peer = this.peers.get(userId);
    const meta = this.peerMeta.get(userId);
    if (!queue || !peer || !meta || meta.remotePcId === null) return;
    this.pendingSignals.delete(userId);
    for (const item of queue) {
      if (item.pcId === null || item.pcId === meta.remotePcId) this.safeSignal(peer, item.signal);
    }
  }

  private safeSignal(peer: SimplePeer.Instance, signal: RemoteSignal) {
    try {
      peer.signal(signal as unknown as SimplePeer.SignalData);
    } catch {
      // A destroyed peer throws; its close handler already cleaned up.
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
    if (!this.localStream || !this.roomId || !SimplePeerCtor) return;
    const roomId = this.roomId;
    const pcId = newSessionId();

    const peer = new SimplePeerCtor({
      initiator,
      // A listen-only (no mic) or camera-less side has nothing to send, so
      // always ask to receive both: the offer still carries audio/video
      // m-lines and the other side's mic and camera come through.
      stream: this.localStream.getTracks().length > 0 ? this.localStream : undefined,
      offerOptions: { offerToReceiveAudio: true, offerToReceiveVideo: true },
      trickle: true,
      config: {
        // Use the ICE servers fetched from /api/voice/token — this includes the
        // configured TURN relay, which is REQUIRED for two peers that can't reach
        // each other directly (different NATs/firewalls).
        iceServers: this.iceServers,
      },
    });
    // Events from a connection we've since replaced must be ignored.
    const current = () => this.peers.get(targetUserId) === peer && this.roomId === roomId;

    peer.on("signal", (signal) => {
      if (!current()) return;
      // Every signal (offer, answer, ICE, renegotiation) goes through one relay;
      // the receiver routes it by `signal.type` and `pcId`.
      fetch(`/api/voice/signal/${roomId}/offer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId, signal, pcId }),
      }).catch(() => {});
    });

    peer.on("connect", () => {
      if (!current()) return;
      this.peerRetryAttempts.delete(targetUserId);
      // Someone who joined (or reconnected) while we're sharing gets the
      // screen too, not just the people who were there when it started.
      if (this.isScreenSharing) this.sendScreenTo(peer);
    });

    peer.on("stream", (stream) => {
      if (!current()) return;
      // Respect an active deafen for streams that arrive after toggling
      stream.getAudioTracks().forEach((t) => {
        t.enabled = !this.hearingOff;
      });
      // The first stream from a peer is their primary mic/camera. Any later
      // stream is a screen share (getDisplayMedia produces a distinct stream),
      // so it must NOT overwrite the primary stream — otherwise remote audio
      // breaks and the camera tile disappears.
      if (!this.remoteStreams.has(targetUserId)) {
        this.remoteStreams.set(targetUserId, stream);
      } else if (this.remoteStreams.get(targetUserId) !== stream) {
        this.remoteScreenStreams.set(targetUserId, stream);
        // When the screen stream's track ends (sharer stopped), drop it.
        stream.getVideoTracks().forEach((t) => {
          t.addEventListener("ended", () => {
            if (this.remoteScreenStreams.get(targetUserId) !== stream) return;
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
      if (!current()) return;
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
            if (this.remoteScreenStreams.get(targetUserId) !== screenStream) return;
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

        track.enabled = !this.hearingOff;
        if (primary) {
          primary.addTrack(track);
        } else {
          this.remoteStreams.set(targetUserId, new MediaStream([track]));
        }
        this.emitParticipants();
      }
    });

    const onDead = () => {
      if (!current()) return;
      this.destroyPeer(targetUserId);
      this.emitParticipants();
      this.schedulePeerRetry(targetUserId);
    };
    peer.on("error", onDead);
    peer.on("close", onDead);

    this.peers.set(targetUserId, peer);
    this.peerMeta.set(targetUserId, { initiator, pcId, remotePcId: null });
  }

  /**
   * A connection to someone still in the room failed (ICE failure, network
   * change). Offer again after a short delay unless they beat us to it.
   */
  private schedulePeerRetry(userId: string) {
    const roomId = this.roomId;
    if (!roomId || !this.participants.has(userId)) return;
    const existing = this.peerRetryTimers.get(userId);
    if (existing) clearTimeout(existing);
    const attempt = this.peerRetryAttempts.get(userId) ?? 0;
    if (attempt >= 6) return;
    this.peerRetryAttempts.set(userId, attempt + 1);
    const timer = setTimeout(() => {
      this.peerRetryTimers.delete(userId);
      if (this.roomId !== roomId || !this.participants.has(userId) || this.peers.has(userId)) return;
      this.createPeer(userId, true);
    }, peerRetryDelayMs(this.getMyUserId(), userId, attempt));
    this.peerRetryTimers.set(userId, timer);
  }

  private destroyPeer(userId: string) {
    const peer = this.peers.get(userId);
    // Remove first so the peer's own close/error handlers see it as stale.
    this.peers.delete(userId);
    this.peerMeta.delete(userId);
    this.pendingSignals.delete(userId);
    // A new connection brings new streams; keeping the old ones would play a
    // dead stream and misfile the new mic stream as a screen share.
    this.remoteStreams.delete(userId);
    this.remoteScreenStreams.delete(userId);
    if (peer) {
      try { peer.destroy(); } catch { /* ignore */ }
    }
  }

  async leaveChannel(opts: { notifyServer?: boolean; keepPendingJoin?: boolean } = {}) {
    if (!opts.keepPendingJoin) {
      // Cancels a join that is still waiting on the mic or the server.
      const wasJoining = this.joining !== null;
      this.joinSeq++;
      this.joining = null;
      if (wasJoining && !this.roomId) {
        this.emit({ type: "disconnected" });
        return;
      }
    }
    if (!this.roomId) return;

    const roomId = this.roomId;
    const sessionId = this.sessionId;
    this.roomId = null;
    this.joined = false;
    this.sessionId = null;
    this.meta = {};

    // Stop screen share
    this.stopScreenShare(roomId);
    this.stopSpeakingDetection();
    this.cleanupNoiseSuppression();

    // Stop local stream
    this.detachPttListeners();
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }
    this.teardownInputGain();
    this.isVideoOn = false;
    this.isMuted = false;
    this.micMissing = false;
    this.isDeafened = false;
    const hadServerState = this.serverMuted || this.serverDeafened;
    this.serverMuted = false;
    this.serverDeafened = false;
    if (hadServerState) this.emit({ type: "server_voice_state", mute: false, deaf: false });

    // Destroy all peers
    for (const userId of Array.from(this.peers.keys())) this.destroyPeer(userId);
    this.peers.clear();
    this.peerMeta.clear();
    this.pendingSignals.clear();
    this.peerRetryTimers.forEach((t) => clearTimeout(t));
    this.peerRetryTimers.clear();
    this.peerRetryAttempts.clear();
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
    this.reconnectAttempt = 0;

    // Update the UI right away; telling the server can take a moment.
    this.emit({ type: "disconnected" });
    this.emitParticipants();

    if (opts.notifyServer === false) return;
    await fetch("/api/voice/leave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId, sessionId }),
      keepalive: true,
    }).catch(() => {});
  }

  private startSpeakingDetection() {
    this.stopSpeakingDetection();
    // Your own speaking state comes from the input meter (voice activity gate).
    this.startInputMeter();
    this.speakingInterval = setInterval(() => {
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
    this.stopInputMeter();
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
    // Listen-only: "unmute" means try to get a microphone again.
    if (this.micMissing) {
      void this.retryMicrophone();
      return this.isMuted;
    }
    this.isMuted = !this.isMuted;
    this.applyMicState();
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

  /**
   * Ask for the microphone again while in a call listen-only (the browser
   * prompts if permission can still be granted). On success the mic is sent
   * to everyone already connected (renegotiating each peer) and you're
   * unmuted. Resolves to whether you now have a mic.
   */
  retryMicrophone(): Promise<boolean> {
    if (!this.micMissing) return Promise.resolve(true);
    if (this.micRetry) return this.micRetry;
    const roomId = this.roomId;
    const attempt = (async () => {
      let track: MediaStreamTrack | undefined;
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: this.micConstraints(), video: false });
        track = micStream.getAudioTracks()[0];
        if (!track) throw Object.assign(new Error("no audio track"), { name: "NotFoundError" });
      } catch (err) {
        if (this.roomId === roomId && this.micMissing) {
          this.emit({ type: "listen_only", enabled: true, reason: micIssue(err) });
        }
        return false;
      }
      // Left (or moved rooms) while the prompt was open.
      if (!roomId || this.roomId !== roomId || !this.localStream) {
        track.stop();
        return false;
      }
      const stream = this.localStream;
      const sent = this.wrapWithInputGain(track);
      stream.addTrack(sent);
      this.peers.forEach((peer) => {
        try { peer.addTrack(sent, stream); } catch { /* peer closing; a retry re-offers with it */ }
      });
      this.micMissing = false;
      this.isMuted = false;
      this.applyMicState();
      fetch(`/api/voice/state/${roomId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: true }),
      }).catch(() => {});
      this.emit({ type: "listen_only", enabled: false });
      this.emit({ type: "mute_toggled", muted: false });
      return true;
    })().finally(() => {
      this.micRetry = null;
    });
    this.micRetry = attempt;
    return attempt;
  }

  toggleDeafen(): boolean {
    this.isDeafened = !this.isDeafened;
    // Mute remote streams when deafened (a server deafen keeps them off)
    this.applyRemoteAudioEnabled();
    // If deafening, also mute
    if (this.isDeafened && !this.isMuted) {
      this.isMuted = true;
      this.applyMicState();
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

      // Chain: source -> highpass -> analyser -> gate -> (stream destination
      // below). Never connect it to ctx.destination: that played your own mic
      // back through your speakers (self-echo, and feedback into the call).
      source.connect(this.noiseHighPass);
      this.noiseHighPass.connect(this.noiseAnalyser);
      this.noiseAnalyser.connect(this.noiseGate);

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

        // Keep the old track alive and enabled: it feeds the gate chain
        // above. Mute/push-to-talk act on the processed track that is sent.
        oldTrack.enabled = true;
        this.noiseSourceTrack = oldTrack;
        this.applyMicState();
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
      // We need the original track back — re-acquire it from getUserMedia
      // since we can't easily reverse the Web Audio processing
      navigator.mediaDevices.getUserMedia({
        audio: this.micConstraints(),
        video: false,
      }).then((origStream) => {
        const rawTrack = origStream.getAudioTracks()[0];
        const origTrack = rawTrack ? this.wrapWithInputGain(rawTrack) : rawTrack;
        if (origTrack && this.localStream) {
          const stream = this.localStream;
          const sent = stream.getAudioTracks()[0];
          // Swap the sent track in place. Adding a second audio track instead
          // made the other side treat it as a screen share and keep playing
          // the old one.
          if (sent) {
            this.peers.forEach((peer) => {
              try {
                (peer as unknown as { replaceTrack: (o: MediaStreamTrack, n: MediaStreamTrack, s: MediaStream) => void })
                  .replaceTrack(sent, origTrack, stream);
              } catch { /* ignore */ }
            });
          }
          stream.getAudioTracks().forEach((t) => {
            stream.removeTrack(t);
            t.stop();
          });
          stream.addTrack(origTrack);

          // Apply current mute / push-to-talk state
          this.applyMicState();
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
    // The mic track that fed the gate; leaving it running kept the mic on.
    if (this.noiseSourceTrack) {
      this.noiseSourceTrack.stop();
      this.noiseSourceTrack = null;
    }
  }

  async toggleVideo(): Promise<boolean> {
    if (!this.localStream || !this.roomId) return false;

    if (this.isVideoOn) {
      // Turn off video: stop sending it to every peer first (simple-peer has
      // no replaceStream, so the old code left the last frame frozen remotely).
      const stream = this.localStream;
      stream.getVideoTracks().forEach((t) => {
        this.peers.forEach((peer) => {
          try { peer.removeTrack(t, stream); } catch { /* not sent to this peer */ }
        });
        t.stop();
        stream.removeTrack(t);
      });
      this.isVideoOn = false;
    } else {
      // Turn on video
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({
          video: this.cameraConstraints(),
          audio: false,
        });
        const videoTrack = videoStream.getVideoTracks()[0];
        if (videoTrack) {
          this.localStream.addTrack(videoTrack);
          this.isVideoOn = true;
          // Send it to everyone already connected (renegotiates each peer).
          const stream = this.localStream;
          this.peers.forEach((peer) => {
            try { peer.addTrack(videoTrack, stream); } catch { /* peer closing */ }
          });
        }
      } catch {
        this.emitError("camera-denied");
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

  // -- Screen share quality ----------------------------------------------------
  private streamQuality: StreamQuality = loadStreamQuality();

  get screenShareQuality(): StreamQuality { return this.streamQuality; }

  /** Cap one peer's screen share sender to the chosen bitrate / frame rate. */
  private tuneScreenSender(peer: SimplePeer.Instance, track: MediaStreamTrack) {
    const pc = (peer as unknown as { _pc?: RTCPeerConnection })._pc;
    const sender = pc?.getSenders?.().find((x) => x.track === track);
    if (!sender || typeof sender.getParameters !== "function") return;
    const apply = () => {
      try {
        const params = sender.getParameters();
        if (!params.encodings || params.encodings.length === 0) return;
        params.encodings = params.encodings.map((e) => ({
          ...e,
          maxBitrate: streamMaxBitrate(this.streamQuality),
          maxFramerate: this.streamQuality.frameRate,
        }));
        void sender.setParameters(params).catch(() => { /* renegotiating; retried below */ });
      } catch {
        // unsupported in this browser
      }
    };
    apply();
    // Encodings only exist once negotiation has run: try again shortly.
    setTimeout(apply, 2500);
  }

  /** Send our screen share to one peer (new peers join mid-share too). */
  private sendScreenTo(peer: SimplePeer.Instance) {
    const stream = this.screenStream;
    const track = stream?.getVideoTracks()[0];
    if (!stream || !track || !this.isScreenSharing) return;
    try {
      peer.addTrack(track, stream);
    } catch {
      // already sent to this peer
    }
    this.tuneScreenSender(peer, track);
  }

  /**
   * Change the screen share's resolution / frame rate (Discord's stream
   * quality). Applies to a live share right away and to the next one.
   */
  async setScreenShareQuality(quality: Partial<StreamQuality>): Promise<void> {
    this.streamQuality = normalizeStreamQuality({ ...this.streamQuality, ...quality });
    const track = this.screenStream?.getVideoTracks()[0];
    if (track) {
      try { track.contentHint = streamContentHint(this.streamQuality); } catch { /* unsupported */ }
      await track.applyConstraints(displayMediaVideoConstraints(this.streamQuality)).catch(() => {});
      this.peers.forEach((peer) => this.tuneScreenSender(peer, track));
    }
    this.emit({ type: "stream_quality_changed", quality: this.streamQuality });
  }

  async startScreenShare(quality?: Partial<StreamQuality>): Promise<boolean> {
    if (!this.roomId) return false;
    if (quality) this.streamQuality = normalizeStreamQuality({ ...this.streamQuality, ...quality });

    // getDisplayMedia is unavailable on most mobile browsers (iOS Safari has no
    // support at all). Surface a clear message instead of a generic "denied".
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
      this.emitError("screen-unsupported");
      return false;
    }

    try {
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: displayMediaVideoConstraints(this.streamQuality),
        audio: false,
      });
      this.isScreenSharing = true;

      const screenTrack = this.screenStream.getVideoTracks()[0];
      if (screenTrack) {
        try { screenTrack.contentHint = streamContentHint(this.streamQuality); } catch { /* unsupported */ }
        screenTrack.onended = () => {
          this.stopScreenShare();
        };

        // Add screen track to all peers
        this.peers.forEach((peer) => this.sendScreenTo(peer));
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
        this.emitError("screen-failed", `Could not start screen share${name ? ` (${name})` : ""}.`);
      }
      this.screenStream = null;
      this.isScreenSharing = false;
      return false;
    }
  }

  stopScreenShare(roomId: string | null = this.roomId) {
    const stream = this.screenStream;
    if (stream) {
      // Stop sending it before stopping it, so the other side's tile goes away.
      const tracks = stream.getVideoTracks();
      this.peers.forEach((peer) => {
        tracks.forEach((t) => {
          try { peer.removeTrack(t, stream); } catch { /* not added to this peer */ }
        });
      });
      stream.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
    }
    if (!this.isScreenSharing) return;
    this.isScreenSharing = false;
    if (roomId) {
      fetch(`/api/voice/state/${roomId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ screenShare: false }),
      }).catch(() => {});
    }
    this.emit({ type: "screen_share_toggled", enabled: false });
  }

  // Local playback for soundboard sounds; respects deafen and clamps volume.
  private playSoundboardAudio(url: string, volumePercent: number) {
    if (this.hearingOff) return;
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
        this.emitError("soundboard", data?.error || "Failed to play sound");
        return false;
      }
      const data = await res.json().catch(() => null);
      this.playSoundboardAudio(sound.url, typeof data?.volume === "number" ? data.volume : 100);
      return true;
    } catch {
      this.emitError("soundboard", "Failed to play sound. Check your connection.");
      return false;
    }
  }

  get muted() { return this.isMuted; }
  /** In the call without a microphone (others can't hear you). */
  get listenOnly() { return this.micMissing; }
  get myId() { return this.getMyUserId(); }
  /** Snapshot of who is currently speaking (userId -> speaking). */
  get speakingSnapshot(): Map<string, boolean> { return new Map(this.speakingState); }
  get deafened() { return this.isDeafened; }
  /** Muted by a moderator (Server Mute). */
  get serverMute() { return this.serverMuted; }
  /** Deafened by a moderator (Server Deafen). */
  get serverDeaf() { return this.serverDeafened; }
  get videoOn() { return this.isVideoOn; }
  get screenSharing() { return this.isScreenSharing; }
  get connected() { return this.joined && this.roomId !== null; }
  isConnectedTo(roomId: string) { return this.roomId === roomId; }
  get currentRoomId() { return this.roomId; }
  /** Room id being joined right now (mic prompt / server round-trip), if any. */
  get joiningRoomId() { return this.joining?.roomId ?? null; }
  /** Label + link for the current room (set by whoever joined it). */
  get roomMeta(): VoiceRoomMeta { return this.meta; }
  /** Update the current room's label (e.g. once a DM recipient's name loads). */
  setRoomMeta(roomId: string, meta: VoiceRoomMeta) {
    if (this.roomId !== roomId && this.joining?.roomId !== roomId) return;
    const next = { ...this.meta, ...meta };
    if (next.label === this.meta.label && next.href === this.meta.href) return;
    this.meta = next;
    this.emit({ type: "meta_changed" });
  }
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
