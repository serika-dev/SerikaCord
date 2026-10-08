"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Copy, MessageSquare, Phone, UserPlus, Video } from "lucide-react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

export interface ContextMenuUser {
  id: string;
  username: string;
  displayName?: string | null;
  isBot?: boolean;
  isSystem?: boolean;
  /** Bridged Discord users can't be messaged or called from SerikaCord. */
  isDiscord?: boolean;
}

/**
 * The user actions shown when you right-click someone: in chat (name or avatar),
 * in the DM list and in the member list. Rendered as `ctx-item` buttons so it can sit
 * inside any `ctx-menu`.
 */
export function UserMenuItems({ user, onDone }: { user: ContextMenuUser; onDone: () => void }) {
  const gt = useGT();
  const router = useRouter();
  const { user: me } = useAuth();
  const isSelf = me?.id === user.id;
  const reachable = !isSelf && !user.isSystem && !user.isDiscord;
  const human = reachable && !user.isBot;

  const addFriend = async () => {
    onDone();
    try {
      const res = await fetch(`/api/friends/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user.username }),
      });
      const data = await res.json().catch(() => ({}));
      const name = user.displayName || user.username;
      // The server auto-accepts when they had already sent us a request.
      if (res.ok && (data?.accepted || data?.user)) toast.success(gt("You are now friends with {name}!", { name }));
      else if (res.ok) toast.success(gt("Friend request sent to {name}", { name }));
      else toast.error(data?.error || gt("Failed to send friend request"));
    } catch {
      toast.error(gt("Failed to send friend request"));
    }
  };

  const copy = (text: string, done: string) => {
    onDone();
    navigator.clipboard?.writeText(text);
    toast.success(done);
  };

  return (
    <>
      {reachable && (
        <button className="ctx-item" onClick={() => { onDone(); router.push(`/dm/${user.id}`); }}>
          <MessageSquare className="w-4 h-4" />
          {gt("Send Message")}
        </button>
      )}
      {human && (
        <>
          <button className="ctx-item" onClick={() => void addFriend()}>
            <UserPlus className="w-4 h-4" />
            {gt("Add Friend")}
          </button>
          <button className="ctx-item" onClick={() => { onDone(); router.push(`/dm/${user.id}?call=voice`); }}>
            <Phone className="w-4 h-4" />
            {gt("Call")}
          </button>
          <button className="ctx-item" onClick={() => { onDone(); router.push(`/dm/${user.id}?call=video`); }}>
            <Video className="w-4 h-4" />
            {gt("Video Call")}
          </button>
        </>
      )}
      {reachable && <div className="ctx-sep" />}
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
 * Right-click menu for a user, opened at the pointer.
 *
 *   const { openUserMenu, userMenu } = useUserContextMenu();
 *   <button onContextMenu={(e) => openUserMenu(e, author)}>…</button>
 *   {userMenu}
 */
export function useUserContextMenu() {
  const [state, setState] = useState<{ x: number; y: number; user: ContextMenuUser } | null>(null);

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

  const userMenu = state && typeof document !== "undefined"
    ? createPortal(
        <div
          className="ctx-menu fixed z-[9999] min-w-[188px]"
          style={{
            left: Math.min(state.x, window.innerWidth - 200),
            top: Math.min(state.y, window.innerHeight - 260),
          }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}
          role="menu"
        >
          <UserMenuItems user={state.user} onDone={close} />
        </div>,
        document.body
      )
    : null;

  return { openUserMenu, userMenu };
}
