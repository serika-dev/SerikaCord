"use client";

import { useMemo, useState } from "react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useServerOptional } from "@/contexts/ServerContext";
import { ServerTagPill } from "@/components/user/ServerTagPill";
import { serverTagPointer } from "@/lib/servers/serverProfile";
import { cn } from "@/lib/utils";

/**
 * Adopting a server tag (CORD-53): your servers with a tag turned on, the one
 * you show now, and `choose` (PUT /api/users/@me/server-tag). Shared by the
 * settings section below and the tag dropdown on your own full profile.
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

/**
 * "Server tag" section of the profile settings (CORD-53): pick one of your
 * servers that has a tag turned on to show it next to your name, or none.
 */
export function ServerTagPicker() {
  const gt = useGT();
  const { tagged, currentId, saving, choose } = useServerTagChoice();

  return (
    <div className="mt-8">
      <h2 className="text-[16px] font-bold text-[var(--text-primary)] mb-1">{gt("Server Tag")}</h2>
      <p className="text-xs text-[var(--text-muted)] mb-3">
        {gt("Show a tag from one of your servers next to your name. It disappears if you leave that server.")}
      </p>
      <div className="bg-[var(--bg-app)] rounded-xl border border-[var(--border-subtle)] p-2 space-y-1">
        {tagged.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] p-2">{gt("None of your servers have a tag yet.")}</p>
        ) : (
          <>
            <button
              type="button"
              disabled={saving !== null}
              onClick={() => void choose(null)}
              className={cn(
                "w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-sm text-left transition-colors",
                !currentId ? "bg-[var(--bg-hover)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]",
              )}
            >
              <span>{gt("No tag")}</span>
              {!currentId && <Check className="w-4 h-4 text-[var(--app-accent)]" />}
            </button>
            {tagged.map((s) => {
              const selected = currentId === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={saving !== null}
                  onClick={() => void choose(s.id)}
                  className={cn(
                    "w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-sm text-left transition-colors",
                    selected ? "bg-[var(--bg-hover)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]",
                  )}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="truncate">{s.name}</span>
                    <ServerTagPill
                      tag={{
                        serverId: s.id,
                        serverName: s.name,
                        tag: s.serverTag!.tag,
                        icon: s.serverTag!.icon,
                        color: s.serverTag!.color,
                        emoji: s.serverTag!.emoji ?? null,
                        emojiUrl: s.serverTag!.emojiUrl ?? null,
                      }}
                      interactive={false}
                    />
                  </span>
                  {selected && <Check className="w-4 h-4 shrink-0 text-[var(--app-accent)]" />}
                </button>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
