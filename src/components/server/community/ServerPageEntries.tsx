"use client";

/**
 * "Channels & Roles" and "Members" rows under the server header, after the
 * Server Guide and Events rows (Discord's order). Channels & Roles shows when
 * the server has onboarding questions; Members only for moderators.
 */

import { useGT } from "gt-next";
import { TextSearch, Users } from "lucide-react";
import { useServerOnboarding } from "@/hooks/useServerOnboarding";
import { usePermissions } from "@/hooks/usePermissions";
import { canViewMembersPage } from "@/lib/servers/serverPages";
import { ServerNavLink } from "./ServerNavLink";

type Variant = "sidebar" | "mobile";

export function ServerChannelsRolesEntry({ serverId, variant = "sidebar" }: { serverId: string; variant?: Variant }) {
  const gt = useGT();
  const { data } = useServerOnboarding(serverId);
  // Same rule as the onboarding flow: only once the server asks questions.
  if (!data?.onboarding || data.onboarding.questions.length === 0) return null;
  return <ServerNavLink href={`/channels/${serverId}/customize`} icon={TextSearch} label={gt("Channels & Roles")} variant={variant} />;
}

export function ServerMembersEntry({ serverId, variant = "sidebar" }: { serverId: string; variant?: Variant }) {
  const gt = useGT();
  const { can, isOwner, loading } = usePermissions(serverId);
  if (loading || !canViewMembersPage(can, isOwner)) return null;
  return <ServerNavLink href={`/channels/${serverId}/members`} icon={Users} label={gt("Members")} variant={variant} />;
}

/** Both rows, in order (the sidebar and the mobile server view render this). */
export function ServerPageEntries({ serverId, variant = "sidebar" }: { serverId: string; variant?: Variant }) {
  return (
    <>
      <ServerChannelsRolesEntry serverId={serverId} variant={variant} />
      <ServerMembersEntry serverId={serverId} variant={variant} />
    </>
  );
}
