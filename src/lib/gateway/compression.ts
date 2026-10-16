/**
 * Gateway transport compression (`?compress=zlib-stream`): one zlib deflate
 * context per connection, flushed with Z_SYNC_FLUSH after every payload, so
 * each WebSocket binary message ends with 00 00 FF FF and the client inflates
 * the whole session with one shared context (Discord's scheme; discord.py and
 * discord.js both use it).
 *
 * zlib streams are asynchronous; payloads are written in order and every
 * flush callback emits exactly the bytes produced since the previous one, so
 * frames stay in order.
 */
import * as zlib from 'node:zlib';

export type GatewayCompression = 'zlib-stream' | null;

/** The transport compression a client asked for (anything unknown = none: plain text frames). */
export function parseCompression(value: string | null | undefined): GatewayCompression {
  return value === 'zlib-stream' ? 'zlib-stream' : null;
}

export class ZlibStreamCompressor {
  private readonly z: zlib.Deflate;
  private chunks: Buffer[] = [];
  private closed = false;

  constructor(private readonly out: (data: Uint8Array) => void) {
    // memLevel 8 / windowBits 15: Discord-compatible (clients use a default inflate context).
    this.z = zlib.createDeflate({ level: 6, memLevel: 8, windowBits: 15 });
    this.z.on('data', (c: Buffer) => { this.chunks.push(c); });
    this.z.on('error', () => { this.closed = true; });
  }

  send(text: string) {
    if (this.closed) return;
    this.z.write(text);
    this.z.flush(zlib.constants.Z_SYNC_FLUSH, () => {
      if (this.chunks.length === 0) return;
      const buf = this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks);
      this.chunks = [];
      try { this.out(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)); } catch { /* socket closing */ }
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try { this.z.close(); } catch { /* already closed */ }
  }
}
