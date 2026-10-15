/**
 * Mobile push registration (Capacitor PushNotifications → FCM token → our
 * API) and the app's foreground/background state. All no-ops on the web and
 * on APKs built without Firebase.
 */
import { addNativeListener, callNative, hasNativePlugin, isNativeApp, nativePlatform } from "./bridge";

const TOKEN_KEY = "serika:pushToken";
/** This phone's E2EE notification key id (lib/e2ee/client/notifyKey.ts). */
export const NOTIFY_KEY_ID_KEY = "serika:notifyKeyId";

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

/** The FCM token this phone registered (null when not registered). */
export function readPushToken(): string | null {
  return readStoredToken();
}

/** The notification key id this phone registered with the server, if any. */
export function readNotifyKeyId(): string | null {
  try {
    const id = localStorage.getItem(NOTIFY_KEY_ID_KEY);
    return id && /^[A-Za-z0-9_-]{22}$/.test(id) ? id : null;
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

/**
 * Push format the APK renders: 2+ draws rich message notifications natively,
 * 3+ also decrypts end-to-end encrypted previews (notification key).
 */
let pushProtocol = 0;

async function firebaseAvailable(): Promise<boolean> {
  // Older APKs without our plugin can't tell; registering there could crash
  // when google-services.json is missing, so don't.
  const caps = await callNative<{ firebase?: boolean; pushProtocol?: number }>("SerikaNative", "getCapabilities");
  pushProtocol = typeof caps?.pushProtocol === "number" ? caps.pushProtocol : 0;
  return caps?.firebase === true;
}

/** Platform sent on every registration (re-registering must not downgrade a rich-push device). */
function pushPlatform(): string {
  const base = nativePlatform();
  return base === "android" && pushProtocol >= 2 ? `android-${Math.floor(pushProtocol)}` : base;
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
        const notifyKeyId = pushProtocol >= 3 ? readNotifyKeyId() : null;
        void fetch("/api/users/@me/push-devices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, platform: pushPlatform(), ...(notifyKeyId ? { notifyKeyId } : {}) }),
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

/**
 * Sign-out: drop this phone's E2EE notification key (server and native
 * storage, with the trusted-sender list), so the next account never sees the
 * previous one's previews.
 */
async function clearNotificationKey(): Promise<void> {
  const id = readNotifyKeyId();
  try {
    localStorage.removeItem(NOTIFY_KEY_ID_KEY);
  } catch {
    /* storage blocked */
  }
  await callNative("SerikaNative", "clearNotificationKey");
  if (!id) return;
  try {
    await fetch(`/api/e2ee/notify-keys/${encodeURIComponent(id)}`, { method: "DELETE", keepalive: true });
  } catch {
    /* offline: the key is replaced when this phone sets up encryption again */
  }
}

/** Sign-out: stop pushes to this device for the account that is leaving. */
export async function unregisterPush(): Promise<void> {
  const token = readStoredToken();
  nativeAppState.pushActive = false;
  if (isNativeApp()) await clearNotificationKey();
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
