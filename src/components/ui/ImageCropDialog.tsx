"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { Film, Maximize, Minimize, RotateCcw, RotateCw, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  MAX_ZOOM,
  clampView,
  cropRect,
  initialView,
  minZoomFor,
  outputSize,
  panBy,
  rotateView,
  rotatedSize,
  zoomAt,
  type CropFrame,
  type CropGeometry,
  type CropPreset,
  type CropPresetId,
  type CropView,
} from "@/lib/media/imageCrop";
import { renderCropToFile } from "@/lib/media/renderCrop";

export interface CropRequest {
  id: number;
  file: File;
  /** Object URL of `file` (owned by useImageCropper). */
  url: string;
  width: number;
  height: number;
  animated: boolean;
  preset: CropPreset;
  frame: CropFrame;
}

const STAGE_PADDING = 20;
const ZOOM_STEP = 1.2;
const KEY_PAN = 12;

function useTitle(id: CropPresetId): string {
  const gt = useGT();
  switch (id) {
    case "avatar": return gt("Crop Avatar");
    case "profileBanner": return gt("Crop Banner");
    case "serverIcon": return gt("Crop Server Icon");
    case "serverBanner": return gt("Crop Server Banner");
    case "groupIcon": return gt("Crop Group Icon");
    case "appIcon": return gt("Crop App Icon");
    case "appCover": return gt("Crop Cover Image");
    case "nameplate": return gt("Crop Nameplate");
    case "background": return gt("Crop Background");
    case "eventCover": return gt("Crop Cover Image");
    case "emoji": return gt("Crop Emoji");
    case "roleIcon": return gt("Crop Role Icon");
    case "sticker": return gt("Crop Sticker");
  }
}

/**
 * The one crop dialog behind every image upload field (opened through
 * useImageCropper). Drag or arrow keys pan, wheel / pinch / slider / +- zoom
 * (fields that allow it zoom out to fit with transparent edges), R rotates.
 * The frame mirrors how the image is shown (circle, rounded, rectangle) and
 * the result is rendered from the original pixels at the field's size.
 */
