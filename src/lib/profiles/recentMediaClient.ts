"use client";

/**
 * Client side of the "Select an Image" dialog: recent avatars / banners,
 * the linked Discord images and the trending GIF collage, kept in a tiny
 * module store (useSyncExternalStore) so reopening the dialog paints at once
 * and refreshes in the background. Also the fetchers that turn a GIF or the
 * Discord avatar into a File for the normal crop + upload path.
 */

export type RecentKind = "avatar" | "banner";

export interface RecentMediaState {
  avatars: string[];
  banners: string[];
  discord: { avatar: string | null; banner: string | null };
  /** True once a response has arrived (cached data may still be refreshing). */
  loaded: boolean;
}

const EMPTY: RecentMediaState = { avatars: [], banners: [], discord: { avatar: null, banner: null }, loaded: false };

let state: RecentMediaState = EMPTY;
let inflight: Promise<void> | null = null;
let gifThumbs: string[] | null = null;
let gifThumbsRequest: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function subscribeRecentMedia(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getRecentMediaState = (): RecentMediaState => state;
export const getServerRecentMediaState = (): RecentMediaState => EMPTY;
export const getGifThumbs = (): string[] | null => gifThumbs;
export const getServerGifThumbs = (): string[] | null => null;

const urls = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.map((e) => (e && typeof e === "object" ? (e as { url?: unknown }).url : null)).filter((u): u is string => typeof u === "string") : [];

/** Fetch the lists (deduped while one request is running). */
export function refreshRecentMedia(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("/api/users/@me/recent-media", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { avatars?: unknown; banners?: unknown; discord?: { avatar?: unknown; banner?: unknown } };
      state = {
        avatars: urls(data.avatars),
        banners: urls(data.banners),
        discord: {
          avatar: typeof data.discord?.avatar === "string" ? data.discord.avatar : null,
          banner: typeof data.discord?.banner === "string" ? data.discord.banner : null,
        },
        loaded: true,
      };
    } catch {
      // keep what we had
    } finally {
      inflight = null;
      if (!state.loaded) state = { ...state, loaded: true };
      emit();
    }
  })();
  return inflight;
}

/** Set a recent image as the main avatar / banner. Returns the URL, or an error message. */
export async function applyRecentMedia(kind: RecentKind, url: string): Promise<{ url: string } | { error: string | null }> {
  try {
    const res = await fetch("/api/users/@me/recent-media/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, url }),
    });
    const data = (await res.json().catch(() => null)) as { url?: unknown; error?: unknown } | null;
    if (!res.ok || typeof data?.url !== "string") return { error: typeof data?.error === "string" ? data.error : null };
    void refreshRecentMedia();
    return { url: data.url };
  } catch {
    return { error: null };
  }
}

/** Remove one entry (optimistic; restored when the server refuses). */
export async function removeRecentMediaEntry(kind: RecentKind, url: string): Promise<boolean> {
  const key = kind === "avatar" ? "avatars" : "banners";
  const before = state;
  state = { ...state, [key]: state[key].filter((u) => u !== url) };
  emit();
  try {
    const res = await fetch("/api/users/@me/recent-media", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, url }),
    });
    if (!res.ok) throw new Error(String(res.status));
    return true;
  } catch {
    state = before;
    emit();
    return false;
  }
}

/** Four trending GIF thumbnails for the "Choose GIF" tile, fetched once per session. */
export function loadGifThumbs(): void {
  if (gifThumbs || gifThumbsRequest) return;
  gifThumbsRequest = (async () => {
    try {
      const res = await fetch("/api/gifs/gifs?sort=trending&limit=4&page=1");
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { gifs?: Array<{ thumbnailUrl?: unknown; url?: unknown }> };
      gifThumbs = (data.gifs ?? [])
        .map((g) => (typeof g.thumbnailUrl === "string" ? g.thumbnailUrl : typeof g.url === "string" ? g.url : null))
        .filter((u): u is string => !!u && u.startsWith("https://"))
        .slice(0, 4);
    } catch {
      gifThumbs = [];
    } finally {
      emit();
    }
  })();
}

async function toFile(res: Response, name: string): Promise<File | { error: string | null }> {
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
    return { error: typeof data?.error === "string" ? data.error : null };
  }
  const blob = await res.blob();
  const type = blob.type || "image/png";
  const ext = type === "image/gif" ? "gif" : type === "image/jpeg" ? "jpg" : type === "image/webp" ? "webp" : "png";
  return new File([blob], `${name}.${ext}`, { type });
}

/** A GIF from the picker as a File (fetched by our server, never hotlinked). */
export async function importGif(gif: { slug?: string; url: string }): Promise<File | { error: string | null }> {
  try {
    const res = await fetch("/api/gifs/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(gif.slug ? { slug: gif.slug } : { url: gif.url }),
    });
    return await toFile(res, "gif");
  } catch {
    return { error: null };
  }
}

/** The linked Discord account's avatar / banner as a File. */
export async function importDiscordImage(kind: RecentKind): Promise<File | { error: string | null }> {
  try {
    const res = await fetch(`/api/users/@me/recent-media/discord/${kind}`);
    return await toFile(res, `discord-${kind}`);
  } catch {
    return { error: null };
  }
}
