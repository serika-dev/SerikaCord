"use client";

import { useMemo, useState } from "react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useServerOptional } from "@/contexts/ServerContext";
import { serverTagPointer } from "@/lib/servers/serverProfile";

/**
 * Adopting a server tag (CORD-53): your servers with a tag turned on, the one
 * you show now, and `choose` (PUT /api/users/@me/server-tag). Used by
 * ServerTagSelect (your own full profile and the profile settings).
 */
export function useServerTagChoice() {
  const gt = useGT();
  const { user, updateUser } = useAuth();
  const servers = useServerOptional()?.servers;
  const [saving, setSaving] = useState<string | null>(null);

  const tagged = useMemo(
    () => (servers ?? []).filter((s) => s.serverTag?.enabled && s.serverTag.tag),
    [servers],
  );
  const currentId = serverTagPointer(user?.customization);

  const choose = async (serverId: string | null): Promise<boolean> => {
    setSaving(serverId ?? "none");
    try {
      const res = await fetch("/api/users/@me/server-tag", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || gt("Couldn't update your server tag"));
        return false;
      }
      const customization = { ...((user?.customization || {}) as Record<string, unknown>) };
      // Keep the resolved tag the server returned (it carries serverId, so it
      // still works as the pointer) so your own profile can show it at once.
      if (serverId) customization.serverTag = data?.serverTag && typeof data.serverTag === "object" ? data.serverTag : { serverId };
      else delete customization.serverTag;
      updateUser({ customization } as Parameters<typeof updateUser>[0]);
      toast.success(serverId ? gt("Server tag updated") : gt("Server tag removed"));
      return true;
    } catch {
      toast.error(gt("Couldn't update your server tag"));
      return false;
    } finally {
      setSaving(null);
    }
  };

  return { tagged, currentId, saving, choose };
}

