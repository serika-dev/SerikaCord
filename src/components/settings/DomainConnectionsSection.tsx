"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { BadgeCheck, Check, Clock, Copy, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useGT } from "gt-next";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { WebsiteFavicon } from "@/components/user/ConnectionIcon";

type DomainStatus = {
  name: string;
  verified: boolean;
  verifiedAt: string | null;
  challenge: { type: "TXT"; host: string; name: string; value: string } | null;
};

type Connection = {
  id: string;
  provider: string;
  accountId: string;
  visible?: boolean | null;
  domain?: DomainStatus;
  [key: string]: unknown;
};

export function CopyField({ label, value }: { label: string; value: string }) {
  const gt = useGT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1">{label}</p>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }, () => toast.error(gt("Couldn't copy")));
        }}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-[var(--bg-card)] border border-[var(--border-subtle)] text-left hover:border-[var(--app-accent)] transition-colors"
        title={gt("Copy")}
      >
        <code className="flex-1 min-w-0 truncate text-xs text-[var(--text-primary)]">{value}</code>
        {copied ? <Check className="w-3.5 h-3.5 shrink-0 text-green-500" /> : <Copy className="w-3.5 h-3.5 shrink-0 text-[var(--text-muted)]" />}
      </button>
    </div>
  );
}

/**
 * Website connections: any number of domains, each proven with a DNS TXT
 * record before it shows on the profile. Shared by the desktop settings
 * dialog and the mobile settings page.
 */
