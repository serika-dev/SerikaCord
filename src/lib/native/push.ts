/**
 * Mobile push registration (Capacitor PushNotifications → FCM token → our
 * API) and the app's foreground/background state. All no-ops on the web and
 * on APKs built without Firebase.
 */
import { addNativeListener, callNative, hasNativePlugin, isNativeApp, nativePlatform } from "./bridge";

const TOKEN_KEY = "serika:pushToken";

/** Shared state other modules read (notificationService skips duplicates). */
export const nativeAppState = {
  /** The app is in the background (screen off / another app in front). */
  background: false,
  /** This device is registered for server pushes. */
  pushActive: false,
};

function readStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function storeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage blocked */
  }
}

async function firebaseAvailable(): Promise<boolean> {
  // Older APKs without our plugin can't tell; registering there could crash
  // when google-services.json is missing, so don't.
  const caps = await callNative<{ firebase?: boolean }>("SerikaNative", "getCapabilities");
  return caps?.firebase === true;
}

let registering: Promise<void> | null = null;
let listenersAttached = false;

/** Ask for notification permission and register this device for pushes. */
export function registerForPush(): Promise<void> {
  if (!isNativeApp() || !hasNativePlugin("PushNotifications")) return Promise.resolve();
  if (registering) return registering;
  registering = (async () => {
    if (!(await firebaseAvailable())) return;
    let perm = await callNative<{ receive?: string }>("PushNotifications", "checkPermissions");
    if (perm?.receive === "prompt" || perm?.receive === "prompt-with-rationale") {
      perm = await callNative<{ receive?: string }>("PushNotifications", "requestPermissions");
    }
    if (perm?.receive !== "granted") return;

    if (!listenersAttached) {
      listenersAttached = true;
      addNativeListener("PushNotifications", "registration", (data) => {
        const token = (data as { value?: string } | null)?.value;
        if (!token) return;
        const previous = readStoredToken();
        void fetch("/api/users/@me/push-devices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, platform: nativePlatform() }),
        })
          .then((res) => {
            if (!res.ok) return;
            nativeAppState.pushActive = true;
            storeToken(token);
            // FCM rotated the token: drop the old one.
            if (previous && previous !== token) {
              void fetch("/api/users/@me/push-devices", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token: previous }),
              }).catch(() => {});
            }
          })
          .catch(() => {});
      });
      addNativeListener("PushNotifications", "registrationError", (err) => {
        if (process.env.NODE_ENV !== "production") console.warn("[push] registration failed", err);
      });
    }
    await callNative("PushNotifications", "register");
  })().finally(() => {
    registering = null;
  });
  return registering;
}

/** Sign-out: stop pushes to this device for the account that is leaving. */
export async function unregisterPush(): Promise<void> {
  const token = readStoredToken();
  nativeAppState.pushActive = false;
  if (!token) return;
  storeToken(null);
  try {
    await fetch("/api/users/@me/push-devices", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      keepalive: true,
    });
  } catch {
    /* offline: the token is replaced on the next sign-in */
  }
}

/** The app moved to the foreground (active) or background. */
export function reportAppState(active: boolean): void {
  nativeAppState.background = !active;
  if (!nativeAppState.pushActive) return;
  void fetch("/api/users/@me/push-devices/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ away: !active }),
    keepalive: true,
  }).catch(() => {});
}
