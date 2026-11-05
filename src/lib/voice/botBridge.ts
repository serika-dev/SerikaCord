/**
 * A bot's seat in an SFU room (docs/architecture/voice-sfu.md): a server-side
 * WebRTC peer (werift) to Cloudflare Realtime that publishes the bot's audio
 * (Opus from its UDP packets, passed through as is) and pulls everyone else's
 * audio for the bot, by the same rules as a browser (wantedKinds / the
 * server's pullDecision).
 */
import { MediaStreamTrack, RTCPeerConnection, RTCRtpCodecParameters, RtpHeader, RtpPacket, type RTCRtpTransceiver } from 'werift';
import { closeTracks, newSession, publishTracks, pullTracks, renegotiate } from '@/lib/voice/realtime';
import { recordPull, trackNameFor } from '@/lib/voice/sfu';
import { wantedKinds } from '@/lib/voice/sfuTransport';
import type { VoiceGrant } from '@/lib/voice/botVoiceServer';

const OPUS = new RTCRtpCodecParameters({ mimeType: 'audio/opus', clockRate: 48000, channels: 2, payloadType: 111 });
const RECONCILE_MS = 1500;

type Desc = { type: 'offer' | 'answer'; sdp: string };

export class BotBridge {
  private pc: RTCPeerConnection | null = null;
  private sessionId: string | null = null;
  private track: MediaStreamTrack | null = null;
  private seq = Math.floor(Math.random() * 65535);
  private ssrc = Math.floor(Math.random() * 2 ** 31) + 1;
  private pulled = new Map<string, { trackName: string; mid: string }>(); // userId → pull
  private byMid = new Map<string, string>(); // mid → userId
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private closed = false;

  constructor(
    private readonly grant: VoiceGrant,
    private readonly toBot: (userId: string, opus: Uint8Array, timestamp: number) => void,
    private readonly onLeft: (userIds: string[]) => void,
  ) {}

  private async offer(): Promise<Desc> {
    const pc = this.pc!;
    await pc.setLocalDescription(await pc.createOffer());
    return { type: 'offer', sdp: pc.localDescription!.sdp };
  }

  async start(): Promise<void> {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }], bundlePolicy: 'max-bundle', codecs: { audio: [OPUS] } });
    this.pc = pc;
    pc.ontrack = ({ track, transceiver }: { track: MediaStreamTrack; transceiver: RTCRtpTransceiver }) => {
      const userId = transceiver.mid ? this.byMid.get(transceiver.mid) : undefined;
      if (!userId) return;
      track.onReceiveRtp.subscribe((rtp) => {
        if (this.byMid.get(transceiver.mid ?? '') !== userId) return;
        this.toBot(userId, rtp.payload, rtp.header.timestamp);
      });
    };
    pc.createDataChannel('serika');
    const session = await newSession(await this.offer());
    if (!session.sessionId || !session.sessionDescription) throw new Error('No Realtime session');
    this.sessionId = session.sessionId;
    await pc.setRemoteDescription(session.sessionDescription);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('SFU connection timed out')), 15_000);
      pc.iceConnectionStateChange.subscribe((s) => {
        if (s === 'connected') { clearTimeout(t); resolve(); }
        if (s === 'failed') { clearTimeout(t); reject(new Error('SFU connection failed')); }
      });
    });
    if (this.closed) return;
    // The bot's audio.
    this.track = new MediaStreamTrack({ kind: 'audio' });
    const tx = pc.addTransceiver(this.track, { direction: 'sendonly' });
    const trackName = trackNameFor(this.grant.botId, 'audio');
    const published = await publishTracks(this.sessionId, await this.offer(), [{ mid: tx.mid!, trackName }]);
    if (published.sessionDescription) await pc.setRemoteDescription(published.sessionDescription);
    const { setParticipantSfu } = await import('@/lib/api/voice');
    setParticipantSfu(this.grant.roomId, this.grant.botId, this.sessionId, { audio: trackName });
    // Everyone else's audio, kept in step with the room.
    this.timer = setInterval(() => void this.reconcile(), RECONCILE_MS);
    void this.reconcile();
  }

  /** Opus from the bot: forwarded as the bot's track (its own timestamps, our sequence / SSRC). */
  fromBot(opus: Uint8Array, _sequence: number, timestamp: number) {
    if (!this.track || this.closed) return;
    this.seq = (this.seq + 1) & 0xffff;
    const header = new RtpHeader({ payloadType: 111, sequenceNumber: this.seq, timestamp, ssrc: this.ssrc, marker: false });
    this.track.writeRtp(new RtpPacket(header, Buffer.from(opus)));
  }

  private async reconcile() {
    if (this.busy || this.closed || !this.pc || !this.sessionId) return;
    this.busy = true;
    try {
      const { voiceParticipantIn, voiceParticipantsOf } = await import('@/lib/api/voice');
      const me = voiceParticipantIn(this.grant.roomId, this.grant.botId);
      if (!me) return;
      const want = new Map<string, string>(); // userId → track name
      if (!this.grant.selfDeaf && !me.deafened) {
        for (const p of voiceParticipantsOf(this.grant.roomId)) {
          if (p.userId === this.grant.botId) continue;
          if (wantedKinds(p, { serverDeaf: me.serverDeaf === true }).includes('audio')) want.set(p.userId, p.tracks!.audio);
        }
      }
      // Gone, muted, or republished under a new name: stop pulling.
      const stale = [...this.pulled.entries()].filter(([userId, p]) => want.get(userId) !== p.trackName);
      if (stale.length) {
        for (const [userId, p] of stale) { this.pulled.delete(userId); this.byMid.delete(p.mid); }
        await closeTracks(this.sessionId, stale.map(([, p]) => p.mid)).catch(() => {});
        this.onLeft(stale.map(([userId]) => userId));
      }
      const missing = [...want.entries()].filter(([userId]) => !this.pulled.has(userId));
      if (missing.length === 0) return;
      const publishers = voiceParticipantsOf(this.grant.roomId);
      const res = await pullTracks(this.sessionId, missing.map(([userId, trackName]) => ({
        sessionId: publishers.find((p) => p.userId === userId)!.sfuSession!,
        trackName,
      })));
      (res.tracks ?? []).forEach((tr, i) => {
        const [userId, trackName] = missing.find(([, name]) => name === tr.trackName) ?? missing[i] ?? [];
        if (!userId || !trackName || tr.errorCode || !tr.mid) return;
        this.pulled.set(userId, { trackName, mid: tr.mid });
        this.byMid.set(tr.mid, userId);
        void recordPull(this.grant.roomId, this.grant.botId, userId, 'audio', this.sessionId!, tr.mid);
      });
      if (res.requiresImmediateRenegotiation && res.sessionDescription) {
        await this.pc.setRemoteDescription(res.sessionDescription);
        await this.pc.setLocalDescription(await this.pc.createAnswer());
        await renegotiate(this.sessionId, { type: 'answer', sdp: this.pc.localDescription!.sdp });
      }
    } catch (err) {
      console.warn('[bot-voice] reconcile failed:', (err as Error)?.message ?? err);
    } finally {
      this.busy = false;
    }
  }

  close() {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    void this.pc?.close().catch?.(() => {});
    this.pc = null;
    this.track = null;
  }
}