export function DomainConnectionsSection({
  connections,
  setConnections,
  canAdd,
}: {
  connections: Connection[];
  setConnections: Dispatch<SetStateAction<Connection[]>>;
  canAdd: boolean;
}) {
  const gt = useGT();
  const [input, setInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const domains = connections.filter((c) => c.provider === "website");

  const upsert = (conn: Connection) =>
    setConnections((prev) => [conn, ...prev.filter((c) => c.id !== conn.id)]);

  const addDomain = async (raw: string, replacingId?: string) => {
    if (!raw.trim() || adding) return;
    setAdding(true);
    try {
      const res = await fetch("/api/users/me/connections/domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: raw.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.connection) {
        toast.error(data.error || gt("Failed to add domain"));
        return;
      }
      // The server replaces an old unverified row for the same domain.
      setConnections((prev) => [
        data.connection,
        ...prev.filter((c) => c.id !== data.connection.id && c.id !== replacingId),
      ]);
      setInput("");
      setOpenId(data.connection.domain?.verified ? null : data.connection.id);
    } catch {
      toast.error(gt("Failed to add domain"));
    } finally {
      setAdding(false);
    }
  };

  const verify = async (conn: Connection) => {
    setVerifyingId(conn.id);
    try {
      const res = await fetch(`/api/users/me/connections/${conn.id}/verify`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.connection) {
        upsert(data.connection);
        setOpenId(null);
        toast.success(gt("{domain} verified", { domain: data.connection.domain?.name || conn.accountId }));
      } else if (data.code === "token_mismatch") {
        toast.error(gt("Found a serika-verification record with a different code. Replace it with the value shown here, then check again."));
      } else if (data.code === "record_not_found") {
        toast.error(gt("TXT record not found yet. DNS changes can take a few minutes to show up."));
      } else {
        toast.error(data.error || gt("Verification failed"));
      }
    } catch {
      toast.error(gt("Verification failed"));
    } finally {
      setVerifyingId(null);
    }
  };

  const remove = async (conn: Connection) => {
    const res = await fetch(`/api/users/me/connections/${conn.id}`, { method: "DELETE" });
    if (res.ok) {
      setConnections((prev) => prev.filter((c) => c.id !== conn.id));
      toast.success(gt("Domain removed"));
    } else {
      toast.error(gt("Failed to remove domain"));
    }
  };

  const setVisible = async (conn: Connection, visible: boolean) => {
    try {
      const res = await fetch(`/api/users/me/connections/${conn.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visible }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setConnections((prev) => prev.map((c) => (c.id === conn.id ? data.connection : c)));
      toast.success(gt("Visibility updated"));
    } catch {
      toast.error(gt("Failed to update visibility"));
    }
  };

  return (
    <section className="space-y-3">
      <div className="px-0.5">
      <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">{gt("Domains")}</h3>
      <p className="mt-0.5 text-[13px] leading-snug text-[var(--text-secondary)]">
        {gt("Link websites you own. Each domain shows on your profile once you prove ownership with a DNS TXT record.")}
      </p>
      </div>
      <div className="rounded-xl overflow-hidden border border-[var(--border-subtle)] bg-[var(--bg-app)] divide-y divide-[var(--border-subtle)]">
        {domains.map((conn) => {
          const status = conn.domain;
          const name = status?.name || conn.accountId;
          const verified = status?.verified === true;
          const legacy = !status?.challenge;
          const open = openId === conn.id && !verified && !legacy;
          return (
            <div key={conn.id} className="px-4 py-3 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-[var(--app-accent)]/10">
                  {/* The site's favicon once verified (the server only fetches verified domains). */}
                  <WebsiteFavicon domain={verified ? name : null} size={18} style={{ color: "var(--app-accent)" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{name}</p>
                  {verified ? (
                    <p className="text-xs text-green-500 flex items-center gap-1">
                      <BadgeCheck className="w-3.5 h-3.5" />
                      {gt("Verified")}
                    </p>
                  ) : (
                    <p className="text-xs text-yellow-500 flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      {legacy ? gt("Not verified, hidden from your profile") : gt("Waiting for DNS verification")}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {verified ? (
                    <ToggleSwitch
                      size="sm"
                      checked={conn.visible !== false}
                      onCheckedChange={(checked) => void setVisible(conn, checked)}
                      aria-label={gt("Show on profile")}
                    />
                  ) : legacy ? (
                    canAdd && (
                      <button
                        onClick={() => void addDomain(name, conn.id)}
                        disabled={adding}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-[var(--app-accent)] hover:opacity-90 disabled:opacity-40 transition-opacity"
                      >
                        {gt("Verify")}
                      </button>
                    )
                  ) : (
                    <button
                      onClick={() => setOpenId(open ? null : conn.id)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-[var(--app-accent)] hover:opacity-90 transition-opacity"
                    >
                      {open ? gt("Hide") : gt("Verify")}
                    </button>
                  )}
                  <button
                    onClick={() => void remove(conn)}
                    className="p-1.5 rounded-lg text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-colors"
                    title={gt("Remove")}
                    aria-label={gt("Remove")}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {open && status?.challenge && (
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)]/50 p-3 space-y-3">
                  <p className="text-xs text-[var(--text-secondary)]">
                    {gt("Add this TXT record at your DNS provider, then press Check.")}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-[auto_minmax(0,1fr)] gap-2">
                    <CopyField label={gt("Type")} value="TXT" />
                    <CopyField label={gt("Name / Host")} value={status.challenge.host} />
                  </div>
                  <CopyField label={gt("Value / Content")} value={status.challenge.value} />
                  <p className="text-[11px] text-[var(--text-muted)]">
                    {gt("Some providers want the full name ({record}). A TXT record with the same value on {domain} itself also works.", { record: status.challenge.name, domain: name })}
                  </p>
                  <button
                    onClick={() => void verify(conn)}
                    disabled={verifyingId === conn.id}
                    className="w-full sm:w-auto px-4 py-2 rounded-lg text-sm font-medium text-white bg-[var(--app-accent)] hover:opacity-90 disabled:opacity-60 transition-opacity flex items-center justify-center gap-2"
                  >
                    {verifyingId === conn.id && <Loader2 className="w-4 h-4 animate-spin" />}
                    {gt("Check")}
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {canAdd ? (
          <form
            className="px-4 py-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void addDomain(input);
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
              className="flex-1 min-w-0 px-3 py-1.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--app-accent)]"
            />
            <button
              type="submit"
              disabled={!input.trim() || adding}
              className="px-4 py-1.5 rounded-lg text-sm font-medium text-white bg-[var(--app-accent)] hover:opacity-90 disabled:opacity-40 transition-opacity flex items-center gap-2"
            >
              {adding && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {gt("Add domain")}
            </button>
          </form>
        ) : domains.length === 0 ? (
          <p className="px-4 py-3 text-xs text-[var(--text-muted)]">{gt("Domain connections are currently disabled.")}</p>
        ) : null}
      </div>
    </section>
  );
}
