"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ProfileCard, type ProfileCardUser } from "@/components/user/ProfileCard";
import { FullProfileDialog } from "@/components/user/FullProfileDialog";
import { ModViewDialog } from "@/components/user/ModViewDialog";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useServerMembersOptional } from "@/contexts/ServerContext";

interface MemberProfilePopupProps {
  children: React.ReactNode;
  member: ProfileCardUser;
  serverId?: string;
  side?: "left" | "right" | "top" | "bottom";
  align?: "start" | "center" | "end";
}

/**
 * Popover wrapper around ProfileCard. Fetches the member's full profile
 * (banner, bio, badges) lazily when opened.
 *
 * PERF: The chat renders one of these per avatar, per username, and per
 * @mention — easily dozens on screen at once. The heavy body below mounts a
 * Radix Popover *and* a FullProfileDialog (which polls live activity, ticks a
 * clock, subscribes to auth/mobile state). Mounting all of that eagerly for
 * every message saturated the main thread and network. So we defer the entire
 * body until the user actually interacts with the trigger: until then we render
 * only `children` inside a `display:contents` wrapper (no box, no layout shift)
 * that "arms" the popup on first hover/focus/press.
 */
export function MemberProfilePopup({
  children,
  member,
  serverId,
  side = "left",
  align = "start",
}: MemberProfilePopupProps) {
  const [armed, setArmed] = useState(false);
  // Touch users have no hover to pre-arm on, so a tap must open immediately.
  const autoOpenRef = useRef(false);
  // Track touch start position to distinguish tap vs scroll on mobile.
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const touchCancelledRef = useRef(false);

  if (!armed) {
    const arm = (autoOpen: boolean) => {
      if (autoOpen) autoOpenRef.current = true;
      setArmed(true);
    };
    // `display:contents` keeps the wrapper from generating a box, so the trigger
    // renders exactly as before; pointer/focus events still bubble to it.
    return (
      <span
        style={{ display: "contents" }}
        onPointerEnter={(e) => { if (e.pointerType !== "touch") arm(false); }}
        onPointerDown={(e) => {
          if (e.pointerType === "touch") {
            // Don't arm immediately — wait to see if this is a tap or a scroll.
            touchStartRef.current = { x: e.clientX, y: e.clientY };
            touchCancelledRef.current = false;
          } else {
            arm(false);
          }
        }}
        onPointerMove={(e) => {
          if (touchStartRef.current && !touchCancelledRef.current) {
            const dx = e.clientX - touchStartRef.current.x;
            const dy = e.clientY - touchStartRef.current.y;
            if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
              touchCancelledRef.current = true;
            }
          }
        }}
        onPointerUp={(e) => {
          if (e.pointerType === "touch" && touchStartRef.current && !touchCancelledRef.current) {
            arm(true);
          }
          touchStartRef.current = null;
        }}
        onPointerCancel={() => { touchStartRef.current = null; }}
        onFocus={() => arm(false)}
      >
        {children}
      </span>
    );
  }

  return (
    <MemberProfilePopupBody
      member={member}
      serverId={serverId}
      side={side}
      align={align}
      initialOpen={autoOpenRef.current}
    >
      {children}
    </MemberProfilePopupBody>
  );
}

