"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useServer } from "@/contexts/ServerContext";
import { useTheme } from "@/contexts/ThemeContext";

/**
 * Server themes (CORD-50): while a server's pages are open, hand its theme
 * (accent + background tint, validated server-side) to ThemeContext as an
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

  useEffect(() => {
    setServerTheme(accentColor || backgroundTint ? { accentColor, backgroundTint } : null);
  }, [accentColor, backgroundTint, setServerTheme]);

  useEffect(() => () => setServerTheme(null), [setServerTheme]);

  return null;
}
