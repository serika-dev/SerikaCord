"use client";

import { createElement, memo, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useGT } from "gt-next";
import { Lock, X } from "lucide-react";
import { toast } from "sonner";
import { getConnectionIcon } from "@/components/user/ConnectionIcon";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { DomainConnectionsSection } from "@/components/settings/DomainConnectionsSection";
import { SettingsPageHeader, SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsStatusPill } from "@/components/settings/blocks/SettingsStatusPill";
import { SettingsSkeleton } from "@/components/settings/blocks/SettingsSkeleton";
import { cn } from "@/lib/utils";

type GTFunc = ReturnType<typeof useGT>;

export interface ConnectionProvider {
  id: string;
  label: string;
  color: string;
  bg: string;
  category: "social" | "gaming" | "music" | "streaming";
}

/** OAuth account providers, in the order the "Add accounts" grid shows them. */
export const CONNECTION_PROVIDERS: ConnectionProvider[] = [
  { id: "lastfm", label: "Last.fm", color: "#e4335a", bg: "#e4335a20", category: "music" },
  { id: "spotify", label: "Spotify", color: "#1db954", bg: "#1db95420", category: "music" },
  { id: "youtube", label: "YouTube", color: "#ff0000", bg: "#ff000020", category: "streaming" },
  { id: "twitch", label: "Twitch", color: "#9146ff", bg: "#9146ff20", category: "streaming" },
  { id: "steam", label: "Steam", color: "#4a90d9", bg: "#4a90d920", category: "gaming" },
  { id: "xbox", label: "Xbox", color: "#107c10", bg: "#107c1020", category: "gaming" },
  { id: "psn", label: "PlayStation", color: "#00439c", bg: "#00439c20", category: "gaming" },
  { id: "battlenet", label: "Battle.net", color: "#148eff", bg: "#148eff20", category: "gaming" },
  { id: "roblox", label: "Roblox", color: "#e8000b", bg: "#e8000b20", category: "gaming" },
  // Theme-aware: GitHub's mark is black/white, so follow the text colour.
  { id: "github", label: "GitHub", color: "var(--text-primary)", bg: "color-mix(in srgb, var(--text-primary) 8%, transparent)", category: "social" },
  { id: "twitter", label: "X / Twitter", color: "#1d9bf0", bg: "#1d9bf020", category: "social" },
  { id: "instagram", label: "Instagram", color: "#e1306c", bg: "#e1306c20", category: "social" },
  { id: "discord", label: "Discord", color: "#5865f2", bg: "#5865f220", category: "social" },
  { id: "serika", label: "Serika", color: "#8B5CF6", bg: "#8B5CF620", category: "social" },
];

/** Linked through Serika Accounts, never from here. */
const MANAGED = new Set(["serika", "discord"]);

function connectionProviderHint(id: string, gt: GTFunc): string {
  switch (id) {
    case "lastfm": return gt("Authorise via Last.fm — shows your live scrobbles on your profile.");
    case "spotify": return gt("Authorise via Spotify.");
    case "youtube": return gt("Authorise via Google/YouTube.");
    case "twitch": return gt("Authorise via Twitch.");
    case "steam": return gt("Authorise via Steam.");
    case "xbox": return gt("Authorise via Microsoft/Xbox.");
    case "psn": return gt("Authorise via PlayStation Network.");
    case "battlenet": return gt("Authorise via Battle.net.");
    case "roblox": return gt("Authorise via Roblox.");
    case "github": return gt("Authorise via GitHub.");
    case "twitter": return gt("Authorise via X.");
    case "instagram": return gt("Authorise via Instagram.");
    case "discord": return gt("Managed through your Serika account.");
    case "serika": return gt("Managed through your Serika account.");
    default: return "";
  }
}

function ProviderIcon({ provider, size = 20 }: { provider: ConnectionProvider; size?: number }) {
  return createElement(getConnectionIcon(provider.id), { size, style: { color: provider.color } });
}

