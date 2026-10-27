"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useGT } from "gt-next";
import { Users } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import { canViewMembersPage } from "@/lib/servers/serverPages";
import { Loader } from "@/components/ui/Loader";
import { ServerMembersView } from "@/components/server/community/ServerMembersView";
import { ServerPageHeader, useServerPage } from "@/components/server/community/ServerPageShell";

/**
 * /channels/:serverId/members — Discord's member list for moderators (Manage
 * Server, Kick, Ban or Timeout Members). Everyone else goes back to the server.
 */
export default function ServerMembersPage() {
  const params = useParams();
  const router = useRouter();
  const gt = useGT();
  const serverId = params.serverId as string;
  useServerPage(serverId);
  const { can, isOwner, loading } = usePermissions(serverId);
  const allowed = !loading && canViewMembersPage(can, isOwner);

  useEffect(() => {
    if (!loading && !allowed) router.replace(`/channels/${serverId}`);
  }, [loading, allowed, serverId, router]);

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden bg-[var(--bg-app)]">
      <ServerPageHeader serverId={serverId} icon={Users} title={gt("Members")} />

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        {allowed ? (
          <ServerMembersView serverId={serverId} />
        ) : (
          <div className="h-full flex items-center justify-center p-6">
            <Loader size={32} />
          </div>
        )}
      </div>
    </div>
  );
}