function MemberProfilePopupBody({
  children,
  member,
  serverId,
  side = "left",
  align = "start",
  initialOpen,
}: MemberProfilePopupProps & { initialOpen: boolean }) {
  const { user: currentUser } = useAuth();
  const isMobile = useIsMobile();
  const serverMembers = useServerMembersOptional();
  // Push role changes made from the card straight into the sidebar so it
  // regroups instantly (the 30s poll is too slow), and — because the sidebar
  // now keeps rows mounted across regroups — the card stays open.
  const handleRolesUpdated = serverId
    ? (roles: Array<{ id: string; name: string; color?: string; hoist?: boolean; position?: number; isDefault?: boolean }>) => {
        serverMembers?.applyMemberRoles(member.id, roles);
      }
    : undefined;
  const [open, setOpen] = useState(!initialOpen ? false : !isMobile);
  const [fullProfileOpen, setFullProfileOpen] = useState(initialOpen && isMobile);
  const [modViewOpen, setModViewOpen] = useState(false);
  const [fullProfile, setFullProfile] = useState<ProfileCardUser>(member);

  // Seed from the `member` prop, but do NOT throw away the fuller profile we
  // already fetched (banner, bio, badges) just because the parent re-rendered
  // and handed us a new `member` object reference. Only fully reset when this
  // is actually a different user; otherwise keep the enriched fields on top of
  // any refreshed base fields.
  useEffect(() => {
    setFullProfile((prev) =>
      prev.id === member.id ? { ...member, ...prev } : member
    );
  }, [member]);

  useEffect(() => {
    if ((!open && !fullProfileOpen) || !member.id) return;
    let cancelled = false;

    const fetchProfile = async () => {
      try {
        if (serverId) {
          const [userRes, memberRes] = await Promise.all([
            fetch(`/api/users/${member.id}`),
            fetch(`/api/servers/${serverId}/members/${member.id}`),
          ]);
          if (cancelled) return;
          const merged: Partial<ProfileCardUser> = {};
          if (userRes.ok) {
            const userData = await userRes.json();
            Object.assign(merged, userData);
          }
          if (memberRes.ok) {
            const memberData = await memberRes.json();
            merged.roles = (memberData.roles || []).map((r: { id: string; name: string; color?: string }) => ({
              id: r.id,
              name: r.name,
              color: r.color,
            }));
            merged.joinedAt = memberData.joinedAt;
            if (memberData.nickname) merged.nickname = memberData.nickname;
            if (memberData.isOwner) merged.isOwner = true;
          }
          setFullProfile((prev) => ({ ...prev, ...merged }));
        } else {
          const response = await fetch(`/api/users/${member.id}`);
          if (response.ok && !cancelled) {
            const data = await response.json();
            setFullProfile((prev) => ({ ...prev, ...data }));
          }
        }
      } catch {
        // Keep whatever partial data we already have
      }
    };

    void fetchProfile();
    return () => {
      cancelled = true;
    };
  }, [open, fullProfileOpen, member.id, serverId]);

  // On mobile, tapping the avatar/name opens the full profile as a bottom
  // sheet that slides up — no intermediate popover card.
  if (isMobile) {
    return (
      <>
        <div
          className="inline-flex"
          onClick={(e) => {
            e.stopPropagation();
            setFullProfileOpen(true);
          }}
        >
          {children}
        </div>
        <FullProfileDialog
          user={fullProfile}
          open={fullProfileOpen}
          onOpenChange={setFullProfileOpen}
          isCurrentUser={currentUser?.id === member.id}
          isFriend={fullProfile.isFriend}
          serverId={serverId}
          showOwnerCrown={Boolean(serverId)}
          onOpenModView={serverId ? () => { setFullProfileOpen(false); setModViewOpen(true); } : undefined}
        />
        {serverId && (
          <ModViewDialog user={fullProfile} serverId={serverId} open={modViewOpen} onOpenChange={setModViewOpen} />
        )}
      </>
    );
  }

  return (
    <>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        sideOffset={8}
        collisionPadding={12}
        className="w-auto p-0 border-none bg-transparent shadow-none"
      >
        <ProfileCard
          user={fullProfile}
          isCurrentUser={currentUser?.id === member.id}
          isFriend={fullProfile.isFriend}
          showOwnerCrown={Boolean(serverId)}
          onNavigate={() => setOpen(false)}
          serverId={serverId}
          hideConnections
          onViewFullProfile={() => {
            setOpen(false);
            setFullProfileOpen(true);
          }}
          onOpenModView={serverId ? () => { setOpen(false); setModViewOpen(true); } : undefined}
          onRolesUpdated={handleRolesUpdated}
        />
      </PopoverContent>
    </Popover>

    <FullProfileDialog
      user={fullProfile}
      open={fullProfileOpen}
      onOpenChange={setFullProfileOpen}
      isCurrentUser={currentUser?.id === member.id}
      isFriend={fullProfile.isFriend}
      serverId={serverId}
      showOwnerCrown={Boolean(serverId)}
      onOpenModView={serverId ? () => { setFullProfileOpen(false); setModViewOpen(true); } : undefined}
    />
    {serverId && (
      <ModViewDialog user={fullProfile} serverId={serverId} open={modViewOpen} onOpenChange={setModViewOpen} />
    )}
    </>
  );
}
