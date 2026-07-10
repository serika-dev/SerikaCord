import type { Metadata, Viewport } from "next";
import { Inter, Noto_Kufi_Arabic } from "next/font/google";
import { GTProvider } from "gt-next";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { NetworkStatus } from "@/components/ui/network-status";
import { ToasterWrapper } from "@/components/ui/ToasterWrapper";
import { TauriUpdater } from "@/components/TauriUpdater";
import { buildRootMetadata } from "@/lib/seo";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const notoKufi = Noto_Kufi_Arabic({
  variable: "--font-arabic",
  subsets: ["arabic"],
  display: "swap",
});

export const metadata: Metadata = buildRootMetadata();


export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#8B5CF6",
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
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
        <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
        <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: rtlBootstrapScript }} />
      </head>
      <body
        className={`${inter.variable} ${notoKufi.variable} font-sans antialiased`}
      >
        <GTProvider>
          <ThemeProvider>
            <AuthProvider>
              {children}
              <NetworkStatus />
              <ToasterWrapper />
              <TauriUpdater />
            </AuthProvider>
          </ThemeProvider>
        </GTProvider>
      </body>
    </html>
  );
}
