/**
 * Run `fn` against the voice service without importing it statically. The
 * root layout (ThemeContext, SettingsHydrator) only forwards saved settings to
 * it; a static import put the whole WebRTC client in every page's startup
 * bundle, including the landing and login pages. Pages that use voice import
 * it directly, so the chunk is usually already loaded and this resolves in a
 * microtask.
 */
export function withVoiceService(fn: (service: typeof import("./voiceService").voiceService) => void): void {
  if (typeof window === "undefined") return;
  void import("./voiceService")
    .then((m) => fn(m.voiceService))
    .catch(() => {
      /* chunk failed to load: settings apply on the next save/reload */
    });
}
