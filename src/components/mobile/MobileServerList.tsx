"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { isInstalledApp } from "@/lib/desktop/bridge";
import { useRouter } from "next/navigation";
import { useGT } from "gt-next";
import { useServer } from "@/contexts/ServerContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Plus, Compass, Download } from "lucide-react";
import { cn, cdnImage } from "@/lib/utils";
import { useUnread } from "@/contexts/UnreadContext";
import { useServerMutes } from "@/hooks/useServerMutes";
import { useIsClient } from "@/hooks/useIsClient";
import { MountWhenOpened } from "@/components/ui/MountWhenOpened";
import { useLongPress } from "./useLongPress";

const MobileServerSheet = dynamic(() => import("./MobileServerSheet").then((m) => m.MobileServerSheet), { ssr: false });

type RailServer = ReturnType<typeof useServer>["servers"][number];

interface MobileServerListProps {
  onServerSelect?: (server: RailServer) => void;
  onCreateServer?: () => void;
}

/** Pill on the rail's left edge: tall for the open server, a dot for unread. */
function RailPill({ state }: { state: "active" | "unread" | null }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "absolute -left-3 top-1/2 w-1 -translate-y-1/2 rounded-r-full bg-[var(--text-primary)] transition-[height,opacity] duration-200",
        state === "active" ? "h-10 opacity-100" : state === "unread" ? "h-2 opacity-100" : "h-0 opacity-0",
      )}
    />
  );
}

const actionButton =
  "w-12 h-12 rounded-[24px] bg-[var(--bg-sidebar-elevated)] flex items-center justify-center text-green-500 transition-all duration-200 active:scale-95 active:rounded-[16px] touch-manipulation";

/**
 * Phone server rail (Discord mobile): home, servers with unread pills and
 * mention badges, then Explore / Add / Download. Long-press a server for its
 * menu (mark as read, mute, invite, leave...).
 */
