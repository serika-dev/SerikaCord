/**
 * Client side of chunked attachment uploads (src/lib/api/uploads.ts): files
 * over CHUNKED_UPLOAD_THRESHOLD go up in parts so no request hits Cloudflare's
 * 100 MB body limit. Progress is reported as 0–100 over the whole file.
 */

export const CHUNKED_UPLOAD_THRESHOLD = 90 * 1024 * 1024;

export interface UploadedAttachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  url: string;
  spoiler?: boolean;
}

export class UploadError extends Error {}

async function readError(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  return data?.error || fallback;
}

function putPart(url: string, body: Blob, onProgress: (loaded: number) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let msg = "Upload failed";
      try { msg = (JSON.parse(xhr.responseText) as { error?: string }).error || msg; } catch { /* not JSON */ }
      reject(new UploadError(msg));
    };
    xhr.onerror = () => reject(new UploadError("Network error"));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

export async function uploadChunked(
  file: File,
  opts: { channelId?: string; spoiler?: boolean; onProgress?: (percent: number) => void; signal?: AbortSignal },
): Promise<{ attachment: UploadedAttachment; warning?: string }> {
  const start = await fetch("/api/upload/attachment/chunked", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, size: file.size, type: file.type, channelId: opts.channelId, spoiler: opts.spoiler }),
    signal: opts.signal,
  });
  if (!start.ok) throw new UploadError(await readError(start, "Upload failed"));
  const { token, partSize, partCount } = (await start.json()) as { token: string; partSize: number; partCount: number };

  const base = `/api/upload/attachment/chunked/${encodeURIComponent(token)}`;
  try {
    for (let part = 1; part <= partCount; part++) {
      const from = (part - 1) * partSize;
      const blob = file.slice(from, Math.min(from + partSize, file.size));
      // One retry per part: a single dropped request shouldn't lose a 2 GB upload.
      for (let attempt = 0; ; attempt++) {
        try {
          await putPart(`${base}/${part}`, blob, (loaded) => opts.onProgress?.(Math.min(99, Math.round(((from + loaded) / file.size) * 100))), opts.signal);
          break;
        } catch (err) {
          if (attempt >= 1 || opts.signal?.aborted) throw err;
        }
      }
    }
    const done = await fetch(`${base}/complete`, { method: "POST", credentials: "include", signal: opts.signal });
    if (!done.ok) throw new UploadError(await readError(done, "Upload failed"));
    const data = (await done.json()) as { attachment: UploadedAttachment; warning?: string };
    opts.onProgress?.(100);
    return data;
  } catch (err) {
    void fetch(base, { method: "DELETE", credentials: "include" }).catch(() => {});
    throw err;
  }
}
