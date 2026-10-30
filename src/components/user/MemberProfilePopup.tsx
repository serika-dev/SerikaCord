"use client";

import dynamic from "next/dynamic";
import { MountWhenOpened } from "@/components/ui/MountWhenOpened";

import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { ProfileCardUser } from "@/components/user/ProfileCard";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useServerMembersOptional } from "@/contexts/ServerContext";
import { withServerProfile, type MemberProfileOverrides } from "@/lib/profiles/memberProfile";
import { onMemberProfileChanged } from "@/lib/profiles/memberProfileEvents";
import { profilePopoverPositioning, type ProfilePopoverSurface } from "@/lib/profiles/profilePopoverPlacement";

// The card (with its activity/game presets) is only shown on click; it used to
// sit in the startup bundle of every chat page. Its chunk starts loading when
// the trigger is armed (hover/focus/press), well before the popover opens.
const loadProfileCard = () => import("@/components/user/ProfileCard").then((m) => m.ProfileCard);
const ProfileCard = dynamic(loadProfileCard, { ssr: false });

const ModViewDialog = dynamic(() => import("@/components/user/ModViewDialog").then((m) => m.ModViewDialog), { ssr: false });

const FullProfileDialog = dynamic(() => import("@/components/user/FullProfileDialog").then((m) => m.FullProfileDialog), { ssr: false });

interface MemberProfilePopupProps {
  children: React.ReactNode;
  member: ProfileCardUser;
  serverId?: string;
  /**
   * Where the trigger sits: "chat" (names, avatars, mentions) opens the card
   * to the right of the trigger, "rightPanel" (member list) to the left. Both
   * top-align the card with the trigger and keep it inside the viewport.
   */
  surface?: ProfilePopoverSurface;
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
  surface = "chat",
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
      void loadProfileCard().catch(() => {});
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
      surface={surface}
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
  surface = "chat",
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
  // The card is open for the route it was opened on: navigating anywhere
  // (Message button, a link in the bio, a channel switch that keeps this
  // trigger mounted) closes it without an effect.
  const pathname = usePathname();
  const [openOnPath, setOpenOnPath] = useState<string | null>(initialOpen && !isMobile ? pathname : null);
  const open = openOnPath !== null && openOnPath === pathname;
  // A tap (touch tablets) opens the card on pointerup; the click that follows
  // lands on the trigger and would toggle it shut again at once.
  const openedAt = useRef(0);
  useLayoutEffect(() => {
    if (initialOpen) openedAt.current = Date.now();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const setOpen = (next: boolean) => {
    if (!next && Date.now() - openedAt.current < 450) return;
    if (next) openedAt.current = Date.now();
    setOpenOnPath(next ? pathname : null);
  };
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

  // Their server profile changed while the card is open: load it again.
  const [profileVersion, setProfileVersion] = useState(0);
  useEffect(() => {
    if (!serverId || (!open && !fullProfileOpen)) return;
    return onMemberProfileChanged((sid, uid) => {
      if (sid === serverId && uid.toLowerCase() === member.id.toLowerCase()) setProfileVersion((v) => v + 1);
    });
  }, [serverId, open, fullProfileOpen, member.id]);

  useEffect(() => {
    // A webhook's id isn't a user: there is no profile to load.
    if ((!open && !fullProfileOpen) || !member.id || member.isWebhook) return;
    let cancelled = false;

    const fetchProfile = async () => {
      try {
        if (serverId) {
          const [userRes, memberRes] = await Promise.all([
            fetch(`/api/users/${member.id}`),
            fetch(`/api/servers/${serverId}/members/${member.id}`),
          ]);
          if (cancelled) return;
          let merged: Partial<ProfileCardUser> = {};
          if (userRes.ok) {
            const userData = await userRes.json();
            Object.assign(merged, userData);
          }
          if (memberRes.ok) {
            const memberData = await memberRes.json();
            // The user fetch carries the main profile; this server's profile
            // (avatar, banner, bio, pronouns, styles) goes on top of it.
            const overrides = (memberData.serverProfile ?? null) as MemberProfileOverrides | null;
            if (userRes.ok) {
              merged = withServerProfile({ ...merged, nickname: null } as ProfileCardUser, overrides);
            } else if (overrides) {
              // Main profile unknown: take the member's effective fields.
              merged.avatar = memberData.avatar ?? merged.avatar;
              merged.banner = memberData.banner ?? merged.banner;
              merged.bio = memberData.bio ?? merged.bio;
              merged.pronouns = memberData.pronouns ?? merged.pronouns;
              merged.customization = memberData.customization ?? merged.customization;
            }
            merged.roles = (memberData.roles || []).map((r: { id: string; name: string; color?: string }) => ({
              id: r.id,
              name: r.name,
              color: r.color,
            }));
            merged.joinedAt = memberData.joinedAt;
            merged.nickname = memberData.nickname || null;
            merged.serverProfile = overrides ?? {};
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
  }, [open, fullProfileOpen, member.id, serverId, profileVersion]);

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
        <MountWhenOpened open={fullProfileOpen}>
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
        </MountWhenOpened>
        {serverId && (
          <MountWhenOpened open={modViewOpen}>
          <ModViewDialog user={fullProfile} serverId={serverId} open={modViewOpen} onOpenChange={setModViewOpen} />
        </MountWhenOpened>
        )}
      </>
    );
  }

  return (
    <>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        {...profilePopoverPositioning(surface)}
        className="w-auto p-0 border-none bg-transparent shadow-none"
      >
        <ProfileCard
          fitToViewport
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

    <MountWhenOpened open={fullProfileOpen}>
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
    </MountWhenOpened>
    {serverId && (
      <MountWhenOpened open={modViewOpen}>
          <ModViewDialog user={fullProfile} serverId={serverId} open={modViewOpen} onOpenChange={setModViewOpen} />
        </MountWhenOpened>
    )}
    </>
  );
}
