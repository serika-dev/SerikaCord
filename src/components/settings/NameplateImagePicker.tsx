"use client";

import { useRef, useState } from "react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { ImagePlus, Loader2 } from "lucide-react";
import { uploadAppearanceImage } from "@/lib/appearance/uploadAppearanceImage";
import { useImageCropper } from "@/components/ui/useImageCropper";

/**
 * Nameplate "Image" option (CORD-44): uploads through
 * POST /api/upload/appearance/nameplate and hands back the CDN URL. The
 * profile PATCH only accepts the user's own nameplate uploads.
 */
export function NameplateImagePicker({ hasImage, onUploaded }: { hasImage: boolean; onUploaded: (url: string) => void }) {
  const gt = useGT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const cropper = useImageCropper();

  const onPick = async (picked: File | undefined) => {
    if (fileRef.current) fileRef.current.value = "";
    if (!picked) return;
    // Crop to the nameplate strip so it isn't squashed or cut off at random.
    const file = await cropper.prepare(picked, "nameplate");
    if (!file) return;
    setUploading(true);
    try {
      onUploaded(await uploadAppearanceImage("nameplate", file));
    } catch (error) {
      toast.error(gt("Upload failed: {error}", { error: error instanceof Error ? error.message : "" }));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={(e) => void onPick(e.target.files?.[0])}
      />
      {cropper.element}
      <button
        type="button"
        disabled={uploading}
        onClick={() => fileRef.current?.click()}
        className="h-8 px-3 rounded-md bg-[var(--app-accent)] text-[var(--text-on-accent)] text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
      >
        {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
        {hasImage ? gt("Replace image") : gt("Upload image")}
      </button>
      <span className="text-xs text-[var(--text-muted)]">{gt("JPEG, PNG, GIF or WebP. You can crop it to fit.")}</span>
    </div>
  );
}
