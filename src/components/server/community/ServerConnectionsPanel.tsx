"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { T, useGT } from "gt-next";
import { BadgeCheck, Eye, Info } from "lucide-react";
import { toast } from "sonner";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { SettingsSkeleton } from "@/components/settings/blocks/SettingsSkeleton";
import { MountWhenOpened } from "@/components/ui/MountWhenOpened";
import { ConnectionIcon } from "@/components/user/ConnectionIcon";
import { invalidateServerOnboarding, type ServerConnectionView } from "@/hooks/useServerOnboarding";
import { LINKED_CONNECTIONS_MAX } from "@/lib/servers/onboarding";
import { mergeConnectionViews } from "@/lib/connections/serverOwned";
import { ServerOwnedConnectionsSection, type ServerOwnedConnection } from "./ServerOwnedConnectionsSection";

// The admin preview of the join flow loads on first open.
const JoinPreviewDialog = dynamic(() => import("@/components/server/community/JoinPreviewDialog"), { ssr: false });

/** GET /api/users/me/connections row. */
interface OwnConnection {
  id: string;
  provider: string;
  accountId: string;
  username?: string | null;
  displayName?: string | null;
  domain?: { name: string; verified: boolean };
}

/** Providers whose rows only an OAuth sign-in can create (src/lib/connections/policy.ts). */
const OAUTH_PROVIDERS = new Set(["discord", "github", "spotify", "twitch", "steam", "lastfm", "serika"]);

type Loaded = {
  serverId: string;
  shown: ServerConnectionView[];
  /** Owner only. */
  own: OwnConnection[];
  draft: string[];
  saved: string[];
  /** Owner only: the server's own domains / accounts and what can be added. */
  serverOwned: ServerOwnedConnection[];
  linkableProviders: string[];
  domainsAllowed: boolean;
  ownedMax: number;
} | null;

function connectionName(c: { provider: string; accountId: string; username?: string | null; displayName?: string | null; domain?: { name: string } }): string {
  if (c.provider === "website") return c.domain?.name || c.accountId;
  return c.displayName || c.username || c.accountId;
}

function isVerifiedOwn(c: OwnConnection): boolean {
  return c.provider === "website" ? c.domain?.verified === true : OAUTH_PROVIDERS.has(c.provider);
}

function isLinkable(c: OwnConnection): boolean {
  return c.provider !== "website" || c.domain?.verified === true;
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function VerifiedBadge() {
  const gt = useGT();
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-[var(--app-accent)]/15 text-[var(--app-accent)]" title={gt("Verified")}>
      <BadgeCheck className="w-3.5 h-3.5" />
      <T>Verified</T>
    </span>
  );
}

/**
 * Server Settings → Server Connections. The owner manages the server's own
 * accounts (domains verified by DNS, accounts linked by an OAuth sign-in made
 * for the server) and picks which of their personal linked accounts the server
 * also shows on its profile, invite page and Server Guide.
 */
