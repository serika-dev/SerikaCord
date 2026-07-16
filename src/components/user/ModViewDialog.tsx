"use client";

import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  ShieldAlert,
  Clock,
  UserMinus,
  Ban,
  Copy,
  CalendarDays,
  Check,
  Crown,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { cdnImage } from "@/lib/utils";
import { useTimeoutRemaining } from "@/hooks/useTimeoutRemaining";
import { hasPermissionBit } from "@/lib/roles/bitfield";
import type { ProfileCardUser } from "@/components/user/ProfileCard";
import { useGT } from "gt-next";

interface ModViewDialogProps {
  user: ProfileCardUser;
  serverId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface MemberData {
  roles?: Array<{ id: string; name: string; color?: string }>;
  joinedAt?: string | null;
  communicationDisabledUntil?: string | null;
  isOwner?: boolean;
}

interface AccountData {
  createdAt?: string | null;
  isVerified?: boolean;
}

// Permission bits (mirror of @/lib/permissions/bits).
const KICK_MEMBERS = 1n << 1n;
const BAN_MEMBERS = 1n << 2n;
const MODERATE_MEMBERS = 1n << 40n;
const ADMINISTRATOR = 1n << 3n;

const TIMEOUT_PRESETS: Array<{ label: string; ms: number }> = [
  { label: "60 secs", ms: 60_000 },
  { label: "5 mins", ms: 5 * 60_000 },
  { label: "1 hour", ms: 60 * 60_000 },
  { label: "1 day", ms: 24 * 60 * 60_000 },
  { label: "1 week", ms: 7 * 24 * 60 * 60_000 },
];

function formatDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * Actionable moderation panel for a server member. Opened from the member
 * profile card by owners/moderators. Reuses existing timeout/kick/ban endpoints.
 */
export function ModViewDialog({ user, serverId, open, onOpenChange }: ModViewDialogProps) {
  const gt = useGT();
  const [loading, setLoading] = useState(true);
  const [member, setMember] = useState<MemberData>({});
  const [account, setAccount] = useState<AccountData>({});
  const [perms, setPerms] = useState<{ isOwner: boolean; permissions: string }>({ isOwner: false, permissions: "0" });
  const [busy, setBusy] = useState<null | "timeout" | "kick" | "ban" | "clear">(null);
  const [copied, setCopied] = useState<string | null>(null);

  const targetIsOwner = member.isOwner || user.isOwner;
  const can = useCallback(
    (bit: bigint) => perms.isOwner || hasPermissionBit(perms.permissions, ADMINISTRATOR) || hasPermissionBit(perms.permissions, bit),
    [perms]
  );

  const load = useCallback(async () => {
    if (!user.id) return;
    setLoading(true);
    try {
      const [permRes, memberRes, userRes] = await Promise.all([
        fetch(`/api/servers/${serverId}/members/@me/permissions`),
        fetch(`/api/servers/${serverId}/members/${user.id}`),
        fetch(`/api/users/${user.id}`),
      ]);
      if (permRes.ok) {
        const p = await permRes.json();
        setPerms({ isOwner: Boolean(p.isOwner), permissions: String(p.permissions ?? "0") });
      }
      if (memberRes.ok) setMember(await memberRes.json());
      if (userRes.ok) setAccount(await userRes.json());
    } catch {
      toast.error(gt("Failed to load member data"));
    } finally {
      setLoading(false);
    }
  }, [serverId, user.id, gt]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const timeout = useTimeoutRemaining(member.communicationDisabledUntil);

  const applyTimeout = async (durationMs: number) => {
    setBusy(durationMs > 0 ? "timeout" : "clear");
    try {
      const res = await fetch(`/api/servers/${serverId}/members/${user.id}/timeout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ durationMs }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Request failed");
      setMember((m) => ({ ...m, communicationDisabledUntil: data.communicationDisabledUntil ?? null }));
      toast.success(durationMs > 0 ? gt("Member timed out") : gt("Timeout removed"));
    } catch (e) {
      toast.error((e as Error).message || gt("Action failed"));
    } finally {
      setBusy(null);
    }
  };

  const kick = async () => {
    if (!confirm(gt("Kick {name} from this server?", { name: user.displayName || user.username }))) return;
    setBusy("kick");
    try {
      const res = await fetch(`/api/servers/${serverId}/members/${user.id}/kick`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Request failed");
      toast.success(gt("Member kicked"));
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message || gt("Action failed"));
    } finally {
      setBusy(null);
    }
  };

  const ban = async () => {
    const reason = prompt(gt("Ban reason (optional):")) ?? undefined;
    if (reason === undefined) return; // cancelled
    setBusy("ban");
    try {
      const res = await fetch(`/api/servers/${serverId}/bans/${user.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Request failed");
      toast.success(gt("Member banned"));
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message || gt("Action failed"));
    } finally {
      setBusy(null);
    }
  };

  const copy = (label: string, value: string) => {
    navigator.clipboard?.writeText(value);
    setCopied(label);
    toast.success(gt("Copied"));
    setTimeout(() => setCopied((c) => (c === label ? null : c)), 1500);
  };

  const roles = member.roles || user.roles || [];
  const displayName = user.displayName || user.username;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 overflow-hidden bg-[var(--app-bg)] border border-[var(--app-border)]">
        <DialogTitle className="sr-only">{gt("Mod View")}</DialogTitle>

        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-[var(--app-border)]">
          <ShieldAlert className="w-5 h-5 text-[#EF4444] shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{gt("Mod View")}</p>
            <div className="flex items-center gap-2 min-w-0">
              <Avatar className="w-6 h-6">
                <AvatarImage src={cdnImage(user.avatar || undefined)} alt={displayName} />
                <AvatarFallback className="bg-[#8B5CF6] text-white text-[10px]">{displayName.charAt(0).toUpperCase()}</AvatarFallback>
              </Avatar>
              <span className="font-semibold text-[var(--text-primary)] truncate">{displayName}</span>
              {targetIsOwner && <Crown className="w-3.5 h-3.5 text-[#F59E0B] shrink-0" />}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-[#8B5CF6]" />
          </div>
        ) : (
          <div className="px-5 py-4 space-y-5 max-h-[70vh] overflow-y-auto">
            {/* Timeout status banner */}
            {timeout.active && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/30 text-[#EF4444] text-sm">
                <Clock className="w-4 h-4 shrink-0" />
                <span>{gt("Timed out — {time} remaining", { time: timeout.label })}</span>
              </div>
            )}

            {/* Roles */}
            <section>
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">{gt("Roles")}</h4>
              {roles.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">{gt("No roles")}</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {roles.map((r) => (
                    <span key={r.id} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs bg-white/[0.04] border border-white/[0.06] text-[var(--text-secondary)]">
                      <span className="w-2 h-2 rounded-full" style={{ background: r.color || "#99AAB5" }} />
                      {r.name}
                    </span>
                  ))}
                </div>
              )}
            </section>

