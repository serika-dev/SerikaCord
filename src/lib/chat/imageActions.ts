"use client";

/**
 * "Copy Image" / "Save Image" from the message menu. Browsers only put PNG
 * on the clipboard, so other formats are re-encoded through a canvas. When the
 * image host doesn't allow it (CORS), copying falls back to the image link.
 */

async function fetchBlob(url: string): Promise<Blob> {
  const res = await fetch(url, { mode: "cors", credentials: "omit" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}

async function toPng(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/png"),
  );
}

/** "image" when the picture itself was copied, "link" when only its URL was. */
export async function copyImageToClipboard(url: string): Promise<"image" | "link"> {
  try {
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) throw new Error("unsupported");
    // Safari wants the ClipboardItem created synchronously with a promise.
    await navigator.clipboard.write([new ClipboardItem({ "image/png": fetchBlob(url).then(toPng) })]);
    return "image";
  } catch {
    await navigator.clipboard?.writeText(url);
    return "link";
  }
}

function filenameFor(url: string, type: string): string {
  try {
    const last = new URL(url, window.location.href).pathname.split("/").pop() || "image";
    if (/\.[a-z0-9]{2,5}$/i.test(last)) return decodeURIComponent(last);
    const ext = type.split("/")[1]?.split("+")[0] || "png";
    return `${decodeURIComponent(last)}.${ext}`;
  } catch {
    return "image.png";
  }
}

/** Download the image (falls back to opening it in a new tab). */
export async function saveImage(url: string): Promise<void> {
  try {
    const blob = await fetchBlob(url);
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filenameFor(url, blob.type);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

/**
 * What was right-clicked inside a message: an image (not an emoji) and/or a
 * link, so the menu can offer Copy / Save Image and Copy / Open Link.
 */
export function contextTargetOf(target: EventTarget | null): { imageUrl?: string; linkUrl?: string } {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return {};
  const out: { imageUrl?: string; linkUrl?: string } = {};
  const img = el.closest("img") as HTMLImageElement | null;
  if (img && !img.classList.contains("emoji") && !img.classList.contains("custom-emoji") && img.src && !img.src.startsWith("data:")) {
    out.imageUrl = img.currentSrc || img.src;
  }
  const link = el.closest("a[href]") as HTMLAnchorElement | null;
  if (link && /^https?:/i.test(link.href)) out.linkUrl = link.href;
  return out;
}
