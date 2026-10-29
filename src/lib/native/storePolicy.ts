import { useSyncExternalStore } from "react";
import { nativePlatform } from "./bridge";

/**
 * App Store rules for the iOS app (Guideline 3.1.1): digital purchases must
 * use In-App Purchase, and the app may not point people to another way to
 * buy. The iOS shell therefore shows no Serika+ upsell, price, "Upgrade" or
 * "Subscribe" button. Existing subscribers keep their perks and still see
 * that they have Serika+. Android and the web are unchanged.
 *
 * The native shell injects `window.Capacitor` before the page runs, so the
 * answer never changes after load.
 */
export function hidesPurchases(): boolean {
  return nativePlatform() === "ios";
}

const noopSubscribe = () => () => {};
const getServerSnapshot = () => false;

/** Hook form of `hidesPurchases()`; false during server render and hydration. */
export function useHidesPurchases(): boolean {
  return useSyncExternalStore(noopSubscribe, hidesPurchases, getServerSnapshot);
}