export function MobileServerList({ onServerSelect, onCreateServer }: MobileServerListProps) {
  const router = useRouter();
  const gt = useGT();
  const isClient = useIsClient();
  const { servers, currentServer, setCurrentServer, setCurrentChannel, prefetchServer } = useServer();
  // Same unread/mention sources as the desktop ServerSidebar.
  // DM unreads badge the bottom nav's Messages tab, not Home: on phones Home
  // opens Friends (CORD-63).
  const { isServerUnread, getServerMentionCount } = useUnread();
  const { isMuted } = useServerMutes();
  const [sheetServer, setSheetServer] = useState<RailServer | null>(null);
  const serverPress = useLongPress<RailServer>(setSheetServer);

  const handleServerClick = (server: RailServer) => {
    if (serverPress.wasLongPress()) return;
    setCurrentServer(server);
    setCurrentChannel(null);
    if (onServerSelect) {
      onServerSelect(server);
    } else {
      router.push(`/channels/${server.id}`);
    }
  };

  const handleHomeClick = () => {
    setCurrentServer(null);
    setCurrentChannel(null);
    router.push("/channels/me");
  };

  const handleExploreClick = () => {
    setCurrentServer(null);
    setCurrentChannel(null);
    router.push("/channels/explore");
  };

  return (
    <nav
      aria-label={gt("Servers")}
      className="flex h-full w-[72px] min-w-[72px] flex-col bg-[var(--bg-sidebar)] pt-safe"
    >
      <div className="flex-1 overflow-y-auto overscroll-contain scrollbar-hide pt-2.5 pb-[calc(var(--mobile-content-pb)+0.75rem)]">
        <div className="flex flex-col items-center gap-2.5 px-3">
          {/* Home (friends) */}
          <div className="relative">
            <RailPill state={!currentServer ? "active" : null} />
            <button
              type="button"
              onClick={handleHomeClick}
              aria-label={gt("Home")}
              className={cn(
                "relative flex h-12 w-12 touch-manipulation items-center justify-center transition-all duration-200 active:scale-95",
                !currentServer
                  ? "rounded-[16px] bg-[var(--app-accent)] text-[var(--text-on-accent)]"
                  : "rounded-[24px] bg-[var(--bg-sidebar-elevated)] text-[var(--text-primary)]",
              )}
            >
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M19.73 4.87l-3.5-1.7a1 1 0 00-.87 0L12 4.86 8.64 3.17a1 1 0 00-.87 0l-3.5 1.7A1 1 0 004 5.74v12.52a1 1 0 00.63.93l3.5 1.4a1 1 0 00.74 0L12 19.2l3.13 1.39a1 1 0 00.74 0l3.5-1.4a1 1 0 00.63-.93V5.74a1 1 0 00-.27-.87zM11 17.67l-3 1.33V6.73l3 1.33zm5 1.33l-3-1.33V8.06l3-1.33z" />
              </svg>
            </button>
          </div>

          <div className="h-0.5 w-8 rounded-full bg-[var(--bg-sidebar-elevated)]" />

          {servers.map((server) => {
            const muted = isMuted(server.id);
            // Muted servers still badge mentions (Discord parity, same as the desktop rail).
            const mentionCount = getServerMentionCount(server.id);
            const hasUnread = !muted && isServerUnread(server.id);
            const isActive = currentServer?.id === server.id;

            return (
              <div key={server.id} className="relative">
                <RailPill state={isActive ? "active" : hasUnread ? "unread" : null} />
                <button
                  type="button"
                  {...serverPress.bind(server)}
                  onClick={() => handleServerClick(server)}
                  onTouchStartCapture={() => prefetchServer(server.id)}
                  aria-label={server.name}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "relative block h-12 w-12 touch-manipulation select-none transition-all duration-200 active:scale-95",
                    muted && !isActive && "opacity-50",
                  )}
                >
                  <span
                    className={cn(
                      "block h-12 w-12 overflow-hidden transition-[border-radius] duration-200",
                      isActive ? "rounded-[16px]" : "rounded-[24px]",
                    )}
                  >
                    {server.icon ? (
                      <Avatar className="h-12 w-12 rounded-none">
                        <AvatarImage src={cdnImage(server.icon)} className="object-cover" />
                        <AvatarFallback className="rounded-none bg-[var(--app-accent)] text-lg font-semibold text-[var(--text-on-accent)]">
                          {server.name.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    ) : (
                      <span
                        className={cn(
                          "flex h-full w-full items-center justify-center text-lg font-semibold",
                          isActive
                            ? "bg-[var(--app-accent)] text-[var(--text-on-accent)]"
                            : "bg-[var(--bg-sidebar-elevated)] text-[var(--text-primary)]",
                        )}
                      >
                        {server.name.charAt(0).toUpperCase()}
                      </span>
                    )}
                  </span>

                  {/* Mention badge sits outside the clipped icon (not cut off). */}
                  {mentionCount > 0 && (
                    <span className="absolute -bottom-0.5 -right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-[3px] border-[var(--bg-sidebar)] bg-red-500 px-1 text-[10px] font-bold text-white">
                      {mentionCount > 99 ? "99+" : mentionCount}
                    </span>
                  )}
                </button>
              </div>
            );
          })}

          <div className="h-0.5 w-8 rounded-full bg-[var(--bg-sidebar-elevated)]" />

          <button type="button" onClick={onCreateServer} aria-label={gt("Add a Server")} className={actionButton}>
            <Plus className="h-6 w-6" />
          </button>
          <button type="button" onClick={handleExploreClick} aria-label={gt("Explore Discoverable Servers")} className={actionButton}>
            <Compass className="h-6 w-6" />
          </button>

          {/* Download — only in a browser, hidden in every installed app.
              Waits for hydration so server and client markup match. */}
          {isClient && !isInstalledApp() && (
            <button type="button" onClick={() => router.push("/download")} aria-label={gt("Download Apps")} className={actionButton}>
              <Download className="h-6 w-6" />
            </button>
          )}
        </div>
      </div>

      <MountWhenOpened open={!!sheetServer}>
        {sheetServer && <MobileServerSheet server={sheetServer} onClose={() => setSheetServer(null)} />}
      </MountWhenOpened>
    </nav>
  );
}
