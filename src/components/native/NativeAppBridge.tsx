"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useServer } from "@/contexts/ServerContext";
import { addNativeListener, callNative, hasNativePlugin, isNativeApp, nativePlatform } from "@/lib/native/bridge";
import { backStack, isAppRoute, parentRoute } from "@/lib/native/navigation";
import { registerForPush, reportAppState } from "@/lib/native/push";
import { firstOpaque, isDarkColor, toHex } from "@/lib/native/systemBars";
import { navigateInApp } from "@/lib/services/notificationService";

/** Overlays that close on Escape (Radix dialogs, sheets, menus, popovers). */
const OPEN_LAYER_SELECTOR = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[role="menu"][data-state="open"]',
  "[data-radix-popper-content-wrapper]",
].join(",");

interface NativeInsets {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
  keyboard?: number;
  keyboardVisible?: boolean;
}

function applyInsets(insets: NativeInsets | null) {
  if (!insets) return;
  const root = document.documentElement;
  const px = (n: unknown) => `${Math.max(0, Math.round(Number(n) || 0))}px`;
  root.style.setProperty("--native-inset-top", px(insets.top));
  root.style.setProperty("--native-inset-bottom", px(insets.bottom));
  root.style.setProperty("--native-inset-left", px(insets.left));
  root.style.setProperty("--native-inset-right", px(insets.right));
  root.style.setProperty("--native-keyboard", px(insets.keyboard));
  root.classList.toggle("keyboard-open", Boolean(insets.keyboardVisible));
}

/** The app's background colour as the theme currently resolves it. */
function readAppBackground(): string | null {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;width:0;height:0;pointer-events:none;visibility:hidden;background:var(--bg-app, var(--app-bg))";
  document.body.appendChild(probe);
  const fromVar = getComputedStyle(probe).backgroundColor;
  probe.remove();
  const color = firstOpaque([fromVar, getComputedStyle(document.body).backgroundColor, getComputedStyle(document.documentElement).backgroundColor]);
  return color ? toHex(color) : null;
}

let lastBarsKey = "";
function syncSystemBars() {
  const hex = readAppBackground();
  if (!hex) return;
  const rgb = { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16), a: 1 };
  const dark = isDarkColor(rgb);
  const key = `${hex}:${dark}`;
  if (key === lastBarsKey) return;
  lastBarsKey = key;
  if (hasNativePlugin("SerikaNative", "setSystemBars")) {
    void callNative("SerikaNative", "setSystemBars", { statusBarColor: hex, navigationBarColor: hex, darkBackground: dark });
    return;
  }
  // Older APKs: the stock StatusBar plugin (status bar only).
  void callNative("StatusBar", "setBackgroundColor", { color: hex });
  void callNative("StatusBar", "setStyle", { style: dark ? "DARK" : "LIGHT" });
}

/**
 * Glue between the web app and the Capacitor shell: Android back button,
 * system bar theming, safe-area / keyboard insets, push registration,
 * notification taps, app badge and foreground/background state. Renders
 * nothing and does nothing outside the native app.
 */
