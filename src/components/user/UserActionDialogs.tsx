"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MountWhenOpened } from "@/components/ui/MountWhenOpened";
import { useAuth } from "@/contexts/AuthContext";
import { useServer } from "@/contexts/ServerContext";
import { saveUserNote, useUserNote } from "@/lib/social/notesStore";
import { USER_NOTE_MAX } from "@/lib/social/userNotes";
import { useRelationships } from "@/lib/social/relationshipsStore";
import type { UserActionRequest } from "@/lib/social/userActions";
import type { ProfileCardUser } from "@/components/user/ProfileCard";
import { cn } from "@/lib/utils";

const ModViewDialog = dynamic(() => import("@/components/user/ModViewDialog").then((m) => m.ModViewDialog), { ssr: false });
const FullProfileDialog = dynamic(() => import("@/components/user/FullProfileDialog").then((m) => m.FullProfileDialog), { ssr: false });

const DIALOG_CLASS = "bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-primary)] sm:max-w-[440px]";
const FIELD_LABEL = "block text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)] mb-2";

/** The dialog behind one user-menu action (lazy-loaded by UserActionsHost). */
export function UserActionDialogs({ request, onClose }: { request: UserActionRequest; onClose: () => void }) {
  const { kind, target } = request;
  if (kind === "profile") return <ProfileAction request={request} onClose={onClose} />;
  if (kind === "note") return <NoteDialog userId={target.id} name={target.displayName || target.username} onClose={onClose} />;
  if (kind === "nickname" && target.serverId) return <NicknameDialog request={request} onClose={onClose} />;
  if ((kind === "kick" || kind === "ban") && target.serverId) return <RemoveMemberDialog request={request} onClose={onClose} />;
  if (kind === "timeout" && target.serverId) return <TimeoutDialog request={request} onClose={onClose} />;
  if (kind === "modview" && target.serverId) {
    return (
      <ModViewDialog
        user={{ id: target.id, username: target.username, displayName: target.displayName ?? undefined, avatar: target.avatar ?? null }}
        serverId={target.serverId}
        open
        onOpenChange={(open) => { if (!open) onClose(); }}
      />
    );
  }
  return null;
}

function ProfileAction({ request, onClose }: { request: UserActionRequest; onClose: () => void }) {
  const { user: me } = useAuth();
  const { friends } = useRelationships();
  const { target } = request;
  const [profile, setProfile] = useState<ProfileCardUser>({
    id: target.id,
    username: target.username,
    displayName: target.displayName ?? undefined,
    avatar: target.avatar ?? null,
    isBot: target.isBot,
  });
  useEffect(() => {
    let active = true;
    const serverId = target.serverId;
    void (async () => {
      try {
        const [userRes, memberRes] = await Promise.all([
          fetch(`/api/users/${target.id}`),
          serverId ? fetch(`/api/servers/${serverId}/members/${target.id}`) : Promise.resolve(null),
        ]);
        const merged: Partial<ProfileCardUser> = {};
        if (userRes.ok) Object.assign(merged, await userRes.json());
        if (memberRes?.ok) {
          const m = await memberRes.json();
          merged.roles = (m.roles || []).map((r: { id: string; name: string; color?: string }) => ({ id: r.id, name: r.name, color: r.color }));
          merged.joinedAt = m.joinedAt;
          if (m.nickname) merged.nickname = m.nickname;
          if (m.isOwner) merged.isOwner = true;
        }
        if (active) setProfile((prev) => ({ ...prev, ...merged }));
      } catch { /* keep the partial profile */ }
    })();
    return () => { active = false; };
  }, [target.id, target.serverId]);
  return (
    <MountWhenOpened open>
      <FullProfileDialog
        user={profile}
        open
        onOpenChange={(open) => { if (!open) onClose(); }}
        isCurrentUser={me?.id === target.id}
        isFriend={profile.isFriend ?? friends.has(target.id.toLowerCase())}
        serverId={target.serverId ?? undefined}
        showOwnerCrown={Boolean(target.serverId)}
      />
    </MountWhenOpened>
  );
}