export function ImageCropDialog({
  open,
  request,
  onDone,
}: {
  open: boolean;
  request: CropRequest;
  /** Cropped file, the original file (animated, "upload without cropping"), or null when cancelled. */
  onDone: (file: File | null) => void;
}) {
  const gt = useGT();
  const title = useTitle(request.preset.id);
  const { preset } = request;
  const [frame, setFrame] = useState<CropFrame>(request.frame);
  const geom = useMemo<CropGeometry>(
    () => ({ width: request.width, height: request.height, ratio: frame.ratio, allowFit: preset.allowFit }),
    [request.width, request.height, frame.ratio, preset.allowFit],
  );
  const [view, setView] = useState<CropView>(() =>
    initialView({ width: request.width, height: request.height, ratio: request.frame.ratio, allowFit: preset.allowFit }, preset.startFit),
  );
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; midX: number; midY: number } | null>(null);

  // Measure the stage; the frame is the largest box of the field's ratio inside it.
  useEffect(() => {
    if (!stageEl) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setStage({ w: r.width, h: r.height });
    });
    ro.observe(stageEl);
    return () => ro.disconnect();
  }, [stageEl]);

  const box = useMemo(() => {
    const aw = Math.max(0, stage.w - STAGE_PADDING * 2);
    const ah = Math.max(0, stage.h - STAGE_PADDING * 2);
    let w = aw;
    let h = w / frame.ratio;
    if (h > ah) {
      h = ah;
      w = h * frame.ratio;
    }
    return { w, h };
  }, [stage.w, stage.h, frame.ratio]);

  // Wheel zoom toward the cursor; needs a non-passive listener to stop page scroll.
  useEffect(() => {
    if (!stageEl || box.w <= 0) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = stageEl.getBoundingClientRect();
      const px = e.clientX - rect.left - rect.width / 2;
      const py = e.clientY - rect.top - rect.height / 2;
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      setView((v) => zoomAt(v, v.zoom * Math.exp(-delta * 0.0015), px, py, geom, box.w));
    };
    stageEl.addEventListener("wheel", onWheel, { passive: false });
    return () => stageEl.removeEventListener("wheel", onWheel);
  }, [stageEl, geom, box.w]);

  const crop = cropRect(view, geom);
  const out = outputSize(crop, frame);
  const minZoom = minZoomFor(geom, view.rotation);
  const rotated = rotatedSize(request.width, request.height, view.rotation);
  const scale = box.w > 0 ? box.w / crop.width : 0;

  const imageStyle: CSSProperties = {
    position: "absolute",
    left: 0,
    top: 0,
    width: request.width,
    height: request.height,
    maxWidth: "none",
    transformOrigin: "0 0",
    transform: [
      `translate(${stage.w / 2}px, ${stage.h / 2}px)`,
      `scale(${scale})`,
      `translate(${-view.cx}px, ${-view.cy}px)`,
      `translate(${rotated.width / 2}px, ${rotated.height / 2}px)`,
      `rotate(${view.rotation}deg)`,
      `translate(${-request.width / 2}px, ${-request.height / 2}px)`,
    ].join(" "),
    visibility: scale > 0 ? "visible" : "hidden",
  };

  const zoomBy = (factor: number) => setView((v) => zoomAt(v, v.zoom * factor, 0, 0, geom, box.w));
  const rotate = (dir: 1 | -1) => setView((v) => rotateView(v, dir, geom));
  const reset = () => setView(initialView(geom, preset.startFit));
  const fit = () => setView((v) => clampView({ ...v, zoom: minZoomFor(geom, v.rotation) }, geom));
  const fill = () => setView((v) => clampView({ ...v, zoom: 1 }, geom));
  const pickFrame = (next: CropFrame) => {
    const g = { ...geom, ratio: next.ratio };
    setFrame(next);
    setView((v) => initialView(g, preset.startFit, v.rotation));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    pinch.current = null;
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const map = pointers.current;
    const prev = map.get(e.pointerId);
    if (!prev || box.w <= 0) return;
    map.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (map.size === 1) {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      setView((v) => panBy(v, dx, dy, geom, box.w));
      return;
    }
    const [a, b] = [...map.values()];
    const rect = e.currentTarget.getBoundingClientRect();
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const midX = (a.x + b.x) / 2 - rect.left - rect.width / 2;
    const midY = (a.y + b.y) / 2 - rect.top - rect.height / 2;
    const last = pinch.current;
    pinch.current = { dist, midX, midY };
    if (!last || last.dist <= 0) return;
    setView((v) => {
      const moved = panBy(v, midX - last.midX, midY - last.midY, geom, box.w);
      return zoomAt(moved, moved.zoom * (dist / last.dist), midX, midY, geom, box.w);
    });
  };

  const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    pinch.current = null;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? KEY_PAN * 4 : KEY_PAN;
    const pan = (dx: number, dy: number) => setView((v) => panBy(v, dx, dy, geom, box.w));
    switch (e.key) {
      case "ArrowLeft": pan(-step, 0); break;
      case "ArrowRight": pan(step, 0); break;
      case "ArrowUp": pan(0, -step); break;
      case "ArrowDown": pan(0, step); break;
      case "+":
      case "=": zoomBy(ZOOM_STEP); break;
      case "-":
      case "_": zoomBy(1 / ZOOM_STEP); break;
      case "r": rotate(1); break;
      case "R": rotate(-1); break;
      case "0": reset(); break;
      default: return;
    }
    e.preventDefault();
  };

  const apply = async () => {
    const img = imgRef.current;
    if (!img || busy) return;
    setBusy(true);
    try {
      await img.decode().catch(() => undefined);
      onDone(await renderCropToFile(img, geom, view, frame, preset, request.file.name));
    } catch {
      toast.error(gt("Couldn't crop this image. Try another one."));
      setBusy(false);
    }
  };

  const maskRadius = preset.shape === "circle" ? "9999px" : preset.shape === "rounded" ? "22%" : "6px";
  const iconButton = "size-9 shrink-0";

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onDone(null); }}>
      <DialogContent
        mobile="none"
        showCloseButton={false}
        className={cn(
          "theme-solid flex flex-col gap-4 sm:max-w-[640px]",
          "max-sm:inset-0 max-sm:left-0 max-sm:top-0 max-sm:translate-x-0 max-sm:translate-y-0 max-sm:h-[100dvh] max-sm:w-full max-sm:max-w-none max-sm:rounded-none max-sm:border-0",
          "max-sm:px-4 max-sm:pt-[calc(1rem+var(--safe-area-top,0px))] max-sm:pb-[calc(1rem+var(--safe-area-bottom,0px))]",
        )}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          stageEl?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-[var(--text-muted)]">
            {gt("Drag to move the image, and pinch, scroll or use the slider to zoom. Anything outside the frame is cut off.")}
          </DialogDescription>
        </DialogHeader>

        {request.animated && (
          <div className="flex items-start gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--app-surface-alt)] px-3 py-2 text-sm text-[var(--text-secondary)]">
            <Film className="mt-0.5 size-4 shrink-0 text-[var(--app-accent)]" aria-hidden />
            <p>{gt("This image is animated. Cropping it saves a still image; upload it without cropping to keep the animation.")}</p>
          </div>
        )}

        {preset.frames.length > 1 && (
          <div role="radiogroup" aria-label={gt("Shape")} className="flex gap-1 self-start rounded-lg bg-[var(--app-surface-alt)] p-1">
            {preset.frames.map((f) => {
              const active = f === frame;
              return (
                <button
                  key={`${f.width}x${f.height}`}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => pickFrame(f)}
                  className={cn(
                    "rounded-md px-3 py-1 text-sm font-medium transition-colors",
                    active ? "bg-[var(--app-accent)] text-[var(--text-on-accent)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]",
                  )}
                >
                  {f.ratio >= 1 ? gt("Landscape") : gt("Portrait")}
                </button>
              );
            })}
          </div>
        )}

        <div
          ref={setStageEl}
          tabIndex={0}
          role="application"
          aria-roledescription={gt("Image cropper")}
          aria-label={gt("Use arrow keys to move, + and - to zoom, R to rotate and 0 to reset.")}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onKeyDown={onKeyDown}
          className="relative h-[min(55vh,400px)] w-full shrink-0 cursor-grab select-none overflow-hidden rounded-lg outline-none touch-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-[var(--app-accent)] max-sm:h-auto max-sm:min-h-[240px] max-sm:flex-1"
          style={{
            background:
              "repeating-conic-gradient(var(--app-surface-alt) 0% 25%, var(--app-surface) 0% 50%) 50% / 20px 20px",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- local object URL, drawn from for the export */}
          <img ref={imgRef} src={request.url} alt="" draggable={false} decoding="async" style={imageStyle} className="pointer-events-none" />
          {box.w > 0 && (
            <div
              aria-hidden
              className="pointer-events-none absolute border-2 border-white/90"
              style={{
                width: box.w,
                height: box.h,
                left: (stage.w - box.w) / 2,
                top: (stage.h - box.h) / 2,
                borderRadius: maskRadius,
                boxShadow: "0 0 0 1px rgb(0 0 0 / 0.35), 0 0 0 9999px rgb(0 0 0 / 0.55)",
              }}
            />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-[200px] flex-1 items-center gap-1">
            <Button type="button" variant="ghost" size="icon" className={iconButton} onClick={() => zoomBy(1 / ZOOM_STEP)} disabled={view.zoom <= minZoom + 1e-6} aria-label={gt("Zoom out")}>
              <ZoomOut />
            </Button>
            <input
              type="range"
              aria-label={gt("Zoom")}
              min={Math.log(minZoom)}
              max={Math.log(MAX_ZOOM)}
              step={0.01}
              value={Math.log(view.zoom)}
              onChange={(e) => {
                const z = Math.exp(Number(e.target.value));
                setView((v) => zoomAt(v, z, 0, 0, geom, box.w));
              }}
              className="h-9 min-w-0 flex-1 cursor-pointer accent-[var(--app-accent)]"
            />
            <Button type="button" variant="ghost" size="icon" className={iconButton} onClick={() => zoomBy(ZOOM_STEP)} disabled={view.zoom >= MAX_ZOOM - 1e-6} aria-label={gt("Zoom in")}>
              <ZoomIn />
            </Button>
          </div>
          <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" size="icon" className={iconButton} onClick={() => rotate(-1)} aria-label={gt("Rotate left")} title={gt("Rotate left")}>
              <RotateCcw />
            </Button>
            <Button type="button" variant="ghost" size="icon" className={iconButton} onClick={() => rotate(1)} aria-label={gt("Rotate right")} title={gt("Rotate right")}>
              <RotateCw />
            </Button>
            {preset.allowFit && (
              <>
                <Button type="button" variant="ghost" size="icon" className={iconButton} onClick={fit} aria-label={gt("Fit whole image")} title={gt("Fit whole image")}>
                  <Minimize />
                </Button>
                <Button type="button" variant="ghost" size="icon" className={iconButton} onClick={fill} aria-label={gt("Fill the frame")} title={gt("Fill the frame")}>
                  <Maximize />
                </Button>
              </>
            )}
            <Button type="button" variant="ghost" size="icon" className={iconButton} onClick={reset} aria-label={gt("Reset")} title={gt("Reset")}>
              <Undo2 />
            </Button>
          </div>
        </div>

        <p className="text-xs text-[var(--text-muted)]" aria-live="polite">
          {gt("Saved at {width} × {height} pixels", { width: out.width, height: out.height })}
        </p>

        <DialogFooter className="max-sm:mt-auto">
          <Button type="button" variant="outline" onClick={() => onDone(null)} disabled={busy}>
            {gt("Cancel")}
          </Button>
          {request.animated && (
            <Button type="button" variant="outline" onClick={() => onDone(request.file)} disabled={busy}>
              {gt("Upload without cropping")}
            </Button>
          )}
          <Button
            type="button"
            onClick={() => void apply()}
            disabled={busy || box.w <= 0}
            className="bg-[var(--app-accent)] text-[var(--text-on-accent)] hover:bg-[var(--app-accent)] hover:opacity-90"
          >
            {busy ? gt("Processing...") : request.animated ? gt("Crop as a still image") : gt("Apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
