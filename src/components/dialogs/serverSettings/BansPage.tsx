"use client";

import { memo, useMemo, useState } from "react";
import { Ban } from "lucide-react";
import { useGT, useLocale } from "gt-next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { SettingsPageHeader } from "@/components/settings/SettingsSection";
import { SettingsButton } from "@/components/settings/blocks/SettingsButton";
import { SettingsEmptyState } from "@/components/settings/blocks/SettingsEmptyState";
import { SettingsListItem } from "@/components/settings/blocks/SettingsListItem";
import { SettingsSkeleton } from "@/components/settings/blocks/SettingsSkeleton";
import { SettingsSearchInput } from "@/components/settings/blocks/SettingsSearchInput";
import { SettingsToolbar } from "@/components/settings/blocks/SettingsToolbar";
import { cdnImage } from "@/lib/utils";
import { formatShortDate } from "./formatDate";
import type { BannedUser } from "./types";

/** Server Settings → Bans: searchable list of banned users, revoke on hover. */
export const BansPage = memo(function BansPage({
  bans,
  loading,
  onUnban,
}: {
  bans: BannedUser[];
  loading: boolean;
  onUnban: (userId: string) => void;
}) {
  const gt = useGT();
  const locale = useLocale();
  const [search, setSearch] = useState("");
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return bans;
    return bans.filter((b) => b.username.toLowerCase().includes(needle) || b.id.toLowerCase().includes(needle));
  }, [bans, search]);

  return (
    <div className="space-y-4">
      <SettingsPageHeader
        title={gt("Server Bans")}
        description={gt("View and manage banned users")}
        className="mb-2"
      />

      {bans.length > 0 && (
        <SettingsToolbar>
          <SettingsSearchInput
            value={search}
            onValueChange={setSearch}
            placeholder={gt("Search bans by user ID or username")}
            clearLabel={gt("Clear search")}
            className="w-full sm:w-72"
          />
          <span className="ml-auto text-xs text-[var(--text-muted)]">{gt("{count} banned", { count: bans.length })}</span>
        </SettingsToolbar>
      )}

      {loading && bans.length === 0 ? (
        <SettingsSkeleton variant="list" count={5} />
      ) : bans.length === 0 ? (
        <SettingsEmptyState icon={Ban} title={gt("No bans")} description={gt("There are no banned users in this server")} />
      ) : visible.length === 0 ? (
        <SettingsEmptyState compact icon={Ban} title={gt("No bans match your search.")} />
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] divide-y divide-[var(--border-subtle)]">
          {visible.map((ban) => {
            const date = formatShortDate(ban.bannedAt, locale);
            return (
              <SettingsListItem
                key={ban.id}
                leading={
                  <Avatar className="h-9 w-9">
                    <AvatarImage src={cdnImage(ban.avatar)} />
                    <AvatarFallback className="bg-[var(--app-accent)] text-sm text-white">{ban.username.charAt(0)}</AvatarFallback>
                  </Avatar>
                }
                title={ban.username}
                subtitle={ban.reason ? ban.reason : <span className="italic text-[var(--text-muted)]">{gt("No reason given")}</span>}
                meta={[
                  date && gt("Banned {date}", { date }),
                  ban.bannedBy?.username && gt("by {name}", { name: ban.bannedBy.username }),
                ]
                  .filter(Boolean)
                  .join(" ")}
                actionsOnHover
                actions={
                  <SettingsButton size="sm" variant="danger" onClick={() => onUnban(ban.id)}>
                    {gt("Revoke Ban")}
                  </SettingsButton>
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
});
