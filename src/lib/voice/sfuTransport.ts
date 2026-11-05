/**
 * The browser's side of an SFU room (docs/architecture/voice-sfu.md): one
 * RTCPeerConnection to Cloudflare Realtime, driven through our
 * /api/voice/sfu/:roomId/* routes (the Realtime token never leaves the
 * server). It publishes this member's mic / camera / screen and pulls what
 * `reconcile` says the room allows; received tracks go to `onTrack`.
 *
 * Every negotiation is serialized: WebRTC offers/answers must not overlap.
 */

export type SfuKind = "audio" | "video" | "screen" | "screenAudio";

export interface SfuPeerView {
  userId: string;
  sfuSession?: string;
  tracks?: Record<string, string>;
  video?: boolean;
  screenShare?: boolean;
  serverMute?: boolean;
  suppress?: boolean;
}

export type SfuTrackHandler = (userId: string, kind: SfuKind, track: MediaStreamTrack | null) => void;

const KINDS: SfuKind[] = ["audio", "video", "screen", "screenAudio"];

/** What this member should be pulling from `peer` (mirrors the server's pullDecision). */
export function wantedKinds(peer: SfuPeerView, me: { serverDeaf?: boolean }): SfuKind[] {
  const out: SfuKind[] = [];
  for (const kind of KINDS) {
    if (!peer.sfuSession || !peer.tracks?.[kind]) continue;
    if (kind === "audio" && (peer.serverMute || peer.suppress || me.serverDeaf)) continue;
    if (kind === "screenAudio" && me.serverDeaf) continue;
    if (kind === "video" && !peer.video) continue;
    if ((kind === "screen" || kind === "screenAudio") && !peer.screenShare) continue;
    out.push(kind);
  }
  return out;
}

type Pulled = { userId: string; kind: SfuKind; trackName: string; mid: string };

export class SfuTransport {
  private pc: RTCPeerConnection | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private local = new Map<SfuKind, RTCRtpTransceiver>();
  private pulled = new Map<string, Pulled>(); // `${userId}|${kind}` → pull
  private byMid = new Map<string, Pulled>();
  private closed = false;

