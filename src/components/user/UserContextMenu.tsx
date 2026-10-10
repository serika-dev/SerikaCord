"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  AtSign,
  Ban,
  Check,
  ChevronRight,
  Clock,
  Copy,
  MessageSquare,
  NotebookPen,
  Pencil,
  Phone,
  ShieldAlert,
  ShieldBan,
  User as UserIcon,
  UserMinus,
  UserPlus,
  UserPlus2,
  UserX,
  Video,
} from "lucide-react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useServerMembersOptional } from "@/contexts/ServerContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { patchRelationship, refreshRelationships, useRelationships } from "@/lib/social/relationshipsStore";
import { hasMentionTarget, openUserAction, requestMention, type UserActionTarget } from "@/lib/social/userActions";
import { cn } from "@/lib/utils";

export interface ContextMenuUser {
  id: string;
  username: string;
  displayName?: string | null;
  avatar?: string | null;
  isBot?: boolean;
  isSystem?: boolean;
  /** Bridged Discord users can't be messaged or called from SerikaCord. */
  isDiscord?: boolean;
}

interface ServerRoleLite {
  id: string;
  name: string;
  color?: string;
  position?: number;
  hoist?: boolean;
  isDefault?: boolean;
  managed?: boolean;
}

type MemberLite = {
  id: string;
  membershipId?: string;
  roles?: ServerRoleLite[];
  communicationDisabledUntil?: string | null;
  isOwner?: boolean;
};

const norm = (id: string) => String(id).toLowerCase();

/**
 * The Discord user menu, shown when you right-click someone anywhere: chat
 * name/avatar, member list, DM list, voice, mentions. Rendered as `ctx-item`
 * rows so it can sit inside any `ctx-menu`. With a `serverId` it adds the
 * server actions the viewer is allowed to use (nickname, roles, timeout, kick,
 * ban); the server enforces every one of them again.
 */
