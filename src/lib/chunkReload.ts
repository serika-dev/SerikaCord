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

const MAX_ATTEMPTS = 4;

/**
 * Reload for a new build. During a rolling deploy the first reload can still
 * get the old page, so retry a few times with a growing delay (0s, 3s, 6s,
 * 9s) before giving up. Returns false once the attempts are used up.
 */
export function reloadForNewBuild(): boolean {
  if (typeof window === "undefined") return false;
  let attempt = 0;
  try {
    const [at, count] = (sessionStorage.getItem(GUARD_KEY) || "0:0").split(":").map(Number);
    attempt = Date.now() - (at || 0) < GUARD_MS ? (count || 0) : 0;
    if (attempt >= MAX_ATTEMPTS) return false;
    sessionStorage.setItem(GUARD_KEY, `${Date.now()}:${attempt + 1}`);
  } catch {
    /* storage blocked: still reload once */
  }
  window.setTimeout(() => window.location.reload(), attempt * 3000);
  return true;
}
