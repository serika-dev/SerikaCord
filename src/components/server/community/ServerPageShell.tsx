"use client";

/**
 * The frame shared by the server pages under the server header
 * (/channels/:serverId/guide, /customize, /members): select the server, keep
 * no channel open (so the sidebar row shows as active) and a header bar with
 * the page's icon and title, plus a back button on phones.
 */

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useGT } from "gt-next";
import { ChevronLeft, type LucideIcon } from "lucide-react";
import { useServer } from "@/contexts/ServerContext";
import { useIsMobile } from "@/hooks/useIsMobile";

/** Select `serverId` (or leave for Home when you aren't in it) with no channel open. */
export function useServerPage(serverId: string) {
  const router = useRouter();
  const { servers, setCurrentServer, setCurrentChannel, isLoading, currentServer } = useServer();

  useEffect(() => {
    if (isLoading || servers.length === 0) return;
    const server = servers.find((s) => s.id === serverId);
    if (server) setCurrentServer(server);
    else router.push("/channels/me");
  }, [serverId, servers, isLoading, setCurrentServer, router]);

  const selected = currentServer?.id === serverId;
  useEffect(() => {
    if (selected) setCurrentChannel(null);
  }, [selected, setCurrentChannel]);

  return { server: selected ? currentServer : null };
}

export function ServerPageHeader({
  serverId,
  icon: Icon,
  title,
  children,
}: {
  serverId: string;
  icon: LucideIcon;
  title: string;
  /** Right side of the bar. */
  children?: ReactNode;
}) {
  const gt = useGT();
  const router = useRouter();
  const isMobile = useIsMobile();
  return (
    <div className="h-12 px-2 sm:px-4 flex items-center gap-2 border-b border-[var(--app-border)] bg-[var(--app-surface)] shrink-0">
      {isMobile && (
        <button
          type="button"
          onClick={() => router.push(`/channels/${serverId}`)}
          aria-label={gt("Back")}
          className="p-2 -ml-1 rounded-lg hover:bg-[var(--app-surface-alt)] transition-colors"
        >
          <ChevronLeft className="w-5 h-5 text-[var(--app-muted)]" />
        </button>
      )}
      <Icon className="w-5 h-5 shrink-0 text-[var(--text-muted)]" aria-hidden />
      <h1 className="min-w-0 flex-1 text-[15px] font-semibold text-[var(--text-primary)] truncate">{title}</h1>
      {children}
    </div>
  );
}

/** Centered message with a way back to the server (load failures, no access). */
export function ServerPageNotice({ serverId, message }: { serverId: string; message: string }) {
  const gt = useGT();
  const router = useRouter();
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 p-6 text-center text-[var(--text-secondary)]">
      <p className="text-sm">{message}</p>
      <button
        type="button"
        onClick={() => router.push(`/channels/${serverId}`)}
        className="h-9 px-4 rounded-lg bg-[var(--app-accent)] text-[var(--text-on-accent)] text-sm font-semibold hover:brightness-110"
      >
        {gt("Back to the server")}
      </button>
    </div>
  );
}
