"use client";

/**
 * "Server Guide" row under the server header (desktop sidebar and mobile
 * server view, like Discord), shown when the server has a guide. Carries a
 * small "done/total" pill while the new member to-dos aren't finished.
 */

import { useGT } from "gt-next";
import { Signpost } from "lucide-react";
import { useServerOnboarding } from "@/hooks/useServerOnboarding";
import { ServerNavLink } from "./ServerNavLink";

export function ServerGuideEntry({ serverId, variant = "sidebar" }: { serverId: string; variant?: "sidebar" | "mobile" }) {
  const gt = useGT();
  const { data } = useServerOnboarding(serverId);

  const guide = data?.guide;
  if (!data || !guide) return null;

  const total = guide.todos.length;
  const done = guide.todos.filter((t) => data.member.todosDone.includes(t.id)).length;
  const showProgress = total > 0 && done < total;

  return (
    <ServerNavLink
      href={`/channels/${serverId}/guide`}
      icon={Signpost}
      label={gt("Server Guide")}
      variant={variant}
      trailing={
        showProgress ? (
          <span
            className="shrink-0 rounded-full bg-[var(--app-accent)] px-1.5 py-0.5 text-[10px] font-bold leading-none text-[var(--text-on-accent)] tabular-nums"
            aria-label={gt("{done} of {total} to-dos done", { done, total })}
          >
            {done}/{total}
          </span>
        ) : undefined
      }
    />
  );
}
