"use client";

import { memo, useState } from "react";
import { Check, Copy, Crown, Link2, Plus, X } from "lucide-react";
import { useGT, useLocale } from "gt-next";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader } from "@/components/ui/Loader";
import { SettingsCard, SettingsPageHeader, SettingsSection, SettingsToggleRow } from "@/components/settings/SettingsSection";
import { SettingsButton } from "@/components/settings/blocks/SettingsButton";
import { SettingsEmptyState } from "@/components/settings/blocks/SettingsEmptyState";
import { SettingsSkeleton } from "@/components/settings/blocks/SettingsSkeleton";
import { cn, cdnImage } from "@/lib/utils";
import { formatShortDate } from "./formatDate";
import type { Invite, VanityInfo } from "./types";

function copy(text: string, done: string) {
  void navigator.clipboard.writeText(text);
  toast.success(done);
}

/** Partnered servers: claim / change / remove serika.cc/<code> and lock joins to it. */
function VanityInviteCard({
  serverId,
  info,
  onInfoChange,
}: {
  serverId: string;
  info: VanityInfo;
  onInfoChange: (next: VanityInfo) => void;
}) {
  const gt = useGT();
  const [draft, setDraft] = useState(info.code ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [togglingLock, setTogglingLock] = useState(false);
  const dirty = draft.trim().toLowerCase() !== (info.code ?? "");

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const trimmed = draft.trim().toLowerCase();
      const res = await fetch(`/api/servers/${serverId}/vanity-url`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || gt("Failed to update custom invite"));
        return;
      }
      onInfoChange({
        code: data.code ?? null,
        uses: data.uses ?? 0,
        isPartnered: info.isPartnered ?? true,
        lockToVanity: data.lockToVanity ?? info.lockToVanity ?? false,
      });
      setDraft(data.code ?? "");
      toast.success(data.code ? gt("Custom invite link updated!") : gt("Custom invite link removed"));
    } catch {
      setError(gt("Something went wrong. Please try again."));
    } finally {
      setSaving(false);
    }
  };

  const toggleLock = async () => {
    const next = !info.lockToVanity;
    setTogglingLock(true);
    try {
      const res = await fetch(`/api/servers/${serverId}/vanity-url/lock`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locked: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || gt("Failed to update invite lock"));
        return;
      }
      onInfoChange({ ...info, lockToVanity: next });
      toast.success(next ? gt("Server invites locked to custom link") : gt("Server invites unlocked"));
    } catch {
      toast.error(gt("Something went wrong. Please try again."));
    } finally {
      setTogglingLock(false);
    }
  };

  return (
    <SettingsSection
      title={
        <span className="flex items-center gap-2">
          <Crown className="h-4 w-4 text-yellow-500" />
          {gt("Custom Invite Link")}
        </span>
      }
      description={gt("As a partnered server, you can claim a personalized invite link.")}
      action={info.code ? <span className="text-xs text-[var(--text-secondary)]">{info.uses} {gt("uses")}</span> : undefined}
    >
      <SettingsCard>
        <div className="space-y-2 px-4 py-3.5">
          <div className="flex gap-2">
            <div className="flex min-w-0 flex-1 items-center overflow-hidden rounded-md border border-[var(--border-subtle)] bg-[var(--bg-input)] transition-colors focus-within:border-[var(--app-accent)]">
              <span className="select-none pl-3 font-mono text-sm text-[var(--text-muted)]">serika.cc/</span>
              <input
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
                  setError(null);
                }}
                placeholder="your-server"
                maxLength={32}
                aria-label={gt("Custom invite link code")}
                className="h-9 min-w-0 flex-1 bg-transparent pr-3 font-mono text-sm text-[var(--text-primary)] outline-none"
              />
            </div>
            <SettingsButton variant="primary" onClick={() => void save()} disabled={saving || !dirty} className="h-9">
              {saving ? <Loader size={16} /> : <Check />}
              {gt("Save")}
            </SettingsButton>
            {info.code && (
              <SettingsButton
                variant="ghost"
                className="h-9 w-9 px-0"
                onClick={() => copy(`https://serika.cc/${info.code}`, gt("Copied to clipboard!"))}
                aria-label={gt("Copy custom invite link")}
              >
                <Copy />
              </SettingsButton>
            )}
          </div>
          {error ? (
            <p className="text-xs text-red-500">{error}</p>
          ) : (
            <p className="text-xs text-[var(--text-muted)]">
              {gt("3-32 characters. Lowercase letters, numbers, and hyphens only. Leave empty and save to remove.")}
            </p>
          )}
        </div>
        {info.code && (
          <SettingsToggleRow
            label={gt("Lock to Custom Invite")}
            description={gt("Only allow joins through this custom invite link. Hides all other invite links.")}
            checked={info.lockToVanity}
            onCheckedChange={() => void toggleLock()}
            disabled={togglingLock}
          />
        )}
      </SettingsCard>
    </SettingsSection>
  );
}

