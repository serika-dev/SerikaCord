// Module Web Worker for encrypted attachments: encrypting before upload and
// decrypting after download happen here, so the copies and hashing of large
// files never run on the UI thread. Buffers are transferred, not copied.
// Spawned by fileCrypto.ts (which falls back to the main thread when workers
// aren't available). Holds no keys between requests.
import { decryptAttachment, encryptAttachment, type AttachmentSecret } from "@/lib/e2ee/attachments";
import { derivePinKeys } from "@/lib/e2ee/pin";

type Request =
  | { id: number; op: "ping" }
  | { id: number; op: "encrypt"; data: ArrayBuffer }
  | { id: number; op: "decrypt"; data: ArrayBuffer; secret: AttachmentSecret }
  /** The 6-digit PIN's slow key derivation (lib/e2ee/pin.ts): keeps the UI responsive on phones. */
  | { id: number; op: "pin"; pin: string; userId: string; salt: ArrayBuffer; iterations: number };

interface WorkerScope {
  onmessage: ((ev: MessageEvent<Request>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (ev) => {
  const req = ev.data;
  void (async () => {
    try {
      if (req.op === "ping") {
        scope.postMessage({ id: req.id, ok: true, result: "pong" });
      } else if (req.op === "encrypt") {
        const enc = await encryptAttachment(req.data);
        const blob = enc.blob.buffer as ArrayBuffer;
        scope.postMessage({ id: req.id, ok: true, result: { blob, blobName: enc.blobName, key: enc.key, iv: enc.iv, sha256: enc.sha256 } }, [blob]);
      } else if (req.op === "pin") {
        const keys = await derivePinKeys(req.pin, req.userId, new Uint8Array(req.salt), req.iterations);
        const verifier = keys.verifier.buffer as ArrayBuffer;
        const wrap = keys.wrap.buffer as ArrayBuffer;
        scope.postMessage({ id: req.id, ok: true, result: { verifier, wrap } }, [verifier, wrap]);
      } else {
        const plain = await decryptAttachment(req.data, req.secret);
        const buffer = plain.buffer as ArrayBuffer;
        scope.postMessage({ id: req.id, ok: true, result: buffer }, [buffer]);
      }
    } catch (err) {
      const e = err as { name?: string; message?: string; code?: string };
      scope.postMessage({ id: req.id, ok: false, error: { name: e?.name ?? "Error", message: e?.message ?? "Failed", code: e?.code } });
    }
  })();
};
