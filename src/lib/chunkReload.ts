/**
 * After a deploy, an open tab still runs the old build. The first lazy chunk
 * it asks for no longer exists on the server, and the app crashes into the
 * error screen. Reloading picks up the new build; the guard stops a loop if
 * the chunk is genuinely broken.
 */
const GUARD_KEY = "sc:chunk-reload-at";
const GUARD_MS = 30_000;

export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { name, message } = error as { name?: string; message?: string };
  if (name === "ChunkLoadError") return true;
  return /Loading (CSS )?chunk [\w-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
    message ?? "",
  );
}

/** Reload once for a new build. Returns false if we just did (avoid loops). */
export function reloadForNewBuild(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const last = Number(sessionStorage.getItem(GUARD_KEY) || 0);
    if (Date.now() - last < GUARD_MS) return false;
    sessionStorage.setItem(GUARD_KEY, String(Date.now()));
  } catch {
    /* storage blocked: still reload once */
  }
  window.location.reload();
  return true;
}
