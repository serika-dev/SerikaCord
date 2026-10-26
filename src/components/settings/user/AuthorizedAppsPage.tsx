"use client";

import { memo, useState, type Dispatch, type SetStateAction } from "react";
import { useGT, useLocale } from "gt-next";
import { Check, Plug } from "lucide-react";
import { toast } from "sonner";
import { SettingsPageHeader } from "@/components/settings/SettingsSection";
import { SettingsButton } from "@/components/settings/blocks/SettingsButton";
import { SettingsEmptyState } from "@/components/settings/blocks/SettingsEmptyState";
import { SettingsSkeleton } from "@/components/settings/blocks/SettingsSkeleton";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { cdnImage } from "@/lib/utils";

export interface AuthorizedAppEntry {
  id: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  scopes?: string[];
  approvedAt?: string;
  lastUsedAt?: string;
}

/** OAuth2 scope ids → what the app can do, in Discord's wording. */
function scopeLabel(scope: string, gt: ReturnType<typeof useGT>): string {
  switch (scope) {
    case "identify": return gt("Access your username, avatar, and banner");
    case "email": return gt("Access your email address");
    case "guilds": return gt("Know what servers you're in");
    case "guilds.join": return gt("Join servers for you");
    case "guilds.members.read": return gt("Read your member info in servers");
    case "connections": return gt("Access your third-party connections");
    case "bot": return gt("Add a bot to a server");
    case "applications.commands": return gt("Create commands");
    case "messages.read": return gt("Read messages from all channels you are in");
    case "rpc": return gt("Control your app's activity and voice settings");
    case "activities.write": return gt("Update your activity status");
    default: return scope;
  }
}

/**
 * Discord's Authorized Apps: one card per app with its icon, name and
 * description, what it can access, and a Deauthorize button.
 */
export const AuthorizedAppsPage = memo(function AuthorizedAppsPage({
  apps,
  setApps,
  loaded,
}: {
  apps: AuthorizedAppEntry[];
  setApps: Dispatch<SetStateAction<AuthorizedAppEntry[]>>;
  loaded: boolean;
}) {
  const gt = useGT();
  const locale = useLocale();
  const confirm = useConfirm();
  const [busyId, setBusyId] = useState<string | null>(null);

  const deauthorize = async (app: AuthorizedAppEntry) => {
    const ok = await confirm({
      title: gt("Deauthorize {name}?", { name: app.name }),
      description: gt("It loses access to your account straight away. You can authorize it again later."),
      confirmLabel: gt("Deauthorize"),
    });
    if (!ok) return;
    setBusyId(app.id);
    try {
      const response = await fetch(`/api/users/me/authorized-apps/${app.id}`, { method: "DELETE" });
      if (response.ok) {
        setApps((prev) => prev.filter((item) => item.id !== app.id));
        toast.success(gt("App access revoked"));
      } else {
        toast.error(gt("Failed to revoke app"));
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title={gt("Authorized Apps")}
        description={gt("Apps you've allowed to use your account. Deauthorize any you no longer use.")}
      />

      {!loaded ? (
        <SettingsSkeleton variant="list" count={3} />
      ) : apps.length === 0 ? (
        <SettingsEmptyState
          icon={Plug}
          title={gt("No authorized apps connected.")}
          description={gt("When you sign in to an app with SerikaCord, it shows up here.")}
        />
      ) : (
        <div className="space-y-3">
          {apps.map((app) => {
            const scopes = Array.isArray(app.scopes) ? app.scopes : [];
            return (
              <div
                key={app.id}
                data-settings-row
                className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)]"
              >
                <div className="flex items-start gap-3 px-4 py-3.5 max-sm:flex-wrap">
                  {app.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={cdnImage(app.icon)} alt="" className="h-10 w-10 shrink-0 rounded-xl object-cover" />
                  ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--app-accent)] text-base font-bold text-[var(--text-on-accent)]">
                      {app.name.charAt(0).toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold text-[var(--text-primary)]">{app.name}</p>
                    <p className="mt-0.5 text-[13px] leading-snug text-[var(--text-secondary)]">{app.description || gt("No description")}</p>
                  </div>
                  <SettingsButton
                    variant="danger"
                    size="sm"
                    disabled={busyId === app.id}
                    onClick={() => void deauthorize(app)}
                    className="max-sm:w-full"
                  >
                    {gt("Deauthorize")}
                  </SettingsButton>
                </div>
                {(scopes.length > 0 || app.approvedAt) && (
                  <div className="border-t border-[var(--border-subtle)] px-4 py-3">
                    {scopes.length > 0 && (
                      <>
                        <p className="mb-2 text-xs font-bold uppercase tracking-[0.04em] text-[var(--text-muted)]">{gt("Permissions")}</p>
                        <ul className="grid gap-1.5 sm:grid-cols-2">
                          {scopes.map((scope) => (
                            <li key={scope} className="flex items-start gap-2 text-[13px] text-[var(--text-secondary)]">
                              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-500" aria-hidden />
                              <span>{scopeLabel(scope, gt)}</span>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {app.approvedAt && (
                      <p className="mt-2 text-xs text-[var(--text-muted)]">
                        {gt("Authorized on {date}", {
                          date: new Date(app.approvedAt).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" }),
                        })}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
