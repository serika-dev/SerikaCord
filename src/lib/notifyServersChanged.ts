/**
 * Broadcast that the current user's joined-servers list changed (joined/left a
 * server) so every open ServerContext — across tabs and routes — refetches its
 * sidebar immediately instead of waiting for the background poll.
 *
 * ServerContext listens via BroadcastChannel("sc:servers") and the "storage"
 * event on key "sc:servers-changed".
 */
export function notifyServersChanged() {
  if (typeof window === "undefined") return;
  try {
    if (typeof BroadcastChannel !== "undefined") {
      const bc = new BroadcastChannel("sc:servers");
      bc.postMessage("changed");
      bc.close();
    }
  } catch {
    /* ignore */
  }
  try {
    // storage events only fire in *other* tabs, so this complements the
    // BroadcastChannel (which also reaches the current tab's other providers).
    localStorage.setItem("sc:servers-changed", String(Date.now()));
  } catch {
    /* quota / disabled — ignore */
  }
}
