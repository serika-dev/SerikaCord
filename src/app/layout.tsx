import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { NetworkStatus } from "@/components/ui/network-status";
import { ToasterWrapper } from "@/components/ui/ToasterWrapper";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SerikaCord",
  description: "A modern Discord-like chat application",
  manifest: "/manifest.json",
  icons: {
    icon: "/favicon.ico",
    apple: "/icons/icon-192x192.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "SerikaCord",
  },
  applicationName: "SerikaCord",
};

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

  return (
    <html lang="en" suppressHydrationWarning>
      <head suppressHydrationWarning>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
        <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body
        className={`${inter.variable} font-sans antialiased`}
      >
        <ThemeProvider>
          {children}
          <NetworkStatus />
          <ToasterWrapper />
        </ThemeProvider>
      </body>
    </html>
  );
}
