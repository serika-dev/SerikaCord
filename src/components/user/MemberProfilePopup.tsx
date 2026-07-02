"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ProfileCard, type ProfileCardUser } from "@/components/user/ProfileCard";

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
 */
export function MemberProfilePopup({
  children,
  member,
  serverId,
  side = "left",
  align = "start",
}: MemberProfilePopupProps) {
  const { user: currentUser } = useAuth();
  const [open, setOpen] = useState(false);
  const [fullProfile, setFullProfile] = useState<ProfileCardUser>(member);

  useEffect(() => {
    setFullProfile(member);
  }, [member]);

  useEffect(() => {
    if (!open || !member.id) return;
    let cancelled = false;

    const fetchProfile = async () => {
      try {
        const response = await fetch(`/api/users/${member.id}`);
        if (response.ok && !cancelled) {
          const data = await response.json();
          setFullProfile((prev) => ({ ...prev, ...data }));
        }
      } catch {
        // Keep whatever partial data we already have
      }
    };

    void fetchProfile();
    return () => {
      cancelled = true;
    };
  }, [open, member.id]);

  return (
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
        />
      </PopoverContent>
    </Popover>
  );
}
