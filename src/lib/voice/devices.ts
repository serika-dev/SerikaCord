// Which microphone, speaker and camera this browser uses for calls. Device ids
// are only meaningful on the machine that produced them, so (like Discord) the
// choice is kept per device in localStorage instead of in account settings.

export type MediaDeviceRole = "input" | "output" | "video";

export const DEFAULT_DEVICE_ID = "default";

const STORAGE_KEYS: Record<MediaDeviceRole, string> = {
  input: "serika-voice-input-device",
  output: "serika-voice-output-device",
  video: "serika-voice-video-device",
};

export interface DeviceChoice {
  deviceId: string;
  label: string;
}

/**
 * Turn `enumerateDevices()` output into picker options for one kind. Devices
 * without a label (permission not granted yet) get a numbered fallback name;
 * the browser's own "default" entry is dropped (the picker has its own).
 */
export function deviceChoices(
  devices: ReadonlyArray<{ deviceId: string; kind: string; label: string }>,
  kind: MediaDeviceKind,
  fallbackName: (index: number) => string,
): DeviceChoice[] {
  const seen = new Set<string>();
  const out: DeviceChoice[] = [];
  for (const d of devices) {
    if (d.kind !== kind || !d.deviceId || d.deviceId === DEFAULT_DEVICE_ID || d.deviceId === "communications") continue;
    if (seen.has(d.deviceId)) continue;
    seen.add(d.deviceId);
    out.push({ deviceId: d.deviceId, label: d.label || fallbackName(out.length + 1) });
  }
  return out;
}

/** getUserMedia constraint for a preferred device: `ideal`, so a missing one falls back. */
export function deviceConstraint(deviceId: string | null | undefined): { deviceId?: { ideal: string } } {
  if (!deviceId || deviceId === DEFAULT_DEVICE_ID) return {};
  return { deviceId: { ideal: deviceId } };
}

const listeners = new Set<() => void>();
let storageHooked = false;

export function getPreferredDevice(role: MediaDeviceRole): string {
  try {
    if (typeof localStorage === "undefined") return DEFAULT_DEVICE_ID;
    return localStorage.getItem(STORAGE_KEYS[role]) || DEFAULT_DEVICE_ID;
  } catch {
    return DEFAULT_DEVICE_ID;
  }
}

export function setPreferredDevice(role: MediaDeviceRole, deviceId: string) {
  try {
    if (!deviceId || deviceId === DEFAULT_DEVICE_ID) localStorage.removeItem(STORAGE_KEYS[role]);
    else localStorage.setItem(STORAGE_KEYS[role], deviceId);
  } catch {
    // storage blocked: the choice still applies to this call
  }
  listeners.forEach((fn) => fn());
}

export function subscribePreferredDevices(fn: () => void): () => void {
  if (!storageHooked && typeof window !== "undefined") {
    storageHooked = true;
    window.addEventListener("storage", (e) => {
      if (e.key && Object.values(STORAGE_KEYS).includes(e.key)) listeners.forEach((l) => l());
    });
  }
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Whether audio elements can be routed to a chosen speaker in this browser. */
export function canPickOutputDevice(): boolean {
  return typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
}

/** Route an element to the chosen speaker (no-op where unsupported). */
export function applySinkId(el: HTMLMediaElement, deviceId: string): void {
  const withSink = el as HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> };
  if (typeof withSink.setSinkId !== "function") return;
  const id = deviceId === DEFAULT_DEVICE_ID ? "" : deviceId;
  void withSink.setSinkId(id).catch(() => {
    // The device went away: fall back to the system default.
    void withSink.setSinkId?.("").catch(() => {});
  });
}
