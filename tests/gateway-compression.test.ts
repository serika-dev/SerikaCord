import { describe, expect, test } from "bun:test";
import * as zlib from "node:zlib";
import { ZlibStreamCompressor, parseCompression } from "@/lib/gateway/compression";

describe("zlib-stream gateway compression", () => {
  test("every frame ends with the sync-flush marker and inflates in order with one context", async () => {
    const frames: Uint8Array[] = [];
    const c = new ZlibStreamCompressor((d) => frames.push(d));
    const payloads = Array.from({ length: 20 }, (_, i) => JSON.stringify({ op: 0, s: i, d: { n: i, text: "x".repeat(i * 50) } }));
    for (const p of payloads) c.send(p);
    await new Promise((r) => setTimeout(r, 50));
    expect(frames.length).toBe(payloads.length);
    const inflate = zlib.createInflate();
    const out: string[] = [];
    for (const f of frames) {
      expect([...f.slice(-4)]).toEqual([0, 0, 0xff, 0xff]);
      const text = await new Promise<string>((resolve) => {
        const parts: Buffer[] = [];
        const onData = (b: Buffer) => parts.push(b);
        inflate.on("data", onData);
        inflate.write(f, () => {
          inflate.flush(zlib.constants.Z_SYNC_FLUSH, () => {
            inflate.off("data", onData);
            resolve(Buffer.concat(parts).toString());
          });
        });
      });
      out.push(text);
    }
    expect(out).toEqual(payloads);
    c.close();
  });

  test("parseCompression", () => {
    expect(parseCompression("zlib-stream")).toBe("zlib-stream");
    expect(parseCompression("zstd-stream")).toBeNull();
    expect(parseCompression(null)).toBeNull();
  });
});
