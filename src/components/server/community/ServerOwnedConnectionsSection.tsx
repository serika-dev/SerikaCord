"use client";

import { useState } from "react";
import { useGT } from "gt-next";
import { BadgeCheck, Clock, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { ConnectionIcon } from "@/components/user/ConnectionIcon";
import { CopyField } from "@/components/settings/DomainConnectionsSection";

/** GET /api/servers/:id/connections → serverOwned[] (ServerOwnedOwnView in src/lib/connections/serverOwned.ts). */
export interface ServerOwnedConnection {
  id: string;
  provider: string;
  accountId: string;
  username: string | null;
  displayName: string | null;
  avatar: string | null;
  verified: boolean;
  visible: boolean;
  domain?: {
    name: string;
    verified: boolean;
    verifiedAt: string | null;
    challenge: { type: "TXT"; host: string; name: string; value: string } | null;
  };
}

/** Brand names are not translated. */
const PROVIDER_LABELS: Record<string, string> = {
  discord: "Discord",
  github: "GitHub",
  twitch: "Twitch",
  spotify: "Spotify",
  steam: "Steam",
  lastfm: "Last.fm",
};

function ownedName(c: ServerOwnedConnection): string {
  if (c.provider === "website") return c.domain?.name || c.accountId;
  return c.displayName || c.username || c.accountId;
}

/**
 * Server Settings → Server Connections → "This server's own accounts":
 * domains (DNS TXT verified) and accounts linked through an OAuth sign-in made
 * for the server. They belong to the server, not to the owner's profile.
 */
export function ServerOwnedConnectionsSection({
  serverId,
  rows,
  onRowsChange,
  linkableProviders,
  domainsAllowed,
  max,
  onChanged,
}: {
  serverId: string;
  rows: ServerOwnedConnection[];
  onRowsChange: (rows: ServerOwnedConnection[]) => void;
  linkableProviders: string[];
  domainsAllowed: boolean;
  max: number;
  /** Called after a change members can see (to refresh the invite / guide caches). */
  onChanged: () => void;
}) {
  const gt = useGT();
  const [input, setInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const full = rows.length >= max;
  const base = `/api/servers/${serverId}/owned-connections`;

  const upsert = (row: ServerOwnedConnection) => {
    const exists = rows.some((r) => r.id === row.id);
    onRowsChange(exists ? rows.map((r) => (r.id === row.id ? row : r)) : [...rows, row]);
  };

  const addDomain = async () => {
    if (!input.trim() || adding) return;
    setAdding(true);
    try {
      const res = await fetch(`${base}/domains`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: input.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.connection) {
        toast.error(typeof data.error === "string" ? data.error : gt("Failed to add domain"));
        return;
      }
      upsert(data.connection);
      setInput("");
      setOpenId(data.connection.verified ? null : data.connection.id);
    } catch {
      toast.error(gt("Failed to add domain"));
    } finally {
      setAdding(false);
    }
  };

  const link = async (provider: string) => {
    setLinking(provider);
    try {
      const res = await fetch(`${base}/link`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.url !== "string" || !data.url.startsWith("/api/auth/")) {
        toast.error(typeof data.error === "string" ? data.error : gt("Could not start linking"));
        setLinking(null);
        return;
      }
      // Leaves the app for the provider's sign-in; it comes back to these settings.
      window.location.assign(data.url);
    } catch {
      toast.error(gt("Could not start linking"));
      setLinking(null);
    }
  };

  const verify = async (row: ServerOwnedConnection) => {
    setVerifyingId(row.id);
    try {
      const res = await fetch(`${base}/${row.id}/verify`, { method: "POST", credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.connection) {
        upsert(data.connection);
        setOpenId(null);
        onChanged();
        toast.success(gt("{domain} verified", { domain: ownedName(data.connection) }));
      } else if (data.code === "token_mismatch") {
        toast.error(gt("Found a serika-verification record with a different code. Replace it with the value shown here, then check again."));
      } else if (data.code === "record_not_found") {
        toast.error(gt("TXT record not found yet. DNS changes can take a few minutes to show up."));
      } else {
        toast.error(typeof data.error === "string" ? data.error : gt("Verification failed"));
      }
    } catch {
      toast.error(gt("Verification failed"));
    } finally {
      setVerifyingId(null);
    }
  };

  const setVisible = async (row: ServerOwnedConnection, visible: boolean) => {
    try {
      const res = await fetch(`${base}/${row.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visible }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.connection) throw new Error("update failed");
      upsert(data.connection);
      onChanged();
      toast.success(gt("Visibility updated"));
    } catch {
      toast.error(gt("Failed to update visibility"));
    }
  };

  const remove = async (row: ServerOwnedConnection) => {
    try {
      const res = await fetch(`${base}/${row.id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("delete failed");
      onRowsChange(rows.filter((r) => r.id !== row.id));
      onChanged();
      toast.success(gt("Connection removed"));
    } catch {
      toast.error(gt("Could not remove the connection"));
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase text-[var(--text-secondary)]">{gt("This server's own accounts")}</span>
        <span className="text-xs text-[var(--text-muted)]">{rows.length}/{max}</span>
      </div>
      <p className="text-xs text-[var(--text-muted)]">
        {gt("Domains and accounts that belong to the server itself, not to your profile. They stay with the server if you transfer ownership.")}
      </p>

      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] divide-y divide-[var(--border-subtle)] overflow-hidden">
        {rows.length === 0 && (
          <p className="px-3 py-4 text-sm text-[var(--text-muted)] text-center">
            {gt("No accounts of its own yet. Add a domain or link an account below.")}
          </p>
        )}
        {rows.map((row) => {
          const name = ownedName(row);
          const isDomain = row.provider === "website";
          const challenge = isDomain && !row.verified ? row.domain?.challenge ?? null : null;
          const open = openId === row.id && challenge !== null;
          return (
            <div key={row.id} className="px-3 py-2.5 space-y-3">
              <div className="flex items-center gap-3 min-h-10">
                <span className="w-9 h-9 shrink-0 rounded-md bg-[var(--bg-app)] flex items-center justify-center">
                  <ConnectionIcon provider={row.provider} accountId={row.verified ? row.accountId : null} size={18} />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-[var(--text-primary)] truncate">{name}</span>
                  {row.verified ? (
                    <span className="flex items-center gap-1 text-xs text-[var(--app-accent)]">
                      <BadgeCheck className="w-3.5 h-3.5 shrink-0" />
                      {gt("Verified")}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
                      <Clock className="w-3.5 h-3.5 shrink-0" />
                      {gt("Waiting for DNS verification")}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  {row.verified ? (
                    <ToggleSwitch
                      size="sm"
                      checked={row.visible}
                      onCheckedChange={(on) => void setVisible(row, on)}
                      aria-label={gt("Show {name} on this server", { name })}
                    />
                  ) : challenge ? (
                    <button
                      type="button"
                      onClick={() => setOpenId(open ? null : row.id)}
                      className="h-8 px-3 rounded-md text-xs font-medium text-white bg-[var(--app-accent)] hover:opacity-90"
                    >
                      {open ? gt("Hide") : gt("Verify")}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void remove(row)}
                    className="h-8 w-8 flex items-center justify-center rounded-md text-red-400 bg-red-500/10 hover:bg-red-500/20"
                    title={gt("Remove")}
                    aria-label={gt("Remove")}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </span>
              </div>

              {open && challenge && (
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] p-3 space-y-3">
                  <p className="text-xs text-[var(--text-secondary)]">
                    {gt("Add this TXT record at your DNS provider, then press Check.")}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-[auto_minmax(0,1fr)] gap-2">
                    <CopyField label={gt("Type")} value="TXT" />
                    <CopyField label={gt("Name / Host")} value={challenge.host} />
                  </div>
                  <CopyField label={gt("Value / Content")} value={challenge.value} />
                  <p className="text-[11px] text-[var(--text-muted)]">
                    {gt("Some providers want the full name ({record}). A TXT record with the same value on {domain} itself also works.", { record: challenge.name, domain: name })}
                  </p>
                  <button
                    type="button"
                    onClick={() => void verify(row)}
                    disabled={verifyingId === row.id}
                    className="w-full sm:w-auto h-9 px-4 rounded-md text-sm font-medium text-white bg-[var(--app-accent)] hover:opacity-90 disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                    {verifyingId === row.id && <Loader2 className="w-4 h-4 animate-spin" />}
                    {gt("Check")}
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {domainsAllowed && !full && (
          <form
            className="px-3 py-2.5 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void addDomain();
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={gt("example.com")}
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-label={gt("Add domain")}
              className="flex-1 min-w-0 h-9 px-3 rounded-md bg-[var(--bg-app)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--app-accent)]"
            />
            <button
              type="submit"
              disabled={!input.trim() || adding}
              className="h-9 px-3 shrink-0 rounded-md text-sm font-medium text-white bg-[var(--app-accent)] hover:opacity-90 disabled:opacity-40 flex items-center gap-2"
            >
              {adding && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {gt("Add domain")}
            </button>
          </form>
        )}
      </div>

      {!domainsAllowed && (
        <p className="text-xs text-[var(--text-muted)]">{gt("Domain connections are currently disabled.")}</p>
      )}
      {full && (
        <p className="text-xs text-[var(--text-muted)]">{gt("A server can own up to {count} connections.", { count: max })}</p>
      )}

      <div className="space-y-2">
        <p className="text-sm font-medium text-[var(--text-primary)]">{gt("Link an account")}</p>
        <p className="text-xs text-[var(--text-muted)]">
          {gt("Sign in with the account you want to show. Only its name and picture are saved, never its password or access tokens.")}
        </p>
        {linkableProviders.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">{gt("Account linking is turned off right now.")}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {linkableProviders.map((p) => (
              <button
                key={p}
                type="button"
                disabled={full || linking !== null}
                onClick={() => void link(p)}
                className="h-9 px-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] text-sm text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50 flex items-center gap-2"
              >
                {linking === p ? <Loader2 className="w-4 h-4 animate-spin" /> : <ConnectionIcon provider={p} size={16} />}
                {PROVIDER_LABELS[p] ?? p}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