/** A row from GET /api/users/me/connections (provider-specific fields). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type UserConnection = any;
type Connection = UserConnection;

/**
 * Discord's Connections page: a grid of provider tiles to add an account,
 * then one card per connected account with its "Display on profile" switch
 * and a disconnect button, then website domains.
 */
export const ConnectionsPage = memo(function ConnectionsPage({
  userConnections,
  setUserConnections,
  connectionsEnabled = true,
  disabledProviders,
  loaded,
}: {
  userConnections: Connection[];
  setUserConnections: Dispatch<SetStateAction<Connection[]>>;
  connectionsEnabled?: boolean;
  disabledProviders: string[];
  loaded: boolean;
}) {
  const gt = useGT();
  const [busyId, setBusyId] = useState<string | null>(null);

  const connectedMap = useMemo(
    () => Object.fromEntries(userConnections.map((c) => [c.provider, c])) as Record<string, Connection>,
    [userConnections],
  );
  const connectedProviders = useMemo(() => CONNECTION_PROVIDERS.filter((p) => connectedMap[p.id]), [connectedMap]);

  // OAuth return: ?success=<provider> / ?error=<provider>_<reason> in the URL.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const success = params.get("success");
    const error = params.get("error");
    if (success) {
      const label = CONNECTION_PROVIDERS.find((p) => p.id === success)?.label || success;
      toast.success(gt("{label} connected!", { label }));
      fetch("/api/users/me/connections")
        .then((r) => r.json())
        .then((d) => d.connections && setUserConnections(d.connections))
        .catch(() => {});
      params.delete("success");
      window.history.replaceState({}, "", `${window.location.pathname}${params.toString() ? `?${params}` : ""}`);
    } else if (error) {
      const msgs: Record<string, string> = {
        denied: gt("Authorisation was cancelled."),
        state_missing: gt("Session expired. Please try again."),
        session_failed: gt("Failed to complete authorisation. Please try again."),
        error: gt("An error occurred while linking the account."),
        not_configured: gt("This provider is not configured on this instance."),
        connections_disabled: gt("Connections have been temporarily disabled by staff."),
        unauthorized: gt("You must be logged in to connect an account."),
      };
      const base = error.includes("_") ? error.split("_").slice(1).join("_") : error;
      toast.error(msgs[base] || gt("Connection failed."));
      params.delete("error");
      window.history.replaceState({}, "", `${window.location.pathname}${params.toString() ? `?${params}` : ""}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDisconnect = async (connectionId: string, provider: string) => {
    setBusyId(connectionId);
    try {
      const res = await fetch(`/api/users/me/connections/${connectionId}`, { method: "DELETE" });
      if (res.ok) {
        setUserConnections((prev) => prev.filter((c) => c.id !== connectionId));
        toast.success(gt("{label} disconnected", { label: CONNECTION_PROVIDERS.find((p) => p.id === provider)?.label || provider }));
      } else {
        toast.error(gt("Failed to disconnect"));
      }
    } finally {
      setBusyId(null);
    }
  };

  const setVisible = async (conn: Connection, checked: boolean) => {
    try {
      const res = await fetch(`/api/users/me/connections/${conn.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visible: checked }),
      });
      if (res.ok) {
        const data = await res.json();
        setUserConnections((prev) => prev.map((c) => (c.id === conn.id ? data.connection : c)));
        toast.success(gt("Visibility updated"));
      } else {
        toast.error(gt("Failed to update visibility"));
      }
    } catch {
      toast.error(gt("Failed to update visibility"));
    }
  };

  return (
    <div className="space-y-8">
      <SettingsPageHeader
        title={gt("Connections")}
        description={gt("Link your accounts to show them on your profile. Some connections display live activity.")}
      />

      {!connectionsEnabled && (
        <div className="flex items-center gap-3 rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4">
          <Lock className="h-5 w-5 shrink-0 text-yellow-600 dark:text-yellow-400" aria-hidden />
          <div>
            <p className="text-sm font-semibold text-yellow-700 dark:text-yellow-400">{gt("Connections are temporarily disabled")}</p>
            <p className="text-[13px] text-[var(--text-secondary)]">{gt("Account linking has been turned off by staff. You can still disconnect existing accounts.")}</p>
          </div>
        </div>
      )}

      {/* Add accounts: provider tile grid */}
      <SettingsSection title={gt("Add accounts to your profile")} description={gt("This information won't be shared without your permission.")}>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] p-3">
          {CONNECTION_PROVIDERS.map((p) => {
            const connected = Boolean(connectedMap[p.id]);
            const managed = MANAGED.has(p.id);
            const disabled = disabledProviders.includes(p.id);
            const hint = disabled
              ? gt("Disabled")
              : connected
                ? gt("Connected")
                : connectionProviderHint(p.id, gt);
            const tile = (
              <>
                <span
                  className="flex h-11 w-11 items-center justify-center rounded-full transition-transform duration-(--motion-fast) group-hover/tile:scale-105"
                  style={{ backgroundColor: p.bg }}
                >
                  <ProviderIcon provider={p} size={22} />
                </span>
                <span className="w-full truncate text-center text-xs font-medium text-[var(--text-secondary)] group-hover/tile:text-[var(--text-primary)]">
                  {p.label}
                </span>
                {connected && (
                  <span aria-hidden className="absolute right-2 top-2 h-2 w-2 rounded-full bg-green-500 ring-2 ring-[var(--bg-app)]" />
                )}
              </>
            );
            const tileClass = "group/tile relative flex flex-col items-center gap-1.5 rounded-lg px-1 py-3 transition-colors duration-(--motion-fast)";
            const canConnect = connectionsEnabled && !disabled && !managed && !connected;
            return canConnect ? (
              <a
                key={p.id}
                href={`/api/auth/${p.id}/initiate`}
                title={hint}
                aria-label={gt("Connect {label}", { label: p.label })}
                className={cn(tileClass, "hover:bg-[var(--bg-hover)]")}
              >
                {tile}
              </a>
            ) : (
              <div
                key={p.id}
                title={hint}
                aria-disabled
                className={cn(tileClass, !connected && (disabled || !connectionsEnabled) && "opacity-40", managed && !connected && "opacity-70")}
              >
                {tile}
              </div>
            );
          })}
        </div>
      </SettingsSection>

      {/* Connected accounts */}
      {!loaded ? (
        <SettingsSkeleton variant="list" count={2} />
      ) : (
        connectedProviders.length > 0 && (
          <SettingsSection title={gt("Connected accounts")}>
            <div className="space-y-3">
              {connectedProviders.map((p) => {
                const conn = connectedMap[p.id];
                const managed = MANAGED.has(p.id);
                return (
                  <div key={p.id} data-settings-row className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)]">
                    <div className="flex items-center gap-3 px-4 py-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: p.bg }}>
                        <ProviderIcon provider={p} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-semibold text-[var(--text-primary)]">
                          {conn.displayName || conn.username || conn.accountId}
                        </p>
                        <p className="truncate text-[13px] text-[var(--text-secondary)]">{p.label}</p>
                      </div>
                      {managed ? (
                        <SettingsStatusPill tone="accent">{gt("Managed")}</SettingsStatusPill>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handleDisconnect(conn.id, p.id)}
                          disabled={busyId === conn.id}
                          title={gt("Disconnect")}
                          aria-label={gt("Disconnect")}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    <label className="flex cursor-pointer items-center justify-between gap-4 border-t border-[var(--border-subtle)] px-4 py-3 [@media(hover:hover)]:hover:bg-[var(--bg-hover)]/50">
                      <span className="text-sm font-medium text-[var(--text-primary)]">{gt("Show on profile")}</span>
                      <ToggleSwitch size="sm" checked={conn.visible !== false} onCheckedChange={(checked) => void setVisible(conn, checked)} />
                    </label>
                  </div>
                );
              })}
            </div>
          </SettingsSection>
        )
      )}

      <DomainConnectionsSection
        connections={userConnections}
        setConnections={setUserConnections}
        canAdd={connectionsEnabled && !disabledProviders.includes("website")}
      />
    </div>
  );
});
