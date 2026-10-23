import type { Metadata, Viewport } from "next";
import { Inter, Noto_Kufi_Arabic, Outfit } from "next/font/google";
import { GTProvider } from "gt-next";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { LocaleSync } from "@/components/LocaleSync";
import { NetworkStatus } from "@/components/ui/network-status";
import { ToasterWrapper } from "@/components/ui/ToasterWrapper";
import { ChunkReloadGuard } from "@/components/boot/ChunkReloadGuard";
import { AppProviders } from "@/components/boot/AppProviders";
import { SettingsHydrator } from "@/components/boot/SettingsHydrator";
import { MotionPreferences } from "@/components/boot/MotionPreferences";
import { TauriUpdater } from "@/components/TauriUpdater";
import { DesktopShell } from "@/components/desktop/DesktopShell";
import { buildRootMetadata } from "@/lib/seo";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

// Not preloaded: only Arabic-script text uses it (the @font-face unicode-range
// keeps everyone else from downloading it), so a <link rel=preload> made every
// visitor fetch it on startup.
// Serika display face: widget titles and other brand headings (`font-display`).
const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  display: "swap",
});

const notoKufi = Noto_Kufi_Arabic({
  variable: "--font-arabic",
  subsets: ["arabic"],
  display: "swap",
  preload: false,
});

export const metadata: Metadata = buildRootMetadata();


export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Pinch zoom stays available (accessibility); text fields are 16px on phones
  // so iOS doesn't auto-zoom on focus.
  // Browser chrome matches the app background (--app-bg in globals.css).
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#05060a" },
    { media: "(prefers-color-scheme: light)", color: "#f4f7fc" },
  ],
  // Required for env(safe-area-inset-*) to be non-zero on notched devices
  viewportFit: "cover",
  // Have the on-screen keyboard resize the layout instead of overlaying it
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const themeBootstrapScript = `
    (function () {
      try {
        var root = document.documentElement;
        root.classList.remove("theme-light", "theme-dark", "theme-midnight");
        var theme = "dark";
        var stored = localStorage.getItem("serika-theme-settings");
        if (stored) {
          var parsed = JSON.parse(stored);
          if (parsed && (parsed.theme === "light" || parsed.theme === "dark" || parsed.theme === "midnight")) {
            theme = parsed.theme;
          }
        } else {
          var fallbackTheme = localStorage.getItem("theme");
          if (fallbackTheme === "light" || fallbackTheme === "dark" || fallbackTheme === "midnight") {
            theme = fallbackTheme;
          }
        }
        root.classList.add("theme-" + theme);
        root.classList.toggle("dark", theme !== "light");
        root.style.colorScheme = theme === "light" ? "light" : "dark";
      } catch {}
    })();
  `;

  const rtlBootstrapScript = `
    (function () {
      try {
        var stored = localStorage.getItem("serika-locale");
        var locale = stored || "en";
        var rtlLocales = ["ar", "he", "fa", "ur"];
        var isRTL = rtlLocales.some(function (l) { return locale.startsWith(l); });
        var root = document.documentElement;
        root.setAttribute("lang", locale);
        root.setAttribute("dir", isRTL ? "rtl" : "ltr");
        if (isRTL) {
          root.classList.add("rtl");
        } else {
          root.classList.remove("rtl");
        }
      } catch {}
    })();
  `;

  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <head suppressHydrationWarning>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
        <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: rtlBootstrapScript }} />
        <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: "document.addEventListener('contextmenu',function(e){if(e.defaultPrevented)return;var t=e.target;if(t&&t.closest&&t.closest('input,textarea,select,[contenteditable]:not([contenteditable=\"false\"]),.chat-message-body a[href],.chat-message-body img'))return;e.preventDefault();},false);" }} />
        <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: "if(window.__TAURI__){var _f=window.fetch;window.fetch=function(u,o){o=o||{};o.headers=o.headers||{};if(o.headers instanceof Headers){o.headers.set('x-serika-client','tauri');}else{o.headers['x-serika-client']='tauri';}return _f.call(window,u,o);};}" }} />
      </head>
      <body
        className={`${inter.variable} ${outfit.variable} ${notoKufi.variable} font-sans antialiased`}
      >
        <GTProvider>
          <LocaleSync />
          <ThemeProvider>
            <MotionPreferences>
              <AuthProvider>
                <SettingsHydrator />
                <AppProviders>{children}</AppProviders>
                <NetworkStatus />
                <ToasterWrapper />
                <ChunkReloadGuard />
                <TauriUpdater />
                <DesktopShell />
              </AuthProvider>
            </MotionPreferences>
          </ThemeProvider>
        </GTProvider>
      </body>
    </html>
  );
}
