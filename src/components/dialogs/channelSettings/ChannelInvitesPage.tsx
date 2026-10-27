"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Link2, Plus, X } from "lucide-react";
import { useGT, useLocale } from "gt-next";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader } from "@/components/ui/Loader";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useAuth } from "@/contexts/AuthContext";
import { SettingsPageHeader, SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsButton } from "@/components/settings/blocks/SettingsButton";
import { SettingsEmptyState } from "@/components/settings/blocks/SettingsEmptyState";
import { SettingsSkeleton } from "@/components/settings/blocks/SettingsSkeleton";
import { formatShortDate } from "@/components/dialogs/serverSettings/formatDate";
import { cn, cdnImage } from "@/lib/utils";

interface ChannelInvite {
  code: string;
  uses: number;
  maxUses: number | null;
  expiresAt: string | null;
  createdBy?: { id: string; username: string; displayName?: string | null; avatar?: string | null } | null;
  channel?: { id: string; name: string } | null;
}

const GRID = "md:grid md:grid-cols-[minmax(0,1.8fr)_minmax(0,1.3fr)_minmax(0,0.6fr)_minmax(0,1fr)_auto] md:items-center md:gap-4";
const inviteUrl = (code: string) => `https://serika.cc/${code}`;

/**
 * Channel Settings → Invites: Discord's table of invites that point at this
 * channel (inviter, code, uses, expiry; copy / revoke on hover) and a
 * "Create Invite" button that makes a 7-day invite to this channel.
 */
export function ChannelInvitesPage({
  serverId,
  channelId,
  canCreate,
}: {
  serverId: string;
  channelId: string;
  canCreate: boolean;
}) {
  const gt = useGT();
  const locale = useLocale();
  const confirm = useConfirm();
  const { user } = useAuth();
  const [invites, setInvites] = useState<ChannelInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/servers/${serverId}/invites`);
      const data = await res.json().catch(() => null);
      // The route answers { invites: [...] } with the channel nested.
      const list: ChannelInvite[] = res.ok && Array.isArray(data?.invites) ? data.invites : [];
      setInvites(list.filter((inv) => inv.channel?.id?.toLowerCase() === channelId.toLowerCase()));
      setFailed(!res.ok);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [serverId, channelId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setCreating(true);
    try {
      const res = await fetch(`/api/servers/${serverId}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId, maxUses: 0, maxAge: 604800 }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.invite?.code) throw new Error(data?.error || "");
      const invite: ChannelInvite = {
        ...data.invite,
        createdBy: user ? { id: user.id, username: user.username, displayName: user.displayName, avatar: user.avatar } : null,
        channel: { id: channelId, name: "" },
      };
      setInvites((list) => [invite, ...list]);
      try {
        await navigator.clipboard.writeText(inviteUrl(invite.code));
        toast.success(gt("Invite created and copied to your clipboard"));
      } catch {
        toast.success(gt("Invite created!"));
      }
    } catch (err) {
      toast.error((err instanceof Error && err.message) || gt("Failed to create invite"));
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (code: string) => {
    if (!(await confirm({ title: gt("Revoke this invite?"), confirmLabel: gt("Revoke") }))) return;
    const previous = invites;
    setInvites((list) => list.filter((i) => i.code !== code));
    try {
      const res = await fetch(`/api/servers/${serverId}/invites/${encodeURIComponent(code)}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success(gt("Invite revoked successfully"));
    } catch {
      setInvites(previous);
      toast.error(gt("Failed to revoke invite"));
    }
  };

  const copy = (code: string) => {
    void navigator.clipboard.writeText(inviteUrl(code)).then(
      () => toast.success(gt("Copied to clipboard!")),
      () => toast.error(gt("Couldn't copy the link")),
    );
  };

  const createButton = canCreate ? (
    <SettingsButton variant="primary" onClick={() => void create()} disabled={creating}>
      {creating ? <Loader size={14} /> : <Plus />}
      {gt("Create Invite")}
    </SettingsButton>
  ) : null;

  return (
    <div className="space-y-8">
      <SettingsPageHeader
        title={gt("Invites")}
        description={gt("Invite links that bring people straight to this channel. Revoking one stops it working right away.")}
        actions={createButton}
        className="mb-0"
      />

      <SettingsSection title={gt("Active invite links")}>
        {loading ? (
          <SettingsSkeleton variant="list" count={3} />
        ) : failed ? (
          <SettingsEmptyState icon={Link2} title={gt("Couldn't load invites")} description={gt("Try again in a moment.")} />
        ) : invites.length === 0 ? (
          <SettingsEmptyState
            icon={Link2}
            title={gt("No invites for this channel yet")}
            description={gt("Create an invite link to share with others")}
            action={createButton}
          />
        ) : (
          <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)]">
            <div className={cn("hidden border-b border-[var(--border-subtle)] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.04em] text-[var(--text-muted)]", GRID)}>
              <span>{gt("Inviter")}</span>
              <span>{gt("Invite Code")}</span>
              <span>{gt("Uses")}</span>
              <span>{gt("Expires")}</span>
              <span className="w-16" aria-hidden />
            </div>
            <div className="divide-y divide-[var(--border-subtle)]">
              {invites.map((invite) => {
                const expires = formatShortDate(invite.expiresAt, locale);
                const inviter = invite.createdBy?.displayName || invite.createdBy?.username || "?";
                const uses = invite.maxUses ? `${invite.uses}/${invite.maxUses}` : String(invite.uses ?? 0);
                return (
                  <div
                    key={invite.code}
                    data-settings-row
                    className={cn(
                      "group/invite flex items-center gap-3 px-4 py-3 transition-colors duration-(--motion-fast) [@media(hover:hover)]:hover:bg-[var(--bg-hover)]/60",
                      GRID,
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar className="h-8 w-8 shrink-0">
                        <AvatarImage src={cdnImage(invite.createdBy?.avatar || undefined)} />
                        <AvatarFallback className="bg-[var(--app-accent)] text-xs text-[var(--text-on-accent)]">{inviter.charAt(0).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <span className="truncate text-sm font-medium text-[var(--text-primary)]">{inviter}</span>
                    </div>
                    <code className="hidden truncate font-mono text-[13px] text-[var(--text-primary)] md:block">{invite.code}</code>
                    <span className="hidden text-[13px] tabular-nums text-[var(--text-secondary)] md:block">{uses}</span>
                    <span className="hidden truncate text-[13px] text-[var(--text-secondary)] md:block">{expires ?? gt("Never")}</span>
                    {/* Phone: code and stats on the right */}
                    <div className="min-w-0 flex-1 text-right md:hidden">
                      <code className="block truncate font-mono text-[13px] text-[var(--text-primary)]">{invite.code}</code>
                      <p className="text-xs text-[var(--text-muted)]">
                        {uses} {gt("uses")}
                        {expires ? ` · ${gt("Expires")} ${expires}` : ""}
                      </p>
                    </div>
                    <div className="flex w-16 shrink-0 items-center justify-end gap-0.5 transition-opacity duration-(--motion-fast) [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/invite:opacity-100 [@media(hover:hover)]:group-focus-within/invite:opacity-100">
                      <button
                        type="button"
                        onClick={() => copy(invite.code)}
                        aria-label={gt("Copy invite link")}
                        title={gt("Copy invite link")}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void revoke(invite.code)}
                        aria-label={gt("Revoke invite")}
                        title={gt("Revoke invite")}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-red-500/10 hover:text-red-500"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </SettingsSection>
    </div>
  );
}

export default ChannelInvitesPage;
