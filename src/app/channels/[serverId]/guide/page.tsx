"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useGT } from "gt-next";
import { ChevronLeft, Signpost } from "lucide-react";
import { useServer } from "@/contexts/ServerContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useServerOnboarding } from "@/hooks/useServerOnboarding";
import { Loader } from "@/components/ui/Loader";
import { ServerGuideView } from "@/components/server/community/ServerGuideView";

/** /channels/:serverId/guide — Discord's Server Guide for the current member. */
export default function ServerGuidePage() {
  const params = useParams();
  const router = useRouter();
  const gt = useGT();
  const isMobile = useIsMobile();
  const serverId = params.serverId as string;
  const { servers, setCurrentServer, setCurrentChannel, isLoading, currentServer } = useServer();
  const { data } = useServerOnboarding(serverId);
  const [slow, setSlow] = useState(false);

  // Same as the server page: select the server once the list is loaded.
  useEffect(() => {
    if (isLoading || servers.length === 0) return;
    const server = servers.find((s) => s.id === serverId);
    if (server) setCurrentServer(server);
    else router.push("/channels/me");
  }, [serverId, servers, isLoading, setCurrentServer, router]);

  // No channel is open while the guide is (the sidebar shows the guide row active).
  useEffect(() => {
    if (currentServer?.id === serverId) setCurrentChannel(null);
  }, [currentServer?.id, serverId, setCurrentChannel]);

  // A server without a guide has nothing to show here.
  useEffect(() => {
    if (data && !data.guide) router.replace(`/channels/${serverId}`);
  }, [data, serverId, router]);

  // The onboarding store can't tell "loading" from "failed"; give up after a while.
  useEffect(() => {
    if (data) return;
    const timer = setTimeout(() => setSlow(true), 10_000);
    return () => clearTimeout(timer);
  }, [data]);

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden bg-[var(--bg-app)]">
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
        <Signpost className="w-5 h-5 shrink-0 text-[var(--text-muted)]" aria-hidden />
        <h1 className="text-[15px] font-semibold text-[var(--text-primary)] truncate">{gt("Server Guide")}</h1>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        {data?.guide ? (
          <ServerGuideView serverId={serverId} data={data} />
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-3 p-6 text-center text-[var(--text-secondary)]">
            {slow && !data ? (
              <>
                <p className="text-sm">{gt("Couldn't load the Server Guide.")}</p>
                <button
                  type="button"
                  onClick={() => router.push(`/channels/${serverId}`)}
                  className="h-9 px-4 rounded-lg bg-[var(--app-accent)] text-[var(--text-on-accent)] text-sm font-semibold hover:brightness-110"
                >
                  {gt("Back to the server")}
                </button>
              </>
            ) : (
              <Loader size={32} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
