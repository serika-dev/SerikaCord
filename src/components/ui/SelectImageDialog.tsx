"use client";

import { useEffect, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import dynamic from "next/dynamic";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { ChevronLeft, ImagePlus, X } from "lucide-react";
import { SiDiscord } from "@icons-pack/react-simple-icons";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader } from "@/components/ui/Loader";
import { cdnImage, cn } from "@/lib/utils";
import {
  getGifThumbs,
  getRecentMediaState,
  getServerGifThumbs,
  getServerRecentMediaState,
  importDiscordImage,
  importGif,
  loadGifThumbs,
  refreshRecentMedia,
  removeRecentMediaEntry,
  subscribeRecentMedia,
  type RecentKind,
} from "@/lib/profiles/recentMediaClient";

const GifPicker = dynamic(() => import("@/components/chat/GifPicker").then((m) => m.GifPicker), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center">
      <Loader size={24} />
    </div>
  ),
});

export interface SelectImageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Show "Recent Avatars" / "Recent Banners" (and the linked Discord image); omit where there is no history. */
  recents?: RecentKind;
  /** "Upload Image": the host opens its file picker (must run inside this click). */
  onUpload: () => void;
  /** A GIF or the Discord image, as a File for the host's crop + upload. */
  onFile: (file: File) => void;
  /** A recent image was picked (already on our CDN). */
  onRecent?: (url: string) => void;
}

const TILE =
  "group relative aspect-square overflow-hidden rounded-lg outline-none transition-[filter,box-shadow] duration-(--motion-fast) focus-visible:ring-2 focus-visible:ring-[var(--app-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-card)] disabled:pointer-events-none";

/**
 * Discord-style "Select an Image" for every avatar / banner / icon change:
 * Upload Image, Choose GIF (the app's GIF picker; the GIF is fetched by our
 * server and goes through the normal crop + upload) and, for user profile
 * images, the recent avatars / banners plus the linked Discord account's
 * current image. Opened through useSelectImage (lazy chunk).
 */
