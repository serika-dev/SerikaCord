"use client";

import { useEffect } from "react";
import { isChunkLoadError, reloadForNewBuild } from "@/lib/chunkReload";

/** Reloads the page when a lazy chunk from an old build fails to load. */
export function ChunkReloadGuard() {
  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => {
      if (isChunkLoadError(event.reason)) reloadForNewBuild();
    };
    const onError = (event: ErrorEvent) => {
      if (isChunkLoadError(event.error)) reloadForNewBuild();
    };
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError);
    };
  }, []);
  return null;
}
