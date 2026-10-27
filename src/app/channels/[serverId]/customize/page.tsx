"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useGT } from "gt-next";
import { TextSearch } from "lucide-react";
import { useServerOnboarding } from "@/hooks/useServerOnboarding";
import { Loader } from "@/components/ui/Loader";
import { ChannelsRolesView } from "@/components/server/community/ChannelsRolesView";
import { ServerPageHeader, ServerPageNotice, useServerPage } from "@/components/server/community/ServerPageShell";

/**
 * /channels/:serverId/customize — Discord's "Channels & Roles": answer the
 * server's onboarding questions for roles, and browse its channels.
 */
export default function ChannelsRolesPage() {
  const params = useParams();
  const gt = useGT();
  const serverId = params.serverId as string;
  useServerPage(serverId);
  const { data } = useServerOnboarding(serverId);
  const [slow, setSlow] = useState(false);

  // The onboarding store can't tell "loading" from "failed"; give up after a while.
  useEffect(() => {
    if (data) return;
    const timer = setTimeout(() => setSlow(true), 10_000);
    return () => clearTimeout(timer);
  }, [data]);

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden bg-[var(--bg-app)]">
      <ServerPageHeader serverId={serverId} icon={TextSearch} title={gt("Channels & Roles")} />

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        {data ? (
          <ChannelsRolesView serverId={serverId} data={data} />
        ) : slow ? (
          <ServerPageNotice serverId={serverId} message={gt("Couldn't load Channels & Roles.")} />
        ) : (
          <div className="h-full flex items-center justify-center p-6">
            <Loader size={32} />
          </div>
        )}
      </div>
    </div>
  );
}
