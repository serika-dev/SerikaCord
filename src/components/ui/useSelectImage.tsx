"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { MountWhenOpened } from "@/components/ui/MountWhenOpened";
import type { RecentKind } from "@/lib/profiles/recentMediaClient";

const SelectImageDialog = dynamic(() => import("@/components/ui/SelectImageDialog").then((m) => m.SelectImageDialog), { ssr: false });

export interface SelectImageRequest {
  /** Show the recent avatars / banners (user profile images only; omit for icons, bots, ...). */
  recents?: RecentKind;
  /** The picked file (upload, GIF or Discord image): the host crops and uploads it as before. */
  onFile: (file: File) => void;
  /** A recent image was picked (needs `recents`). */
  onRecent?: (url: string) => void;
}

/**
 * The shared first step of every avatar / banner / icon change: a
 * Discord-style "Select an Image" dialog (Upload Image, Choose GIF, recent
 * images). Its chunk loads on first open.
 *
 *   const picker = useSelectImage();
 *   picker.open({ recents: "avatar", onFile: (f) => upload(f), onRecent: (url) => apply(url) });
 *   ...render {picker.element} once.
 */
export function useSelectImage(): { open: (request: SelectImageRequest) => void; element: ReactNode } {
  const [request, setRequest] = useState<(SelectImageRequest & { id: number }) | null>(null);
  const [isOpen, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  const open = useCallback((next: SelectImageRequest) => {
    seq.current += 1;
    setRequest({ ...next, id: seq.current });
    setOpen(true);
  }, []);

  const onUpload = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    input.value = "";
    input.click();
  }, []);

  const element = (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file && request) request.onFile(file);
        }}
      />
      <MountWhenOpened open={isOpen}>
        {request && (
          <SelectImageDialog
            key={request.id}
            open={isOpen}
            onOpenChange={setOpen}
            recents={request.recents}
            onUpload={onUpload}
            onFile={request.onFile}
            onRecent={request.onRecent}
          />
        )}
      </MountWhenOpened>
    </>
  );

  return { open, element };
}
