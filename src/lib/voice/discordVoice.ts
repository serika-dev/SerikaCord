/**
 * Discord voice protocol, the media half (docs/architecture/voice-sfu.md):
 * UDP IP discovery and RTP transport encryption, as @discordjs/voice and
 * discord.py speak it. Pure: no sockets here.
 *
 * Both modes are "rtpsize": the RTP header (with CSRCs and, if present, the
 * 4-byte extension header) is the AAD, everything after it (extension body +
 * Opus payload) is encrypted, and a 32-bit nonce counter is appended to the
 * packet. The cipher nonce is that counter followed by zeros (12 bytes for
 * AES-256-GCM, 24 for XChaCha20-Poly1305).
 */
import { createCipheriv, createDecipheriv } from 'node:crypto';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';

export const VOICE_MODES = ['aead_aes256_gcm_rtpsize', 'aead_xchacha20_poly1305_rtpsize'] as const;
export type VoiceMode = (typeof VOICE_MODES)[number];

export function isVoiceMode(v: unknown): v is VoiceMode {
  return typeof v === 'string' && (VOICE_MODES as readonly string[]).includes(v);
}

// ─── IP discovery ───────────────────────────────────────────

export const IP_DISCOVERY_SIZE = 74;

/** The SSRC of an IP discovery request (type 1, length 70), else null. */
export function parseIpDiscoveryRequest(buf: Uint8Array): number | null {
  if (buf.length !== IP_DISCOVERY_SIZE) return null;
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (v.getUint16(0) !== 1 || v.getUint16(2) !== 70) return null;
  return v.getUint32(4);
}

/** Type 2 response: the address and port we saw the request come from. */
export function ipDiscoveryResponse(ssrc: number, address: string, port: number): Buffer {
  const out = Buffer.alloc(IP_DISCOVERY_SIZE);
  out.writeUInt16BE(2, 0);
  out.writeUInt16BE(70, 2);
  out.writeUInt32BE(ssrc >>> 0, 4);
  out.write(address.slice(0, 63), 8, 'ascii');
  out.writeUInt16BE(port, 72);
  return out;
}

// ─── RTP ────────────────────────────────────────────────────

export interface RtpInfo {
  /** Bytes of header that are authenticated, not encrypted (incl. the 4-byte extension header). */
  aadLength: number;
  /** Bytes of extension body at the start of the decrypted payload. */
  extensionBody: number;
  padding: boolean;
  payloadType: number;
  sequence: number;
  timestamp: number;
  ssrc: number;
}

/** Parse an RTP header; null for anything that isn't RTP v2 (RTCP is 200–207). */
export function parseRtp(buf: Uint8Array): RtpInfo | null {
  if (buf.length < 12) return null;
  const b0 = buf[0];
  if (b0 >> 6 !== 2) return null;
  const pt = buf[1] & 0x7f;
  if (pt >= 72 && pt <= 76) return null; // RTCP (200–204 with the marker bit) — not media
  const cc = b0 & 0x0f;
  let aad = 12 + cc * 4;
  let ext = 0;
  if (b0 & 0x10) {
    if (buf.length < aad + 4) return null;
    ext = ((buf[aad + 2] << 8) | buf[aad + 3]) * 4;
    aad += 4;
  }
  if (buf.length < aad) return null;
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return {
    aadLength: aad,
    extensionBody: ext,
    padding: (b0 & 0x20) !== 0,
    payloadType: pt,
    sequence: v.getUint16(2),
    timestamp: v.getUint32(4),
    ssrc: v.getUint32(8),
  };
}

function cipherNonce(mode: VoiceMode, counter: Uint8Array): Uint8Array {
  const n = new Uint8Array(mode === 'aead_aes256_gcm_rtpsize' ? 12 : 24);
  n.set(counter.subarray(0, 4), 0);
  return n;
}

/**
 * Decrypt a packet from a bot: the Opus payload (extension body and padding
 * removed), or null when it doesn't authenticate.
 */
export function decryptRtp(mode: VoiceMode, key: Uint8Array, packet: Uint8Array): { info: RtpInfo; opus: Uint8Array } | null {
  const info = parseRtp(packet);
  if (!info || packet.length < info.aadLength + 16 + 4) return null;
  const aad = packet.subarray(0, info.aadLength);
  const counter = packet.subarray(packet.length - 4);
  const sealed = packet.subarray(info.aadLength, packet.length - 4);
  let plain: Uint8Array;
  try {
    if (mode === 'aead_aes256_gcm_rtpsize') {
      const d = createDecipheriv('aes-256-gcm', key, cipherNonce(mode, counter));
      d.setAAD(aad);
      d.setAuthTag(sealed.subarray(sealed.length - 16));
      plain = Buffer.concat([d.update(sealed.subarray(0, sealed.length - 16)), d.final()]);
    } else {
      plain = xchacha20poly1305(key, cipherNonce(mode, counter), aad).decrypt(sealed);
    }
  } catch {
    return null;
  }
  let end = plain.length;
  if (info.padding && end > 0) end -= plain[end - 1];
  const start = info.extensionBody;
  if (end <= start) return { info, opus: new Uint8Array(0) };
  return { info, opus: plain.subarray(start, end) };
}

/** A 12-byte RTP header as Discord sends voice (payload type 120, no extension). */
export function rtpHeader(sequence: number, timestamp: number, ssrc: number): Buffer {
  const h = Buffer.alloc(12);
  h[0] = 0x80;
  h[1] = 0x78;
  h.writeUInt16BE(sequence & 0xffff, 2);
  h.writeUInt32BE(timestamp >>> 0, 4);
  h.writeUInt32BE(ssrc >>> 0, 8);
  return h;
}

/** Encrypt an Opus frame toward a bot: header ‖ sealed payload ‖ 4-byte nonce counter. */
export function encryptRtp(mode: VoiceMode, key: Uint8Array, header: Uint8Array, opus: Uint8Array, nonceCounter: number): Buffer {
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(nonceCounter >>> 0, 0);
  let sealed: Uint8Array;
  if (mode === 'aead_aes256_gcm_rtpsize') {
    const c = createCipheriv('aes-256-gcm', key, cipherNonce(mode, counter));
    c.setAAD(header);
    sealed = Buffer.concat([c.update(opus), c.final(), c.getAuthTag()]);
  } else {
    sealed = xchacha20poly1305(key, cipherNonce(mode, counter), header).encrypt(opus);
  }
  return Buffer.concat([header, sealed, counter]);
}
