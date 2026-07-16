"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { cdnImage } from "@/lib/utils";
import ReactCrop, { type Crop, centerCrop, makeAspectCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { useGT } from "gt-next";

interface ImageCropperProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl: string;
  aspectRatio?: number; // e.g., 1 for square (avatar), 3 for banner (3:1)
  onCropComplete: (croppedImageBlob: Blob) => void;
  title?: string;
  description?: string;
  circular?: boolean;
}

function centerAspectCrop(
  mediaWidth: number,
  mediaHeight: number,
  aspect: number
): Crop {
  return centerCrop(
    makeAspectCrop(
      {
        unit: "%",
        width: 90,
      },
      aspect,
      mediaWidth,
      mediaHeight
    ),
    mediaWidth,
    mediaHeight
  );
}

/**
 * Detect whether a File/URL points to an animated GIF by reading the first
 * handful of bytes and scanning for the Netscape animation extension block.
 */
async function isAnimatedGif(url: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    // GIF89a magic
    if (bytes[0] !== 0x47 || bytes[1] !== 0x49 || bytes[2] !== 0x46) return false;
    // Look for the NETSCAPE2.0 application extension (marks animation)
    const needle = [0x21, 0xff, 0x0b]; // extension introducer + app ext label + block size 11
    for (let i = 0; i < bytes.length - 18; i++) {
      if (bytes[i] === needle[0] && bytes[i + 1] === needle[1] && bytes[i + 2] === needle[2]) {
        // Check "NETSCAPE" string
        const tag = String.fromCharCode(...bytes.slice(i + 3, i + 11));
        if (tag === "NETSCAPE") return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

export function ImageCropper({
  open,
  onOpenChange,
  imageUrl,
  aspectRatio = 1,
  onCropComplete,
  title,
  description,
  circular = false,
}: ImageCropperProps) {
  const gt = useGT();
  const resolvedTitle = title ?? gt("Crop Image");
  const resolvedDescription = description ?? gt("Adjust the crop area to select the portion of the image you want to use.");
  const [crop, setCrop] = useState<Crop>();
  const [scale, setScale] = useState(1);
  const [isProcessing, setIsProcessing] = useState(false);
  // Track the *displayed* dimensions (set once on load, never mutated by zoom)
  const [displaySize, setDisplaySize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const imgRef = useRef<HTMLImageElement>(null);
  const [isGif, setIsGif] = useState(false);

  // Check if source is animated GIF whenever the URL changes
  useEffect(() => {
    if (!imageUrl) return;
    let cancelled = false;
    isAnimatedGif(imageUrl).then((animated) => {
      if (!cancelled) setIsGif(animated);
    });
    return () => { cancelled = true; };
  }, [imageUrl]);

  const onImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const { naturalWidth, naturalHeight } = e.currentTarget;
      setDisplaySize({ w: naturalWidth, h: naturalHeight });
      setCrop(centerAspectCrop(naturalWidth, naturalHeight, aspectRatio));
    },
    [aspectRatio]
  );

  // Re-center crop when aspect ratio changes
  useEffect(() => {
    if (displaySize.w > 0 && displaySize.h > 0) {
      setCrop(centerAspectCrop(displaySize.w, displaySize.h, aspectRatio));
    }
  }, [aspectRatio, displaySize]);

  // Reset scale when dialog opens with new image
  useEffect(() => {
    if (open) setScale(1);
  }, [open, imageUrl]);

  /**
   * Produce a correctly-cropped Blob.
   *
   * The crop coordinates from react-image-crop are percentage-based and always
   * relative to the *natural* image dimensions (because we feed naturalWidth /
   * naturalHeight to the centerAspectCrop helper). We convert those percentages
   * to pixel offsets inside the natural image and draw the sub-rectangle onto a
   * canvas.
   *
   * For animated GIFs we skip the canvas entirely and just pass the original
   * file through — canvas.toBlob always flattens to a single frame.
   */
  const getCroppedImg = useCallback(async (): Promise<Blob | null> => {
    const image = imgRef.current;
    if (!image || !crop) return null;

    const { naturalWidth, naturalHeight } = image;

    // Convert percentage crop → natural-pixel crop
    const pixelCropX = (crop.x / 100) * naturalWidth;
    const pixelCropY = (crop.y / 100) * naturalHeight;
    const pixelCropW = (crop.width / 100) * naturalWidth;
    const pixelCropH = (crop.height / 100) * naturalHeight;

    // For animated GIFs, return the original blob untouched (canvas would
    // destroy frames). A proper GIF-frame crop would require a library like
    // gif.js — for now we preserve animation at the cost of not pixel-cropping.
    if (isGif) {
      const res = await fetch(imageUrl);
      return res.blob();
    }

    // Determine output size — cap the *longest* edge at 1024 px and scale the
    // other edge proportionally so the aspect ratio is preserved.
    const maxEdge = 1024;
    let outW = pixelCropW;
    let outH = pixelCropH;
    if (outW > maxEdge || outH > maxEdge) {
      const ratio = Math.min(maxEdge / outW, maxEdge / outH);
      outW = Math.round(outW * ratio);
      outH = Math.round(outH * ratio);
    }

    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // Use high-quality scaling
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    ctx.drawImage(
      image,
      pixelCropX,  // source x
      pixelCropY,  // source y
      pixelCropW,  // source width
      pixelCropH,  // source height
      0,           // dest x
      0,           // dest y
      outW,        // dest width
      outH         // dest height
    );

    return new Promise((resolve) => {
      canvas.toBlob(
        (blob) => resolve(blob),
        "image/png",
        0.95
      );
    });
  }, [crop, isGif, imageUrl]);

  const handleSave = async () => {
    setIsProcessing(true);
    try {
      const croppedBlob = await getCroppedImg();
      if (croppedBlob) {
        onCropComplete(croppedBlob);
        onOpenChange(false);
      }
    } catch (error) {
      console.error("Error cropping image:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReset = () => {
    setScale(1);
    if (displaySize.w > 0) {
      setCrop(centerAspectCrop(displaySize.w, displaySize.h, aspectRatio));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{resolvedTitle}</DialogTitle>
          <DialogDescription>{resolvedDescription}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Crop Area */}
          <div className="flex items-center justify-center bg-black/20 rounded-lg p-2 max-h-[400px] overflow-hidden">
            <ReactCrop
              crop={crop}
              onChange={(_, percentCrop) => setCrop(percentCrop)}
              aspect={aspectRatio}
              circularCrop={circular}
              className="max-w-full max-h-[380px]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imgRef}
                src={cdnImage(imageUrl)}
                alt={gt("Crop preview")}
                onLoad={onImageLoad}
                style={{
                  transform: `scale(${scale})`,
                  transformOrigin: "center center",
                }}
                className="max-w-full max-h-[380px] object-contain"
              />
            </ReactCrop>
          </div>

          {/* Zoom Controls */}
          <div className="flex items-center gap-4">
            <ZoomOut className="h-4 w-4 text-muted-foreground" />
            <Slider
              value={[scale]}
              onValueChange={(values: number[]) => setScale(values[0])}
              min={0.5}
              max={2}
              step={0.1}
              className="flex-1"
            />
            <ZoomIn className="h-4 w-4 text-muted-foreground" />
            <Button variant="ghost" size="icon" onClick={handleReset}>
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {gt("Cancel")}
          </Button>
          <Button
            onClick={handleSave}
            disabled={isProcessing}
            className="bg-[#8B5CF6] hover:bg-[#7C3AED] text-white disabled:opacity-60"
          >
            {isProcessing ? gt("Processing...") : gt("Apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
