"use client";

// Encrypted attachments off the UI thread: a module Web Worker
// (fileWorker.ts) encrypts / decrypts files with transferred buffers. The
// worker must answer a ping before any file is handed over (a transferred
// buffer can't be taken back); where it can't start (old WebViews, blocked
// worker scripts) the same code runs here instead, with identical results.
import {
  E2eeFormatError,
  E2eeVerifyError,
  decryptAttachment,
  encryptAttachment,
  type AttachmentSecret,
  type EncryptedAttachment,
} from "@/lib/e2ee";

type Pending = { resolve: (value: unknown) => void; reject: (err: unknown) => void };
type Reply = { id: number; ok: boolean; result?: unknown; error?: { name: string; message: string; code?: string } };

const READY_TIMEOUT_MS = 4000;

let workerReady: Promise<Worker | null> | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function failAll(err: unknown) {
  for (const p of pending.values()) p.reject(err);
  pending.clear();
}

function post(w: Worker, message: Record<string, unknown>, transfer: Transferable[]): Promise<unknown> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      w.postMessage({ ...message, id }, transfer);
    } catch (err) {
      pending.delete(id);
      reject(err);
    }
  });
}

/** The worker once it answered a ping; null when workers can't be used here. */
function getWorker(): Promise<Worker | null> {
  if (workerReady) return workerReady;
  workerReady = (async () => {
    let w: Worker;
    try {
      if (typeof Worker === "undefined") return null;
      w = new Worker(new URL("./fileWorker.ts", import.meta.url), { type: "module", name: "serika-e2ee-files" });
    } catch {
      return null;
    }
    w.onmessage = (ev: MessageEvent<Reply>) => {
      const msg = ev.data;
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.ok) {
        p.resolve(msg.result);
        return;
      }
      const e = msg.error;
      p.reject(e?.name === "E2eeVerifyError"
        ? new E2eeVerifyError(e.code ?? "attachment", e.message)
        : e?.name === "E2eeFormatError" ? new E2eeFormatError(e.message) : new Error(e?.message ?? "Failed"));
    };
    w.onerror = () => {
      // Failed to load, or crashed: never used again (later files run inline).
      workerReady = Promise.resolve(null);
      w.terminate();
      failAll(new Error("The file worker stopped"));
    };
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), READY_TIMEOUT_MS));
    const pong = await Promise.race([post(w, { op: "ping" }, []).catch(() => null), timeout]);
    if (pong !== "pong") {
      w.terminate();
      return null;
    }
    return w;
  })();
  return workerReady;
}

/** Encrypt a file's bytes (the buffer may be handed to the worker: don't reuse it). */
export async function encryptFileBytes(data: ArrayBuffer): Promise<EncryptedAttachment> {
  const w = await getWorker();
  if (!w) return encryptAttachment(data);
  const r = (await post(w, { op: "encrypt", data }, [data])) as { blob: ArrayBuffer; blobName: string; key: string; iv: string; sha256: string };
  return { blob: new Uint8Array(r.blob), blobName: r.blobName, key: r.key, iv: r.iv, sha256: r.sha256 };
}

/** Decrypt a downloaded blob and check its hash (the buffer may be handed to the worker). */
export async function decryptFileBytes(data: ArrayBuffer, secret: AttachmentSecret): Promise<Uint8Array<ArrayBuffer>> {
  const w = await getWorker();
  if (!w) return decryptAttachment(data, secret);
  const plain = (await post(w, { op: "decrypt", data, secret: { key: secret.key, iv: secret.iv, sha256: secret.sha256 } }, [data])) as ArrayBuffer;
  return new Uint8Array(plain);
}