export function NativeAppBridge() {
  const router = useRouter();
  const { user } = useAuth();
  const { currentServer, setCurrentServer, setCurrentChannel } = useServer();
  const latest = useRef({ router, currentServer, setCurrentServer, setCurrentChannel });
  useEffect(() => {
    latest.current = { router, currentServer, setCurrentServer, setCurrentChannel };
  }, [router, currentServer, setCurrentServer, setCurrentChannel]);

  // One-time shell setup: classes, insets, system bars, back button, routes.
  useEffect(() => {
    if (!isNativeApp()) return;
    const root = document.documentElement;
    root.classList.add("native-app", `native-${nativePlatform()}`);
    const cleanups: Array<() => void> = [];

    // Safe areas + keyboard: measured natively (works edge to edge and with a
    // resizing WebView alike). Older APKs fall back to the Keyboard plugin.
    if (hasNativePlugin("SerikaNative", "getInsets")) {
      void callNative<NativeInsets>("SerikaNative", "getInsets").then(applyInsets);
      cleanups.push(addNativeListener("SerikaNative", "insetsChange", (d) => applyInsets(d as NativeInsets)));
    } else {
      cleanups.push(addNativeListener("Keyboard", "keyboardWillShow", () => root.classList.add("keyboard-open")));
      cleanups.push(addNativeListener("Keyboard", "keyboardWillHide", () => root.classList.remove("keyboard-open")));
    }

    // Status / navigation bars follow the theme.
    let barsTimer: number | null = null;
    const scheduleBars = () => {
      if (barsTimer !== null) window.clearTimeout(barsTimer);
      barsTimer = window.setTimeout(() => {
        barsTimer = null;
        syncSystemBars();
      }, 120);
    };
    scheduleBars();
    const observer = new MutationObserver(scheduleBars);
    observer.observe(root, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    observer.observe(document.body, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    const scheme = window.matchMedia?.("(prefers-color-scheme: dark)");
    scheme?.addEventListener?.("change", scheduleBars);
    cleanups.push(() => {
      observer.disconnect();
      scheme?.removeEventListener?.("change", scheduleBars);
      if (barsTimer !== null) window.clearTimeout(barsTimer);
    });

    // Android back: overlays first, then up the screen hierarchy, then minimize.
    const onBack = () => {
      if (backStack.handle()) return;
      if (document.querySelector(OPEN_LAYER_SELECTOR)) {
        const target = (document.activeElement as HTMLElement | null) ?? document.body;
        target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
        return;
      }
      const { router: r, currentServer: server, setCurrentServer: setServer, setCurrentChannel: setChannel } = latest.current;
      const path = window.location.pathname;
      const parent = parentRoute(path);
      const leavingServer = /^\/channels\/(?!me$|me\/|messages|notifications|profile|settings|explore)[^/]+$/.test(path);
      if ((path === "/channels/me" && server) || (leavingServer && parent === "/channels/me")) {
        setChannel(null);
        setServer(null);
        if (path !== "/channels/me") r.replace("/channels/me");
        return;
      }
      if (parent) {
        r.replace(parent);
        return;
      }
      if (hasNativePlugin("App", "minimizeApp")) void callNative("App", "minimizeApp");
      else void callNative("SerikaNative", "minimize");
    };
    cleanups.push(addNativeListener("App", "backButton", onBack));

    // Tapped notifications (push tray, incoming call, local) → route in-app.
    const openPendingRoute = () => {
      void callNative<{ route?: string }>("SerikaNative", "consumeLaunchRoute").then((res) => {
        if (isAppRoute(res?.route)) navigateInApp(res.route);
      });
    };
    openPendingRoute();
    cleanups.push(addNativeListener("SerikaNative", "launchRoute", openPendingRoute));
    cleanups.push(
      addNativeListener("PushNotifications", "pushNotificationActionPerformed", (event) => {
        const data = (event as { notification?: { data?: Record<string, unknown> } })?.notification?.data;
        if (isAppRoute(data?.route)) navigateInApp(data.route);
      }),
    );

    // Foreground / background.
    cleanups.push(
      addNativeListener("App", "appStateChange", (state) => {
        const active = (state as { isActive?: boolean })?.isActive !== false;
        reportAppState(active);
        if (active) {
          openPendingRoute();
          scheduleBars();
        }
      }),
    );

    // App badge (UnreadContext → setUnreadBadge → this hook).
    const w = window as Window & { __serikaSetBadge?: (n: number) => void };
    const previousBadge = w.__serikaSetBadge;
    if (hasNativePlugin("SerikaNative", "setBadge")) {
      w.__serikaSetBadge = (count: number) => {
        void callNative("SerikaNative", "setBadge", { count });
      };
    }

    return () => {
      cleanups.forEach((fn) => fn());
      w.__serikaSetBadge = previousBadge;
      root.classList.remove("native-app", `native-${nativePlatform()}`, "keyboard-open");
    };
  }, []);

  // Push registration once signed in.
  const userId = user?.id;
  useEffect(() => {
    if (!userId || !isNativeApp()) return;
    void registerForPush();
  }, [userId]);

  return null;
}