export default function ServerConnectionsPanel({ serverId, isOwner }: { serverId: string; isOwner: boolean }) {
  const gt = useGT();
  const [loaded, setLoaded] = useState<Loaded>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const [serverRes, ownRes] = await Promise.all([
        fetch(`/api/servers/${serverId}/connections`, { credentials: "include" }),
        isOwner ? fetch("/api/users/me/connections", { credentials: "include" }) : Promise.resolve(null),
      ]);
      if (!serverRes.ok) throw new Error("load failed");
      const data = await serverRes.json();
      const own = ownRes && ownRes.ok ? ((await ownRes.json())?.connections as OwnConnection[] | undefined) ?? [] : [];
      const linked: string[] = Array.isArray(data?.linkedConnectionIds) ? data.linkedConnectionIds : [];
      if (!active) return;
      setLoaded({
        serverId,
        shown: Array.isArray(data?.connections) ? data.connections : [],
        own,
        draft: linked,
        saved: linked,
        serverOwned: Array.isArray(data?.serverOwned) ? data.serverOwned : [],
        linkableProviders: Array.isArray(data?.linkableProviders) ? data.linkableProviders.filter((p: unknown): p is string => typeof p === "string") : [],
        domainsAllowed: data?.domainsAllowed === true,
        ownedMax: typeof data?.limits?.total === "number" ? data.limits.total : 10,
      });
    };
    load().catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [serverId, isOwner]);

  if (failed && !loaded) {
    return (
      <p className="py-12 text-center text-sm text-[var(--text-muted)]">
        <T>Could not load server connections.</T>
      </p>
    );
  }
  if (!loaded || loaded.serverId !== serverId) {
    return (
      <div aria-hidden className="space-y-6">
        <div className="space-y-2 max-md:hidden">
          <span className="block h-5 w-40 animate-pulse rounded bg-[var(--bg-hover)]" />
          <span className="block h-3.5 w-72 max-w-full animate-pulse rounded bg-[var(--bg-hover)]" />
        </div>
        <SettingsSkeleton variant="rows" count={5} />
      </div>
    );
  }

  const header = (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-xl font-bold leading-tight text-[var(--text-primary)] mb-1 max-md:hidden"><T>Server Connections</T></h2>
        <p className="text-sm text-[var(--text-secondary)]">
          <T>Show accounts you own on your server&apos;s profile, invite page and Server Guide, so members know the server is really yours.</T>
        </p>
      </div>
      {isOwner && (
        <button
          type="button"
          onClick={() => setPreviewOpen(true)}
          className="h-10 px-4 shrink-0 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] flex items-center justify-center gap-2"
        >
          <Eye className="w-4 h-4" />
          <T>Preview invite</T>
        </button>
      )}
    </div>
  );

  // ── Everyone but the owner: read-only ──
  if (!isOwner) {
    return (
      <div className="space-y-6">
        {header}
        <p className="flex items-start gap-2 p-3 rounded-lg bg-[var(--bg-app)] max-md:bg-[var(--bg-card)] border border-[var(--border-subtle)] text-sm text-[var(--text-secondary)]">
          <Info className="w-4 h-4 shrink-0 mt-0.5 text-[var(--text-muted)]" />
          <T>Only the server owner can link connections.</T>
        </p>
        {loaded.shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--text-muted)]"><T>No connections are shown on this server.</T></p>
        ) : (
          <ul className="space-y-2">
            {loaded.shown.map((c) => (
              <li key={`${c.source ?? "owner"}:${c.id}`} className="flex items-center gap-3 min-h-14 px-3 py-2 rounded-lg bg-[var(--bg-app)] max-md:bg-[var(--bg-card)] border border-[var(--border-subtle)]">
                <span className="w-9 h-9 shrink-0 rounded-md bg-[var(--bg-hover)] flex items-center justify-center">
                  <ConnectionIcon provider={c.provider} accountId={c.accountId} size={18} />
                </span>
                <span className="flex-1 min-w-0 text-sm font-medium text-[var(--text-primary)] truncate">{connectionName(c)}</span>
                {c.verified && <VerifiedBadge />}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // ── Owner: pick from their own connections ──
  const ownById = new Map(loaded.own.map((c) => [c.id, c]));
  const draft = loaded.draft;
  // Accounts disconnected from the owner's profile since are dropped on save.
  const linkedIds = draft.filter((id) => ownById.has(id));
  const dirty = !sameList(linkedIds, loaded.saved);
  const full = linkedIds.length >= LINKED_CONNECTIONS_MAX;
  const setDraft = (next: string[]) => setLoaded({ ...loaded, draft: next });

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/servers/${serverId}/connections`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionIds: linkedIds }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(typeof data?.error === "string" ? data.error : gt("Could not save server connections"));
        return;
      }
      const linked: string[] = Array.isArray(data?.linkedConnectionIds) ? data.linkedConnectionIds : linkedIds;
      setLoaded({
        ...loaded,
        shown: Array.isArray(data?.connections) ? data.connections : loaded.shown,
        draft: linked,
        saved: linked,
      });
      invalidateServerOnboarding(serverId);
      toast.success(gt("Server connections saved"));
    } catch {
      toast.error(gt("Could not save server connections"));
    } finally {
      setSaving(false);
    }
  };

  const ownerPreview: ServerConnectionView[] = linkedIds
    .map((id) => ownById.get(id))
    .filter((c): c is OwnConnection => Boolean(c))
    .map((c) => ({
      id: c.id,
      provider: c.provider,
      accountId: c.provider === "website" ? c.domain?.name || c.accountId : c.accountId,
      username: c.username ?? null,
      displayName: c.displayName ?? null,
      verified: isVerifiedOwn(c),
      source: "owner" as const,
    }));
  // Same order as the server builds it: the server's own verified accounts first.
  const serverPreview: ServerConnectionView[] = loaded.serverOwned
    .filter((c) => c.verified && c.visible)
    .map((c) => ({
      id: c.id,
      provider: c.provider,
      accountId: c.provider === "website" ? c.domain?.name || c.accountId : c.accountId,
      username: c.username,
      displayName: c.displayName,
      verified: true,
      source: "server" as const,
    }));
  const previewConnections = mergeConnectionViews(serverPreview, ownerPreview);

  return (
    <div className="space-y-6">
      {header}

      <ServerOwnedConnectionsSection
        serverId={serverId}
        rows={loaded.serverOwned}
        onRowsChange={(serverOwned) => setLoaded({ ...loaded, serverOwned })}
        linkableProviders={loaded.linkableProviders}
        domainsAllowed={loaded.domainsAllowed}
        max={loaded.ownedMax}
        onChanged={() => invalidateServerOnboarding(serverId)}
      />

      <div className="flex items-center justify-between gap-2 pt-2 border-t border-[var(--border-subtle)]">
        <span className="text-xs font-bold uppercase text-[var(--text-secondary)]"><T>From your account</T></span>
        <span className="text-xs text-[var(--text-muted)]">{linkedIds.length}/{LINKED_CONNECTIONS_MAX}</span>
      </div>

      {loaded.own.length === 0 ? (
        <div className="py-8 px-4 text-center rounded-lg border border-dashed border-[var(--border-subtle)]">
          <p className="text-sm text-[var(--text-secondary)]"><T>You haven&apos;t linked any accounts yet.</T></p>
          <p className="text-xs text-[var(--text-muted)] mt-1"><T>Add them in User Settings → Connections, then come back here.</T></p>
        </div>
      ) : (
        <ul className="space-y-2">
          {loaded.own.map((c) => {
            const linkable = isLinkable(c);
            const checked = draft.includes(c.id);
            const disabled = !linkable || (!checked && full);
            return (
              <li key={c.id}>
                <label
                  className={`flex items-center gap-3 min-h-14 px-3 py-2 rounded-lg bg-[var(--bg-card)] border ${checked ? "border-[var(--app-accent)]" : "border-[var(--border-subtle)]"} ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
                >
                  <span className="w-9 h-9 shrink-0 rounded-md bg-[var(--bg-hover)] flex items-center justify-center">
                    <ConnectionIcon provider={c.provider} accountId={c.provider === "website" && c.domain?.verified ? c.domain.name : null} size={18} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium text-[var(--text-primary)] truncate max-w-full">{connectionName(c)}</span>
                      {isVerifiedOwn(c) && <VerifiedBadge />}
                    </span>
                    {!linkable ? (
                      <span className="block text-xs text-[var(--text-muted)] mt-0.5">
                        <T>Verify this domain in User Settings → Connections first.</T>
                      </span>
                    ) : !isVerifiedOwn(c) ? (
                      <span className="block text-xs text-[var(--text-muted)] mt-0.5">
                        <T>Added by hand, so it is shown without a verified badge.</T>
                      </span>
                    ) : null}
                  </span>
                  <ToggleSwitch
                    checked={checked}
                    disabled={disabled}
                    onCheckedChange={(on) => setDraft(on ? [...draft, c.id] : draft.filter((id) => id !== c.id))}
                    aria-label={gt("Show {name} on this server", { name: connectionName(c) })}
                  />
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {full && (
        <p className="text-xs text-[var(--text-muted)]">
          {gt("A server can show up to {count} connections.", { count: LINKED_CONNECTIONS_MAX })}
        </p>
      )}
      {linkedIds.length !== draft.length && (
        <p className="text-xs text-[var(--text-muted)]">
          <T>Some linked accounts were disconnected from your profile and will be removed when you save.</T>
        </p>
      )}

      <div className="sticky bottom-0 flex justify-end gap-2 pt-2 pb-[env(safe-area-inset-bottom)] bg-[var(--bg-card)] max-md:bg-[var(--bg-app)]">
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => setDraft(loaded.saved)}
          className="h-10 px-4 rounded-md text-sm text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
        >
          <T>Reset</T>
        </button>
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => void save()}
          className="h-10 px-4 rounded-md bg-[var(--app-accent)] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40"
        >
          {saving ? gt("Saving...") : gt("Save Changes")}
        </button>
      </div>

      <MountWhenOpened open={previewOpen}>
        <JoinPreviewDialog
          serverId={serverId}
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          startAt="invite"
          overrides={{ connections: previewConnections }}
        />
      </MountWhenOpened>
    </div>
  );
}
