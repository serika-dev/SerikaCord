"use client";

import { useSyncExternalStore } from "react";

// ThemeContext sets `html.no-animated-emojis` when "Autoplay GIFs and animated
// emoji" is off. Reading the class (instead of the theme context) means chat
// rows only re-render when this one flag flips, not on every theme change.
const CLASS = "no-animated-emojis";

function subscribe(onChange: () => void) {
  if (typeof MutationObserver === "undefined") return () => {};
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

export function isAnimatedMediaEnabled(): boolean {
  if (typeof document === "undefined") return true;
  return !document.documentElement.classList.contains(CLASS);
}

/** False when the user turned off GIF/animated emoji autoplay. */
export function useAnimatedMedia(): boolean {
  return useSyncExternalStore(subscribe, isAnimatedMediaEnabled, () => true);
}