export function UserMenuItems({
  user,
  onDone,
  serverId,
}: {
  user: ContextMenuUser;
  onDone: () => void;
  serverId?: string | null;
}) {
  const gt = useGT();
  const router = useRouter();
  const confirm = useConfirm();
  const { user: me } = useAuth();
  const rel = useRelationships();
  const serverMembers = useServerMembersOptional();
  const { can, isOwner, loading: permsLoading } = usePermissions(serverId || null);
  const [rolesOpen, setRolesOpen] = useState(false);

  const id = norm(user.id);
  const isSelf = me?.id ? norm(me.id) === id : false;
  const reachable = !isSelf && !user.isSystem && !user.isDiscord;
  const human = reachable && !user.isBot;
  const isFriend = rel.friends.has(id);
  const isBlocked = rel.blocked.has(id);
  const outgoing = rel.outgoing.has(id);
  const incoming = rel.incoming.has(id);
  const name = user.displayName || user.username;

  const member = serverId
    ? ((serverMembers?.members ?? []) as MemberLite[]).find((m) => norm(m.id) === id) ?? null
    : null;
  const inServer = Boolean(serverId) && !user.isDiscord && (member !== null || !serverMembers);
  const targetIsOwner = Boolean(member?.isOwner);
  const canModerateTarget = inServer && !isSelf && !targetIsOwner && !permsLoading;

  const target: UserActionTarget = {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatar: user.avatar,
    isBot: user.isBot,
    serverId: serverId ?? null,
    communicationDisabledUntil: member?.communicationDisabledUntil ?? null,
  };

  const run = (fn: () => void) => () => {
    onDone();
    fn();
  };

  const friendAction = async (method: "POST" | "DELETE", url: string, body?: unknown) => {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data } as { ok: boolean; data: { error?: string; accepted?: boolean; user?: unknown } };
  };

  const addFriend = async () => {
    try {
      if (incoming) {
        const { ok, data } = await friendAction("POST", `/api/friends/accept/${user.id}`);
        if (!ok) throw new Error(data?.error);
        patchRelationship(user.id, { friend: true, incoming: false });
        toast.success(gt("You are now friends with {name}!", { name }));
      } else {
        const { ok, data } = await friendAction("POST", "/api/friends/add", { username: user.username });
        if (!ok) {
          toast.error(data?.error || gt("Failed to send friend request"));
          return;
        }
        // The server auto-accepts when they had already sent us a request.
        if (data?.accepted || data?.user) {
          patchRelationship(user.id, { friend: true, incoming: false });
          toast.success(gt("You are now friends with {name}!", { name }));
        } else {
          patchRelationship(user.id, { outgoing: true });
          toast.success(gt("Friend request sent to {name}", { name }));
        }
      }
    } catch {
      toast.error(gt("Failed to send friend request"));
    } finally {
      void refreshRelationships();
    }
  };

  const cancelRequest = async () => {
    const { ok } = await friendAction("DELETE", `/api/friends/cancel/${user.id}`).catch(() => ({ ok: false }));
    if (ok) patchRelationship(user.id, { outgoing: false });
    else toast.error(gt("Failed to cancel friend request"));
    void refreshRelationships();
  };

  const removeFriend = async () => {
    const ok = await confirm({
      title: gt("Remove '{name}'", { name }),
      description: gt("Are you sure you want to remove {name} from your friends?", { name }),
      confirmLabel: gt("Remove Friend"),
    });
    if (!ok) return;
    const res = await friendAction("DELETE", `/api/friends/${user.id}`).catch(() => ({ ok: false, data: {} }));
    if (res.ok) patchRelationship(user.id, { friend: false });
    else toast.error(gt("Failed to remove friend"));
    void refreshRelationships();
  };

  const toggleBlock = async () => {
    if (!isBlocked) {
      const ok = await confirm({
        title: gt("Block {name}?", { name }),
        description: gt("They won't be able to message you, and their messages will be hidden in servers you share. Blocking also removes them from your friends."),
        confirmLabel: gt("Block"),
      });
      if (!ok) return;
    }
    const res = isBlocked
      ? await friendAction("DELETE", `/api/friends/unblock/${user.id}`).catch(() => ({ ok: false, data: {} }))
      : await friendAction("POST", `/api/friends/block/${user.id}`).catch(() => ({ ok: false, data: {} }));
    if (res.ok) {
      patchRelationship(user.id, isBlocked ? { blocked: false } : { blocked: true, friend: false, incoming: false, outgoing: false });
      toast.success(isBlocked ? gt("{name} unblocked", { name }) : gt("{name} blocked", { name }));
    } else {
      toast.error(isBlocked ? gt("Failed to unblock user") : gt("Failed to block user"));
    }
    void refreshRelationships();
  };

  const copy = (text: string, done: string) => {
    onDone();
    void navigator.clipboard?.writeText(text);
    toast.success(done);
  };

  const canChangeNickname = inServer && (isSelf ? (isOwner || can("CHANGE_NICKNAME") || can("MANAGE_NICKNAMES")) : canModerateTarget && can("MANAGE_NICKNAMES"));
  const canTimeout = canModerateTarget && can("MODERATE_MEMBERS");
  const canKick = canModerateTarget && (can("KICK_MEMBERS") || can("BAN_MEMBERS"));
  const canBan = canModerateTarget && can("BAN_MEMBERS");
  const canRoles = inServer && !permsLoading && can("MANAGE_ROLES");
  const canModView = canModerateTarget && (canTimeout || canKick || canBan || canRoles);
  const timedOut = Boolean(member?.communicationDisabledUntil && new Date(member.communicationDisabledUntil).getTime() > Date.now());
  const showMention = hasMentionTarget();

  return (
    <>
      <button className="ctx-item" onClick={run(() => openUserAction("profile", target))}>
        <UserIcon className="w-4 h-4" />
        {gt("Profile")}
      </button>
      {showMention && (
        <button className="ctx-item" onClick={run(() => requestMention(user.id, name))}>
          <AtSign className="w-4 h-4" />
          {gt("Mention")}
        </button>
      )}
      {reachable && (
        <button className="ctx-item" onClick={run(() => router.push(`/dm/${user.id}`))}>
          <MessageSquare className="w-4 h-4" />
          {gt("Message")}
        </button>
      )}
      {human && (
        <>
          <button className="ctx-item" onClick={run(() => router.push(`/dm/${user.id}?call=voice`))}>
            <Phone className="w-4 h-4" />
            {gt("Call")}
          </button>
          <button className="ctx-item" onClick={run(() => router.push(`/dm/${user.id}?call=video`))}>
            <Video className="w-4 h-4" />
            {gt("Video Call")}
          </button>
        </>
      )}
      {!isSelf && !user.isSystem && !user.isDiscord && (
        <button className="ctx-item" onClick={run(() => openUserAction("note", target))}>
          <NotebookPen className="w-4 h-4" />
          {gt("Add Note")}
        </button>
      )}

      {human && (
        <>
          <div className="ctx-sep" />
          {inServer && (
            <button className="ctx-item" onClick={run(() => window.dispatchEvent(new CustomEvent("openInviteDialog")))}>
              <UserPlus2 className="w-4 h-4" />
              {gt("Invite to Server")}
            </button>
          )}
          {!isBlocked && (isFriend ? (
            <button className="ctx-item" onClick={run(() => void removeFriend())}>
              <UserMinus className="w-4 h-4" />
              {gt("Remove Friend")}
            </button>
          ) : outgoing ? (
            <button className="ctx-item" onClick={run(() => void cancelRequest())}>
              <UserX className="w-4 h-4" />
              {gt("Cancel Friend Request")}
            </button>
          ) : (
            <button className="ctx-item" onClick={run(() => void addFriend())}>
              <UserPlus className="w-4 h-4" />
              {incoming ? gt("Accept Friend Request") : gt("Add Friend")}
            </button>
          ))}
          <button className={cn("ctx-item", !isBlocked && "ctx-item-danger")} onClick={run(() => void toggleBlock())}>
            <Ban className="w-4 h-4" />
            {isBlocked ? gt("Unblock") : gt("Block")}
          </button>
        </>
      )}

      {canChangeNickname && (
        <>
          <div className="ctx-sep" />
          <button className="ctx-item" onClick={run(() => openUserAction("nickname", target))}>
            <Pencil className="w-4 h-4" />
            {isSelf ? gt("Edit Server Nickname") : gt("Change Nickname")}
          </button>
        </>
      )}

      {(canTimeout || canKick || canBan) && (
        <>
          <div className="ctx-sep" />
          {canTimeout && (
            <button className="ctx-item ctx-item-danger" onClick={run(() => openUserAction("timeout", target))}>
              <Clock className="w-4 h-4" />
              {timedOut ? gt("Remove Timeout") : gt("Timeout {name}", { name })}
            </button>
          )}
          {canKick && (
            <button className="ctx-item ctx-item-danger" onClick={run(() => openUserAction("kick", target))}>
              <UserX className="w-4 h-4" />
              {gt("Kick {name}", { name })}
            </button>
          )}
          {canBan && (
            <button className="ctx-item ctx-item-danger" onClick={run(() => openUserAction("ban", target))}>
              <ShieldBan className="w-4 h-4" />
              {gt("Ban {name}", { name })}
            </button>
          )}
        </>
      )}

      {canRoles && serverId && (
        <>
          <div className="ctx-sep" />
          <RolesSubmenu
            open={rolesOpen}
            onOpenChange={setRolesOpen}
            serverId={serverId}
            userId={user.id}
            memberRoles={member?.roles}
            onRolesUpdated={(roles) => serverMembers?.applyMemberRoles(user.id, roles)}
          />
        </>
      )}

      {canModView && serverId && (
        <button className="ctx-item" onClick={run(() => openUserAction("modview", target))}>
          <ShieldAlert className="w-4 h-4" />
          {gt("Open Mod View")}
        </button>
      )}

      <div className="ctx-sep" />
      <button className="ctx-item" onClick={() => copy(user.username, gt("Username copied"))}>
        <Copy className="w-4 h-4" />
        {gt("Copy Username")}
      </button>
      <button className="ctx-item" onClick={() => copy(user.id, gt("User ID copied"))}>
        <Copy className="w-4 h-4" />
        {gt("Copy User ID")}
      </button>
    </>
  );
}

