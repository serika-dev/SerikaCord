"use client";

import { useEffect, useCallback, useState } from "react";
import { X, ZoomIn, ZoomOut, Download, ExternalLink, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGT } from "gt-next";

interface ImageLightboxItem {
  src: string;
  alt?: string;
  messageId?: string;
}

interface ImageLightboxProps {
  items?: ImageLightboxItem[];
  currentIndex?: number;
  src?: string;
  alt?: string;
  isOpen: boolean;
  onNavigate?: (nextIndex: number) => void;
  onClose: () => void;
}

export function ImageLightbox({
  items,
  currentIndex = 0,
  src,
  alt,
  isOpen,
  onNavigate,
  onClose,
}: ImageLightboxProps) {
  const gt = useGT();
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const fallbackItems: ImageLightboxItem[] = src ? [{ src, alt }] : [];
  const galleryItems = items && items.length > 0 ? items : fallbackItems;
  const hasItems = galleryItems.length > 0;
  const resolvedIndex = hasItems
    ? Math.max(0, Math.min(currentIndex, galleryItems.length - 1))
    : 0;
  const currentItem = galleryItems[resolvedIndex];
  const canNavigate = galleryItems.length > 1 && Boolean(onNavigate);

  const resetView = useCallback(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    if (isOpen) {
      resetView();
    }
  }, [isOpen, resetView]);

  useEffect(() => {
    if (isOpen) {
      resetView();
    }
  }, [resolvedIndex, isOpen, resetView]);

  const navigate = useCallback(
    (delta: number) => {
      if (!canNavigate || !onNavigate) return;
      const nextIndex = (resolvedIndex + delta + galleryItems.length) % galleryItems.length;
      onNavigate(nextIndex);
    },
    [canNavigate, onNavigate, resolvedIndex, galleryItems.length]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (!canNavigate) return;
      if (e.key === "ArrowLeft") {
        navigate(-1);
      }
      if (e.key === "ArrowRight") {
        navigate(1);
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [canNavigate, isOpen, navigate, onClose]);

  const handleZoomIn = () => {
    setScale((prev) => Math.min(prev + 0.5, 5));
  };

  const handleZoomOut = () => {
    setScale((prev) => Math.max(prev - 0.5, 0.5));
  };

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setScale((prev) => Math.min(Math.max(prev + delta, 0.5), 5));
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale > 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && scale > 1) {
      setPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleDownload = () => {
    if (!currentItem?.src) return;
    const link = document.createElement("a");
    link.href = currentItem.src;
    link.download = currentItem.alt || "image";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleOpenExternal = () => {
    if (!currentItem?.src) return;
    window.open(currentItem.src, "_blank", "noopener,noreferrer");
  };

  if (!isOpen || !currentItem?.src) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 animate-in fade-in duration-200"
      onClick={onClose}
    >
      {canNavigate && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigate(-1);
            }}
            className="absolute left-4 top-1/2 -translate-y-1/2 z-20 p-2.5 bg-[#111111]/80 hover:bg-[#222222] rounded-full text-white transition-colors"
            aria-label={gt("Previous image")}
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigate(1);
            }}
            className="absolute right-4 top-1/2 -translate-y-1/2 z-20 p-2.5 bg-[#111111]/80 hover:bg-[#222222] rounded-full text-white transition-colors"
            aria-label={gt("Next image")}
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        </>
      )}

      <div className="absolute top-4 right-4 flex items-center gap-2 z-20">
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleZoomOut();
          }}
          className="p-2 bg-[#111111]/80 hover:bg-[#222222] rounded-lg text-white transition-colors"
          title={gt("Zoom out")}
        >
          <ZoomOut className="w-5 h-5" />
        </button>
        <span className="px-2 text-white text-sm font-medium">
          {Math.round(scale * 100)}%
        </span>
        {galleryItems.length > 1 && (
          <span className="px-2 text-white/80 text-xs font-medium">
            {resolvedIndex + 1}/{galleryItems.length}
          </span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleZoomIn();
          }}
          className="p-2 bg-[#111111]/80 hover:bg-[#222222] rounded-lg text-white transition-colors"
          title={gt("Zoom in")}
        >
          <ZoomIn className="w-5 h-5" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleDownload();
          }}
          className="p-2 bg-[#111111]/80 hover:bg-[#222222] rounded-lg text-white transition-colors"
          title={gt("Download")}
        >
          <Download className="w-5 h-5" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleOpenExternal();
          }}
          className="p-2 bg-[#111111]/80 hover:bg-[#222222] rounded-lg text-white transition-colors"
          title={gt("Open original")}
        >
          <ExternalLink className="w-5 h-5" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="p-2 bg-[#111111]/80 hover:bg-[#222222] rounded-lg text-white transition-colors"
          title={gt("Close")}
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div
        className={cn(
          "relative max-w-[90vw] max-h-[90vh]",
          scale > 1 && "cursor-grab",
          isDragging && "cursor-grabbing"
        )}
        onClick={(e) => e.stopPropagation()}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <img
          src={currentItem.src}
          alt={currentItem.alt || gt("Image")}
          className="max-w-full max-h-[90vh] object-contain select-none transition-transform duration-100"
          style={{
            transform: `scale(${scale}) translate(${position.x / scale}px, ${position.y / scale}px)`,
          }}
          draggable={false}
        />
      </div>

      {galleryItems.length > 1 && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 max-w-[92vw] px-3 py-2 bg-[#111111]/80 rounded-lg overflow-x-auto">
          <div className="flex items-center gap-2">
            {galleryItems.map((item, index) => (
              <button
                key={`${item.messageId || "media"}-${item.src}-${index}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onNavigate?.(index);
                }}
                className={cn(
                  "w-14 h-14 rounded overflow-hidden border transition-colors shrink-0",
                  index === resolvedIndex
                    ? "border-[var(--app-accent)]"
                    : "border-white/20 hover:border-white/60"
                )}
              >
                <img
                  src={item.src}
                  alt={item.alt || gt("Image {index}", { index: index + 1 })}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </button>
            ))}
          </div>
        </div>
      )}

      {currentItem.alt && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-[#111111]/80 rounded-lg">
          <p className="text-white text-sm">{currentItem.alt}</p>
        </div>
      )}
    </div>
  );
}
