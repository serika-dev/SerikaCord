// Byte helpers for the E2EE core (isomorphic: browsers, WebViews and Bun).
//
// Every signed / authenticated structure is built with `frame()`: each part is
// written as a 4-byte big-endian length followed by its bytes, so two different
// inputs can never encode to the same byte string (plain `a ‖ b` concatenation
// of variable-length strings is ambiguous: "ab" ‖ "c" = "a" ‖ "bc").

/** A byte array backed by a plain ArrayBuffer (what WebCrypto accepts). */
export type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export function utf8(text: string): Bytes {
  return encoder.encode(text) as Bytes;
}

/** Strict UTF-8 decode: throws on invalid sequences. */
export function fromUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

export function randomBytes(length: number): Bytes {
  const out = new Uint8Array(length);
  crypto.getRandomValues(out);
  return out;
}

/** A copy backed by its own ArrayBuffer (safe to hand to WebCrypto). */
export function toBytes(data: Uint8Array | ArrayBuffer): Bytes {
  const src = data instanceof Uint8Array ? data : new Uint8Array(data);
  const out = new Uint8Array(src.byteLength);
  out.set(src);
  return out;
}

export function concat(...parts: Uint8Array[]): Bytes {
  let length = 0;
  for (const p of parts) length += p.byteLength;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}

/** Length-prefixed concatenation (u32 BE length + bytes per part). */
export function frame(...parts: Array<Uint8Array | string>): Bytes {
  const encoded = parts.map((p) => (typeof p === "string" ? utf8(p) : p));
  let length = 0;
  for (const p of encoded) length += 4 + p.byteLength;
  const out = new Uint8Array(length);
  const view = new DataView(out.buffer);
  let offset = 0;
  for (const p of encoded) {
    view.setUint32(offset, p.byteLength, false);
    offset += 4;
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}

/** Constant-time comparison of two byte arrays (length is not secret). */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

const B64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Whether `value` is canonical standard base64 (with padding). */
export function isBase64(value: unknown): value is string {
  return typeof value === "string" && B64_RE.test(value);
}

export function toB64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.byteLength; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Strict base64 decode. Throws on anything that isn't canonical base64. */
export function fromB64(value: string): Bytes {
  if (!isBase64(value)) throw new E2eeFormatError("Invalid base64");
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Decoded byte length of a canonical base64 string, without decoding it. */
export function b64ByteLength(value: string): number {
  const pad = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - pad;
}

/** base64url without padding (ids). */
export function toB64Url(bytes: Uint8Array): string {
  return toB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Thrown for malformed input (bad base64, wrong sizes, bad shapes). */
export class E2eeFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "E2eeFormatError";
  }
}

/** Thrown when a cryptographic check fails (auth tag, signature, commitment). */
export class E2eeVerifyError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "E2eeVerifyError";
    this.code = code;
  }
}
