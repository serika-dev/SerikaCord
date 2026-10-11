/**
 * What a "go back" (Android back button, or Escape) does inside the full-screen
 * user settings. Discord-mobile style: a pushed page pops back to the grouped
 * list first, and only the list itself closes settings.
 *
 * - "pass":  a nested dialog/menu/popover is open; let it handle the press.
 * - "root":  phone width on a pushed page; return to the settings list.
 * - "close": close the settings overlay.
 */
export type SettingsBackAction = "pass" | "root" | "close";

export function settingsBackAction(input: {
  phone: boolean;
  onRoot: boolean;
  nestedOpen: boolean;
}): SettingsBackAction {
  if (input.nestedOpen) return "pass";
  if (input.phone && !input.onRoot) return "root";
  return "close";
}

/** Same breakpoint as Tailwind's `max-md:` (the settings phone layout). */
export const SETTINGS_PHONE_QUERY = "(max-width: 767.98px)";

/** Open overlays nested inside settings that should get the back press first. */
export const SETTINGS_NESTED_LAYER_SELECTOR =
  '[role="dialog"],[role="alertdialog"],[role="menu"],[data-radix-popper-content-wrapper]';

/** Read the live DOM state the decision needs (client only). */
export function readSettingsBackAction(onRoot: boolean): SettingsBackAction {
  if (typeof window === "undefined") return "close";
  return settingsBackAction({
    phone: window.matchMedia?.(SETTINGS_PHONE_QUERY).matches ?? false,
    onRoot,
    nestedOpen: !!document.querySelector(SETTINGS_NESTED_LAYER_SELECTOR),
  });
}