            {/* Account */}
            <section>
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">{gt("Account")}</h4>
              <div className="space-y-1.5 text-sm">
                <div className="flex items-center gap-2 text-[var(--text-secondary)]">
                  <CalendarDays className="w-4 h-4 text-[var(--text-muted)]" />
                  <span>{gt("Joined server")}</span>
                  <span className="ml-auto text-[var(--text-primary)]">{formatDate(member.joinedAt)}</span>
                </div>
                <div className="flex items-center gap-2 text-[var(--text-secondary)]">
                  <CalendarDays className="w-4 h-4 text-[var(--text-muted)]" />
                  <span>{gt("Account created")}</span>
                  <span className="ml-auto text-[var(--text-primary)]">{formatDate(account.createdAt)}</span>
                </div>
                <div className="flex items-center gap-2 text-[var(--text-secondary)]">
                  <Check className="w-4 h-4 text-[var(--text-muted)]" />
                  <span>{gt("Verified")}</span>
                  <span className="ml-auto text-[var(--text-primary)]">{account.isVerified ? gt("Yes") : gt("No")}</span>
                </div>
              </div>
            </section>

            {/* Moderation actions */}
            {!targetIsOwner && (can(KICK_MEMBERS) || can(BAN_MEMBERS) || can(MODERATE_MEMBERS)) && (
              <section>
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">{gt("Moderation")}</h4>

                {can(MODERATE_MEMBERS) && (
                  <div className="mb-3">
                    <p className="text-xs text-[var(--text-muted)] mb-1.5">{gt("Timeout")}</p>
                    {timeout.active ? (
                      <button
                        onClick={() => void applyTimeout(0)}
                        disabled={busy !== null}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-sm text-[var(--text-primary)] disabled:opacity-50 transition-colors"
                      >
                        {busy === "clear" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />}
                        {gt("Remove timeout")}
                      </button>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {TIMEOUT_PRESETS.map((p) => (
                          <button
                            key={p.ms}
                            onClick={() => void applyTimeout(p.ms)}
                            disabled={busy !== null}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/[0.06] hover:bg-[#EF4444]/20 hover:text-[#EF4444] text-xs text-[var(--text-secondary)] disabled:opacity-50 transition-colors"
                          >
                            {busy === "timeout" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Clock className="w-3 h-3" />}
                            {p.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex gap-2">
                  {can(KICK_MEMBERS) && (
                    <button
                      onClick={() => void kick()}
                      disabled={busy !== null}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#F0B232]/15 hover:bg-[#F0B232]/25 text-[#F0B232] text-sm font-medium disabled:opacity-50 transition-colors"
                    >
                      {busy === "kick" ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserMinus className="w-4 h-4" />}
                      {gt("Kick")}
                    </button>
                  )}
                  {can(BAN_MEMBERS) && (
                    <button
                      onClick={() => void ban()}
                      disabled={busy !== null}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#EF4444]/15 hover:bg-[#EF4444]/25 text-[#EF4444] text-sm font-medium disabled:opacity-50 transition-colors"
                    >
                      {busy === "ban" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
                      {gt("Ban")}
                    </button>
                  )}
                </div>
              </section>
            )}

            {/* IDs */}
            <section className="flex flex-col gap-1.5">
              <button
                onClick={() => copy("user", user.id)}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/[0.04] text-xs text-[var(--text-muted)] transition-colors"
              >
                {copied === "user" ? <Check className="w-3.5 h-3.5 text-[#23A559]" /> : <Copy className="w-3.5 h-3.5" />}
                {gt("Copy User ID")}
              </button>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
