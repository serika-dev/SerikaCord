/**
 * Thin, feature-detected bridge to the Capacitor shell (mobile/).
 *
 * The app inside the shell is the hosted website (capacitor.config server.url),
 * so @capacitor/core is not bundled. The native side still injects
 * `window.Capacitor` with `PluginHeaders` and raw `nativePromise` /
 * `nativeCallback`, which is all we need. Every helper is a safe no-op in a
 * normal browser and on older APKs missing a plugin.
 */

type Listener = (data: unknown) => void;
type CapacitorGlobal = NonNullable<Window["Capacitor"]>;

function cap(): CapacitorGlobal | null {
  if (typeof window === "undefined") return null;
  return window.Capacitor ?? null;
}

/** Running inside the native mobile app. */
export function isNativeApp(): boolean {
  try {
    return cap()?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

export function nativePlatform(): "android" | "ios" | "web" {
  if (!isNativeApp()) return "web";
  const p = cap()?.getPlatform?.();
  return p === "ios" ? "ios" : p === "android" ? "android" : "web";
}

/** The shell ships this native plugin (and, optionally, this method). */
export function hasNativePlugin(name: string, method?: string): boolean {
  if (!isNativeApp()) return false;
  const c = cap()!;
  const header = c.PluginHeaders?.find((h) => h.name === name);
  if (header) return method ? (header.methods ?? []).some((m) => m.name === method) || !header.methods : true;
  const proxy = c.Plugins?.[name];
  if (!proxy) return false;
  return method ? typeof proxy[method] === "function" : true;
}

/** Call a native plugin method. Resolves null when unavailable or on error. */
export async function callNative<T = unknown>(name: string, method: string, options: Record<string, unknown> = {}): Promise<T | null> {
  if (!hasNativePlugin(name, method)) return null;
  const c = cap()!;
  try {
    const proxy = c.Plugins?.[name];
    const fn = proxy?.[method];
    if (typeof fn === "function") return (await (fn as (o: unknown) => Promise<T>).call(proxy, options)) ?? null;
    if (typeof c.nativePromise === "function") return ((await c.nativePromise(name, method, options)) as T) ?? null;
  } catch (err) {
    if (process.env.NODE_ENV !== "production") console.warn(`[native] ${name}.${method} failed`, err);
  }
  return null;
}

/** Subscribe to a native plugin event. Returns an unsubscribe function. */
export function addNativeListener(name: string, event: string, listener: Listener): () => void {
  if (!hasNativePlugin(name)) return () => {};
  const c = cap()!;
  const proxy = c.Plugins?.[name];
  if (proxy && typeof proxy.addListener === "function") {
    let handle: { remove?: () => unknown } | null = null;
    let removed = false;
    Promise.resolve((proxy.addListener as (e: string, l: Listener) => unknown).call(proxy, event, listener))
      .then((h) => {
        handle = (h as { remove?: () => unknown }) ?? null;
        if (removed) void handle?.remove?.();
      })
      .catch(() => {});
    return () => {
      removed = true;
      void handle?.remove?.();
    };
  }
  if (typeof c.nativeCallback === "function") {
    let callbackId: string | null = null;
    try {
      callbackId = c.nativeCallback(name, "addListener", { eventName: event }, (data) => listener(data));
    } catch {
      return () => {};
    }
    return () => {
      if (callbackId == null) return;
      void c.nativePromise?.(name, "removeListener", { eventName: event, callbackId }).catch(() => {});
      callbackId = null;
    };
  }
  return () => {};
}

// ─── Haptics ──────────────────────────────────────────────────────────────────

export type HapticKind = "light" | "medium" | "heavy" | "selection" | "success" | "warning";

/** Native haptic tick. No-op on the web (vibration there feels cheap). */
export function haptic(kind: HapticKind = "light"): void {
  if (!isNativeApp()) return;
  if (kind === "selection") {
    void callNative("Haptics", "selectionStart").then(() => callNative("Haptics", "selectionChanged")).then(() => callNative("Haptics", "selectionEnd"));
    return;
  }
  if (kind === "success" || kind === "warning") {
    void callNative("Haptics", "notification", { type: kind === "success" ? "SUCCESS" : "WARNING" });
    return;
  }
  void callNative("Haptics", "impact", { style: kind.toUpperCase() });
}

// ─── Share ────────────────────────────────────────────────────────────────────

/**
 * Open the system share sheet (native app or Web Share API). Returns false when
 * neither exists so callers can fall back to copying the link.
 */
export async function shareLink(opts: { title?: string; text?: string; url: string; dialogTitle?: string }): Promise<boolean> {
  if (hasNativePlugin("Share", "share")) {
    // The native sheet rejects when dismissed; that still counts as handled.
    if (!isNativeApp()) return false;
    const c = cap()!;
    try {
      const proxy = c.Plugins?.Share;
      if (typeof proxy?.share === "function") await (proxy.share as (o: unknown) => Promise<unknown>)(opts);
      else await c.nativePromise?.("Share", "share", opts);
    } catch {
      /* cancelled */
    }
    return true;
  }
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ title: opts.title, text: opts.text, url: opts.url });
    } catch {
      /* cancelled */
    }
    return true;
  }
  return false;
}

/** A share sheet is available here (native app or a browser with Web Share). */
export function canShare(): boolean {
  return hasNativePlugin("Share", "share") || (typeof navigator !== "undefined" && typeof navigator.share === "function");
}