/**
 * "Roles ▸" with a checkbox per role. Roles at or above your own highest role
 * (or managed by an integration) are disabled; the server enforces the same
 * hierarchy.
 */
function RolesSubmenu({
  open,
  onOpenChange,
  serverId,
  userId,
  memberRoles,
  onRolesUpdated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverId: string;
  userId: string;
  memberRoles?: ServerRoleLite[];
  onRolesUpdated: (roles: ServerRoleLite[]) => void;
}) {
  const gt = useGT();
  const { user: me } = useAuth();
  const serverMembers = useServerMembersOptional();
  const { isOwner } = usePermissions(serverId);
  const [roles, setRoles] = useState<ServerRoleLite[] | null>(null);
  const [assigned, setAssigned] = useState<Set<string>>(() => new Set((memberRoles ?? []).map((r) => r.id)));
  const [busy, setBusy] = useState(false);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [flipLeft, setFlipLeft] = useState(false);
  const show = (next: boolean) => {
    if (next && rowRef.current) {
      // Open toward whichever side has room.
      setFlipLeft(rowRef.current.getBoundingClientRect().right + 228 > window.innerWidth);
    }
    onOpenChange(next);
  };

  useEffect(() => {
    if (!open || roles) return;
    let active = true;
    void (async () => {
      try {
        const [serverRes, memberRes] = await Promise.all([
          fetch(`/api/servers/${serverId}`),
          memberRoles ? Promise.resolve(null) : fetch(`/api/servers/${serverId}/members/${userId}`),
        ]);
        if (!active) return;
        if (serverRes.ok) {
          const data = await serverRes.json();
          setRoles(((data.server?.roles || []) as ServerRoleLite[]).filter((r) => !r.isDefault));
        } else {
          setRoles([]);
        }
        if (memberRes?.ok) {
          const m = await memberRes.json();
          setAssigned(new Set(((m.roles || []) as ServerRoleLite[]).map((r) => r.id)));
        }
      } catch {
        if (active) setRoles([]);
      }
    })();
    return () => { active = false; };
  }, [open, roles, serverId, userId, memberRoles]);

  const myTop = (() => {
    if (!me || !roles) return -1;
    const mine = ((serverMembers?.members ?? []) as MemberLite[]).find((m) => norm(m.id) === norm(me.id));
    return Math.max(-1, ...((mine?.roles ?? []).map((r) => r.position ?? 0)));
  })();

  const toggle = async (role: ServerRoleLite) => {
    if (!roles) return;
    const next = new Set(assigned);
    if (next.has(role.id)) next.delete(role.id); else next.add(role.id);
    const prev = assigned;
    setAssigned(next);
    setBusy(true);
    try {
      const res = await fetch(`/api/servers/${serverId}/members/${userId}/roles`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleIds: [...next] }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error);
      }
      const data = await res.json().catch(() => null);
      const fresh = (data?.member?.roles as ServerRoleLite[] | undefined) ?? roles.filter((r) => next.has(r.id));
      onRolesUpdated(fresh);
    } catch (err) {
      setAssigned(prev);
      toast.error((err as Error)?.message || gt("Failed to update roles"));
    } finally {
      setBusy(false);
    }
  };

  const sorted = [...(roles ?? [])].sort((a, b) => (b.position ?? 0) - (a.position ?? 0));

  return (
    <div
      ref={rowRef}
      className="relative"
      onMouseEnter={() => show(true)}
      onMouseLeave={() => show(false)}
    >
      <button
        className="ctx-item justify-between"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => show(!open)}
      >
        <span className="flex items-center gap-2">{gt("Roles")}</span>
        <ChevronRight className="w-4 h-4" />
      </button>
      {open && (
        <div
          role="menu"
          className={cn(
            "ctx-menu absolute top-0 z-[10000] w-[220px] max-h-[320px] overflow-y-auto scrollbar-thin",
            flipLeft ? "right-full mr-1" : "left-full ml-1"
          )}
        >
          {roles === null ? (
            <div className="px-3 py-2 text-sm text-[var(--text-muted)]">{gt("Loading...")}</div>
          ) : sorted.length === 0 ? (
            <div className="px-3 py-2 text-sm text-[var(--text-muted)]">{gt("No roles")}</div>
          ) : (
            sorted.map((role) => {
              const locked = Boolean(role.managed) || (!isOwner && (role.position ?? 0) >= myTop);
              const checked = assigned.has(role.id);
              return (
                <button
                  key={role.id}
                  role="menuitemcheckbox"
                  aria-checked={checked}
                  disabled={locked || busy}
                  className="ctx-item"
                  onClick={() => void toggle(role)}
                >
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: role.color || "var(--text-muted)" }}
                    aria-hidden
                  />
                  <span className="flex-1 truncate">{role.name}</span>
                  <span
                    className={cn(
                      "w-4 h-4 rounded-sm border flex items-center justify-center shrink-0",
                      checked ? "bg-[var(--app-accent)] border-[var(--app-accent)] text-[var(--text-on-accent,#fff)]" : "border-[var(--border-strong,var(--border-subtle))]"
                    )}
                    aria-hidden
                  >
                    {checked && <Check className="w-3 h-3" />}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Right-click menu for a user, opened at the pointer.
 *
 *   const { openUserMenu, userMenu } = useUserContextMenu(serverId);
 *   <button onContextMenu={(e) => openUserMenu(e, author)}>…</button>
 *   {userMenu}
 */
export function useUserContextMenu(serverId?: string | null) {
  const [state, setState] = useState<{ x: number; y: number; user: ContextMenuUser } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const openUserMenu = useCallback((event: React.MouseEvent, user: ContextMenuUser) => {
    event.preventDefault();
    event.stopPropagation();
    setState({ x: event.clientX, y: event.clientY, user });
  }, []);

  const close = useCallback(() => setState(null), []);

  useEffect(() => {
    if (!state) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [state, close]);

  // Keep the whole menu on screen, also when it grows after the viewer's
  // server permissions load. Positioned directly on the element (no re-render).
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!state || !el) return;
    const place = () => {
      const rect = el.getBoundingClientRect();
      const left = Math.max(8, Math.min(state.x, window.innerWidth - rect.width - 8));
      const top = state.y + rect.height > window.innerHeight - 8 ? Math.max(8, window.innerHeight - rect.height - 8) : state.y;
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
      el.style.visibility = "visible";
    };
    place();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [state]);

  const userMenu = state && typeof document !== "undefined"
    ? createPortal(
        <div
          ref={menuRef}
          className="ctx-menu fixed z-[9999] min-w-[200px]"
          style={{ left: state.x, top: state.y, visibility: "hidden" }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}
          role="menu"
        >
          <UserMenuItems user={state.user} onDone={close} serverId={serverId} />
        </div>,
        document.body
      )
    : null;

  return { openUserMenu, userMenu };
}