const GRID = "md:grid md:grid-cols-[minmax(0,1.6fr)_minmax(0,1.4fr)_minmax(0,0.6fr)_minmax(0,1fr)_auto] md:items-center md:gap-4";

/** Server Settings → Invites: Discord's invite table (inviter, code, uses, expiry; revoke on hover). */
export const InvitesPage = memo(function InvitesPage({
  serverId,
  invites,
  vanity,
  loading,
  onCreate,
  onRevoke,
  onVanityChange,
}: {
  serverId: string;
  invites: Invite[];
  vanity: VanityInfo | null;
  loading: boolean;
  onCreate: () => void;
  onRevoke: (code: string) => void;
  onVanityChange: (next: VanityInfo) => void;
}) {
  const gt = useGT();
  const locale = useLocale();
  return (
    <div className="space-y-8">
      <SettingsPageHeader
        title={gt("Server Invites")}
        description={gt("Create and manage invite links")}
        actions={
          <SettingsButton variant="primary" onClick={onCreate}>
            <Plus />
            {gt("Create Invite")}
          </SettingsButton>
        }
        className="mb-0"
      />

      {vanity?.isPartnered && (
        <VanityInviteCard key={vanity.code ?? ""} serverId={serverId} info={vanity} onInfoChange={onVanityChange} />
      )}

      <SettingsSection title={gt("Active invite links")}>
        {loading && invites.length === 0 ? (
          <SettingsSkeleton variant="list" count={4} />
        ) : invites.length === 0 ? (
          <SettingsEmptyState
            icon={Link2}
            title={gt("No invites yet")}
            description={gt("Create an invite link to share with others")}
            action={
              <SettingsButton variant="primary" onClick={onCreate}>
                <Plus />
                {gt("Create Invite")}
              </SettingsButton>
            }
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)]">
            <div
              className={cn(
                "hidden border-b border-[var(--border-subtle)] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.04em] text-[var(--text-muted)]",
                GRID,
              )}
            >
              <span>{gt("Inviter")}</span>
              <span>{gt("Invite Code")}</span>
              <span>{gt("Uses")}</span>
              <span>{gt("Expires")}</span>
              <span className="w-16" aria-hidden />
            </div>
            <div className="divide-y divide-[var(--border-subtle)]">
              {invites.map((invite) => {
                const expires = formatShortDate(invite.expiresAt, locale);
                const inviter = invite.createdBy?.username || "?";
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
                        <AvatarImage src={cdnImage(invite.createdBy?.avatar)} />
                        <AvatarFallback className="bg-[var(--app-accent)] text-xs text-white">{inviter.charAt(0)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-[var(--text-primary)]">{inviter}</p>
                        <p className="truncate text-xs text-[var(--text-muted)]">#{invite.channel?.name || gt("deleted-channel")}</p>
                      </div>
                    </div>
                    <div className="hidden min-w-0 md:block">
                      <code className="truncate font-mono text-[13px] text-[var(--text-primary)]">{invite.code}</code>
                    </div>
                    <div className="hidden text-[13px] tabular-nums text-[var(--text-secondary)] md:block">
                      {invite.maxUses ? `${invite.uses}/${invite.maxUses}` : invite.uses}
                    </div>
                    <div className="hidden truncate text-[13px] text-[var(--text-secondary)] md:block">{expires ?? gt("Never")}</div>
                    {/* Phone: code and stats under the name */}
                    <div className="min-w-0 flex-1 text-right md:hidden">
                      <code className="block truncate font-mono text-[13px] text-[var(--text-primary)]">{invite.code}</code>
                      <p className="text-xs text-[var(--text-muted)]">
                        {invite.uses} {gt("uses")}
                        {expires ? ` · ${gt("Expires")} ${expires}` : ""}
                      </p>
                    </div>
                    <div className="flex w-16 shrink-0 items-center justify-end gap-0.5 transition-opacity duration-(--motion-fast) [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/invite:opacity-100 [@media(hover:hover)]:group-focus-within/invite:opacity-100">
                      <button
                        type="button"
                        onClick={() => copy(`https://serika.cc/${invite.code}`, gt("Copied to clipboard!"))}
                        aria-label={gt("Copy invite link")}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onRevoke(invite.code)}
                        aria-label={gt("Delete invite")}
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
});
