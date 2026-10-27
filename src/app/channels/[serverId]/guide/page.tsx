"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useGT } from "gt-next";
import { Signpost } from "lucide-react";
import { useServerOnboarding } from "@/hooks/useServerOnboarding";
import { Loader } from "@/components/ui/Loader";
import { ServerGuideView } from "@/components/server/community/ServerGuideView";
import { ServerPageHeader, ServerPageNotice, useServerPage } from "@/components/server/community/ServerPageShell";

/** /channels/:serverId/guide — Discord's Server Guide for the current member. */
export default function ServerGuidePage() {
  const params = useParams();
  const router = useRouter();
  const gt = useGT();
  const serverId = params.serverId as string;
  useServerPage(serverId);
  const { data } = useServerOnboarding(serverId);
  const [slow, setSlow] = useState(false);

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
      <ServerPageHeader serverId={serverId} icon={Signpost} title={gt("Server Guide")} />

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        {data?.guide ? (
          <ServerGuideView serverId={serverId} data={data} />
        ) : slow && !data ? (
          <ServerPageNotice serverId={serverId} message={gt("Couldn't load the Server Guide.")} />
        ) : (
          <div className="h-full flex items-center justify-center p-6">
            <Loader size={32} />
          </div>
        )}
      </div>
    </div>
  );
}
