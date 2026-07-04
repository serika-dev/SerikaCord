"use client";

import { useCallback, useEffect, useRef, useState } from "react";
// (effects here only sync refs; index clamping is derived at render time)
import { findGalleryIndex, type GalleryItem } from "@/lib/chat/media";

/**
 * Shared lightbox state for chat media: opens gallery items by index and
 * falls back to standalone display for media not in the gallery.
 */
export function useMediaLightbox(mediaGallery: GalleryItem[]) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [standaloneMedia, setStandaloneMedia] = useState<{ src: string; alt?: string } | null>(null);

  // Stable identity (reads gallery via ref) so memoized message rows keep
  // their props between gallery changes.
  const galleryRef = useRef(mediaGallery);
  useEffect(() => {
    galleryRef.current = mediaGallery;
  }, [mediaGallery]);

  const openMediaViewer = useCallback((src: string, alt?: string, messageId?: string) => {
    const mediaIndex = findGalleryIndex(galleryRef.current, { src, messageId });
    if (mediaIndex >= 0) {
      setStandaloneMedia(null);
      setLightboxIndex(mediaIndex);
      return;
    }
    setLightboxIndex(null);
    setStandaloneMedia({ src, alt });
  }, []);

  const closeMediaViewer = useCallback(() => {
    setLightboxIndex(null);
    setStandaloneMedia(null);
  }, []);

  // Clamp at render time so the index stays valid as the gallery shrinks
  // (e.g. message deleted) without effect-driven state cascades.
  const effectiveIndex =
    lightboxIndex === null || !mediaGallery.length
      ? null
      : Math.min(lightboxIndex, mediaGallery.length - 1);

  return {
    lightboxIndex: effectiveIndex,
    setLightboxIndex,
    standaloneMedia,
    openMediaViewer,
    closeMediaViewer,
    lightboxItems: standaloneMedia ? [standaloneMedia] : mediaGallery,
    lightboxCurrentIndex: standaloneMedia ? 0 : effectiveIndex ?? 0,
    isLightboxOpen: effectiveIndex !== null || standaloneMedia !== null,
  };
}