export function SelectImageDialog({ open, onOpenChange, recents, onUpload, onFile, onRecent }: SelectImageDialogProps) {
  const gt = useGT();
  const [view, setView] = useState<"home" | "gif">("home");
  const [busy, setBusy] = useState(false);
  const media = useSyncExternalStore(subscribeRecentMedia, getRecentMediaState, getServerRecentMediaState);
  const thumbs = useSyncExternalStore(subscribeRecentMedia, getGifThumbs, getServerGifThumbs);

  useEffect(() => {
    if (!open) return;
    loadGifThumbs();
    if (recents) void refreshRecentMedia();
  }, [open, recents]);

  const isBanner = recents === "banner";
  const items = recents ? (isBanner ? media.banners : media.avatars) : [];
  const discordUrl = recents ? (isBanner ? media.discord.banner : media.discord.avatar) : null;
  const showRecents = !!recents && (!media.loaded || items.length > 0 || !!discordUrl);

  const handOver = async (load: () => Promise<File | { error: string | null }>, fallback: string) => {
    setBusy(true);
    const result = await load();
    setBusy(false);
    if (result instanceof File) {
      onOpenChange(false);
      onFile(result);
    } else {
      toast.error(result.error || fallback);
    }
  };

  const pickGif = (gif: { slug?: string; url: string }) =>
    void handOver(() => importGif({ slug: gif.slug || undefined, url: gif.url }), gt("Could not load that GIF"));

  const pickDiscord = () => {
    if (!recents) return;
    void handOver(() => importDiscordImage(recents), gt("Could not load your Discord image"));
  };

  const pickRecent = (url: string) => {
    onOpenChange(false);
    onRecent?.(url);
  };

  const remove = async (url: string) => {
    if (!recents) return;
    const ok = await removeRecentMediaEntry(recents, url);
    if (!ok) toast.error(gt("Could not remove that image"));
  };

  // Arrow keys move between recent tiles; Delete / Backspace removes one.
  const onRowKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const tiles = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("[data-recent-tile]"));
    const i = tiles.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0 || tiles.length === 0) return;
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % tiles.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + tiles.length) % tiles.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tiles.length - 1;
    else if ((e.key === "Delete" || e.key === "Backspace") && tiles[i].dataset.url) {
      e.preventDefault();
      const url = tiles[i].dataset.url;
      (tiles[i + 1] ?? tiles[i - 1])?.focus();
      void remove(url);
      return;
    }
    if (next >= 0) {
      e.preventDefault();
      tiles[next].focus();
    }
  };

  const tileShape = isBanner ? "aspect-[17/6] w-full rounded-md" : "size-16 rounded-full max-sm:size-14";

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent
        mobile="none"
        showCloseButton={false}
        className={cn(
          "gap-0 p-7 sm:max-w-[600px]",
          "max-sm:top-0 max-sm:left-0 max-sm:flex max-sm:h-[100dvh] max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:flex-col max-sm:overflow-y-auto max-sm:rounded-none max-sm:border-0 max-sm:px-4 max-sm:pt-[calc(1rem+var(--safe-area-top))] max-sm:pb-[calc(1rem+var(--safe-area-bottom))]",
        )}
        onEscapeKeyDown={(e) => {
          if (busy) e.preventDefault();
          else if (view === "gif") {
            e.preventDefault();
            setView("home");
          }
        }}
      >
        <div className="flex items-center gap-2">
          {view === "gif" && (
            <button
              type="button"
              onClick={() => setView("home")}
              aria-label={gt("Back")}
              className="-ml-1.5 flex size-9 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--app-accent)]"
            >
              <ChevronLeft className="size-5" />
            </button>
          )}
          <DialogTitle className="min-w-0 flex-1 truncate text-xl font-semibold text-[var(--text-primary)]">
            {view === "gif" ? gt("Choose a GIF") : gt("Select an Image")}
          </DialogTitle>
          <DialogClose
            disabled={busy}
            aria-label={gt("Close")}
            className="-mr-1.5 flex size-9 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--app-accent)] max-sm:size-11"
          >
            <X className="size-6" />
          </DialogClose>
        </div>
        <DialogDescription className="sr-only">
          {gt("Upload an image, choose a GIF or reuse a recent one.")}
        </DialogDescription>

        {view === "gif" ? (
          <div className="mt-4 h-[min(460px,60dvh)] min-h-0 overflow-hidden rounded-lg border border-[var(--border-subtle)] max-sm:h-auto max-sm:flex-1">
            <GifPicker onGifSelect={pickGif} className="h-full w-full max-w-none rounded-none border-none shadow-none" />
          </div>
        ) : (
          <>
            <div className="mt-6 grid grid-cols-2 gap-2.5 max-sm:mt-5">
              <button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  onUpload();
                }}
                className={cn(TILE, "flex flex-col items-center justify-center gap-2 bg-[color-mix(in_srgb,var(--text-primary)_6%,var(--bg-card))] text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--text-primary)_10%,var(--bg-card))]")}
              >
                <ImagePlus className="size-7" aria-hidden />
                <span className="text-[15px] font-semibold">{gt("Upload Image")}</span>
              </button>
              <button
                type="button"
                onClick={() => setView("gif")}
                className={cn(TILE, "bg-[linear-gradient(135deg,var(--app-accent),color-mix(in_srgb,var(--app-accent)_35%,var(--bg-card)))] hover:brightness-110")}
              >
                {thumbs && thumbs.length === 4 && (
                  <span className="absolute inset-0 grid grid-cols-2 grid-rows-2" aria-hidden>
                    {thumbs.map((src, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={`${i}:${src}`} src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
                    ))}
                  </span>
                )}
                <span className="absolute inset-0 bg-black/35 transition-colors group-hover:bg-black/25" aria-hidden />
                <span className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
                  <span className="rounded-[5px] bg-white px-1.5 py-0.5 text-[11px] font-extrabold leading-none tracking-wide text-black shadow" aria-hidden>
                    {gt("GIF")}
                  </span>
                  <span className="text-[15px] font-semibold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">{gt("Choose GIF")}</span>
                </span>
              </button>
            </div>

            {showRecents && (
              <section className="mt-6" aria-labelledby="select-image-recents">
                <h3 id="select-image-recents" className="text-lg font-semibold text-[var(--text-primary)]">
                  {isBanner ? gt("Recent Banners") : gt("Recent Avatars")}
                </h3>
                <p className="mt-0.5 text-sm text-[var(--text-secondary)]">
                  {isBanner ? gt("Access your 6 most recent banner uploads.") : gt("Access your 6 most recent avatar uploads.")}
                </p>
                <div
                  role="group"
                  aria-labelledby="select-image-recents"
                  onKeyDown={onRowKeyDown}
                  className={cn("mt-3", isBanner ? "grid grid-cols-3 gap-2.5 max-sm:grid-cols-2" : "flex flex-wrap gap-2.5")}
                >
                  {discordUrl && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          data-recent-tile
                          onClick={pickDiscord}
                          disabled={busy}
                          aria-label={isBanner ? gt("Your Discord banner") : gt("Your Discord avatar")}
                          className={cn("relative shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-card)] hover:brightness-110", isBanner ? "w-full rounded-md" : "rounded-full")}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={discordUrl} alt="" className={cn("block bg-[var(--bg-hover)] object-cover", tileShape)} />
                          <span className="absolute right-0 bottom-0 flex size-5 items-center justify-center rounded-full bg-[#5865f2] text-white ring-2 ring-[var(--bg-card)]" aria-hidden>
                            <SiDiscord size={11} color="currentColor" />
                          </span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{isBanner ? gt("Your Discord banner") : gt("Your Discord avatar")}</TooltipContent>
                    </Tooltip>
                  )}
                  {items.map((url) => (
                    <div key={url} className={cn("group relative shrink-0", isBanner && "w-full")}>
                      <button
                        type="button"
                        data-recent-tile
                        data-url={url}
                        onClick={() => pickRecent(url)}
                        disabled={busy}
                        aria-label={isBanner ? gt("Use this banner") : gt("Use this avatar")}
                        className={cn("block outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-card)] hover:brightness-110", isBanner ? "w-full rounded-md" : "rounded-full")}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={cdnImage(url)} alt="" loading="lazy" className={cn("block bg-[var(--bg-hover)] object-cover", tileShape)} />
                      </button>
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => void remove(url)}
                        aria-label={isBanner ? gt("Remove from recent banners") : gt("Remove from recent avatars")}
                        className="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-secondary)] opacity-0 shadow transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 hover:text-[var(--text-primary)] [@media(hover:none)]:opacity-100"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ))}
                  {!media.loaded && items.length === 0 && !discordUrl &&
                    [0, 1, 2].map((i) => (
                      <span key={i} aria-hidden className={cn("block animate-pulse bg-[var(--bg-hover)]", tileShape)} />
                    ))}
                </div>
              </section>
            )}
          </>
        )}

        {busy && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-[inherit] bg-[color-mix(in_srgb,var(--bg-card)_82%,transparent)]" role="status">
            <Loader size={28} />
            <span className="text-sm font-medium text-[var(--text-primary)]">{gt("Loading image…")}</span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
