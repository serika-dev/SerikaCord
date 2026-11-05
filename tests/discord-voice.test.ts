import { describe, expect, test } from "bun:test";
import { createCipheriv, randomBytes } from "node:crypto";
import {
  decryptRtp, encryptRtp, ipDiscoveryResponse, parseIpDiscoveryRequest, parseRtp, rtpHeader, VOICE_MODES,
} from "@/lib/voice/discordVoice";

const opus = new Uint8Array([0xfc, 0xff, 0xfe, 1, 2, 3, 4, 5]);

describe("Discord voice transport encryption", () => {
  for (const mode of VOICE_MODES) {
    test(`${mode}: round trip`, () => {
      const key = randomBytes(32);
      const packet = encryptRtp(mode, key, rtpHeader(7, 960, 42), opus, 5);
      expect(packet.length).toBe(12 + opus.length + 16 + 4);
      expect(packet.readUInt32BE(packet.length - 4)).toBe(5);
      const out = decryptRtp(mode, key, packet);
      expect(out?.info.sequence).toBe(7);
      expect(out?.info.ssrc).toBe(42);
      expect([...out!.opus]).toEqual([...opus]);
    });

    test(`${mode}: a tampered header or the wrong key fails`, () => {
      const key = randomBytes(32);
      const packet = encryptRtp(mode, key, rtpHeader(7, 960, 42), opus, 5);
      const tampered = Buffer.from(packet);
      tampered[3] ^= 1; // sequence is authenticated
      expect(decryptRtp(mode, key, tampered)).toBeNull();
      expect(decryptRtp(mode, randomBytes(32), packet)).toBeNull();
    });
  }

  test("aes-gcm matches the @discordjs/voice construction (12-byte nonce = counter ‖ zeros)", () => {
    const key = randomBytes(32);
    const header = rtpHeader(1, 960, 99);
    const nonce = Buffer.alloc(12);
    nonce.writeUInt32BE(77, 0);
    const c = createCipheriv("aes-256-gcm", key, nonce);
    c.setAAD(header);
    const reference = Buffer.concat([header, c.update(opus), c.final(), c.getAuthTag(), nonce.subarray(0, 4)]);
    expect(encryptRtp("aead_aes256_gcm_rtpsize", key, header, opus, 77).equals(reference)).toBe(true);
  });

  test("a header extension: its header is AAD, its body is decrypted and skipped", () => {
    const key = randomBytes(32);
    // V=2, X=1; one-word extension (profile 0xBEDE, length 1)
    const header = Buffer.concat([rtpHeader(3, 1920, 11), Buffer.from([0xbe, 0xde, 0x00, 0x01])]);
    header[0] |= 0x10;
    const body = Buffer.concat([Buffer.from([0x10, 0xaa, 0x00, 0x00]), Buffer.from(opus)]);
    const nonce = Buffer.alloc(12);
    nonce.writeUInt32BE(9, 0);
    const c = createCipheriv("aes-256-gcm", key, nonce);
    c.setAAD(header);
    const packet = Buffer.concat([header, c.update(body), c.final(), c.getAuthTag(), nonce.subarray(0, 4)]);
    const info = parseRtp(packet)!;
    expect(info.aadLength).toBe(16);
    expect(info.extensionBody).toBe(4);
    expect([...decryptRtp("aead_aes256_gcm_rtpsize", key, packet)!.opus]).toEqual([...opus]);
  });

  test("RTCP and junk are not media", () => {
    expect(parseRtp(Buffer.from([0x80, 0xc8, 0, 6, 0, 0, 0, 1, 0, 0, 0, 0]))).toBeNull();
    expect(parseRtp(Buffer.from([1, 2, 3]))).toBeNull();
  });
});

describe("IP discovery", () => {
  test("request → response with the observed address and port", () => {
    const req = Buffer.alloc(74);
    req.writeUInt16BE(1, 0);
    req.writeUInt16BE(70, 2);
    req.writeUInt32BE(1234, 4);
    expect(parseIpDiscoveryRequest(req)).toBe(1234);
    const res = ipDiscoveryResponse(1234, "203.0.113.7", 50123);
    expect(res.length).toBe(74);
    expect(res.readUInt16BE(0)).toBe(2);
    expect(res.readUInt32BE(4)).toBe(1234);
    expect(res.subarray(8, 72).toString("ascii").replace(/\0+$/, "")).toBe("203.0.113.7");
    expect(res.readUInt16BE(72)).toBe(50123);
    expect(parseIpDiscoveryRequest(Buffer.alloc(10))).toBeNull();
  });
});