  constructor(
    private readonly roomId: string,
    private readonly iceServers: RTCIceServer[],
    private readonly onTrack: SfuTrackHandler,
    private readonly onFailed: () => void,
  ) {}

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  private async api<T>(path: string, body: unknown, method: "POST" | "PUT" = "POST"): Promise<T> {
    const res = await fetch(`/api/voice/sfu/${encodeURIComponent(this.roomId)}/${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(data.error || `SFU ${path}: ${res.status}`);
    return data;
  }

  private async offer(): Promise<RTCSessionDescriptionInit> {
    const pc = this.pc!;
    await pc.setLocalDescription(await pc.createOffer());
    return { type: "offer", sdp: pc.localDescription!.sdp };
  }

  /** Open the session. Resolves once ICE is connected. */
  start(): Promise<void> {
    return this.serial(async () => {
      const pc = new RTCPeerConnection({ iceServers: this.iceServers, bundlePolicy: "max-bundle" });
      this.pc = pc;
      pc.ontrack = (e) => {
        const info = e.transceiver.mid ? this.byMid.get(e.transceiver.mid) : undefined;
        if (info) this.onTrack(info.userId, info.kind, e.track);
      };
      pc.oniceconnectionstatechange = () => {
        if (!this.closed && pc.iceConnectionState === "failed") this.onFailed();
      };
      // A session needs something to negotiate before it has tracks.
      pc.createDataChannel("serika");
      const { answer } = await this.api<{ answer: RTCSessionDescriptionInit }>("session", { offer: await this.offer() });
      await pc.setRemoteDescription(answer);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("SFU connection timed out")), 15_000);
        const check = () => {
          if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
            clearTimeout(timer);
            resolve();
          } else if (pc.iceConnectionState === "failed") {
            clearTimeout(timer);
            reject(new Error("SFU connection failed"));
          }
        };
        pc.addEventListener("iceconnectionstatechange", check);
        check();
      });
    });
  }

  /** Publish (or swap) this member's track of a kind. */
  publish(kind: SfuKind, track: MediaStreamTrack): Promise<void> {
    return this.serial(async () => {
      if (!this.pc || this.closed) return;
      const existing = this.local.get(kind);
      if (existing) {
        await existing.sender.replaceTrack(track);
        return;
      }
      const tx = this.pc.addTransceiver(track, { direction: "sendonly" });
      const offer = await this.offer();
      const { answer } = await this.api<{ answer: RTCSessionDescriptionInit }>("publish", { offer, tracks: [{ mid: tx.mid, kind }] });
      await this.pc.setRemoteDescription(answer);
      this.local.set(kind, tx);
    });
  }

  /** Swap the source of a published track (another mic / camera), no renegotiation. */
  replaceTrack(old: MediaStreamTrack, next: MediaStreamTrack): void {
    for (const tx of this.local.values()) {
      if (tx.sender.track === old) void tx.sender.replaceTrack(next).catch(() => {});
    }
  }

  unpublish(kind: SfuKind): Promise<void> {
    return this.serial(async () => {
      const tx = this.local.get(kind);
      if (!tx || !this.pc || this.closed) return;
      this.local.delete(kind);
      const mid = tx.mid;
      tx.stop();
      const offer = await this.offer();
      const { answer } = await this.api<{ answer: RTCSessionDescriptionInit | null }>("unpublish", { offer, mids: mid ? [mid] : [], kinds: [kind] });
      if (answer) await this.pc.setRemoteDescription(answer);
    });
  }

  /**
   * Bring the pulls in line with the room: pull what `peers` publish and this
   * member may receive, drop what went away (left, camera off, server muted,
   * republished under a new name). Resolves true when every wanted track is
   * pulled under the name this member sees; false means try again shortly (a
   * refused pull, or the server still had an older track, e.g. a bot that is
   * reconnecting: CORD-93).
   */
  reconcile(peers: SfuPeerView[], me: { serverDeaf?: boolean }): Promise<boolean> {
    return this.serial(async () => {
      if (!this.pc || this.closed) return true;
      const want = new Map<string, { userId: string; kind: SfuKind; trackName: string }>();
      for (const peer of peers) {
        for (const kind of wantedKinds(peer, me)) {
          want.set(`${peer.userId}|${kind}`, { userId: peer.userId, kind, trackName: peer.tracks![kind] });
        }
      }
      const stale = [...this.pulled.entries()].filter(([key, p]) => want.get(key)?.trackName !== p.trackName);
      if (stale.length) await this.drop(stale.map(([, p]) => p));
      const missing = [...want.entries()].filter(([key]) => !this.pulled.has(key)).map(([, w]) => w);
      if (missing.length) await this.pull(missing);
      return [...want.entries()].every(([key, w]) => this.pulled.get(key)?.trackName === w.trackName);
    });
  }

  private async pull(list: Array<{ userId: string; kind: SfuKind; trackName: string }>): Promise<void> {
    const pc = this.pc!;
    const res = await this.api<{
      offer: RTCSessionDescriptionInit | null;
      pulled: Array<{ userId: string; kind: SfuKind; mid: string; trackName?: string }>;
      refused?: Array<{ userId: string; kind: string; reason: string }>;
    }>("pull", { tracks: list.map(({ userId, kind }) => ({ userId, kind })) });
    if (res.refused?.length) console.warn("[voice] SFU pull refused", res.refused);
    for (const p of res.pulled) {
      // The track the server actually pulled, which can be older than the one
      // this member sees; reconcile then replaces it.
      const trackName = p.trackName ?? list.find((w) => w.userId === p.userId && w.kind === p.kind)?.trackName ?? "";
      const entry = { userId: p.userId, kind: p.kind, mid: p.mid, trackName };
      this.pulled.set(`${p.userId}|${p.kind}`, entry);
      this.byMid.set(p.mid, entry);
    }
    if (res.offer) {
      await pc.setRemoteDescription(res.offer);
      await pc.setLocalDescription(await pc.createAnswer());
      await this.api("renegotiate", { answer: { type: "answer", sdp: pc.localDescription!.sdp } }, "PUT");
    }
  }

  private async drop(list: Pulled[]): Promise<void> {
    const pc = this.pc!;
    for (const p of list) {
      this.pulled.delete(`${p.userId}|${p.kind}`);
      this.byMid.delete(p.mid);
      pc.getTransceivers().find((t) => t.mid === p.mid)?.stop();
      this.onTrack(p.userId, p.kind, null);
    }
    const offer = await this.offer();
    const { answer } = await this.api<{ answer: RTCSessionDescriptionInit | null }>("drop", {
      offer,
      mids: list.map((p) => p.mid),
      tracks: list.map(({ userId, kind }) => ({ userId, kind })),
    });
    if (answer) await pc.setRemoteDescription(answer);
  }

  close(): void {
    this.closed = true;
    try { this.pc?.close(); } catch { /* already closed */ }
    this.pc = null;
    this.local.clear();
    this.pulled.clear();
    this.byMid.clear();
  }
}
