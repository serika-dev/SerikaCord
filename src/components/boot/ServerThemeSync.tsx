"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useServer } from "@/contexts/ServerContext";
import { useTheme } from "@/contexts/ThemeContext";
import { parseThemeGradientKey, themeGradientKey } from "@/lib/appearance/customization";

/**
 * Server themes (CORD-50): while a server's pages are open, hand its theme
 * (accent + gradient, validated server-side) to ThemeContext as an
 * override layer. Leaving the server (DMs, settings, another server) clears
 * it. Whether it is applied at all is the user's "Use server themes" setting,
 * which ThemeContext checks.
 */
export function ServerThemeSync() {
  const { currentServer, servers } = useServer();
  const { setServerTheme } = useTheme();
  const pathname = usePathname();
  const serverId = currentServer?.id ?? null;
  const inServer = Boolean(serverId && pathname?.startsWith(`/channels/${serverId}`));
  // The /@me/servers list carries the theme (refreshed by its poll), even
  // when currentServer was set from another response.
  const listed = inServer ? servers.find((s) => s.id === serverId) : undefined;
  const theme = inServer ? (listed?.theme ?? currentServer?.theme ?? null) : null;
  const accentColor = theme?.accentColor ?? null;
  const backgroundTint = theme?.backgroundTint ?? null;
  // A string key so the 25s server-list poll (fresh objects) doesn't re-apply.
  const gradientKey = themeGradientKey(theme?.gradient);

  useEffect(() => {
    const gradient = parseThemeGradientKey(gradientKey);
    setServerTheme(accentColor || backgroundTint || gradient ? { accentColor, backgroundTint, gradient } : null);
  }, [accentColor, backgroundTint, gradientKey, setServerTheme]);

  useEffect(() => () => setServerTheme(null), [setServerTheme]);

  return null;
}
