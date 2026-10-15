/**
 * Which app download fits the visitor's device. Pure helpers (tested in
 * tests/home-landing.test.ts); `detectPlatform` reads the browser.
 */

export type ClientPlatform = "windows" | "mac" | "linux" | "android" | "ios" | "unknown";

/**
 * `touchPoints` disambiguates iPadOS, which reports a desktop Mac user agent
 * (Macs have no touch screen, so more than one touch point means an iPad).
 */
export function platformFromUserAgent(userAgent: string, touchPoints = 0): ClientPlatform {
  const ua = userAgent.toLowerCase();
  if (/android/.test(ua)) return "android";
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (/windows/.test(ua)) return "windows";
  if (/mac os|macintosh/.test(ua)) return touchPoints > 1 ? "ios" : "mac";
  if (/linux|x11|cros/.test(ua)) return "linux";
  return "unknown";
}

export function detectPlatform(): ClientPlatform {
  if (typeof navigator === "undefined") return "unknown";
  return platformFromUserAgent(navigator.userAgent, navigator.maxTouchPoints ?? 0);
}
