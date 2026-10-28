"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { MountWhenOpened } from "@/components/ui/MountWhenOpened";
import {
  CROP_PRESETS,
  decideCrop,
  initialView,
  isAnimatedImage,
  type CropFrame,
  type CropPreset,
  type CropPresetId,
} from "@/lib/media/imageCrop";
import type { CropRequest } from "@/components/ui/ImageCropDialog";

const ImageCropDialog = dynamic(() => import("@/components/ui/ImageCropDialog").then((m) => m.ImageCropDialog), { ssr: false });

/** Bytes needed to tell an animated GIF / APNG / WebP from a still one. */
const SNIFF_BYTES = 8 * 1024 * 1024;

async function decode(url: string): Promise<HTMLImageElement | null> {
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  try {
    await img.decode();
    return img.naturalWidth > 0 && img.naturalHeight > 0 ? img : null;
  } catch {
    return null;
  }
}

async function sniffAnimated(file: File): Promise<boolean> {
  if (!/^image\/(gif|png|apng|webp)$/.test(file.type)) return false;
  try {
    return isAnimatedImage(new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer()));
  } catch {
    return false;
  }
}

async function autoResize(img: HTMLImageElement, preset: CropPreset, frame: CropFrame, name: string): Promise<File | null> {
  try {
    const { renderCropToFile } = await import("@/lib/media/renderCrop");
    const geom = { width: img.naturalWidth, height: img.naturalHeight, ratio: frame.ratio, allowFit: false };
    return await renderCropToFile(img, geom, initialView(geom, false), frame, preset, name);
  } catch {
    return null;
  }
}

/**
 * Shared "make this image fit its field" step for every image upload.
 *
 *   const cropper = useImageCropper();
 *   const ready = await cropper.prepare(file, "avatar"); // File, or null if cancelled
 *   ...render {cropper.element} once.
 *
 * Right-shaped images upload untouched (static ones that are far too big are
 * scaled down without asking); anything else opens the crop dialog, which
 * loads its chunk on first use. Animated images are only flattened when the
 * user explicitly crops them.
 */
export function useImageCropper(): {
  prepare: (file: File, preset: CropPresetId) => Promise<File | null>;
  element: ReactNode;
} {
  const [request, setRequest] = useState<CropRequest | null>(null);
  const [open, setOpen] = useState(false);
  const pending = useRef<{ resolve: (file: File | null) => void; url: string } | null>(null);
  const seq = useRef(0);

  const settle = useCallback((file: File | null) => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    p.resolve(file);
    // Keep the preview alive through the close animation.
    window.setTimeout(() => URL.revokeObjectURL(p.url), 1000);
  }, []);

  // Never leave a caller awaiting forever if the host unmounts mid-crop.
  useEffect(() => () => settle(null), [settle]);

  const prepare = useCallback(async (file: File, presetId: CropPresetId): Promise<File | null> => {
    if (!file.type.startsWith("image/")) return file;
    const preset = CROP_PRESETS[presetId];
    const url = URL.createObjectURL(file);
    const [img, animated] = await Promise.all([decode(url), sniffAnimated(file)]);
    const decision = img
      ? decideCrop({ width: img.naturalWidth, height: img.naturalHeight, type: file.type, size: file.size, animated }, preset)
      : ({ kind: "upload" } as const);

    if (decision.kind !== "crop" || !img) {
      const out = decision.kind === "resize" && img ? await autoResize(img, preset, decision.frame, file.name) : null;
      URL.revokeObjectURL(url);
      return out ?? file;
    }

    settle(null); // a newer pick replaces one still open
    return new Promise<File | null>((resolve) => {
      pending.current = { resolve, url };
      seq.current += 1;
      setRequest({
        id: seq.current,
        file,
        url,
        width: img.naturalWidth,
        height: img.naturalHeight,
        animated: decision.animated,
        preset,
        frame: decision.frame,
      });
      setOpen(true);
    });
  }, [settle]);

  const onDone = useCallback((file: File | null) => {
    setOpen(false);
    settle(file);
  }, [settle]);

  const element = (
    <MountWhenOpened open={open}>
      {request && <ImageCropDialog key={request.id} open={open} request={request} onDone={onDone} />}
    </MountWhenOpened>
  );

  return { prepare, element };
}
