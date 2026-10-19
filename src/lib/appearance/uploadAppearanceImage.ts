"use client";

/**
 * Upload an app background (CORD-46) or nameplate image (CORD-44) through
 * POST /api/upload/appearance/:kind. Resolves to the CDN URL, which is then
 * saved via the settings / profile PATCH (validated there again).
 */
export async function uploadAppearanceImage(kind: "background" | "nameplate", file: File | Blob): Promise<string> {
  const formData = new FormData();
  formData.append("file", file, file instanceof File ? file.name : `${kind}.png`);
  const response = await fetch(`/api/upload/appearance/${kind}`, { method: "POST", body: formData });
  const data = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!response.ok || typeof data.url !== "string") {
    throw new Error(data.error || "Upload failed");
  }
  return data.url;
}
