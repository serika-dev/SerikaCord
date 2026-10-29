import { callNative, hasNativePlugin } from "@/lib/native/bridge";

/**
 * A light haptic tick in the native apps (the shell ships @capacitor/haptics);
 * a no-op in browsers and on builds without the plugin.
 */
export function hapticTick(): void {
  if (!hasNativePlugin("Haptics", "impact")) return;
  void callNative("Haptics", "impact", { style: "LIGHT" });
}