/** Discord "Add Note": a private note only you can see. */
function NoteDialog({ userId, name, onClose }: { userId: string; name: string; onClose: () => void }) {
  const gt = useGT();
  const stored = useUserNote(userId);
  const [value, setValue] = useState(stored);
  const close = () => {
    if (value !== stored) void saveUserNote(userId, value, { immediate: true });
    onClose();
  };
  return (
    <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className={DIALOG_CLASS}>
        <DialogHeader>
          <DialogTitle>{gt("Note")}</DialogTitle>
          <DialogDescription className="text-[var(--text-secondary)]">
            {gt("Only you can see the note you leave on {name}.", { name })}
          </DialogDescription>
        </DialogHeader>
        <Textarea
          autoFocus
          value={value}
          maxLength={USER_NOTE_MAX}
          onChange={(e) => setValue(e.target.value)}
          placeholder={gt("Click to add a note")}
          className="min-h-24 bg-[var(--bg-app)] border-[var(--border-subtle)] text-[var(--text-primary)]"
        />
        <div className="text-right text-xs text-[var(--text-muted)]">{USER_NOTE_MAX - Array.from(value).length}</div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            {gt("Cancel")}
          </Button>
          <Button onClick={close}>{gt("Save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Discord "Change Nickname" (yours, or a member's with Manage Nicknames). */
function NicknameDialog({ request, onClose }: { request: UserActionRequest; onClose: () => void }) {
  const gt = useGT();
  const { user: me } = useAuth();
  const { fetchMembers } = useServer();
  const { target } = request;
  const serverId = target.serverId as string;
  const isSelf = me?.id === target.id;
  const [nickname, setNickname] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    fetch(`/api/servers/${serverId}/members/${target.id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active) return;
        setNickname(data?.nickname || "");
        setLoaded(true);
      })
      .catch(() => active && setLoaded(true));
    return () => { active = false; };
  }, [serverId, target.id]);

  const save = async (value: string) => {
    setSaving(true);
    try {
      const res = isSelf
        ? await fetch(`/api/servers/${serverId}/members/@me`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nickname: value || null }),
          })
        : await fetch(`/api/servers/${serverId}/members/${target.id}/nickname`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nickname: value || null }),
          });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || gt("Failed to change nickname"));
        return;
      }
      void fetchMembers(serverId);
      toast.success(value ? gt("Nickname changed") : gt("Nickname reset"));
      onClose();
    } catch {
      toast.error(gt("Failed to change nickname"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className={DIALOG_CLASS}>
        <DialogHeader>
          <DialogTitle>{gt("Change Nickname")}</DialogTitle>
          <DialogDescription className="text-[var(--text-secondary)]">
            {isSelf
              ? gt("Your nickname is only shown in this server.")
              : gt("Change the nickname {name} goes by in this server.", { name: target.displayName || target.username })}
          </DialogDescription>
        </DialogHeader>
        <div>
          <label className={FIELD_LABEL} htmlFor="member-nickname">{gt("Nickname")}</label>
          <input
            id="member-nickname"
            autoFocus
            disabled={!loaded}
            value={nickname}
            maxLength={32}
            onChange={(e) => setNickname(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void save(nickname.trim()); }}
            placeholder={target.displayName || target.username}
            className="w-full rounded-md bg-[var(--bg-app)] border border-[var(--border-subtle)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--app-accent)]"
          />
          <button
            type="button"
            onClick={() => void save("")}
            disabled={saving}
            className="mt-2 text-sm text-[var(--app-accent)] hover:underline"
          >
            {gt("Reset Nickname")}
          </button>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            {gt("Cancel")}
          </Button>
          <Button onClick={() => void save(nickname.trim())} disabled={saving || !loaded}>{gt("Save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Kick / Ban confirmation with an optional reason (Discord). */
function RemoveMemberDialog({ request, onClose }: { request: UserActionRequest; onClose: () => void }) {
  const gt = useGT();
  const { fetchMembers, currentServer } = useServer();
  const { kind, target } = request;
  const serverId = target.serverId as string;
  const name = target.displayName || target.username;
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const isBan = kind === "ban";
  const serverName = currentServer?.id === serverId ? currentServer?.name ?? "" : "";

  const submit = async () => {
    setBusy(true);
    try {
      const url = isBan ? `/api/servers/${serverId}/bans/${target.id}` : `/api/servers/${serverId}/members/${target.id}/kick`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reason.trim() ? { reason: reason.trim() } : {}),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || (isBan ? gt("Failed to ban member") : gt("Failed to kick member")));
        return;
      }
      toast.success(isBan ? gt("{name} was banned", { name }) : gt("{name} was kicked", { name }));
      void fetchMembers(serverId);
      onClose();
    } catch {
      toast.error(isBan ? gt("Failed to ban member") : gt("Failed to kick member"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className={DIALOG_CLASS}>
        <DialogHeader>
          <DialogTitle>{isBan ? gt("Ban '{name}'", { name }) : gt("Kick '{name}'", { name })}</DialogTitle>
          <DialogDescription className="text-[var(--text-secondary)]">
            {isBan
              ? gt("Are you sure you want to ban @{username} from the server? They won't be able to rejoin.", { username: target.username })
              : gt("Are you sure you want to kick @{username} from the server? They will be able to rejoin with a new invite.", { username: target.username })}
            {serverName ? ` (${serverName})` : ""}
          </DialogDescription>
        </DialogHeader>
        <div>
          <label className={FIELD_LABEL} htmlFor="mod-reason">{isBan ? gt("Reason for ban") : gt("Reason for kick")}</label>
          <Textarea
            id="mod-reason"
            value={reason}
            maxLength={512}
            onChange={(e) => setReason(e.target.value)}
            className="min-h-20 bg-[var(--bg-app)] border-[var(--border-subtle)] text-[var(--text-primary)]"
          />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            {gt("Cancel")}
          </Button>
          <Button variant="destructive" onClick={() => void submit()} disabled={busy} autoFocus>
            {isBan ? gt("Ban") : gt("Kick")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const TIMEOUT_CHOICES: Array<{ ms: number; key: "60s" | "5m" | "10m" | "1h" | "1d" | "1w" }> = [
  { ms: 60_000, key: "60s" },
  { ms: 5 * 60_000, key: "5m" },
  { ms: 10 * 60_000, key: "10m" },
  { ms: 60 * 60_000, key: "1h" },
  { ms: 24 * 60 * 60_000, key: "1d" },
  { ms: 7 * 24 * 60 * 60_000, key: "1w" },
];

/** Discord "Timeout" modal: duration chips, reason, Remove Timeout when active. */
function TimeoutDialog({ request, onClose }: { request: UserActionRequest; onClose: () => void }) {
  const gt = useGT();
  const { fetchMembers } = useServer();
  const { target } = request;
  const serverId = target.serverId as string;
  const name = target.displayName || target.username;
  const [duration, setDuration] = useState(TIMEOUT_CHOICES[0].ms);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const active = Boolean(target.communicationDisabledUntil && new Date(target.communicationDisabledUntil).getTime() > Date.now());
  const label = (key: (typeof TIMEOUT_CHOICES)[number]["key"]) => {
    switch (key) {
      case "60s": return gt("60 secs");
      case "5m": return gt("5 mins");
      case "10m": return gt("10 mins");
      case "1h": return gt("1 hour");
      case "1d": return gt("1 day");
      default: return gt("1 week");
    }
  };

  const submit = async (durationMs: number) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/servers/${serverId}/members/${target.id}/timeout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ durationMs, ...(reason.trim() ? { reason: reason.trim() } : {}) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || gt("Failed to update timeout"));
        return;
      }
      toast.success(durationMs > 0 ? gt("{name} was timed out", { name }) : gt("Timeout removed"));
      void fetchMembers(serverId);
      onClose();
    } catch {
      toast.error(gt("Failed to update timeout"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className={DIALOG_CLASS}>
        <DialogHeader>
          <DialogTitle>{gt("Timeout {name}", { name })}</DialogTitle>
          <DialogDescription className="text-[var(--text-secondary)]">
            {gt("Members who are in timeout can't send messages, react, join voice or speak until the timeout ends.")}
          </DialogDescription>
        </DialogHeader>
        <div>
          <div className={FIELD_LABEL}>{gt("Duration")}</div>
          <div className="flex flex-wrap gap-2" role="radiogroup">
            {TIMEOUT_CHOICES.map((c) => (
              <button
                key={c.key}
                type="button"
                role="radio"
                aria-checked={duration === c.ms}
                onClick={() => setDuration(c.ms)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-sm border transition-colors",
                  duration === c.ms
                    ? "bg-[var(--app-accent)] border-[var(--app-accent)] text-[var(--text-on-accent,#fff)]"
                    : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                )}
              >
                {label(c.key)}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className={FIELD_LABEL} htmlFor="timeout-reason">{gt("Reason")}</label>
          <Textarea
            id="timeout-reason"
            value={reason}
            maxLength={512}
            onChange={(e) => setReason(e.target.value)}
            className="min-h-20 bg-[var(--bg-app)] border-[var(--border-subtle)] text-[var(--text-primary)]"
          />
        </div>
        <DialogFooter className="gap-2">
          {active && (
            <Button variant="ghost" onClick={() => void submit(0)} disabled={busy} className="mr-auto text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
              {gt("Remove Timeout")}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            {gt("Cancel")}
          </Button>
          <Button variant="destructive" onClick={() => void submit(duration)} disabled={busy}>
            {gt("Timeout")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
