"use client";

import { useState, useRef, useCallback } from "react";
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
  const imgRef = useRef<HTMLImageElement>(null);

  const onImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const { width, height } = e.currentTarget;
      setCrop(centerAspectCrop(width, height, aspectRatio));
    },
    [aspectRatio]
  );

  const getCroppedImg = useCallback(async (): Promise<Blob | null> => {
    const image = imgRef.current;
    if (!image || !crop) return null;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const scaleX = image.naturalWidth / image.width;
    const scaleY = image.naturalHeight / image.height;

    // Calculate crop dimensions in natural image coordinates
    const cropX = (crop.x / 100) * image.width * scaleX;
    const cropY = (crop.y / 100) * image.height * scaleY;
    const cropWidth = (crop.width / 100) * image.width * scaleX;
    const cropHeight = (crop.height / 100) * image.height * scaleY;

    // Set canvas size to crop size
    const outputWidth = Math.min(cropWidth, 1024); // Max 1024px
    const outputHeight = Math.min(cropHeight, 1024);
    canvas.width = outputWidth;
    canvas.height = outputHeight;

    // Scale factor for output
    const outputScale = outputWidth / cropWidth;

    // Draw the cropped image
    ctx.drawImage(
      image,
      cropX,
      cropY,
      cropWidth,
      cropHeight,
      0,
      0,
      outputWidth,
      outputHeight
    );

    // Convert to blob
    return new Promise((resolve) => {
      canvas.toBlob(
        (blob) => {
          resolve(blob);
        },
        "image/png",
        0.95
      );
    });
  }, [crop]);

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
    if (imgRef.current) {
      const { width, height } = imgRef.current;
      setCrop(centerAspectCrop(width, height, aspectRatio));
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
              <img
                ref={imgRef}
                src={imageUrl}
                alt={gt("Crop preview")}
                style={{ transform: `scale(${scale})` }}
                onLoad={onImageLoad}
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
